//! 作者侧：建草稿、上传版本、提交审核、我的资源。

use axum::extract::{Multipart, Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use super::AppState;
use crate::auth::AuthUser;
use crate::config::random_hex;
use crate::error::ApiError;
use crate::storage;

/// 单包上限，与客户端 `install_from_url` 保持一致。
const MAX_PACKAGE_BYTES: usize = 200 * 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct CreateBody {
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    /// 不填就自动生成，避免让用户纠结 slug
    #[serde(default)]
    pub slug: Option<String>,
}

/// 创建草稿。
pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateBody>,
) -> Result<Json<Value>, ApiError> {
    let kind = body.kind.trim().to_lowercase();
    if kind != "mod" && kind != "map" {
        return Err(ApiError::bad_request("kind 只能是 mod 或 map"));
    }

    let title = body.title.trim();
    if title.is_empty() || title.chars().count() > 60 {
        return Err(ApiError::bad_request("标题要填，且不超过 60 个字"));
    }

    let summary = body.summary.trim().to_string();
    if summary.chars().count() > 200 {
        return Err(ApiError::bad_request("简介不超过 200 个字"));
    }

    let slug = match body
        .slug
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(value) => storage::safe_segment(&value.to_lowercase()),
        None => format!("{kind}-{}", random_hex(4)),
    };

    let result = sqlx::query_as::<_, (Uuid, String, String)>(
        "INSERT INTO packages (slug, kind, title, summary, author, status, owner_id)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6)
         RETURNING id, slug, status",
    )
    .bind(&slug)
    .bind(&kind)
    .bind(title)
    .bind(&summary)
    .bind(&user.email)
    .bind(user.id)
    .fetch_one(&state.pool)
    .await;

    match result {
        Ok((id, slug, status)) => Ok(Json(json!({
            "id": id,
            "slug": slug,
            "status": status,
        }))),
        Err(error) if is_unique_violation(&error) => {
            Err(ApiError::conflict("这个 slug 已经被占用，换一个"))
        }
        Err(error) => Err(error.into()),
    }
}

