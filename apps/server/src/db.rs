//! 数据库连接与迁移。
//!
//! 刻意用 `connect_lazy`：容器里数据库可能比应用晚几秒就绪，
//! 若启动时硬连，pod 会反复重启。这里先让进程起来，健康检查如实报告。

use std::time::Duration;

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

/// 建连接池（不立即建立连接）。
pub fn create_pool(database_url: &str, max_connections: u32) -> anyhow::Result<PgPool> {
    PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(Duration::from_secs(5))
        .connect_lazy(database_url)
        .map_err(|error| anyhow::anyhow!("数据库连接串无效：{error}"))
}

/// 尝试执行迁移。失败只告警，不阻断启动。
pub async fn try_migrate(pool: &PgPool) {
    let migration = sqlx::migrate!("./migrations");
    match tokio::time::timeout(Duration::from_secs(15), migration.run(pool)).await {
        Ok(Ok(())) => tracing::info!("数据库迁移完成"),
        Ok(Err(error)) => tracing::warn!(%error, "数据库迁移失败，服务继续启动"),
        Err(_) => tracing::warn!("数据库迁移超时，服务继续启动"),
    }
}

/// 探活：能不能真的执行一条查询。
pub async fn ping(pool: &PgPool) -> bool {
    matches!(
        tokio::time::timeout(
            Duration::from_secs(2),
            sqlx::query("select 1").execute(pool)
        )
        .await,
        Ok(Ok(_))
    )
}
