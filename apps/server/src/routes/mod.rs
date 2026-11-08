//! 路由表。

pub mod admin;
pub mod auth;
pub mod health;
pub mod packages;
pub mod upload;

use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::Router;
use sqlx::PgPool;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;

use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: Config,
}

/// 请求体上限：比单包上限略大，留出 multipart 边界的余量。
const BODY_LIMIT: usize = 210 * 1024 * 1024;

pub fn router(state: AppState) -> Router {
    let files = ServeDir::new(state.config.storage_dir.clone());

    Router::new()
        // 进程活着就算健康；数据库状态单独由 /readyz 表达
        .route("/healthz", get(health::healthz))
        .route("/readyz", get(health::readyz))
        // 公开读取
        .route("/v1/packages", get(packages::list))
        .route("/v1/packages/{id}", get(packages::detail))
        .route("/v1/packages/{id}/report", post(packages::report))
        // 登录
        .route("/v1/auth/email/request", post(auth::request_code))
        .route("/v1/auth/email/verify", post(auth::verify_code))
        .route("/v1/me", get(auth::me))
        // 作者侧
        .route("/v1/me/packages", get(upload::mine).post(upload::create))
        .route("/v1/packages/{id}/versions", post(upload::upload_version))
        .route("/v1/packages/{id}/submit", post(upload::submit))
        // 审核侧
        .route("/v1/admin/queue", get(admin::queue))
        .route("/v1/admin/packages/{id}/approve", post(admin::approve))
        .route("/v1/admin/packages/{id}/reject", post(admin::reject))
        // 资源包下载。走静态目录，将来换对象存储时只改这里
        .nest_service("/files", files)
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state)
}
