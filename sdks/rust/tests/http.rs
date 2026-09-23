use pyro_client::{ClassifyOptions, Error, PyroClient};
use serde_json::json;
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

async fn receiver(
    status: &str,
    body: &str,
    extra: &str,
) -> (String, tokio::task::JoinHandle<String>) {
    let server = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", server.local_addr().unwrap());
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}",
        body.len()
    );
    let task = tokio::spawn(async move {
        let (mut stream, _) = server.accept().await.unwrap();
        let mut request = Vec::new();
        loop {
            let mut chunk = [0u8; 4096];
            let count = stream.read(&mut chunk).await.unwrap();
            if count == 0 {
                break;
            }
            request.extend_from_slice(&chunk[..count]);
            let text = String::from_utf8_lossy(&request);
            if let Some(boundary) = text.find("\r\n\r\n") {
                let length: usize = text[..boundary]
                    .lines()
                    .find_map(|line| {
                        line.to_lowercase()
                            .strip_prefix("content-length:")
                            .map(|n| n.trim().parse().unwrap())
                    })
                    .unwrap_or(0);
                if request.len() >= boundary + 4 + length {
                    break;
                }
            }
        }
        stream.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8(request).unwrap()
    });
    (address, task)
}

#[tokio::test]
async fn posts_envelopes_and_preserves_http_errors() {
    let (url, task) = receiver(
        "429 Too Many Requests",
        "{\"error\":\"slow down\"}",
        "X-Request-Id: req-server\r\nRetry-After: 9\r\n",
    )
    .await;
    let client = PyroClient::new(&url, "test-secret").unwrap();
    let options = ClassifyOptions {
        profile: Some("strict".into()),
        request_id: Some("req-client".into()),
        ..Default::default()
    };
    let result = client.classify(json!({"message": "hello"}), &options).await;
    assert!(
        matches!(result, Err(Error::Api { status: 429, retry_after_seconds: Some(9), request_id: Some(id), .. }) if id == "req-server")
    );
    let request = task.await.unwrap();
    assert!(request.starts_with("POST /v1/classify"));
    assert!(
        request
            .to_lowercase()
            .contains("authorization: bearer test-secret")
    );
    assert!(request.to_lowercase().contains("x-request-id: req-client"));
    let body: serde_json::Value =
        serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(body["profile"], "strict");
    assert_eq!(body["input"]["message"], "hello");
}

#[tokio::test]
async fn profile_discovery_and_poll_deadline() {
    let (url, task) = receiver(
        "200 OK",
        "[{\"id\":\"default\",\"name\":\"Default\",\"description\":\"Test\"}]",
        "",
    )
    .await;
    let client = PyroClient::new(&url, "test").unwrap();
    assert_eq!(client.list_profiles().await.unwrap()[0].id, "default");
    assert!(task.await.unwrap().starts_with("GET /v1/profiles"));
    let server = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let client =
        PyroClient::new(&format!("http://{}", server.local_addr().unwrap()), "test").unwrap();
    let task = tokio::spawn(async move {
        let (_stream, _) = server.accept().await.unwrap();
        tokio::time::sleep(Duration::from_secs(2)).await;
    });
    assert!(matches!(
        client
            .wait_for_job("job", Duration::from_millis(1), Duration::from_millis(25))
            .await,
        Err(Error::Timeout)
    ));
    task.abort();
}
