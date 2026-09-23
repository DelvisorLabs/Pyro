//! Async client for the self-hosted Pyro gateway. POST requests are never retried automatically.
use hmac::{Hmac, Mac};
use reqwest::{
    Method, Url,
    header::{AUTHORIZATION, HeaderMap, HeaderValue},
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use sha2::Sha256;
use std::{
    collections::BTreeMap,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid client configuration: {0}")]
    Configuration(String),
    #[error("Pyro request failed ({status}): {message}")]
    Api {
        status: u16,
        message: String,
        request_id: Option<String>,
        retry_after_seconds: Option<u64>,
    },
    #[error("HTTP transport failed")]
    Transport(#[source] reqwest::Error),
    #[error("invalid response: {0}")]
    Decode(#[from] serde_json::Error),
    #[error("job failed: {0}")]
    Job(String),
    #[error("timed out waiting for classification job")]
    Timeout,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Allow,
    Review,
    Block,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Safe,
    Suspicious,
    Unsafe,
    Indeterminate,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectorResult {
    pub id: String,
    pub name: String,
    pub probability: f64,
    pub weighted_probability: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub id: String,
    pub request_id: Option<String>,
    pub trace_id: Option<String>,
    pub created_at: String,
    pub profile_id: String,
    pub action: Action,
    pub verdict: Verdict,
    pub risk: f64,
    pub confidence: f64,
    pub reason: String,
    pub detectors: Vec<DetectorResult>,
    pub model: String,
    pub provider: String,
    pub latency_ms: f64,
    pub queue_ms: f64,
    #[serde(default)]
    pub labels: BTreeMap<String, String>,
    pub metadata: Option<Value>,
    pub usage: Option<Value>,
    pub timings: Option<Value>,
    pub shadows: Option<Vec<Value>>,
}
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifyOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub labels: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
    #[serde(skip)]
    pub request_id: Option<String>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub description: String,
}
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
    Complete,
    Failed,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobReceipt {
    pub id: String,
    pub status: JobStatus,
    pub status_url: String,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub status: JobStatus,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub decision: Option<Decision>,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct PyroClient {
    client: reqwest::Client,
    base_url: Url,
}
impl PyroClient {
    pub fn new(base_url: &str, api_key: &str) -> Result<Self, Error> {
        Self::with_timeout(base_url, api_key, Duration::from_secs(10))
    }
    pub fn with_timeout(base_url: &str, api_key: &str, timeout: Duration) -> Result<Self, Error> {
        let base_url = Url::parse(&format!("{}/", base_url.trim_end_matches('/')))
            .map_err(|_| Error::Configuration("invalid base URL".into()))?;
        if !["http", "https"].contains(&base_url.scheme())
            || !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.query().is_some()
            || base_url.fragment().is_some()
            || api_key.is_empty()
            || timeout.is_zero()
        {
            return Err(Error::Configuration(
                "use an HTTP(S) base URL, a nonempty API key and positive timeout".into(),
            ));
        }
        let mut headers = HeaderMap::new();
        let mut authorization = HeaderValue::from_str(&format!("Bearer {api_key}"))
            .map_err(|_| Error::Configuration("invalid API key".into()))?;
        authorization.set_sensitive(true);
        headers.insert(AUTHORIZATION, authorization);
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| Error::Transport(e.without_url()))?;
        Ok(Self { client, base_url })
    }
    async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &[&str],
        body: Option<Value>,
        request_id: Option<&str>,
    ) -> Result<T, Error> {
        let mut url = self.base_url.clone();
        url.path_segments_mut()
            .map_err(|_| Error::Configuration("invalid base URL".into()))?
            .pop_if_empty()
            .extend(path);
        let mut request = self
            .client
            .request(method, url)
            .header("Accept", "application/json");
        if let Some(body) = body {
            request = request.json(&body);
        }
        if let Some(id) = request_id {
            request = request.header("X-Request-Id", id);
        }
        let response = request
            .send()
            .await
            .map_err(|e| Error::Transport(e.without_url()))?;
        let status = response.status();
        let request_id = response
            .headers()
            .get("x-request-id")
            .and_then(|v| v.to_str().ok())
            .map(String::from);
        let retry_after_seconds = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok());
        let bytes = response
            .bytes()
            .await
            .map_err(|e| Error::Transport(e.without_url()))?;
        if !status.is_success() {
            let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
            return Err(Error::Api {
                status: status.as_u16(),
                message: body
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Request failed")
                    .into(),
                request_id,
                retry_after_seconds,
            });
        }
        Ok(serde_json::from_slice(&bytes)?)
    }
    fn envelope(input: Value, options: &ClassifyOptions) -> Result<Value, Error> {
        let mut value = serde_json::to_value(options)?;
        value["input"] = input;
        Ok(value)
    }
    pub async fn classify(
        &self,
        input: Value,
        options: &ClassifyOptions,
    ) -> Result<Decision, Error> {
        self.request(
            Method::POST,
            &["v1", "classify"],
            Some(Self::envelope(input, options)?),
            options.request_id.as_deref(),
        )
        .await
    }
    pub async fn create_job(
        &self,
        input: Value,
        options: &ClassifyOptions,
    ) -> Result<JobReceipt, Error> {
        self.request(
            Method::POST,
            &["v1", "jobs"],
            Some(Self::envelope(input, options)?),
            options.request_id.as_deref(),
        )
        .await
    }
    pub async fn get_job(&self, id: &str) -> Result<Job, Error> {
        self.request(Method::GET, &["v1", "jobs", id], None, None)
            .await
    }
    pub async fn list_profiles(&self) -> Result<Vec<ProfileSummary>, Error> {
        self.request(Method::GET, &["v1", "profiles"], None, None)
            .await
    }
    /// Drop this future to cancel polling. The deadline includes HTTP requests and sleeps.
    pub async fn wait_for_job(
        &self,
        id: &str,
        interval: Duration,
        timeout: Duration,
    ) -> Result<Decision, Error> {
        if interval.is_zero() || timeout.is_zero() {
            return Err(Error::Configuration(
                "polling durations must be positive".into(),
            ));
        }
        tokio::time::timeout(timeout, async {
            loop {
                let job = self.get_job(id).await?;
                match job.status {
                    JobStatus::Complete => {
                        return job
                            .decision
                            .ok_or_else(|| Error::Job("complete job has no decision".into()));
                    }
                    JobStatus::Failed => {
                        return Err(Error::Job(
                            job.error.unwrap_or_else(|| "unknown failure".into()),
                        ));
                    }
                    _ => tokio::time::sleep(interval).await,
                }
            }
        })
        .await
        .map_err(|_| Error::Timeout)?
    }
}

/// Verify raw bytes before decoding JSON. Also deduplicate by X-Pyro-Delivery-Id in the receiver.
pub fn verify_webhook(
    body: &[u8],
    secret: &str,
    signature: &str,
    timestamp: &str,
    tolerance: Duration,
) -> bool {
    let now = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(v) => v.as_secs(),
        Err(_) => return false,
    };
    let seconds: u64 = match timestamp.parse() {
        Ok(v) => v,
        Err(_) => return false,
    };
    if timestamp.is_empty()
        || !timestamp.bytes().all(|b| b.is_ascii_digit())
        || now.abs_diff(seconds) > tolerance.as_secs()
        || secret.is_empty()
    {
        return false;
    }
    let hex = match signature.strip_prefix("v1=") {
        Some(v) if v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()) => v,
        _ => return false,
    };
    let bytes: Vec<u8> = (0..64)
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect();
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(timestamp.as_bytes());
    mac.update(b".");
    mac.update(body);
    mac.verify_slice(&bytes).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn envelope_excludes_request_id_and_keeps_labels() {
        let options = ClassifyOptions {
            profile: Some("strict".into()),
            request_id: Some("req-1".into()),
            labels: BTreeMap::from([("tenant".into(), "acme".into())]),
            ..Default::default()
        };
        let value = PyroClient::envelope(json!({"text": "hello"}), &options).unwrap();
        assert_eq!(value["profile"], "strict");
        assert_eq!(value["labels"]["tenant"], "acme");
        assert!(value.get("requestId").is_none());
    }
    #[test]
    fn verifies_signature_and_rejects_tampering() {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .to_string();
        let mut mac = Hmac::<Sha256>::new_from_slice(b"secret").unwrap();
        mac.update(format!("{timestamp}.{{}}").as_bytes());
        let signature = format!("v1={:x}", mac.finalize().into_bytes());
        assert!(verify_webhook(
            b"{}",
            "secret",
            &signature,
            &timestamp,
            Duration::from_secs(300)
        ));
        assert!(!verify_webhook(
            b"{ }",
            "secret",
            &signature,
            &timestamp,
            Duration::from_secs(300)
        ));
        assert!(!verify_webhook(
            b"{}",
            "secret",
            &signature,
            "1",
            Duration::from_secs(300)
        ));
    }
}
