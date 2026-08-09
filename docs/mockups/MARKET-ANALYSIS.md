# Ouroboros — Market & Gap Analysis

*Researched August 2026 against live product docs and pricing. This document drove
mockup screens 13–17 and the navigation changes in the v0.2 mockup set.*

## Executive summary

The autonomous-coding market has converged on one shape: **assign an issue → agent
works in a vendor cloud sandbox → draft PR → human merges**. Within that shape,
products compete on time-to-first-result, steering ergonomics, and repo-knowledge
systems. Four things Ouroboros was designed around are rare or absent everywhere:
user-composed workflows with **per-stage model routing**, **verification of the PR
against the ticket**, a **closed fix→retest loop** that includes **physical
hardware-in-the-loop testing on user-owned machines**, and **policy-gated
auto-merge**. Those stay the moat.

What the market does better today — and what the v0.2 mockups add — is everything
around the loop: instant onboarding, taught/learned repo knowledge, outcome
analytics, a first-class human-approval surface, and enterprise administration.

## Landscape

| Category | Players | What they've settled on |
|---|---|---|
| Autonomous coding agents | Devin, GitHub Copilot coding agent, OpenAI Codex, Cursor background agents, Google Jules, Factory, OpenHands, Claude Code | Issue/Slack dispatch → vendor cloud VM (setup script + snapshot) → draft PR. Knowledge via markdown files; AGENTS.md emerging as the cross-vendor standard. Devin has the richest managed knowledge/playbooks; Jules wins on free-tier time-to-first-task (15/day free); Copilot wins on zero-infra entry (assign `@copilot`). |
| AI PR review | CodeRabbit, Graphite Diamond, Greptile, Qodo | Two-click app install, first value on the first PR. Learn team style from feedback. **Qodo scores ticket-compliance; CodeRabbit does ticket-aware review** — the only overlap with Ouroboros' verification matrix. Graphite pairs review with merge queue + PR-velocity metrics. |
| Test intelligence | Trunk, BuildPulse, Launchable, Datadog CI Visibility | Flake detection + quarantine + "merge anyway" queues; predictive test selection; DORA dashboards. Lives in a **separate product category** from coding agents — nobody integrates it into the agent loop. BuildPulse's AI opens flaky-fix PRs; Harness Autofix retriggers CI until green — the only closed-loop repair precedents. |
| CI / build substrate | Harness, Buildkite, Depot, BuildBuddy, GH Actions | Buildkite's BYO-compute agent model (Mac minis, GPUs, custom rigs) is the proven pattern for hardware-bound CI — and the pattern Ouroboros' build farm follows. GitHub's 2026 self-hosted-runner pricing turbulence is pushing teams toward exactly this. Depot now sells "sandboxes for coding agents" as a product. |
| AI-native planning | Linear, Atlassian Rovo, Height | Linear's Agent API made it the neutral dispatch hub — competing agents are literally assignees. Rovo meters everything in credits; Height does autonomous PM (triage, dedupe, spec upkeep). |

## The Build Analyzer (screen 18) — claimed whitespace

No product on the market mines a project's **entire build history** and synthesizes
forward-looking changes from it. The closest partial analogs each stop short:
Datadog CI Visibility and Trunk *surface* trends (flake rates, CI time wasted) but
recommend nothing; Harness Autofix repairs a *single failing run*; BuildPulse drafts
fix PRs for *individual flaky tests*; Launchable selects test subsets but doesn't
propose process change. None of them: (a) attribute duration/reliability
change-points to specific merges and config changes across months of history,
(b) draft **build-process changes** with evidence and projected savings, (c) draft
**workflow revisions** (e.g. reorder stages based on observed failure causes), or
(d) generate **new tickets** from historical patterns. Screen 18 mocks all four,
plus the trust mechanism that makes it credible: every applied suggestion is
re-measured for 14 days and the analyzer's predictions are scored against reality.

## Where Ouroboros already leads (keep and emphasize)

| Differentiator | Market status |
|---|---|
| Per-stage LLM routing with fallbacks/escalation, over a **named model registry** (screens 06, 07, 21) | **Nobody among coding agents.** Aliased model configs exist only in gateway infrastructure (LiteLLM, OpenRouter, Portkey) — never surfaced in an agent product's UI, and never bound to per-stage workflow routing. Registry aliases make BYOK real: swap the key or provider behind `coder-max` and no route or workflow changes. |
| PR verified against the ticket — evidence matrix (screen 12) | Only Qodo (compliance score) and CodeRabbit (ticket-aware) approximate it; neither ties evidence to tests/diff hunks. |
| Closed loop: gate fail → correction round → re-test → re-publish (screens 04, 10–12) | Only Harness Autofix and BuildPulse fix-PRs exist, both outside the agent's own loop. |
| Physical HIL testing on user-owned rigs (screens 08, 11) | **Absent from every coding-agent product.** Buildkite proves the BYO-compute demand. |
| Policy-gated auto-merge (screens 12, 16–17) | Universally human-merge today. This is a differentiator *and* a trust risk — hence dry-run defaults and the Needs-you inbox. |
| Visual + code workflow editing, losslessly synced (04–05) | No equivalent; agent behavior is prompt/config files everywhere else. |

## Gap analysis → what was added