/// 上传一个版本（multipart：file / version / changelog）。
pub async fn upload_version(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<Value>, ApiError> {
    let (slug, kind) = load_owned(&state, id, &user).await?;

    let mut version: Option<String> = None;
    let mut changelog = String::new();
    let mut bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| ApiError::bad_request(format!("读取上传内容失败：{error}")))?
    {
        match field.name().unwrap_or_default() {
            "file" => {
                let data = field
                    .bytes()
                    .await
                    .map_err(|error| ApiError::bad_request(format!("读取文件失败：{error}")))?;
                if data.len() > MAX_PACKAGE_BYTES {
                    return Err(ApiError::bad_request("资源包超过 200MB 上限"));
                }
                bytes = Some(data.to_vec());
            }
            "version" => {
                version =
                    Some(field.text().await.map_err(|error| {
                        ApiError::bad_request(format!("读取版本号失败：{error}"))
                    })?);
            }
            "changelog" => {
                changelog = field
                    .text()
                    .await
                    .map_err(|error| ApiError::bad_request(format!("读取更新说明失败：{error}")))?;
            }
            _ => {}
        }
    }

    let version = version.unwrap_or_default().trim().to_string();
    if version.is_empty() || version.chars().count() > 32 {
        return Err(ApiError::bad_request("版本号要填，且不超过 32 个字符"));
    }
    let bytes = bytes.ok_or_else(|| ApiError::bad_request("没有收到文件"))?;
    if bytes.is_empty() {
        return Err(ApiError::bad_request("文件是空的"));
    }

    // 先落临时文件再走同一套校验：和客户端用的是同一份规则
    let temp = std::env::temp_dir().join(format!("ppl-upload-{}.rwmod", Uuid::new_v4()));
    std::fs::write(&temp, &bytes)
        .map_err(|error| ApiError::internal(format!("写临时文件失败：{error}")))?;

    let meta = ppl_package::scan_path(&temp);
    let _ = std::fs::remove_file(&temp);

    let meta = meta?;
    let detected = match meta.kind {
        ppl_package::PackageKind::Mod => "mod",
        ppl_package::PackageKind::Map => "map",
        ppl_package::PackageKind::Unknown => {
            return Err(ApiError::bad_request("这个文件既不是 Mod 也不是地图包"));
        }
    };
    if detected != kind {
        return Err(ApiError::bad_request(format!(
            "这是{detected}类型的包，但这条资源登记为 {kind}"
        )));
    }

    let (file_name, sha256) = storage::save(&state.config, &slug, &version, &bytes)?;
    let url = storage::download_url(&state.config, &slug, &file_name);

    sqlx::query(
        "INSERT INTO versions
            (package_id, version, content_hash, size, urls, changelog, status, file_name, sha256)
         VALUES ($1, $2, $3, $4, ARRAY[$5], $6, 'pending', $7, $8)
         ON CONFLICT (package_id, version) DO UPDATE
         SET content_hash = EXCLUDED.content_hash,
             size = EXCLUDED.size,
             urls = EXCLUDED.urls,
             changelog = EXCLUDED.changelog,
             status = 'pending',
             file_name = EXCLUDED.file_name,
             sha256 = EXCLUDED.sha256",
    )
    .bind(id)
    .bind(&version)
    .bind(&meta.content_hash)
    .bind(meta.package_size as i64)
    .bind(&url)
    .bind(changelog.trim())
    .bind(&file_name)
    .bind(&sha256)
    .execute(&state.pool)
    .await?;

    sqlx::query("UPDATE packages SET updated_at = now() WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;

    Ok(Json(json!({
        "ok": true,
        "version": version,
        "url": url,
        "size": meta.package_size,
        "unitCount": meta.unit_count,
        "sha256": sha256,
        "status": "pending",
    })))
}

/// 提交审核。
pub async fn submit(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let _ = load_owned(&state, id, &user).await?;

    let pending: (i64,) = sqlx::query_as(
        "SELECT count(*) FROM versions WHERE package_id = $1 AND status = 'pending'",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    if pending.0 == 0 {
        return Err(ApiError::bad_request("先上传至少一个资源包，再提交审核"));
    }

    sqlx::query(
        "UPDATE packages SET status = 'pending', review_note = '', updated_at = now()
         WHERE id = $1",
    )
    .bind(id)
    .execute(&state.pool)
    .await?;

    audit(&state, Some(user.id), "submit", &id.to_string(), json!({})).await;

    Ok(Json(json!({ "ok": true, "status": "pending" })))
}

#[derive(Debug, sqlx::FromRow)]
struct MyPackageRow {
    id: Uuid,
    slug: String,
    kind: String,
    title: String,
    summary: String,
    status: String,
    review_note: String,
    version: Option<String>,
    version_status: Option<String>,
    updated: String,
}

/// 我发布的资源。
pub async fn mine(State(state): State<AppState>, user: AuthUser) -> Result<Json<Value>, ApiError> {
    let rows: Vec<MyPackageRow> = sqlx::query_as(
        "SELECT p.id, p.slug, p.kind, p.title, p.summary, p.status, p.review_note,
                v.version, v.status AS version_status,
                to_char(p.updated_at, 'YYYY-MM-DD HH24:MI') AS updated
         FROM packages p
         LEFT JOIN LATERAL (
             SELECT version, status FROM versions
             WHERE versions.package_id = p.id
             ORDER BY created_at DESC LIMIT 1
         ) v ON TRUE
         WHERE p.owner_id = $1
         ORDER BY p.updated_at DESC",
    )
    .bind(user.id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(json!({
        "items": rows.iter().map(|row| json!({
            "id": row.id,
            "slug": row.slug,
            "kind": row.kind,
            "title": row.title,
            "summary": row.summary,
            "status": row.status,
            "reviewNote": row.review_note,
            "version": row.version,
            "versionStatus": row.version_status,
            "updated": row.updated,
        })).collect::<Vec<_>>()
    })))
}

/// 取资源并确认归当前用户所有，返回（slug, kind）。
async fn load_owned(
    state: &AppState,
    id: Uuid,
    user: &AuthUser,
) -> Result<(String, String), ApiError> {
    let row: Option<(String, Option<Uuid>, String)> =
        sqlx::query_as("SELECT slug, owner_id, kind FROM packages WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?;

    let (slug, owner, kind) = row.ok_or_else(|| ApiError::not_found("没有这个资源"))?;
    match owner {
        Some(owner) if owner == user.id => Ok((slug, kind)),
        Some(_) => Err(ApiError::forbidden("这不是你发布的资源")),
        None => Err(ApiError::forbidden("这条资源没有归属，请联系管理员")),
    }
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|db| db.code())
        .is_some_and(|code| code == "23505")
}

/// 审核动作都要留痕：谁、什么时候、对哪条、做了什么。
pub async fn audit(
    state: &AppState,
    actor: Option<Uuid>,
    action: &str,
    target: &str,
    payload: Value,
) {
    if let Err(error) = sqlx::query(
        "INSERT INTO audit_log (actor_id, action, target, payload) VALUES ($1, $2, $3, $4)",
    )
    .bind(actor)
    .bind(action)
    .bind(target)
    .bind(payload)
    .execute(&state.pool)
    .await
    {
        tracing::warn!(%error, action, target, "写审计日志失败");
    }
}
