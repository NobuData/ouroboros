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
deployment. Five legs from the issue, and three amended in since:

| Leg | Spec | What only this can see |
|---|---|---|
| 1 | [`specs/shell.spec.ts`](specs/shell.spec.ts) | The title, the favicon actually copied into the image, and a palette that flips because the stylesheet shipped |
| 2 | [`specs/sign-in.spec.ts`](specs/sign-in.spec.ts) | A session authenticated by `ouroboros-rest` against rows Flyway seeded, rendered as a workspace |
| 3 | [`specs/tenants.spec.ts`](specs/tenants.spec.ts) | The workspace roundtrip against a real migrated database: the plugin's write (#704) read back through this service's listing (#714) |
| 4 | [`specs/engine.spec.ts`](specs/engine.spec.ts) | The gateway calling the engine over the compose network — and the boundary still being closed |
| 5 | [`specs/health.spec.ts`](specs/health.spec.ts) | Both probes, and the two dependencies readiness names |
| 6 | [`specs/dashboard.spec.ts`](specs/dashboard.spec.ts) | Mockup 02 drawn from the rows Flyway seeded — and the same page telling the truth in a workspace that has none |
| 7 | [`specs/shell-nav.spec.ts`](specs/shell-nav.spec.ts) | The shell's promises on a laid-out page: chrome that holds still under a deep pane scroll, containment nothing escapes, the sidebar's eleven honest entries, the rail and the drawer — in both themes, and the reader's own font-size stepper taken to 150% and back |
| 8 | [`specs/readability.spec.ts`](specs/readability.spec.ts) | Whether the product is still usable at the top of the font-size range: {100%, 125%, 150%} × both palettes × the dense pages, diffed; and the four things at 150% a screenshot review cannot see — pane-level scroll, clipped labels, chrome over chrome, AA contrast |

Leg 7 is [#647](https://github.com/NobuData/ouroboros/issues/647)'s, the shell roadmap's
route-migration gate. Its containment assertions come with their own falsifier:
[`scripts/verify-containment.sh`](scripts/verify-containment.sh) plants a viewport-fixed
element and a pane-level horizontal overflow (`support/shell.ts` grows both) and requires
the leg to go red naming each — the same philosophy as the failure-modes script, applied
to CSS instead of services.

Leg 8 is [#650](https://github.com/NobuData/ouroboros/issues/650)'s, CQ.3 — the readability
bar of `docs/DESIGN_SYSTEM_APP_SHELL.md` § 4, which is a *bar* rather than a promise: *at
150% no clipped labels, no overlapping chrome, tables degrade to horizontal scroll in their
wrappers; screenshot matrix (scale × theme × key pages) in CI*. It is the one leg that does
not run under [`playwright.config.ts`](playwright.config.ts) — see § *The two budgets* — and
it comes with its own falsifier,
[`scripts/verify-readability.sh`](scripts/verify-readability.sh), which plants four offences
and requires the audit to go red naming each. Its own note and
[`support/readability.ts`](support/readability.ts) argue the roster: the issue names five
dense pages, one is built, and the four that are not are asserted **absent** so that the day
one lands this leg says so.

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

**Leg 8 is a separate command**, because it is a separate gate with a separate budget:

```bash
yarn readability                       # the matrix and the 150% audit
yarn readability --grep "the 150% audit"    # the probes only, no screenshots
```

### Verifying the suite still asserts something

A green suite cannot tell you whether the system works or whether the tests assert nothing;
the two look identical from outside. The issue's second acceptance criterion is therefore
that **each leg fails when its service is stopped**, and that is a script rather than a
habit:

```bash
scripts/verify-failure-modes.sh --up
```

Two sibling scripts ask the same question of CSS rather than of services — a green layout
assertion is exactly as uninformative as a green service one:

```bash
scripts/verify-containment.sh          # #647: a viewport-fixed bar, a pane-level overflow
scripts/verify-readability.sh          # #650: overflow, a clipped label, two chrome collisions
```

Each plants an offence, runs the leg that should catch it, and requires the run to go red
with the matching assertion *by name*. The plants live in
[`support/plants.ts`](support/plants.ts), in one table beside the list of which assertion
must catch each, so a rewritten probe that no longer sees its plant fails loudly instead of
passing quietly.

`verify-failure-modes.sh` stops a service, runs the one leg that depends on it, requires that
leg to fail, and requires the output to *name* the failure — `engine_unavailable`, a `503`,
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
├── playwright.readability.config.ts  # leg 8's: its own 3-minute budget, one worker
├── specs/                      # one file per leg
│   └── __screenshots__/        # leg 6's baselines, and leg 8's matrix under readability/
├── support/
│   ├── stack.ts                # addresses, timeouts, and the two budgets
│   ├── seed.ts                 # the values R__dev_seed.sql writes, copied on purpose
│   ├── dashboard.ts            # what mockup 02 renders against those values (leg 6)
│   ├── shell.ts                # the containment contract as assertions (leg 7)
│   ├── readability.ts          # the matrix roster and the 150% probes (leg 8)
│   ├── contrast.ts             # WCAG ratios over what the browser painted (leg 8)
│   ├── settle.ts               # read it twice: why an `evaluate` needs what a screenshot gets free
│   ├── plants.ts               # the offences planted on purpose, and what must catch each
│   ├── theme.ts                # pinning a palette through the control a reader would use
│   ├── session.ts              # signing in — one HTTP call; read the header
│   ├── workspace.ts            # putting a context into a workspace without re-clicking
│   ├── settings.ts             # the font scale and the auto-merge switch, set and put back
│   └── api.ts                  # scripted requests and their failure messages
└── scripts/
    ├── run.sh                  # stack up (with the e2e compose override) → suite → down
    ├── verify-failure-modes.sh # #56 acceptance criterion 2
    ├── verify-containment.sh   # #647's spot-verify: planted offences must go red
    └── verify-readability.sh   # #650's, at 150%: four offences, four probes
```

### The two budgets

There are two gates here and they are timed separately, which is the one place this
directory's *the budget is one number* rule (§ *Adding a leg*) has an exception — argued
in [`playwright.readability.config.ts`](playwright.readability.config.ts) rather than
assumed:

| gate | budget | enforced by | what it answers |
|---|---|---|---|
| the smoke suite, legs 1–7 | 10 minutes | `SUITE_BUDGET_MS` | is the deployment the product? (#56) |
| the readability matrix, leg 8 | 3 minutes | `READABILITY_BUDGET_MS` | is it still usable at 150%? (#650) |

Both are `globalTimeout`s rather than sentences somebody measures. They are separate because
they are separate acceptance criteria owned by separate issues: folded into one number, the
first gate to grow would spend the other's allowance and neither issue's criterion would
still be checked. In CI they are two steps of the same job, sharing one compose stack —
bringing the stack up is the expensive part, and `run.sh --keep` has already paid for it.

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

Leg 8 adds twelve more under `specs/__screenshots__/readability/`, named
`<page>-<scale>-<theme>-chromium-linux.png`. Same rules, one more axis.

#### Refreshing them

A baseline nobody can refresh becomes a suite somebody disables, so the procedure is written
down rather than remembered. It has one precondition and it is the one that actually catches
people out.

**The seed must be fresh.** `R__dev_seed_dashboard.sql` dates its rows relative to `now()`,
so a database volume that has been up for a week has an empty *7 days* window — the stat
tiles read `0`, the pulse card's rates move, and baselines recorded against it are baselines
of a stale fixture that CI, which always starts cold, will never reproduce. Recording begins
by throwing the volume away:

```bash
# 1. A cold stack on a fresh volume — `-v` is the load-bearing flag.
docker compose --profile full down -v --remove-orphans
docker compose -f docker-compose.yml -f docker-compose.e2e.yml --profile full up --build --wait -d

# 2. Record. Delete first: --update-snapshots rewrites what it compares, but it will not
#    notice a baseline whose test no longer exists, and a stale file is invisible forever.
cd tests/e2e
rm -rf specs/__screenshots__/readability
yarn readability --update-snapshots

# 3. Verify, twice. The first run proves the baselines match the pages they came from; the
#    second proves they are stable rather than a lucky frame.
yarn readability
yarn readability

# 4. Read the diff before committing. `git diff --stat` says which images moved; open the
#    ones that did and satisfy yourself the change is the one you made. A screenshot suite
#    is only worth its disk if somebody looks.
git status --short specs/__screenshots__
```

Leg 6's pair refreshes the same way with `yarn e2e specs/dashboard.spec.ts
--update-snapshots` at step 2 — the precondition is the same, and it is the same seed.

**Baselines are Linux's.** A refresh recorded on macOS will be rejected by CI for a reason
that is not a regression; the platform is in every filename so this is visible rather than
mysterious.

This procedure was exercised once when #650 landed, which is how the stale-seed precondition
came to be written down: the first recording of the matrix was made against a week-old
volume and produced a dashboard reading zeroes.

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

   Leg 8 is the exception that proves the rule and is allowed to be one for a stated
   reason: its runtime *is* an acceptance criterion of a different issue, so it has a
   config, a budget and a CI step of its own rather than three minutes of #56's ten (§ *The
   two budgets*). That is the bar for a second number — a leg with its own gate to answer
   for, not a leg that turned out to be slow.
2. **A new leg brings its failure mode.** Add the pair to
   `scripts/verify-failure-modes.sh` — or, for a leg whose subject is CSS rather than a
   service, a plant to `support/plants.ts` and a step to the matching `verify-*.sh`. A leg
   that has never been seen to fail is a leg that has never been shown to assert anything.

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
- [#647](https://github.com/NobuData/ouroboros/issues/647) — leg 7, the shell's containment, and the compose override that unparked sign-in
- [#650](https://github.com/NobuData/ouroboros/issues/650) — leg 8, the readability matrix and the 150% audit
- [#649](https://github.com/NobuData/ouroboros/issues/649) — the font-size preference legs 7 and 8 drive
