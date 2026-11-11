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

/* ---------- 后台：游戏本体清单维护 ---------- */

/// 允许的平台取值。和客户端 `gamedl::current_platform()` 对齐。
const PLATFORMS: &[&str] = &["windows", "macos", "linux", "android"];

/// 校验清单形状。
///
/// 宁可在这里挑剔，也不要写进一份客户端读不懂的清单：
/// 客户端拿到坏清单时只会「没有可下载版本」，界面上看不出是运营填错了。
fn validate_game_manifest(value: &serde_json::Value) -> Result<usize, String> {
    let root = value.as_object().ok_or("清单必须是一个 JSON 对象")?;
    let versions = root
        .get("versions")
        .and_then(serde_json::Value::as_array)
        .ok_or("缺少 versions 数组")?;

    if let Some(schema) = root.get("schema") {
        if schema.as_i64() != Some(1) {
            return Err("schema 目前只支持 1".to_string());
        }
    }

    let mut seen = std::collections::HashSet::new();
    for (index, item) in versions.iter().enumerate() {
        let at = index + 1;
        let entry = item.as_object().ok_or(format!("第 {at} 条不是对象"))?;

        let text =
            |key: &str| -> Option<&str> { entry.get(key).and_then(serde_json::Value::as_str) };

        let version = text("version").unwrap_or("").trim();
        if version.is_empty() {
            return Err(format!("第 {at} 条缺少 version"));
        }

        let platform = text("platform").unwrap_or("");
        if !PLATFORMS.contains(&platform) {
            return Err(format!(
                "第 {at} 条 platform 只能是 {}",
                PLATFORMS.join(" / ")
            ));
        }

        // 同平台同版本出现两次，客户端只会拿到其中一条，属于静默错配
        if !seen.insert(format!("{platform}@{version}")) {
            return Err(format!("第 {at} 条与前面的 {platform} / {version} 重复"));
        }

        let urls = entry
            .get("urls")
            .and_then(serde_json::Value::as_array)
            .ok_or(format!("第 {at} 条缺少 urls 数组"))?;
        for url in urls {
            let url = url
                .as_str()
                .ok_or(format!("第 {at} 条 urls 里有非字符串"))?;
            if !(url.starts_with("https://") || url.starts_with("http://")) {
                return Err(format!("第 {at} 条的下载地址必须以 http(s):// 开头"));
            }
        }

        if let Some(archive) = text("archive") {
            if !archive.is_empty() && !archive.eq_ignore_ascii_case("zip") {
                return Err(format!("第 {at} 条 archive 目前只支持 zip"));
            }
        }

        if let Some(hash) = text("sha256") {
            if !hash.is_empty()
                && (hash.len() != 64 || !hash.chars().all(|ch| ch.is_ascii_hexdigit()))
            {
                return Err(format!("第 {at} 条 sha256 要么留空，要么是 64 位十六进制"));
            }
        }

        if let Some(size) = entry.get("size") {
            if !size.is_null() && size.as_u64().is_none() {
                return Err(format!("第 {at} 条 size 必须是非负整数"));
            }
        }
    }

    Ok(versions.len())
}

/// `GET /v1/admin/game` —— 读游戏清单；文件不存在时返回空骨架。
pub async fn admin_game_get(
    State(state): State<AppState>,
    user: crate::auth::AuthUser,
) -> Result<axum::Json<serde_json::Value>, crate::error::ApiError> {
    use crate::error::ApiError;

    user.require_admin()?;

    let path = state.config.storage_dir.join("game/index.json");
    match tokio::fs::read(&path).await {
        Ok(bytes) => match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(value) => Ok(axum::Json(value)),
            Err(error) => Err(ApiError::internal(format!(
                "磁盘上的清单不是合法 JSON：{error}"
            ))),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(axum::Json(
            serde_json::json!({ "schema": 1, "versions": [] }),
        )),
        Err(error) => Err(ApiError::internal(format!("读取清单失败：{error}"))),
    }
}

/// `PUT /v1/admin/game` —— 覆盖写入游戏清单（校验通过才落盘）。
pub async fn admin_game_put(
    State(state): State<AppState>,
    user: crate::auth::AuthUser,
    axum::Json(body): axum::Json<serde_json::Value>,
) -> Result<axum::Json<serde_json::Value>, crate::error::ApiError> {
    use crate::error::ApiError;

    user.require_admin()?;

    let count = validate_game_manifest(&body).map_err(ApiError::bad_request)?;

    let dir = state.config.storage_dir.join("game");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|error| ApiError::internal(format!("创建目录失败：{error}")))?;

    let mut normalized = body.clone();
    if let Some(root) = normalized.as_object_mut() {
        root.entry("schema").or_insert(serde_json::json!(1));
        root.entry("generated")
            .or_insert(serde_json::json!(chrono_now()));
    }

    let text = serde_json::to_string_pretty(&normalized)
        .map_err(|error| ApiError::internal(format!("序列化清单失败：{error}")))?;

    let target = dir.join("index.json");
    let temp = dir.join("index.json.tmp");
    tokio::fs::write(&temp, text.as_bytes())
        .await
        .map_err(|error| ApiError::internal(format!("写清单失败：{error}")))?;
    tokio::fs::rename(&temp, &target)
        .await
        .map_err(|error| ApiError::internal(format!("替换清单失败：{error}")))?;

    super::upload::audit(
        &state,
        Some(user.id),
        "game_manifest_update",
        "game/index.json",
        serde_json::json!({ "versions": count }),
    )
    .await;

    tracing::info!(versions = count, "游戏清单已更新");
    Ok(axum::Json(
        serde_json::json!({ "ok": true, "versions": count }),
    ))
}

