# Webhooks

Pyro sends signed JSON to your HTTP receiver. Configure destinations in **Webhooks**. Each destination filters by action, minimum risk, application IDs and profile IDs. Empty ID lists mean all applications/profiles. Filters are independent of a profile's `notifyOn`, which controls dashboard notifications only. Only the enforced decision emits an outbound event; shadow results do not send separate alerts.

The dashboard's **Applications** and **Profiles** fields provide searchable checklists of saved resources by name. Choose **All applications** or **All profiles** to include current and future resources. Clearing a specific selection requires choosing another item or explicitly choosing All before saving; it never silently broadens the filter. The API still receives IDs.

**Minimum risk** is a notification filter on the 0–1 score: `0` includes every risk score, while `0.8` includes only scores at least `0.8`. It does not change a profile's review/block thresholds. A decision must match the selected action, minimum risk, application scope and profile scope together. Help icons beside each field explain its purpose.

## Delivery contract

The gateway commits the classification event and matching deliveries in the same PostgreSQL transaction. A gateway worker claims up to eight records at a time using row locks and a 30-second lease. Receivers are called asynchronously; classification never waits for external network delivery. Delivery is **at least once**, so receivers must deduplicate on `X-Pyro-Delivery-Id`. A crash after a receiver accepts the message but before the acknowledgement is stored can produce a duplicate. Multiple gateway processes can share the outbox.

Each request uses:

- `Content-Type: application/json`
- `X-Pyro-Delivery-Id`: stable delivery ID across retries
- `X-Pyro-Event`: `decision.created` or `integration.test`
- `X-Pyro-Timestamp`: Unix seconds at the current attempt
- `X-Pyro-Signature`: `v1=` followed by hex HMAC-SHA256 of `timestamp + "." + rawBody`

```json
{
  "id": "event-id",
  "type": "decision.created",
  "createdAt": "2026-09-23T12:00:00.000Z",
  "data": {
    "id": "event-id",
    "profileId": "balanced-assistant",
    "appId": "support",
    "action": "block",
    "verdict": "unsafe",
    "risk": 0.95,
    "provider": "local-rules",
    "latencyMs": 0.5,
    "traceId": "trace-id",
    "failed": false
  }
}
```

Payloads intentionally exclude raw inputs, previews, input hashes, labels, metadata, API keys, provider error text, and detector questions. The signing secret is returned once on creation/rotation. Destination URLs and signing keys are encrypted with `CONTROL_PLANE_SECRET`, and list endpoints return only the destination host.

Verify the signature over the exact raw body before JSON decoding, reject timestamps outside a five-minute tolerance, then deduplicate delivery IDs. Both TypeScript and Rust SDKs provide verification helpers. A new timestamp/signature is generated for each retry. Secret rotation takes effect on subsequent attempts; update the receiver when rotating.

A 2xx response completes delivery. Timeouts/network failures, 408, 425, 429 and 5xx retry with exponential delays, with at most five worker attempts. Retry-After is honored up to one hour. Other responses, including redirects, fail immediately. DNS resolution has a three-second deadline and requests have a five-second HTTP timeout. The dashboard shows the latest 100 deliveries and can requeue failed ones. Disabling/deleting a destination stops subsequent attempts; an already in-flight request may still finish. Queued records use current destination settings when sent. A stopped gateway leaves tests/deliveries pending until a gateway starts.

By default receivers require HTTPS and public IP addresses. DNS results are validated and pinned for the connection; redirects are not followed. For self-hosted receivers, explicitly enable **Allow private network / HTTP**. That option permits private destinations and unencrypted HTTP; use it only for your trusted network.

Delivery history is durable and currently has no automatic retention cleanup. Establish a database retention policy appropriate to your workload. Global capacity is eight outbound sends per gateway process. Aggregate events in your receiver if needed.

## Test locally

With the gateway and control plane running on localhost, run from the Pyro repository:

```sh
npm run test:webhook
```

The smoke test reads your existing `.env` credentials without printing them. It starts a temporary receiver on `127.0.0.1:9091`, creates a temporary outgoing webhook and local-rule profile, verifies HMAC signatures, deliberately returns HTTP 503 once to check automatic retries, and checks a real `decision.created` delivery. It removes the temporary webhook/profile afterward. The test decision and delivery history remain as audit records. Success ends with `PASS`.

The default receiver URL is `http://host.docker.internal:9091/events`, for the Docker gateway on macOS/Windows. If your gateway is a local Node process, use:

```sh
WEBHOOK_RECEIVER_URL=http://127.0.0.1:9091/events npm run test:webhook
```

`WEBHOOK_TEST_PORT` changes the receiver port. Stop any manual receiver before running the smoke test. On Linux Docker, configure `host.docker.internal:host-gateway` in the gateway's `extra_hosts` and bind the receiver to the Docker bridge address using `WEBHOOK_TEST_HOST`; use that reachable address in the destination URL. The receiver binds only to loopback by default.

### Test from the dashboard

1. Run `npm run webhook:receiver` from the Pyro repository.
2. Open **Webhooks → Add webhook**. Name it “Local test”. Set the destination to `http://host.docker.internal:9091/events` for Docker, or `http://127.0.0.1:9091/events` for a Node gateway. Enable **Allow private network / HTTP**, then save.
3. Save the signing secret shown once. To verify signatures, stop the receiver and restart it with that secret:

   ```sh
   PYRO_WEBHOOK_SECRET='paste-the-signing-secret' npm run webhook:receiver
   ```

4. Click **Send test**. Within a few seconds, the terminal should print `integration.test` with `"signature": "verified"`. **Recent deliveries** should show **delivered**, one attempt, and HTTP **204**. Test events bypass action/risk/profile/application filters.
5. To test retries, restart the receiver with `WEBHOOK_TEST_FAIL_FIRST=1` as well as the secret, then send another test. It first returns **503**, then Pyro retries and records **delivered** with two attempts.
6. To test real decisions, choose filters matching an application/profile, and send an input matching one of its local rules through Playground or the classify API. The receiver should print `decision.created`. The automatic smoke test covers this without making a model request.

Troubleshooting: **pending** with zero attempts means the gateway worker is not running; network failures usually mean a wrong Docker/host address or private networking disabled; **401** from this receiver means a mismatched signing secret or timestamp. After rotating a secret, restart the receiver with the new value. Stop the test receiver and disable/delete the test webhook when finished.

## Control-plane endpoints

All endpoints below require an authenticated `pf_session` cookie on the control plane (port 8081, or `/control` through the dashboard). Gateway bearer keys cannot administer integrations.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/integrations` | List redacted destinations |
| `POST /api/integrations` | Create destination; returns signing secret once for a webhook |
| `PUT /api/integrations/:id` | Update name, URL, enabled state, filters or private-network setting |
| `DELETE /api/integrations/:id` | Remove a destination; queued sends stop on the next attempt |
| `POST /api/integrations/:id/test` | Queue a synthetic event; returns 202 |
| `POST /api/integrations/:id/rotate-secret` | Rotate the webhook signing key |
| `GET /api/integration-deliveries?integrationId=…` | Most recent 100 deliveries, optionally filtered |
| `POST /api/integration-deliveries/:id/retry` | Requeue a failed record with the same delivery ID |

Create/update fields: `name`, `type` (optional; only `webhook` is accepted), `url`, `enabled`, `actions`, `minimumRisk`, `appIds`, `profileIds`, and `allowPrivateNetwork`. Omit or leave `url` empty on update to preserve it. Maximum 50 destinations. Authentication errors return 401, invalid data 400, missing resources 404, and invalid state transitions 409.
