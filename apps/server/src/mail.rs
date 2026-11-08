//! 外发邮件与人机校验。
//!
//! 两个外部依赖都是「可选」的：没配 SMTP 就把验证码写日志，
//! 没配 Geetest 就跳过校验。启动时会各打一条 warn，
//! 免得线上跑成了裸奔却没人知道。

use hmac::{Hmac, KeyInit, Mac};
use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use sha2::Sha256;

use crate::config::Config;
use crate::error::ApiError;

/// 发一封验证码邮件。配置缺失时返回 Err，由调用方决定降级。
pub async fn send_code(config: &Config, to: &str, code: &str) -> Result<(), String> {
    let Some(smtp) = config.smtp.as_ref() else {
        return Err("未配置 SMTP".to_string());
    };

    let body = format!(
        "你的 PPL 资源市场验证码是：{code}\n\n10 分钟内有效，请勿转发给他人。\n如果不是你本人操作，忽略这封邮件即可。"
    );

    let email = Message::builder()
        .from(
            smtp.from
                .parse()
                .map_err(|error| format!("发件人格式不对：{error}"))?,
        )
        .to(to
            .parse()
            .map_err(|error| format!("收件人格式不对：{error}"))?)
        .subject("PPL 市场验证码")
        .header(ContentType::TEXT_PLAIN)
        .body(body)
        .map_err(|error| format!("构造邮件失败：{error}"))?;

    let mailer = AsyncSmtpTransport::<Tokio1Executor>::relay(&smtp.host)
        .map_err(|error| format!("连接 SMTP 失败：{error}"))?
        .port(smtp.port)
        .credentials(Credentials::new(
            smtp.username.clone(),
            smtp.password.clone(),
        ))
        .build();

    mailer
        .send(email)
        .await
        .map_err(|error| format!("发送邮件失败：{error}"))?;

    Ok(())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GeetestParams {
    pub lot_number: String,
    pub captcha_output: String,
    pub pass_token: String,
    pub gen_time: String,
}

/// 极验 4.0 服务端二次校验。
///
/// 只在前端判断等于没验证——token 可以伪造，必须回源校验一次。
pub async fn verify_geetest(config: &Config, params: &GeetestParams) -> Result<(), ApiError> {
    let (Some(captcha_id), Some(captcha_key)) =
        (config.geetest_id.as_ref(), config.geetest_key.as_ref())
    else {
        return Ok(());
    };

    let sign_token = hmac_sha256_hex(&params.lot_number, captcha_key);

    let url = format!("https://gcaptcha4.geetest.com/validate?captcha_id={captcha_id}");
    let form = [
        ("lot_number", params.lot_number.as_str()),
        ("captcha_output", params.captcha_output.as_str()),
        ("pass_token", params.pass_token.as_str()),
        ("gen_time", params.gen_time.as_str()),
        ("sign_token", sign_token.as_str()),
    ];

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|error| ApiError::internal(format!("初始化人机校验失败：{error}")))?;

    let response = client
        .post(&url)
        .form(&form)
        .send()
        .await
        .map_err(|error| {
            // 极验不可用时不要直接放行，但也不能把用户彻底挡在门外：
            // 这里返回 503，让前端提示稍后再试，而不是「验证失败」。
            tracing::warn!(%error, "极验校验请求失败");
            ApiError::unavailable("人机验证服务暂时不可用，稍后再试")
        })?;

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| ApiError::internal(format!("解析极验响应失败：{error}")))?;

    let result = body
        .get("result")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if result == "success" {
        return Ok(());
    }

    let reason = body
        .get("reason")
        .and_then(|value| value.as_str())
        .unwrap_or("人机验证未通过");
    tracing::info!(reason, "极验校验未通过");
    Err(ApiError::bad_request("人机验证未通过，请重新验证"))
}

fn hmac_sha256_hex(message: &str, key: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(key.as_bytes()).expect("HMAC 接受任意长度密钥");
    mac.update(message.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}
