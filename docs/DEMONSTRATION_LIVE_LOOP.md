# Demonstration — The live loop · Reference run

> A walkthrough of the one thing the earlier demonstrations could not show: **a loop, for real**
> — an issue on a repository you own becomes a draft pull request, written by a model on your
> own API key, built on your own runner, with nothing simulated.
> **Status at the time of writing:** the live slice's gate is met in code — DI.6
> ([#1321](https://github.com/NobuData/ouroboros/issues/1321)) — and this script, DL.2
> ([#1326](https://github.com/NobuData/ouroboros/issues/1326)), drives it from a clean checkout.
> **This document was written from the script and its fixture path, not from a recorded real
> run.** Every figure below that only a real run can produce is marked **⟨from the export⟩**:
> read it out of the run's `manifest.json`, `usage.csv` and `pr-url.txt`, never from this page.
> The recorded reference run and its evidence bundle are DL.3
> ([#1327](https://github.com/NobuData/ouroboros/issues/1327)).

## Regeneration prompt

Copy this into Claude Code to rebuild this document after a real run, once DL.3 has an export to
quote.

```text
Read `scripts/reference-run.sh`, `docs/ROADMAP_OOE_LIVE_LOOP.md` § DL.2 and the export directory
of the latest real reference run, and rewrite `docs/DEMONSTRATION_LIVE_LOOP.md`.

Rules:
1. Ground every claim in this repository or the export. Before writing a step, open the script
   section, route or screen it names and confirm it exists at HEAD.
2. No fabricated numbers: durations, tokens, cost, the pull request's URL and every version come
   from the export's manifest.json, usage.csv and pr-url.txt. Mark nothing as measured that the
   export does not hold.
3. Structure: What it shows · Setup · Walkthrough (timed beats, each with the screen it appears
   on) · Prove it · Don't claim.
4. Narration is what the presenter says out loud. Navigation is what they click or type.
```

## What it shows

| Step | Where the script does it | Where a person sees it |
| --- | --- | --- |
| A production-configured stack with **no seed** | `docker compose … -f docker-compose.reference.yml up` | — (nothing to show but the empty dashboard) |
| An owner and a workspace | minted owner · `POST /api/auth/organization/create` | the workspace switcher |
| GitHub: token, repository, source, mirrored issue | `PUT /settings/github-token` · `PATCH …/repos/{name}` · `POST /sources` · `POST /backlog/sync` | Settings → Sources · Settings → Repositories · Issues |
| The provider key | `POST /providers` · `POST /providers/{id}/test` | Models → Providers & keys |
| Two routes with a per-run cap | `POST /registry/aliases` · `PUT /routing/routes/{plan,implement}` | Models |
| A runner online in `pool-a` | `POST /farm/pools` · the enroll command, pasted into the build machine | Build Farm |
| The `live-slice` workflow, published | `POST /workflows` · `POST /workflows/{id}/publish` | Workflows → live-slice |
| Dry-run on | `PATCH /policies/dry-run` | Settings → Policies |
| Readiness, and the cap stated | `GET /loop/readiness` · `cap: $2.00 — continue? [y/N]` | Get Started → **Ready to run?** |
| Queued, confirmed, run | `POST /backlog/queue` · `POST /queue/{id}/confirm` | Dashboard → Up next in queue · Active loops |
| The run | `GET /runs/{id}` polled | the run console |
| The draft pull request | `GET /pull-requests?runId=` | the pull request's page, and the host |

The `live-slice` definition is read from the one copy of it,
[`R__dev_seed_live_slice.sql`](../ouroboros-db/migrations/R__dev_seed_live_slice.sql) — plan,
implement (both model stages), a build on `pool-a` running `sh tests/check.sh`, a gate, and the
draft pull request.

## Setup

1. A machine with **Docker** (compose v2), **Node** and **git**. Nothing of Ouroboros installed.
2. **Your own copy** of the sample repository — fork or copy
   [`NobuData/ouroboros-sample`](https://github.com/NobuData/ouroboros-sample) (DL.1,
   [#1320](https://github.com/NobuData/ouroboros/issues/1320)). Nobody but its owners can push to
   the original. Note an issue's number in your copy — the script runs on one.
3. **Two credentials in the environment**, never on the command line:
   `OURO_REF_PROVIDER_KEY` (an Anthropic API key) and `GITHUB_TOKEN` (one that can push to your
   copy and open pull requests on it).
4. A clean checkout at a tag: `git checkout <tag>` — the manifest records the tag and the commit.
   Port `4000` must be free.

Then:

```bash
export OURO_REF_PROVIDER_KEY=…   # Anthropic API key
export GITHUB_TOKEN=…            # push + pull requests on your copy
scripts/reference-run.sh --repo <you>/ouroboros-sample --issue <N>
```

To rehearse without a key or an account, the same path runs against the recorded stand-ins:
`scripts/reference-run.sh --fixture --repo acme-robotics/helios-greeter --issue 1 --yes`. CI runs
that (`e2e/reference-run`).

## Walkthrough — the script's own beats

The script prints one line per step (`reference-run: …`). Read them out as they come; each beat
names where the same state can be opened in the product.

### Beat 1 · Nothing up its sleeve — the first minutes

**Navigation:** run the command. Watch `bringing up ouroboros-reference`.
**Narration:** "This is a production-configured stack with no seed — no demo workspace, no
canned runs. Password sign-in is off in production, so the script mints one owner in the
stack's own database, the way our production test leg does, and from then on it uses the
product's own API."

**Expected:** `minted the owner`, then `created the workspace …`.

### Beat 2 · Connecting what a person connects

**Navigation:** keep reading the lines. Optionally open `http://localhost:3000` beside it.
**Narration:** "GitHub first: the workspace's token, the repository switched on, a GitHub source
for the issues, and a sync. Then the provider key — it is tested against Anthropic before it is
kept. Then two routes, `plan` and `implement`, each capped per run. A runner joins the pool
`pool-a` from the build machine, by pasting the same enroll command an administrator would."

**Expected:** `connected <you>/ouroboros-sample`, `issue #N is mirrored and sized`,
`connected the provider`, `routed plan and implement`, `a runner is online in pool-a`,
`published live-slice`. **Screens:** Settings → Sources; Models → Providers & keys; Models;
Build Farm; Workflows → live-slice.

### Beat 3 · It tells you before it spends

**Navigation:** the script stops at `cap: $2.00 — continue? [y/N]`.
**Narration:** "Before anything is queued it asks Ouroboros whether the loop can start — the
twelve readiness checks the Get Started wizard shows — and states the most this run may spend.
Nothing has cost money yet." Answer `y`.

**Expected:** `ready. This run may spend up to $2.00 …`. **Screen:** Get Started → **Ready to
run?** shows the same checks, all passing.

### Beat 4 · The loop, live

**Navigation:** `queued issue #N`, `confirmed the queue item for a live run`, `run … opened`, then
the run's status lines. Open the run console from Dashboard → Active loops.
**Narration:** "A person confirmed it — that is the script, holding the owner's capability to
approve loops. The engine claims it, the plan stage runs on our routed model, the implement stage
edits the working tree, and the build runs `tests/check.sh` on the runner."

**Expected:** `run is coding`, then `run is review+pr`, then `outcome: pr_opened`. **Screen:** the
run console — stage timeline, transcript, the build card.

### Beat 5 · A draft, because dry-run is on

**Navigation:** open `pr-url.txt`'s URL. Open the same pull request in the product.
**Narration:** "A draft pull request on our copy, from one branch, `ouro/run-…`, commits
attributed to the deployment's Ouroboros identity with the confirming person as co-author. It
is a draft because dry-run is on; nothing merges until a person says so."

**Expected:** the URL ⟨from the export⟩; the host shows a **draft**. **Screen:** the pull
request's page.

## Prove it

After a run, the export directory holds:

| File | What to show |
| --- | --- |
| `manifest.json` | the tag and commit, every component's version, the images, the routes' cap, and the concrete model behind each alias — ⟨from the export⟩ |
| `usage.csv` | each metered model call: stage, attempt, alias, model, tokens in and out, cost — ⟨from the export⟩ |
| `run.jsonl` | the whole transcript, one event per line |
| `farm-job.log` | the build's own log — `sh tests/check.sh` on the runner |
| `pr-url.txt` | the draft pull request |

Re-running at the same tag takes the same path — the same stack, workspace, routes, workflow and
issue. **The model's output will differ between runs**, so the transcript, the diff and the pull
request will not be identical; the manifest says so in its `note`.

## Don't claim

- **No duration, token count or cost from this page.** None was measured when it was written;
  quote the export.
- **Not "one click".** It is one command, with a key and a GitHub token for a repository you can
  push to.
- **Not hardened.** The loop's code builds on your runner; issue text is untrusted input; there is
  no egress control yet. See Administration → Live execution, *What it cannot protect you from*.
- **Not a merge.** Dry-run keeps the pull request a draft by design.
- **Not reproducible output.** The path repeats; the model's words do not.
