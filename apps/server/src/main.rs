//! Pixel-Pine-Launcher 市场服务端。
//!
//! 设计取舍：
//! - **进程启动不依赖数据库就绪**：用懒连接 + 迁移失败只告警，
//!   否则容器编排里数据库晚几秒起来就会导致反复重启。
//! - **健康检查分两档**：`/healthz` 看进程，`/readyz` 看依赖。

mod auth;
mod config;
mod db;
mod error;
mod mail;
mod routes;
mod storage;

use std::time::Duration;

use tracing_subscriber::EnvFilter;

use config::Config;
use routes::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=warn")),
        )
        .init();

    let config = Config::from_env();
    let pool = db::create_pool(&config.database_url, config.max_connections)?;

    // 迁移放到后台：数据库没起来也不能挡住端口监听，
    // 否则编排系统会以为容器挂了，反复重启。
    let migrate_pool = pool.clone();
    tokio::spawn(async move {
        let _ = tokio::time::timeout(Duration::from_secs(30), db::try_migrate(&migrate_pool)).await;
    });

    // 存储目录要赶在路由挂载静态服务之前建好，否则首次上传才建会 404
    if let Err(error) = std::fs::create_dir_all(&config.storage_dir) {
        tracing::warn!(%error, dir = %config.storage_dir.display(), "创建存储目录失败");
    }

    // 缺什么就明说，别等上线才发现是裸奔
    if !config.geetest_ready() {
        tracing::warn!("未配置 PPL_GEETEST_ID / PPL_GEETEST_KEY，注册流程不校验人机");
    }
    if !config.smtp_ready() {
        if config.dev_mode {
            tracing::warn!("未配置 SMTP，开发模式下验证码随接口返回");
        } else {
            tracing::warn!("未配置 SMTP，验证码邮件发不出去，注册会失败");
        }
    }
    if config.dev_mode {
        tracing::warn!("PPL_DEV_MODE 已开启，验证码会随响应返回，生产环境必须关闭");
    }

    let addr = format!("{}:{}", config.host, config.port);
    let state = AppState {
        pool,
        config: config.clone(),
    };
    let app = routes::router(state);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(
        %addr,
        version = env!("CARGO_PKG_VERSION"),
        "PPL 服务端已启动"
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    tracing::info!("服务已停止");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("收到退出信号，开始优雅关闭");
}