/// 现在时间的 RFC3339（秒级），只用于清单里的 `generated` 字段。
fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    // 不引 chrono：这里只要一个能给客户端忽略的时间戳，够用即可
    let days = seconds / 86_400;
    let rest = seconds % 86_400;
    format!(
        "{}T{:02}:{:02}:{:02}Z",
        civil_date(days),
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60
    )
}

/// 把「1970 起的天数」换算成 `YYYY-MM-DD`。
fn civil_date(days_since_epoch: u64) -> String {
    // Howard Hinnant 的 civil_from_days，纯整数运算，不涉及时区
    let z = days_since_epoch as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

/// `POST /v1/admin/game/upload` —— 上传游戏本体压缩包。
///
/// 落盘到 `<storage>/game/`（通过 `/files/game/…` 对外），顺便算好 sha256 与体积，
/// 运营只需要把返回的 url / sha256 / size 填进清单条目——省掉「自己算哈希」这一步，
/// 而哈希恰恰是最容易抄错、抄错了客户端就不给装的字段。
pub async fn admin_game_upload(
    State(state): State<AppState>,
    user: crate::auth::AuthUser,
    mut multipart: axum::extract::Multipart,
) -> Result<axum::Json<serde_json::Value>, crate::error::ApiError> {
    use crate::error::ApiError;
    use sha2::{Digest, Sha256};

    user.require_admin()?;

    /// 单包上限，和全局 body 限制留出余量。
    const MAX: usize = 200 * 1024 * 1024;

    let mut bytes: Option<Vec<u8>> = None;
    let mut file_name = String::new();
    let mut version = String::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| ApiError::bad_request(format!("读取上传内容失败：{error}")))?
    {
        match field.name().unwrap_or_default() {
            "file" => {
                if file_name.is_empty() {
                    file_name = field.file_name().unwrap_or_default().to_string();
                }
                let data = field
                    .bytes()
                    .await
                    .map_err(|error| ApiError::bad_request(format!("读取文件失败：{error}")))?;
                if data.len() > MAX {
                    return Err(ApiError::bad_request("游戏包超过 200MB 上限"));
                }
                bytes = Some(data.to_vec());
            }
            "version" => {
                version = field
                    .text()
                    .await
                    .map_err(|error| ApiError::bad_request(format!("读取版本号失败：{error}")))?;
            }
            "fileName" => {
                file_name = field
                    .text()
                    .await
                    .map_err(|error| ApiError::bad_request(format!("读取文件名失败：{error}")))?;
            }
            _ => {}
        }
    }

    let bytes = bytes.ok_or_else(|| ApiError::bad_request("没有收到文件"))?;
    if bytes.is_empty() {
        return Err(ApiError::bad_request("文件是空的"));
    }

    // 用版本号当文件名骨架，只保留安全字符；后缀固定 .zip
    let stem = if version.trim().is_empty() {
        let base = file_name
            .rsplit('/')
            .next()
            .unwrap_or(&file_name)
            .to_string();
        base.trim_end_matches(".zip").to_string()
    } else {
        format!("rusted-warfare-{}", version.trim())
    };
    let stem = crate::storage::safe_segment(&stem);
    let file = format!("{stem}.zip");

    let dir = state.config.storage_dir.join("game");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|error| ApiError::internal(format!("创建目录失败：{error}")))?;
    tokio::fs::write(dir.join(&file), &bytes)
        .await
        .map_err(|error| ApiError::internal(format!("写文件失败：{error}")))?;

    let sha256 = hex::encode(Sha256::digest(&bytes));
    let url = format!("{}/files/game/{}", state.config.public_base, file);

    super::upload::audit(
        &state,
        Some(user.id),
        "game_upload",
        &file,
        serde_json::json!({ "size": bytes.len(), "sha256": sha256 }),
    )
    .await;

    Ok(axum::Json(serde_json::json!({
        "ok": true,
        "fileName": file,
        "url": url,
        "size": bytes.len(),
        "sha256": sha256,
    })))
}
