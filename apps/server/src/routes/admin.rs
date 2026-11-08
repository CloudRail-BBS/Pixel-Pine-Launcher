//! 审核侧：队列、通过、驳回。
//!
//! 每个动作都写审计日志——UGC 一旦出事，「谁在什么时候放过的」是唯一能自证的东西。

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
struct QueueRow {
    id: Uuid,
    slug: String,
    kind: String,
    title: String,
    summary: String,
    author: String,
    status: String,
    version: Option<String>,
    size: Option<i64>,
    submitted: String,
}

/// 待审队列。顺带把驳回待改的也列出来，作者能一眼看到哪些要返工。
pub async fn queue(State(state): State<AppState>, user: AuthUser) -> Result<Json<Value>, ApiError> {
    user.require_admin()?;

    let rows: Vec<QueueRow> = sqlx::query_as(
        "SELECT p.id, p.slug, p.kind, p.title, p.summary, p.author, p.status,
                v.version, v.size,
                to_char(p.updated_at, 'YYYY-MM-DD HH24:MI') AS submitted
         FROM packages p
         LEFT JOIN LATERAL (
             SELECT version, size FROM versions
             WHERE versions.package_id = p.id
             ORDER BY created_at DESC LIMIT 1
         ) v ON TRUE
         WHERE p.status IN ('pending', 'draft')
         ORDER BY p.updated_at ASC",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(json!({
        "items": rows.iter().map(|row| json!({
            "id": row.id,
            "slug": row.slug,
            "kind": row.kind,
            "title": row.title,
            "summary": row.summary,
            "author": row.author,
            "status": row.status,
            "version": row.version,
            "size": row.size,
            "submitted": row.submitted,
        })).collect::<Vec<_>>()
    })))
}

/// 通过：版本置为 approved，资源上架。
pub async fn approve(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    user.require_admin()?;

    let mut tx = state.pool.begin().await?;

    let updated = sqlx::query(
        "UPDATE versions SET status = 'approved' WHERE package_id = $1 AND status = 'pending'",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if updated == 0 {
        return Err(ApiError::bad_request("这条资源没有待审的版本"));
    }

    sqlx::query(
        "UPDATE packages
         SET status = 'published', published_at = now(), review_note = '', updated_at = now()
         WHERE id = $1",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    audit(
        &state,
        Some(user.id),
        "approve",
        &id.to_string(),
        json!({ "versions": updated }),
    )
    .await;

    Ok(Json(json!({ "ok": true, "status": "published" })))
}

#[derive(Debug, Deserialize)]
pub struct RejectBody {
    #[serde(default)]
    pub note: String,
}

/// 驳回：版本置为 rejected，资源状态回 rejected 并带上原因。
pub async fn reject(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<RejectBody>,
) -> Result<Json<Value>, ApiError> {
    user.require_admin()?;

    let note = body.note.trim();
    if note.is_empty() {
        return Err(ApiError::bad_request("驳回必须写原因，作者才知道怎么改"));
    }
    if note.chars().count() > 300 {
        return Err(ApiError::bad_request("驳回原因不超过 300 个字"));
    }

    let mut tx = state.pool.begin().await?;

    let updated = sqlx::query(
        "UPDATE versions SET status = 'rejected' WHERE package_id = $1 AND status = 'pending'",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if updated == 0 {
        return Err(ApiError::bad_request("这条资源没有待审的版本"));
    }

    sqlx::query(
        "UPDATE packages SET status = 'rejected', review_note = $2, updated_at = now()
         WHERE id = $1",
    )
    .bind(id)
    .bind(note)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    audit(
        &state,
        Some(user.id),
        "reject",
        &id.to_string(),
        json!({ "note": note }),
    )
    .await;

    Ok(Json(json!({ "ok": true, "status": "rejected" })))
}

#[derive(Debug, sqlx::FromRow)]
struct ReportRow {
    id: i64,
    reason: String,
    contact: String,
    created: String,
    package_id: Uuid,
    slug: String,
    title: String,
    kind: String,
    package_status: String,
}

/// 待处理举报。
pub async fn reports(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Value>, ApiError> {
    user.require_admin()?;

    let rows: Vec<ReportRow> = sqlx::query_as(
        "SELECT r.id, r.reason, r.contact,
                to_char(r.created_at, 'YYYY-MM-DD HH24:MI') AS created,
                p.id AS package_id, p.slug, p.title, p.kind, p.status AS package_status
         FROM reports r
         JOIN packages p ON p.id = r.package_id
         WHERE r.status = 'open'
         ORDER BY r.created_at DESC
         LIMIT 200",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(json!({
        "items": rows.iter().map(|row| json!({
            "id": row.id,
            "reason": row.reason,
            "contact": row.contact,
            "created": row.created,
            "packageId": row.package_id,
            "slug": row.slug,
            "title": row.title,
            "kind": row.kind,
            "packageStatus": row.package_status,
        })).collect::<Vec<_>>()
    })))
}

#[derive(Debug, Deserialize)]
pub struct HandleBody {
    /// `dismissed` 忽略，`handled` 已处理（通常伴随下架）
    pub action: String,
    #[serde(default)]
    pub note: String,
}

/// 处理一条举报。只改举报状态，不动资源——下架是另一个动作。
pub async fn handle_report(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
    Json(body): Json<HandleBody>,
) -> Result<Json<Value>, ApiError> {
    user.require_admin()?;

    let action = body.action.trim();
    if action != "dismissed" && action != "handled" {
        return Err(ApiError::bad_request("action 只能是 dismissed 或 handled"));
    }

    let updated = sqlx::query(
        "UPDATE reports SET status = $2, handled_at = now() WHERE id = $1 AND status = 'open'",
    )
    .bind(id)
    .bind(action)
    .execute(&state.pool)
    .await?
    .rows_affected();

    if updated == 0 {
        return Err(ApiError::not_found("这条举报不存在或已处理"));
    }

    audit(
        &state,
        Some(user.id),
        &format!("report_{action}"),
        &id.to_string(),
        json!({ "note": body.note.trim() }),
    )
    .await;

    Ok(Json(json!({ "ok": true, "status": action })))
}

#[derive(Debug, Deserialize)]
pub struct TakedownBody {
    #[serde(default)]
    pub note: String,
}

/// 下架：资源状态转 takendown，已过审的版本一并转 rejected。
/// 公开列表只查 published，所以这一步之后市场里立刻看不到。
pub async fn takedown(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<TakedownBody>,
) -> Result<Json<Value>, ApiError> {
    user.require_admin()?;

    let note = body.note.trim();
    if note.is_empty() {
        return Err(ApiError::bad_request("下架要写原因，作者才有申诉依据"));
    }

    let mut tx = state.pool.begin().await?;

    let updated = sqlx::query(
        "UPDATE packages SET status = 'takendown', review_note = $2, updated_at = now()
         WHERE id = $1 AND status = 'published'",
    )
    .bind(id)
    .bind(note)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if updated == 0 {
        return Err(ApiError::bad_request("只有已上架的资源可以下架"));
    }

    sqlx::query(
        "UPDATE versions SET status = 'rejected' WHERE package_id = $1 AND status = 'approved'",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    audit(
        &state,
        Some(user.id),
        "takedown",
        &id.to_string(),
        json!({ "note": note }),
    )
    .await;

    Ok(Json(json!({ "ok": true, "status": "takendown" })))
}
