# Roadmap — Run Console (Mockup 10)

## Description

> Create a roadmap that covers the features for the mockup page 10. Any additional
> tech infrastructure that is required to implement the functionality in these mockup
> pages should be researched and offered as options for implementing in the roadmap.
> The roamdap should include MVP and v2 options, as well as the labels, milestones,
> and the like, for the tickets to be created. Any ticket sources that are used by
> Ouroboros for ingesting should be pluggable, which includes sources like Jira,
> Linear, GitHub, GitLab, and other bug reporting/issue recording sites. Refer to the
> page so that issues can reference the mockup file when creating the UI/UX design of
> the pages. Be very specific when creating the roadmap, as the options in the
> roadmap for the functionality needs to be complete and very thorough.

## Context & Existing Work (duplicate-avoidance survey)

Surveyed 2026-08-08.

**Design source of truth for every UI ticket in this roadmap:**
[`docs/mockups/10-run-detail.html`](mockups/10-run-detail.html) (with
`docs/mockups/assets/ouroboros.css`) — the Run Console. Its anatomy:

- **Page head** — eyebrow `Run Console · Loop #1847`, h1 `#482 — Fix flaky
  CAN-bus telemetry test`, meta row (`coding` pulse pill, `standard-fix v14`
  tag, `claude-fable-5` model pill, `elapsed 12m 40s`, `branch
  loop/482-canbus-flake`). Actions: **Pause loop**, **Take over in IDE**,
  **Abort run** (danger).
- **Stage timeline** (`c-12` stepper) — nodes Queued ✓ `0m 04s` → Analyze ✓
  `1m 12s` → Plan ✓ `2m 05s` → **Implement ● active, `attempt 2/3`** with a
  warn note *"attempt 1 failed tests — loop returned from gate ↺"* → Build ○ →
  Test ○ → Review ○ → Open PR ○; glowing done-segments.
- **Agent transcript** (`c-7`, `streaming` pill, **Raw JSONL ↗**) — timestamped
  entries with actor chips: `PLAN` (root-cause note), `TOOL` + tag
  (`read_file` path, `edit_file` with a **diff block** — del/add/ctx line
  treatments, `run_tests` with command + warn result `2 passed, 1 flaked →
  retrying`), `CLAUDE-FABLE-5` (model reasoning paragraphs), `GATE` (warn:
  *"test flake reproduced — returning to implement (attempt 2) ↺"*), and a
  **live entry** (accent left-border, `running… 47/63 cases`, pulsing meter).
  Below: the **steering input** (*"Steer the loop — e.g. 'prefer a fix inside
  the ISR; do not touch the test timeouts'"* + Send) with the caption
  *"Steering nudges the current attempt without pausing it. Works from the
  Slack thread too."*
- **Changes so far** card — file rows with `+38 −12` counts (3 files), commit
  rows (`a41c9e2 · can: replace telemetry k_fifo with k_msgq + frame seq`),
  `will squash on merge` tag.
- **Resources** card — Tokens `212k / 400k budget` meter, Est. cost `$1.14 /
  $2.50 cap` meter, Build farm `forge-02 reserved` (idle dot), Wall clock.
- **Guardrails** card (`clean` pill) — ✓ *Diff confined to allowed paths*, ✓
  *No CI config touched*, ✓ *Secrets scan clean*, ○ *Human review not required
  (auto-merge eligible)*; footer `Policy: standard-fix v14 · tenant
  acme-robotics`.

**The dependency truth.** This console observes an *executing* loop — and
execution itself is deliberately v2 elsewhere (WF-T.6 over #54, gated on the
invocation stack AF.2). The honest MVP (the pattern of every prior roadmap):
build the **run observability plane** — the event store, stage/attempt model,
changes/resources/guardrails data, control contract, and the full console UI —
proven end-to-end against **simulated runs driven through the real ingestion
API**, so that when execution lands it plugs into a finished console rather
than a mockup. Guardrail *evaluation* (paths, CI-config, secrets patterns) runs
genuinely on reported diffs even for simulated runs.

**Overlapping work and dispositions:**

| Existing work | Disposition under this roadmap |
|---|---|
| DASH-F.1 `runs` (single current-stage columns), DASH-J.3 engine→read-model ingestion bridge (v2, defined but unbuilt) | **Extended/absorbed** — AO.1 adds the stage-history/attempt model; **AP.1 owns the run-event ingestion contract**, absorbing DASH-J.3's scope where unbuilt (filing-time coordination, same rule as Q.3↔K.3/K.4). Dashboard stage display upgrades to read from stage history. |
| WF-P.9 (permissions stored as declarations, enforcement deferred), WF-P.2 DSL (limits: retries, token budget) | **Partially redeemed** — AO.4/AP.3 *evaluate* guardrails (allowed paths, CI-config, secrets, review-required) against reported changes and render verdicts; hard enforcement still lands with execution (AR.1). Timeline `attempt 2/3` reads the DSL's retry limit. |
| Routing Z.1 (max-cost per run), DASH-F.3 `token_usage`, DASH-J.4 pricing | **Consumed** — the Resources card computes tokens-vs-budget and cost-vs-cap from real accounting (honesty rules carry: unpriced ≠ $0). |
| Build-farm AH (jobs, reservations) | **Consumed** — `forge-02 reserved` reads a real reservation/job link when present; absent otherwise. |
| Workflow versions (WF-P.1 pins), R.1 trigger pins | **Consumed** — head tags and the Guardrails policy footer render the pinned `standard-fix v14`. |
| Mockups 11 (test results), 12 (PR verification), 19 (ChatOps/Slack), IDE integrations | **Out of scope** — `run_tests` results deep-link later (11); Slack steering is 19's roadmap (the caption's claim is softened until then, AR.4); Take-over-in-IDE deep integration is AR.2 (MVP ships the honest branch-handoff dialog). |
| Pluggable ticket sources requirement (description boilerplate) | **Already satisfied** by WF Epic Q (read) + AL.2 (write); the console links the run's ticket via its canonical `external_key`/URL regardless of tracker. Nothing duplicated. |
| DASH-J.1 SSE (v2), AH.5 offset-fetch log pattern, code-view diff tokens | **Patterns reused** — transcript streaming = offset fetch MVP with the SSE upgrade path; diff rendering reuses the token palette. |
| Scaffolding #49 run-detail links, #56 e2e | **Superseded for the run route**; #56 gains a console leg. |

Epic letters continue the sequence (…AK–AN): this roadmap uses **AO, AP, AQ, AR**.

## Infrastructure Options (researched — thorough, pick before filing)

### 1. Transcript event storage & export

| Option | What it is | Fit | Trade-offs |
|---|---|---|---|
| **A — Postgres append-only `run_events` (typed columns + JSONB payload) with per-run caps, JSONL export generated on demand** ⭐ recommended | One store (consistent with AH.5 logs); typed actor/kind columns make the console query cheap; `Raw JSONL ↗` is a streamed projection of the same rows | Single source of truth, transactional with run state; retention/caps managed like build logs | Very long runs bounded by caps (elision markers, same honesty as AG.5) |
| B — Object storage JSONL as primary + DB index | Cheap unbounded transcripts | Scales further | New infra now; two stores to keep consistent — v2 migration path documented |
| C — Dedicated event store (Kafka/NATS + sink) | Streaming-native | Fleet scale someday | Heavy infra against the lightweight rule — rejected for now |

### 2. Live streaming to the console

| Option | What it is | Fit | Trade-offs |
|---|---|---|---|
| **A — Offset-based incremental fetch on the shared poll cadence (DASH-I.8/AH.5 pattern), SSE upgrade slot reserved (DASH-J.1)** ⭐ recommended MVP | `GET /runs/:id/events?after=<seq>` returns new entries + live flag; the live entry's progress meter updates per poll; one pattern across logs/transcripts | Honest liveness at poll cadence, zero new infra, proven pattern ×3 | Sub-second immediacy waits for SSE (AR.3 rides DASH-J.1) |
| B — SSE now | True push | The `streaming` pill literally | Builds DASH-J.1 early just for this page; poll-first keeps sequencing clean |
| C — WebSocket | Bidirectional | Steering could ride it | Steering is a plain POST; WS adds surface without need |

### 3. Guardrail secrets scanning

