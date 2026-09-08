# Demonstration — P1 · Running Skeleton (pre-auth)

> A five-minute walkthrough of what phase **P1** of
> [`ROADMAP_OOE_MVP.md`](ROADMAP_OOE_MVP.md) delivered, and how to show it.
> **Status at the time of writing:** ✅ complete — 25 of 25 issues closed
> (`#14`–`#55`).

## Regeneration prompt

Copy this into Claude Code to rebuild this document, or swap the phase token to
generate another phase's script.

```text
Read `docs/ROADMAP_OOE_MVP.md` and produce `docs/DEMONSTRATION_P1.md` — a
walkthrough script for phase **P1** of the order-of-execution plan.

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

Twenty-five issues across six waves. Grouped by what a viewer can actually see:

| Track | Issues | What landed |
|-------|:------:|-------------|
| **Brand & theme** | [#14](https://github.com/NobuData/ouroboros/issues/14), [#15](https://github.com/NobuData/ouroboros/issues/15), [#16](https://github.com/NobuData/ouroboros/issues/16), [#17](https://github.com/NobuData/ouroboros/issues/17), [#42](https://github.com/NobuData/ouroboros/issues/42) | Logo asset set, favicon/manifest, light & dark palettes as CSS custom properties, the runtime theme engine, the toggle |
| **Data tier** | [#19](https://github.com/NobuData/ouroboros/issues/19), [#20](https://github.com/NobuData/ouroboros/issues/20), [#22](https://github.com/NobuData/ouroboros/issues/22), [#24](https://github.com/NobuData/ouroboros/issues/24) | Flyway scaffold and conventions, `V001` tenants, `V003` GitHub enablement, the migration CI check |
| **`ouroboros-rest`** | [#27](https://github.com/NobuData/ouroboros/issues/27), [#28](https://github.com/NobuData/ouroboros/issues/28), [#29](https://github.com/NobuData/ouroboros/issues/29), [#30](https://github.com/NobuData/ouroboros/issues/30), [#35](https://github.com/NobuData/ouroboros/issues/35), [#36](https://github.com/NobuData/ouroboros/issues/36) | NestJS scaffold, typed config with env validation, health & readiness, the Kysely access layer, the engine gateway, the image |
| **`ouroboros-engine`** | [#50](https://github.com/NobuData/ouroboros/issues/50), [#51](https://github.com/NobuData/ouroboros/issues/51), [#52](https://github.com/NobuData/ouroboros/issues/52), [#53](https://github.com/NobuData/ouroboros/issues/53) | FastAPI scaffold, health/version/internal auth, the internal API contract v0, the image |
| **`ouroboros-ui`** | [#39](https://github.com/NobuData/ouroboros/issues/39), [#40](https://github.com/NobuData/ouroboros/issues/40), [#41](https://github.com/NobuData/ouroboros/issues/41), [#46](https://github.com/NobuData/ouroboros/issues/46), [#47](https://github.com/NobuData/ouroboros/issues/47) | Next.js scaffold, global styles over the tokens, the first app shell, component primitives, the standalone build |
| **The whole thing** | [#55](https://github.com/NobuData/ouroboros/issues/55) | Full-stack `docker-compose` — four containers, in order, on healthchecks |

**The point of the phase.** Four services that come up together and prove they can
reach each other, with the theme engine done *now* so that "renders correctly in both
palettes" stays cheap for the twenty screens that follow. It deliberately stops short
of authentication — eight scaffolding issues that assumed hand-rolled OAuth were
deferred so the identity layer is written once, in P2.

**Superseded since.** [#41](https://github.com/NobuData/ouroboros/issues/41)'s top
bar, navigation and footer were replaced by P3's spec'd shell, and
[#42](https://github.com/NobuData/ouroboros/issues/42)'s standalone theme toggle now
lives inside the profile menu. Demonstrate the *theme engine*, which is unchanged;
don't go looking for the old chrome.

## Setup

Ten minutes before, on the presenting machine:

```bash
cd ouroboros
git switch main && git pull
corepack enable
yarn install
yarn setup                                   # renders every .env, generates the shared secret
docker compose --profile full build          # cold build is minutes; warm is seconds
```

Then immediately before the demo:

```bash
docker compose --profile full up -d --wait   # blocks until every healthcheck passes
```

> **Port note.** If something on the machine already holds 5432, publish the
> container elsewhere — `OURO_DB_PORT=45432 docker compose up -d` — and move the
> `psql` URL and `OURO_DATABASE_URL` with it.

Have open:

- a terminal at the repository root,
- a browser tab on <http://localhost:3000>,
- a second browser tab on <http://localhost:4000/api/docs>.

If the stack is already up from an earlier run, `docker compose --profile full ps`
should show four services and a completed `flyway`. Nothing here needs a GitHub OAuth
application — sign-in is P2's subject, not this phase's.

## Walkthrough — 4:40

### Beat 1 · Four containers, in order, on healthchecks — 0:00 → 1:00

**Navigate**

```bash
docker compose --profile full ps
```

**Say**

> One command brought this up, and nothing in it waits on a sleep. PostgreSQL starts;
> Flyway starts when PostgreSQL's own healthcheck passes and applies every pending
> migration; `ouroboros-rest` starts when the migrations have *succeeded* and the
> engine is healthy; the UI starts behind that. The ordering is expressed as
> conditions in the compose file rather than as a documented ritual, which is why a
> cold checkout works as-is.
>
> Look at the ports column. The UI and the API are published on loopback. The engine
> is not published at all — and that is P1's most important line.

### Beat 2 · The boundary is topology, not a rule — 1:00 → 1:50

**Navigate**

```bash
curl http://localhost:8000/healthz
docker compose --profile full exec rest wget -qO- http://engine:8000/healthz
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4000/api/v1/engine/status
```

**Say**

> The first call is refused — nothing is listening on 8000 from outside the stack.
> The second one, made from inside the network, answers. So the engine is reachable
> only through `ouroboros-rest`, and that is enforced by the topology rather than by
> a rule somebody has to remember.
>
> The third call is the gateway — the one public route in front of the engine — and
> it answers `401`. That is not a failure: P2 put a session guard in front of every
> route that is not explicitly anonymous, so an unauthenticated caller cannot reach
> the engine either. In a moment the readiness probe will show you that the path
> behind that guard is genuinely live.

### Beat 3 · Health that actually checks its dependencies — 1:50 → 2:35

**Navigate**

```bash
curl -s http://localhost:4000/health/live  | jq .
curl -s http://localhost:4000/health/ready | jq .
```

**Say**

> Two probes, and they answer different questions. *Live* is "this process is up" —
> it takes no dependency, because a liveness probe that fails when the database
> hiccups gets your service killed for someone else's outage. *Ready* is "this
> process can serve traffic", and it names the two dependencies it verified: the
> database, and the engine.
>
> Both are version-neutral — they sit outside the `/api/v1` prefix — because a probe
> is not part of the product's API surface and should not move when the API version
> does.

### Beat 4 · The themed UI, and the theme engine underneath — 2:35 → 3:35

**Navigate**

Browser → <http://localhost:3000>. Sign-in is P2's, so the interesting surface here
is the chrome and the palette. Toggle the OS between light and dark, then set the
theme explicitly from the profile menu (**Theme** row).

**Say**

> The palettes are not two stylesheets. `#16` published every colour as a CSS custom
> property, in a light set and a dark set, and `#17` is the runtime engine that
> swaps between them on the fly and remembers the choice. Everything drawn after
> this phase — twenty screens, 172 UI issues — inherits both palettes for free by
> consuming tokens rather than colours.
>
> The reason that mattered *here*, in the running skeleton, rather than later, is the
> standing rule the roadmap sets: a UI issue is done only when it renders correctly
> in light and dark. Done at the end, that rule is a retrofit across every screen.
> Done now, it is a default.
>
> One honesty note: the toggle you are looking at is in the profile menu, which is
> P3's work. P1 shipped it as a standalone control in the old top bar; the engine
> beneath it is the same one.

