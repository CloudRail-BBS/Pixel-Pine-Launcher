//! 公告：公开读取 + 管理员发布/删除。
//!
//! 客户端只在首屏拉一次，不做轮询——公告不是实时数据，
//! 为它保持一条长连接不值得。

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use super::upload::audit;
use super::AppState;
use crate::auth::AuthUser;
use crate::error::ApiError;

#[derive(Debug, sqlx::FromRow)]
struct AnnouncementRow {
    id: Uuid,
    title: String,
    body: String,
    level: String,
    pinned: bool,
    published: String,
}

fn to_json(row: &AnnouncementRow) -> Value {
    json!({
        "id": row.id,
        "title": row.title,
        "body": row.body,
        "level": row.level,
        "pinned": row.pinned,
        "published": row.published,
    })
}

/// 公开列表：只返回未过期的。
pub async fn list(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let rows: Vec<AnnouncementRow> = sqlx::query_as(
        "SELECT id, title, body, level, pinned,
                to_char(published_at, 'YYYY-MM-DD') AS published
         FROM announcements
         WHERE expires_at IS NULL OR expires_at > now()
         ORDER BY pinned DESC, published_at DESC
         LIMIT 20",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(json!({
        "items": rows.iter().map(to_json).collect::<Vec<_>>()
    })))
}

/// 管理员视图：连过期的也列出来，否则发错了都看不见。
pub async fn admin_list(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Value>, ApiError> {
    user.require_admin()?;

    let rows: Vec<AnnouncementRow> = sqlx::query_as(
        "SELECT id, title, body, level, pinned,
                to_char(published_at, 'YYYY-MM-DD') AS published
         FROM announcements
         ORDER BY published_at DESC
         LIMIT 50",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(json!({
        "items": rows.iter().map(to_json).collect::<Vec<_>>()
    })))
}

#[derive(Debug, Deserialize)]
pub struct NewAnnouncement {
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub level: String,
    #[serde(default)]
    pub pinned: bool,
    /// 有效期（小时）。0 或省略表示长期有效。
    #[serde(default)]
    pub hours: i64,
}

pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<NewAnnouncement>,
) -> Result<Json<Value>, ApiError> {
    user.require_admin()?;

    let title = body.title.trim();
    let text = body.body.trim();
    if title.is_empty() || text.is_empty() {
        return Err(ApiError::bad_request("标题和正文都要填"));
    }
    if title.chars().count() > 80 {
        return Err(ApiError::bad_request("标题不要超过 80 个字"));
    }
    if text.chars().count() > 4000 {
        return Err(ApiError::bad_request("正文不要超过 4000 个字"));
    }

    let level = if body.level.trim() == "important" {
        "important"
    } else {
        "info"
    };

    // hours <= 0 视为长期有效（NULL）
    let expires = if body.hours > 0 {
        Some(body.hours)
    } else {
        None
    };

    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO announcements (title, body, level, pinned, expires_at, created_by)
         VALUES ($1, $2, $3, $4,
                 CASE WHEN $5::bigint IS NULL THEN NULL
                      ELSE now() + ($5::bigint || ' hours')::interval END,
                 $6)
         RETURNING id",
    )
    .bind(title)
    .bind(text)
    .bind(level)
    .bind(body.pinned)
    .bind(expires)
    .bind(&user.email)
    .fetch_one(&state.pool)
    .await?;

    audit(
        &state,
        Some(user.id),
        "announcement_create",
        &id.to_string(),
        json!({ "title": title, "level": level, "pinned": body.pinned }),
    )
    .await;

    Ok(Json(json!({ "ok": true, "id": id })))
}

pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    user.require_admin()?;

    let removed = sqlx::query("DELETE FROM announcements WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?
        .rows_affected();

    if removed == 0 {
        return Err(ApiError::not_found("没有这条公告"));
    }

    audit(
        &state,
        Some(user.id),
        "announcement_delete",
        &id.to_string(),
        json!({}),
    )
    .await;

    Ok(Json(json!({ "ok": true })))
}
