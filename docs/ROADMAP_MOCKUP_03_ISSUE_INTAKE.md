# Roadmap — Issue Intake & Sizing (Mockup 03)

## Description

> Create a roadmap that covers the features for the mockup page 03. Refer to the page
> so that issues can reference the mockup file when creating the UI/UX design of the
> pages.

## Context & Existing Work (duplicate-avoidance survey)

Surveyed 2026-08-08.

**Design source of truth for every UI ticket in this roadmap:**
[`docs/mockups/03-issues.html`](mockups/03-issues.html) (with
`docs/mockups/assets/ouroboros.css`) — Issue Intake & Sizing. Its anatomy:

- **Page head** — eyebrow `Issue Intake`, headline `42 open issues. 38 already
  sized.`, subline "Ouroboros watches the GitHub backlog and continuously estimates
  effort, risk, and routing for every open issue — before you ever ask it to work."
  Actions: **Re-estimate all** (ghost), **Queue 3 selected ⟳** (primary, reflects
  selection count).
- **Filter bar** (`.filter-bar` card) — repository select, label chip-set with
  toggled state (`bug ✓` in `chip-on` treatment; `enhancement`, `tech-debt`,
  `good-first-issue`), state select (`Open ▾`), sort select (`Sort: estimated
  effort ▾`), free-text search (`Filter by title, #number, or label…`).
- **Backlog table** (`c-8` card, title `BACKLOG · AS OUROBOROS SEES IT`, freshness
  tag `synced 40s ago`) — columns: checkbox (`.ckbox`, selected rows get
  `tr.sel` accent-glow treatment) · Issue (mono `#485` + title + label tags) ·
  Effort (chip XS–XL + mono confidence `92%`; unsized rows show `sizing…`) ·
  Suggested workflow (tag: `standard-fix`, `feature-loop`, `docs-loop`,
  `deps-refresh`) · Routed model (pill: `claude-fable-5`, `cursor/composer-2`,
  `copilot/gpt-5-codex`, `ollama/qwen3-coder`…) · Status pill (`sized` neutral,
  `queued` run, `estimating…` warn, `needs human` err).
- **Selection action bar** (`.sel-bar`, glow-bordered card) — `3 issues selected ·
  est. 1h 10m combined autonomous work`, **Assign workflow ▾**, **Queue →
  standard-fix**.
- **Issue detail side panel** (`c-4` card, title `ISSUE DETAIL`, status pill) —
  mono meta line (`#485 · opened 2d ago by field-support`), title, tag row
  (incl. `priority-high`), *body excerpt* (italic, left-ruled blockquote of the
  GitHub issue body), divider, **AI Work Breakdown**: estimated files touched
  (mono file-list), breakdown rows (Est. tokens `~180k`, Est. cycle time
  `12–18 min`, Effort chip + conf), **regression risk** meter (ok/22%) with a
  one-line rationale, suggested workflow + routed model, actions (**Queue for
  loop**, **Re-estimate**, **Open on GitHub ↗**), and the collapsible
  **estimation trace** (`sized by claude-sonnet-5 · 2m ago · 41k tokens`,
  `signals: 3 similar closed issues · driver map · HIL test index`).

**The two hard truths this roadmap must respect:**

1. **The backlog is GitHub's.** This page mirrors real GitHub issues for the
   enabled repos (scaffolding #22 / BA-B.3 enablement tables). That requires a
   GitHub API integration that does not exist yet — sync is the foundation epic.
2. **Sizing is an AI capability, and the AI stack doesn't exist yet.** Model
   routing (mockup 06), providers (mockup 07), and knowledge signals (mockup 14)
   are unbuilt. MVP therefore ships the full **estimation pipeline** (request →
   engine → persisted estimate → UI) with a clearly-labeled **heuristic v0
   estimator** in the engine; the LLM-backed estimator is v2 (O.2), slotting into
   the same contract. Same honesty rule as the dashboard roadmap: seeded parity
   for design review, truthful states everywhere else — `estimating…` and
   `needs human` are real pipeline states, never decoration.

**Overlapping open issues / prior roadmaps and their disposition:**

| Existing work | Disposition under this roadmap |
|---|---|
| Scaffolding #22 `ouroboros-db: [3.4] GitHub org & repo enablement` (amended by BA-B.3) | **Consumed** — sync targets only enabled repos. No change. |
| Scaffolding #35 `[4.9] Engine gateway` / #52 `[6.3] Internal API contract v0` | ✅ **Extended** by L.1 (#105) — `POST /v0/estimate` is the first real engine capability beyond echo, mirrored in the gateway's typed client as `EngineClient.estimate()`. L.3 is the caller that puts it to work. |
| Scaffolding #49 placeholder routes (v2) | **Superseded for `/issues`** — this roadmap builds the real screen; other placeholders unchanged. |
| Dashboard roadmap (`ROADMAP_MOCKUP_02_DASHBOARD.md`, validation gate) — `queue_items` (DASH-F.2), queue endpoint (DASH-G.4), run read-model (DASH-F.1) | **Consumed & extended** — M.3's queue action writes `queue_items`; queue write semantics (deliberately out of DASH-G.4's scope) land **here**. The dashboard's "⟳ Pull next issue" button gains a real target. |
| BetterAuth roadmap (validation gate) — tenant context (BA-C.3), enabled repos (BA-C.4), auth client (BA-D.1) | **Prerequisite** — all backlog queries are org-scoped; the filter bar's repo select reads enabled repos. |
| Mockup 04 (workflows), 06 (routing), 07 (providers), 14 (knowledge) | **Not covered here** — workflow tags and model ids stay opaque strings (decisions K5/K6); trace "signals" are v2 (O.4). |

Epic letters continue the sequence (A–E BetterAuth, F–J dashboard): this roadmap uses
**K–O**.

### Decisions proposed by this roadmap (validate before issue creation)

| # | Decision | Rationale |
|---|----------|-----------|
| K1 | **MVP GitHub access = per-org token** (fine-grained PAT / installation token pasted into workspace settings, encrypted at rest); **GitHub App + webhooks = v2** (O.1) | A token gets the page real data now at 5k req/h; the App install flow (15k req/h, instant webhooks) is real product surface that deserves its own pass. The sync layer hides the difference. |
| K2 | **Sync = incremental polling with a per-repo `since` cursor** (GitHub `updated_at`), full pagination on first import, freshness surfaced honestly ("synced 40s ago") | GitHub's documented incremental pattern; webhooks (O.1) later reduce latency without changing the read-model. |
| K3 | **`github_issues` is a cache, GitHub is the source of truth** — no local edits to issue content, ever; actions that change GitHub (none in MVP) go through the API | Prevents the mirror from becoming a fork. "Open on GitHub ↗" is the escape hatch the panel promises. |
| K4 | **Estimates are versioned rows** (`issue_estimates`, latest-wins) with sizing status on the issue row: `unsized → estimating → sized \| needs_human` | Re-estimation is first-class in the mockup (three separate affordances); versioning gives the trace history and makes O.2's estimator swap auditable. |
| K5 | **Workflow tags remain opaque strings from a fixed built-in set** (`standard-fix`, `feature-loop`, `docs-loop`, `deps-refresh`) until mockup 04's roadmap | The "Assign workflow ▾" menu offers the fixed set; no workflow entities are invented here. |
| K6 | **Routed model = opaque string produced by the estimator** (consistent with dashboard decision F8) | Model routing is mockup 06 territory; the heuristic v0 routes from a config-listed default map. |
| K7 | **Estimation runs through the engine** (REST orchestrates, engine computes) even while the estimator is heuristic | The pipeline shape — queue estimation, engine computes, REST persists, UI polls — is the product architecture; v0 heuristic vs v2 LLM is an engine-internal swap. |
| K8 | **Filters/sort/search are server-side, URL-reflected** (`?repo=&labels=&state=&sort=&q=`) | Backlogs exceed a page; shareable filtered views; the filter bar is a query-string editor. |
| K9 | **Queue writes land here**: bulk queue endpoint creates `queue_items` (DASH-F.2) with assigned workflow tag and est. minutes | The dashboard deliberately shipped queue reads only; the mockup-03 actions are the write side. |
| K10 | **New label `intake`**; heuristic estimates render their provenance (trace says `heuristic-v0`, never a model name it didn't use) | Honesty in the trace is non-negotiable — a fake "sized by claude-sonnet-5" line would be lying UI. |

## Architecture Overview

```mermaid
flowchart LR
    subgraph GitHub
        GH["github.com<br/>issues API (since-cursor)"]
    end
    subgraph "ouroboros-rest (NestJS)"
        SYNC["BacklogSyncService<br/>poll · paginate · upsert"]
        EST["EstimationOrchestrator<br/>dispatch · persist · status"]
        API["/api/v1/backlog · /backlog/:id<br/>/backlog/queue · /backlog/sync"]
    end
    subgraph "ouroboros-engine (FastAPI)"
        HV0["estimator v0 (heuristic)<br/>→ v2: LLM estimator (O.2)"]
    end
    subgraph "ouroboros-db"
        GI[("github_issues (cache)")]
        IE[("issue_estimates (versioned)")]
        QI[("queue_items (DASH-F.2)")]
    end
    UI["ouroboros-ui /issues<br/>mockup 03"]
    GH -->|"REST + ETag/since"| SYNC --> GI
    EST -->|"POST /v0/estimate (shared secret)"| HV0 --> EST
    EST --> IE
    API --> GI & IE
    API -->|"bulk queue (K9)"| QI
    UI --> API
```

## MVP Definition

The MVP is **mockup 03 as a working screen over real GitHub data with a live
estimation pipeline**. It is done when, against the compose stack:

1. Enabled repos' open issues **sync from GitHub** (initial import + incremental
   `since` polling), with freshness shown truthfully ("synced 40s ago") and a
   manual re-sync affordance.
2. `/issues` reproduces [`docs/mockups/03-issues.html`](mockups/03-issues.html)
   pixel-faithfully in **both themes**: page head with real counts, filter bar
   (repo/labels/state/sort/search, URL-reflected), backlog table with selection,
   effort+confidence, workflow tags, model pills, and all four status states.
3. Every synced issue flows through the **estimation pipeline**: `estimating…`
   while in flight, then `sized` (effort, confidence, workflow, model, breakdown,
   risk, trace) or `needs human` — produced by the engine's clearly-labeled
   heuristic v0 estimator through the real REST↔engine contract.
4. The **detail panel** renders the selected issue: GitHub body excerpt, work
   breakdown, risk meter, trace with honest provenance (`heuristic-v0`), and
   working actions (Queue for loop, Re-estimate, Open on GitHub ↗).
5. **Selection → queue** works: multi-select, combined estimate in the action
   bar, workflow assignment from the fixed set, bulk queue writing `queue_items`
   — visible on the dashboard's queue card immediately after.
6. **Re-estimate** (single + all) re-runs the pipeline, versioning estimates.
7. Seeds reproduce the mockup's demo rows for design review and e2e; a workspace
   with no enabled repos / no token shows designed guidance states.
8. Integration tests cover sync upsert/cursor logic, estimation lifecycle, filter
   queries, queue writes, and org isolation; the e2e suite gains an issues leg.

**Explicitly v2:** GitHub App + webhooks (O.1), LLM-backed estimator (O.2), real
workflow entities in the assign menu (O.3), knowledge-driven trace signals (O.4),
and issue-content mutations on GitHub (labels/comments — O.5).

## Epics

Each epic is a parent tracking issue on GitHub; every roadmap issue below is filed as
one of its sub-issues (GitHub Relationships).

| Epic | GitHub | Status | Name | Goal | Modules |
|------|:------:|:------:|------|------|---------|
| K | #94 | 🟡 Open | GitHub Backlog Sync (`ouroboros-db` + `ouroboros-rest`) | Token config, issue cache schema, incremental sync, seeds & CI | ouroboros-db, ouroboros-rest |
| L | #95 | 🟡 Open | Estimation Pipeline (`ouroboros-engine` + `ouroboros-rest`) | Estimate contract, heuristic v0, orchestration, versioned persistence | ouroboros-engine, ouroboros-rest |
| M | #96 | 🟡 Open | Backlog REST API (`ouroboros-rest`) | List/detail/filters, queue writes, sync status, tests | ouroboros-rest |
| N | #97 | 🟡 Open | Issue Intake UI (`ouroboros-ui`) | Mockup 03: filter bar, table+selection, action bar, detail panel, e2e | ouroboros-ui |
| O | #98 | 🟡 Open | Live Intake & Extended Scope (v2) | GitHub App + webhooks, LLM estimator, workflow entities, signals | all |

Issue naming: `<project>: [<epic letter>.<issue>] <title>`. Labels reuse the
existing set (`mvp`, `v2`, `rest`, `db`, `engine`, `ui`, `ci`, `design`) plus new
**`intake`** (decision K10; created during issue filing). Complexity chips:
**XS · S · M · L**.

---

## Epic K (#94) — GitHub Backlog Sync (`ouroboros-db` + `ouroboros-rest`)

| Ref | GitHub | Status | Title | Summary | Labels | Parallel | MVP | Complexity | Affected Modules |
|-----|:------:|:------:|-------|---------|--------|:--------:|:---:|:----------:|------------------|
| K.1 | #99 | 🟢 Done | ouroboros-db: [K.1] GitHub issue cache schema | `github_issues` mirror table + labels + sync cursors | mvp, intake, db | N (after #19, BA-B.3) | Y | M | ouroboros-db |
| K.2 | #100 | 🟢 Done | ouroboros-db: [K.2] Issue estimates schema | Versioned `issue_estimates` + sizing status + breakdown/trace jsonb | mvp, intake, db | N (after K.1) | Y | M | ouroboros-db |
| K.3 | #101 | 🟢 Done | ouroboros-rest: [K.3] GitHub credentials & API client | Per-org token (encrypted), Octokit client, rate-limit discipline | mvp, intake, rest | N (after #28, BA-C.3) | Y | M | ouroboros-rest |
| K.4 | #102 | 🟢 Done | ouroboros-rest: [K.4] Backlog sync service | Initial import + incremental `since` polling, upsert, freshness | mvp, intake, rest | N (after K.1, K.3) | Y | L | ouroboros-rest |
| K.5 | #103 | 🟢 Done | ouroboros-db: [K.5] Intake dev seeds — mockup-03 parity | Seeded issues/estimates reproducing the mockup's nine rows | mvp, intake, db | N (after K.2) | Y | S | ouroboros-db |
| K.6 | #104 | 🟢 Done | ouroboros-db: [K.6] Intake constraints in ci/db | Status vocabularies, cursor invariants, estimate versioning checks | mvp, intake, db, ci | N (after K.5, #24) | Y | XS | ouroboros-db, .github |

### Issue K.1 — ouroboros-db: [K.1] GitHub issue cache schema

> **GitHub issue:** #99 · **Status:** 🟢 Done · **Parent epic:** #94

