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
deployment. Five legs, from the issue:

| Leg | Spec | What only this can see |
|---|---|---|
| 1 | [`specs/shell.spec.ts`](specs/shell.spec.ts) | The title, the favicon actually copied into the image, and a palette that flips because the stylesheet shipped |
| 2 | [`specs/sign-in.spec.ts`](specs/sign-in.spec.ts) | A session authenticated by `ouroboros-rest` against rows Flyway seeded, rendered as a workspace |
| 3 | [`specs/tenants.spec.ts`](specs/tenants.spec.ts) | The API contract against a real migrated database, including the constraints |
| 4 | [`specs/engine.spec.ts`](specs/engine.spec.ts) | The gateway calling the engine over the compose network — and the boundary still being closed |
| 5 | [`specs/health.spec.ts`](specs/health.spec.ts) | Both probes, and the two dependencies readiness names |

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
| `OURO_SESSION_SECRET` | `dev-session-secret-change-me` | The key the stack signs sessions with — the suite mints one with it |

There is no address for `ouroboros-engine`, and there cannot be: it publishes no host port
(`docs/ARCHITECTURE.md` § 10). Leg 4 reaches it the only way anything outside the compose
network can, and leg 5 asserts that is still the only way.

### How the suite signs in, and why that is not a bypass

Worth reading before changing anything in [`support/session.ts`](support/session.ts), which
carries the long version.

The issue describes leg 2 as a *dev-auth login*. The compose stack will not serve one: the
`ouroboros-rest` image pins `NODE_ENV=production`, and production is where
`loadConfiguration` deletes `OURO_AUTH_DEV_USER` before the schema sees it — by design
([#33](https://github.com/NobuData/ouroboros/issues/33)), and documented in the root
`README.md` § Signing in. It cannot be switched off from outside either, because
`listenHost()` reads the same variable: a container told `NODE_ENV=development` binds
loopback *inside itself* and the published port goes dead. And the real GitHub handshake is
a human consenting on github.com, which a nightly job cannot do.

So the suite mints a session cookie using `ouroboros-rest`'s **own** `issueSession`, signed
with the same `OURO_SESSION_SECRET` the container holds. Every check then runs unchanged:
the guard verifies the HMAC in constant time, refuses a token past its maximum age, and
reads the user row from the database before authorising anything. Nothing is stubbed, and
the product is byte-for-byte the image that ships — turning this suite off changes nothing
about it. `specs/sign-in.spec.ts` opens by proving a forged and an expired session are both
refused, which is what stops a self-minted credential from passing against a service that
had stopped checking credentials.

`support/session.ts` is the only file here permitted to import from a module's source, and
[`eslint.config.mjs`](eslint.config.mjs) enforces it: everything else reaches a service over
HTTP, which is what makes this an end-to-end suite rather than a slow unit test.

**When BetterAuth lands** — `docs/ROADMAP_OOE_MVP.md` amends this issue to require the real
flow, blocked on `D.5`, one of the 22 issues that roadmap flags as not yet filed — the
change is one function. No spec knows how the cookie got there.

## Layout

```
tests/e2e/
├── playwright.config.ts        # the runner: the 10-minute budget, no retries, no webServer
├── specs/                      # one file per leg
├── support/
│   ├── stack.ts                # addresses and timeouts
│   ├── seed.ts                 # the values R__dev_seed.sql writes, copied on purpose
│   ├── session.ts              # minting a session — read the header
│   ├── workspace.ts            # putting a context into a workspace without re-clicking
│   └── api.ts                  # scripted requests and their failure messages
└── scripts/
    ├── run.sh                  # stack up → suite → down
    └── verify-failure-modes.sh # acceptance criterion 2
```

Three things in [`playwright.config.ts`](playwright.config.ts) are decisions rather than
defaults, and each is argued in that file: there is **no `webServer`** (what is under test
is the compose stack, and `docker compose up --wait` is a stronger definition of ready than
a port opening), the ten-minute budget is **enforced** by `globalTimeout` rather than
measured by hand, and there are **no retries** (a gate that needs a second attempt is not
reporting on the system, and it is precisely the mechanism by which "each leg fails
meaningfully" quietly stops being true).

### Adding a leg

This suite is scheduled to grow. Every mockup roadmap amends a leg into
[#56](https://github.com/NobuData/ouroboros/issues/56) — the dashboard leg in
[#88](https://github.com/NobuData/ouroboros/issues/88), issues in
[#121](https://github.com/NobuData/ouroboros/issues/121), the studio in
[#154](https://github.com/NobuData/ouroboros/issues/154), and a dozen more — each with a
stated runtime budget of its own. Two rules keep that from becoming a suite nobody can run:

1. **The budget is one number.** `SUITE_BUDGET_MS` in `support/stack.ts` is the total, and
   the runner enforces it. A leg that does not fit is a leg that has to be made cheaper, not
   a number to raise quietly.
2. **A new leg brings its failure mode.** Add the pair to
   `scripts/verify-failure-modes.sh`. A leg that has never been seen to fail is a leg that
   has never been shown to assert anything.

## Related issues

- [#56](https://github.com/NobuData/ouroboros/issues/56) — this suite, and the MVP exit gate
- [#55](https://github.com/NobuData/ouroboros/issues/55) — the compose stack it runs against
- [#23](https://github.com/NobuData/ouroboros/issues/23) — the development seed it asserts against
- [#29](https://github.com/NobuData/ouroboros/issues/29) — the two probes leg 5 tells apart
- [#33](https://github.com/NobuData/ouroboros/issues/33) — the session, and the bypass this suite does not use
- [#15](https://github.com/NobuData/ouroboros/issues/15) — the icon `<link>` tags leg 1 cannot assert yet
