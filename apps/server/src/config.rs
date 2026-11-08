//! 运行时配置。全部来自环境变量，方便容器注入。

use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub host: String,
    pub port: u16,
    pub max_connections: u32,
}

impl Config {
    pub fn from_env() -> Self {
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
        }
    }
}
