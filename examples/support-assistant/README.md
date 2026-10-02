# Support assistant integration example

This dependency-free Node example demonstrates enforcement and review handling. It returns public Northstar help text; it does not access customer accounts, execute tools, or call a separate answer-generating LLM. Run it alongside a Pyro gateway, with no Docker requirement.

1. Import `profiles/support-workflow.yaml` through Library or the CLI. Adapt the company context and publish it when ready.
2. Create an application key allowed to use that policy.
3. Set `PYRO_API_KEY`, `PYRO_GATEWAY_URL`, and a random `DEMO_REVIEW_TOKEN` of at least 24 characters in your shell. Set `PYRO_POLICY_ID` if your imported policy has a different ID. Do not commit credentials.
4. Start `node examples/support-assistant/server.mjs`.

```sh
curl --fail-with-body http://127.0.0.1:3090/ask \
  -H 'Content-Type: application/json' \
  --data '{"input":"How do I change my Northstar billing plan?"}'
```

Allow returns a public help answer. Block returns 422 with no protected operation. Review returns 202 and a review ID; an authorized operator can POST `{ "action": "approve" }` or `{ "action": "reject" }` to `/reviews/REVIEW_ID/resolve`, using `Authorization: Bearer $DEMO_REVIEW_TOKEN`. The same review cannot be resolved twice. Held requests expire after ten minutes. Provider timeouts, errors and unknown actions return 503, never an implicit allow.

Review state is deliberately in memory for this local example. A real application needs durable, identity-scoped pending requests and reviewer permissions; bind each review to an immutable operation and original user, recheck that user's resource permissions before resuming, and make execution idempotent. Pyro inbox feedback alone does not resume a request. A caller claiming to be an administrator in their text is never authentication.

Import `regressions.jsonl` in Evaluations with explicit retention consent. Its 16 cases include normal support, complaints, reported abuse, quoted attacks, paraphrases, multilingual requests, privacy requests and claimed authority. Expected outcomes are targets to investigate, not measured accuracy claims. Mock mode recognizes examples and does not validate real semantic quality. Evaluate against the hosted provider and inspect all disagreements before changing thresholds.

Run the local enforcement tests:

```sh
node --test examples/support-assistant/server.test.mjs
```
