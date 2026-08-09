# Ouroboros — UI Mockups

Static HTML mockups for the Ouroboros application: an AI system that picks up GitHub
issues, performs the work through user-designed workflows, routes each kind of task to a
configured LLM, builds on a remote build farm, and checks the result in automatically.

Screens 13–17 and the expanded navigation (Knowledge, Insights, the Needs-you pill,
settings gear) come from a competitive gap analysis — see `MARKET-ANALYSIS.md` for the
research and the gap → screen mapping.

**Open `index.html` in a browser and click through** — every screen links to its
neighbors via the top-bar navigation and the footer, so the set works as a guided tour.
The pages are pure HTML/CSS (no build step, no JavaScript libraries); fonts load from
Google Fonts when online and fall back to system faces offline.

## Screens

| # | File | Screen | Shows |
|---|------|--------|-------|
| — | `index.html` | Cover / gallery | Entry point linking every screen |
| 01 | `01-login.html` | Sign in & tenancy | GitHub OAuth, enterprise SSO domains, org/repo enablement |
| 02 | `02-dashboard.html` | Mission control | Live loops, queue, merge rate, token spend |
| 03 | `03-issues.html` | Issue intake & sizing | Backlog with AI effort estimates (XS–XL), suggested workflow + model, queueing |
| 04 | `04-workflow-builder.html` | Visual workflow builder | Node canvas: trigger → analyze → plan → implement → build → test → review → gate → PR, with the fail-gate looping back (the ouroboros) |
| 05 | `05-workflow-code.html` | Workflow as code | Monaco-style IDE over a typed loop DSL, kept in lossless sync with the canvas |
| 06 | `06-model-routing.html` | Model routing | Task-kind → primary/fallback model matrix, escalation rules, provider health, spend |
| 07 | `07-providers.html` | Providers & keys | Key vault for Anthropic, Cursor, GitHub Copilot, OpenAI-compatible (vLLM), Ollama |
| 08 | `08-build-farm.html` | Build farm | Remote runner pools, enrollment via outbound-only agent, live build log |
| 09 | `09-planning.html` | Roadmaps & ticket generation | Prose → drafted tickets for GitHub/Jira/Linear, backlog health, epic roadmap |
| 10 | `10-run-detail.html` | Run console | One loop up close: stage timeline, agent transcript with diffs, guardrails, take-over controls |
| 11 | `11-test-results.html` | Test results | Per-build results incl. physical HIL bench tests (measured vs. expected), failure triage, correction rounds sent back to the loop |
| 12 | `12-pr-verification.html` | PR verification | Verification gates + acceptance-criteria evidence matrix ("does the PR do what the ticket says"), revision cycle to auto-merge |
| 13 | `13-onboarding.html` | Get started | First-run wizard: repo auto-detection, workflow templates, safe first issue, dry-run defaults, trial keys |
| 14 | `14-knowledge.html` | Knowledge | Skills, playbooks, learned facts with confirm/reject + expiry, repo profile & env snapshots |
| 15 | `15-insights.html` | Insights | Merge rate, cost per PR, cycle by stage, model scoreboard, flaky-test intelligence, DORA panel |
| 16 | `16-inbox.html` | Needs-you inbox | Human-in-the-loop decisions as answerable questions; Slack/email/mobile routes; approval policy |
| 17 | `17-settings.html` | Workspace settings | Members/roles, versioned autonomy policies, audit log, integrations, notifications, danger zone |
| 18 | `18-build-analyzer.html` | Build Analyzer | AI mines full build history: change-point attribution, suggested build processes & workflow revisions, drafted tickets, predicted-vs-measured outcomes |
| 19 | `19-chatops.html` | Chat Ops | Completions published to Slack/Teams, blocking build questions answered in-channel, `/ouro` command set, conversational AI control of the system |
| 20 | `20-workflow-copilot.html` | Workflow Copilot & dry run | Create/manage workflows through conversation; dry-run any workflow against a real issue with zero side effects; AI suggests improvements from the run |
| 21 | `21-model-registry.html` | Model registry | Allowed models as uniquely named aliases (provider + model + params); routing references aliases only — swap keys/providers behind an alias with zero downstream edits (BYOK) |

## Design system

Everything shares `assets/ouroboros.css`, derived from the brand logo
(`logo-unsplit.png` in the repo root — electric-cyan circuit snake on charcoal):

- **Committed dark identity** — ground `#12181d`, surfaces `#171f26`, ink `#e9f2f6`.
- **Accent** electric cyan `#3dd6f5`; its glow is reserved for *live* things (running
  loops, primary actions, the active nav item). Semantic green/amber/red and a violet
  hue for model/LLM chips stay distinct from the accent.
- **Type** — Chakra Petch (display/headings), IBM Plex Sans (UI), IBM Plex Mono (data,
  code, identifiers).
- **Logo assets** — `assets/logo-mark.png` (snake) and `assets/logo-lockup.png`
  (snake + wordmark), cropped from the dark half of the brand sheet; rendered with
  `mix-blend-mode: screen` so they sit on any dark surface.

All product data on the screens is fictional demo content (tenant `acme-robotics`,
repo `helios-firmware`, a Zephyr RTOS robotics firmware project) chosen to make the
screens read as a working system.

## Deliberately shown in the mockups

- Effort estimation as a first-class citizen (XS–XL chips + confidence, work breakdown).
- Workflows editable both visually and as code, with the *same* loop shown in both.
- Per-task-kind LLM routing with fallback chains, escalation rules, and cost caps.
- Build farm as customer-owned machines enrolled with an outbound-only agent.
- Physical verification: hardware-in-the-loop bench tests with measured-vs-expected
  readouts, per-build test results, and failure triage that feeds correction rounds
  back into the loop.
- PR verification as evidence: every claim in the ticket mapped to a concrete test or
  diff hunk before merge, across publish → verify → correct → re-publish revisions.
- Guardrails on autonomous runs (path confinement, secrets scan, merge policy).
- Tenancy: domain-based enterprise sign-in, per-tenant key vault, org/repo scoping.

## Not yet mocked (future passes)

Spend analytics detail, audit log, notification settings, multi-repo fleet views,
mobile layouts, and the light theme (the brand sheet defines one; the product UI
commits to dark for v0.1).
