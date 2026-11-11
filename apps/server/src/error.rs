//! 统一错误响应。
//!
//! 对外只暴露「状态码 + 中文短句 + 机器码」，内部错误写日志不外泄。

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use uuid::Uuid;

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "bad_request", message)
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "unauthorized", message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, "forbidden", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, "conflict", message)
    }

    pub fn too_many(message: impl Into<String>) -> Self {
        Self::new(StatusCode::TOO_MANY_REQUESTS, "too_many_requests", message)
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::new(StatusCode::SERVICE_UNAVAILABLE, "unavailable", message)
    }

    pub fn internal(error: impl std::fmt::Display) -> Self {
        // 细节不抛给前端，但留一个短编号：
        // 否则线上只看到「服务端出错了」，运维得翻整段日志猜是哪一条请求。
        // 前端把这个编号显示出来，用户一说就能直接 grep 到那一行。
        let reference = Uuid::new_v4().simple().to_string();
        let reference = reference[..8].to_string();
        tracing::error!(%error, %reference, "服务端内部错误");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            format!("服务端出错了，稍后再试（错误号 {reference}）"),
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({ "error": self.message, "code": self.code })),
        )
            .into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        // 区分「依赖不可用」和「代码出错」：前者该返回 503 让调用方重试，
        // 后者才需要看日志。混成 500 会让运维误判。
        match &error {
            sqlx::Error::PoolTimedOut | sqlx::Error::PoolClosed | sqlx::Error::Io(_) => {
                tracing::warn!(%error, "数据库不可用");
                Self::unavailable("数据库暂时不可用，稍后再试")
            }
            _ => Self::internal(error),
        }
    }
}

impl From<ppl_package::PackageError> for ApiError {
    fn from(error: ppl_package::PackageError) -> Self {
        Self::bad_request(format!("资源包校验未通过：{error}"))
    }
}
