# Curated profiles

Each `.yaml` file is an opt-in, editable configuration, loaded by the control plane at startup. Files must use `apiVersion: pyro/v1`, `kind: Profile`, and the complete `profile` configuration. Add a validated file here and restart the control plane to expose it in the catalog. Docker includes this folder.

| Profile | Purpose |
| --- | --- |
| balanced-assistant | General prompt-injection and exfiltration checks with common local review rules |
| strict-tool-agent | Lower thresholds and checks for destructive commands and privileged tool names |
| support-assistant | Prompt injection, data disclosure and bypassing account verification |
| local-secrets | Common private-key/token shapes using local regex only; no inference |

These are starting points, not benchmarked guarantees. Adapt tool names and patterns, and evaluate false positives and misses using representative application traffic before enforcing them.

The dashboard lets you review a preset, edit it, and save a copy. Presets never silently alter active profiles. Import/export is also available as YAML. Export omits database timestamps and clears deployment-specific shadow references; reattach shadows after import. Direct API import preserves the supplied ID and rejects ID/name conflicts with HTTP 409. The dashboard reviews an import as a new draft and generates an ID from its name on save.

Profile and application local rules are combined, not overridden by matching IDs. Block wins over review, then higher risk wins. Exact ties keep application order before profile order. Decision signal IDs include `local_rule:app:` or `local_rule:profile:` to distinguish ownership. Old profiles without `localRules` normalize to an empty array. Rules support `contains`, `equals`, and RE2 `regex`, and `all_text`, `raw_json`, or `tool_name` scopes. Regular expressions are patterns without slash delimiters; lookaround and backreferences are rejected when saving/importing.

A profile may contain local rules with zero semantic detectors. If no local or application rule matches and no semantic detector is enabled, the gateway allows the request locally. Disabling all semantic detectors has the same effect; select fail-closed policies with semantic detectors when provider failures should block. The configured fail mode applies only when provider evaluation fails.

YAML imports are limited to 256 KB, reject duplicate mapping keys, unsupported tags and aliases, and validate thresholds, rule patterns and unique rule/detector IDs. Profile imports do not contain destinations, signing keys, or provider credentials.
