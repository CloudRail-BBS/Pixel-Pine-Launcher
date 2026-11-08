//! 运行时配置。全部来自环境变量，方便容器注入。
//!
//! 所有「没配也能跑」的项都有明确降级路径：
//! 没配 SMTP 就把验证码写日志，没配 Geetest 就跳过人机校验，
//! 但这两条都会在启动时打一条 warn，避免上线了才发现是裸奔。

use std::env;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub host: String,
    pub port: u16,
    pub max_connections: u32,

    /// 签发 JWT 用。没配就每次启动随机生成——重启后旧 token 全部失效，
    /// 单实例调试无感，多实例部署必须显式配置。
    pub jwt_secret: String,
    pub jwt_ttl_hours: i64,

    /// 资源包落盘目录。
    pub storage_dir: PathBuf,
    /// 审核后台的静态产物目录。由同一个服务托管在 `/admin` 下，
    /// 省掉再起一个前端容器，也不用为它单独配跨域。
    pub admin_dir: PathBuf,
    /// 对外可访问的根地址，用来拼下载链接。
    pub public_base: String,

    pub geetest_id: Option<String>,
    pub geetest_key: Option<String>,

    pub smtp: Option<SmtpConfig>,

    /// 开发模式：验证码随响应返回，省得去翻日志。生产必须关闭。
    pub dev_mode: bool,
    /// 首个管理员邮箱，首次登录时自动提权。
    pub admin_email: Option<String>,
}

#[derive(Clone, Debug)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub from: String,
}

impl Config {
    pub fn from_env() -> Self {
        let smtp = match (
            env::var("PPL_SMTP_HOST").ok(),
            env::var("PPL_SMTP_USER").ok(),
            env::var("PPL_SMTP_PASS").ok(),
        ) {
            (Some(host), Some(username), Some(password)) if !host.is_empty() => Some(SmtpConfig {
                host,
                port: env::var("PPL_SMTP_PORT")
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(465),
                username,
                password,
                from: env::var("PPL_SMTP_FROM")
                    .unwrap_or_else(|_| "PPL 市场 <noreply@pixelpine.org>".to_string()),
            }),
            _ => None,
        };

        let dev_mode = matches!(
            env::var("PPL_DEV_MODE").as_deref(),
            Ok("1") | Ok("true") | Ok("yes")
        );

        Self {
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://ppl:ppl@localhost:5432/ppl".to_string()),
            host: env::var("PPL_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: env::var("PPL_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(8080),
            max_connections: env::var("PPL_DB_MAX_CONN")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(8),

            jwt_secret: env::var("PPL_JWT_SECRET")
                .ok()
                .filter(|value| value.len() >= 16)
                .unwrap_or_else(|| {
                    let generated = random_hex(32);
                    tracing::warn!("未配置 PPL_JWT_SECRET，本次启动临时生成，重启后所有登录失效");
                    generated
                }),
            jwt_ttl_hours: env::var("PPL_JWT_TTL_HOURS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(24 * 7),

            storage_dir: env::var("PPL_STORAGE_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("./data/packages")),
            admin_dir: env::var("PPL_ADMIN_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("./admin")),
            public_base: env::var("PPL_PUBLIC_BASE")
                .unwrap_or_else(|_| "http://localhost:8080".to_string())
                .trim_end_matches('/')
                .to_string(),

            geetest_id: env::var("PPL_GEETEST_ID").ok().filter(|v| !v.is_empty()),
            geetest_key: env::var("PPL_GEETEST_KEY").ok().filter(|v| !v.is_empty()),
            smtp,
            dev_mode,
            admin_email: env::var("PPL_ADMIN_EMAIL").ok().filter(|v| !v.is_empty()),
        }
    }

    pub fn smtp_ready(&self) -> bool {
        self.smtp.is_some()
    }

    pub fn geetest_ready(&self) -> bool {
        self.geetest_id.is_some() && self.geetest_key.is_some()
    }
}

/// 随机十六进制串。用 uuid v4 拼，不额外引 rand。
pub fn random_hex(bytes: usize) -> String {
    let mut out = String::with_capacity(bytes * 2);
    while out.len() < bytes * 2 {
        out.push_str(&uuid::Uuid::new_v4().simple().to_string());
    }
    out.truncate(bytes * 2);
    out
}
