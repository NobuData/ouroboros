# tests/e2e — the end-to-end smoke suite

## Purpose

The executable definition of *everything is green*, and the MVP's exit gate
([#56](https://github.com/NobuData/ouroboros/issues/56)).

Every module has its own suite, and each of them necessarily stubs the other side of every
boundary it touches: `ouroboros-rest`'s tests replace the engine with an object,
`ouroboros-ui`'s replace the API with a `fetch` stub, `ouroboros-engine`'s never see a
browser. Each is right to. What none of them can answer is whether the *images* built from
this checkout, brought up together, migrated, seeded and reached through a browser, add up
to the product — and that question is what this directory exists to ask.

It is deliberately a **smoke** suite. It does not re-test what a module already covers; it
walks one path through each boundary and asserts the things that are only true of a running
deployment. Five legs from the issue, and two amended in since:

| Leg | Spec | What only this can see |
|---|---|---|
| 1 | [`specs/shell.spec.ts`](specs/shell.spec.ts) | The title, the favicon actually copied into the image, and a palette that flips because the stylesheet shipped |
| 2 | [`specs/sign-in.spec.ts`](specs/sign-in.spec.ts) | A session authenticated by `ouroboros-rest` against rows Flyway seeded, rendered as a workspace |
| 3 | [`specs/tenants.spec.ts`](specs/tenants.spec.ts) | The workspace roundtrip against a real migrated database: the plugin's write (#704) read back through this service's listing (#714) |
| 4 | [`specs/engine.spec.ts`](specs/engine.spec.ts) | The gateway calling the engine over the compose network — and the boundary still being closed |
| 5 | [`specs/health.spec.ts`](specs/health.spec.ts) | Both probes, and the two dependencies readiness names |
| 6 | [`specs/dashboard.spec.ts`](specs/dashboard.spec.ts) | Mockup 02 drawn from the rows Flyway seeded — and the same page telling the truth in a workspace that has none |
| 7 | [`specs/shell-nav.spec.ts`](specs/shell-nav.spec.ts) | The shell's promises on a laid-out page: chrome that holds still under a deep pane scroll, containment nothing escapes, the sidebar's eleven honest entries, the rail and the drawer — in both themes |

Leg 7 is [#647](https://github.com/NobuData/ouroboros/issues/647)'s, the shell roadmap's
route-migration gate. Its containment assertions come with their own falsifier:
[`scripts/verify-containment.sh`](scripts/verify-containment.sh) plants a viewport-fixed
element and a pane-level horizontal overflow (`support/shell.ts` grows both) and requires
the leg to go red naming each — the same philosophy as the failure-modes script, applied
to CSS instead of services.

Leg 6 is [#88](https://github.com/NobuData/ouroboros/issues/88), the dashboard roadmap's MVP
gate, and it is the first leg amended in by a mockup roadmap. Its subject is the distance
between a row and a figure: `27 PRs merged · 7d` is a `count` over `runs`, `9h 40m` is a
`sum` over `queue_items` that skips the one item nobody has estimated, and `92%` is 46 merged
of 50 closed over fourteen days. Every card is thoroughly unit-tested in `ouroboros-ui`
against a payload; nothing but this leg asks whether the payload is the database. It also
carries the shell assertions that are only true of a laid-out page — four regions of which
exactly one scrolls, the sidebar entry that knows where the reader is, and the whole page at
the 125% font scale — and screenshot-diffs both palettes.

## Stack

[Playwright](https://playwright.dev) on Node 24, Chromium only, over the stack
[`docker-compose.yml`](../../docker-compose.yml) brings up with `--profile full`.

**This directory is not a workspace.** It keeps its own `package.json`, `yarn.lock` and
`.yarnrc.yml`, exactly as [`ouroboros-web`](../../ouroboros-web) does, and for a reason of
the same kind: it runs on its own pipeline. Putting it in the root roster would put it in
the Turborepo task graph, where `turbo run test` would pick it up — and `yarn test` at the
repository root would then need a Docker daemon and a five-service stack to pass. It is
also not a module: it ships nothing, so it carries no `Dockerfile`, and
`docs/CONVENTIONS.md` § 1 lists it beside `scripts/` as repo-level tooling rather than
among the `ouroboros-*` directories.

## Run

The stack has to be up. `scripts/run.sh` is the one command that does both, and it is what
CI runs, so there is one definition of what running this suite means:

```bash
cd tests/e2e
yarn install
yarn browsers            # once: downloads Chromium and its system libraries

scripts/run.sh           # cold build → up --wait → suite → down
scripts/run.sh --keep    # …and leave the stack up to poke at
scripts/run.sh --no-build   # reuse the images already built
```

Against a stack you already have up — much faster, and what you want while writing a leg:

```bash
docker compose --profile full up --wait -d
cd tests/e2e && yarn e2e
yarn e2e --ui                          # Playwright's watch mode
yarn e2e specs/engine.spec.ts          # one leg
```

From the repository root, `yarn e2e` is the same thing.

### Verifying the suite still asserts something

A green suite cannot tell you whether the system works or whether the tests assert nothing;
the two look identical from outside. The issue's second acceptance criterion is therefore
that **each leg fails when its service is stopped**, and that is a script rather than a
habit:

```bash
scripts/verify-failure-modes.sh --up
```

It stops a service, runs the one leg that depends on it, requires that leg to fail, and
requires the output to *name* the failure — `engine_unavailable`, a `503`,
`internal_error`, `ECONNREFUSED` — because a leg that fails with an unexplained timeout is
a leg somebody will mark flaky and retry. It runs nightly in CI, after the suite, and its
runtime is not charged against the suite's budget.

## Configuration

Everything has the value `docker-compose.yml` publishes, so a clean checkout with no `.env`
works as-is. Override only when the stack is somewhere else.

| Variable | Default | What it is |
|---|---|---|
| `OURO_E2E_UI_URL` | `http://localhost:3000` | Where `ouroboros-ui` answers |
| `OURO_E2E_REST_URL` | `http://localhost:4000` | Where `ouroboros-rest` answers |

There is no address for `ouroboros-engine`, and there cannot be: it publishes no host port
(`docs/ARCHITECTURE.md` § 10). Leg 4 reaches it the only way anything outside the compose
network can, and leg 5 asserts that is still the only way.

### Signing in

The suite signs in the way the login form does: `signIn()` in
[`support/session.ts`](support/session.ts) is one HTTP call to the development
email/password route ([#705](https://github.com/NobuData/ouroboros/issues/705)),
presenting the seeded credential
([#709](https://github.com/NobuData/ouroboros/issues/709)) and putting the session cookie
the service issued into the browser's jar. What a signed-in leg proves is therefore the
real chain — route, hash comparison, session **row**
([#703](https://github.com/NobuData/ouroboros/issues/703)) — and no spec knows how the
cookie got there.

That route only answers because of the one override this suite composes over the stack
(**[#647](https://github.com/NobuData/ouroboros/issues/647)**): the repo-root
`docker-compose.e2e.yml`, which `scripts/run.sh` adds with a second `-f`, runs `rest`
under `NODE_ENV=test` — the single flag the password routes turn on — and sets
`OURO_LISTEN_HOST=0.0.0.0`, the validated override `ouroboros-rest` grew for exactly this
stack, because non-production otherwise binds a loopback interface Docker's port
publishing cannot reach. The override file's header says why that is safe there and
nowhere else; the host ports stay published on `127.0.0.1`. Between #703 and #647 the
signed-in legs were **parked** under `test.fixme` — `support/session.ts` § *The parking,
and what ended it* is that history.

The alternatives were weighed and rejected: reaching into PostgreSQL from here would break
the rule this directory is built on — everything reaches a service over HTTP, enforced by
[`eslint.config.mjs`](eslint.config.mjs) — and the real GitHub handshake needs a human at a
consent screen. `specs/sign-in.spec.ts` still proves the boundary from the outside: a
visitor with no session is sent to the login screen, a cookie naming no session is worth
nothing, and #33's `ouro_session` is neither honoured nor crashed into.

## Layout

```
tests/e2e/
├── playwright.config.ts        # the runner: the 10-minute budget, no retries, no webServer
├── specs/                      # one file per leg
│   └── __screenshots__/        # leg 6's baselines, one per theme — recorded when it runs
├── support/
│   ├── stack.ts                # addresses and timeouts
│   ├── seed.ts                 # the values R__dev_seed.sql writes, copied on purpose
│   ├── dashboard.ts            # what mockup 02 renders against those values (leg 6)
│   ├── shell.ts                # the containment contract as assertions, and its plants (leg 7)
│   ├── session.ts              # signing in — one HTTP call; read the header
│   ├── workspace.ts            # putting a context into a workspace without re-clicking
│   ├── settings.ts             # the font scale and the auto-merge switch, set and put back
│   └── api.ts                  # scripted requests and their failure messages
└── scripts/
    ├── run.sh                  # stack up (with the e2e compose override) → suite → down
    ├── verify-failure-modes.sh # #56 acceptance criterion 2
    └── verify-containment.sh   # #647's spot-verify: planted offences must go red
```

Four things in [`playwright.config.ts`](playwright.config.ts) are decisions rather than
defaults, and each is argued in that file: there is **no `webServer`** (what is under test
is the compose stack, and `docker compose up --wait` is a stronger definition of ready than
a port opening), the ten-minute budget is **enforced** by `globalTimeout` rather than
measured by hand, there are **no retries** (a gate that needs a second attempt is not
reporting on the system, and it is precisely the mechanism by which "each leg fails
meaningfully" quietly stops being true), and screenshot baselines live in **one directory
for the suite** with the platform in each name, because pixels are a platform artefact.

### Screenshot baselines

Leg 6 diffs the dashboard in both palettes. Baselines are Linux's — what CI renders — and
Playwright refuses a comparison it has no baseline for rather than silently recording one,
which is what makes the first run on a new page red instead of green:

```bash
yarn e2e specs/dashboard.spec.ts --update-snapshots   # record, then read the diff before committing
```

The first baselines were recorded by #647, in the change that unparked the leg — a
signed-in dashboard is what recording one needs, and § *Signing in* is how the suite got
one. Both palettes live in `specs/__screenshots__/`, masked where the seeded group's prose
explains.

### Adding a leg

This suite is scheduled to grow. Every mockup roadmap amends a leg into
[#56](https://github.com/NobuData/ouroboros/issues/56) — the dashboard leg in
[#88](https://github.com/NobuData/ouroboros/issues/88) is the first and has landed, issues
follow in [#121](https://github.com/NobuData/ouroboros/issues/121), the studio in
[#154](https://github.com/NobuData/ouroboros/issues/154), and a dozen more — each with a
stated runtime budget of its own. Two rules keep that from becoming a suite nobody can run:

1. **The budget is one number.** `SUITE_BUDGET_MS` in `support/stack.ts` is the total, and
   the runner enforces it. A leg that does not fit is a leg that has to be made cheaper, not
   a number to raise quietly. Leg 6's own stated allowance is **two minutes**, which fits
   inside the ten with room to spare, so the total did not move.
2. **A new leg brings its failure mode.** Add the pair to
   `scripts/verify-failure-modes.sh`. A leg that has never been seen to fail is a leg that
   has never been shown to assert anything.

   A pair whose leg is **parked** is registered anyway and reports itself as parked — not as
   a pass, which would claim it had been shown to fail, and not as a failure, which would
   turn the nightly job red for a decision somebody made on purpose. Leaving it out until
   the leg runs is how a leg ships with no failure mode at all.

## Related issues

- [#56](https://github.com/NobuData/ouroboros/issues/56) — this suite, and the MVP exit gate
- [#55](https://github.com/NobuData/ouroboros/issues/55) — the compose stack it runs against
- [#23](https://github.com/NobuData/ouroboros/issues/23) — the development seed it asserts against
- [#29](https://github.com/NobuData/ouroboros/issues/29) — the two probes leg 5 tells apart
- [#703](https://github.com/NobuData/ouroboros/issues/703) — database-backed sessions, which parked this suite's sign-in
- [#15](https://github.com/NobuData/ouroboros/issues/15) — the icon `<link>` tags leg 1 cannot assert yet
- [#88](https://github.com/NobuData/ouroboros/issues/88) — leg 6, the dashboard, and the mockup 02 roadmap's MVP gate
- [#68](https://github.com/NobuData/ouroboros/issues/68) — the dashboard seed leg 6 asserts against
