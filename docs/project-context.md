# Pyro project context

Updated October 2, 2026. This is the shared brief for future Pyro conversations and work. It records the founder's direction, separates proposals from decisions, and provides a dated implementation baseline. Read it alongside `AGENTS.md`; the current task determines what work is authorized. Update it when product decisions change.

## Product direction

Pyro is an open-source, self-hostable product for designing, testing, and enforcing policies for AI applications. The founder wants to explore positioning it as **“Design AI policies”**, broadening the framing from an LLM firewall to a policy suite while keeping the underlying primitive focused and useful. This direction does not itself authorize changes to the website or public claims.

The original problem remains central: given user input, determine whether it violates security constraints and whether it semantically matches a set of application rules. Security and business policies can share an interface, but they need different evidence. A profanity match, an off-topic request, and an attempted prompt injection are different findings.

Open source and self-hosting are core advantages the founder wants to build around. The ambition is serious security and eventual enterprise usefulness, with real technical differentiation. A generic decisions API or a wrapper around someone else's classifier does not fulfill the long-term ambition.

The founder accepts that competition exists in almost every worthwhile category and wants to pursue Pyro for at least several months. The objective is demonstrable superiority for a specific use case, rather than finding a category with no competitors.

## First feature to work out: Policy Playground

The founder's first proposed feature is a playground for creating a validation pipeline:

```text
User input
  → Text/regex check: “cuss word check” (a configured word list)
      Match → Block
      No match → Semantic check: “Is it related to my company?”
          Yes → Allow
          No → Block
```

Users should be able to understand the checks, their yes/no branches, and the resulting actions. The founder is exploring the best form factor: a flow diagram is an illustration of the mental model, not a settled requirement for a freeform canvas. A simpler stack of rule blocks may be preferable.

The following design ideas were proposed and remain open:

- Make the versioned, executable policy the core artifact, with consistent behavior across the editor, CLI, SDK, and gateway.
- Start with text checks (literal, word list, regex), semantic conditions, explicit branches, and terminal outcomes. Consider a guided decision tree with automatic layout.
- Give semantic conditions relevant context and positive/negative examples. “Related to my company” needs a definition of the company and acceptable scope.
- Show sample input, the executed path, matched evidence, skipped checks, and the final outcome together.
- Turn incorrect results into saved regression cases and compare behavior across policy revisions.
- Treat uncertainty and execution errors explicitly. A failed semantic check must not silently mean “No.” Whether an unresolved result blocks or goes to review is a policy choice.

These are design candidates, not a completed specification. The discussion did not settle the editor layout, first release scope, or new runtime semantics.

## Long-term engine ambition

The founder explicitly rejected **chaining models together as the core innovation**. They want to create an owned, foundational security/policy engine: a useful primitive in its own right, rather than an orchestration layer presented as a new model.

One research direction discussed was policy satisfaction over language: jointly learn representations of entities, actions, relationships, scope, and authority, then evaluate explicit policy constraints with evidence and uncertainty. Quoted content, negation, requests, and claims of permission should not collapse into the same representation. Authenticated authority must come from trusted application context, not from an input that claims to be authorized.

This is an exploratory thesis. No architecture, training plan, novel scientific contribution, or performance advantage has been established. Related work in structured instruction boundaries, neuro-symbolic reasoning, and policy verification must be investigated before claiming novelty. Useful evaluation targets include unseen policy compositions, paraphrases, counterfactual cases, adversarial inputs, and appropriate abstention.

Keep product delivery and engine research as separate workstreams. The existing semantic provider can support the product while research progresses; the founder has not requested its immediate removal. Future discussions should preserve the engine ambition instead of substituting another model-chain proposal for it.

No input classifier can establish universal safety. Topic compliance does not establish harmlessness, and detecting suspicious text does not itself enforce tool permissions or data access. Enterprise security also requires trusted identity/context, actual enforcement at relevant boundaries, and measured failure behavior.

## Current implementation baseline

As of this brief, Pyro is an Apache-2.0 project with a working beta, not a newly proposed product. It includes a standalone CLI, gateway/API, dashboard, and SDK source packages. Local text/RE2 checks and configurable semantic detectors already exist. Semantic classification currently uses the hosted Jev/TypeSafe integration or a mock; Pyro does not yet have the proposed independent foundational engine. Self-hosting Pyro does not automatically make semantic inference local or offline.

