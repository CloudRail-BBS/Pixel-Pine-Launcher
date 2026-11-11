//! 管理控制台：概览、资源管理、审计。
//!
//! 和 `admin.rs` 的分工：
//! - `admin.rs` 是**审核**流程（队列、通过、驳回、下架、举报处理）
//! - 这里是**运营**视角（全站读数、任意状态的资源、恢复上架、彻底删除、审计）
//!
//! 两者都要求 `role = admin`，鉴权统一走 [`AuthUser::require_admin`]。

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use super::upload::audit;
use super::AppState;
use crate::auth::AuthUser;
use crate::error::ApiError;

/* ---------- 概览 ---------- */

/// `GET /v1/admin/stats` —— 概览读数 + 最近动作。
///
/// 后台第一屏要回答「现在有没有活要干」，所以待审、待处理举报摆在前面，
/// 总量与下载量当背景信息。
pub async fn stats(State(state): State<AppState>, user: AuthUser) -> Result<Json<Value>, ApiError> {
    user.require_admin()?;

    let by_status: Vec<(String, i64)> =
        sqlx::query_as("SELECT status, count(*) FROM packages GROUP BY status")
            .fetch_all(&state.pool)
            .await?;
    let mut counts = serde_json::Map::new();
    for (status, count) in by_status {
        counts.insert(status, json!(count));
    }

    let pending_versions: i64 =
        sqlx::query_scalar("SELECT count(*) FROM versions WHERE status = 'pending'")
            .fetch_one(&state.pool)
            .await?;
    let open_reports: i64 =
        sqlx::query_scalar("SELECT count(*) FROM reports WHERE status = 'open'")
            .fetch_one(&state.pool)
            .await?;
    let live_announcements: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM announcements WHERE expires_at IS NULL OR expires_at > now()",
    )
    .fetch_one(&state.pool)
    .await?;
    // 必须显式转 ::bigint。Postgres 的 sum(bigint) 返回 numeric，
    // sqlx 不会替你转成 i64，解码阶段直接报 ColumnDecode，
    // 对外就是一句「服务端出错了」——排查时完全看不出是这条 SQL。
    let downloads: i64 =
        sqlx::query_scalar("SELECT coalesce(sum(download_count), 0)::bigint FROM versions")
            .fetch_one(&state.pool)
            .await?;
    let users: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(json!({
        "packages": counts,
        "pendingVersions": pending_versions,
        "openReports": open_reports,
        "announcements": live_announcements,
        "downloads": downloads,
        "users": users,
        "recent": recent_audit(&state, 10).await?,
    })))
}

/// 最近的审计动作。概览与「审计」视图共用。
async fn recent_audit(state: &AppState, limit: i64) -> Result<Value, ApiError> {
    #[derive(sqlx::FromRow)]
    struct AuditRow {
        action: String,
        target: String,
        payload: Value,
        created: String,
        actor: Option<String>,
    }

    let rows: Vec<AuditRow> = sqlx::query_as(
        "SELECT a.action, a.target, a.payload,
                to_char(a.created_at, 'MM-DD HH24:MI') AS created,
                u.email AS actor
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
         ORDER BY a.id DESC
         LIMIT $1",
    )
    .bind(limit.clamp(1, 200))
    .fetch_all(&state.pool)
    .await?;

    Ok(json!(rows
        .into_iter()
        .map(|row| json!({
            "action": row.action,
            "target": row.target,
            "payload": row.payload,
            "created": row.created,
            "actor": row.actor,
        }))
        .collect::<Vec<_>>()))
}

#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    pub limit: Option<i64>,
}

/// `GET /v1/admin/audit`
pub async fn audit_list(
    State(state): State<AppState>,
    user: AuthUser,
    Query(query): Query<AuditQuery>,
) -> Result<Json<Value>, ApiError> {
    user.require_admin()?;
    Ok(Json(json!({
        "items": recent_audit(&state, query.limit.unwrap_or(60)).await?,
    })))
}

