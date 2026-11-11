//! 路由表。

pub mod admin;
pub mod admin_console;
pub mod announcements;
pub mod auth;
pub mod dist;
pub mod health;
pub mod packages;
pub mod upload;

use axum::extract::DefaultBodyLimit;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::Router;
use sqlx::PgPool;
use std::sync::Arc;
use tower_http::catch_panic::CatchPanicLayer;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::auth::LoginGuard;
use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: Config,
    /// 后台登录失败计数。进程内共享，四个 axum 线程看到同一份。
    pub login_guard: Arc<LoginGuard>,
}

/// 请求体上限：比单包上限略大，留出 multipart 边界的余量。
const BODY_LIMIT: usize = 210 * 1024 * 1024;

pub fn router(state: AppState) -> Router {
    let files = ServeDir::new(state.config.storage_dir.clone());

    // 审核后台和 API 同一个进程：省一个容器，也省掉跨域配置。
    // 前端用的是 history 路由，找不到的路径要回落到 index.html，
    // 否则刷新 /admin/queue 会 404。
    let admin_root = state.config.admin_dir.clone();
    // 用 fallback 而不是 not_found_service：后者的实现会把状态码强制改成 404，
    // 结果「页面能显示但返回 404」，浏览器渲染没问题，代理和监控会以为挂了。
    let admin = ServeDir::new(&admin_root)
        .append_index_html_on_directories(true)
        .fallback(ServeFile::new(admin_root.join("index.html")));

    Router::new()
        // 进程活着就算健康；数据库状态单独由 /readyz 表达
        .route("/healthz", get(health::healthz))
        .route("/readyz", get(health::readyz))
        // 公开读取
        .route("/v1/packages", get(packages::list))
        .route("/v1/packages/{id}", get(packages::detail))
        .route("/v1/packages/{id}/report", post(packages::report))
        // 公告：客户端首屏拉一次
        .route("/v1/announcements", get(announcements::list))
        // 登录
        .route("/v1/auth/config", get(auth::config))
        .route("/v1/auth/email/request", post(auth::request_code))
        .route("/v1/auth/email/verify", post(auth::verify_code))
        .route("/v1/me", get(auth::me))
        // 作者侧
        .route("/v1/me/packages", get(upload::mine).post(upload::create))
        .route("/v1/packages/{id}/versions", post(upload::upload_version))
        .route("/v1/packages/{id}/submit", post(upload::submit))
        // 审核侧
        .route("/v1/admin/login", post(admin::login))
        // 管理控制台：概览、资源管理、审计、游戏清单
        .route("/v1/admin/stats", get(admin_console::stats))
        .route("/v1/admin/audit", get(admin_console::audit_list))
        .route("/v1/admin/packages", get(admin_console::packages))
        .route(
            "/v1/admin/packages/{id}",
            get(admin_console::package_detail),
        )
        .route(
            "/v1/admin/packages/{id}",
            delete(admin_console::delete_package),
        )
        .route(
            "/v1/admin/packages/{id}/restore",
            post(admin_console::restore),
        )
        .route("/v1/admin/game", get(dist::admin_game_get))
        .route("/v1/admin/game", put(dist::admin_game_put))
        .route("/v1/admin/game/upload", post(dist::admin_game_upload))
        .route("/v1/admin/queue", get(admin::queue))
        .route("/v1/admin/packages/{id}/approve", post(admin::approve))
        .route("/v1/admin/packages/{id}/reject", post(admin::reject))
        .route("/v1/admin/packages/{id}/takedown", post(admin::takedown))
        .route("/v1/admin/reports", get(admin::reports))
        .route(
            "/v1/admin/announcements",
            get(announcements::admin_list).post(announcements::create),
        )
        .route(
            "/v1/admin/announcements/{id}",
            axum::routing::delete(announcements::delete),
        )
        .route("/v1/admin/reports/{id}/handle", post(admin::handle_report))
        // 客户端更新清单：CI 发版后直接推上来，省掉人工 cp
        .route("/v1/admin/launcher", post(dist::publish_launcher))
        // 分发清单：运营方放文件，服务端只读
        .route("/v1/game/index.json", get(dist::game_index))
        .route("/v1/launcher/latest.json", get(dist::launcher_latest))
        // 资源包下载。走静态目录，将来换对象存储时只改这里
        .nest_service("/files", files)
        // 审核后台。构建产物放在 PPL_ADMIN_DIR，没放就是 404（不影响 API）
        .route("/admin", get(admin_redirect))
        .nest_service("/admin/", admin)
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(TraceLayer::new_for_http())
        // handler 里 panic 时 axum 会直接掐掉连接，反代看到的是一句
        // 「502 Bad Gateway」——排查时会一路怀疑容器和 nginx。
        // 在这里接住，转成 500 + 明确日志，别让进程内部的 bug 伪装成网关故障。
        .layer(CatchPanicLayer::custom(panic_to_500))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// panic 兜底：返回 500，并把 panic 打到日志里。
fn panic_to_500(payload: Box<dyn std::any::Any + Send + 'static>) -> axum::response::Response {
    let detail = payload
        .downcast_ref::<&str>()
        .map(|value| (*value).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "(无描述)".to_string());
    tracing::error!(%detail, "请求处理时 panic，已按 500 返回");

    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        axum::Json(serde_json::json!({
            "code": "panic",
            "error": "服务端出错了，稍后再试",
        })),
    )
        .into_response()
}

/// `/admin` → `/admin/`。
///
/// 少了尾斜杠的话，ServeDir 拿到的相对路径是空的，直接 404；
/// 用户从地址栏手敲域名时最容易踩这个。
async fn admin_redirect() -> axum::response::Redirect {
    axum::response::Redirect::permanent("/admin/")
}
