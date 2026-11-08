//! 身份：JWT 签发与请求提取。
//!
//! 普通用户只认邮箱验证码（社区用户不该被迫记密码），
//! 审核后台走**密码**——后台能下架资源、发公告，权限比普通账号重得多，
//! 不该和「能收某个邮箱的验证码」绑在一起。
//!
//! 角色放在 token 里，换来的是每个请求省一次查库；代价是改角色后要等 token
//! 过期，对这个规模的社区市场可以接受。

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::FromRequestParts;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use hmac::{Hmac, KeyInit, Mac};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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

/* ---------- 后台密码 ---------- */

/// 校验后台密码。
///
/// 支持两种存法：
/// - `pbkdf2-sha256:<迭代次数>:<salt hex>:<hash hex>`：推荐。
///   配置文件泄露时拿到的是哈希而不是密码，也没法反推出用户复用的那一个。
/// - 明文：只适合「密码就写在自己的 `.env` 里、机器只有自己用」的小部署。
///
/// 迭代次数是自描述的，以后调高不会让旧哈希失效。
///
/// 分隔符用 `:` 而不是 PHC 惯用的 `$`：这个值要经过 `.env`、docker-compose
/// 和 shell 三层，`$` 在其中任何一层都可能被当成变量展开，配一次错一次。
pub fn verify_password(stored: &str, given: &str) -> bool {
    let Some(rest) = stored.strip_prefix("pbkdf2-sha256:") else {
        // 明文：先各自哈希再比，比较过程不随内容提前返回
        let expected = Sha256::digest(stored.as_bytes());
        let actual = Sha256::digest(given.as_bytes());
        return constant_time_eq(&expected, &actual);
    };

    let mut parts = rest.split(':');
    let (Some(iterations), Some(salt), Some(expected)) = (parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    let Ok(iterations) = iterations.parse::<u32>() else {
        return false;
    };
    let (Ok(salt), Ok(expected)) = (hex::decode(salt), hex::decode(expected)) else {
        return false;
    };
    // 迭代次数为 0 或者哈希为空，说明配置本身写坏了。
    // 这里必须拒绝而不是「用默认值兜底」——否则一个手滑的配置会变成无密码可登录。
    if iterations == 0 || expected.is_empty() || salt.is_empty() {
        return false;
    }

    let actual = pbkdf2_sha256(given.as_bytes(), &salt, iterations, expected.len());
    constant_time_eq(&actual, &expected)
}

/// PBKDF2-HMAC-SHA256。
///
/// 用 hmac + sha2 手写而不是引 `pbkdf2` crate：只有这二十行，
/// 少一个依赖就少一份要在审计里解释的东西。
fn pbkdf2_sha256(password: &[u8], salt: &[u8], iterations: u32, len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(len + 32);
    let mut block: u32 = 1;

    while out.len() < len {
        let mut mac = Hmac::<Sha256>::new_from_slice(password).expect("HMAC 接受任意长度密钥");
        mac.update(salt);
        mac.update(&block.to_be_bytes());
        let mut u = mac.finalize().into_bytes();
        let mut acc = u;

        for _ in 1..iterations {
            let mut mac = Hmac::<Sha256>::new_from_slice(password).expect("HMAC 接受任意长度密钥");
            mac.update(&u);
            u = mac.finalize().into_bytes();
            for (slot, byte) in acc.iter_mut().zip(u.iter()) {
                *slot ^= byte;
            }
        }

        out.extend_from_slice(&acc);
        block += 1;
    }

    out.truncate(len);
    out
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in left.iter().zip(right.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

/// 后台登录失败计数。
///
/// 放在内存里：单实例部署够用，重启即清空（攻击者拿不到重启时机，收益有限）。
/// 多实例部署时每个实例各算各的，等于把次数放大 N 倍——真要抗这个，
/// 得把计数落到 Redis 或数据库，目前这个规模的社区市场不值得。
pub struct LoginGuard {
    entries: Mutex<HashMap<String, Attempts>>,
}

/// 同一来源连续失败这么多次就锁一段时间。
const MAX_FAILURES: u32 = 5;
/// 锁定时长。
const LOCK_FOR: Duration = Duration::from_secs(15 * 60);
/// 条目上限。超出就清掉已经解锁的旧条目，避免被随机 IP 打爆内存。
const MAX_ENTRIES: usize = 4096;

#[derive(Default, Clone, Copy)]
struct Attempts {
    failures: u32,
    locked_until: Option<Instant>,
}

impl Default for LoginGuard {
    fn default() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
        }
    }
}

impl LoginGuard {
    /// 还被锁着就返回剩余秒数。
    pub fn lock_remaining(&self, key: &str) -> Option<u64> {
        let mut entries = self.lock();
        let entry = entries.get_mut(key)?;
        match entry.locked_until {
            Some(until) if until > Instant::now() => {
                Some(until.duration_since(Instant::now()).as_secs().max(1))
            }
            Some(_) => {
                // 锁过期了，从头开始算
                entries.remove(key);
                None
            }
            None => None,
        }
    }

    /// 记一次失败，够了就上锁。
    pub fn record_failure(&self, key: &str) {
        let mut entries = self.lock();
        if entries.len() >= MAX_ENTRIES {
            let stale = entries
                .iter()
                .find(|(_, entry)| entry.locked_until.is_none())
                .map(|(key, _)| key.clone());
            if let Some(stale) = stale {
                entries.remove(&stale);
            }
        }

        let entry = entries.entry(key.to_string()).or_default();
        entry.failures += 1;
        if entry.failures >= MAX_FAILURES {
            entry.failures = 0;
            entry.locked_until = Some(Instant::now() + LOCK_FOR);
        }
    }

    /// 登录成功，把这个来源的失败记录抹掉。
    pub fn record_success(&self, key: &str) {
        self.lock().remove(key);
    }

    /// 锁中毒了也要能用：登录入口不该因为一次 panic 变成永久 500。
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Attempts>> {
        self.entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PBKDF2-HMAC-SHA256 的标准测试向量（P="password", S="salt", dkLen=32）。
    /// 手写的实现最容易在「第一块和后续块拼接」上出错，这里钉住。
    #[test]
    fn pbkdf2_matches_known_vectors() {
        let one = pbkdf2_sha256(b"password", b"salt", 1, 32);
        assert_eq!(
            hex::encode(one),
            "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b"
        );

        let two = pbkdf2_sha256(b"password", b"salt", 2, 32);
        assert_eq!(
            hex::encode(two),
            "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43"
        );
    }

    #[test]
    fn accepts_plaintext_password() {
        assert!(verify_password("correct horse", "correct horse"));
        assert!(!verify_password("correct horse", "correct horsE"));
        assert!(!verify_password("correct horse", ""));
    }

    #[test]
    fn accepts_pbkdf2_hash() {
        let hash = pbkdf2_sha256(b"hunter2", b"0123456789abcdef", 1000, 32);
        let stored = format!(
            "pbkdf2-sha256:1000:{}:{}",
            hex::encode(b"0123456789abcdef"),
            hex::encode(hash)
        );

        assert!(verify_password(&stored, "hunter2"));
        assert!(!verify_password(&stored, "hunter3"));
        assert!(!verify_password(&stored, ""));
    }

    /// 写坏的哈希必须拒绝：宁可登不进去，也不能变成「任何密码都行」。
    #[test]
    fn rejects_broken_hash_config() {
        for broken in [
            "pbkdf2-sha256:",
            "pbkdf2-sha256:1000:",
            "pbkdf2-sha256:0:aa:bb",
            "pbkdf2-sha256:abc:aa:bb",
            "pbkdf2-sha256:1000:zz:bb",
            "pbkdf2-sha256:1000::",
        ] {
            assert!(!verify_password(broken, "anything"), "不该通过：{broken}");
        }
    }

    /// 签发 + 解析一轮。
    ///
    /// 这条路径以前会在 jsonwebtoken 找不到 CryptoProvider 时 panic，
    /// 而它只在「密码正确」之后才走到——没有这层单测，线上表现就是
    /// 密码对时 502、密码错时 401，看着像网关故障。
    #[test]
    fn issues_and_parses_token() {
        let config = Config::from_env();
        let user = User {
            id: Uuid::new_v4(),
            email: "admin@example.com".to_string(),
            display_name: "admin".to_string(),
            role: "admin".to_string(),
        };

        let token = issue_token(&config, &user).expect("签发 token");
        let data = decode::<Claims>(
            &token,
            &DecodingKey::from_secret(config.jwt_secret.as_bytes()),
            &Validation::default(),
        )
        .expect("解析 token");

        assert_eq!(data.claims.sub, user.id.to_string());
        assert_eq!(data.claims.role, "admin");
        assert!(data.claims.exp > now_ts());
    }

    #[test]
    fn locks_after_repeated_failures() {
        let guard = LoginGuard::default();
        for _ in 0..MAX_FAILURES {
            assert!(guard.lock_remaining("1.2.3.4").is_none());
            guard.record_failure("1.2.3.4");
        }
        assert!(guard.lock_remaining("1.2.3.4").is_some());
        // 另一个来源不受影响，避免一个人被锁导致所有人都进不去
        assert!(guard.lock_remaining("5.6.7.8").is_none());

        guard.record_success("1.2.3.4");
        assert!(guard.lock_remaining("1.2.3.4").is_none());
    }
}