/* ---------- 资源管理 ---------- */

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub status: Option<String>,
    pub kind: Option<String>,
    pub q: Option<String>,
    pub page: Option<i64>,
    pub size: Option<i64>,
}

#[derive(Debug, sqlx::FromRow)]
struct PackageRow {
    id: Uuid,
    slug: String,
    kind: String,
    title: String,
    summary: String,
    author: String,
    status: String,
    review_note: String,
    updated: String,
    version: Option<String>,
    size: Option<i64>,
    download_count: Option<i64>,
    version_count: i64,
}

/// `GET /v1/admin/packages` —— 全量资源（不限状态），带搜索、筛选与分页。
pub async fn packages(
    State(state): State<AppState>,
    user: AuthUser,
    Query(query): Query<ListQuery>,
) -> Result<Json<Value>, ApiError> {
    user.require_admin()?;

    let page = query.page.unwrap_or(1).max(1);
    let size = query.size.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * size;
    let status = query.status.filter(|value| !value.is_empty());
    let kind = query.kind.filter(|value| !value.is_empty());
    let keyword = query
        .q
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let rows: Vec<PackageRow> = sqlx::query_as(
        "SELECT p.id, p.slug, p.kind, p.title, p.summary, p.author, p.status, p.review_note,
                to_char(p.updated_at, 'YYYY-MM-DD HH24:MI') AS updated,
                v.version, v.size, v.download_count,
                (SELECT count(*) FROM versions WHERE versions.package_id = p.id) AS version_count
         FROM packages p
         LEFT JOIN LATERAL (
             SELECT version, size, download_count FROM versions
             WHERE versions.package_id = p.id
             ORDER BY created_at DESC LIMIT 1
         ) v ON TRUE
         WHERE ($1::text IS NULL OR p.status = $1)
           AND ($2::text IS NULL OR p.kind = $2)
           AND ($3::text IS NULL OR p.title ILIKE '%' || $3 || '%'
                OR p.slug ILIKE '%' || $3 || '%' OR p.author ILIKE '%' || $3 || '%')
         ORDER BY p.updated_at DESC
         LIMIT $4 OFFSET $5",
    )
    .bind(status.as_deref())
    .bind(kind.as_deref())
    .bind(keyword.as_deref())
    .bind(size)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    let total: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM packages p
         WHERE ($1::text IS NULL OR p.status = $1)
           AND ($2::text IS NULL OR p.kind = $2)
           AND ($3::text IS NULL OR p.title ILIKE '%' || $3 || '%'
                OR p.slug ILIKE '%' || $3 || '%' OR p.author ILIKE '%' || $3 || '%')",
    )
    .bind(status.as_deref())
    .bind(kind.as_deref())
    .bind(keyword.as_deref())
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(json!({
        "items": rows.into_iter().map(|row| json!({
            "id": row.id,
            "slug": row.slug,
            "kind": row.kind,
            "title": row.title,
            "summary": row.summary,
            "author": row.author,
            "status": row.status,
            "reviewNote": row.review_note,
            "updated": row.updated,
            "version": row.version,
            "size": row.size,
            "downloads": row.download_count.unwrap_or(0),
            "versionCount": row.version_count,
        })).collect::<Vec<_>>(),
        "page": page,
        "pageSize": size,
        "total": total,
    })))
}