| Gap (who does it well) | Disposition in mockups |
|---|---|
| **Time-to-first-value.** Copilot: assign-an-issue, zero infra. Jules: free tier, minutes to first task. CodeRabbit: value on first PR. Env-setup-first products adopt measurably slower. | **NEW screen 13 — Get started.** 4-step wizard, repo auto-detection (build system, devcontainer, tests, protected paths), template workflow gallery, safe first issue, dry-run by default, managed-keys trial credit, hosted runner until you enroll your own. |
| **Repo knowledge & playbooks.** Devin Knowledge/Playbooks (managed, self-improving); AGENTS.md / CLAUDE.md / .cursor/rules as the file convention; Greptile/CodeRabbit learn from review feedback. | **NEW screen 14 — Knowledge.** Skills library, **learned facts with human confirm/reject and expiry** (agent proposes from run evidence), playbooks runnable against any issue, repo profile with env setup + warm snapshots. Imports CLAUDE.md/.cursorrules/AGENTS.md. |
| **Outcome analytics.** Agents ship usage/spend only; acceptance-rate/cycle/DORA live in Datadog, Graphite Insights, Harness SEI. | **NEW screen 15 — Insights.** Autonomous-merge rate, merged-without-edits %, cost per merged PR, cycle-by-stage, model scoreboard (win-rate per task feeding routing suggestions), flaky-test intelligence with quarantine, DORA panel. |
| **Human-approval surface.** Jules' plan-approval-first UX; Devin plan review; Copilot's draft-PR gate; approvals otherwise buried in PR comments/Slack threads. | **NEW screen 16 — Needs-you inbox.** Every blocked decision as a plain-language question with inline actions, answerable from Slack/email/mobile; visible approval policy; median-answer-time stats; zero-state. Topbar "Needs you" pill on every screen. |
| **Enterprise administration.** Devin/Factory: SSO/SCIM/audit; OpenHands: RBAC control plane; Rovo: spend throttling. | **NEW screen 17 — Settings.** Members & roles with IdP group sync, versioned autonomy policies (auto-merge rules, protected paths, spend guards, dry-run), audit log with SIEM streaming, integrations grid, notifications, danger zone with stated consequences. |
| **Chat steering of a running agent.** Devin/Cursor/Factory: Slack mid-thread; Claude/Jules: steer mid-run. | **Improved screen 10** — steer composer in the run console ("guide the loop without taking over"). Slack answering also surfaced in 16. |
| **Env snapshots.** Codex/Jules/Devin/Cursor: setup script + reusable snapshot. | Folded into 13 (auto-detect + "env ready in 38s") and 14 (repo profile: setup script, warm snapshot, nightly rebuild). |
| **Flake quarantine.** Trunk/Datadog quarantine + merge-anyway. | Folded into 15 (flaky-test card) and noted on screen 11. |
| **Workflow templates.** Actions marketplace pattern; agents ship fixed behavior. | Template gallery in 13; "Browse templates" in the workflow studio (04). |
| **Chat-ops.** Devin/Cursor/Factory launch and steer from Slack; Copilot steers via PR comments; Buildkite/CI post pass/fail notifications. But *blocking questions answered in-channel that resume a paused build*, plus a full command set, is assembled nowhere. | **NEW screen 19 — Chat Ops.** Completions published to Slack/Teams, blocking build questions asked and answered in-channel (with Needs-you inbox escalation), the `/ouro` command set, and an AI presence with the same permissions and audit trail as the UI. |
| **Conversational workflow authoring + dry runs.** Nobody offers conversation-built agent workflows; workflow "testing" in CI land means pushing and praying (or `act`-style local runners). Jules shows plan-approval; Codex does best-of-n — neither simulates a whole pipeline against a real issue. | **NEW screen 20 — Workflow Copilot & dry run.** Chat-driven creation compiling to the same graph as the canvas/code views; dry runs with simulated writes, history-replayed builds, and real model calls; the AI proposes workflow improvements from what the dry run reveals (e.g. make a stage conditional), applied to the draft in one click. |

## UX principles adopted (from adoption-speed winners)

1. **First value before first config.** Managed keys + hosted runner + auto-detected
   environment mean the first loop runs with zero setup; BYO keys/farm/rigs are
   refinements, not prerequisites.
2. **Dry-run is the default posture.** Draft PRs, never merges, until the user
   flips policy — the market's universal human-merge norm is honored until trust
   is earned; then Ouroboros goes further than anyone (gated auto-merge).
3. **Progressive disclosure.** "Deep refactor" template locks until 10 merged
   loops; policies read as plain sentences with the mono details underneath;
   advanced editing lives behind "edit as code."
4. **Decisions are questions, not notifications.** The Needs-you inbox phrases
   every human touchpoint as an answerable question with a recommended action —
   30 seconds, then the loop resumes.
5. **The system explains itself with evidence.** Verification matrix, learned-fact
   sources, audit trail — trust through receipts, not through claims.

## Noted but deliberately not mocked (roadmap candidates)

- **Ouroboros as an assignable agent** in Linear/Jira via their Agent APIs (dispatch
  from the tracker, report in-thread) — high-leverage distribution, no new screen needed.
- **MCP server/client support** for tool extensibility (converging standard).
- **Best-of-n parallel attempts** per stage (Codex pattern) — natural workflow-builder
  node option later.
- **Predictive test selection** (Launchable pattern) to shorten HIL cycles.
- **DevinWiki-style auto-documentation** of the repo from loop observations.
- **Credit/ACU-style billing surface** — pricing UX, post-scaffolding decision.
