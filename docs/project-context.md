# Pyro project context

Updated October 2, 2026. This is the shared brief for future Pyro conversations and work. It records the founder's direction, separates proposals from decisions, and provides a dated implementation baseline. Read it alongside `AGENTS.md`; the current task determines what work is authorized. Update it when product decisions change.

## Product direction

Pyro is an open-source, self-hostable product for designing, testing, and enforcing policies for AI applications. The founder authorized the migration to **“Design AI policies”** and corresponding Pyro website changes on October 2, 2026. The framing broadens from an LLM firewall to a policy suite while keeping the underlying primitive focused. This authorization covers local implementation; publishing still requires a separate request.

The original problem remains central: given user input, determine whether it violates security constraints and whether it semantically matches a set of application rules. Security and business policies can share an interface, but they need different evidence. A profanity match, an off-topic request, and an attempted prompt injection are different findings.

Open source and self-hosting are core advantages the founder wants to build around. The ambition is serious security and eventual enterprise usefulness, with real technical differentiation. A generic decisions API or a wrapper around someone else's classifier does not fulfill the long-term ambition.

The founder accepts that competition exists in almost every worthwhile category and wants to pursue Pyro for at least several months. The objective is demonstrable superiority for a specific use case, rather than finding a category with no competitors.

## Policy Playground implementation (October 2, 2026)

The founder requested implementation of this brief, including the website. The first implementation uses a guided stack of up to 16 ordered checks. Text contains/equals/whole-word/RE2 checks and semantic conditions have explicit Yes/No branches. Continue advances to the next check; allow/review/block terminates. Uncertain and failed semantic checks stop with an explicit review/block outcome. Company context and positive/negative examples inform the existing semantic provider.

The dashboard supports testing a working copy before publication, inspecting executed/skipped checks, saving expected outcomes as encrypted regression datasets, YAML export, and revision publication. The same shared schema/engine executes through CLI, gateway, queued jobs, SDKs and evaluations. Existing signal-based policies preserve their behavior and application rules run before either policy type. See [Policy Playground semantics](policy-playground.md).

These are implementation choices for the first version, not evidence of a novel model or enterprise security assurance. A freeform graph is not implemented. Text trace evidence names configured terms/patterns without retaining raw input; semantic traces show scores and thresholds, not grounded evidence attribution. Condition scores are not calibrated correctness. The source feature and website changes remain unpublished until explicitly released.

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

Plain `docker compose up -d --build` still starts the self-hosted mode. `pnpm cloud:local` starts an isolated cloud preview at http://127.0.0.1:3001 with mock inference and local email, so organizations and account flows can be tried without production provider accounts. In either mode, **Policy Playground → New pipeline** opens the guided editor; rebuilding preserves existing signal-based policies rather than converting them automatically.

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
- Further Policy Playground graph/editor needs and semantic evidence attribution beyond the implemented guided stack.
- Automatic compilation of plain-language policies; the current editor requires explicit checks/branches and first-terminal-outcome semantics.
- Research architecture, datasets, evaluation criteria, and eventual inference/deployment model.
- Paid offering and support scope compatible with a founder working alongside a full-time job.

For implementation, preserve the repository agreements: use pnpm, keep the CLI usable without Docker or a server, keep Docker optional for shared features, reuse the existing visual identity and components, and audit sibling UI when making consistency fixes. Make local commits; pushing, PRs, merging, publishing, and deployment require an explicit request.