| Option | What it is | Fit | Trade-offs |
|---|---|---|---|
| **A — Embedded regex ruleset (gitleaks-class patterns: ~150 well-known secret formats + keyword proximity), run on reported diff hunks server-side** ⭐ recommended MVP | Milliseconds per diff, no external binary, deterministic verdicts for the Guardrails card; ruleset versioned in-repo | Real detection for the common catastrophes (cloud keys, tokens, private keys) with zero infra | Entropy-only secrets slip regexes (~70% recall class); stated in the card's tooltip — honesty |
| B — TruffleHog-class verified scanning | 700+ detectors, live-credential verification | Strongest truth ("this key works") | External binary + outbound verification calls from the control plane; right as the AR.1 upgrade for pre-merge enforcement |
| C — External service (GitGuardian etc.) | Managed governance | Enterprise later | Cost + data egress; contradicts self-hosted default |

### 4. Control delivery (pause / abort / steer)

| Option | Semantics | Fit | Trade-offs |
|---|---|---|---|
| **A — Control-queue rows + engine acknowledgment over the internal API (at-least-once, idempotent, TTL'd)** ⭐ recommended | `run_controls` (kind, payload, state `pending|delivered|acked|expired`); engine polls/receives on its channel, acks with effect (`paused`, `aborted`, `steering applied to attempt N`); UI shows delivery state honestly (`sent → acknowledged`) | Works identically for simulated and real executors; no lost controls; the steering caption's "without pausing" is engine-side semantics the contract carries | Acks require executor cooperation — simulated runs ack via the driver; real acks land with AR.1 |
| B — Direct synchronous RPC to the engine | Simple | Immediate feedback | Fails exactly when you need abort most (engine busy/stuck); no audit trail |

## Decisions proposed by this roadmap (validate before issue creation)

| # | Decision | Rationale |
|---|----------|-----------|
| R1 | **Stage history becomes first-class**: `run_stages` (per stage × attempt: status, timings, notes) extends DASH-F.1's current-stage columns; the loop-return note (`attempt 1 failed tests ↺`) is a stage-transition record, not copy | The stepper, attempt chips, and gate-return notes must be queryable truth; the dashboard's stage display upgrades to the same source. |
| R2 | **AP.1 owns the run ingestion contract** (events, stage transitions, files/commits, resources, farm links), absorbing DASH-J.3's unbuilt scope — one internal API for simulated drivers now and WF-T.6 later | Two ingestion contracts would fork the read-model; filing-time coordination note included. |
| R3 | **Transcript = typed append-only events** (option 1-A): actors `plan|tool|model|gate|user|system`, tool tags, diff payloads, results; per-run caps with elision markers; `Raw JSONL ↗` streams the projection | The mockup's transcript is the product's flight recorder — typed for the console, exportable for tooling. |
| R4 | **Model reasoning appears only as reported** — entries carry provenance (model id, attempt); simulated-run seeds label themselves `simulated` in the JSONL and UI watermark | The transcript must never fabricate model thoughts; the honesty rule applied to its most sensitive surface. |
| R5 | **Guardrails are evaluated server-side on every reported change-set** (allowed-paths from WF stage permissions, CI-config detection, secrets ruleset option 3-A, review-required from workflow policy + routing votes); verdicts stored per evaluation; **enforcement** (blocking) remains execution-side and lands with AR.1 | The card shows real verdicts today; the P9 debt gets its evaluation half paid without pretending to block. |
| R6 | **Controls ride a durable queue with acks** (option 4-A); Abort requires typed confirmation + audit; Pause/Abort/steer all audited (AD.4 shape) with actor identity | Run control is the highest-stakes button row in the product. |
| R7 | **"Take over in IDE" MVP = pause + branch handoff dialog** (branch name, fetch/checkout commands, run context links), deep IDE protocol integration deferred (AR.2) | Honest, immediately useful; no fake IDE magic. |
| R8 | **Resources compute from existing accounting**: tokens vs the stage's DSL budget, cost vs the route's cap (unpriced → count-only per M7/N10), farm reservation from AH links, wall clock from stage history | No new counters — the console reads the systems that already own these numbers. |
| R9 | **Steering caption tells today's truth**: "Works from the Slack thread too" renders only when the ChatOps integration (mockup 19) exists — AR.4 flips it | No promised channels that don't exist. |
| R10 | **Labels**: new `runs`; **Milestones**: `Run Console MVP` / `Run Console v2` created at filing; complexity chips XS–L | Description requires labels + milestones for the filing pass. |

## Architecture Overview

```mermaid
flowchart LR
    subgraph "Executors"
        SIM["simulated-run driver (MVP)<br/>scripted lifecycles"]
        EXE["WF-T.6 real execution (v2 · AR.1)"]
    end
    subgraph "ouroboros-rest (NestJS)"
        ING["/internal/runs — ingestion contract (AP.1, R2)<br/>events · stages · files · commits · resources"]
        GRD["GuardrailService (AP.3)<br/>paths · CI-config · secrets ruleset"]
        CTRL["run_controls queue + acks (AP.4)"]
        RAPI["/api/v1/runs/:id — console read APIs<br/>timeline · events?after= · changes · resources · guardrails"]
    end
    subgraph "ouroboros-db"
        RS[("runs + run_stages (R1)")]
        RE[("run_events (append-only, capped)")]
        RC[("run_files · run_commits · guardrail_evaluations · run_controls")]
    end
    UI["ouroboros-ui /runs/:id<br/>stepper · transcript · steering · cards"]
    SIM & EXE --> ING --> RS & RE & RC
    ING --> GRD --> RC
    UI --> RAPI --> RS & RE & RC
    UI -->|"pause · abort · steer"| CTRL
    CTRL -.->|"deliver + ack"| SIM & EXE
```

## MVP Definition

The MVP is **mockup 10 as a fully working observability console over the run
ingestion contract**, proven by simulated runs end to end. It is done when,
against the compose stack:

1. `/runs/:id` reproduces
   [`docs/mockups/10-run-detail.html`](mockups/10-run-detail.html)
   pixel-faithfully in **both themes**: head + meta row, the stage stepper
   with done/active/pending states, attempt chips and gate-return notes, the
   transcript with all actor treatments (incl. diff blocks and the live
   entry), the steering input, and the three right-column cards.
2. **The ingestion contract is real** (R2): a scripted simulated-run driver
   walks a run through the full lifecycle — stage transitions with attempts
   and a gate return, transcript events of every kind, file/commit reports,
   token/cost accounting, a farm reservation link — via the same internal API
   real execution will use; the console reflects each step at poll cadence.
3. **Guardrails evaluate genuinely** (R5): reported diffs are checked against
   the pinned workflow's allowed paths and permissions, CI-config detection,
   and the embedded secrets ruleset; verdicts render with evidence
   (offending path/rule) on failure; the review-required row reflects policy
   truth.
4. **Controls work** (R6): Pause/Resume and Abort (typed confirmation)
   deliver through the durable queue and show acknowledgment states; Steer
   appends a user event, delivers to the executor, and renders in the
   transcript; Take-over shows the R7 branch-handoff dialog; all audited.
5. **Cards are computed truth** (R8): changes from reported files/commits
   (squash tag from workflow terminal config), resources from
   `token_usage`/budgets/caps/reservations/wall-clock, guardrails from
   evaluations — em-dashes wherever data is absent.
6. **Raw JSONL export** streams the transcript (R3), watermarked `simulated`
   for driver runs (R4).
7. Integration tests cover ingestion (ordering, idempotency, caps), guardrail
   rule matrices, control delivery/ack/expiry, resource math, isolation; the
   e2e suite gains a console leg driving a simulated run live.

**Explicitly v2 (milestone `Run Console v2`):** real-execution integration +
guardrail enforcement (AR.1), IDE take-over protocol (AR.2), SSE live
transcript (AR.3), Slack-thread steering with mockup 19 (AR.4), verified
secrets scanning + policy escalation (AR.5).

## Epics, Labels & Milestones

Each epic is a parent tracking issue on GitHub; every roadmap issue below is filed as
one of its sub-issues (GitHub Relationships).

| Epic | GitHub | Status | Name | Goal | Modules | Milestone |
|------|:------:|:------:|------|------|---------|-----------|
| AO | #294 | 🟡 Open | Run Observability Domain | Stage history, event store, changes/guardrails/controls schema, seeds | ouroboros-db | Run Console MVP |
| AP | #295 | 🟡 Open | Run Services & Contracts | Ingestion API, streaming reads, guardrail evaluation, control queue, simulator | ouroboros-rest, ouroboros-engine | Run Console MVP |
| AQ | #296 | 🟡 Open | Run Console UI | Head/controls, stepper, transcript + steering, cards, states, e2e | ouroboros-ui | Run Console MVP |
| AR | #297 | 🟡 Open | Live Execution & Extended (v2) | Real-run integration, IDE takeover, SSE, Slack steering, verified scanning | all | Run Console v2 |

Issue naming: `<project>: [<epic>.<issue>] <title>`. Labels: existing set (`mvp`,
`v2`, `rest`, `db`, `engine`, `ui`, `ci`, `design`, `workflow`) **plus new
`runs`** (decision R10, created at filing). Milestones **`Run Console MVP`** /
**`Run Console v2`** created at filing; every issue assigned. Complexity chips:
**XS · S · M · L**.

---

## Epic AO (#294) — Run Observability Domain (`ouroboros-db`)

| Ref | GitHub | Status | Title | Summary | Labels | Parallel | MVP | Complexity | Affected Modules |
|-----|:------:|:------:|-------|---------|--------|:--------:|:---:|:----------:|------------------|
| AO.1 | #298 | 🟡 Open | ouroboros-db: [AO.1] Stage history & attempts schema | `run_stages` per stage×attempt; DASH-F.1 extension (R1) | mvp, runs, db | N (after DASH-F.1) | Y | M | ouroboros-db |
| AO.2 | #299 | 🟡 Open | ouroboros-db: [AO.2] Run event store | Append-only typed `run_events` with caps + JSONL projection shape | mvp, runs, db | N (after AO.1) | Y | M | ouroboros-db |
| AO.3 | #300 | 🟡 Open | ouroboros-db: [AO.3] Changes, resources & farm-link schema | `run_files`, `run_commits`, resource snapshots, reservation refs | mvp, runs, db | N (after AO.1) | Y | S | ouroboros-db |
| AO.4 | #301 | 🟡 Open | ouroboros-db: [AO.4] Guardrail evaluations & control queue schema | Verdict rows with evidence; durable `run_controls` (R5/R6) | mvp, runs, db | N (after AO.1) | Y | M | ouroboros-db |
| AO.5 | #302 | 🟡 Open | ouroboros-db: [AO.5] Console dev seeds — mockup-10 parity + ci probes | The #482 run mid-flight, full transcript, cards; constraint probes | mvp, runs, db, ci | N (after AO.2–AO.4, #24) | Y | M | ouroboros-db, .github |

### Issue AO.1 — ouroboros-db: [AO.1] Stage history & attempts schema

> **GitHub issue:** #298 · **Status:** 🟡 Open · **Parent epic:** #294

- **Problem Statement:** The stepper needs per-stage truth (durations,
  attempts, gate-return notes) that DASH-F.1's current-stage columns cannot
  hold (decision R1).
- **Solution/Scope:** Migration: `run_stages` — run FK, `stage_key` (DSL node
  id), `stage_label`, `position`, `attempt` (≥1), `status` CHECK
  `pending|active|succeeded|failed|skipped`, `started_at/finished_at`,
  `note` (the warn-note text, machine-composed from transitions),
  `max_attempts` (from the DSL limits at pin time), unique (run, stage_key,
  attempt); `runs` gains `loop_seq` (the `Loop #1847` counter, org-scoped
  sequence), `branch_name`, `workflow_version_pin` columns; DASH read paths
  amended to derive current-stage from the newest active row (amendment).
- **Acceptance Criteria:** The mockup timeline (3 done, active attempt 2/3
  with a prior failed attempt, 4 pending) is representable; durations
  computed; dashboard amendment verified against existing seeds.
- **Parallelism/Dependencies:** Needs DASH-F.1. Blocks AO.2–AO.5, AP.1.
- **Technical Stack:** PostgreSQL 17, Flyway.
- **Epic:** AO

```mermaid
erDiagram
    runs ||--o{ run_stages : "history"
    runs {
        int loop_seq "Loop #1847 (org sequence)"
        text branch_name "loop/482-canbus-flake"
        text workflow_version_pin "standard-fix@v14"
    }
    run_stages {
        text stage_key "DSL node id"
        int attempt "UK with run+stage"
        text status "pending|active|succeeded|failed|skipped"
        int max_attempts "from DSL limits"
        text note "attempt 1 failed tests — returned from gate"
    }
```

### Issue AO.2 — ouroboros-db: [AO.2] Run event store

> **GitHub issue:** #299 · **Status:** 🟡 Open · **Parent epic:** #294

- **Problem Statement:** The transcript is the flight recorder (decision R3):
  ordered, typed, capped, exportable.
- **Solution/Scope:** `run_events` — run FK, `seq` (dense per run), `ts`,
  `actor` CHECK `plan|tool|model|gate|user|system`, `stage_key` +
  `attempt` refs, `tool_tag` nullable (`read_file|edit_file|run_tests|…`),
  `model_id` nullable (provenance per R4), `body` text, `payload` jsonb
  (diff hunks `{ctx|del|add}` lines, test results, progress fractions),
  `simulated` bool (R4 watermark); per-run event/byte caps via trigger with
  elision-marker rows (AG.5 pattern); BRIN on ts; JSONL projection shape
  documented in the migration header (one row ↔ one JSONL line).
- **Acceptance Criteria:** Every mockup entry type round-trips; cap trigger
  inserts elision markers; seq density enforced; projection fixture matches
  the documented JSONL shape byte-for-byte.
- **Parallelism/Dependencies:** Needs AO.1. Blocks AP.1/AP.2, AO.5.
- **Technical Stack:** PostgreSQL 17, Flyway.
- **Epic:** AO

```
run_events(seq↑): {ts, actor: tool, tool_tag: edit_file, payload: {file, hunks[{del|add|ctx}]}}
                  {actor: model, model_id: claude-fable-5, body: "The buffer uses…"}
                  {actor: gate, body: "flake reproduced — returning ↺", stage, attempt}
```

### Issue AO.3 — ouroboros-db: [AO.3] Changes, resources & farm-link schema

> **GitHub issue:** #300 · **Status:** 🟡 Open · **Parent epic:** #294

- **Problem Statement:** The right column's Changes and Resources cards need
  their own truth: cumulative file stats, commits, resource snapshots, and
  the farm reservation link.
- **Solution/Scope:** `run_files` — run FK, `path`, `additions`, `deletions`
  (cumulative, upserted per report), unique (run, path); `run_commits` —
  run FK, `sha`, `message`, `seq`; `runs` gains `merge_strategy` snapshot
  (the `will squash on merge` tag from the pinned terminal config) and
  `reserved_build_job_id` FK nullable (AH linkage); resource truth stays in
  its owning systems (R8 — `token_usage` per run, route cap, DSL budget
  pinned on the stage rows) with no duplicate counters.
- **Acceptance Criteria:** Mockup card contents representable (3 files with
  counts, 2 commits, squash tag, reservation); upsert semantics verified;
  no stored aggregates that could drift.
- **Parallelism/Dependencies:** Needs AO.1. Feeds AP.1, AQ.4.
- **Technical Stack:** PostgreSQL 17, Flyway.
- **Epic:** AO

```
run_files: telemetry_buf.c +38 −12 (upsert per report)   run_commits: a41c9e2 "can: …"
runs.merge_strategy: auto-squash (pin snapshot) · reserved_build_job_id → AH.build_jobs
```

### Issue AO.4 — ouroboros-db: [AO.4] Guardrail evaluations & control queue schema

> **GitHub issue:** #301 · **Status:** 🟡 Open · **Parent epic:** #294

- **Problem Statement:** Guardrail verdicts need evidence-bearing rows
  (decision R5); controls need a durable, ack-tracked queue (decision R6).
- **Solution/Scope:** `guardrail_evaluations` — run FK, `check` CHECK
  `allowed_paths|ci_config|secrets|review_required`, `verdict` CHECK
  `pass|fail|not_applicable|pending`, `evidence` jsonb (offending path,
  matched rule id — never the secret value itself), `evaluated_at`,
  `ruleset_version`; latest-per-check view; `run_controls` — run FK,
  `kind` CHECK `pause|resume|abort|steer`, `payload` (steer text), `state`
  CHECK `pending|delivered|acked|expired|rejected`, `requested_by`,
  timestamps, TTL, `ack_detail`; audit linkage (AD.4 events on every
  control).
- **Acceptance Criteria:** Evidence never contains secret material (CHECK +
  test); control state machine constrained; TTL expiry sweep-able;
  latest-verdict view correct under re-evaluation.
- **Parallelism/Dependencies:** Needs AO.1. Feeds AP.3/AP.4, AQ.5.
- **Technical Stack:** PostgreSQL 17, Flyway.
- **Epic:** AO

```
guardrail_evaluations: {check: secrets, verdict: pass, ruleset: v3}
run_controls: {kind: steer, payload: "prefer a fix inside the ISR…", state: pending→delivered→acked}
```

### Issue AO.5 — ouroboros-db: [AO.5] Console dev seeds — mockup-10 parity + ci probes

> **GitHub issue:** #302 · **Status:** 🟡 Open · **Parent epic:** #294

- **Problem Statement:** Design review needs the exact mid-flight state of
  `#482` — transcript, timeline, cards — without running the simulator.
- **Solution/Scope:** Extend the dev seed (coordinated with DASH-F.5's
  `#482` active run): loop_seq 1847, branch, v14 pin; stage history (Queued/
  Analyze/Plan done with mockup durations, Implement attempt 1 failed +
  attempt 2 active, rest pending); the full nine-entry transcript incl. both
  diff payloads, the gate return, and the live `run_tests` entry at 47/63
  (`simulated: true` per R4); three run_files + two commits + squash
  strategy; token rows summing to 212k against the 400k pinned budget and
  $1.14 vs $2.50 cap; forge-02 reservation (AH seeds); four guardrail
  verdicts (three pass, review not-applicable). ci/db probes: event seq
  density, verdict/control vocabs, evidence-no-secrets, stage uniqueness.
- **Acceptance Criteria:** Console renders the mockup from seeds alone;
  JSONL export watermarked; probes red/green verified; recompute-stable
  relative to `now()`.
- **Parallelism/Dependencies:** Needs AO.2–AO.4 (+DASH-F.5/AH.1 coordination).
- **Technical Stack:** Flyway repeatable migration, SQL.
- **Epic:** AO

```
seed: run #482 @ 12m40s — stages(3✓ · impl 2/3 · 4○) · 9 transcript entries · 3 files/2 commits
      212k/400k · $1.14/$2.50 · forge-02 · guardrails 3✓ 1○ · simulated watermark
```

---

## Epic AP (#295) — Run Services & Contracts (`ouroboros-rest` + `ouroboros-engine`)

| Ref | GitHub | Status | Title | Summary | Labels | Parallel | MVP | Complexity | Affected Modules |
|-----|:------:|:------:|-------|---------|--------|:--------:|:---:|:----------:|------------------|
| AP.1 | #303 | 🟡 Open | ouroboros-rest: [AP.1] Run ingestion contract & API | Events/stages/files/commits/resources ingest (absorbs DASH-J.3) | mvp, runs, rest, engine | N (after AO.2, #51) | Y | L | ouroboros-rest |
| AP.2 | #304 | 🟡 Open | ouroboros-rest: [AP.2] Console read APIs & JSONL export | Timeline, offset event stream, cards payloads, export | mvp, runs, rest | N (after AP.1) | Y | M | ouroboros-rest |
| AP.3 | #305 | 🟡 Open | ouroboros-rest: [AP.3] Guardrail evaluation service | Paths/CI-config/secrets/review checks on reported change-sets | mvp, runs, rest | N (after AO.4, WF-P.2) | Y | L | ouroboros-rest |
| AP.4 | #306 | 🟡 Open | ouroboros-rest: [AP.4] Control queue & delivery | Pause/resume/abort/steer with acks, TTLs, audit (R6) | mvp, runs, rest, engine | N (after AO.4, #51) | Y | M | ouroboros-rest, ouroboros-engine |
| AP.5 | #307 | 🟡 Open | ouroboros-engine: [AP.5] Simulated-run driver | Scripted lifecycles through the real contract, incl. control acks | mvp, runs, engine | N (after AP.1, AP.4) | Y | M | ouroboros-engine |
| AP.6 | #308 | 🟡 Open | ouroboros-rest: [AP.6] Console integration tests | Ingestion ordering/idempotency, guardrail matrix, controls, isolation | mvp, runs, rest, ci | N (after AP.2–AP.5) | Y | M | ouroboros-rest |

### Issue AP.1 — ouroboros-rest: [AP.1] Run ingestion contract & API

> **GitHub issue:** #303 · **Status:** 🟡 Open · **Parent epic:** #295

- **Problem Statement:** One internal contract must carry everything an
  executor reports (decision R2) — for the simulator today and WF-T.6
  tomorrow — absorbing DASH-J.3's unbuilt scope.
- **Solution/Scope:** Internal API (shared-secret per #51/AD.3 patterns):
  `POST /internal/runs` (create with pin snapshot, loop_seq assignment),
  `POST /internal/runs/:id/stage-transitions` (validated against the R1
  state machine + DSL attempt limits; gate-return composes the note),
  `POST /internal/runs/:id/events` (batched, seq-assigned, capped),
  `PUT /internal/runs/:id/files` (cumulative upserts) +
  `POST …/commits`, `POST …/resources` (token/cost deltas → `token_usage`
  attribution, reservation links); idempotency keys on all writes; every
  change-set report triggers AP.3 evaluation; OpenAPI (internal) committed;
  DASH-J.3 amendment: its scope is delivered here (filing-time note).
- **Acceptance Criteria:** Simulator lifecycle lands correctly (ordering
  under interleaving, duplicate-key no-ops); invalid stage transitions
  rejected with reasons; dashboard read-model reflects ingested runs
  (cross-roadmap verification).
- **Parallelism/Dependencies:** Needs AO.2, #51. Blocks AP.2/AP.3/AP.5.
- **Technical Stack:** NestJS, Kysely transactions.
- **Epic:** AP

```
executor ─▶ POST stage-transitions {implement, attempt:2, from: gate-fail} ─▶ note composed
         ─▶ POST events[batch] ─▶ seq assigned · caps enforced
         ─▶ PUT files ─▶ upsert + guardrail evaluation queued (AP.3)
```

### Issue AP.2 — ouroboros-rest: [AP.2] Console read APIs & JSONL export

> **GitHub issue:** #304 · **Status:** 🟡 Open · **Parent epic:** #295

- **Problem Statement:** The console needs shaped reads: the timeline, the
  incremental transcript, card payloads, and the raw export.
- **Solution/Scope:** Under tenant context: `GET /api/v1/runs/:id` (head
  meta + stage timeline from R1 history + card payloads: changes, resources
  computed per R8, latest guardrail verdicts); `GET /api/v1/runs/:id/events
  ?after=<seq>` (typed entries + live flag + poll-after hint — option 2-A);
  `GET /api/v1/runs/:id/transcript.jsonl` (streamed projection, simulated
  watermark line, member-readable); 404-not-403 cross-org; OpenAPI complete
  (generated client).
- **Acceptance Criteria:** Seeded payloads reproduce every mockup element;
  offset resume exact under concurrent ingest; export matches the AO.2
  projection fixture; resource math verified (unpriced case → count-only).
- **Parallelism/Dependencies:** Needs AP.1. Feeds AQ.*.
- **Technical Stack:** NestJS, Kysely, streamed responses.
- **Epic:** AP

```
GET /runs/:id ─▶ {head, timeline[stages×attempts], changes, resources, guardrails}
GET /runs/:id/events?after=7 ─▶ {entries[2], live: true, pollAfter: 5}
GET /runs/:id/transcript.jsonl ─▶ streamed · "# simulated run" watermark
```

### Issue AP.3 — ouroboros-rest: [AP.3] Guardrail evaluation service

> **GitHub issue:** #305 · **Status:** 🟡 Open · **Parent epic:** #295

- **Problem Statement:** The Guardrails card must be computed truth
  (decision R5): four checks against the pinned workflow policy and the
  reported change-set, with evidence.
- **Solution/Scope:** `GuardrailService` triggered per change-report:
  **allowed-paths** (stage permissions/plan file-list from the pinned DSL —
  glob match on `run_files` paths), **ci-config** (pattern set:
  `.github/workflows/**`, CI files registry — flags when the stage's
  `touch_ci` permission is false), **secrets** (embedded ruleset per option
  3-A: ~150 gitleaks-class patterns + keyword proximity, run over reported
  diff hunks; ruleset versioned + documented; recall limits stated in the
  card tooltip), **review-required** (workflow terminal policy + routing
  vote rules → required/not-required with the auto-merge-eligible caption);
  evidence rows (path, rule id, line ref — never the secret value);
  re-evaluation supersedes (latest-per-check view); failure verdicts flag
  the run (`needs_human` interplay documented — full enforcement AR.1).
- **Acceptance Criteria:** Rule matrix fixtures (each check × pass/fail/n-a);
  a seeded diff with a planted AWS-key pattern fails `secrets` with rule-id
  evidence and no secret text stored; CI-file touch flags correctly;
  performance ≤ 50ms per typical change-set.
- **Parallelism/Dependencies:** Needs AO.4, WF-P.2 (policy source). Feeds
  AQ.5.
- **Technical Stack:** NestJS, embedded regex ruleset (versioned), glob
  matching.
- **Epic:** AP

```
change-set ─▶ paths ⊨ allowed globs ✓ · ci-config ∉ diff ✓ · secrets ruleset v3 ✓
policy(standard-fix@v14) ─▶ review_required: no (auto-merge eligible)
fail ─▶ {verdict: fail, evidence: {path, rule: aws-access-key-id}}  (no secret stored)
```

### Issue AP.4 — ouroboros-rest: [AP.4] Control queue & delivery

> **GitHub issue:** #306 · **Status:** 🟡 Open · **Parent epic:** #295

- **Problem Statement:** Pause/abort/steer must survive executor hiccups,
  prove delivery, and leave an audit trail (decision R6).
- **Solution/Scope:** Public API: `POST /api/v1/runs/:id/controls`
  (kind+payload; role policy: member may steer, admin+ may pause/abort;
  abort requires typed confirmation client-side + server re-check); queue
  semantics per option 4-A (pending → delivered on executor fetch/push →
  acked with effect detail; TTL expiry with UI-visible outcome; duplicate
  suppression for pause/abort); engine-side contract (fetch/ack endpoints
  on the internal channel + steer-injection semantics documented:
  steering appends to the current attempt's context without pausing);
  user steer event mirrored into the transcript (actor `user`); audits on
  every control (actor, run, kind).
- **Acceptance Criteria:** Full lifecycle against the simulator (steer
  reflected in transcript + acked with "applied to attempt 2"); abort
  mid-stage terminates the simulated lifecycle; expiry path rendered; role
  matrix + audit rows verified.
- **Parallelism/Dependencies:** Needs AO.4, #51. Blocks AP.5 acks, AQ.2/AQ.3.
- **Technical Stack:** NestJS, engine contract endpoints.
- **Epic:** AP

```
POST controls {steer: "prefer ISR fix"} ─▶ pending ─▶ delivered ─▶ acked("applied to attempt 2")
POST controls {abort} (typed confirm, admin+) ─▶ … ─▶ run: canceled · audited
```

### Issue AP.5 — ouroboros-engine: [AP.5] Simulated-run driver

> **GitHub issue:** #307 · **Status:** 🟡 Open · **Parent epic:** #295

- **Problem Statement:** The MVP's proof: scripted lifecycles exercising the
  entire contract — including control acknowledgment — so the console is
  end-to-end real before execution exists.
- **Solution/Scope:** Engine-side driver (dev/test tooling, #51 channel):
  scenario scripts (happy path; gate-return with attempt 2 — the mockup's
  story; guardrail-violation scenario; abort/pause/steer-responsive
  scenario) emitting realistic cadence (configurable time compression);
  control fetch/ack loop honoring pause/abort/steer semantics; `simulated`
  flags on everything (R4); CLI/endpoint to launch scenarios in dev &
  e2e; explicitly excluded from production builds.
- **Acceptance Criteria:** The mockup scenario replays end-to-end in compose
  with the console live; steer mid-scenario alters a scripted branch
  (visible ack + transcript); production build excludes the driver
  (verified).
- **Parallelism/Dependencies:** Needs AP.1, AP.4. Feeds AQ e2e.
- **Technical Stack:** FastAPI (dev router), scenario scripts.
- **Epic:** AP

```
scenario "482-gate-return" ─▶ queued→analyze→plan→implement(1)→gate↺→implement(2)→…
  · emits events/files/resources at compressed cadence · acks controls · simulated: true
```

### Issue AP.6 — ouroboros-rest: [AP.6] Console integration tests

> **GitHub issue:** #308 · **Status:** 🟡 Open · **Parent epic:** #295

- **Problem Statement:** Ingestion ordering, guardrail matrices, and control
  semantics are the console's correctness core.
- **Solution/Scope:** Harness suites: ingestion (interleaved batches,
  idempotency, cap/elision, invalid transitions), guardrail matrix (AP.3
  fixtures), control lifecycle (deliver/ack/expiry/role/audit), read APIs
  (offset resume, export fidelity, resource math incl. unpriced), org
  isolation everywhere.
- **Acceptance Criteria:** Green in `ci/rest`; removing idempotency or the
  transition validator turns tests red; ≤ 90s added.
- **Parallelism/Dependencies:** Needs AP.2–AP.5.
- **Technical Stack:** Jest, Supertest, Testcontainers.
- **Epic:** AP

```
suites: ingest ✓ · guardrails ✓ · controls ✓ · reads/export ✓ · isolation ✓
```

---

## Epic AQ (#296) — Run Console UI (`ouroboros-ui`)

Every issue references
[`docs/mockups/10-run-detail.html`](mockups/10-run-detail.html) as the design
source — stepper/transcript/card treatments, actor chips, diff line classes —
via the #16 tokens (both themes; the mockup is dark-only).

| Ref | GitHub | Status | Title | Summary | Labels | Parallel | MVP | Complexity | Affected Modules |
|-----|:------:|:------:|-------|---------|--------|:--------:|:---:|:----------:|------------------|
| AQ.1 | #309 | 🟡 Open | ouroboros-ui: [AQ.1] Run route, head & meta row | `/runs/:id` frame, live meta, links from dashboard/farm | mvp, runs, ui, design | N (after #41, AP.2, BA-D.5) | Y | S | ouroboros-ui |
| AQ.2 | #310 | 🟡 Open | ouroboros-ui: [AQ.2] Run controls (pause · abort · take-over) | Action row with confirmation, ack states, branch-handoff dialog | mvp, runs, ui | N (after AQ.1, AP.4) | Y | M | ouroboros-ui |
| AQ.3 | #311 | 🟡 Open | ouroboros-ui: [AQ.3] Stage timeline stepper | Done/active/pending nodes, attempt chips, gate-return notes | mvp, runs, ui, design | N (after AQ.1) | Y | M | ouroboros-ui |
| AQ.4 | #312 | 🟡 Open | ouroboros-ui: [AQ.4] Agent transcript & steering | Streaming entries, actor chips, diff blocks, live entry, steer input | mvp, runs, ui, design | N (after AQ.1, AP.4) | Y | L | ouroboros-ui |
| AQ.5 | #313 | 🟡 Open | ouroboros-ui: [AQ.5] Changes, resources & guardrails cards | The three right-column cards from computed payloads | mvp, runs, ui, design | N (after AQ.1) | Y | M | ouroboros-ui |
| AQ.6 | #314 | 🟡 Open | ouroboros-ui: [AQ.6] Console states & e2e leg | Terminal/queued/error states, watermark, themes, simulated e2e | mvp, runs, ui, ci | N (after AQ.2–AQ.5) | Y | M | ouroboros-ui, .github |

### Issue AQ.1 — ouroboros-ui: [AQ.1] Run route, head & meta row

> **GitHub issue:** #309 · **Status:** 🟡 Open · **Parent epic:** #296

- **Problem Statement:** The console's frame: loop-numbered eyebrow, ticket
  headline, live meta row — and the incoming links (dashboard active-loops
  rows, farm current-job cells) finally landing somewhere real.
- **Solution/Scope:** `/runs/:id` route: eyebrow (`Run Console · Loop
  #NNNN`), h1 from the canonical ticket (`external_key — title`, linked to
  its tracker URL), meta row (status pill by run state, workflow-pin tag,
  model pill from the active stage's resolution, ticking elapsed, mono
  branch with copy affordance); polling via the I.8 pattern; upstream link
  amendments (DASH-I.3, AI.2's job cells) target this route; `simulated`
  watermark banner when flagged (R4).
- **Acceptance Criteria:** Seeded head matches the mockup; elapsed ticks
  without drift on refresh; dashboard/farm links navigate here
  (amendments verified); watermark shows on seeds; both themes.
- **Parallelism/Dependencies:** Needs #41, AP.2, BA-D.5. Blocks AQ.2–AQ.5.
- **Technical Stack:** Next.js, #46 primitives, I.8 poll hook family.
- **Epic:** AQ

```
Run Console · Loop #1847
#482 — Fix flaky CAN-bus telemetry test          [Pause loop][Take over in IDE][Abort run]
(●coding)(standard-fix v14)(claude-fable-5) elapsed 12m 41s · loop/482-canbus-flake ⧉
```

### Issue AQ.2 — ouroboros-ui: [AQ.2] Run controls (pause · abort · take-over)

> **GitHub issue:** #310 · **Status:** 🟡 Open · **Parent epic:** #296

- **Problem Statement:** The head's three actions carry real consequences —
  ack-visible delivery, typed-confirmation abort, and the honest take-over
  handoff (decisions R6/R7).
- **Solution/Scope:** **Pause loop** (→ Resume when paused): control POST
  with inline state (`sending → sent → acknowledged` chip; expiry rendered
  as "no response — run may be between stages"); **Abort run**: danger
  dialog (type the loop number, consequence text: branch preserved, run
  marked canceled), admin+ only; **Take over in IDE**: dialog per R7 —
  pauses the loop, shows branch + copy-able `git fetch/switch` commands,
  links (ticket, transcript export), note that deep IDE integration is
  arriving (AR.2); member role: steer-only (buttons hidden per AP.4
  policy).
- **Acceptance Criteria:** Full pause→ack and abort flows against the
  simulator in e2e; ack/expiry states truthful; abort confirmation gates;
  role visibility verified; both themes.
- **Parallelism/Dependencies:** Needs AQ.1, AP.4.
- **Technical Stack:** React, #46 primitives.
- **Epic:** AQ

```
[Abort run] ─▶ "Type 1847 to confirm — branch loop/482-… is preserved" ─▶ acked · canceled
[Take over] ─▶ paused ✓ · git fetch origin loop/482-canbus-flake … ⧉ · "deep IDE integration soon"
```

### Issue AQ.3 — ouroboros-ui: [AQ.3] Stage timeline stepper

> **GitHub issue:** #311 · **Status:** 🟡 Open · **Parent epic:** #296

- **Problem Statement:** The stepper renders stage history with the mockup's
  exact states — done glow, pulsing active node, attempt caption, warn
  note — from the R1 model.
- **Solution/Scope:** `RunStepper` component: nodes per pinned-workflow
  stage order (✓/●/○ with the mockup treatments incl. the pulse
  animation), done captions = durations, active caption = `attempt N/M`
  (from history vs `max_attempts`), warn note rendered from the
  transition-composed `note` (gate-return story), done-segments with glow
  gradient; horizontal scroll on narrow; failed-terminal styling (err node)
  for aborted/failed runs; node click → filters the transcript to that
  stage (AQ.4 integration); reduced-motion variant.
- **Acceptance Criteria:** Seeded stepper matches the mockup exactly;
  stage transitions animate on poll updates (simulator-verified); note
  wraps correctly; keyboard focus order along the steps; both themes.
- **Parallelism/Dependencies:** Needs AQ.1.
- **Technical Stack:** React, CSS (token-driven).
- **Epic:** AQ

```
✓Queued 0m04s ══ ✓Analyze 1m12s ══ ✓Plan 2m05s ══ ●Implement attempt 2/3 ── ○Build ── ○Test…
                                    └ ⚠ "attempt 1 failed tests — loop returned from gate ↺"
```

### Issue AQ.4 — ouroboros-ui: [AQ.4] Agent transcript & steering

> **GitHub issue:** #312 · **Status:** 🟡 Open · **Parent epic:** #296

- **Problem Statement:** The transcript is the page's soul: typed entries
  with actor chips, inline diffs, the live tail — plus the steering input
  that talks back.
- **Solution/Scope:** `Transcript` component over the offset stream:
  entry renderer per actor (chip treatments: PLAN faint, TOOL accent +
  tag, model violet with model id, GATE warn, USER for steer entries,
  SYSTEM), diff blocks from payload hunks (del/add/ctx line classes —
  token palette shared with the code view), tool results (mono, warn/ok
  coloring), the live entry (accent border, progress meter pulsing only
  while live), elision markers rendered distinctly; auto-scroll with
  user-scroll lock (AI.6 pattern); stage-filter integration (AQ.3);
  `streaming` pill truthful to the live flag; **Raw JSONL ↗** → AP.2
  export; **steering input** per the mockup (placeholder verbatim, Send →
  AP.4 steer control, optimistic user entry + ack chip, disabled with
  reason on terminal runs); caption per R9 (Slack line appears only when
  mockup 19's integration exists).
- **Acceptance Criteria:** Seeded transcript reproduces all nine mockup
  entries (both themes, screenshot test); simulator streaming appends
  smoothly (bounded DOM, no flicker); steer round-trip visible (entry +
  ack); caption honesty verified; keyboard/a11y (entries navigable,
  input labeled).
- **Parallelism/Dependencies:** Needs AQ.1, AP.4.
- **Technical Stack:** React, virtualized list, token-driven diff styles.
- **Epic:** AQ

```
14:07:48 [GATE] test flake reproduced — returning to implement (attempt 2) ↺
14:12:19 [TOOL run_tests] running… 47/63 ▓▓▓▓░ (live)
[ Steer the loop — e.g. "prefer a fix inside the ISR…" ] [Send] → USER entry + acked ✓
```

### Issue AQ.5 — ouroboros-ui: [AQ.5] Changes, resources & guardrails cards

> **GitHub issue:** #313 · **Status:** 🟡 Open · **Parent epic:** #296

- **Problem Statement:** The right column's three cards — cumulative
  changes, resource meters, guardrail verdicts — from computed payloads
  with the established honesty rules.
- **Solution/Scope:** **Changes**: file rows (mono path, +/− counts, ok/err
  coloring), commit rows (accent sha → tracker commit URL when linkable,
  message), merge-strategy tag from the pin; **Resources**: tokens meter
  (used/budget from R8; budget absent → count-only), cost meter (priced
  only; unpriced → `— · N tokens` per M7), farm row (reservation with
  runner name + status dot when linked; absent → row omitted), wall
  clock; **Guardrails**: verdict rows (✓/✗/○ marks + dot colors),
  evidence expansion on failures (path/rule id), header pill
  (`clean`/`violations` computed), review-required row with the
  auto-merge caption, policy footer (pin + tenant), secrets-recall
  tooltip (AP.3 honesty).
- **Acceptance Criteria:** Seeded cards match the mockup; a
  guardrail-violation scenario renders evidence + err pill; unpriced and
  budget-less renders verified; both themes.
- **Parallelism/Dependencies:** Needs AQ.1 (+AP.3 payloads).
- **Technical Stack:** React, #46 primitives.
- **Epic:** AQ

```
CHANGES 3 files  drivers/can/telemetry_buf.c +38 −12 …  a41c9e2 · [will squash on merge]
RESOURCES  212k/400k ▓▓▓▓▓░ · $1.14/$2.50 ▓▓▓▓░ · forge-02 reserved ◌ · 12m 40s
GUARDRAILS (clean)  ✓ paths ✓ no CI ✓ secrets ○ review not required — policy v14
```

### Issue AQ.6 — ouroboros-ui: [AQ.6] Console states & e2e leg

> **GitHub issue:** #314 · **Status:** 🟡 Open · **Parent epic:** #296

- **Problem Statement:** Runs end (merged/failed/canceled), queue, and
  error; and the whole console must certify end-to-end against a live
  simulated run.
- **Solution/Scope:** States: terminal renders (frozen elapsed, outcome
  pill, steering disabled with reason, PR link on merged), queued state
  (pre-first-stage), ingest-lag banner (stale events with last-updated,
  DASH-I.7 pattern), simulated watermark, member view, load skeletons;
  e2e (extends #56): seeded parity screenshots; live scenario — launch
  the AP.5 gate-return scenario → watch stepper transitions → steer
  mid-attempt (entry + ack) → guardrail verdicts render → pause/resume →
  abort second scenario with typed confirm → terminal state; JSONL
  export download; both themes.
- **Acceptance Criteria:** All states themed; e2e green from cold compose;
  each leg fails meaningfully when its layer breaks; ≤ 3 min added.
- **Parallelism/Dependencies:** Needs AQ.2–AQ.5, AO.5, AP.5; amends #56.
- **Technical Stack:** React, Playwright.
- **Epic:** AQ

```
e2e: parity ✓ · live scenario (stepper·transcript·steer·guardrails) ✓ · pause/abort ✓ · export ✓
```

---

## Epic AR (#297) — Live Execution & Extended (v2 · milestone `Run Console v2`)

| Ref | GitHub | Status | Title | Summary | Labels | Parallel | MVP | Complexity | Affected Modules |
|-----|:------:|:------:|-------|---------|--------|:--------:|:---:|:----------:|------------------|
| AR.1 | #315 | 🟡 Open | ouroboros-engine: [AR.1] Real-execution integration & guardrail enforcement | WF-T.6 reports through AP.1; guardrail fails block; caps enforced | v2, runs, workflow, engine, rest | N (after WF-T.6, AP.1) | N | L | ouroboros-engine, ouroboros-rest |
| AR.2 | #316 | 🟡 Open | ouroboros-ui: [AR.2] IDE take-over protocol | Deep hand-off: editor deep links, context transfer, resume-from-IDE | v2, runs, ui | N (after AQ.2) | N | L | ouroboros-ui, ouroboros-rest |
| AR.3 | #317 | 🟡 Open | ouroboros-rest: [AR.3] SSE live transcript | Push streaming over DASH-J.1's channel; poll fallback retained | v2, runs, rest, ui | N (after DASH-J.1, AP.2) | N | M | ouroboros-rest, ouroboros-ui |
| AR.4 | #318 | 🟡 Open | ouroboros-rest: [AR.4] Slack-thread steering | Mockup-19 tie-in: steer/pause from the run's Slack thread | v2, runs, rest | N (after mockup-19 roadmap, AP.4) | N | M | ouroboros-rest |
| AR.5 | #319 | 🟡 Open | ouroboros-rest: [AR.5] Verified secrets scanning & policy escalation | TruffleHog-class verification; enforcement policies per tenant | v2, runs, rest | N (after AP.3, AR.1) | N | M | ouroboros-rest |

### Issue AR.1 — ouroboros-engine: [AR.1] Real-execution integration & guardrail enforcement

> **GitHub issue:** #315 · **Status:** 🟡 Open · **Parent epic:** #297

- **Problem Statement:** When WF-T.6's executor exists, it must report
  through AP.1 — and guardrails graduate from verdicts to enforcement
  (closing WF-P.9's debt).
- **Solution/Scope:** Executor instrumentation: stage transitions, tool/
  model/gate events (real reasoning provenance per R4), file/commit/
  resource reports at tool boundaries; control honoring (pause between
  tool calls, abort cleanup, steer context-injection per AP.4 semantics);
  **enforcement**: guardrail-fail → stage halt + `needs_human` routing
  (policy-configurable per check), budget/cap breaches abort per route
  policy; simulated driver retained for tests; `simulated` watermark
  drops for real runs.
- **Acceptance Criteria:** A real docs-loop run (sandbox repo) streams a
  faithful transcript; planted guardrail violation halts the stage with
  the verdict as reason; steer alters a real attempt (verified via
  transcript); controls acked by the real executor.
- **Parallelism/Dependencies:** Needs WF-T.6, AP.1/AP.3/AP.4.
- **Technical Stack:** Engine executor hooks, AP contracts.
- **Epic:** AR

### Issue AR.2 — ouroboros-ui: [AR.2] IDE take-over protocol

> **GitHub issue:** #316 · **Status:** 🟡 Open · **Parent epic:** #297

- **Problem Statement:** R7's handoff dialog is honest but manual; the
  promise is a seamless jump into the editor with context.
- **Solution/Scope:** Deep-link handoff (`vscode://`/JetBrains protocols +
  configurable editor), context bundle (branch checkout, run summary as a
  workspace note, transcript link), takeover state on the run
  (`taken_over` — loop paused, badge on dashboards), resume-from-IDE flow
  (release back to the loop with a re-plan of remaining stages), ADR on
  a future IDE extension.
- **Acceptance Criteria:** VS Code handoff opens the branch with context;
  takeover state visible everywhere the run appears; resume re-enters the
  loop cleanly; ADR merged.
- **Parallelism/Dependencies:** Needs AQ.2 (+AR.1 for resume semantics).
- **Technical Stack:** Editor URI protocols, React.
- **Epic:** AR

### Issue AR.3 — ouroboros-rest: [AR.3] SSE live transcript

> **GitHub issue:** #317 · **Status:** 🟡 Open · **Parent epic:** #297

- **Problem Statement:** Poll-cadence liveness undersells a streaming
  transcript once runs are real; DASH-J.1's SSE channel is the upgrade
  slot (option 2-A's reserved path).
- **Solution/Scope:** Transcript deltas over the SSE channel (event seq
  resume on reconnect, heartbeats), AQ.4's hook upgrades EventSource-first
  with automatic poll fallback; per-run subscription scoping; load-shed
  guard (fall back to polling under connection pressure).
- **Acceptance Criteria:** Entries appear < 1s from ingest; reconnect
  resumes without gaps or duplicates; fallback transparent.
- **Parallelism/Dependencies:** Needs DASH-J.1, AP.2.
- **Technical Stack:** NestJS `@Sse()`, EventSource.
- **Epic:** AR

### Issue AR.4 — ouroboros-rest: [AR.4] Slack-thread steering

> **GitHub issue:** #318 · **Status:** 🟡 Open · **Parent epic:** #297

- **Problem Statement:** The steering caption's Slack claim (R9-deferred)
  — steer, pause, and status from the run's thread — lands with mockup
  19's ChatOps roadmap.
- **Solution/Scope:** With the 19 integration: run threads mirror key
  events (stage transitions, gate returns, needs-human), thread replies
  parse to steer controls (identity-mapped, permission-checked), `/ouro
  pause|abort` commands, caption flip in AQ.4; loop-prevention (bot
  echoes).
- **Acceptance Criteria:** Thread reply lands as an acked steer with
  correct actor; permissions honored; caption truthful.
- **Parallelism/Dependencies:** Needs mockup-19 roadmap, AP.4.
- **Technical Stack:** Slack API (via 19's integration), NestJS.
- **Epic:** AR

### Issue AR.5 — ouroboros-rest: [AR.5] Verified secrets scanning & policy escalation

> **GitHub issue:** #319 · **Status:** 🟡 Open · **Parent epic:** #297

- **Problem Statement:** Regex verdicts (option 3-A) catch formats, not
  live credentials; enforcement-grade scanning wants verification and
  tenant policy.
- **Solution/Scope:** TruffleHog-class verified scanning as an escalation
  tier (on guardrail-fail or pre-merge: verify candidate credentials
  read-only; verified-live → hard block + rotation guidance), tenant
  policy matrix (which checks block vs warn per workflow), ruleset update
  cadence, evidence hygiene preserved (never store values).
- **Acceptance Criteria:** Planted live-format test credential escalates
  correctly (fixture verifier); policy matrix drives block/warn per
  config; evidence hygiene tests hold.
- **Parallelism/Dependencies:** Needs AP.3, AR.1.
- **Technical Stack:** Verifier integration, policy config.
- **Epic:** AR

---

## Work Order (dependency-ordered execution plan)

```mermaid
flowchart TB
    subgraph P0["Phase 0 — Prerequisites"]
        PRE["DASH-F.1/F.3 (runs, token_usage) · WF-P.1/P.2 (pins, DSL policy)<br/>Routing Z.1 (caps) · Farm AH.1 (reservations) · AD.4 audit shape · #51 internal channel<br/>Scaffolding #41/#46 · BA-C.3/D.5 · DASH-I.8 poll pattern"]
    end
    subgraph P1["Phase 1 — Domain"]
        AO1["AO.1 stage history"] --> AO2["AO.2 event store"] & AO3["AO.3 changes/resources"] & AO4["AO.4 guardrails/controls"]
        AO2 & AO3 & AO4 --> AO5["AO.5 seeds + probes"]
    end
    subgraph P2["Phase 2 — Services"]
        AO2 --> AP1["AP.1 ingestion contract"]
        AP1 --> AP2["AP.2 read APIs + export"]
        AO4 --> AP3["AP.3 guardrail evaluation"] & AP4["AP.4 control queue"]
        AP1 --> AP3
        AP1 & AP4 --> AP5["AP.5 simulated driver"]
        AP2 & AP3 & AP4 & AP5 --> AP6["AP.6 tests"]
    end
    subgraph P3["Phase 3 — UI"]
        AP2 --> AQ1["AQ.1 route + head"]
        AQ1 --> AQ2["AQ.2 controls"] & AQ3["AQ.3 stepper"] & AQ4["AQ.4 transcript + steering"] & AQ5["AQ.5 cards"]
        AP4 --> AQ2 & AQ4
        AQ2 & AQ3 & AQ4 & AQ5 --> AQ6["AQ.6 states + e2e = MVP gate"]
    end
    subgraph V2["v2 — Run Console v2"]
        AR1["AR.1 real execution + enforcement"] -.-> WFT6["WF-T.6"]
        AR2["AR.2 IDE takeover"]
        AR3["AR.3 SSE"] -.-> DJ1["DASH-J.1"]
        AR4["AR.4 Slack steering"] -.-> M19["mockup-19 roadmap"]
        AR1 --> AR5["AR.5 verified scanning"]
    end
    P0 --> P1
    AQ6 -.-> V2
```

Ordered checklist (⊕ = parallelizable within its phase):

1. **Phase 0 — Prerequisites:** DASH-F.1/F.3, WF-P.1/P.2, Routing Z.1, Farm
   AH.1, AD.4, #51, #41/#46, BA-C.3/D.5, DASH-I.8.
2. **Phase 1 — Domain:** AO.1 → { AO.2 ⊕ AO.3 ⊕ AO.4 } → AO.5
3. **Phase 2 — Services:** AP.1 → { AP.2 ⊕ AP.3 ⊕ AP.4 } → AP.5 → AP.6
4. **Phase 3 — UI:** AQ.1 → { AQ.2 ⊕ AQ.3 ⊕ AQ.4 ⊕ AQ.5 } → **AQ.6 ✅**
   *(MVP gate, amending #56)*
5. **v2:** AR.1 with WF-T.6 → AR.5; AR.2 after AQ.2; AR.3 after DASH-J.1;
   AR.4 with mockup 19's roadmap.

## Totals

| | Issues | MVP | v2 |
|---|:---:|:---:|:---:|
| Epic AO — Run Observability Domain | 5 | 5 | 0 |
| Epic AP — Run Services & Contracts | 6 | 6 | 0 |
| Epic AQ — Run Console UI | 6 | 6 | 0 |
| Epic AR — Live Execution & Extended | 5 | 0 | 5 |
| **Total** | **22** | **17** | **5** |

Amendment comments posted at filing:

| Issue | Amendment |
|---|---|
| #91 (DASH-J.3) | Ingestion scope absorbed by **#303** (decision R2); disposition — close as superseded, or retain as the dashboard-side verification ticket |
| #64 (DASH-F.1) | Stage reads move to `run_stages` (**#298**); legacy columns retained through the migration, removal deferred |
| #82 (DASH-I.3) | Active-loop rows now target the real console route (**#309**) |
| #257 (AI.2) | Farm current-job cells link to **#309**; the reservation link is rendered by **#313**, omitted when absent |
| #253 (AH.5) | Pattern-reuse note — the offset-fetch log pattern carries the run transcript (**#304**), caps/elision follow AG.5 |
| #133 (WF-P.2) | Stage permissions become *evaluated* in **#305**; DSL limits snapshot onto stage rows in **#298**; enforcement stays deferred to **#315** |
| #49 | The `/runs/:id` placeholder is retired by **#309** |
| #56 | The smoke suite gains the console e2e leg (**#314**), the MVP gate |

**Reference correction made at filing.** This roadmap cites the permissions debt
as *WF-P.9*; no P.9 issue exists. The `permissions: {push_fixup, touch_ci}` and
`limits: {max_retries, token_budget}` declarations live in **WF-P.2 (#133)**, so
the amendment was posted there. Every other reference in this document resolved
as written.

## References

- Design source: [`docs/mockups/10-run-detail.html`](mockups/10-run-detail.html),
  `docs/mockups/assets/ouroboros.css`; adjacent mockups 11/12/19
- Upstream roadmaps: scaffolding (filed); BetterAuth, dashboard, intake,
  workflow-builder/code, routing, providers, build-farm, planning
  (validation gates — especially DASH-F.1/J.3, WF-P.2/P.9, AH, AD.4)
- Secrets-scanning research:
  [gitleaks alternatives 2026 (rulesets, recall)](https://www.aikido.dev/blog/gitleaks-alternatives) ·
  [gitleaks vs TruffleHog benchmarks](https://appsecsanta.com/secret-scanning-tools/gitleaks-vs-trufflehog) ·
  [layered scanning strategy (pre-commit regex + verified history scans)](https://devsecops.ae/secrets-scanners-comparison-2026/) ·
  [secret-scanning tooling landscape](https://safeguard.sh/resources/blog/best-secrets-detection-tools-2026)
- Patterns in-repo: AH.5 offset log fetch, AG.5 chunk caps/elision, DASH-I.8
  polling, AD.4 audit shape, code-view diff tokens

## UI/UX Shell Compliance (addendum 2026-08-09)

The application shell defined in
[`docs/DESIGN_SYSTEM_APP_SHELL.md`](DESIGN_SYSTEM_APP_SHELL.md) (implementing
roadmap: [`ROADMAP_UIUX_APP_SHELL.md`](ROADMAP_UIUX_APP_SHELL.md)) supersedes
the mockup's top-bar navigation for every UI issue in this roadmap:

1. **Header** — application name/brand upper-left, profile & session controls
   upper-right; no navigation links in the header.
2. **Sidebar navigation** — fixed left rail of icon + name entries from the
   CP.2 module registry. This is a **contextual surface** with no dedicated
   sidebar entry: run views open from Dashboard, Issues, Workflows, and
   Research links, render in the content pane, and keep the originating
   module's sidebar entry active. Page-level tab sets stay at the top of
   the content pane (CP.4 PageSubnav), sticky within the pane's scroll.
3. **Content-only scrolling** — the content pane is the sole scroll
   container; header and sidebar never scroll; sticky in-page chrome
   (subnavs, toolbars, table headers) sticks within the pane; wide content
   (logs, diffs, matrices) scrolls inside its own wrappers, never at pane
   level.
4. **Type scale** — every UI issue uses rem-based type/spacing against the
   #16 tokens (CQ.1) so the five-step font-size preference (CQ.2) scales the
   whole surface; hard-coded px font sizes are lint-banned.
5. **Mockup interpretation** —
   [`docs/mockups/10-run-detail.html`](mockups/10-run-detail.html) remains
   the design source for page content and card anatomy; its topbar/nav
   chrome is superseded by the shell spec.

Issue-level impact:

| Issue | Amendment |
|---|---|
| AQ.1 (#309) | Mounts in the shell content pane as a contextual route (no sidebar entry); breadcrumbs/back affordances orient the user; any streaming log/transcript regions scroll in their own wrappers within the pane |
| AQ.2–AQ.5 (#310–#313) | rem-based type, shell tokens; internal wide/tall regions scroll in their own wrappers |
| AQ.6 (#314) | Gains shell assertions: header/sidebar fixed during content scroll, correct sidebar active state, font-scale render check at 125% |

## Next Step

**Issues filed 2026-08-09.** The validation gate is closed. Created during filing:
the `runs` label, the **`Run Console MVP`** and **`Run Console v2`** milestones, the
four epic parents (#294–#297) and twenty-two work issues (#298–#319) with epic
relationships, issue types and milestone assignments, plus the eight amendment
comments listed above.

The decisions worth re-reading before work starts, all now recorded in the filed
issues:

- **R2 — one ingestion contract, built before the executor exists** (#303). The
  console is proven end-to-end against the *real* contract by a simulated-run driver
  (#307), so when WF-T.6 (#160) lands it plugs into a finished page rather than a
  mockup. That is why the driver exercises interleaving, idempotency and control acks
  rather than a happy path — the bet is settled at #315, and the simulator is what
  makes it safe.
- **R3 / R4 — the transcript is a flight recorder, and it never invents** (#299).
  Typed events with provenance, `simulated` set from the ingesting principal rather
  than a client claim, and caps that insert **elision markers** instead of truncating
  silently. Model reasoning is the most sensitive surface in the product; this is the
  issue that keeps it checkable.
- **R5 — genuine evaluation now, enforcement later, limits stated** (#305). Four
  guardrail checks run for real against reported diffs with evidence that carries a
  path and a rule id and **never the matched value**. The regex ruleset's ~70 % recall
  class is stated in the card's tooltip — a tick that implied more would be the one
  lie on this page that could hurt someone. Blocking arrives with #315; verification
  with #319.
- **R6 — controls are durable and their delivery is visible** (#306, #310). Abort is
  needed exactly when an executor is wedged, which is when a synchronous RPC fails. So
  controls are rows with acks, and the UI distinguishes *acknowledged* from *sent* from
  *expired* rather than rendering all three as success.
- **R7 / R9 — two captions that tell today's truth** (#310, #312). Take-over pauses and
  hands over the branch instead of faking IDE magic (#316 makes it real), and the
  steering caption does not mention Slack until #318 makes that true.

**Prerequisites.** DASH-F.1/F.3/F.5 (#64, #66, #68), WF-P.1/P.2 (#132, #133), Z.1
(#194), AH.1/AH.5 (#249, #253), AD.4 (#225), #24/#41/#46/#51/#52/#56, DASH-I.7/I.8
(#86, #87) and AI.6 (#261) are all filed. Two external gates remain: the **BetterAuth
roadmap is unfiled** (BA-C.3/BA-D.5 gate role visibility on #309/#310), and the
**app-shell roadmap is unfiled** (CP.2 registry, CQ.1/CQ.2 type scale). AR.4 (#318)
additionally waits on the **mockup-19 ChatOps roadmap**, also unfiled.

Once those are in place, begin with **#298** ([AO.1] stage history) — it blocks every
other issue in the roadmap — and then **#303** ([AP.1] the ingestion contract), which
is the piece with reach beyond this roadmap: it is the one door every executor,
simulated or real, reports through, and #91's unbuilt scope is delivered inside it.
The MVP closes at **#314**, the e2e leg that drives a live simulated run.