/// `GET /v1/admin/packages/{id}` —— 资源详情 + 全部版本（含未过审的）。
pub async fn package_detail(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    user.require_admin()?;

    #[derive(sqlx::FromRow)]
    struct Row {
        id: Uuid,
        slug: String,
        kind: String,
        title: String,
        summary: String,
        author: String,
        status: String,
        review_note: String,
        cover: Option<String>,
        owner: Option<String>,
        created: String,
        updated: String,
    }

    let row: Option<Row> = sqlx::query_as(
        "SELECT p.id, p.slug, p.kind, p.title, p.summary, p.author, p.status, p.review_note,
                p.cover, u.email AS owner,
                to_char(p.created_at, 'YYYY-MM-DD HH24:MI') AS created,
                to_char(p.updated_at, 'YYYY-MM-DD HH24:MI') AS updated
         FROM packages p
         LEFT JOIN users u ON u.id = p.owner_id
         WHERE p.id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?;

    let Some(row) = row else {
        return Err(ApiError::not_found("找不到这条资源"));
    };

    #[derive(sqlx::FromRow)]
    struct VersionRow {
        version: String,
        status: String,
        size: i64,
        download_count: i64,
        sha256: String,
        file_name: String,
        urls: Vec<String>,
        changelog: String,
        created: String,
    }

    let versions: Vec<VersionRow> = sqlx::query_as(
        "SELECT version, status, size, download_count, sha256, file_name, urls, changelog,
                to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created
         FROM versions WHERE package_id = $1 ORDER BY created_at DESC",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(json!({
        "id": row.id,
        "slug": row.slug,
        "kind": row.kind,
        "title": row.title,
        "summary": row.summary,
        "author": row.author,
        "status": row.status,
        "reviewNote": row.review_note,
        "cover": row.cover,
        "owner": row.owner,
        "created": row.created,
        "updated": row.updated,
        "versions": versions.into_iter().map(|item| json!({
            "version": item.version,
            "status": item.status,
            "size": item.size,
            "downloads": item.download_count,
            "sha256": item.sha256,
            "fileName": item.file_name,
            "urls": item.urls,
            "changelog": item.changelog,
            "created": item.created,
        })).collect::<Vec<_>>(),
    })))
}

/// `POST /v1/admin/packages/{id}/restore` —— 把下架/驳回的资源重新上架。
pub async fn restore(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    user.require_admin()?;

    let mut tx = state.pool.begin().await?;

    let updated = sqlx::query(
        "UPDATE packages SET status = 'published', published_at = now(), review_note = '',
                updated_at = now()
         WHERE id = $1 AND status IN ('takendown', 'rejected')",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if updated == 0 {
        return Err(ApiError::bad_request("只有已下架或已驳回的资源可以恢复"));
    }

    // 下架时把已过审版本一并转成了 rejected，恢复要一起还原，
    // 否则资源重新上架却没有任何可下载版本
    sqlx::query(
        "UPDATE versions SET status = 'approved' WHERE package_id = $1 AND status = 'rejected'",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    audit(&state, Some(user.id), "restore", &id.to_string(), json!({})).await;

    Ok(Json(json!({ "ok": true, "status": "published" })))
}

/// `DELETE /v1/admin/packages/{id}` —— 彻底删除资源（含磁盘上的包）。
///
/// 和「下架」是两件事：下架留档可恢复，删除不可逆。
/// 先删库再删文件——反过来的话文件没了、记录还在，会留下永远打不开的资源。
pub async fn delete_package(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    user.require_admin()?;

    let slug: Option<String> = sqlx::query_scalar("SELECT slug FROM packages WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    let Some(slug) = slug else {
        return Err(ApiError::not_found("找不到这条资源"));
    };

    sqlx::query("DELETE FROM packages WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;

    let dir = state
        .config
        .storage_dir
        .join(crate::storage::safe_segment(&slug));
    if dir.is_dir() {
        if let Err(error) = tokio::fs::remove_dir_all(&dir).await {
            // 记录已经删了；文件删不掉只报警，不让接口失败
            tracing::warn!(%error, dir = %dir.display(), "删除资源目录失败");
        }
    }

    audit(
        &state,
        Some(user.id),
        "package_delete",
        &id.to_string(),
        json!({ "slug": slug }),
    )
    .await;

    Ok(Json(json!({ "ok": true })))
}
