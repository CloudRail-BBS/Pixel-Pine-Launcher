//! 健康检查。
//!
//! 分成两个端点是有意的。`/healthz` 看进程，容器编排用它决定要不要重启；
//! `/readyz` 看依赖，负载均衡用它决定要不要摘流量。
//! 混成一个的话，数据库抖一下就会把好好的进程杀掉重来。

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;

use super::AppState;
use crate::db;

pub async fn healthz() -> impl IntoResponse {
    Json(json!({
        "ok": true,
        "service": "ppl-server",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

pub async fn readyz(State(state): State<AppState>) -> impl IntoResponse {
    let db_ok = db::ping(&state.pool).await;
    let status = if db_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        status,
        Json(json!({
            "ok": db_ok,
            "db": db_ok,
            "version": env!("CARGO_PKG_VERSION"),
        })),
    )
}
