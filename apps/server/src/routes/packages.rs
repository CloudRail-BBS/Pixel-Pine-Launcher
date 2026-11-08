//! 资源市场接口。
//!
//! 目前只做只读列表与详情。上传、审核、认证按方案 §4.6 的里程碑推进，
//! 这里先把「客户端能读到什么」定下来。

// 处理器返回 `Result<_, Response>`：Response 本身是个大枚举，
// 为它装箱只会增加一层间接，收益为零，这里明确放行。
#![allow(clippy::result_large_err)]

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::AppState;

/// 列表查询参数。
#[derive(Debug, Deserialize)]
pub struct ListQuery {
    /// 关键词，匹配标题或 slug。
    pub q: Option<String>,
    /// 页码，从 1 开始。
    pub page: Option<i64>,
    /// 每页条数，上限 100。
    pub size: Option<i64>,
}

/// 一条资源。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageItem {
    pub id: String,
    pub slug: String,
    pub kind: String,
    pub title: String,
    pub summary: String,
    pub author: String,
    pub cover: Option<String>,
    pub version: Option<String>,
    pub size: Option<i64>,
    pub content_hash: Option<String>,
    pub urls: Vec<String>,
}

/// 分页结果。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse {
    pub items: Vec<PackageItem>,
    pub page: i64,
    pub page_size: i64,
    pub total: i64,
}

/// 详情：资源本体 + 全部版本。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailResponse {
    #[serde(flatten)]
    pub package: PackageItem,
    pub versions: Vec<VersionItem>,
}

/// 一个历史版本。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionItem {
    pub version: String,
    pub size: i64,
    pub content_hash: String,
    pub urls: Vec<String>,
    pub changelog: String,
}

type Row = (
    String,
    String,
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<i64>,
    Option<String>,
    Option<Vec<String>>,
);

/// `GET /v1/packages`
pub async fn list(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<ListResponse>, Response> {
    let page = query.page.unwrap_or(1).max(1);
    let size = query.size.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * size;
    let keyword = query
        .q
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let rows = sqlx::query_as::<_, Row>(
        r#"
        SELECT p.id::text, p.slug, p.kind, p.title, p.summary, p.author, p.cover,
               v.version, v.size, v.content_hash, v.urls
        FROM packages p
        LEFT JOIN LATERAL (
            SELECT version, size, content_hash, urls
            FROM versions
            WHERE versions.package_id = p.id AND versions.status = 'approved'
            ORDER BY created_at DESC
            LIMIT 1
        ) v ON TRUE
        WHERE p.status = 'published'
          AND ($1::text IS NULL OR p.title ILIKE '%' || $1 || '%' OR p.slug ILIKE '%' || $1 || '%')
        ORDER BY p.published_at DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(keyword.clone())
    .bind(size)
    .bind(offset)
    .fetch_all(&state.pool)
    .await
    .map_err(db_unavailable)?;

    let total: i64 = sqlx::query_scalar(
        r#"
        SELECT count(*) FROM packages p
        WHERE p.status = 'published'
          AND ($1::text IS NULL OR p.title ILIKE '%' || $1 || '%' OR p.slug ILIKE '%' || $1 || '%')
        "#,
    )
    .bind(keyword)
    .fetch_one(&state.pool)
    .await
    .map_err(db_unavailable)?;

    Ok(Json(ListResponse {
        items: rows.into_iter().map(to_item).collect(),
        page,
        page_size: size,
        total,
    }))
}

/// `GET /v1/packages/{id}`，`id` 可以是 uuid 或 slug。
pub async fn detail(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<DetailResponse>, Response> {
    let row = sqlx::query_as::<_, Row>(
        r#"
        SELECT p.id::text, p.slug, p.kind, p.title, p.summary, p.author, p.cover,
               v.version, v.size, v.content_hash, v.urls
        FROM packages p
        LEFT JOIN LATERAL (
            SELECT version, size, content_hash, urls
            FROM versions
            WHERE versions.package_id = p.id AND versions.status = 'approved'
            ORDER BY created_at DESC
            LIMIT 1
        ) v ON TRUE
        WHERE p.id::text = $1 OR p.slug = $1
        "#,
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await
    .map_err(db_unavailable)?;

    let Some(row) = row else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "没有这个资源" })),
        )
            .into_response());
    };

    let versions = sqlx::query_as::<_, (String, i64, String, Option<Vec<String>>, String)>(
        r#"
        SELECT v.version, v.size, v.content_hash, v.urls, v.changelog
        FROM versions v
        JOIN packages p ON p.id = v.package_id
        WHERE (p.id::text = $1 OR p.slug = $1) AND v.status = 'approved'
        ORDER BY v.created_at DESC
        "#,
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await
    .map_err(db_unavailable)?;

    Ok(Json(DetailResponse {
        package: to_item(row),
        versions: versions
            .into_iter()
            .map(
                |(version, size, content_hash, urls, changelog)| VersionItem {
                    version,
                    size,
                    content_hash,
                    urls: urls.unwrap_or_default(),
                    changelog,
                },
            )
            .collect(),
    }))
}

/// `POST /v1/packages/{id}/report`。公开入口，不需要登录——
/// 举报门槛越高，坏内容活得越久。
#[derive(Debug, Deserialize)]
pub struct ReportBody {
    pub reason: String,
    #[serde(default)]
    pub contact: String,
}

pub async fn report(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<ReportBody>,
) -> Result<Json<serde_json::Value>, Response> {
    let reason = body.reason.trim();
    if reason.chars().count() < 4 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "请说明具体问题，至少 4 个字" })),
        )
            .into_response());
    }
    if reason.chars().count() > 500 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "说明不要超过 500 个字" })),
        )
            .into_response());
    }

    let found: Option<(uuid::Uuid,)> =
        sqlx::query_as("SELECT id FROM packages WHERE id::text = $1 OR slug = $1")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await
            .map_err(db_unavailable)?;

    let Some((package_id,)) = found else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "没有这个资源" })),
        )
            .into_response());
    };

    sqlx::query("INSERT INTO reports (package_id, reason, contact) VALUES ($1, $2, $3)")
        .bind(package_id)
        .bind(reason)
        .bind(body.contact.trim())
        .execute(&state.pool)
        .await
        .map_err(db_unavailable)?;

    Ok(Json(json!({ "ok": true })))
}

fn to_item(row: Row) -> PackageItem {
    let (id, slug, kind, title, summary, author, cover, version, size, content_hash, urls) = row;

    PackageItem {
        id,
        slug,
        kind,
        title,
        summary,
        author,
        cover,
        version,
        size,
        content_hash,
        urls: urls.unwrap_or_default(),
    }
}

fn db_unavailable(error: sqlx::Error) -> Response {
    tracing::warn!(%error, "数据库查询失败");
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({ "error": "数据库暂时不可用" })),
    )
        .into_response()
}
