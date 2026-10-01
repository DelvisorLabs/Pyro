# Design, test and run a policy

Implemented in the October 2, 2026 source build. This workflow is not a claim that a new CLI/SDK package or public cloud service has been released. Existing signal-based policies remain supported with their previous behavior.

## Workflow

The **Policies** sidebar destination groups **Library**, **Playground**, **History** and **Evaluations**. Policy editing sections are administrator-only; other roles retain their evaluation access.

1. Open **Policies → Playground → New pipeline**. The starter uses a fictional Northstar support company; replace its context and examples.
2. Choose an application. Its local rules execute first, as they do for gateway traffic.
3. Arrange up to 16 checks in order. Each check has a stable ID, a name and explicit Yes/No branches. Add text checks or semantic conditions; move or remove them using the shared controls.
4. Set the final outcome, uncertainty behavior and error behavior. Choose review or block for uncertainty/errors.
5. Enter an input, authorize any semantic-provider charges, and choose **Test draft**. A preview runs this exact working copy without publishing it or retaining an input/decision event. Normal authentication audit records and usage charges still apply.
6. Inspect the path. Set an expected outcome and add a regression case. Save the accumulated set as an encrypted, seven-day dataset, or download JSONL. Cases stay in browser memory until saved/downloaded; each save creates a version containing the current set, not an append to a prior version.
7. Publish the policy, or save an existing policy's draft without publication. Publication creates an immutable active revision. Test saved datasets against published revisions in **Evaluation lab**; manage pins/canaries and old drafts in **Policy history**.
8. Bind the published policy to an application and key, or export YAML to run locally. A preview alone does not modify the application's policy bindings.

The same schema and execution engine are used by draft tests, CLI, gateway, queued jobs, SDK requests and evaluation runs. The runtime API keeps the existing `profile` parameter and `pyro/v1` `Profile` document wrapper for compatibility. Pipeline files require a build supporting `pipeline.version: 1`; older clients should not be used to edit these policies.

## Check and branch semantics

A pipeline policy has `pipeline` and empty legacy `detectors`/`localRules` arrays. The server rejects mixed configurations, duplicate check IDs, invalid RE2 expressions, more than 16 checks, and overlapping Yes/No thresholds.

- **Text:** contains, equals, RE2 regex, or a whole-word list. Checks inspect string values recursively in text, JSON and conversation inputs. Exceeding the 50,000-value traversal bound produces an error outcome, never a clean No branch. Word lists match Unicode letter/number/underscore tokens, not substrings; casing is configurable. They are literal configuration, not a universal profanity detector or a normalization/obfuscation defense.
- **Semantic:** a Yes/No question plus trusted policy context and positive/negative examples. Input stays in a separate untrusted payload. Each reached semantic check sends one request to the configured provider, with retries if enabled. No threshold defaults to 0.2 and Yes to 0.8. Scores strictly between them are uncertain. Examples guide the request; they do not train or establish an independent Pyro model.
- **Branches:** `continue` moves to the next check; `allow`, `review` or `block` stops and marks remaining checks skipped. If every reached branch continues, `otherwise` supplies the action. No backward edges, loops, or arbitrary node targets are supported in this first version.
- **Uncertainty/failure:** stop immediately with `onUncertain` or `onError`, both restricted to review/block. A timeout, missing answer or provider failure is never a No branch. The legacy `failMode` field does not override a pipeline's error outcome. Budget/authorization admission failures still return an HTTP error and cannot become an allow.
- **Application rules:** retain their existing priority before the pipeline. A matching application rule appears in the trace and skips all pipeline checks. Standalone CLI uses the bundled default application's rules; a server app with additional rules may therefore produce different outcomes. Exporting a policy does not export application bindings/rules.

The timeout applies across sequential semantic checks, with each reached check using the remaining budget. Existing input limits and cloud admission remain in force. Preview is administrator-only, with two concurrent tests and 30 admitted tests/minute per deployment/organization. Cloud model locks and provider budget/credit hooks apply to previews, published policies and evaluations.

## Result contract

Pipeline decisions add `decisionMode: "pipeline"` and `policyTrace`. Each trace entry includes its ID/name/type, `outcome` (`match`, `no_match`, `uncertain`, `error`, `skipped`), the selected `next` branch, and an evidence description. Text evidence names the configured term/pattern; it does not copy input. Semantic evidence is the returned condition score and threshold comparison, not quoted evidence or a correctness guarantee. Uncertain/error decisions have `verdict: "indeterminate"` regardless of the review/block action.

For compatibility, `risk` is the final action's encoding (allow=0, review=0.5, block=1), and `confidence` is 0. Neither is a calibrated probability. Condition scores stay in the trace, outside risk-detector aggregates. Use `action` and the trace to interpret pipeline decisions. Existing webhook minimum-risk filters still operate on that numeric encoding; use action filters when configuring pipeline notifications.

Provider usage is aggregated across reached checks only. Missing cost reports remain unknown, never zero. Cloud debits each reached semantic check separately; retries/recovered jobs reuse its stable charge identity. Every provider attempt still reserves supplier budget. Skipped checks incur no provider call. Evaluation estimates include all possible semantic checks and retries; short-circuiting can reduce actual usage.

## Portable example

The [support workflow](../profiles/support-workflow.yaml) is available in the policy library. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
# TYPESAFE_API_KEY required; authorizes sending the input to TypeSafe.
pnpm pyro classify "How do I change my Northstar billing plan?" \
  --semantic --profile-file ./profiles/support-workflow.yaml
```

For an offline policy, remove semantic steps, choose the final outcome, and omit `--semantic`. The CLI refuses semantic policies without explicit consent even when an earlier text check might short-circuit this particular input.

In a server application:

```ts
const decision = await pyro.classify(userInput, { profile: "support-workflow" });
if (decision.action !== "allow") {
  // Hold for review or reject according to your application's workflow.
  return;
}
// Proceed only within separately enforced permissions and tool restrictions.
```

Mock mode recognizes exact positive/negative examples and returns an uncertain score for other semantic inputs. It is useful for checking branches locally, not measuring semantic accuracy. Security constraints and business scope remain different claims: a company-related message is not necessarily safe, and a user's statement of authority does not grant it.

## HTTP previews

`POST /api/playground` accepts `{ profile, appId, input, allowPaid }`, returning a decision with `preview: true` and a policy hash. `profile` is the complete profile object, including timestamps, as returned by the control plane. Set `allowPaid: true` for a real semantic provider. This route does not evaluate shadow policies; use gateway traffic for those.

`POST /api/playground/export` accepts `{ profile }` and returns `{ yaml }`. Published export and draft/publication endpoints remain available. Both preview endpoints use dashboard session authentication, with organization membership resolved server-side in cloud deployments.

The matching CLI commands are `pyro profiles test --data @preview.json` and `pyro profiles export-draft --data @draft.json`. They use the same request bodies and saved dashboard session; `pyro classify --profile-file` remains the standalone path.
