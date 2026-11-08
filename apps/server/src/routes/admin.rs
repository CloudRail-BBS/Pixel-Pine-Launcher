//! 审核侧：登录、队列、通过、驳回。
//!
//! 每个动作都写审计日志——UGC 一旦出事，「谁在什么时候放过的」是唯一能自证的东西。

use std::net::SocketAddr;

use axum::extract::{ConnectInfo, Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use super::auth::normalize_email;
use super::upload::audit;
use super::AppState;
use crate::auth::{issue_token, verify_password, AuthUser, User};
use crate::error::ApiError;

#[derive(Debug, Deserialize)]
pub struct LoginBody {
    /// 管理员邮箱。留空则用服务端配置的 `PPL_ADMIN_EMAIL`。
    #[serde(default)]
    pub email: String,
    pub password: String,
}

/// 后台登录：邮箱 + 密码，成功返回和普通用户同一种 JWT。
///
/// 为什么不用验证码：后台能下架资源、发公告，等于整站的最高权限。
/// 验证码的安全性上限是「谁能收到那个邮箱的信」，
/// 而密码可以单独换、单独限流、单独泄露追责。
pub async fn login(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<LoginBody>,
) -> Result<Json<Value>, ApiError> {
    let Some(stored) = state.config.admin_password.as_deref() else {
        // 没配密码就不开放这个入口，而不是退回验证码——
        // 否则「忘了配」会静默变成「后台没密码」
        return Err(ApiError::unavailable(
            "服务端未配置后台密码（PPL_ADMIN_PASSWORD），后台登录已停用",
        ));
    };

    let source = client_key(&headers, peer);
    if let Some(seconds) = state.login_guard.lock_remaining(&source) {
        return Err(ApiError::too_many(format!(
            "密码错误次数过多，{seconds} 秒后再试"
        )));
    }

    let raw_email = if body.email.trim().is_empty() {
        state.config.admin_email.clone().unwrap_or_default()
    } else {
        body.email.clone()
    };

    // 密码先比、再判邮箱，两条都要走完：
    // 如果「邮箱不对」可以提前返回，响应快慢本身就泄露了哪个邮箱是真的
    let password_ok = verify_password(stored, &body.password);
    let email = match (
        normalize_email(&raw_email),
        state.config.admin_email.as_deref(),
    ) {
        (Ok(email), Some(admin)) if admin.eq_ignore_ascii_case(&email) => email,
        // 没配 PPL_ADMIN_EMAIL 时，用登录时填的邮箱当管理员账号
        (Ok(email), None) => email,
        _ => String::new(),
    };

    if !password_ok || email.is_empty() {
        state.login_guard.record_failure(&source);
        audit(
            &state,
            None,
            "admin.login_failed",
            if email.is_empty() { "unknown" } else { &email },
            json!({ "source": source }),
        )
        .await;
        // 不区分「邮箱不对」和「密码不对」：那是送给爆破者的一半答案
        return Err(ApiError::unauthorized("账号或密码不对"));
    }

    state.login_guard.record_success(&source);

    let display_name = email.split('@').next().unwrap_or("admin").to_string();
    let user: User = sqlx::query_as(
        "INSERT INTO users (email, display_name, role, last_login_at)
         VALUES ($1, $2, 'admin', now())
         ON CONFLICT (email) DO UPDATE
         SET last_login_at = now(), role = 'admin'
         RETURNING id, email, display_name, role",
    )
    .bind(&email)
    .bind(&display_name)
    .fetch_one(&state.pool)
    .await?;

    audit(
        &state,
        Some(user.id),
        "admin.login",
        &email,
        json!({ "source": source }),
    )
    .await;

    let token = issue_token(&state.config, &user)?;
    tracing::info!(%email, %source, "后台登录成功");

    Ok(Json(json!({
        "token": token,
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.display_name,
            "role": user.role,
        }
    })))
}

/// 限流用的来源标识。
///
/// 线上走反向代理，`ConnectInfo` 里是 nginx 自己的地址，那样所有人共用一个
/// 计数器——既锁不住攻击者，又能把管理员锁在门外。所以优先取
/// `X-Forwarded-For` 的第一跳（最左边的客户端地址）。
fn client_key(headers: &HeaderMap, peer: SocketAddr) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| peer.ip().to_string())
}

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
