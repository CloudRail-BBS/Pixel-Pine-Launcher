//! 邮箱验证码登录。没有密码，邮箱不存在就自动注册。

use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::AppState;
use crate::auth::{issue_token, AuthUser, User};
use crate::config::random_hex;
use crate::error::ApiError;
use crate::mail::{send_code, verify_geetest, GeetestParams};

#[derive(Debug, Deserialize)]
pub struct RequestCodeBody {
    pub email: String,
    /// 配了 Geetest 就必须带上
    #[serde(default)]
    pub geetest: Option<GeetestParams>,
}

#[derive(Debug, Deserialize)]
pub struct VerifyBody {
    pub email: String,
    pub code: String,
}

/// 公开的认证配置：前端据此决定要不要加载人机验证。
/// 只暴露 captcha_id（本来就是公开的），私钥永远不出服务端。
pub async fn config(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "geetestId": state.config.geetest_id,
        "devMode": state.config.dev_mode,
    }))
}

/// 申请验证码。
pub async fn request_code(
    State(state): State<AppState>,
    Json(body): Json<RequestCodeBody>,
) -> Result<Json<Value>, ApiError> {
    let email = normalize_email(&body.email)?;

    // 先过人机验证，再消耗任何服务端资源
    if state.config.geetest_ready() {
        let params = body
            .geetest
            .as_ref()
            .ok_or_else(|| ApiError::bad_request("请先完成人机验证"))?;
        verify_geetest(&state.config, params).await?;
    }

    // 同邮箱 60 秒一条、每天 5 条
    let recent: Option<(i64,)> = sqlx::query_as(
        "SELECT EXTRACT(EPOCH FROM (now() - created_at))::bigint
         FROM email_codes WHERE email = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;

    if let Some((seconds,)) = recent {
        if seconds < 60 {
            return Err(ApiError::too_many(format!(
                "{} 秒后可以再发一次",
                60 - seconds
            )));
        }
    }

    let daily: (i64,) = sqlx::query_as(
        "SELECT count(*) FROM email_codes WHERE email = $1 AND created_at > now() - interval '1 day'",
    )
    .bind(&email)
    .fetch_one(&state.pool)
    .await?;
    if daily.0 >= 5 {
        return Err(ApiError::too_many("今天发送次数已用完，明天再试"));
    }

    let code = six_digit_code();
    let code_hash = hash_code(&state.config.jwt_secret, &email, &code);

    sqlx::query(
        "INSERT INTO email_codes (email, code_hash, expires_at)
         VALUES ($1, $2, now() + interval '10 minutes')",
    )
    .bind(&email)
    .bind(&code_hash)
    .execute(&state.pool)
    .await?;

    // 邮件失败不吞掉：用户会一直等一封不来的信
    match send_code(&state.config, &email, &code).await {
        Ok(()) => {
            tracing::info!(%email, "验证码已发送");
            Ok(Json(json!({ "ok": true, "delivery": "email" })))
        }
        Err(error) => {
            tracing::warn!(%email, %error, "验证码邮件发送失败");
            if state.config.dev_mode {
                // 开发模式没配 SMTP 也要能走通流程
                Ok(Json(json!({
                    "ok": true,
                    "delivery": "dev",
                    "devCode": code,
                })))
            } else {
                Err(ApiError::unavailable(
                    "验证码邮件暂时发不出去，请稍后重试或联系管理员",
                ))
            }
        }
    }
}

/// 校验验证码，成功返回 JWT。
pub async fn verify_code(
    State(state): State<AppState>,
    Json(body): Json<VerifyBody>,
) -> Result<Json<Value>, ApiError> {
    let email = normalize_email(&body.email)?;
    let code = body.code.trim();
    if code.len() != 6 || !code.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(ApiError::bad_request("验证码是 6 位数字"));
    }

    let row: Option<(i64, String, i32)> = sqlx::query_as(
        "SELECT id, code_hash, attempts FROM email_codes
         WHERE email = $1 AND consumed = false AND expires_at > now()
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;

    let Some((id, stored_hash, attempts)) = row else {
        return Err(ApiError::bad_request("验证码已过期，请重新获取"));
    };

    if attempts >= 5 {
        return Err(ApiError::too_many("验证次数过多，请重新获取验证码"));
    }

    if hash_code(&state.config.jwt_secret, &email, code) != stored_hash {
        sqlx::query("UPDATE email_codes SET attempts = attempts + 1 WHERE id = $1")
            .bind(id)
            .execute(&state.pool)
            .await?;
        return Err(ApiError::bad_request("验证码不对"));
    }

    sqlx::query("UPDATE email_codes SET consumed = true WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;

    // 邮箱没出现过就自动注册；首个管理员在登录时提权。
    //
    // 但配了后台密码之后就不再提权：否则「能收到这个邮箱的信」等于绕过密码，
    // 密码登录就白做了。这时候管理员只能走 /v1/admin/login。
    let promote_admin = state.config.admin_password.is_none();
    let is_admin_email = promote_admin
        && state
            .config
            .admin_email
            .as_deref()
            .is_some_and(|admin| admin.eq_ignore_ascii_case(&email));
    let display_name = email.split('@').next().unwrap_or(&email).to_string();

    let user: User = sqlx::query_as(
        "INSERT INTO users (email, display_name, role, last_login_at)
         VALUES ($1, $2, CASE WHEN $3 THEN 'admin' ELSE 'user' END, now())
         ON CONFLICT (email) DO UPDATE
         SET last_login_at = now(),
             role = CASE WHEN $3 THEN 'admin' ELSE users.role END
         RETURNING id, email, display_name, role",
    )
    .bind(&email)
    .bind(&display_name)
    .bind(is_admin_email)
    .fetch_one(&state.pool)
    .await?;

    // 配了后台密码之后，验证码登录发出去的 token 不带管理员角色：
    // 否则「能收到这个邮箱的信」就绕过了密码，密码登录等于白做。
    // 数据库里的角色不动——管理员改用密码登录时再拿回权限，
    // 客户端该有的作者功能也不受影响。
    let role = if state.config.admin_password.is_some() && user.role == "admin" {
        "user".to_string()
    } else {
        user.role.clone()
    };
    let effective = User {
        role: role.clone(),
        ..user.clone()
    };
    let token = issue_token(&state.config, &effective)?;

    Ok(Json(json!({
        "token": token,
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.display_name,
            "role": role,
        }
    })))
}

/// 当前登录用户。前端刷新页面后用它确认 token 还有效。
pub async fn me(user: AuthUser) -> Json<Value> {
    Json(json!({
        "id": user.id,
        "email": user.email,
        "role": user.role,
    }))
}

pub(crate) fn normalize_email(raw: &str) -> Result<String, ApiError> {
    let email = raw.trim().to_lowercase();
    let valid = email.len() >= 5
        && email.len() <= 254
        && email.matches('@').count() == 1
        && email
            .split('@')
            .all(|part| !part.is_empty() && !part.contains(char::is_whitespace))
        && email
            .rsplit('@')
            .next()
            .is_some_and(|domain| domain.contains('.'));
    if !valid {
        return Err(ApiError::bad_request("邮箱格式不对"));
    }
    Ok(email)
}

/// 不引 rand：uuid v4 本身就是 122 位随机，取模够用。
fn six_digit_code() -> String {
    let bytes = uuid::Uuid::new_v4();
    let value = u32::from_le_bytes([
        bytes.as_bytes()[0],
        bytes.as_bytes()[1],
        bytes.as_bytes()[2],
        bytes.as_bytes()[3],
    ]) % 1_000_000;
    // 混一点启动随机量，避免同一毫秒内的可预测性
    let salt = random_hex(2);
    let extra = u32::from_str_radix(&salt, 16).unwrap_or(0) % 1000;
    format!("{:06}", (value + extra) % 1_000_000)
}

fn hash_code(secret: &str, email: &str, code: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.update(b":");
    hasher.update(email.as_bytes());
    hasher.update(b":");
    hasher.update(code.as_bytes());
    hex::encode(hasher.finalize())
}
