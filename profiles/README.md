# Curated profiles

Each `.yaml` file is an opt-in, editable configuration, loaded by the control plane at startup. Files must use `apiVersion: pyro/v1`, `kind: Profile`, and the complete `profile` configuration. Add a validated file here and restart the control plane to expose it in the catalog. Docker includes this folder.

| Profile | Purpose |
| --- | --- |
| balanced-assistant | General prompt-injection and exfiltration checks with common local review rules |
| strict-tool-agent | Lower thresholds and checks for destructive commands and privileged tool names |
| support-assistant | Prompt injection, data disclosure and bypassing account verification |
| local-secrets | Common private-key/token shapes using local regex only; no inference |

These are starting points, not benchmarked guarantees. Adapt tool names and patterns, and evaluate false positives and misses using representative application traffic before enforcing them.

## Add a semantic detector

Start with the [CLI detector tutorial](../packages/cli/README.md#3-add-a-semantic-detector)
and its complete [support policy](../docs/examples/support-policy.yaml). Configure
`TYPESAFE_API_KEY`, add a question under `profile.detectors`, and run the file with
`pyro classify --semantic --profile-file ./support-policy.yaml "Text to inspect"`.
Each detector needs a unique ID, name, description, yes/no question, enabled flag,
and weight. Phrase the question so "yes" indicates risk. Start with weight `1`
and tune the policy's review/block thresholds against both normal and risky inputs.

In the dashboard, configure **Settings → Classifier provider** first. Then open
**Protection Profiles**, create or edit a policy, and choose **Add detector**.
Enter the fields, enable the detector, and choose **Create policy** or **Save policy**.
Use **Playground** to test it. All enabled detector questions are evaluated together
in one TypeSafe request; a matching local rule returns a decision before that call.

## Importing and evaluating profiles

The dashboard lets you review a preset, edit it, and save a copy. Presets never silently alter active profiles. Import/export is also available as YAML. Export omits database timestamps and clears deployment-specific shadow references; reattach shadows after import. Direct API import preserves the supplied ID and rejects ID/name conflicts with HTTP 409. The dashboard reviews an import as a new draft and generates an ID from its name on save.

Profile and application local rules are combined, not overridden by matching IDs. Block wins over review, then higher risk wins. Exact ties keep application order before profile order. Decision signal IDs include `local_rule:app:` or `local_rule:profile:` to distinguish ownership. Old profiles without `localRules` normalize to an empty array. Rules support `contains`, `equals`, and RE2 `regex`, and `all_text`, `raw_json`, or `tool_name` scopes. Regular expressions are patterns without slash delimiters; lookaround and backreferences are rejected when saving/importing.

A profile may contain local rules with zero semantic detectors. If no local or application rule matches and no semantic detector is enabled, the gateway allows the request locally. Disabling all semantic detectors has the same effect; select fail-closed policies with semantic detectors when provider failures should block. The configured fail mode applies only when provider evaluation fails.

YAML imports are limited to 256 KB, reject duplicate mapping keys, unsupported tags and aliases, and validate thresholds, rule patterns and unique rule/detector IDs. Profile imports do not contain destinations, signing keys, or provider credentials.