The beta also includes policy revisions and publishing, application pins/canaries, evaluation datasets and revision comparisons, a review inbox, authentication/roles/application grants, and durable queued execution. Consult [feature status](roadmap.md) for implemented behavior and remaining work, and [deployment](deployment.md), [evaluations](evaluations/README.md), and [releases](releases.md) for operational details. Verify code before describing a feature as available.

Existing benchmarks describe particular datasets and configurations; they are not proof of universal attack prevention. Confidence and risk scores must not be presented as calibrated correctness without evidence. An allow/review/block response requires the integrating application to enforce the corresponding action. Do not imply output inspection, tool authorization, independent security validation, production SLOs, or complete multi-tenant enterprise support merely from the policy-suite positioning.

## Cloud implementation (October 2, 2026)

The founder authorized implementing an optional managed cloud version with organizations and API-key SDK access, while preserving self-hosting and the offline CLI. The investment envelope is ₹1 lakh for at least six months including later marketing. The local implementation now includes accounts/recovery/invitations, organization memberships/roles, PostgreSQL RLS, scoped runtime instances, prepaid credits and provider budget admission, optional signed payment capture, organization export/deletion and a single-VM deployment/backup runbook. See [cloud architecture and operations](cloud.md).

This is a capped beta architecture using the existing document stores; it is not a deployed service, proven business, independently security-audited product or enterprise scale/availability guarantee. Public DNS, provider/email/payment accounts, operational alerting/backups, public terms/pricing and real integration smoke tests remain operator launch prerequisites. No publish or deployment was authorized by this implementation task.

## Commercial plan and constraints

The founder has a full-time job. Pyro is a serious side project, with roughly a month of polishing envisioned before outreach and attempts at sales, followed by several months of continued work. That is a reasonable pilot horizon, not a commitment to enterprise completeness or a prediction of revenue.

The advice discussed was to focus that month on a reliable install, one compelling policy-design/testing workflow, a real integration example, useful traces and regression cases, and documentation that lets outsiders try it. Early conversations during development were recommended; the founder has not committed to a specific outreach schedule.

An initial audience of teams building customer-facing AI/support assistants was suggested, but the first buyer and use case remain undecided. Scoped paid pilots, deployment help, and support are possible revenue models. Managed hosting now has a local implementation and launch runbook; final pricing, support commitments, customer targets and traction have not been established. Suggested validation milestones—external evaluations, a recurring real integration, and a paid pilot—are goals, not achieved results.

## Competitive context

Policy enforcement is competitive. [Portkey guardrails](https://portkey.ai/docs/product/guardrails), [AWS Bedrock Automated Reasoning checks](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-automated-reasoning-checks.html), and [Lakera policies](https://docs.lakera.ai/docs/policies/saas-policies) illustrate overlapping capabilities. Their existence does not establish that demand is saturated. A visual editor alone is unlikely to be sufficient differentiation; installation, policy usability, observable behavior, evaluation quality, privacy, and technical capability need specific evidence.

One correction to preserve: the October 1, 2026 check found Portkey's public gateway repository still MIT-licensed and not archived, with its latest observed default-branch commit dated May 25, 2026. Reduced public activity does not mean it stopped being open source. See the [gateway repository](https://github.com/Portkey-AI/gateway) and recheck its status before making a current comparison.

## Decisions still open

- First customer, concrete workflow, and measurable advantage to optimize for.
- Policy Playground's editor form, initial checks/actions, and handling of unknown/error outcomes.
- How plain-language policies become precise, testable behavior and how policy conflicts resolve.
- Research architecture, datasets, evaluation criteria, and eventual inference/deployment model.
- Paid offering and support scope compatible with a founder working alongside a full-time job.

For implementation, preserve the repository agreements: use pnpm, keep the CLI usable without Docker or a server, keep Docker optional for shared features, reuse the existing visual identity and components, and audit sibling UI when making consistency fixes. Make local commits; pushing, PRs, merging, publishing, and deployment require an explicit request.