### Beat 5 · The contract, generated and served — 3:35 → 4:40

**Navigate**

Browser → <http://localhost:4000/api/docs>. Then in the terminal:

```bash
head -12 ouroboros-rest/openapi.yaml
```

**Say**

> This is the API specification, served by the process that implements it. The rule
> from the conventions is contract-first: the specification is authoritative, the
> service loads *this file* and serves it verbatim rather than generating a document
> from decorators, and the UI's TypeScript client is generated from the same file. So
> what the client was built against and what the process answers with cannot
> disagree.
>
> At the end of P1 the surface is small — health, version, the engine gateway,
> tenancy CRUD. What matters is that the mechanism is in place, because every phase
> after this adds endpoints through it, and no type is ever hand-maintained across
> the boundary.

## Prove it

```bash
yarn test                                # every module's own suite, cached by turbo
scripts/run-tests.sh ouroboros-db/tests  # the migration and seed assertions
cd tests/e2e && scripts/run.sh -- --grep "health|engine"
```

The e2e legs that belong to this phase are
[`specs/health.spec.ts`](../tests/e2e/specs/health.spec.ts) — both probes and the two
dependencies readiness names — and
[`specs/engine.spec.ts`](../tests/e2e/specs/engine.spec.ts), which asserts the gateway
reaches the engine over the compose network *and* that the boundary is still closed.
`tests/e2e/scripts/verify-failure-modes.sh` is the falsifier: it stops each service in
turn and requires the matching leg to go red naming the layer.

## Don't claim

- **You cannot sign in at the end of P1.** Identity is P2. The login screen and the
  dashboard placeholder exist as routes, but there is no session behind them.
- **The chrome on screen is not P1's.** The header, sidebar and profile menu are
  P3's shell; `#41`'s top bar was replaced.
- **The database has no product data yet.** `V001`–`V003` are tenancy and GitHub
  enablement. Runs, queues, spend, providers and aliases all arrive later.
- **`yarn dev` is not the same stack.** It runs the services from the checkout with
  their reloaders and expects a PostgreSQL already listening; the demo above runs the
  images as they ship, which is what answers whether a change works the way it will
  be deployed.
