import type { UserRecord } from "@pyro/contracts";

export const TOUR_VERSION = "pyro-tour-v1";
export const TOUR_STEPS = [
  { page: "overview", target: '[data-tour="metrics"]', title: "Your policy workspace", description: "See request volume, decisions and latency at a glance. Pyro returns allow, review or block; your application decides how to enforce that result." },
  { page: "playground", target: '[data-tour="new-pipeline"]', title: "Design and test a policy", description: "In Policies → Playground, create a pipeline of text or semantic checks with explicit Yes / No outcomes. Test a draft, inspect its path and save useful inputs as regression cases." },
  { page: "evaluations", title: "Check changes against real cases", description: "In Policies → Evaluations, run an expected-outcome dataset against one or two revisions. Compare mistakes before rolling out a change. Semantic runs require paid-use consent." },
  { page: "history", title: "Publish with a rollout plan", description: "Policies → History keeps immutable revisions. Publish a tested revision, pin an application to it or try a percentage canary. Restore an older configuration by publishing it again." },
  { page: "apps", target: '[data-tour="create-app"]', title: "Connect policies to applications", description: "Give each application a default policy and its own limits. Application text rules run before policy checks, so shared rules still apply to every request." },
  { page: "keys", target: '[data-tour="create-key"]', title: "Integrate from your backend", description: "Create an application-scoped API key for the gateway or SDK. Keep it on your server. Continue only on allow; hold review and reject block in your integration." },
  { page: "reviews", target: '[data-tour="review-filters"]', title: "Close the feedback loop", description: "Triage held decisions in Review inbox. Use Activity for individual traces and Usage for consumption. Export useful review cases to improve your evaluation dataset." },
] as const;
export type TourPage = typeof TOUR_STEPS[number]["page"] | "activity" | "usage";
export type TourStep = { page: TourPage; target?: string; title: string; description: string };
export function tourSteps(role: UserRecord["role"]): TourStep[] {
  if (role === "admin") return [...TOUR_STEPS];
  const pages = role === "operator" ? ["overview", "evaluations", "keys", "reviews"] : ["overview", "evaluations", "reviews"];
  return [
    ...TOUR_STEPS.filter((step) => pages.includes(step.page)).map((step) => ({ ...step,
      description: step.page === "evaluations" && role !== "operator" ? "Inspect dataset results and revision comparisons in Policies → Evaluations. An administrator or operator can run evaluations; your access determines which applications you can see." : step.page === "reviews" && role === "viewer" ? "Inspect held decisions and their trace context. Reviewers, operators and administrators resolve cases; your application grants determine which records you can see." : step.description,
    })),
    { page: "activity", title: "Understand each decision", description: "Filter Activity to inspect allow, review and block outcomes, the policy revision and the signals behind a decision. Input previews depend on your permissions and retention settings." },
    { page: "usage", title: "Keep an eye on consumption", description: "Use Usage to understand requests and provider consumption. Your tour is complete; open Documentation whenever you need a deeper guide." },
  ];
}
