# Demonstration — P6 · Issue Intake (partial)

> A five-minute walkthrough of what phase **P6** of
> [`ROADMAP_OOE_MVP.md`](ROADMAP_OOE_MVP.md) has delivered **so far**, and how to show
> it.
> **Status at the time of writing:** 🟡 **3 of 23 issues closed** — `K.1`
> ([#99](https://github.com/NobuData/ouroboros/issues/99)), `L.1`
> ([#105](https://github.com/NobuData/ouroboros/issues/105)) and `L.2`
> ([#106](https://github.com/NobuData/ouroboros/issues/106)). There is no `/issues` route
> and no sync service; the engine can now *size* an issue on request, but nothing writes
> the result to a row. This is a **schema** demonstration, and the script says so out
> loud.

## Regeneration prompt

Copy this into Claude Code to rebuild this document, or swap the phase token to
generate another phase's script. Re-run it for P6 once more of the phase has landed —
the shape of this document will change substantially when
[#115](https://github.com/NobuData/ouroboros/issues/115) puts a screen behind it.

```text
Read `docs/ROADMAP_OOE_MVP.md` and produce `docs/DEMONSTRATION_P6.md` — a
walkthrough script for phase **P6** of the order-of-execution plan.

Rules:
1. Ground every claim in this repository. Before writing a step, open the file,
   route, endpoint, migration or fixture it names and confirm it exists at HEAD.
2. Confirm what actually shipped:
   `gh issue list --state closed --limit 1000 --json number --jq '.[].number'`
   (plain `gh issue view` fails on this repo — use `--json`). The roadmap's ✅ marks
   can be stale; GitHub wins. Demonstrate only closed issues, and say plainly what
   the phase still owes.
3. No fabricated numbers. Every figure the presenter reads aloud must come from a
   seed file, a fixture under `tests/e2e/support/`, or a live response.
4. The walkthrough must fit in 5 minutes. Give it timed beats summing to ≤ 4:45.
5. Structure: What shipped · Setup · Walkthrough (timed table of navigation +
   narration) · Prove it · Don't claim.
6. Narration is what the presenter says out loud, in full sentences. Navigation is
   what they click or type.
7. Where a later phase moved or replaced something this phase built, say so rather
   than demonstrating the old shape.

Swap the phase token to regenerate any other phase: P0 … P17.
```

## What shipped

| Ref | Issue | What landed |
|-----|:-----:|-------------|
| `K.1` | [#99](https://github.com/NobuData/ouroboros/issues/99) | [`V014__github_issue_cache.sql`](../ouroboros-db/migrations/V014__github_issue_cache.sql) — `github_issues`, the sync watermark on `github_repos`, and `pg_trgm` |

### What the phase still owes — 22 issues

The next two rows that can move are `K.2`
([#100](https://github.com/NobuData/ouroboros/issues/100), the estimates schema, which
needs only `K.1`) and `K.3` ([#101](https://github.com/NobuData/ouroboros/issues/101),
the GitHub credentials and API client, which is independently unblocked). Everything
else — the sync service, the engine's `/v0/estimate` contract, the heuristic estimator,
the backlog endpoints and the whole of mockup 03 — is not started.

## Setup

```bash
cd ouroboros
git switch main && git pull
docker compose up -d                 # PostgreSQL, migrated through V025
yarn dev                             # only needed for beat 4
```

> **Port note.** If something on the machine already holds 5432, publish the
> container elsewhere — `OURO_DB_PORT=45432 docker compose up -d` — and move the
> `psql` URL and `OURO_DATABASE_URL` with it.

Open a psql session and keep it in front of you:

```bash
psql postgresql://ouroboros:ouroboros@localhost:5432/ouroboros
```

Sign in at <http://localhost:3000> as `ken@acme-robotics.dev` /
`ouroboros-dev-password`, workspace **Acme Robotics**, for beat 4.

**Say this before you start:** *"This phase is one issue in. What I am showing you is
the table the backlog will be read from, and the reasons it is shaped the way it is.
There is no screen yet, and I am not going to pretend there is."*

## Walkthrough — 4:30

### Beat 1 · The table, and the one column we own — 0:00 → 1:20

**Navigate**

```sql
\d ouroboros.github_issues
```

**Say**

> This is the backlog as rows. Number, title, body, state, GitHub's labels as JSON, the
> author, the created and updated timestamps, and the issue URL. Every one of those
> belongs to GitHub.
>
> Exactly one column here is this product's: `sizing_status`, with four values —
> `unsized`, `estimating`, `sized`, `needs_human`. That is the estimator's state
> machine, and it is the only thing Ouroboros writes about an issue.
>
> The decision written above the DDL is the important one: **this is a cache, GitHub is
> the source of truth, and nothing here ever edits issue content.** A sync overwrites
> the title it finds; it never authors one. Getting that wrong would make the product
> a second, quietly diverging issue tracker.

### Beat 2 · The constraints are the specification — 1:20 → 2:30

**Navigate**

```sql
select conname from pg_constraint
 where conrelid = 'ouroboros.github_issues'::regclass
 order by conname;
```

Then try to break one:

```sql
insert into ouroboros.github_issues (organization_id, github_repo_id, number, title,
  state, gh_url, gh_created_at, gh_updated_at, sizing_status)
select o.organization_id, r.id, 9001, 'nope', 'open',
       'https://github.com/acme-robotics/helios-firmware/issues/9001',
       now(), now(), 'wat'
  from ouroboros.github_repos r
  join ouroboros.github_orgs o on o.id = r.org_id
 limit 1;
-- ERROR: new row violates check constraint "github_issues_sizing_status"
```

**Say**

> The rules are in the database, not in an application that remembers them. `state`
> accepts only `open` or `closed`. `sizing_status` accepts only its four values — and
> there is the refusal. The URL must be `https`. A title cannot be blank. `labels` must
> be a JSON *array*. `gh_updated_at` cannot precede `gh_created_at`. And
> `(github_repo_id, number)` is unique, because an issue's identity is its repository
> and its number — every repository has a `#1`.
>
> A trigger holds the issue's repository to the issue's workspace, which is the
> composite foreign key PostgreSQL cannot offer here, because the schema reaches the
> workspace through the GitHub org rather than storing it twice.

### Beat 3 · A search box, and where the sync resumes — 2:30 → 3:40

**Navigate**

```sql
\di ouroboros.github_issues*
select extname from pg_extension where extname = 'pg_trgm';
\d ouroboros.github_repos
```

**Say**

> Three indexes, one per read the backlog screen will make. The leading one is
> workspace, repository and state, which is the list. There is a GIN index on the
> labels document, which is the filter bar. And there is a trigram index on the title —
> which is why `pg_trgm` is here.
>
> That is the schema's first extension, and it was allowed in because `pg_trgm` is a
> *trusted* extension on PostgreSQL 13 and above, so installing it needs no superuser
> and a managed database will accept it. The migration guards it with a catalogue
> lookup rather than `create extension if not exists`, so a database that already has
> it is not touched. Without it the backlog's search box is a sequential scan of every
> title in the workspace.
>
> Now look at `github_repos`. Two new columns: `issues_synced_at` and
> `issues_sync_cursor`. That is the `since` watermark — where the incremental poll
> resumes — and it lives on the repository because that is the grain GitHub's API
> pages at.

### Beat 4 · What the product says about all this today — 3:40 → 4:30

**Navigate**

Switch to the browser, and hover the sidebar's **Issues** entry.

**Say**

> And here is the honest part. The sidebar carries an **Issues** entry, it is not a
> link, and hovering it says *"Issue intake arrives with #115."* The screen is not
> hidden and it is not a link to a 404 — it is labelled with the issue that will build
> it. That is the design system's honesty rule, and it is why a half-built phase is
> still a demonstrable state.
>
> What comes next is two rows that are already unblocked: the estimates schema, and the
> GitHub credentials and API client. After those, the sync service fills this table
> from a real repository, the engine's estimator moves `sizing_status` through its four
> values, and the backlog screen renders it. Twenty-two issues, none of them started.

## Prove it

```bash
scripts/run-tests.sh ouroboros-db/tests    # constraints.sql runs against a database migrated from empty
ouroboros-db/scripts/info                  # V014 applied, and everything after it
```

`K.1`'s assertions are a section in
[`ouroboros-db/tests/constraints.sql`](../ouroboros-db/tests/constraints.sql), which
`ci/db` runs on every pull request against a database migrated from empty — so the
constraints in beat 2 are checked by the pipeline, not just by the demo.

## Don't claim

- **There is no `/issues` screen.** Do not navigate to it; it does not exist.
- **Nothing syncs from GitHub yet.** `K.4`
  ([#102](https://github.com/NobuData/ouroboros/issues/102)) is the service that fills
  this table, and it is not started.
- **`sizing_status` never moves today.** The estimator exists — `L.2`
  ([#106](https://github.com/NobuData/ouroboros/issues/106)) shipped `heuristic-v0`
  behind `POST /v0/estimate`, and you can call it by hand — but the orchestration that
  reads its answer and writes the column is `L.3`
  ([#107](https://github.com/NobuData/ouroboros/issues/107)), which is not started. An
  estimate today goes into the response and nowhere else.
- **The table is empty in a fresh database.** `K.5`
  ([#103](https://github.com/NobuData/ouroboros/issues/103)) is the mockup-03 seed, and
  it has not landed — so `select count(*) from ouroboros.github_issues` is `0`, and
  that is correct rather than broken.
- **The `#485`-style issue numbers on the dashboard are not these rows.** They are
  P4's `queue_items` and `runs` seeds, which are a different table and a different
  phase.
