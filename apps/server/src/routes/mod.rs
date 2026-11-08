//! 路由表。

pub mod health;
pub mod packages;

use axum::routing::get;
use axum::Router;
use sqlx::PgPool;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        // 进程活着就算健康；数据库状态单独由 /readyz 表达
        .route("/healthz", get(health::healthz))
        .route("/readyz", get(health::readyz))
        .route("/v1/packages", get(packages::list))
        .route("/v1/packages/{id}", get(packages::detail))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state)
}