> **Shipped.** [`V014__github_issue_cache.sql`](../ouroboros-db/migrations/V014__github_issue_cache.sql)
> creates `ouroboros.github_issues` with the column set below, the three filter indexes and
> its rules as named CHECK constraints, and adds `issues_synced_at` / `issues_sync_cursor`
> to `github_repos`; the assertions are a new section in
> [`tests/constraints.sql`](../ouroboros-db/tests/constraints.sql), so `ci/db` runs them
> against a database migrated from empty on every pull request. The version is `V014` —
> `V013` is #222's `tenant_keys`.
>
> **Both blockers were already met.** `#19` is the Flyway scaffold, and **BA-B.3** — the
> organization and repo tables — is `organization` (`V005`, #707) plus `github_repos`,
> which has been there since `V003` (#22) and was re-parented by `V006` (#708). This is the
> same finding DASH-F.1 (#64) made under the dashboard roadmap, and it means Epic K did not
> have to wait on the unfiled BetterAuth tail.
>
> **The cache-not-fork posture is the migration's first section** (decision **K3**), above
> the DDL rather than beside a column, because it is the thing a later reader is most
> likely to get wrong: a local table of titles, bodies and labels looks exactly like one a
> user could edit, and the first `update` that sets a title from a form turns the mirror
> into a fork. The shape is deliberately unhelpful to that — no `edited_by`, no
> `local_title`, no dirty flag — and `synced_at` records that a row is a copy taken at a
> moment rather than a document with a history. The rule is about *authorship*, not
> mutability: K.4's sync overwrites GitHub's columns on every poll, and `sizing_status` is
> the one column this product owns.
>
> **`labels` is a checked array of names, not free jsonb.** `jsonb` alone accepts `3`,
> `"bug"` and `[{"name": "bug"}]` — and GitHub's own payload *is* a list of label objects,
> so the wrong one is a single `.map()` away and the GIN index would store it happily.
> `github_issues_labels_shape` requires an array of non-empty strings, at most GitHub's own
> cap of 100, using `jsonb_path_exists` because a CHECK may not contain the subquery
> `jsonb_array_elements` would need. The index is `jsonb_ops` rather than the smaller
> `jsonb_path_ops`: both serve `@>`, only the default serves `?|` and `?&`, and an
> any-of-these-labels chip-set is the read that has not been written yet.
>
> **This migration takes an extension, which is the schema's first** — `pg_trgm`, so the
> filter bar's search box is an index scan. `V001` declined `citext` because
> `create extension` needs rights a managed PostgreSQL may withhold; that argument does not
> reach here on either half, and the header says so. There is no stored form of a title
> that makes `ilike '%watchdog%'` an index scan — a b-tree on `lower(title)` serves a
> prefix and nothing else — and `pg_trgm` has been a **trusted** extension since PostgreSQL
> 13, so any role holding `create` on the database installs it. That was verified rather
> than assumed, with a plain `login` role on the pinned `postgres:17-alpine`. It is created
> through a catalogue guard rather than `if not exists`, which is `V000`'s idiom and for
> `V000`'s reason: `if not exists` raises a NOTICE, and Flyway reports every NOTICE as a
> WARNING.
>
> **`gh_url` is constrained to `https` and a host**, which is a safety rule rather than a
> tidiness rule: the column becomes the `href` of *"Open on GitHub ↗"*, and an `href` is a
> place `javascript:` executes rather than navigates. Refusing it in the column means no
> renderer has to remember to check — and the writer is an HTTP client parsing somebody
> else's JSON. It deliberately does not check that the URL names *this* repository and
> *this* number: GitHub Enterprise Server serves the same issue from another host, and a
> mirror that refused a URL GitHub itself returned would be broken by a rename it has no
> say in.
>
> **The sync cursor lives on `github_repos`** (decision **K2**) — one value per repository
> per poll, not a property of any issue — and both columns are nullable, because nothing
> has synced yet. `github_repos_issues_cursor_after_sync` holds the watermark to *after*
> the sync that produced it, as an implication rather than a biconditional: the other
> direction is legitimate, and is what a first poll of a repository with no issues leaves
> behind. The alternative that was not taken is deriving the watermark as
> `max(gh_updated_at)`, which reads as free and is wrong exactly where it matters — a
> deleted or transferred issue leaves the maximum where it was, and a repository whose poll
> found nothing has no maximum at all.
>
> **One change outside `ouroboros-db`.** `ouroboros-rest`'s `schema.ts` mirrors the
> migrations and `db.integration-spec.ts` fails when it drifts, so the two new
> `github_repos` columns are declared there too (and in the four fixtures that build a
> `GithubRepo`). `github_issues` itself is deliberately *not* mirrored yet — nothing reads
> it until K.4, and `model_prices` set that precedent.
>
> **Not in this ticket, by the roadmap's own split:** no estimates table or `issue_estimates`
> FK (K.2, #100), no sync service and no writer of any kind (K.4, #102), no seed rows (K.5,
> #103), and no probes in `verify-constraint-probes.sh` (K.6, #104, which owns the intake
> half of `ci/db`). There is also no index on `sizing_status` — the reads that filter by it
> are workspace-scoped first, so they enter through the filter index, and the ticket that
> writes that read is the ticket that gives it one.

- **Problem Statement:** The backlog table renders GitHub issues with labels, author,
  and open-date ([`docs/mockups/03-issues.html`](mockups/03-issues.html), issue cell +
  detail panel meta line); no local representation exists.
- **Solution/Scope:** Migration (follows the dashboard series): `github_issues` —
  id, `organization_id` FK, `github_repo_id` FK (BA-B.3), `number`, `title`, `body`
  (text — the detail panel excerpts it), `state` CHECK `open|closed`, `labels` jsonb
  (name array — GitHub's label set, not ours), `author_login`, `gh_created_at`,
  `gh_updated_at`, `gh_url`, `synced_at`; unique `(github_repo_id, number)`;
  `sizing_status` CHECK `unsized|estimating|sized|needs_human` default `unsized`
  (decision K4). Sync cursor lives on `github_repos`: add `issues_synced_at`,
  `issues_sync_cursor` (the `since` watermark, decision K2). Indexes for the M.1
  filter paths (org+repo+state, labels GIN, title trigram or ILIKE-served).
- **Acceptance Criteria:**
  - Migration applies/validates cleanly; unique repo+number holds.
  - Label containment queries and title search use indexes (`EXPLAIN` verified).
  - Cache-not-fork posture documented in the migration header (decision K3).
- **Parallelism/Dependencies:** Needs #19, BA-B.3. Blocks K.2, K.4, K.5.
- **Technical Stack:** PostgreSQL 17, Flyway.
- **Epic:** K

```mermaid
erDiagram
    github_repos ||--o{ github_issues : "mirrors open issues of"
    github_issues ||--o{ issue_estimates : "sized by (K.2)"
    github_issues {
        uuid id PK
        text organization_id FK
        uuid github_repo_id FK
        int number "UK with repo"
        text title
        text body
        text state "open|closed"
        jsonb labels
        text author_login
        timestamptz gh_created_at
        timestamptz gh_updated_at
        text gh_url
        timestamptz synced_at
        text sizing_status "unsized|estimating|sized|needs_human"
    }
```

### Issue K.2 — ouroboros-db: [K.2] Issue estimates schema

> **GitHub issue:** #100 · **Status:** 🟢 Done · **Parent epic:** #94

> **Shipped 2026-09-08.**
> [`V026__issue_estimates.sql`](../ouroboros-db/migrations/V026__issue_estimates.sql) creates
> `ouroboros.issue_estimates` with the column set below, its two jsonb grammars, its rules as
> named CHECK constraints and two triggers; the assertions are a new section in
> [`tests/constraints.sql`](../ouroboros-db/tests/constraints.sql), so `ci/db` runs them
> against a database migrated from empty on every pull request. The version is `V026` —
> `V025` is #584's `alias_revisions`. No other module changed.
>
> **The contract's drift check went live on the day this landed, and it is green.**
> [`test_estimation_contract.py`](../ouroboros-engine/tests/test_estimation_contract.py) was
> written to find the migration that creates `issue_estimates` and then assert every column
> and jsonb key it carries as data appears in it. It now finds `V026`, and every name matches
> — `effort`, `confidence`, `suggested_workflow`, `routed_model`, `breakdown` (`files`,
> `est_tokens`, `cycle_min`, `cycle_max`, `est_minutes`), `risk`, `risk_note` and `trace`
> (`estimator`, `sized_at`, `tokens_used`, `signals`) — so L.3 persists a parsed response
> without translating one.
>
> **Latest-wins needed no index, and that was measured rather than assumed.** The ticket
> offers a partial unique index on an `is_latest` flag or a covering index on
> `(github_issue_id, version desc)`; the answer is neither, because the unique key
> `(github_issue_id, version)` **read backwards is** that descending index — same tree, same
> entries, and a second copy would be maintained on every insert for a plan the planner
> already has. `constraints.sql` asserts the plan by name, asserts it contains no `Sort`, and
> asserts the lateral join the backlog table makes over a page of issues reaches *both*
> relations through an index. The flag was also rejected on its own merits: it is derived
> state a writer has to maintain, a partial unique index on it can enforce *at most one*
> latest and nothing about *at least one*, and its failure mode is an issue whose estimates
> all read `false` and whose panel says never sized. `max(version)` cannot desynchronise from
> the rows it is computed over.
>
> **Monotonic is a trigger, because unique alone is not enough.** `unique (github_issue_id,
> version)` accepts 3 and then 2 — two legal rows — and *latest wins* would then return the
> older answer, which is a wrong estimate rather than a missing one.
> `issue_estimate_version_monotonic()` refuses a version that is not above every version the
> issue already has, and the unique key underneath it is what makes that safe under
> concurrency: two writers that both computed `max + 1` cannot both commit. It **enforces
> rather than assigns** — a default would hide the one case a writer must handle. Monotonic,
> not dense: nothing counts these numbers.
>
> **Append-only, on `V024`'s posture and for one reason of its own.** `issue_estimates_no_update`
> refuses a revision from any role including the owner, there is no `updated_at` and no touch
> trigger. The reason of its own is the #435 amendment: BI.4 grades a merged loop against the
> estimate **in force when the work was queued**, and that join only means anything while a
> historical row cannot change underneath it. There is no delete counterpart, for `V022`'s
> reason — the one foreign key cascades, so a delete-refusing trigger would make removing an
> issue fail rather than protect anything.
>
> **Decision K10 is a constraint of its own, not a clause in a shape rule.**
> `issue_estimates_provenance` requires `trace->>'estimator'` to be a non-blank **string**, so
> a rejected write names the decision — and the type check is what separates *no estimator*
> from an estimator called `3`, which `->>` alone would have accepted. It is the third hop
> rather than the only one: the engine's model and the gateway's parser both require it.
>
> **Every bound is the estimation contract's, and never stricter.** A column that refused a
> legal estimate would leave L.3 holding an answer it cannot write and an issue stuck
> mid-pipeline for a reason no log would explain — so `est_minutes` runs to the contract's
> 100 000 even though `queue_items.est_minutes` (`V009`) refuses zero and anything past a
> fortnight, and reconciling the two is M.3's (#112), at the statement that copies one into
> the other. Two things the contract does not say are not added either: `est_minutes` is not
> confined to the cycle range (the ticket's own example is a 12–18 minute cycle beside 23
> estimated minutes), and `est_tokens` — what the *work* will cost — is unrelated to
> `trace.tokens_used`, what *sizing* cost.
>
> **Both jsonb documents are closed grammars**, CHECKed by
> `ouroboros.issue_estimate_breakdown_valid()` and `…_trace_valid()`: exactly five keys and
> exactly four, every count whole and non-negative by regex (jsonb calls `-1` and `1.5`
> numbers too), a cycle range that runs forwards, and a `sized_at` that is an ISO-8601 instant
> **with an offset** — by regex rather than by cast, because `timestamptz` input reads the
> session's `TimeZone` and is not immutable. Underneath them,
> `ouroboros.jsonb_string_list_valid()` and `ouroboros.jsonb_whole_number_valid()` are the two
> shapes both documents share, written once rather than six times.
>
> **Decisions K5 and K6 are structural here too, and M1 is not breached.**
> `suggested_workflow` and `routed_model` get `runs.workflow_tag` and `runs.model`'s treatment
> under **F8** — bounded, non-blank, no vocabulary and no foreign key. M1 says
> `model_aliases.model_id` is the only column where a raw provider model string may live; that
> is a rule about **configuration**, and this column is a **record of a resolution that already
> happened**, which must survive the rename or retirement of what it names.
>
> **The row's tenancy is its issue's.** There is no `organization_id`, as `provider_models`
> (`V017`) has none: an estimate has no meaning apart from an issue, every read enters through
> one, and a second parent would buy a shorter join in exchange for a
> `repo_in_organization`-style trigger that can be got wrong. The workspace cascade reaches it
> through four hops, and a test asserts exactly that.
>
> **What is deliberately not here:** no `draft_id` — that is AK.1's (#272) column and its
> migration, per decision **N3**, and the header names it so a later reader does not read its
> absence as an oversight; no writer of any kind (L.3, #107); no seed rows (K.5, #103); and no
> mutations in `verify-constraint-probes.sh`, which is K.6's (#104) intake half of `ci/db`.
> There is also no constraint tying an estimate's existence to `github_issues.sizing_status`:
> a CHECK cannot see another row, and the pairing is not even one-directional — an issue that
> is `needs_human` because its confidence came in under L.2's floor of 70 has an estimate
> *and* is waiting for a person.

- **Problem Statement:** Everything the mockup calls "AI Work Breakdown" — effort,
  confidence, workflow, model, files, tokens, cycle range, risk, trace — needs a
  home that survives re-estimation (three re-estimate affordances in the mockup).
- **Solution/Scope:** `issue_estimates`: id, `github_issue_id` FK, `version` (unique
  with issue, monotonic), `effort` CHECK `xs|s|m|l|xl`, `confidence` (0–100),
  `suggested_workflow` (opaque tag, decision K5), `routed_model` (opaque, K6),
  `breakdown` jsonb (`files[]`, `est_tokens`, `cycle_min`/`cycle_max` minutes,
  `est_minutes` — the queue estimate M.3/K9 consumes), `risk` CHECK
  `low|medium|high` + `risk_note`, `trace` jsonb (`estimator` — e.g.
  `heuristic-v0`, `sized_at`, `tokens_used`, `signals[]`), `created_at`. A partial
  unique index or `is_latest` flag makes latest-lookup cheap; `sizing_status` on
  the issue row transitions with the pipeline (L.3).
- **Acceptance Criteria:**
  - Two estimates for one issue coexist; latest-wins lookup is a single indexed
    query.
  - Effort/risk CHECKs match the mockup vocabularies; confidence bounds enforced.
  - Trace `estimator` field is non-null (decision K10 — provenance is mandatory).
- **Parallelism/Dependencies:** Needs K.1. Blocks L.3, K.5.
- **Technical Stack:** PostgreSQL 17, Flyway.
- **Epic:** K

```
issue_estimates(issue, version↑) ─ latest ─▶ effort M · conf 92 · standard-fix · claude-fable-5
   breakdown: {files[3], est_tokens:180k, cycle:[12,18], est_minutes:23}
   risk: low "Isolated to the I²C driver path…" · trace: {estimator, signals[]}
```

### Issue K.3 — ouroboros-rest: [K.3] GitHub credentials & API client

> **GitHub issue:** #101 · **Status:** 🟢 Done · **Parent epic:** #94

- **Problem Statement:** Sync needs authenticated GitHub access per organization —
  no credential store or client exists (scaffolding #22 was deliberately data-only).
- **Solution/Scope:** Per decision K1: `github_credentials` columns on the org
  settings surface (token encrypted at rest with a key from config — encryption
  helper reusable later), settings endpoint to set/rotate/clear the token
  (owner/admin), an Octokit-based client wrapper: auth injection, pagination
  helper, rate-limit awareness (read `x-ratelimit-remaining`, back off before
  exhaustion), conditional requests (ETag) where useful, error taxonomy
  (unauthorized / not-found / rate-limited) mapped to the #31 envelope. Token
  never returned by any API after write; masked display (`ghp_…abcd`).
- **Acceptance Criteria:**
  - Token round-trips: set → sync works; clear → sync pauses with a designed
    status; rotate → old token unused.
  - Token absent from all API responses and logs (tested).
  - Rate-limit backoff verified with a mocked 403/`retry-after` response.
- **Parallelism/Dependencies:** Needs #28, BA-C.3. Blocks K.4. Sources: GitHub REST
  docs (rate limits, `since`), Octokit.
- **Technical Stack:** Octokit (@octokit/rest), NestJS, AES-GCM encryption at rest.
- **Epic:** K

```
settings ─▶ store token (encrypted, masked) ─▶ GitHubClient
  ├─ paginate(iterator) · since-cursor · ETag
  └─ rate guard: remaining < floor ─▶ defer next poll (honest "sync paused" state)
```

### Issue K.4 — ouroboros-rest: [K.4] Backlog sync service

> **GitHub issue:** #102 · **Status:** 🟢 Done · **Parent epic:** #94

- **Problem Statement:** The page's headline claim — "Ouroboros watches the GitHub
  backlog" — is this service. It must import enabled repos' open issues, keep them
  fresh, and report freshness truthfully (`synced 40s ago`).
- **Solution/Scope:** `BacklogSyncService`: initial import (paginate all open
  issues; PRs filtered out — the issues API returns both) per enabled repo, then
  scheduled incremental polls (`since` = stored cursor, decision K2) upserting
  changed rows and closing state transitions; new/reopened issues enter
  `unsized` and are handed to the estimation pipeline (L.3) automatically —
  "continuously estimates… before you ever ask" is this handoff; per-repo
  `synced_at` + cursor updates in the same transaction; poll scheduling via Nest
  scheduler with jitter; sync disabled (with status) when no token (K.3) or no
  enabled repos. Manual trigger endpoint lands in M.4.
- **Acceptance Criteria:**
  - Cold import of a live repo lands all open issues (PRs excluded); second poll
    with no changes is O(1) requests and touches no rows.
  - Editing an issue on GitHub appears locally within one poll interval; closing
    it flips `state` (and it leaves the default backlog view).
  - New issue auto-enters the estimation pipeline (verified with L.3).
  - Freshness value is the real `synced_at`, never fabricated.
- **Parallelism/Dependencies:** Needs K.1, K.3. Blocks L.3, M.1, M.4.
- **Technical Stack:** NestJS scheduler, Octokit, Kysely transactions.
- **Epic:** K

```mermaid
sequenceDiagram
    participant S as BacklogSyncService
    participant G as GitHub API
    participant D as github_issues
    participant E as Estimation (L.3)
    Note over S: per enabled repo, poll interval + jitter
    S->>G: GET /repos/:o/:r/issues?state=open&since=cursor (paginated)
    G-->>S: changed issues (PRs filtered)
    S->>D: upsert rows · update state transitions
    S->>D: set repo.synced_at + cursor (same tx)
    S->>E: enqueue estimation for new/reopened (unsized)
```

### Issue K.5 — ouroboros-db: [K.5] Intake dev seeds — mockup-03 parity

> **GitHub issue:** #103 · **Status:** 🟢 Done · **Parent epic:** #94

> **Shipped.** [`R__dev_seed_intake.sql`](../ouroboros-db/migrations/R__dev_seed_intake.sql)
> is the sixth development seed: the nine mockup-03 issues `#483`–`#491` in
> `acme-robotics / helios-firmware` and the nine `issue_estimates` that size eight of them,
> behind the same `${ouro_dev_seed}` guard every other seed carries. The head counts
> compute to **"9 open issues. 7 already sized."**; `#485` is the detail panel field for
> field — four labels, `field-support`, the body it excerpts, three files, `~180k` tokens,
> a `12–18 min` cycle and `low` risk with the mockup's sentence; `#483` is `estimating`
> with no estimate row and `#490` is `needs_human` at XL/61%. `kensuenobu` gets **zero
> rows**, which is N.6's empty state as data rather than as a screenshot.
> [`tests/seed.sql`](../ouroboros-db/tests/seed.sql) asserts all of it and
> [`tests/seed.test.sh`](../ouroboros-db/tests/seed.test.sh) asserts the file's structure,
> both extended for a sixth seed rather than forked.
>
> **Two things the mockup shows are deliberately not in the database**, because seeding
> them would make a screen render a claim no component produced. `trace.estimator` is
> `heuristic-v0` on every row (decision **K10**) with `tokens_used` `0` and `signals` `[]`
> — the mockup's *"sized by claude-sonnet-5 · 2m ago · 41k tokens"* over three retrieved
> signals describes a knowledge layer that does not exist yet, and those lines are **O.4**'s
> to supply. And the head's *42 open / 38 sized* stays design copy: the counts are
> aggregates M.1 computes, so nine rows honestly count to nine.
>
> **The two mockups disagree about which issues are queued, and the seed follows the rows
> that exist.** `queued` is not a `sizing_status` — it is a presentation over
> `queue_items`, and DASH-F.5 (#68) owns all twelve of those. Six are in this repository
> (`#485`, `#486`, `#488`, `#490`, `#491`, `#494`), so the seeded backlog presents `#485`,
> `#490` and `#491` as queued where mockup 03 draws `#486`, `#488` and `#489` — mockup 02's
> queue card puts `#485` at position 1 while mockup 03's table calls it `sized`, and one
> database cannot make both true. A thirteenth queue row written from the intake seed would
> break *Queued issues* and its `est. 9h 40m` to decorate the backlog, so the ticket's
> *cross-referenced, not duplicated* rule is followed literally and the disagreement is
> written down in the migration's header for **M.1 (#110)** and **N.2 (#118)** to read
> before assuming their query is wrong. Where an issue *is* queued in this repository, its
> estimate's `est_minutes` is the queue row's number, because M.3 (#112) copies one into
> the other.
>
> **Three smaller decisions**, each of them the fixture covering a path it would otherwise
> leave dark — DASH-F.5's argument for its one unestimated queue item. `#487` carries **two
> estimate versions**, an `s`/55% superseded by the mockup's `l`/71%, because against a
> fixture where every issue has exactly one estimate a latest-wins join, a `min(version)`
> join and an arbitrary-row join all pass. `#488`'s breakdown names **no files**, which
> `V026` makes valid on purpose and which the panel has to render. And `#490` is opened by
> **`renovate[bot]`**, so the rule `V028` had just widened is exercised by the data every
> UI test reads rather than only by `tests/constraints.sql`.
>
> **`#483` gets no estimate row**, which is what `estimating` means: `issue_estimates` has
> no partial row, since `effort` and `confidence` are `not null` and an estimate is one
> answer rather than four fields that arrive separately. The mockup draws `standard-fix`
> and `claude-sonnet-5` in that row's workflow and model cells beside a `sizing…` effort;
> those two cells are not storable, and N.2 renders a mid-flight row from what exists.
>
> **The estimates carry a second guard, and it is load-bearing.**
> `issue_estimate_version_monotonic` (`V026`) is a BEFORE INSERT trigger, so it raises
> *before* `on conflict do nothing` can skip a row — a second application of the file would
> fail the migration outright rather than write nothing. Both estimate statements therefore
> carry a `not exists` that is the trigger's own rule evaluated a step earlier, which is
> also what makes the seed *decline* rather than fail on a database somebody has estimated
> by hand. Verified: re-applying the file writes zero rows and raises nothing; re-applying
> it without the guard raises `issue_estimate_version_monotonic`.
>
> **The ticket's own diagram does not add up, and the acceptance criterion is what was
> built.** It reads *"6 sized · 1 estimating · 1 needs_human · (3 queued via DASH seeds)"*,
> which is eleven rows for nine issues however the parenthesis is read. The criterion below
> it — *"9 open issues. 7 already sized."* — is unambiguous and agrees with the mockup: the
> three issues the mockup presents as *queued* are `sized` in the database and queued in
> `queue_items`, so the sized count is seven and the nine partition as **7 sized · 1
> estimating · 1 needs_human**. Noted here rather than silently reconciled, because a
> reader who counts the seeded rows against that diagram should find the arithmetic
> explained instead of assuming the seed is short two rows.

- **Problem Statement:** Design review and e2e need the exact mockup rows without a
  live GitHub token; the seeds are the fixture (same rule as dashboard F.5).
- **Solution/Scope:** Extend the dev seed (dev-only guard): for `acme-robotics /
  helios-firmware` — the nine mockup issues (`#483`–`#491`: titles, label sets,
  authors incl. `field-support`, the `#485` body text used by the detail panel)
  with estimates matching the mockup exactly (`#485` M/92%/standard-fix/
  claude-fable-5 + breakdown files/tokens/cycle/risk-low/trace, `#483` mid-
  `estimating`, `#490` XL/61% `needs_human`, `#486/#488/#489` queued — their
  queue_items already exist in DASH-F.5, cross-referenced not duplicated);
  trace estimator strings say `heuristic-v0` (decision K10) with the mockup's
  signal lines reserved for O.4 seeds. Personal org: zero rows (empty-state
  fixture).
- **Acceptance Criteria:**
  - M.1 list over seeds reproduces the mockup table ordering under
    `sort=effort`; detail panel for `#485` matches the mockup content.
  - Head counts compute to "9 open issues. 7 already sized." *(seed truth —
    the mockup's 42/38 needs no fabrication)*.
  - Idempotent; consistent with DASH-F.5 queue seeds (no double-queue rows).
- **Parallelism/Dependencies:** Needs K.2 (+DASH-F.5 coordination). Feeds M/N
  tests, e2e.
- **Technical Stack:** Flyway repeatable migration, SQL.
- **Epic:** K

```
seeds: 9 issues (#483–#491) ─▶ 6 sized · 1 estimating · 1 needs_human · (3 queued via DASH seeds)
#485 carries full breakdown + body text ─▶ detail-panel fixture
```

### Issue K.6 — ouroboros-db: [K.6] Intake constraints in ci/db

> **GitHub issue:** #104 · **Status:** 🟢 Done · **Parent epic:** #94

> **Shipped 2026-09-09. Epic K is complete.**
> Seven mutations in
> [`tests/verify-constraint-probes.sh`](../ouroboros-db/tests/verify-constraint-probes.sh),
> run by `ci/db`'s *Assert those assertions are load-bearing* step, with their names held
> against the migrations by
> [`tests/constraint-probes.test.sh`](../ouroboros-db/tests/constraint-probes.test.sh)
> (111 → 132 checks). The probe run goes 63 → **77 checks**; no migration changed, and
> `ouroboros-db` carries no version to bump — the schema is versioned by its migrations.
>
> **The scope bullets were already written, and that is the finding.** Every probe this
> ticket asks for was in
> [`tests/constraints.sql`](../ouroboros-db/tests/constraints.sql) before it started: K.1
> (#99) wrote the `sizing_status` vocabulary, the `(github_repo_id, number)` key and the
> five `labels` shape probes into its own section, and K.2 (#100) wrote version
> monotonicity, the unique key beneath it and decision **K10**'s provenance rule into
> its. Both tickets said so at the time and both named the gap they were leaving — *"the
> intake assertions have no such proof yet"* — so what K.6 owed was never a second copy of
> those assertions. It was the half `ci/db` could not answer about itself: a green
> `constraints.sql` proves the schema satisfies its assertions, and a file that asserted
> nothing at all would be exactly as green. This ticket is the *"red when any invariant is
> dropped"* criterion, mechanised for every run rather than spot-verified once.
>
> **Two of the seven are not plain drops, and both say why in place.**
> `issue_estimates_version_monotonic` is a **trigger** — V026 enforces ascent in plpgsql
> because a CHECK cannot see the other rows of its own table — so it is dropped with `drop
> trigger`, and once it is gone the version it refused is refused by the unique key
> underneath instead. That is the weaker rule and the whole reason the trigger exists:
> unique alone accepts 3 then 2, and *latest wins* then returns the estimate that was
> replaced. So that probe's marker is `must_reject`'s *rejected by … rather than …*
> message, as the bundled-price probe's already was. And
> `issue_estimates_issue_version_key` is caught by the **catalogue** assertion rather than
> a behavioural one, because no single session can watch that key refuse anything — the
> race it exists for is two writers that both computed `max(version) + 1`.
>
> **The cursor invariant is here even though the scope list does not name it.** The
> problem statement does — *"status vocabularies, estimate versioning and cursor
> invariants are trusted by the UI"* — and it is the one intake rule whose loss nothing
> else would report: a watermark that precedes the sync that produced it is a `since` the
> poller hands GitHub for a repository it has never read, and what comes back is a backlog
> with a hole in it.
>
> **Runtime: 3.7s added**, measured on the `postgres:17-alpine` image `ci/db` uses — two
> runs each of 20.8s with the intake block against 17.1s without. The criterion is *< 5s*.
> Each mutation is one more copy of a template database and one more run of a suite that
> takes about half a second.
>
> **What is deferred:** the seeded rows K.5 (#103) added are still a population these
> probes do not run against. `ci/db` points `constraints.sql` at a database migrated from
> empty and `registry-invariants.sql` at the seeded one; an intake suite for the seeded
> database would be the same argument CG.5 made, and it belongs to whichever ticket first
> needs an intake read asserted against real rows rather than fixtures — M.1 (#110) is the
> candidate.

- **Problem Statement:** Status vocabularies, estimate versioning, and cursor
  invariants are UI-trusted contracts needing PR-time enforcement.
- **Solution/Scope:** Extend #24's `tests/constraints.sql`: sizing-status CHECK
  probe, estimate version monotonicity + latest uniqueness, repo+number
  uniqueness, non-null trace estimator, labels-jsonb shape probe.
- **Acceptance Criteria:** Green on current schema; red when any invariant drops
  (spot-verified once).
- **Parallelism/Dependencies:** Needs K.5, #24.
- **Technical Stack:** GitHub Actions, SQL.
- **Epic:** K

```
ci/db: migrate ─▶ validate ─▶ constraints.sql (+K probes) ─▶ ✓/✗
```

---

## Epic L (#95) — Estimation Pipeline (`ouroboros-engine` + `ouroboros-rest`)

| Ref | GitHub | Status | Title | Summary | Labels | Parallel | MVP | Complexity | Affected Modules |
|-----|:------:|:------:|-------|---------|--------|:--------:|:---:|:----------:|------------------|
| L.1 | #105 | 🟢 Done | ouroboros-engine: [L.1] Estimation contract (`/v0/estimate`) | Request/response schema for sizing an issue; extends the #52 contract | mvp, intake, engine, rest | N (after #52) | Y | M | ouroboros-engine, ouroboros-rest |
| L.2 | #106 | 🟢 Done | ouroboros-engine: [L.2] Heuristic estimator v0 | Deterministic sizing from labels/title/body signals, honest provenance | mvp, intake, engine | N (after L.1) | Y | M | ouroboros-engine |
| L.3 | #107 | 🟢 Done | ouroboros-rest: [L.3] Estimation orchestration & persistence | Dispatch, status transitions, versioned persistence, failure → needs_human | mvp, intake, rest | N (after L.1, K.2, K.4) | Y | L | ouroboros-rest |
| L.4 | #108 | 🟢 Done | ouroboros-rest: [L.4] Re-estimation endpoints (single & all) | `POST /backlog/:id/estimate`, `POST /backlog/estimate-all` with guards | mvp, intake, rest | N (after L.3) | Y | S | ouroboros-rest |
| L.5 | #109 | 🟡 Open | ouroboros-rest: [L.5] Pipeline integration tests | Lifecycle, failure paths, concurrency, provenance assertions | mvp, intake, rest, ci | N (after L.4) | Y | M | ouroboros-rest |

### Issue L.1 — ouroboros-engine: [L.1] Estimation contract (`/v0/estimate`)

> **GitHub issue:** #105 · **Status:** 🟢 Done · **Parent epic:** #95

> **Shipped 2026-09-08. Epic L is open.**
> [`POST /v0/estimate`](../ouroboros-engine/src/ouroboros_engine/api/estimate.py) over
> [`estimation/contract.py`](../ouroboros-engine/src/ouroboros_engine/estimation/contract.py)
> (the shapes) and
> [`estimation/estimator.py`](../ouroboros-engine/src/ouroboros_engine/estimation/estimator.py)
> (the seam), described in
> [`openapi.yaml`](../ouroboros-engine/openapi.yaml) and mirrored on the other side of the
> gateway as `EngineClient.estimate()`
> ([`engine.contract.ts`](../ouroboros-rest/src/modules/engine/engine.contract.ts)).
> `ouroboros-engine` 0.5.1, `ouroboros-rest` 0.30.18; **109 new tests** in the engine's
> suite (322 → 431) and **30** in the gateway's (69 → 99).
>
> **The response is one version of K.2's row, and a test holds that mapping as data.**
> [`test_estimation_contract.py`](../ouroboros-engine/tests/test_estimation_contract.py)
> lists every column and jsonb key of `issue_estimates` beside the response field that
> carries it, and fails on a drift in either direction — a field added that no column
> stores, a column the estimator owns that nothing answers with. Five columns are mapped to
> nothing on purpose: `id`, `github_issue_id`, `version`, `created_at` and `trace.sized_at`
> are the row writer's, because an estimator does not know which row it was called for,
> cannot know which version its answer will become, and must not own the clock — a timestamp
> in a response body is one two services can disagree about.
>
> **That table was K.2's specification until K.2 landed, and the join was already written.**
> The test looks for the migration that creates `issue_estimates` and asserts every name it
> was written against appears in it; before one existed it asserted the contract against the
> table instead, so a migration renaming `est_minutes` would have been a red build on the day
> it landed rather than a discovery L.3 made. **K.2 (#100) landed on 2026-09-08 and the
> comparison is live and green** — `V026` names every one of them: `effort`, `confidence`,
> `suggested_workflow`, `routed_model`, `breakdown` (`files`, `est_tokens`, `cycle_min`,
> `cycle_max`, `est_minutes`), `risk`, `risk_note`, `trace` (`estimator`, `sized_at`,
> `tokens_used`, `signals`) — and the two CHECK vocabularies, `xs|s|m|l|xl` and
> `low|medium|high`, which the contract enumerates on both sides of the boundary.
>
> **Decisions K5 and K6 are structural rather than remembered.** The request's `context`
> block carries the workflow tags and the model defaults that exist, the engine holds neither
> list, and `honours_context` refuses an answer naming anything outside the offer — a `500`
> and a log line rather than a value that reaches a row. That check is deliberately on the
> engine's side of the gateway: a tag that reached the caller has already been logged,
> measured and very nearly persisted by the time anyone there could reject it. A request
> offering no tags at all is a `422`, because `suggested_workflow` is required and there is
> nothing this service may put in it.
>
> **Decision K10 is enforced at the contract and not only at the column.** `trace.estimator`
> is required and non-empty in the engine's model *and* in the gateway's zod schema, one and
> two hops before the `not null` would catch it.
>
> **The estimator behind it is reached through `app.state`, not imported.** This ticket
> shipped with a `ContractStub` that said in every field that nothing had estimated the
> issue, so the gateway leg, the specification and L.3's persistence were buildable before
> any estimator existed. **L.2 (#106) replaced it on 2026-09-08** — `create_app` now
> installs `HeuristicEstimator` and the stub is gone, which is the swap this seam was built
> for: one line in the factory, no change to the route, the contract or `ouroboros-rest`.
>
> **The 202 escalation is specified as an extension rather than promised as a response.**
> `x-async-escalation` on the operation names the status, the accepted body, the
> `Retry-After` header and the poll route (`/v0/estimate/{estimation_id}`), and the route
> module holds the same four values as constants with a test asserting the two agree — so it
> is checked rather than merely written. It is *not* a documented `202` under `responses`,
> because this build cannot answer one and a `responses` entry is a promise a caller may hold
> it to. The gateway's client is written to match: a `202` fails to parse and becomes a
> `502`, which is the honest answer to a response it does not yet know how to follow, and the
> spec beside it pins where the poll support has to arrive.
>
> **No REST route was added, deliberately.** `EngineClient.estimate()` is a client method
> with no controller beside `engine/status`: the callers are L.3's orchestration and L.4's
> re-estimation endpoints, and a pass-through added before them would be the generic proxy
> the gateway's whole design refuses.

- **Problem Statement:** REST↔engine has only `echo` (#52). Sizing needs a real
  versioned contract carrying enough issue context in and a full estimate out —
  the shape both the heuristic v0 and the future LLM estimator (O.2) honor.
- **Solution/Scope:** `POST /v0/estimate` (shared-secret path per #51): request
  `{issue: {number, title, body, labels[], repo}, context: {workflow_tags[],
  model_defaults}}`; response `{effort, confidence, suggested_workflow,
  routed_model, breakdown: {files[], est_tokens, cycle_min, cycle_max,
  est_minutes}, risk, risk_note, trace: {estimator, tokens_used, signals[]}}` —
  mirroring K.2 exactly; pydantic v2 schemas; error shape per #52; OpenAPI
  committed + drift-checked; async-ready (202/poll noted for O.2's slower LLM
  path, synchronous acceptable for v0).
- **Acceptance Criteria:**
  - Contract round-trips through the #35 gateway pattern; spec committed.
  - Response validates against K.2's column/jsonb shapes 1:1 (contract test).
  - The 202 escalation path is documented even though v0 answers synchronously.
- **Parallelism/Dependencies:** Needs #52. Blocks L.2, L.3.
- **Technical Stack:** FastAPI, pydantic v2.
- **Epic:** L

```
REST ── POST /v0/estimate {issue, context} ──▶ engine
     ◀─ {effort, confidence, workflow, model, breakdown, risk, trace} ──
        (v0: sync · O.2: 202 + poll — same schema)
```

### Issue L.2 — ouroboros-engine: [L.2] Heuristic estimator v0

> **GitHub issue:** #106 · **Status:** 🟢 Done · **Parent epic:** #95

> **Shipped 2026-09-08. Epic L is open.**
>
> `heuristic-v0` is installed and `POST /v0/estimate` answers with a real estimate for every
> issue. `ouroboros-engine` 0.5.2; 288 new tests in the engine's suite, and the seam L.1 left
> is exactly the line that changed — `create_app` installs `HeuristicEstimator` instead of
> the `ContractStub`, which is now gone. Nothing in the route, the contract or
> `ouroboros-rest` moved.
>
> **Two modules, because a heuristic that cannot be argued with is a heuristic nobody
> maintains.** `estimation/signals.py` is the rules — a table and a threshold each, seventeen
> labels, sixteen title words, four body bands, three checklist bands — and
> `estimation/heuristic.py` is the arithmetic over them plus the tables that turn an effort
> into a breakdown and a risk. So a disagreement about whether `tech-debt` really means `m`
> is a one-line diff and a fixture row, not a rewrite. Every rule may **abstain**, and the
> silence is the input confidence is computed from; only the body-length rule always votes,
> which is what guarantees a denominator.
>
> **Effort is the strongest signal, and the hedging goes in confidence.** A heuristic that
> cannot see the code should not size work *below* its loudest signal, so aggregation is a
> maximum rather than a mean — and how much the rules agreed, how far apart they were, and
> what was missing (no description, no label the tables know) is reported separately as a
> number L.3 can act on. The ceiling is 98 rather than 100 on purpose: a rule engine reading
> a label and a character count is never certain, and a round 100 beside a model's estimate
> would be claiming it was.
>
> **`needs_human` is a real outcome, and the floor is published rather than hidden.** The
> contract has no `needs_human` field because the transition is L.3's state machine, so the
> engine exports `NEEDS_HUMAN_CONFIDENCE_FLOOR` (70) as the value the tables are calibrated
> against, `needs_human()` applies it, and an estimate under it carries a `needs-human:` line
> in its own trace. The fixture table has rows on both sides, and the tests that assert the
> table covers every effort, every workflow tag and both sides of the floor fail if a row
> stops doing so.
>
> **Deterministic, and checked three ways.** The same request produces the same bytes; two
> instances agree; and **the same labels in a different order produce the same estimate** —
> which is stronger than the ticket asks and is the one that matters, because K.4's re-sync
> reorders labels and an estimator that answered differently afterwards would version an
> estimate for an issue that had not changed. A fourth test parses both modules' imports and
> fails on `datetime`, `random`, `time`, `uuid`, `os` or `pathlib`, so "no clock, no
> randomness" stays a property rather than a paragraph.
>
> **Provenance is one constant with one reference.** `trace.estimator` is `heuristic-v0`
> unconditionally, `trace.tokens_used` is `0` because nothing was invoked, and a test offers
> the estimator a `model_defaults` map whose values are plausible provenance strings —
> including `heuristic-v0` itself — to show the answer comes out of the caller's map and the
> provenance does not. **The routing amendment's honesty constraint** (Z.4 #197, decision
> M6) is enforced in the same place: the `routed-model` signal says *resolved, not invoked*
> in those words, on every estimate. The amendment's other half is the gateway's and travels
> with L.3 — filling `model_defaults` from `POST /api/v1/routing/simulate` instead of from
> configuration changes nothing here, because the map was always the caller's.
>
> **Calibrated against the mockup, and honest about the part it will not reproduce.** Over
> the mockup's nine issues the estimator matches the design's **effort** on eight and its
> **workflow tag** on all nine; `#488` comes out `xs`/98%/`docs-loop`, the design's own
> numbers, and `#490` comes out `xl` under the floor where the design shows 61% and *needs
> human* — the two the acceptance criteria name. The design's other percentages are
> deliberately not chased: its own trace line says they came from a model that had three
> similar closed issues, a driver map and a HIL test index to read. `files[]` is empty on
> every path, and present as `[]` rather than omitted, because N.5 renders the absence and a
> missing key reads as an older schema.
>
> **The specification's example is now a worked case.** `openapi.yaml`'s response example is
> what the installed estimator really answers for the request example above it, and
> `tests/test_openapi.py` asserts the two agree — so a change to a table in `signals.py` that
> moved the answer would be a red build rather than a document that quietly stopped being
> true.

- **Problem Statement:** MVP needs real estimates without the AI stack (hard truth
  #2). A deterministic heuristic keeps the pipeline honest and the page alive —
  provided it never masquerades as a model.
- **Solution/Scope:** Rule-based estimator behind L.1: effort from signals (label
  hints like `good-first-issue`/`tech-debt`, title verbs, body length/checklist
  count), confidence from signal agreement, workflow from label→tag map
  (`docs`→`docs-loop`, `enhancement`→`feature-loop`, deps patterns→`deps-refresh`,
  default `standard-fix`), routed model resolved out of the caller's own
  `model_defaults` map (K6 — the engine holds no list; trace says *resolved*,
  never *invoked*, per the Z.4 amendment),
  breakdown with conservative ranges and `files[]` empty (v0 cannot know files —
  the UI renders its absence honestly), risk from effort+label heuristics; low-
  confidence (< threshold) returns `needs_human`; trace `estimator:
  "heuristic-v0"` with rule-name signals (decision K10). Unit-tested table of
  fixtures; deterministic (same input → same output).
- **Acceptance Criteria:**
  - Fixture table covers all efforts, all workflows, the needs-human threshold.
  - Determinism verified; provenance always `heuristic-v0`.
  - `#488`-like docs issue → XS/docs-loop; `#490`-like migration → XL/low-conf.
- **Parallelism/Dependencies:** Needs L.1. Replaced (not removed — fallback) by
  O.2.
- **Technical Stack:** Python 3.12, pytest.
- **Epic:** L

```
signals: labels · title verbs · body length ─▶ effort + confidence
label map ─▶ workflow tag · config map ─▶ routed model
conf < floor ─▶ needs_human          trace: {estimator: heuristic-v0, signals: [rules…]}
```

### Issue L.3 — ouroboros-rest: [L.3] Estimation orchestration & persistence

> **GitHub issue:** #107 · **Status:** 🟢 Done · **Parent epic:** #95

> **Shipped 2026-09-10. Epic L is open.**
>
> An issue the sync mirrors now reaches `sized` on its own. `ouroboros-rest` 0.31.0;
> `src/modules/estimation/` is six files and 95 new unit tests beside a 16-case integration
> suite that drives the whole leg — a listening engine, the real `POST /v0/estimate` parse,
> and V026's two document grammars — because every acceptance criterion this ticket has is a
> claim about what PostgreSQL holds afterwards.
>
> **K.4's seam was exactly the right size.** `estimation.intake.ts` said *"L.3 replaces the
> binding in `backlog-sync.module.ts` and changes nothing else"*, and that is the whole of the
> change to that module: one `useExisting` in place of one `useClass`, and the placeholder that
> logged is deleted. The sync still hands over new and reopened issues after its transaction
> commits and still knows nothing about what happens next — which means K.4's fourth acceptance
> criterion, *"a new issue automatically enters the estimation pipeline"*, marked *(verified
> together with #107)*, is now verified.
>
> **The Z.4 amendment's remaining half landed with it** (#197, decision **M6**). `model_defaults`
> is filled from `ResolutionService` — the same method `POST /api/v1/routing/simulate` serves —
> rather than from configuration, and the value is the resolved chain's **first kept hop**: the
> model an executor would actually try, not hop 1 blindly, because a dropped hop carries its
> explanation and naming one would point an estimate at a model that is not going to run. Two
> keys are offered, `default` → `implement` and `docs` → `docs`, which is what the engine's own
> per-tag lookup falls through. Nothing in `ouroboros-engine` changed: the map was always the
> caller's.
>
> **Two failure decisions are worth reading before the code.** First: **a failed estimate
> persists no row.** `issue_estimates` has no nullable effort and no *unknown*, so a row
> invented for an engine that could not answer would put an effort chip on the backlog table
> for an issue nothing sized, and a `trace.estimator` on a record of nothing — decision **K10**
> read backwards. The issue goes to `needs_human` and the failure is named in the service log,
> with the repository, the issue number, both attempts and the reason. Second: **a workspace
> whose routing resolves no model is not dispatched at all.** `routed_model` is `not null`, so
> an installation with no route genuinely has no estimate to store; its issues stay `unsized`,
> which is what they already are, rather than being burned to `needs_human` for a reason that
> has nothing to do with any of them. Seeding default routes still has no service (#205), so
> that is a real state and not a hypothetical one.
>
> **The version is guessed and the database checks it**, exactly as V026 asked for: the write
> computes `max(version) + 1` inside its transaction, and a second writer that got there first
> is a `23505` on `issue_estimates_issue_version_key` that the repository retries with a fresh
> number. No `select … for update` — locking the issue row would serialise the engine call
> behind whoever got there first and would put a lock across a network hop, which is how a
> deadlock is built rather than avoided. The integration suite drives two writes at once and
> asserts both landed, on versions 1 and 2.
>
> **Three loops now, and this one knocks on nothing outside the deployment.** The recovery
> sweep is one indexed query for rows that have been `estimating` longer than
> `OURO_ESTIMATION_STALE_SECONDS`, jittered like the other two, and it exists for `SIGKILL`
> rather than for bugs: every path out of the orchestrator already writes a terminal status,
> including the one where the write itself failed. It is also the one place a misconfiguration
> is reported — a sweep whose every row was already in flight says so, because that means the
> threshold is set below how long an estimate legitimately takes.
>
> **Four new variables**, each with a floor and a ceiling and none with an off value:
> `OURO_ESTIMATION_CONCURRENCY` (4), `OURO_ESTIMATION_CONFIDENCE_FLOOR` (70 — the engine's own
> published number, restated here because the policy is this service's),
> `OURO_ESTIMATION_STALE_SECONDS` (600) and `OURO_ESTIMATION_SWEEP_INTERVAL_SECONDS` (120).
> `issue_estimates` is the twenty-ninth table in `db/schema.ts`, mirrored a release late for
> `github_issues`' reason: K.2 landed the table with no writer, and this is the first thing
> here that writes one.
>
> **What is still ahead of it.** L.4 (#108) is the re-estimation endpoints, and the orchestrator
> is exported with the two methods that ticket needs — `enqueue()` and `estimating()`, the
> latter being the `409` a double-fire answers with, read from the queue rather than from a
> column that may have moved. The workflow tags are a constant in `estimation.context.ts`
> because workflow entities are mockup 04's and no table declares one yet; when that catalog
> lands it replaces the constant and nothing else in the module changes. The planning roadmap's
> amendment (decision **N9**) is satisfied by the same export: AL.5's nightly backlog-health job
> (#281) and the generator's *Auto-size with estimator* toggle (#280) both enqueue **through
> this orchestrator**, so there is one sizer and one queue rather than two.

- **Problem Statement:** Someone must move issues through
  `unsized → estimating → sized|needs_human` — dispatching to the engine,
  persisting versioned results, and surviving failures without stuck states.
- **Solution/Scope:** `EstimationOrchestrator`: in-process work queue (bounded
  concurrency) fed by K.4 (new/reopened) and L.4 (manual); per issue — set
  `estimating`, call the engine client (#35 pattern) with L.1 payload, persist
  a new `issue_estimates` version + flip status on success; engine error/timeout
  → retry once → `needs_human` with a trace noting the failure (never stuck in
  `estimating`; a sweep job re-queues rows stale > N minutes); status
  transitions are the UI's polling signal (M.1 exposes them).
- **Acceptance Criteria:**
  - New synced issue reaches `sized` end-to-end in compose without manual action.
  - Engine down: issues land in `needs_human` with honest trace; recovery sweep
    re-processes stale `estimating` rows.
  - Concurrent estimate of the same issue produces sequential versions, no
    deadlock (harness-verified).
- **Parallelism/Dependencies:** Needs L.1, K.2, K.4. Blocks L.4, M.1 (status
  data).
- **Technical Stack:** NestJS, engine client, Kysely.
- **Epic:** L

```mermaid
stateDiagram-v2
    [*] --> unsized: synced (K.4)
    unsized --> estimating: dispatched
    estimating --> sized: engine OK → new estimate version
    estimating --> needs_human: engine fail ×2 / low confidence
    sized --> estimating: re-estimate (L.4)
    needs_human --> estimating: re-estimate (L.4)
    note right of estimating: stale sweep re-queues > N min
```

### Issue L.4 — ouroboros-rest: [L.4] Re-estimation endpoints (single & all)

> **GitHub issue:** #108 · **Status:** 🟢 Done · **Parent epic:** #95

> **Shipped 2026-09-10. Epic L has one issue left.**
>
> The estimation pipeline has external triggers: `POST /api/v1/backlog/{id}/estimate` (member+)
> and `POST /api/v1/backlog/estimate-all` (admin+), in
> [`ouroboros-rest/src/modules/estimation/`](../ouroboros-rest/src/modules/estimation/) —
> six new files, 66 unit tests across six new suites — plus cases added to the repository's
> and the module's — and twelve integration cases added to L.3's suite.
> `ouroboros-rest` 0.31.2, a patch: the contract gained two operations and two schemas and
> changed none.
>
> **They landed in `estimation/` rather than in `backlog/`**, which is where the path says they
> are. What they *do* is estimation — everything they touch is that module's queue, claim and
> limiter — and what they are *about* is an issue in the backlog, which is where a client looks
> for them; `AuditModule` serves `GET /api/v1/providers/audit` under `ProviderConnectionsModule`'s
> prefix on exactly that argument. Unlike that pair this one carries **no ordering rule**: all
> four paths under `/backlog` are distinguished before any parameter is reached.
>
> **The row is claimed before the work is queued, and that is the ticket's one design
> correction.** L.3's orchestrator claims when the work *starts*, which may be several estimates
> later — so an endpoint that only queued would answer `status: "estimating"` while a client
> re-reading the issue still saw `sized`, and its double-fire `409` would come from one process's
> memory rather than from a column. Claiming at the boundary makes the `202` true when it is sent
> and the refusal a fact any replica can read. The orchestrator's own claim is unconditional and
> idempotent, so doing it twice costs one `UPDATE`, and a process that dies in between leaves a
> row the recovery sweep already exists to find.
>
> **The fan-out's scope and claim are one statement.** `update … where organization_id = $1 and
> sizing_status != 'estimating' returning id` *is* the *"touches only non-`estimating` rows"*
> criterion: two administrators pressing together cannot claim the same issue twice, and the
> count it returns is a fact rather than an estimate of one. A second press finds nothing to take
> and is a `409` — `202 {enqueued: 0}` would report *accepted* for a request that started
> nothing — while a workspace that mirrors **no** issues answers `202` with zeros, because
> *empty* and *busy* are different states and N.1's dialog should be able to say which.
>
> **`{id}` is `github_issues.id`, and the issue's own diagram is where the confusion would come
> from.** It writes `POST /backlog/485/estimate`, where `485` is the issue the mockup draws
> rather than a path segment this service could accept: `github_issues` is unique on
> `(github_repo_id, number)`, so a workspace watching two repositories has two issue `#485`s and
> a number would name neither. A path that is not a uuid is a `422` before a statement is issued,
> and `estimation.dto.spec.ts` holds that case by name.
>
> **The rate limit is a `429` where M.4's re-sync guard (#113) is a `409`, and the difference is
> real rather than a matter of taste.** That guard protects a *shared background loop* the caller
> does not own and refuses somebody who has clicked nothing; this one counts what *this
> workspace* asked for and becomes a `202` by waiting exactly as long as
> `details.retryAfterSeconds` says. Thirty a minute, sliding, per workspace — the quota is the
> workspace's rather than any caller's, so three members share one window. **Every request that
> reaches the operation counts, including the ones refused `409`**, because the hammering caller
> the criterion names is *mostly* collecting conflicts: their second click lands on an issue
> their first one moved into `estimating`.
>
> **Every acceptance criterion is asserted where only that level can see it.** *A new version
> (v+1)* is over the wire against a migrated database and a listening engine — the estimate the
> press produced lands as `v2` beside `v1` rather than over it. So are the role gates, which no
> unit spec can see because none of them goes through the router that reads `@Roles()`, and the
> cross-org `404` against a real row in a second workspace. L.5 (#109) keeps the pipeline's own
> matrix; what this added is the leg that proves the buttons are wired to it.
>
> **What is deferred, and to whom.** N.1 (#115) and N.5 (#119) are the presses: the head's
> *Re-estimate all* has a confirmation contract to render — the dialog's N comes from M.1's
> count, and the answer says how many it actually took — and the panel's *Re-estimate* has a
> `409` carrying the pill it should redraw. Nothing here reserves a budget: full accounting is
> the provider roadmap's (mockup 07), and this counter is deliberately the *simple* one the
> ticket asked for.

- **Problem Statement:** The mockup offers re-estimation in three places (panel
  button, head "Re-estimate all", implicit on stale data); the pipeline needs
  guarded triggers.
- **Solution/Scope:** `POST /api/v1/backlog/:id/estimate` (member+) and
  `POST /api/v1/backlog/estimate-all` (admin+ — it can be expensive; confirmation
  contract documented) enqueueing via L.3; idempotent while already `estimating`
  (409 with current status); rate-limited per org (simple counter — full
  budgets are provider-roadmap territory).
- **Acceptance Criteria:** Single re-estimate versions the estimate; estimate-all
  touches only non-`estimating` rows; double-fire while running → 409; role
  gates verified.
- **Parallelism/Dependencies:** Needs L.3. Blocks N.5/N.1 actions.
- **Technical Stack:** NestJS.
- **Epic:** L

```
panel [Re-estimate] ─▶ POST /backlog/485/estimate ─▶ estimating → sized (v+1)
head [Re-estimate all] ─▶ POST /backlog/estimate-all (admin) ─▶ fan-out via L.3 queue
```

### Issue L.5 — ouroboros-rest: [L.5] Pipeline integration tests

> **GitHub issue:** #109 · **Status:** 🟡 Open · **Parent epic:** #95

- **Problem Statement:** Lifecycle transitions, failure fallbacks, and version
  monotonicity are concurrency-sensitive — exactly what the Testcontainers
  harness exists for.
- **Solution/Scope:** Extend the harness with a stubbed engine (contract-faithful
  fake per L.1): happy path, engine-down → needs_human → recovery, stale-sweep,
  concurrent re-estimates, provenance non-null, estimate-all scope, role gates.
- **Acceptance Criteria:** Green in `ci/rest`; removing the stale sweep or the
  retry turns tests red; ≤ 60s added runtime.
- **Parallelism/Dependencies:** Needs L.4 (extends #37 patterns).
- **Technical Stack:** Jest, Supertest, Testcontainers, engine stub.
- **Epic:** L

```
harness + fake engine ─▶ lifecycle ✓ · failure→needs_human ✓ · sweep ✓ · versions ✓ · roles ✓
```

---

## Epic M (#96) — Backlog REST API (`ouroboros-rest`)

| Ref | GitHub | Status | Title | Summary | Labels | Parallel | MVP | Complexity | Affected Modules |
|-----|:------:|:------:|-------|---------|--------|:--------:|:---:|:----------:|------------------|
| M.1 | #110 | 🟢 Done | ouroboros-rest: [M.1] Backlog list endpoint with filters | Org-scoped list: repo/labels/state/sort/search, paging, head counts | mvp, intake, rest | N (after K.4, L.3) | Y | M | ouroboros-rest |
| M.2 | #111 | 🟡 Open | ouroboros-rest: [M.2] Issue detail endpoint | Full issue + latest estimate + trace for the side panel | mvp, intake, rest | N (after L.3) | Y | S | ouroboros-rest |
| M.3 | #112 | 🟡 Open | ouroboros-rest: [M.3] Bulk queue action | Selection → `queue_items` with workflow tag + combined estimate | mvp, intake, rest | N (after L.3, DASH-F.2) | Y | M | ouroboros-rest |
| M.4 | #113 | 🟢 Done | ouroboros-rest: [M.4] Sync status & manual re-sync | Freshness data + `POST /backlog/sync` trigger with guards | mvp, intake, rest | N (after K.4) | Y | S | ouroboros-rest |
| M.5 | #114 | 🟡 Open | ouroboros-rest: [M.5] Backlog API integration tests | Filter matrix, queue writes, isolation, sync trigger | mvp, intake, rest, ci | N (after M.1–M.4) | Y | M | ouroboros-rest |

### Issue M.1 — ouroboros-rest: [M.1] Backlog list endpoint with filters

> **GitHub issue:** #110 · **Status:** 🟢 Done · **Parent epic:** #96

> **Shipped 2026-09-10, the same day as M.4 and L.4.** Epic M has two tickets left.
>
> [`ouroboros-rest/src/modules/backlog/listing.*`](../ouroboros-rest/src/modules/backlog/) is
> `GET /api/v1/backlog` — six files beside M.4's seven, 88 new unit tests and a 45-case
> integration suite over mockup 03's own nine rows. `ouroboros-rest` 0.31.3 — a patch, because
> the contract gained one operation and four schemas and changed none.
>
> **A second controller under the same prefix**, which is what `backlog.module.ts` said it was
> leaving a name for: one controller is about the *sync* and one is about the *backlog*, and only
> the second grows filters. The listing reads `github_issues` and `issue_estimates` through a
> repository of this module's own rather than through `BacklogSyncModule` or `EstimationModule` —
> those two own *writers*, a poll and a versioned insert, and a screen's read has no business
> entering through either.
>
> **The page head does not move when the filter bar does**, and that is the ticket's one design
> decision that the wording left open. `meta.openCount` and `meta.sizedCount` are scoped by the
> workspace and by `?repo=` and by nothing else, because mockup 03 puts them *above* the
> `.filter-bar` card: the head says how much work is in the backlog and the table says which of it
> you are looking at. Counts that moved as chips were toggled would make *"38 already sized"* a
> statement about the filter, and `state=closed` would leave the head reading *"0 open issues"*
> over a full table. `total` beside them is the filtered count, so a client has both numbers. The
> same argument settles `labelFacets`, and there it is load-bearing rather than tidy: narrowing
> the facets by the chips already on would leave only the labels that co-occur with `bug`, so
> selecting a first chip would delete most of the set it was selected from and a second could
> never be chosen.
>
> **`meta.syncedAt` is M.4's number, lifted rather than re-derived** — exactly the handoff that
> ticket wrote down. A second `max(github_issues.synced_at)` here would have compiled, passed
> every assertion about content, and answered a different question: that column moves when a row
> is *written*, and the tag is about when a poll *ran*.
>
> **`q`'s label half matches a name rather than a substring, and the reason is the plan.** One
> disjunct no index can answer makes the *whole* search a sequential scan, and
> `jsonb_array_elements_text(labels) ilike '%…%'` is a per-row subquery nothing can serve;
> `labels ? 'watchdog'` is the operator V014 chose `jsonb_ops` for. A label name is a short token
> out of the set `labelFacets` just handed the client, so the substring form buys very little and
> costs the query its index.
>
> **The plans are asserted against the statements the service compiles, not against SQL retyped in
> a test.** `listing.integration-spec.ts` builds each read through the recording driver
> `listing.repository.spec.ts` uses, then `EXPLAIN`s that exact statement against a workspace
> holding nine thousand issues — so a plan assertion cannot drift from the query it is about. At
> that volume the repository-scoped listing, the head's counts, the facets and a `#485` search all
> enter through `github_issues_organization_repo_state_idx`, and the chip set enters through the
> GIN index. The one combination PostgreSQL declines to index there is the whole-workspace text
> search: a bitmap over two GIN indexes has a startup cost nine thousand rows do not repay, so it
> reads that workspace's own issues and filters them — the right plan at nine thousand and the
> wrong one at fifty, which is why the suite also asks the question `constraints.sql`'s way, with
> sequential scans off.
>
> **The row is the table's cells and no more** — the ticket's own scope. No body, no author, no
> `gh_url`; those are M.2's, for the one issue somebody clicked rather than for every row of a
> page nobody has. Two fields are carried that no cell prints and both earn it:
> `(github_repo_id, number)` is what makes an issue unique — every repository has its own `#489` —
> so in a listing that names no `repo` the number alone does not identify a row.
>
> `src/testing/intake.fixture.ts` is `R__dev_seed_intake.sql` as a fixture, for
> `dashboard.fixture.ts`'s reason: the development seed is deliberately not applied to the
> integration database, and `truncate` would take it between tests anyway. Nine issues, nine
> estimates and `#487`'s two versions — the smallest population that can tell a latest-wins lateral
> apart from a join that takes an arbitrary row.
>
> What M.1 leaves for **N.1 (#115)**, **N.2 (#116)** and **N.3 (#117)**: the three surfaces they
> render come from one request, so a head that disagreed with its own table would have to be the
> client's doing. `labelFacets` is the chip set as data, `meta` is the head and the freshness tag,
> and `sizingStatus` and `estimate` are deliberately separate answers — `#490` is `needs_human`
> *with* an estimate and `#483` is `estimating` *without* one, which is the pair that stops either
> being derived from the other.
>
> And for **M.5 (#114)**: the filter matrix this ticket's own suite covers is the listing's;
> what M.5 adds beside it is the queue writes and the cross-endpoint agreement, over a fixture
> that now exists.
>
> *(Two corrections to the scope below, both made deliberately and both narrower than they look.
> The paging parameter is `limit`/`offset` rather than the `&page=` written there: this API has one
> pagination convention (#31) and five endpoints already speak it, `page` is recoverable from the
> two at any time, and two dialects in one API are not. And `q` over a **label** is a label name in
> full rather than a substring of one, for the index reason above — the chip set is where a name
> comes from, and the title half is still a substring.)*

- **Problem Statement:** The filter bar and table are a server query
  (decision K8); the page head's counts ("42 open issues. 38 already sized.")
  come from the same source.
- **Solution/Scope:** `GET /api/v1/backlog?repo=&labels=&state=&sort=&q=&page=`
  under tenant context: label AND-filtering (GIN), state default `open`, sorts
  (`effort` — chip order with unsized last, `confidence`, `updated`, `number`),
  `q` over title/`#number`/label; response rows = issue + latest-estimate
  summary + sizing status (the table's exact needs); `meta: {openCount,
  sizedCount, syncedAt}` for head + freshness tag; label facet list for the
  chip-set (distinct labels in scope). OpenAPI documented.
- **Acceptance Criteria:**
  - Seeded queries reproduce the mockup table under `sort=effort`; every filter
    combination indexed (no seq scans on the hot path at seed×1000 volume).
  - `q="#485"` finds exactly one; counts match seeds.
  - Cross-org isolation verified.
- **Parallelism/Dependencies:** Needs K.4, L.3. Blocks N.2, N.3.
- **Technical Stack:** NestJS, Kysely, GIN/trigram indexes.
- **Epic:** M

```
?repo=helios-firmware&labels=bug&state=open&sort=effort&q=watchdog
  ─▶ rows[{issue, effort+conf, workflow, model, status}] + meta{42, 38, syncedAt} + labelFacets[]
```

### Issue M.2 — ouroboros-rest: [M.2] Issue detail endpoint

> **GitHub issue:** #111 · **Status:** 🟡 Open · **Parent epic:** #96

- **Problem Statement:** The side panel needs everything about one issue: GitHub
  content for the excerpt, the full latest estimate, and the trace.
- **Solution/Scope:** `GET /api/v1/backlog/:id`: issue fields (body for the
  excerpt — client truncates, author, opened-ago, gh_url for "Open on GitHub ↗"),
  latest estimate in full (breakdown files/tokens/cycle, risk + note, trace with
  provenance + signals), estimate history summary (versions, for a future
  history view — cheap to include). 404-not-403 across orgs.
- **Acceptance Criteria:** Seeded `#485` returns the mockup panel's every field;
  unsized issue returns issue-only shape the panel can render (N.5's no-estimate
  state).
- **Parallelism/Dependencies:** Needs L.3. Blocks N.5.
- **Technical Stack:** NestJS, Kysely.
- **Epic:** M

```
GET /backlog/:id ─▶ {issue{body, author, gh_url}, estimate{breakdown, risk, trace}, history[versions]}
```

### Issue M.3 — ouroboros-rest: [M.3] Bulk queue action

> **GitHub issue:** #112 · **Status:** 🟡 Open · **Parent epic:** #96

- **Problem Statement:** "Queue 3 selected ⟳" / "Queue → standard-fix" / "Queue
  for loop" all write the run queue — the write side the dashboard roadmap
  deliberately left out (decision K9).
- **Solution/Scope:** `POST /api/v1/backlog/queue {issueIds[], workflow?}`
  (member+ role per BA-C.3 policy; workflow from the fixed set K5, default =
  each issue's suggested workflow): validates issues are sized (unsized/
  estimating → 422 listing offenders), creates `queue_items` (DASH-F.2) with
  effort, tag, `est_minutes` from the estimate breakdown, appended positions,
  transactionally; flips issue rows to `queued` presentation state; returns
  created items + combined `estMinutes` (the action bar's "est. 1h 10m
  combined"). Duplicate queueing → 409 per DASH-F.2's unique constraint,
  surfaced per-issue.
- **Acceptance Criteria:**
  - Queueing the three seeded selected issues yields the mockup's combined
    estimate and the items appear on the dashboard queue card (cross-roadmap
    verification).
  - Unsized inclusion → 422 with per-issue codes; double-queue → per-issue 409;
    partial success semantics documented (all-or-nothing chosen and stated).
- **Parallelism/Dependencies:** Needs L.3, DASH-F.2. Blocks N.4.
- **Technical Stack:** NestJS, Kysely transactions.
- **Epic:** M

```
POST /backlog/queue {ids:[485,484,491], workflow:"standard-fix"}
  ─▶ tx: 3 × queue_items(position++, est_minutes) ─▶ {items, estMinutes:70}  → "est. 1h 10m"
```

### Issue M.4 — ouroboros-rest: [M.4] Sync status & manual re-sync

> **GitHub issue:** #113 · **Status:** 🟢 Done · **Parent epic:** #96

> **Shipped 2026-09-10. Epic M is open, and this is its first landed ticket.**
>
> [`ouroboros-rest/src/modules/backlog/`](../ouroboros-rest/src/modules/backlog/) is the
> intake screen's first API surface: `GET /api/v1/backlog/sync-status` and
> `POST /api/v1/backlog/sync` — seven files, 85 new unit tests, and an 8-case integration suite
> that drives both routes over the whole pipeline against a migrated database.
> `ouroboros-rest` 0.31.1 — a patch, because the contract gained two operations and three
> schemas and changed none, which is AGENTS.md's rule for an addition.
>
> **A module of its own rather than a controller in `backlog-sync/`**, which is what that
> module's header asked for: it owns a background loop and exported `BacklogSyncService` and
> `BacklogSyncScheduler` *for this*. `BacklogSyncRepository` joins them as a third export, for
> the stored cursors the status reads. The division is now legible from either side —
> `backlog-sync/` owns a cycle and declares no route, `backlog/` declares routes and owns no
> cycle — and it is where M.1–M.3's controllers land.
>
> **Three sources, and none of them is a status column** — which is the first acceptance
> criterion, *pause reasons derived from actual state, never guessed*, read as a statement
> about provenance. `syncedAt` and `cursor` are columns a poll wrote; `not_configured` is
> whether `github_credentials` has a row; `no_repositories` is how many repositories are
> enabled; `rate_limited` is read from **the same `GithubRateLimiter` the client enforces**,
> which is why K.3 exported it; `unauthorized`, `not_found` and `upstream_error` come from
> `BacklogSyncService.lastCycle()`. There is deliberately no `sync_state` column: a stored
> status is a status that goes stale, and this one changes without anybody writing anything.
>
> **So the question K.4 left open — *whether a pause reason should outlive a restart* — is
> answered no.** A fresh process has attempted nothing and therefore knows nothing about
> `unauthorized`; the two reasons a reader can act on immediately are read from tables and are
> right the moment the service is up. Claiming the others from a stored value would be
> reporting a failure this process never saw, which is guessing by another name.
>
> **The freshness tag is the *oldest* poll, not the newest**, and `null` while any enabled
> repository has never been polled. The tag sits over the whole backlog — *"BACKLOG · AS
> OUROBOROS SEES IT"* — so what it may honestly claim is the freshness of the stalest thing in
> it; taking the newest would let one repository that synced a second ago speak for nine that
> failed an hour ago, which is K.4's one-transaction-per-poll rule broken one level up. Each
> repository carries its own stamp, watermark, reason and last result, so N.3 can be more
> precise than the tag when it wants to be.
>
> **The debounce is two guards, and neither is a `429`.** A cycle in flight is
> `409 backlog_sync_running`, carrying **no** `retryAfterSeconds` — how long a cycle takes is
> not knowable in advance, and `github.errors.ts`' rule is to omit rather than guess; what a
> client watches instead is `running` on the status endpoint. A cycle that started within
> thirty seconds is `409 backlog_sync_too_soon` with the wait in `details.retryAfterSeconds`.
> `429` was rejected for both: it means *you* have done this too often, and this is a guard on
> a loop the caller does not own.
>
> **The minimum interval is measured from the last cycle's start, whoever caused it, and it is
> process-wide** — which is a consequence of the shape K.4 gives us rather than a preference.
> A cycle polls **every** configured workspace, so this is *sync now* rather than *sync mine
> now*, and a per-workspace guard would let ten workspaces start ten whole-installation cycles
> inside one interval. Thirty seconds is a constant rather than a setting, for
> `RATE_LIMIT_FLOOR`'s reason: it bounds a person leaning on the tag to 120 cycles an hour
> against a budget of 5,000, and it is short enough that somebody who has just filed an issue
> is not sent back to waiting out the poll interval. **Narrowing a cycle to one workspace is
> the follow-up**, and it belongs to Q.3 (#140), where the cycle stops being one loop.
>
> **`BacklogSyncScheduler` now enforces non-overlap rather than implying it.** *"A cycle never
> overlaps itself"* was true while the timer was the only caller; with a second caller it is a
> held promise — `tick()` joins a cycle already running, and `runNow()` hands out the right to
> start in one synchronous step, which is what makes *concurrent trigger → 409* a property
> rather than a timing that usually holds.
>
> **Member+ needed a list that did not exist.** `roles.guard.ts` had `ADMINISTRATORS` and the
> guard's own default of *any member, viewer included*; `CONTRIBUTORS` (owner, admin, member)
> is the third, and the trigger is its first use. Reading the status stays every member's — a
> viewer is a role that exists to be able to look — and starting a cycle is not, because it
> spends the workspace's hourly GitHub budget.
>
> **Every acceptance criterion is asserted where only that level can see it.**
> `backlog.integration-spec.ts` drives both routes over the whole pipeline against a migrated
> database and the real Octokit: the trigger runs a cycle and `synced_at` **advances**, a
> member is allowed and a `viewer` is refused `403` on the trigger while still reading the
> status, a stranger gets the same `404` a missing workspace gets, and the immediate repeat
> comes back `409 backlog_sync_too_soon` with its hint. A role gate deleted from the controller
> leaves every unit spec in the module green, which is why it is asserted through the router.
>
> **What is deferred, and to whom.** M.5 (#114) keeps the backlog API's integration matrix,
> and it inherits a trigger that already has one leg there rather than a blank sheet. M.1
> (#110) folds this endpoint's `syncedAt` into its `meta` — one number, from one service — and
> N.3 (#117) and N.6 (#120) render the vocabulary.

- **Problem Statement:** The freshness tag needs data, and users need a manual
  nudge when they just filed an issue on GitHub.
- **Solution/Scope:** Sync status folded into M.1's `meta` plus
  `GET /api/v1/backlog/sync-status` (per-repo cursors, last result, paused
  reason — no token / rate-limited); `POST /api/v1/backlog/sync` (member+)
  triggering an immediate K.4 cycle, debounced (409 while running, min-interval
  guard against hammering the rate limit).
- **Acceptance Criteria:** Status reflects reality (pause reasons honest);
  trigger syncs then updates `syncedAt`; debounce verified.
- **Parallelism/Dependencies:** Needs K.4. Feeds N.3's freshness display.
- **Technical Stack:** NestJS.
- **Epic:** M

```
GET /sync-status ─▶ [{repo, syncedAt, cursor, state: ok|paused(no-token)|rate-limited}]
POST /sync ─▶ 202 (running) │ 409 (already running / too soon)
```

### Issue M.5 — ouroboros-rest: [M.5] Backlog API integration tests

> **GitHub issue:** #114 · **Status:** 🟡 Open · **Parent epic:** #96

- **Problem Statement:** The filter matrix, transactional queue writes, and
  org isolation are the regressions users would hit first.
- **Solution/Scope:** Harness suites: filter/sort/search matrix against seeded
  volume, queue action success/422/409/all-or-nothing, detail shapes (sized +
  unsized), sync trigger debounce, isolation (two orgs).
- **Acceptance Criteria:** Green in `ci/rest`; dropping the org predicate or the
  queue transaction turns tests red; ≤ 60s added.
- **Parallelism/Dependencies:** Needs M.1–M.4.
- **Technical Stack:** Jest, Supertest, Testcontainers.
- **Epic:** M

```
suites: filters ✓ · queue tx ✓ · detail ✓ · sync debounce ✓ · isolation ✓
```

---

## Epic N (#97) — Issue Intake UI (`ouroboros-ui`)

Every issue references [`docs/mockups/03-issues.html`](mockups/03-issues.html) as
the design source — layout (`c-8` main column + `c-4` panel), page-specific
treatments (`.ckbox`, `tr.sel`, `.sel-bar` glow, `.panel-body-excerpt`,
`.breakdown-row`, `.file-list`, `.trace`), and the shared design system via the
#16 tokens (both themes; the mockup is dark-only).

| Ref | GitHub | Status | Title | Summary | Labels | Parallel | MVP | Complexity | Affected Modules |
|-----|:------:|:------:|-------|---------|--------|:--------:|:---:|:----------:|------------------|
| N.1 | #115 | 🟡 Open | ouroboros-ui: [N.1] Issues route, page head & counts | `(app)/issues`: head with live counts, Re-estimate all, Queue button | mvp, intake, ui, design | N (after #41, M.1, BA-D.5) | Y | S | ouroboros-ui |
| N.2 | #116 | 🟡 Open | ouroboros-ui: [N.2] Filter bar (URL-reflected) | Repo select, label chips, state, sort, search — server-driven | mvp, intake, ui, design | N (after N.1) | Y | M | ouroboros-ui |
| N.3 | #117 | 🟡 Open | ouroboros-ui: [N.3] Backlog table with selection model | Rows, effort+conf, status pills, checkbox selection, freshness tag | mvp, intake, ui, design | N (after N.1) | Y | L | ouroboros-ui |
| N.4 | #118 | 🟡 Open | ouroboros-ui: [N.4] Selection action bar | Combined estimate, Assign workflow ▾, Queue → workflow | mvp, intake, ui, design | N (after N.3, M.3) | Y | S | ouroboros-ui |
| N.5 | #119 | 🟡 Open | ouroboros-ui: [N.5] Issue detail side panel | Excerpt, breakdown, risk meter, trace, panel actions | mvp, intake, ui, design | N (after N.3, M.2, L.4) | Y | L | ouroboros-ui |
| N.6 | #120 | 🟡 Open | ouroboros-ui: [N.6] Intake empty, loading & guidance states | No-token, no-repos, syncing, unsized, empty-filter states | mvp, intake, ui, design | N (after N.2–N.5) | Y | M | ouroboros-ui |
| N.7 | #121 | 🟡 Open | ouroboros-ui: [N.7] Issues e2e leg | Seeded parity, filter/select/queue/re-estimate flows, both themes | mvp, intake, ui, ci | N (after N.1–N.6) | Y | S | ouroboros-ui, .github |

### Issue N.1 — ouroboros-ui: [N.1] Issues route, page head & counts

> **GitHub issue:** #115 · **Status:** 🟡 Open · **Parent epic:** #97

- **Problem Statement:** `/issues` currently points at a #49 placeholder; the
  page needs its frame: eyebrow, live-count headline, subline, and the two head
  actions per [`docs/mockups/03-issues.html`](mockups/03-issues.html).
- **Solution/Scope:** Replace the placeholder: head from M.1 `meta` ("`N` open
  issues. `M` already sized."), subline copy verbatim, **Re-estimate all** →
  L.4 (admin-visible, confirm dialog stating scope), **Queue N selected ⟳** →
  reflects the N.3 selection count (disabled at 0, wired to M.3); nav "soon"
  marker removed (amend #41's nav state).
- **Acceptance Criteria:** Counts live from seeds; actions gate by role and
  selection; both themes; #49's `/issues` stub retired (amendment).
- **Parallelism/Dependencies:** Needs #41, M.1, BA-D.5. Blocks N.2–N.6.
- **Technical Stack:** Next.js server components, #46 primitives.
- **Epic:** N

```
[Issue Intake]
9 open issues. 7 already sized.            [Re-estimate all] [Queue 3 selected ⟳]
"Ouroboros watches the GitHub backlog and continuously estimates…"
```

### Issue N.2 — ouroboros-ui: [N.2] Filter bar (URL-reflected)

> **GitHub issue:** #116 · **Status:** 🟡 Open · **Parent epic:** #97

- **Problem Statement:** The mockup's filter bar (repo, label chips with
  `chip-on` state, state, sort, search) must drive M.1 queries and survive
  reload/share (decision K8).
- **Solution/Scope:** Filter card per the mockup: repo select from enabled repos
  (BA-C.4; syncs with H.1's focus repo), label chip-set from M.1's facets
  (toggle = AND filter), state select (Open default / Closed / All), sort select
  (effort default per mockup, confidence, updated, number), debounced search;
  all state in the URL query (`router.replace`), server components re-query;
  clear-all affordance when any filter active.
- **Acceptance Criteria:** Every control round-trips through the URL (paste URL
  → same view); chip toggle matches the `chip-on` treatment in both themes;
  keyboard operable throughout.
- **Parallelism/Dependencies:** Needs N.1 (+M.1 facets). Blocks N.3 (query
  state).
- **Technical Stack:** Next.js (searchParams), #46 primitives.
- **Epic:** N

```
[helios-firmware ▾] (bug ✓)(enhancement)(tech-debt)(good-first-issue) [Open ▾] [Sort: effort ▾] [search…]
        └──────────────── all state lives in ?repo=&labels=&state=&sort=&q= ────────────────┘
```

### Issue N.3 — ouroboros-ui: [N.3] Backlog table with selection model

> **GitHub issue:** #117 · **Status:** 🟡 Open · **Parent epic:** #97

- **Problem Statement:** The table is the page's core: dense rows with the
  mockup's exact treatments (selected-row glow, effort+confidence pairing,
  four status pill variants, `sizing…` placeholder) plus a multi-select model
  the action bar and head button consume.
- **Solution/Scope:** #46 Table extended per the mockup: `.ckbox` checkbox
  column (header select-all-visible), `tr.sel` accent treatment on selected
  rows, issue cell (mono number, title, tag row), effort chip + mono conf
  (unsized → `sizing…`), workflow tag, model pill (opaque string, K6), status
  pill map (`sized`/neutral, `queued`/run, `estimating…`/warn, `needs human`/
  err); freshness tag in the card head from M.1 meta (relative time, M.4
  re-sync on click); selection store (URL-independent, survives filter
  changes within the page, exposed to N.1/N.4); row click opens the N.5 panel
  (selected-for-detail ≠ checkbox-selected — mirrors the mockup where `#485`
  is both); pagination footer. Polling keeps statuses fresh (estimating →
  sized transitions animate the pill swap).
- **Acceptance Criteria:**
  - Seeded table matches the mockup row-for-row under default sort (both
    themes, glow treatment included).
  - Select-all/none/individual works; selection persists across filter tweaks;
    count flows to head + action bar.
  - `estimating…` rows flip to `sized` within one poll of pipeline completion
    (compose-verified).
  - Full keyboard support (row focus, space to select, enter for detail).
- **Parallelism/Dependencies:** Needs N.1, N.2, M.1. Blocks N.4, N.5.
- **Technical Stack:** React, #46 Table/Chip/Pill, shared poll pattern (DASH-I.8
  hook family).
- **Epic:** N

```
[✓] #485 Watchdog reset on I²C…  [bug][i2c][watchdog]   M 92%  [standard-fix] [claude-fable-5] (sized)
[✓] #484 Motor PID integral…     [bug][motor-control]   M 88%  [standard-fix] [cursor/composer-2] (sized)
[ ] #483 Telemetry frame drops…  [bug][telemetry]       sizing…[standard-fix] [claude-sonnet-5] (estimating…)
[ ] #490 Migrate build to Zephyr…[tech-debt][zephyr]    XL 61% [deps-refresh] [claude-fable-5] (needs human)
```

### Issue N.4 — ouroboros-ui: [N.4] Selection action bar

> **GitHub issue:** #118 · **Status:** 🟡 Open · **Parent epic:** #97

- **Problem Statement:** The glow-bordered `.sel-bar` summarizes the selection
  ("3 issues selected · est. 1h 10m combined autonomous work") and carries the
  queue actions — it appears only when selection > 0.
- **Solution/Scope:** Bar per the mockup below the table: combined estimate
  summed client-side from selected rows' `est_minutes` (server-confirmed on
  queue), **Assign workflow ▾** menu (fixed set K5 + "use suggested" default),
  **Queue → <workflow>** primary (label reflects choice; suggested-mix shows
  `Queue → suggested`); calls M.3, handles per-issue 422/409 results with a
  designed partial-failure explanation (all-or-nothing per M.3 — the dialog
  names offenders); success clears selection and toasts with a link to the
  dashboard queue card.
- **Acceptance Criteria:** Appears/disappears with selection; combined estimate
  matches seeds ("est. 1h 10m" for the mockup trio); unsized-in-selection
  surfaces the 422 explanation; queue success visible on the dashboard within
  one poll.
- **Parallelism/Dependencies:** Needs N.3, M.3.
- **Technical Stack:** React, #46 primitives, generated client.
- **Epic:** N

```
┌─(glow)──────────────────────────────────────────────────────────┐
│ 3 issues selected · est. 1h 10m combined     [Assign workflow ▾]│
│                                              [Queue → standard-fix] │
└─────────────────────────────────────────────────────────────────┘
```

### Issue N.5 — ouroboros-ui: [N.5] Issue detail side panel

> **GitHub issue:** #119 · **Status:** 🟡 Open · **Parent epic:** #97

- **Problem Statement:** The `c-4` panel is the sizing story for one issue —
  excerpt, breakdown, risk, trace, actions — and must render honestly across
  all sizing states, not just the mockup's happy path.
- **Solution/Scope:** Panel per the mockup, driven by M.2 for the focused row:
  meta line (number, relative opened-ago, author), title, tags; body excerpt in
  the `.panel-body-excerpt` treatment (truncated with expand); **AI Work
  Breakdown** section — file-list (v0 estimator returns none: render "file
  estimate arrives with the full estimator" note, decision honesty), breakdown
  rows (tokens `~180k` formatting, cycle `12–18 min`, effort + conf), risk
  meter (ok/warn/err by level, width by level, rationale line); workflow tag +
  model pill; actions — **Queue for loop** (M.3 single), **Re-estimate** (L.4,
  disabled while `estimating…`), **Open on GitHub ↗** (gh_url, new tab);
  collapsible `.trace` with real provenance (`sized by heuristic-v0 · 2m ago`,
  signal lines from the trace — never a fabricated model name, K10). States:
  unsized (issue content + "first estimate pending"), estimating (skeleton
  breakdown + live flip), needs_human (err pill + failure/low-conf trace).
- **Acceptance Criteria:**
  - Seeded `#485` matches the mockup panel except honest provenance; all four
    states render designed (storybook-style test per state).
  - Re-estimate round-trips: button → `estimating…` → new version rendered.
  - Panel is keyboard-reachable from rows; responsive (stacks below the table
    at narrow widths).
- **Parallelism/Dependencies:** Needs N.3, M.2, L.4.
- **Technical Stack:** React, #46 primitives, generated client.
- **Epic:** N

```
ISSUE DETAIL                                    (sized)
#485 · opened 2d ago by field-support
Watchdog reset on I²C bus lockup   [bug][i2c][watchdog][priority-high]
│ "Unit 07 in the Fremont pilot rebooted 14 times overnight…"
── AI WORK BREAKDOWN ──
Est. tokens ~180k · Est. cycle 12–18 min · Effort [M] conf 92%
Regression risk  low ▓▓░░░░░░░ "Isolated to the I²C driver path…"
[standard-fix] [claude-fable-5]
[Queue for loop] [Re-estimate] [Open on GitHub ↗]
▾ estimation trace — sized by heuristic-v0 · 2m ago · rules: label-map, title-verb
```

### Issue N.6 — ouroboros-ui: [N.6] Intake empty, loading & guidance states

> **GitHub issue:** #120 · **Status:** 🟡 Open · **Parent epic:** #97

- **Problem Statement:** The mockup shows a full backlog; reality starts with no
  token, no enabled repos, an empty repo, a first sync in progress, or a filter
  that matches nothing — each needs designed guidance, not a blank table.
- **Solution/Scope:** #46 EmptyState variants: **no token** (explains + links to
  the K.3 settings surface, admin-only CTA), **no enabled repos** (links to the
  login/tenancy Step 2 surface), **first sync running** (progress framing from
  M.4 status), **zero issues** ("backlog clear" celebration tone), **no filter
  matches** (clear-filters CTA), table skeletons on first load, stale/sync-
  paused banner reusing the DASH-I.7 pattern.
- **Acceptance Criteria:** Each state reachable and rendered in both themes
  (fixture-driven tests); personal-org seed shows the no-repos state; guidance
  CTAs respect roles.
- **Parallelism/Dependencies:** Needs N.2–N.5 (+M.4 status).
- **Technical Stack:** React, #46 EmptyState/Skeleton.
- **Epic:** N

```
no token ─▶ "Connect GitHub to watch your backlog" [Open settings] (admin)
no repos ─▶ "Enable an org & repos to begin"      [Choose repos]
sync #1  ─▶ "First sync running — 120 issues so far…"
0 match  ─▶ "No issues match these filters"        [Clear filters]
```

### Issue N.7 — ouroboros-ui: [N.7] Issues e2e leg

> **GitHub issue:** #121 · **Status:** 🟡 Open · **Parent epic:** #97

- **Problem Statement:** The intake flow (filter → select → queue → dashboard)
  and the estimation lifecycle are cross-service paths only e2e can certify.
- **Solution/Scope:** Extend the #56 suite: seeded parity (head counts, table
  rows, `#485` panel), filter round-trip via URL, select three → combined
  estimate → queue → assert dashboard queue card gained rows, re-estimate flow
  (estimating → sized), guidance state (personal org), both themes.
- **Acceptance Criteria:** Green from cold compose; each leg fails meaningfully
  when its service breaks (spot-verified); ≤ 2 min added.
- **Parallelism/Dependencies:** Needs N.1–N.6, K.5; amends #56.
- **Technical Stack:** Playwright.
- **Epic:** N

```
e2e: parity ✓ · filters ✓ · select→queue→dashboard ✓ · re-estimate ✓ · guidance ✓ · themes ✓
```

---

## Epic O (#98) — Live Intake & Extended Scope (v2)

| Ref | GitHub | Status | Title | Summary | Labels | Parallel | MVP | Complexity | Affected Modules |
|-----|:------:|:------:|-------|---------|--------|:--------:|:---:|:----------:|------------------|
| O.1 | #122 | 🟡 Open | ouroboros-rest: [O.1] GitHub App & webhook ingestion | App install flow, webhook receiver, near-instant sync | v2, intake, rest, ui | N (after K.4) | N | L | ouroboros-rest, ouroboros-ui |
| O.2 | #123 | 🟡 Open | ouroboros-engine: [O.2] LLM-backed estimator | Real model sizing behind the L.1 contract; heuristic as fallback | v2, intake, engine | N (after L.2, providers roadmap) | N | L | ouroboros-engine |
| O.3 | #124 | 🟡 Open | ouroboros-rest: [O.3] Workflow entities in assign & suggestions | Replace the fixed tag set with mockup-04 workflow objects | v2, intake, rest, ui | N (after mockup-04 roadmap) | N | M | ouroboros-rest, ouroboros-ui |
| O.4 | #125 | 🟡 Open | ouroboros-engine: [O.4] Estimation signals from knowledge | Similar-closed-issues, code map, test index feeding the trace | v2, intake, engine | N (after O.2, mockup-14 roadmap) | N | L | ouroboros-engine |
| O.5 | #126 | 🟡 Open | ouroboros-rest: [O.5] GitHub write-backs | Size labels / intake comments posted back to GitHub, opt-in | v2, intake, rest | N (after O.1) | N | M | ouroboros-rest |

### Issue O.1 — ouroboros-rest: [O.1] GitHub App & webhook ingestion

> **GitHub issue:** #122 · **Status:** 🟡 Open · **Parent epic:** #98

- **Problem Statement:** Token + polling caps freshness at the poll interval and
  rate limits at 5k/h; the mockup's "watches the backlog" ideal is webhook-fast,
  and the login mockup already promises "installs as a GitHub App with
  least-privilege scopes."
- **Solution/Scope:** GitHub App (contents/issues/PR scopes per the mockup-01
  promise): install/callback flow tied to org enablement (upgrades BA-B.3's
  data-only shape), webhook receiver (`issues` events, signature-verified,
  idempotent upserts into K.1), polling demoted to reconciliation sweep;
  installation tokens replace the pasted PAT (15k req/h); settings UI upgrade.
  Source: GitHub Apps/webhooks docs.
- **Acceptance Criteria:** Issue opened on GitHub appears locally < 5s; signature
  verification enforced; PAT path still works as fallback; reconciliation
  catches missed deliveries.
- **Parallelism/Dependencies:** Needs K.4. Enables O.5.
- **Technical Stack:** GitHub App, webhooks, Octokit.
- **Epic:** O

```
GitHub ── issues webhook (signed) ──▶ receiver ─▶ upsert (idempotent) ─▶ UI < 5s
   └── nightly reconcile sweep (K.4 cursor path) covers missed deliveries
```

### Issue O.2 — ouroboros-engine: [O.2] LLM-backed estimator

> **GitHub issue:** #123 · **Status:** 🟡 Open · **Parent epic:** #98

- **Problem Statement:** Heuristic v0 sizes crudely and cannot estimate files;
  the product promise (file-touch prediction, calibrated confidence, real
  routing) needs models — which need the provider stack (mockup 07) first.
- **Solution/Scope:** LLM estimator behind the unchanged L.1 contract: prompt
  over issue content + repo context, structured output validated to the
  schema, per-estimate token accounting into the trace (`sized by <model> ·
  41k tokens` — now true), confidence calibration notes, heuristic v0 retained
  as fallback on provider failure; async 202 path (L.1's escalation) for slow
  models; cost caps per org (provider-roadmap budgets).
- **Acceptance Criteria:** Estimate quality benchmark vs. v0 on a labeled
  fixture set documented; trace provenance names the real model + tokens;
  provider outage degrades to v0 with honest trace.
- **Parallelism/Dependencies:** Needs L.2, provider/routing roadmaps (mockups
  06/07).
- **Technical Stack:** FastAPI, provider clients, structured output.
- **Epic:** O

### Issue O.3 — ouroboros-rest: [O.3] Workflow entities in assign & suggestions

> **GitHub issue:** #124 · **Status:** 🟡 Open · **Parent epic:** #98

- **Problem Statement:** The fixed tag set (K5) becomes real workflow objects
  once mockup 04's roadmap lands; assign menus and suggestions must upgrade
  without breaking stored tags.
- **Solution/Scope:** Map stored opaque tags onto workflow entities (slug
  compatibility), assign menu lists real workflows with descriptions, estimator
  context (L.1 `workflow_tags`) feeds from the registry; migration note for
  renamed workflows.
- **Acceptance Criteria:** Existing queue items/estimates keep resolving; menu
  shows registry workflows; suggestion honors registry availability.
- **Parallelism/Dependencies:** Needs mockup-04 roadmap.
- **Technical Stack:** NestJS, workflow registry.
- **Epic:** O

### Issue O.4 — ouroboros-engine: [O.4] Estimation signals from knowledge

> **GitHub issue:** #125 · **Status:** 🟡 Open · **Parent epic:** #98

- **Problem Statement:** The mockup trace cites `3 similar closed issues ·
  driver map · HIL test index` — retrieval signals that need the knowledge
  layer (mockup 14).
- **Solution/Scope:** Signal providers feeding O.2's prompt + trace: similar
  closed issues (embedding search over synced history), code-map summary, test
  index; each signal listed in the trace with its contribution; graceful
  absence.
- **Acceptance Criteria:** Traces list real retrieved signals; removing the
  knowledge service degrades gracefully; measurable confidence improvement on
  the O.2 benchmark documented.
- **Parallelism/Dependencies:** Needs O.2, mockup-14 roadmap.
- **Technical Stack:** FastAPI, knowledge/retrieval services.
- **Epic:** O

### Issue O.5 — ouroboros-rest: [O.5] GitHub write-backs

> **GitHub issue:** #126 · **Status:** 🟡 Open · **Parent epic:** #98

- **Problem Statement:** Sizing value multiplies if it reaches GitHub — size
  labels or an intake comment on the issue — but writing to customer repos is
  trust-sensitive and strictly opt-in.
- **Solution/Scope:** Opt-in per org (settings): apply `ouro:size/M`-style
  labels and/or a single idempotent intake comment (edited, not re-posted, on
  re-estimate); App permissions from O.1; kill-switch; audit events.
- **Acceptance Criteria:** Opt-out default verified; label/comment idempotency
  on re-estimate; audit rows on every write-back.
- **Parallelism/Dependencies:** Needs O.1 (+#26 audit path).
- **Technical Stack:** Octokit, NestJS.
- **Epic:** O

```
opt-in ─▶ estimate lands ─▶ label ouro:size/M + one intake comment (idempotent edit)
```

---

## Work Order (dependency-ordered execution plan)

```mermaid
flowchart TB
    subgraph P0["Phase 0 — Prerequisites"]
        PRE["Scaffolding: #19 · #28 · #41 · #46 · #52 · #35<br/>BetterAuth roadmap: BA-B.3 · BA-C.3 · BA-C.4 · BA-D.5<br/>Dashboard roadmap: DASH-F.2 (queue_items) · DASH-I.8 (poll pattern)"]
    end
    subgraph P1["Phase 1 — Sync foundation"]
        K1["K.1 issue cache"] --> K2["K.2 estimates schema"]
        K3["K.3 credentials + client"]
        K1 --> K4["K.4 sync service"]
        K3 --> K4
        K2 --> K5["K.5 seeds"] --> K6["K.6 ci/db"]
    end
    subgraph P2["Phase 2 — Estimation pipeline"]
        L1["L.1 estimate contract"] --> L2["L.2 heuristic v0"]
        L1 --> L3["L.3 orchestration"]
        K2 & K4 --> L3
        L3 --> L4["L.4 re-estimate endpoints"] --> L5["L.5 pipeline tests"]
    end
    subgraph P3["Phase 3 — Backlog API"]
        K4 & L3 --> M1["M.1 list + filters"]
        L3 --> M2["M.2 detail"]
        L3 --> M3["M.3 bulk queue"]
        K4 --> M4["M.4 sync status/trigger"]
        M1 & M2 & M3 & M4 --> M5["M.5 API tests"]
    end
    subgraph P4["Phase 4 — UI"]
        M1 --> N1["N.1 route + head"] --> N2["N.2 filter bar"] --> N3["N.3 table + selection"]
        N3 --> N4["N.4 action bar"]
        M2 & L4 --> N5["N.5 detail panel"]
        N3 --> N5
        M3 --> N4
        N2 & N3 & N4 & N5 --> N6["N.6 states"] --> N7["N.7 e2e = MVP gate"]
    end
    subgraph V2["v2"]
        O1["O.1 App + webhooks"] --> O5["O.5 write-backs"]
        O2["O.2 LLM estimator"] --> O4["O.4 knowledge signals"]
        O3["O.3 workflow entities"]
    end
    P0 --> P1
    N7 -.-> V2
```

Ordered checklist (⊕ = parallelizable within its phase):

1. **Phase 0 — Prerequisites:** scaffolding #19/#28/#41/#46/#52/#35; BetterAuth
   roadmap B.3/C.3/C.4/D.5; dashboard roadmap F.2 + I.8 (file those roadmaps'
   issues first).
2. **Phase 1 — Sync foundation:** { K.1 ⊕ K.3 } → K.2 → K.4 → K.5 → K.6
3. **Phase 2 — Estimation pipeline:** L.1 → { L.2 ⊕ L.3 } → L.4 → L.5
4. **Phase 3 — Backlog API:** { M.1 ⊕ M.2 ⊕ M.3 ⊕ M.4 } → M.5
5. **Phase 4 — UI:** N.1 → N.2 → N.3 → { N.4 ⊕ N.5 } → N.6 → **N.7 ✅**
   *(this roadmap's MVP gate, amending #56)*
6. **v2:** O.1 → O.5; O.2 → O.4; O.3 when mockup-04's roadmap lands.

## Totals

| | Issues | MVP | v2 |
|---|:---:|:---:|:---:|
| Epic K — GitHub Backlog Sync | 6 | 6 | 0 |
| Epic L — Estimation Pipeline | 5 | 5 | 0 |
| Epic M — Backlog REST API | 5 | 5 | 0 |
| Epic N — Issue Intake UI | 7 | 7 | 0 |
| Epic O — Live Intake & Extended | 5 | 0 | 5 |
| **Total** | **28** | **23** | **5** |

GitHub parents: Epic K #94 · Epic L #95 · Epic M #96 · Epic N #97 · Epic O #98.
Work issues #99–#126, each filed as a sub-issue of its epic (GitHub Relationships).

Plus **3 amendments** to existing issues — comments posted and the `intake` label
applied on #41 (nav state), #49 (`/issues` stub retirement) and #56 (e2e leg) on
2026-08-09; no new work created.

## References

- Design source: [`docs/mockups/03-issues.html`](mockups/03-issues.html),
  `docs/mockups/assets/ouroboros.css`, `docs/mockups/README.md`
- Upstream roadmaps: `ROADMAP_OUROBOROS_APPLICATION_SCAFFOLDING.md` (filed),
  `ROADMAP_LOGIN_PAGE_BETTERAUTH.md` and `ROADMAP_MOCKUP_02_DASHBOARD.md`
  (validation gates — prerequisite issues referenced as BA-* / DASH-*)
- [GitHub REST API — issues endpoints](https://docs.github.com/en/rest/issues)
  (grounds K2: `since` incremental sync, pagination, PR filtering) ·
  [GitHub API integration guide (Apps vs tokens, rate limits, webhooks)](https://www.getknit.dev/blog/github-api-integration-guide)
  (grounds K1/O.1: PAT 5k/h vs App 15k/h per installation) ·
  [REST API troubleshooting/pagination](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api)

## UI/UX Shell Compliance (addendum 2026-08-09)

The application shell defined in
[`docs/DESIGN_SYSTEM_APP_SHELL.md`](DESIGN_SYSTEM_APP_SHELL.md) (implementing
roadmap: [`ROADMAP_UIUX_APP_SHELL.md`](ROADMAP_UIUX_APP_SHELL.md)) supersedes
the mockup's top-bar navigation for every UI issue in this roadmap:

1. **Header** — application name/brand upper-left, profile & session controls
   upper-right; no navigation links in the header.
2. **Sidebar navigation** — fixed left rail of icon + name entries from the
   CP.2 module registry. This module is the sidebar's **Issues** entry (icon
   `circle-dot`). Page-level tab sets stay at the top of the content pane
   (CP.4 PageSubnav), sticky within the pane's scroll.
3. **Content-only scrolling** — the content pane is the sole scroll
   container; header and sidebar never scroll; sticky in-page chrome
   (subnavs, dirty-state bars, table headers) sticks within the pane; wide
   content scrolls inside its own wrappers, never at pane level.
4. **Type scale** — every UI issue uses rem-based type/spacing against the
   #16 tokens (CQ.1) so the five-step font-size preference (CQ.2) scales the
   whole surface; hard-coded px font sizes are lint-banned.
5. **Mockup interpretation** —
   [`docs/mockups/03-issues.html`](mockups/03-issues.html) remains the design
   source for page content and card anatomy; its topbar/nav chrome is
   superseded by the shell spec.

Issue-level impact:

| Issue | Amendment |
|---|---|
| N.1 (#115) | Mounts in the shell content pane; navigation reached via the sidebar registry entry, not a topbar link |
| N.2–N.6 (#116–#120) | rem-based type, shell tokens; internal wide/tall regions scroll in their own wrappers |
| N.7 (#121) | Gains shell assertions: header/sidebar fixed during content scroll, correct sidebar active state, font-scale render check at 125% |

## Next Step

**Issues filed 2026-08-09.** The validation gate is closed: the `intake` label was
created, the five epic parents (#94–#98) and twenty-eight work issues (#99–#126) exist
with epic relationships and issue types set, and the amendment comments are posted on
#41, #49 and #56.

Execution follows the work order above, with two standing prerequisites that are still
unfiled:

- **BetterAuth roadmap** ([`ROADMAP_LOGIN_PAGE_BETTERAUTH.md`](ROADMAP_LOGIN_PAGE_BETTERAUTH.md)) —
  BA-C.3 (tenant context) and BA-D.5 (auth guard) are referenced by name in the filed
  issues and must land before Epic M can be finished. **BA-B.3 and BA-C.4 are struck**:
  BA-B.3 (organization + repo tables) has landed under the mockup-01 roadmap — `V005`
  (#707), `V006` (#708) and `V003` (#22) between them are all of it — and BA-C.4 (enabled
  repos) named a capability the product already had, which the dashboard roadmap's H.1
  (#77) wrote down.
- **Dashboard roadmap** ([`ROADMAP_MOCKUP_02_DASHBOARD.md`](ROADMAP_MOCKUP_02_DASHBOARD.md),
  filed as #59–#93) — DASH-F.2 (#65 `queue_items`) is what M.3 writes into, DASH-F.5
  (#68) shares its queue seeds with K.5, and DASH-I.8 (#87) provides the polling hook
  family N.3 reuses. All three have shipped.

**Epic K opened on 2026-08-18.** **K.1 (#99) shipped**
([`V014__github_issue_cache.sql`](../ouroboros-db/migrations/V014__github_issue_cache.sql)):
`github_issues` is the backlog as rows, and `github_repos` carries the `since` watermark
the poller will write. Nothing writes either yet, which is why every rule a reader depends
on is a database constraint — the vocabularies, the label shape, the `https` URL, the
cursor-after-sync implication — each with a section in `tests/constraints.sql` that `ci/db`
runs against a database migrated from empty.

> The question K.1 leaves for **K.6 (#104)**: `verify-constraint-probes.sh` proves the
> dashboard read-model's assertions are load-bearing by dropping each rule in turn and
> requiring the suite to go red naming it. The intake assertions have no such proof yet —
> that is K.6's *"status vocabularies, cursor invariants"* bullet, and it now has concrete
> constraint names to aim at: `github_issues_sizing_status`, `github_issues_state`,
> `github_issues_labels_shape`, `github_issues_url_https` and
> `github_repos_issues_cursor_after_sync`.

**K.2 (#100) shipped on 2026-09-08.**
[`V026__issue_estimates.sql`](../ouroboros-db/migrations/V026__issue_estimates.sql) is the
*AI Work Breakdown* as versioned latest-wins rows — effort, confidence, the workflow tag and
routed model, two closed jsonb grammars, and the regression risk with the sentence under it.
Re-estimation is the next row rather than an edit (decision **K4**), versions ascend by
trigger because unique alone would let *latest* mean the older answer, and the table is
**append-only** so that a trace stays comparable and BI.4's calibration stays honest.
Latest-wins needed no index of its own: the unique key read backwards **is** the descending
index the ticket asks for, and `constraints.sql` asserts that plan, its lack of a `Sort`, and
the backlog table's lateral join reaching both relations through an index. Decision **K10**
has a constraint of its own. **Epic K's Phase 1 waited on #101** ([K.3] GitHub credentials
& API client), which has always been the other parallelizable entry point — #102's sync
service needs both — and **#103** (K.5's seeds) and **#107** (L.3's persistence) are both
unblocked by this. #101 shipped the same day; see below.

> The question K.2 leaves for **K.6 (#104)**, beside K.1's: the estimate rules have no
> load-bearing proof yet either, and the *"estimate versioning checks"* bullet now has
> concrete names to aim at — `issue_estimates_effort`, `issue_estimates_risk`,
> `issue_estimates_confidence_bounds`, `issue_estimates_provenance`,
> `issue_estimates_breakdown_shape`, `issue_estimates_trace_shape`,
> `issue_estimates_issue_version_key` and the two triggers,
> `issue_estimates_version_monotonic` and `issue_estimates_no_update`.

**K.3 (#101) shipped on 2026-09-08, and Epic K's Phase 1 is complete.**
[`V027__github_credentials.sql`](../ouroboros-db/migrations/V027__github_credentials.sql) is the
per-workspace GitHub token, and [`ouroboros-rest/src/modules/github/`](../ouroboros-rest/src/modules/github/)
is its whole life plus the client every call to GitHub goes through. Decision **K1**: one
personal access token per workspace, set *and rotated* through one `PUT
/api/v1/settings/github-token` because there is one token per workspace and two endpoints would
make a client guess which state it was in, cleared by `DELETE`, and read back only as
`ghp_••••abcd`. **The mask is composed server-side** from the stored ciphertext, so what crosses
the wire cannot be un-masked; the prefix is kept where `provider-connections`' mask drops it,
because a fine-grained `github_pat_` with the wrong repository selected and a classic `ghp_`
missing the `repo` scope fail identically from the sync's side and are fixed in completely
different places. **There is no reveal operation and there will not be one** — nothing copies
this token anywhere, so an endpoint that returned it would exist only to be the way it leaks.

The two amendments on the issue both landed rather than being noted. **The encryption is
AD.1's** (#222, decision **P2**): the vault seals the token under the workspace's own data key,
and `github_credentials` is the **second store registered with the re-encryption sweep** — a
sealed column the sweep cannot see is a rotation that reports success while leaving ciphertext
on a key it then retires. **Octokit lives behind one file** (the mockup-04 amendment, 2026-08-09):
the module is written against a four-member `OctokitLike`, `github.octokit.ts` is the only file
in the service that may import `@octokit/*`, and `.dependency-cruiser.cjs` makes that a failing
build rather than a convention — spot-verified by adding the violation, exactly as AC.1's
provider boundary is. Q.3 (#140) inherits that seam rather than having to cut one.

Two claims are held by tests rather than by inspection, because the issue asked for that.
**The token is absent from every API response and every log line**: `github.secrecy.spec.ts`
drives a real lifecycle against a real vault and greps every response, every audit row and every
`Logger`/`console` sink for any *eight-character run* of the token — a leak that printed thirty
of its characters would not contain the token and would still be a leak. And **the rate guard
backs off before exhaustion**, verified against both mechanisms: a low `x-ratelimit-remaining`
stands the poller down at a floor of fifty of five thousand, and a `403`/`429` carrying
`retry-after` is recorded separately because a secondary limit can arrive with thousands of
requests remaining. Rotating or clearing a token forgets the guard's view of it — the numbers
described the *old* token's window.

> What K.3 leaves for **K.4 (#102)**: the client is a client and not a poller. `pages()` walks
> `Link`-header pagination one page at a time and holds none of them, `since` is an ordinary
> parameter, and a conditional first request that GitHub answers `304` to ends the walk
> immediately and costs nothing from the hourly budget — but *when* to poll, what watermark to
> keep and what to upsert are K.4's. The five failure reasons it will render — `not_configured`,
> `unauthorized`, `not_found`, `rate_limited`, `upstream_error` — are named and mapped onto the
> #31 envelope here, so M.4 (#113) has a vocabulary to store rather than one to invent.

**Epic L opened on 2026-09-08.** **L.1 (#105) shipped**: `POST /v0/estimate` is the
REST↔engine contract for sizing one issue, and the shape it answers is one version of K.2's
row — so L.3 will persist an answer rather than translate one. **L.2 (#106) shipped the same
day**: `heuristic-v0` is installed behind that contract, so the operation returns a real
estimate — effort, confidence, workflow tag, model, breakdown, risk and a trace of the rules
that produced it — for every issue, without an AI stack. `files[]` is empty and says so,
`tokens_used` is `0`, and a confidence under the published floor of 70 carries a
`needs-human:` line for L.3 to act on.

> The thing L.1 left for **K.2 (#100)** has been collected: the contract's shipped test lists
> every column and jsonb key the response was written against and compares them to the
> migration. `V026` landed the same day and the comparison is **live and green** — every name
> matches, so L.3 persists a parsed response rather than translating one, and a later rename
> on either side is a red build in the engine's suite.
>
> And for **L.3 (#107)**: `honours_context` means the orchestration must send the workflow
> tags and the model defaults it has on *every* call, because the engine holds no list of
> either and will refuse to answer out of one it was not given. A `202` from the engine is
> currently a `502` at the gateway — nothing sends one yet, and following it is O.2's (#123)
> change rather than L.3's.


**K.4 (#102) shipped on 2026-09-08, and `github_issues` has a writer.**
[`ouroboros-rest/src/modules/backlog-sync/`](../ouroboros-rest/src/modules/backlog-sync/) is
mockup 03's subline made true: a jittered cycle
(`OURO_BACKLOG_SYNC_INTERVAL_SECONDS`, five minutes by default) walks every enabled repository
of every workspace that has a token, drops pull requests, and writes the rows, the cursor and
the freshness stamp in **one transaction** — so the *"synced 40s ago"* tag can never claim a
sync that partly failed. A repository whose poll failed is not stamped at all, and its stored
`synced_at` goes on saying when the last good poll was.

**The issue's own diagram was wrong in one place, and the fix is worth recording.** It writes
`state=open&since=cursor`, and that pair cannot satisfy the criterion two lines below it —
*"closing it flips `state`"* — because an issue that closes upstream simply leaves an `open`
listing and would sit in this mirror as open forever. So the **initial import** takes
`state=open`, which is what stops a cold start dragging in a decade of closed issues, and every
**incremental poll** takes `state=all` bounded by `since`. A closed issue the mirror has never
seen is still not stored, so `state=all` widens what the sync *learns* without widening what it
*keeps*.

Two decisions carry the acceptance criteria. **The watermark is what the poll saw** — the
greatest `updated_at` GitHub returned, never this host's clock, because a clock-derived
watermark is wrong by however far the machine has drifted and wrong in the direction that loses
issues. And **an unchanged row is not written**: GitHub's `since` is inclusive, so every
incremental poll re-reads the issue sitting exactly on the watermark, and since
`github_issues_touch_updated_at` is unconditional the only way to keep `updated_at` meaning
*"GitHub changed this"* is to issue no statement at all. That is the *"O(1) requests and touches
no rows"* criterion, asserted against a real database rather than approximated.

**V028 is this ticket's one schema change, and it exists because K.4 is the table's first
writer.** `V014` gave `github_issues.author_login` V003's *organisation* login rule, which is
the right rule for `github_orgs.login` and the wrong one for an issue's author: a GitHub App
opens issues under `dependabot[bot]`, `github-actions[bot]`, `renovate[bot]` — brackets
included. Nothing had noticed because nothing had written a row, and the behaviour would have
been Renovate's dependency dashboard and every issue a workflow files **silently missing from
the backlog**, refused one at a time by a CHECK. Widened to the documented suffix and no
further; `github_orgs.login` is deliberately left alone, because an organisation is never a bot.

**Nothing is ever a silent no-op.** No token pauses `not_configured`, a token with nothing
enabled pauses `no_repositories`, a repository the token cannot see pauses `not_found` without
costing its neighbours their poll, and a spent budget pauses the whole *workspace* because the
budget belongs to the token. Five of those six words are K.3's taxonomy, unchanged.

> What K.4 leaves for **L.3 (#107)**: the handoff exists and is a **seam, not a queue**.
> `EstimationIntake` is a Nest token bound in `backlog-sync.module.ts`; new and reopened issues
> are handed to it *after* the transaction commits, with `imported` or `reopened` on each, and
> the placeholder bound today records the handoff and says once in the log that nothing is
> estimating. L.3 replaces one binding and changes nothing else. The rows are `unsized`, which
> is what `sizing_status` already says about them — so the fourth acceptance criterion's
> *"(verified together with #107)"* is exactly what remains.
>
> And for **M.4 (#113)**: `BacklogSyncService.lastCycle()` is the in-memory half of the status
> answer — the pause reasons, per workspace and per repository — and `github_repos.issues_synced_at`
> and `issues_sync_cursor` are the durable half. `BacklogSyncScheduler.tick()` is what a manual
> re-sync drives; the debounce and the `409` are M.4's to add, because they are properties of the
> endpoint rather than of the cycle. Whether a pause reason should outlive a restart is M.4's
> question, and the vocabulary is `sync.report.ts` either way.
>
> And for **Q.3 (#140)**, per the 2026-08-09 amendment on this issue: the GitHub specifics the
> `TicketSourceProvider` SPI will own are already in one file each — the `since` cursor and the
> `state`/`sort` choice in `backlog-sync.service.ts`, pagination and PR filtering in
> `issue.mapping.ts` — so the provider-neutral scheduler inherits a seam rather than having to
> cut one. Every criterion re-asserted through the SPI is asserted here first.

**K.5 (#103) shipped on 2026-09-09, and mockup 03 has a fixture.**
[`R__dev_seed_intake.sql`](../ouroboros-db/migrations/R__dev_seed_intake.sql) is the sixth
development seed: nine mirrored issues and nine estimates in
`acme-robotics / helios-firmware`, so design review, every intake screen and the #121 e2e
leg have the mockup's table without a live GitHub token. The head counts are the seed's own
truth — **"9 open issues. 7 already sized."** — because they are aggregates M.1 computes,
and `kensuenobu` gets zero rows, which is N.6's empty state as data rather than as a
screenshot.

The seed's job turned out to be as much about what it **declines** to write. Decision
**K10** costs the mockup its whole trace line: `estimator` is `heuristic-v0`, `tokens_used`
is `0`, and `signals` is `[]`, because seeding *"3 similar closed issues · driver map · HIL
test index"* would be a screen rendering a provenance no component produced — those are
**O.4**'s. The queue rows stay DASH-F.5's for an arithmetic reason: mockup 02's *Queued
issues* `12` and its `est. 9h 40m` are aggregates over exactly twelve rows, six of them in
this repository, so a thirteenth written from here would break one mockup to decorate
another. The consequence is a disagreement the two mockups already had — mockup 02 queues
`#485` at position 1, mockup 03 calls it `sized` — and the seed follows the rows that exist
and writes the disagreement down.

> What K.5 leaves for **M.1 (#110)** and **N.2 (#118)**: the `queued` pill is a join, not a
> column, and the rows that carry it are not the rows the mockup draws it on — the
> migration's header names them. The sort is safe to build a parity test on: no two seeded
> issues share an `(effort, confidence)` pair, so `sort=effort` is total over the fixture
> and cannot flake on a tie the planner broke. The mockup's own row order is not any of the
> four documented sorts, which is a page laid out by hand rather than a fifth ordering to
> implement. And `meta.syncedAt` has one honest source today —
> `max(github_issues.synced_at)`, one instant across all nine — because
> `github_repos.issues_synced_at` is K.4's to stamp and a seeded poll is a poll that never
> ran.
>
> And for **K.6 (#104)**: the seeded rows are now a second population the intake probes run
> beside their own fixtures — nine issues across all four `sizing_status` transitions it
> asserts, nine estimates across all five efforts and all three risk levels, and one issue
> with two versions for the monotonicity and latest-wins rules to be proved load-bearing
> against.
>
> *(K.6 corrected that last sentence when it landed: they are not a second population yet.
> `ci/db` points `constraints.sql` at a database migrated from empty — that is what makes
> its absolute counts mean anything — and the seeded database gets `seed.sql` and
> `registry-invariants.sql` instead. An intake suite for the seeded rows is a ticket
> nobody has filed; see K.6's own note.)*

**K.6 (#104) shipped on 2026-09-09, and Epic K is complete.**
[`tests/verify-constraint-probes.sh`](../ouroboros-db/tests/verify-constraint-probes.sh)
now drops seven intake rules one at a time — the `sizing_status` vocabulary, the
`(github_repo_id, number)` key K.4's upsert conflicts on, the `labels` array-of-names
shape, the sync cursor that cannot precede its own sync, the estimate-version trigger and
the unique key beneath it, and decision **K10**'s mandatory trace provenance — and requires
`constraints.sql` to go red **naming the assertion that caught it**. 63 → 77 checks in the
probe run, 111 → 132 in the static test that holds those names against the migrations, and
**3.7s** added to a `ci/db` step that took seventeen.

> The question K.1 and K.2 left is answered, and it turned out to be the only thing K.6
> owed: every probe this ticket's scope names was already in `constraints.sql`, written by
> the migration that created the rule. What was missing was the proof that any of them is
> load-bearing — a file that asserted nothing would be exactly as green — which is the
> criterion this mechanises for every run rather than spot-verifying once.
>
> What K.6 leaves for **M.1 (#110)**, if it wants it: the seeded intake rows have no live
> suite of their own. CG.5 (#583) made the argument for one on the registry side and
> `registry-invariants.sql` is the shape it took — a fragment included by `constraints.sql`
> *and* pointed at the seeded database on its own — so an intake equivalent is a known
> pattern rather than a design question, and the ticket that first asserts an intake read
> against real rows is the one that should carry it.

**Epic M opened on 2026-09-10, and it opened out of order.** **M.4 (#113) shipped** —
[`ouroboros-rest/src/modules/backlog/`](../ouroboros-rest/src/modules/backlog/) is the intake
screen's first API surface, and it is the one ticket in Epic M that needed only K.4 rather than
M.1's listing or L.3's estimates. `GET /api/v1/backlog/sync-status` answers *how fresh* and,
when there is no such number, *why not*; `POST /api/v1/backlog/sync` (owner, admin or member)
drives one cycle at once, refusing a concurrent one and a repeat inside thirty seconds, each
with its own `409` and its own next move. Nothing about the state is stored: the freshness
stamp and watermark are columns a poll wrote, *no token* and *no enabled repository* are read
from tables, the rate limit is read from the guard the client enforces, and the rest is the
last cycle's report — so a pause reason does not survive a restart, which is the honest answer
to the question K.4 left open.

> What M.4 leaves for **M.1 (#110)**: `SyncStatusService.status()` already computes the number
> the freshness tag renders, so `meta.syncedAt` is a field lifted from one service rather than
> a second query over `github_repos` — and the tag beside the listing and the tag from
> `/backlog/sync-status` then cannot disagree. `BacklogModule` is where M.1's controller goes;
> the routes it adds share the prefix and shadow nothing, because `sync-status` and `sync` are
> literal segments.
>
> And for **M.5 (#114)**: the backlog API's integration matrix is still its own, and it
> inherits one leg of it rather than a blank sheet. `backlog.integration-spec.ts` already
> drives both routes against a migrated database — freshness advancing after a trigger, the
> role gate through the router, the debounce as a `409` off the wire — so what M.5 adds is the
> filter matrix, the queue writes and the isolation cases, beside a file that shows how a
> process-wide in-memory guard is arranged for rather than waited out.
>
> And for **N.3 (#117)** and **N.6 (#120)**: the vocabulary they render is
> `sync.report.ts`'s six words, unchanged, plus `state`/`pause` split so a card can say
> *paused* without knowing every reason this service can give. `running` is what makes a busy
> trigger renderable rather than a click that is about to be refused, and
> `retryAfterSeconds` is the countdown for the one pause that ends by itself.

**L.4 (#108) shipped the same day, and Epic L has one issue left.** The pipeline has external
triggers: `POST /api/v1/backlog/{id}/estimate` for the panel's button and
`POST /api/v1/backlog/estimate-all` for the head's, member+ and admin+ respectively, because a
fan-out spends the workspace's engine quota in one press. Both answer `202` and both are
guarded four ways — a per-workspace rate limit, a workspace-scoped read, a `409` for an issue
already in flight, and a claim that happens *before* the work is queued so the status the answer
carries is true when it is sent. The fan-out's scope and its claim are one statement, which is
the whole of *touches only non-`estimating` rows*.

> What L.4 leaves for **L.5 (#109)**: the pipeline's matrix is still its own, and the harness it
> extends now has twelve HTTP cases in it as well as sixteen driven from the injector — a second
> workspace, three roles, a stranded row and a rate limit are all arranged in
> `estimation.integration-spec.ts` rather than waiting to be invented. What that file does *not*
> cover is the engine-down and stale-sweep matrix seen from the endpoints, which is where a
> re-estimate that fails differs from a poll's that does: a person is watching.
>
> And for **N.1 (#115)** and **N.5 (#119)**: the confirmation contract is two halves. The dialog
> says *"this re-estimates N issues"* from M.1's own count, and the `202` says how many it
> actually took — `enqueued` can be smaller, and that is the honest shape of a second press. The
> panel's button has a `409` carrying `details.status`, which is the pill to redraw rather than a
> failure to report.
