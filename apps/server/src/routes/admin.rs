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
