//! 分发清单：游戏版本索引与客户端发布清单。
//!
//! 两份都是**运营方放文件、服务端只负责发**的模式：
//! 应用服务器不解析、不改写，省掉一套后台，也避免把游戏包塞进容器镜像。
//!
//! 文件不存在时返回 `204 No Content` 而不是 404：
//! - 客户端把 204 明确视为「暂时没有可下载内容」，界面走降级路径；
//! - 404 会被当成地址写错了，触发重试和报错。

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};

use super::AppState;

/// 读一个清单文件，没有就 204。
async fn serve(state: &AppState, relative: &str) -> Response {
    let path = state.config.storage_dir.join(relative);

    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            // 落盘前如果是坏的 JSON，早点让运营方看到，别等客户端解析失败
            if serde_json::from_slice::<serde_json::Value>(&bytes).is_err() {
                tracing::warn!(path = %path.display(), "清单不是合法 JSON");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
                    r#"{"error":"清单文件不是合法 JSON"}"#,
                )
                    .into_response();
            }

            (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "application/json; charset=utf-8"),
                    // 清单会被运营随时替换，不让 CDN 长时间缓存
                    (header::CACHE_CONTROL, "public, max-age=60"),
                ],
                bytes,
            )
                .into_response()
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            StatusCode::NO_CONTENT.into_response()
        }
        Err(error) => {
            tracing::warn!(%error, path = %path.display(), "读取清单失败");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// `GET /v1/game/index.json` —— 游戏本体版本清单。
pub async fn game_index(State(state): State<AppState>) -> Response {
    serve(&state, "game/index.json").await
}

/// `GET /v1/launcher/latest.json` —— 客户端更新清单（tauri updater 格式）。
pub async fn launcher_latest(State(state): State<AppState>) -> Response {
    serve(&state, "launcher/latest.json").await
}

/// `POST /v1/admin/launcher` —— 写入客户端更新清单（需要管理员）。
///
/// 为什么加这个接口：清单原本靠人工 `docker cp` 放进去，漏一次客户端就一直
/// 「已是最新版本」，而且界面上看不出任何异常（204 被当成「暂无更新」）。
/// 发版是 CI 干的活，清单也该由 CI 顺手推上来。
pub async fn publish_launcher(
    State(state): State<AppState>,
    user: crate::auth::AuthUser,
    body: axum::body::Bytes,
) -> Result<axum::Json<serde_json::Value>, crate::error::ApiError> {
    use crate::error::ApiError;

    user.require_admin()?;

    let manifest: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|error| ApiError::bad_request(format!("清单不是合法 JSON：{error}")))?;

    // 形状校验不能省：写进去一份缺字段的清单，客户端只会当成「没有更新」，
    // 又一次变成静默失败——这正是这个接口要解决的问题。
    let version = manifest
        .get("version")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("清单缺少 version"))?
        .to_string();
    let platforms = manifest
        .get("platforms")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| ApiError::bad_request("清单缺少 platforms"))?;
    if platforms.is_empty() {
        return Err(ApiError::bad_request("platforms 是空的"));
    }
    let platform_count = platforms.len();

    let dir = state.config.storage_dir.join("launcher");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|error| ApiError::internal(format!("创建目录失败：{error}")))?;

    // 先写临时文件再 rename：客户端随时可能来读，不能让它读到半截 JSON
    let target = dir.join("latest.json");
    let temp = dir.join("latest.json.tmp");
    tokio::fs::write(&temp, &body)
        .await
        .map_err(|error| ApiError::internal(format!("写清单失败：{error}")))?;
    tokio::fs::rename(&temp, &target)
        .await
        .map_err(|error| ApiError::internal(format!("替换清单失败：{error}")))?;

    super::upload::audit(
        &state,
        Some(user.id),
        "launcher.publish",
        &version,
        serde_json::json!({ "platforms": platform_count, "bytes": body.len() }),
    )
    .await;

    tracing::info!(%version, platforms = platform_count, "更新清单已更新");

    Ok(axum::Json(serde_json::json!({
        "ok": true,
        "version": version,
        "platforms": platform_count,
    })))
}
