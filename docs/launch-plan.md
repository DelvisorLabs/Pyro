# Launch and first-user plan

## Who this beta is for

Start with developers operating a self-hosted support assistant or internal agent
who need visible application policies and decision traces. The initial promise
is a working policy workflow they can inspect and tune. Avoid claiming that a
classifier makes arbitrary agents safe or that local smoke-test success proves
semantic prompt-injection coverage.

## Pilot before ads

Recruit five volunteer teams through existing developer relationships, relevant
open-source issue discussions where a maintainer invites solutions, and technical
communities whose rules permit product introductions. Do not mass-message users,
scrape addresses, or post automated endorsements. Ask about their existing
problem before proposing Pyro. Offer help with one staging integration and a
redacted evaluation dataset. No messages or posts have been sent by this change.

Count activation when a team independently starts Pyro, gets an expected local
decision, connects one application, and returns to review/evaluate another batch.
Measure time to first decision, install failures, weekly active applications,
review dispositions and whether someone continues after the assisted session.
Collect these by consent in pilot check-ins; the server has no added phone-home
telemetry. Do not turn downloads or GitHub stars into a retention claim.

Suggested pilot invitation for a human to adapt:

> I'm building Pyro, a self-hosted policy API for prompts and agent tool inputs.
> It has local rules, optional TypeSafe classification, decision traces and a
> workflow for evaluating policy changes. I'm looking for developers willing to
> try one staging integration and tell me where it fails. Would a short setup
> session help with a problem you're already trying to solve?

## Public launch assets

Publish a versioned beta release, an anonymous-pull installation path, a short
screen recording of the local quickstart, the reproducible evaluation report,
data-flow/retention documentation, limitations and a maintainer contact. Demo
allow, review and block outcomes and a provider configuration failure. Show that
review pauses application execution rather than silently proceeding.

Launch a technical write-up explaining one real integration and its measured
failure cases. Consider Show HN only after anyone can try the product immediately;
write the post personally and follow its current rules. Ask relevant Reddit or
Discord moderators before posting when promotion rules are unclear. Post useful
findings and a working example, not repeated launch links. A GitHub discussion
and a changelog can keep early adopters informed without unsolicited messages.

## ₹10,000 advertising budget

Hold the budget until at least three pilot teams activate and two return the
following week. These are proposed decision criteria, not observed traction.
If organic activation works, spend ₹2,000 on a narrowly targeted developer test
with one clear landing page and consent-respecting conversion measurement. Judge
cost per activated integration, not click-through rate. Stop if clicks do not
lead to independent setup; fix the funnel before spending more. Only expand to
another ₹3,000 after the first cohort returns. Keep ₹5,000 for the channel that
produces retained users. No campaigns are created or spend authorized by this file.

## Release checklist

- Merge the reviewed changes; publish the CLI and versioned server images.
- Verify the website downloads reference the released commit or image digests.
- Run an anonymous clean-machine install and a database restore drill.
- Confirm the real deployment's SSO callback, credentials and data terms.
- Run a representative semantic benchmark with an explicitly authorized key and
  paid budget before making accuracy or cost comparisons.
- Interview pilot users and publish only claims supported by their permission
  and recorded results.
