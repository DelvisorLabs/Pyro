# Reproducible evaluation

The committed [local smoke report](local-smoke-report.json) was produced with:

```sh
pnpm install --frozen-lockfile
pnpm build:packages
pnpm evaluate --output docs/evaluations/local-smoke-report.json
```

It checks 20 synthetic examples against the local-secrets policy. It tests the
configured PEM/token rules, structured input handling, and benign controls. All
20 matched their expected policy actions in this run. It made **zero external
provider calls**. This is a regression fixture, not an estimate of detection
accuracy on real attacks. Timing is measured on one development machine and is
not a production latency promise. The JSON includes dataset and policy hashes,
per-category confusion matrices, disagreements, p50/p95 latency, and reported
costs. These examples were written for this repository and use synthetic tokens.

For semantic evaluation, start with `evaluations/semantic-starter.jsonl`, expand
it with representative redacted inputs and independently labeled benign cases,
and keep a held-out dataset that is not used for tuning. The small starter set
is a test of the workflow, not a credible security benchmark. No semantic result
is published here: a TypeSafe key and a paid run are still required.

```sh
TYPESAFE_API_KEY=... pnpm evaluate \
  --profile profiles/balanced.yaml \
  --dataset evaluations/semantic-starter.jsonl \
  --allow-paid --min-accuracy 0.9 --max-false-positive-rate 0.05 \
  --output semantic-report.json
```

Set the key through your secret manager or shell environment; don't commit it.
Inputs are sent to the configured provider. The command disables retries and
requires explicit paid consent. Choose regression budgets for your application;
the example values above are not measured guarantees. CI runs the local fixture
with accuracy 1, false-positive budget 0, and zero indeterminate outcomes, and
exits nonzero when a budget is exceeded. Accuracy counts indeterminate outcomes
as incorrect, even if fail-closed produces the expected block action. Provider
costs are reported only when supplied; missing costs remain unknown, never zero.

The dashboard Evaluation lab imports versioned JSONL datasets, records exact
published policy revisions and application-rule snapshots, and compares up to
two revisions. It shares `evaluatePolicy` with the gateway, without production
event/webhook side effects or shadow calls. Dataset inputs are encrypted and
retained for an explicitly chosen 1, 7 or 30 days; reports expire with the dataset.
Manual deletion removes inputs and cancels active runs. Export a report before
expiry if you need a longer-lived record. Do not import production secrets.

Evaluations run on a separate, single-worker durable queue. Progress is saved
after each case/revision. Cancel stops between calls, and resume continues saved
rows; an interrupted upstream call may execute again and incur another charge.
Runs have a 15-minute worker deadline and can resume while the dataset remains.
Paid runs show an upper bound on provider attempts and explicitly state that
price is unknown. Repeated imports create new dataset versions; they never edit
old inputs. Provider/model settings are snapshotted, but a mutable upstream alias
such as `jev-latest` cannot guarantee identical future model behavior. Use a
versioned model identifier when your provider offers one.
