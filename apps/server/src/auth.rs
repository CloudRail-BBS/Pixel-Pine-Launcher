//! 身份：JWT 签发与请求提取。
//!
//! 不做密码、不做第三方登录，只认邮箱验证码。角色放在 token 里，
//! 换来的是每个请求省一次查库；代价是改角色后要等 token 过期，
//! 对这个规模的社区市场可以接受。

use axum::extract::FromRequestParts;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::config::Config;
use crate::error::ApiError;
use crate::routes::AppState;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub role: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    /// 用户 id
    pub sub: String,
    pub email: String,
    pub role: String,
    /// 过期时间（秒级时间戳）
    pub exp: i64,
}

pub fn issue_token(config: &Config, user: &User) -> Result<String, ApiError> {
    let exp = now_ts() + config.jwt_ttl_hours * 3600;
    let claims = Claims {
        sub: user.id.to_string(),
        email: user.email.clone(),
        role: user.role.clone(),
        exp,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|error| ApiError::internal(format!("签发 token 失败：{error}")))
}

/// 已认证的调用方。
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: Uuid,
    pub email: String,
    pub role: String,
}

impl AuthUser {
    pub fn is_admin(&self) -> bool {
        self.role == "admin"
    }

    /// 审核类操作统一挡在这里，别在每个 handler 里各写一遍。
    pub fn require_admin(&self) -> Result<(), ApiError> {
        if self.is_admin() {
            Ok(())
        } else {
            Err(ApiError::forbidden("需要审核权限"))
        }
    }
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| ApiError::unauthorized("缺少登录凭证"))?;

        let token = header
            .strip_prefix("Bearer ")
            .or_else(|| header.strip_prefix("bearer "))
            .ok_or_else(|| ApiError::unauthorized("登录凭证格式不对"))?
            .trim();

        let data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(state.config.jwt_secret.as_bytes()),
            &Validation::default(),
        )
        .map_err(|error| match error.kind() {
            jsonwebtoken::errors::ErrorKind::ExpiredSignature => {
                ApiError::unauthorized("登录已过期，请重新验证邮箱")
            }
            _ => ApiError::unauthorized("登录凭证无效"),
        })?;

        let id = Uuid::parse_str(&data.claims.sub)
            .map_err(|_| ApiError::unauthorized("登录凭证无效"))?;

        Ok(Self {
            id,
            email: data.claims.email,
            role: data.claims.role,
        })
    }
}

pub fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}
