# Demonstration — P4 · Dashboard, the First Real Screen

> A five-minute walkthrough of what phase **P4** of
> [`ROADMAP_OOE_MVP.md`](ROADMAP_OOE_MVP.md) delivered, and how to show it.
> **Status at the time of writing:** ✅ complete — all 25 issues closed
> ([#64](https://github.com/NobuData/ouroboros/issues/64)–[#88](https://github.com/NobuData/ouroboros/issues/88)).

## Regeneration prompt

Copy this into Claude Code to rebuild this document, or swap the phase token to
generate another phase's script.

```text
Read `docs/ROADMAP_OOE_MVP.md` and produce `docs/DEMONSTRATION_P4.md` — a
walkthrough script for phase **P4** of the order-of-execution plan.

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

| Track | Issues | What landed |
|-------|:------:|-------------|
| **Read model** (`F`) | [#64](https://github.com/NobuData/ouroboros/issues/64)–[#68](https://github.com/NobuData/ouroboros/issues/68) | `V008` runs, `V009` queue, `V010` token usage + the daily rollup view, `V011` workspace settings, and `R__dev_seed_dashboard.sql` — mockup 02 as rows |
| **Services** (`G`) | [#70](https://github.com/NobuData/ouroboros/issues/70)–[#76](https://github.com/NobuData/ouroboros/issues/76) | `GET /api/v1/dashboard` — one org-scoped payload for all six card surfaces, with a strong ETag — plus runs, queue, pulse metrics, the auto-merge setting, the polling contract and the integration suite |
| **Topbar chrome** (`H`) | [#77](https://github.com/NobuData/ouroboros/issues/77)–[#79](https://github.com/NobuData/ouroboros/issues/79) | Tenant chip, live & needs-you pills with real counts, search pill and the ⌘K navigation palette |
| **The page** (`I`) | [#80](https://github.com/NobuData/ouroboros/issues/80)–[#88](https://github.com/NobuData/ouroboros/issues/88) | Route, grid and page head; stat row; active loops; loop pulse; recently closed; up-next queue; the polling hook; empty/loading/error states; the e2e leg |

**The point of the phase.** The dashboard depends only on scaffolding and auth, which
makes it the earliest possible *complete vertical slice* — schema to service to
screen with no stubs — and the phase that proves the whole stack works end to end
before the platform planes are built. It also establishes the read-model, polling and
empty-state patterns every later screen copies.

## Setup

```bash
cd ouroboros
git switch main && git pull
yarn install && yarn setup
docker compose up -d                 # seeded PostgreSQL: 53 runs, 12 queue items, 12 usage events
yarn dev
```

> **Port note.** If something on the machine already holds 5432, publish the
> container elsewhere — `OURO_DB_PORT=45432 docker compose up -d` — and move the
> `psql` URL and `OURO_DATABASE_URL` with it.

Sign in at <http://localhost:3000> as `ken@acme-robotics.dev` /
`ouroboros-dev-password`, choose **Acme Robotics**, and land on `/dashboard`.

Have a **second private window** ready, signed in as the same person but with
**kensuenobu** — the personal workspace — chosen instead. It carries no rows in any of
the four read-model tables, and it is the empty-state fixture for beat 5. (You can also
reach it from the first window with the profile menu's **Switch workspace**.)

Keep a terminal open for the ETag demonstration in beat 4.

**The figures below are the seed's**, and they are asserted by
[`tests/e2e/support/dashboard.ts`](../tests/e2e/support/dashboard.ts). If a number on
screen disagrees with this script, the seed did not apply — do not improvise.

## Walkthrough — 4:45

### Beat 1 · The page head and the stat row — 0:00 → 1:00

**Navigate**

Read the H1 and the subline, then the four tiles across the top.

**Say**

> *"Good afternoon, Ken — the loop is turning."* The greeting names a part of the
> reader's day, from the reader's own clock, and the sentence under it says **3 issues
> in flight, 12 queued behind them** — the same two counts the first two tiles draw,
> arriving on the page by a second route.
>
> Four tiles. **Loops live: 3**, broken down as *1 coding · 1 building · 1 in review*
> — and that subline is the run table's own arithmetic, not a caption someone typed.
> **Queued issues: 12**, estimated at *9h 40m of autonomous work* — eleven of the
> twelve queue items carry an estimate and the twelfth does not, so that figure also
> proves the sum skipped a null instead of counting it as a zero. **PRs merged in
> seven days: 27**, against 19 the week before, so the delta is a comparison rather
> than a constant. And **token spend today: 4.2M**, *≈ $18.60 across 4 providers*.
>
> That `≈` is load-bearing. Three of today's twelve usage events are local Ollama
> calls that carry no price at all — not a price of zero, an *absence* of one — so the
> cost is a floor rather than a total, and the page says so.

### Beat 2 · Active loops, and a meter that means something — 1:00 → 2:00

**Navigate**

Point down the **Loops running right now** table, then at the stage meters.

**Say**

> Three runs, in lifecycle order — coding, building, review — and that order is the
> server's sort, not the order the seed happened to insert them in.
>
> `#482`, *Fix flaky CAN-bus telemetry test*, on the `standard-fix` workflow,
> implementing at stage 4 of 6. `#479`, *Add OTA rollback on failed checksum*,
> `feature-loop`, sitting in the build farm at 5 of 7. `#476`, *Bump MQTT client*,
> `deps-refresh`, self-reviewing at 6 of 6.
>
> Two details worth pausing on. The model column — `claude-fable-5`,
> `claude-sonnet-5`, `ollama/qwen3-coder` — is an **opaque identifier**: this page
> draws it and never parses it, which is what lets the model plane in P5 change what
> those names mean without touching this screen. And the meters round *down*: four of
> six is 66%, not 67%, because a bar is a claim about work that has actually finished.
> Only 6 of 6 reaches 100%.

### Beat 3 · Pulse, queue, and the one thing this page writes — 2:00 → 3:10

**Navigate**

Move to **Loop pulse**, then **Up next in queue**, then flip the **Auto-merge when
checks pass** switch and flip it back.

**Say**

> Three meters. **Autonomous merge rate, 92%** — and look at the window tag: *14
> days*, where the other two say *7 days*. That is not sloppiness, it is the seed
> being honest. The mockup's own figures cannot all be true of one seven-day window;
> over fourteen days the data is 46 merged of 50 closed, which is 92% exactly. So the
> card publishes each meter against the window it was actually measured over.
>
> The other two are *avg. cycle time 14m 20s* and *2 human interventions this week*,
> and their bars are ratios against targets this product chose — thirty minutes, and a
> budget of twenty-five interventions — rather than numbers the server reported.
>
> The queue shows the head, five of twelve, and the footer says **+7 queued →** — a
> separate fact from the tile, because the card draws a slice and the tile counts the
> whole. Across those five rows you can see all five effort chips the design system
> publishes: XS, S, M, L and XL.
>
> And this switch is the dashboard's only **write**. `workspace_settings` is lazily
> created — a workspace with no row is at every default — so flipping it is a real
> round trip to the API and back, not local state.

### Beat 4 · A poll that costs a header exchange — 3:10 → 4:05

**Navigate**

Open DevTools → **Network**, filter to `dashboard`, and leave the page alone for
half a minute. Then flip the auto-merge switch and watch the next request.

**Say**

> Leave the page open and watch the network panel. The dashboard polls, and almost
> every poll comes back **304 Not Modified** — a header exchange and nothing else.
>
> That is a strong ETag over a deliberately cheap version source: four aggregate
> subqueries and the calendar day. So the server can answer "nothing you have is
> stale" without assembling the payload. One request keeps the whole page fresh —
> six card surfaces in one org-scoped payload — and the topbar's live and needs-you
> pills are fed by the same counts rather than by polls of their own.
>
> When something does change, the ETag changes and the next poll returns the new
> body. Flip the auto-merge switch again and you can watch exactly that happen.

### Beat 5 · A workspace on its first day — 4:05 → 4:45

**Navigate**

Switch to the **kensuenobu** workspace (second window, or the profile menu's
**Switch workspace**).

**Say**

> Same code, same endpoint, a workspace with no rows in any of the four read-model
> tables. The page head reads *"Nothing is running yet — the loop starts when an issue
> reaches the queue"*, and every card below it draws a zero state that says what would
> fill the surface. None of them apologises.
>
> Look at the topbar too: neither the *loops live* pill nor the *needs you* pill is
> drawn. That is the same rule — an empty workspace shows neither pill, not a zero,
> because `0 loops live` is a claim and its absence is the more honest description.
> The pills share the page's one polling store, so they cannot disagree with the
> cards about how many loops are live at the same moment in the same window.
>
> Notice what is **not** on this page: an em dash. In this product `—` means a figure
> could not be *read*, and a workspace that has simply never run anything has not had
> a failure. And none of these states is a zero standing in for an absence. That
> distinction is asserted by the end-to-end suite against a real *workspace* rather
> than against a mocked payload — which is only possible because the seed deliberately
> leaves this workspace empty.

## Prove it

```bash
cd ouroboros-rest && yarn test         # dashboard integration tests (#76)
cd ouroboros-ui && yarn test           # every card against a payload
cd tests/e2e && scripts/run.sh -- --grep dashboard
```

[`specs/dashboard.spec.ts`](../tests/e2e/specs/dashboard.spec.ts) is the phase's MVP
gate, and its subject is the distance between a row and a figure: `27` is a count over
`runs`, `9h 40m` is a sum over `queue_items` that skips the unestimated one, and `92%`
is 46 merged of 50 closed over fourteen days. Every card is unit-tested against a
payload; only this leg asks whether the payload is the database. It also screenshot-
diffs both palettes and walks the page at the 125% font scale.

## Don't claim

- **Nothing on this page is live execution.** The runs, the queue and the spend are
  seeded rows. The run console that drives them is P10; the build farm is P9.
- **The ⌘K palette navigates; it does not search content.** It is a navigation
  palette over the module registry.
- **The needs-you pill is not the inbox.** It shows a count from the dashboard
  aggregate; the inbox itself is P14.
- **The pulse card will be re-based later.** P13 replaces this phase's computation
  with the metrics service, deliberately.
- **`/issues`, `/workflows` and the rest are still labelled rows in the sidebar.**
