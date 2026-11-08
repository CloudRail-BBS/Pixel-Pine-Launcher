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
