# Ouroboros: Technical Overview (RC1)

*As of 2026-11-02 · Kenji Suenobu*

Ouroboros is an autonomous software delivery loop: issues go in, verified pull requests
come out. With Release Candidate 1 complete (all 44 issues in
[`ROADMAP_OOE_RC1.md`](ROADMAP_OOE_RC1.md) closed), it runs a real loop end to end. A
GitHub issue is picked up, a published workflow drives a model through planning and
implementation, a build runs on your own hardware, and a draft pull request opens.

It is named for the snake that eats its own tail: what one run learns feeds the next.

## How it works

Each issue becomes a **run** that follows a versioned **workflow** of stages.

1. **Intake.** Issues sync from a connected GitHub repository and are sized XS to XL.
   Planning can also draft tickets from a paragraph of prose.
2. **Queue and admission.** A person with loop approval confirms the issue. A single
   admission check then verifies the deployment switch, the workspace's concurrency
   ceiling, a published workflow and an invocable model route.
3. **Execution.** The engine checks the repository out into a per-run workspace. Each
   stage (analyze, plan, implement, self-review) calls the model its routing assigns,
   under per-stage permissions and guardrails.
4. **Build and test.** The change builds on **runners**, a small Go agent that you install
   on your own machines and that dials out to the farm. A failure sends the run back to an
   earlier stage.
5. **Publish.** Attributed commits are pushed to a single branch and a draft pull request
   opens. A verification page checks it against gates and an acceptance-criteria matrix
   backed by evidence.
6. **Learn.** Confirmed facts go into Knowledge. Insights and the Build Analyzer show
   where loops spend time and where they still need people.

When a loop needs a person, it stops and asks through the **Needs You** inbox or Slack.
Owners can pause, steer, abort or take a run over in an IDE from the run console.

**Under the hood:** a Next.js UI, a NestJS gateway that alone owns tenancy and database
access, a Python/FastAPI execution engine, PostgreSQL 17 and the Go runner. Models route
through a registry to Anthropic, any OpenAI-compatible endpoint or a local Ollama host.
See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full design.

## What it offers

**For organizations**, Ouroboros turns a backlog into reviewed pull requests while
control stays in-house.

- **Your hardware, your models.** Builds run on runners you enroll; inference can stay on
  a local Ollama host or your own endpoint.
- **Safe by default.** New workspaces start in dry-run, so every pull request is a draft
  and nothing merges. Live runs need explicit confirmation and respect a concurrency
  ceiling (one by default).
- **Governance in one place.** Tenancy, roles, audit logging and provider-terms checks
  live in a single gateway. Credentials whose terms forbid automated use are refused at
  connect time.
- **Visibility.** Mission Control, Insights and the Build Analyzer show cost, time and
  where people intervene.

**For individuals**, it is a teammate that takes the routine tickets.

- Queue an issue and review a draft PR, rather than writing the change.
- Answer the loop's questions from the inbox or Slack instead of watching it.
- Edit workflows visually in the Workflow Studio, as code, or with the Workflow Copilot,
  then rehearse them with a dry run before they touch a model.

## Feature status

Everything on the RC1 milestone is closed, so the live loop works end to end up to a
draft pull request. Merging on its own and the wider controls around the loop come next.

| Capability | Status | Notes |
| --- | --- | --- |
| GitHub issue intake, sizing and AI ticket drafting | ✅ Works today | Issues screen, Planning |
| Workflow Studio, workflow-as-code, Workflow Copilot and dry-run rehearsal | ✅ Works today | Runs pin the version published at queue time |
| Model registry and routing | ✅ Works today | Anthropic API, OpenAI-compatible endpoints, Ollama |
| Live-run admission, confirmation and concurrency ceiling | ✅ Works today | Off until the deployment switch is set |
| Agent execution in a per-run workspace | ✅ Works today | Claude Agent SDK stage executor, with guardrails |
| Build farm on customer-owned runners | ✅ Works today | Go agent; real source checkout and builds |
| Attributed branch push and draft pull request | ✅ Works today | Draft only, under the dry-run policy |
| PR verification gates and acceptance-criteria matrix | ✅ Works today | Human approval gate included |
| Needs You inbox, run console controls and Slack ChatOps | ✅ Works today | Pause, steer, abort, take over in IDE |
| Knowledge, Insights, Build Analyzer and Research | ✅ Works today | Plus the documentation site |
| Autonomous merge when every gate is green | RC2 | [#375](https://github.com/NobuData/ouroboros/issues/375) |
| Second-model review gate | RC2 | [#371](https://github.com/NobuData/ouroboros/issues/371) |
| Provider-neutral tool loop and CLI harness adapters | RC2 | [#1309](https://github.com/NobuData/ouroboros/issues/1309), [#1306](https://github.com/NobuData/ouroboros/issues/1306); unlocks Copilot and Cursor |
| Agent stages on runners, best-of-n and coordinator runs | RC2 | [#1305](https://github.com/NobuData/ouroboros/issues/1305), [#1323](https://github.com/NobuData/ouroboros/issues/1323), [#1324](https://github.com/NobuData/ouroboros/issues/1324) |
| Reference benchmark with a stated success rate | RC2 | [#1329](https://github.com/NobuData/ouroboros/issues/1329) |
| Agent runtime security and spend governance | RC2 | Sandboxing, budgets and spend approvals ([`ROADMAP_AGENT_RUNTIME_SECURITY.md`](ROADMAP_AGENT_RUNTIME_SECURITY.md), [`ROADMAP_SPEND_GOVERNANCE.md`](ROADMAP_SPEND_GOVERNANCE.md)) |
| Trust Centre and enterprise readiness | RC2 | Compliance evidence, enterprise pilot ([`ROADMAP_TRUST_CENTRE.md`](ROADMAP_TRUST_CENTRE.md), [`ROADMAP_ENTERPRISE_READINESS.md`](ROADMAP_ENTERPRISE_READINESS.md)) |
| Editions and billing | RC2 | Packaging and metering ([`ROADMAP_EDITIONS_AND_BILLING.md`](ROADMAP_EDITIONS_AND_BILLING.md)) |
| Protocols and surfaces, Marketplace | RC2 | Additional integrations and shareable workflows ([`ROADMAP_PROTOCOLS_AND_SURFACES.md`](ROADMAP_PROTOCOLS_AND_SURFACES.md), [`ROADMAP_MOCKUP_23_MARKETPLACE.md`](ROADMAP_MOCKUP_23_MARKETPLACE.md)) |

RC2 has no milestone yet. The RC2 rows are the work the RC1 plan names as next: the
Live Loop v2 issues and the milestones it left out.
