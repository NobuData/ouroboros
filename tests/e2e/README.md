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
deployment. Five legs from the issue, and ten amended in since:

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
| 9 | [`specs/routing.spec.ts`](specs/routing.spec.ts) | Mockup 06 against four seeded tables and the resolution engine: a chain reordered, saved and re-read; a rule switched off changing what the simulator answers; a floor turning a degradable run into a designed failure; and a member served the page read-only |
| 10 | [`specs/providers.spec.ts`](specs/providers.spec.ts) | Mockup 07's credential lifecycle across four layers: a key the provider refuses connecting **no** card; a rotation that failed leaving the old key *still working*, proved by testing it; a reveal shown, recorded and masked again; a pull whose progress survives a reload; and a provider that really goes away |
| 11 | [`specs/issues.spec.ts`](specs/issues.spec.ts) | Mockup 03 against the intake seed: a selection refused by name and then queued, with the *dashboard page* moving by exactly one row's worth; a press of **Re-estimate** that really goes through the engine and comes back as a new version the panel draws without a reload; the filter bar's address reloaded into the identical view; and the personal workspace's guidance |
| 12 | [`specs/studio.spec.ts`](specs/studio.spec.ts) | Mockup 04's canvas as a browser draws it: the five node treatments printing the chips the seeded document's configs become, the octagonal flow nodes and the mini pill, the ouroboros edge dashed and glowing in each palette's own accent-deep, and the `.sel` ring — with the canvas diffed in both palettes; S.6's dry run of `#485`, painting the mockup's active path in the accent in both palettes and clearing on the first edit; and S.8's authoring loop — the rail and *Implement*'s inspector at parity, a chip that moves only on **Apply** and survives a reload, a sabotaged draft refused at **Publish** by *its* finding on *Code the change*, repaired in the inspector and published as the next version, a member served no **Publish** and the service's `403`, and the shell at 125% |
| 13 | [`specs/code-editor.spec.ts`](specs/code-editor.spec.ts) | Mockup 05's editor as a browser draws it: the seeded file in CodeMirror with every syntax colour, the current line and the glow caret on each palette's own token and none of CodeMirror's defaults; a member served the read-only variant; a long line scrolling the editor and not the pane; keystrokes that cost a fraction of a frame — with the editor diffed in both palettes; and V.8's cross-editor round-trip — the file at parity with U.1's golden listing, a token budget typed in code that *Implement*'s inspector shows and a stage nudged on the canvas that the file's layout block moves, in one test; an unknown alias typed in code refused at **Publish** by its finding, marked back on *Implement*'s lines, repaired and published as the next version in both editors; a member served no **Publish** and the service's `403`; the workbench diffed in both palettes; and the shell at 125% |
| 14 | [`specs/registry.spec.ts`](specs/registry.spec.ts) | Mockup 21's promises composed: an alias created, tuned and **rebound in the inspector, with the routing matrix on another page redrawing its resolution line**; a delete refused by the service's `409` to a page drawn before the route existed; an import landing a row; an orphan's **Fix in Providers →**; a switch-off that drops a hop in the next simulation; a raw model id refused at **Publish**; and a member served every control inert — with the page diffed in both palettes |
| 15 | [`specs/planning.spec.ts`](specs/planning.spec.ts) | Mockup 09's four cards and its gantt against the planning seed, in both palettes — and the longest chain in the product, in one traversal: an outline planned by the engine into sized drafts, one deselected, pushed to a **sandbox tracker** with one creation refused mid-batch, the issues *and their native dependencies and epic parent* read back **through the tracker's own API**, ordinary sync adopting each of them as exactly one canonical ticket, a **Resume push** that leaves the tracker holding the intended issues and not one more, and the small ones landing on the **dashboard's** queue card; plus a bar moved and an epic round-tripped, the *Blocked* meter shifting because the push wired real dependencies, and a member who may draft and may not push |

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

Leg 9 is [#206](https://github.com/NobuData/ouroboros/issues/206), the routing roadmap's MVP
gate, and it is the leg with the sharpest single assertion in the directory: **switching an
escalation rule off must change what the simulator answers.** If it does not, the switches on
mockup 06 are decoration and escalation is not a feature — and nothing else in the repository
can see that, because the rules are a table in one service, the switch is a control in
another, and the only place the two meet is a running stack. Around it: seeded parity for the
five surfaces the page draws, where three of the figures are *computed* (`$0.87` is an average
over fifteen ledger rows, `41.0s` a median, `31%` a ratio — decision **M7**, which forbids
storing any of them); a chain reordered, committed with **Save routes** and re-read, with the
matrix's resolution lines redrawn from what the server now holds; a floor switched on over a
route whose primary is genuinely unreachable, so the run **stops and says so** as a designed
outcome rather than an error; and the same page served to `jorge@acme-robotics.dev`, a
`member` — a session, not a fixture. It also walks AA.6's guidance path in the personal
workspace, which carries no connection, no alias, no task kind and no usage row, so the page's
zero states are a *workspace* rather than a mocked payload. It carries the same shell
assertions leg 6 does and screenshot-diffs both palettes.

Leg 10 is [#233](https://github.com/NobuData/ouroboros/issues/233), the providers roadmap's
MVP gate, and its sharpest assertion is a **negative** one: **a rotation the provider refused
must leave the old key working.** A rotation is verify-then-retire across four layers — the
browser sends a candidate, the service asks the provider, the vault swaps a ciphertext only if
the provider agreed, and the card has to say which of those happened. Neither side of that
boundary can see the whole of it: `ouroboros-ui` proves the dialog renders a failure,
`ouroboros-rest` proves the vault was not written, and *neither* can prove that what is still
in the vault is a key the provider will accept. This leg rotates to a key the stub refuses and
then presses **Test connection**, which passes only if the stored ciphertext still opens to a
working key.

Around it: seeded parity for five cards and the security strip; the add flow through the
catalog to the adapter's own form, with the negative case that matters (a refused key must
leave **no** card, on the page and after a reload); a reveal shown in place with its countdown
and its audited notice, masked again by the timer and by a navigation; an Ollama pull whose
bar is still moving after a **mid-pull page reload**, which is what makes the progress the
service's record rather than this browser's animation; a cap saved and a warn meter that moves
with it; the audit sheet listing four operations performed in one test; and the same page
served to `jorge@acme-robotics.dev`, a `member`. It carries the same shell assertions leg 6
does and screenshot-diffs both palettes.

It is also the first leg with a **provider** in the stack.
`docker-compose.e2e.yml` grew a fourth service for it —
[`fixtures/provider-stub`](fixtures/provider-stub/server.mjs), a small Node server speaking the
OpenAI-compatible listing route and Ollama's version, tags and NDJSON pull — because a card
only exists if an adapter reached something and it answered. The seeded five keep their
unreachable fixture addresses and are never written to; the leg connects **its own** cards to
the stub and removes them again. It is the one thing in this suite a spec stops and starts
(`support/compose.ts`), which is how *a provider went away* becomes a state transition rather
than a fixture.

It needs one thing from the stack, and the compose override (§ *Signing in*) supplies it:
**the provider health sweep is slowed to a day**. Z.3's sweep really does probe each seeded
connection every sixty seconds and write what it finds back onto the row — and the seeded
connections point at addresses that exist only in the fixture, so about a minute into any
stack the health strip stops being the seed's and becomes a report of five failed probes.
Without that line this leg's parity, its screenshots and even *which model the simulator
resolves to* depend on how long the stack has been up; `docker-compose.e2e.yml` argues it in
full.

Leg 12 is [#149](https://github.com/NobuData/ouroboros/issues/149)'s — S.3, the workflow
studio's node and edge components — and the studio's first leg, which S.8
([#154](https://github.com/NobuData/ouroboros/issues/154)) extends. Its subject is the one
thing `ouroboros-ui`'s suites cannot see about mockup 04's visual language: a pixel. Every
decision behind the canvas is unit-tested — which treatment a stage takes, what chips its
config becomes, what tone a label's condition gives it — but jsdom applies no stylesheet, so
this leg asks a browser for what only a browser computes: the flow nodes' octagonal clip-path,
the mini pill's 176 × 44, the ouroboros edge's dash, glow and `--accent-deep` in each palette,
and the selection's two-part glow. It screenshot-diffs the canvas region with *Implement*
selected in both palettes.

S.8 ([#154](https://github.com/NobuData/ouroboros/issues/154)), the workflow studio roadmap's MVP
gate, extends the leg with the authoring loop, which spans the browser, `ouroboros-rest`, the engine
and the database. Its sharpest assertion is the publish gate's: **a draft sabotaged with an alias the
registry does not hold must be refused with that finding, anchored to *Code the change*** — not
merely refused — and the finding must take the reader to the stage, where the inspector repairs it
and the next publish takes, moving the version by exactly one. Around it: the rail's five entries and
*Implement*'s inspector at parity (the model pill is an inherited route's answer); a skill typed in
that moves no chip until **Apply**, moves it after, and survives a reload; the seeded member served
the read-only note, no **Publish**, inert controls carrying their reasons, and the service's own
`403`; and the shell's fixed chrome, lit entries and 125% font scale. It writes `standard-fix`'s
draft and restores it in teardown. **The publish is append-only**, unlike every other write here, and
needs no undoing: the version it freezes is the seeded document, and the leg reads the version number
off the head rather than writing it down — so, unlike leg 11, a second run against the same volume
is green. `verify-failure-modes.sh` registers an `engine` pair for it beside the `db` one.

Leg 13 is [#170](https://github.com/NobuData/ouroboros/issues/170)'s — V.2, the code view's
CodeMirror editor — and the code view's first leg, which V.8
([#176](https://github.com/NobuData/ouroboros/issues/176)) extends. `ouroboros-ui`'s suites prove
which of CodeMirror's parts each variant mounts and that the sheet re-colours every rule of the
library's base theme on a token; this leg asks the browser whether it does. In each palette it
reads the five syntax colours, the gutter, the current line with its accent-deep inset and the
glow caret against `support/code.ts`, and requires that neither CodeMirror's default gutter nor its
default caret is what the browser computed. It opens the file as the seeded member and finds the
read-only variant with nothing to type into; types a 500-character line and finds the editor
scrolling sideways and the pane not; types two hundred keystrokes and finds no key handler that
took a frame; and screenshot-diffs the editor, caret on line 3, in both palettes. Those cases write
nothing.

V.8 ([#176](https://github.com/NobuData/ouroboros/issues/176)), the workflow-as-code roadmap's MVP
gate, extends the leg with the page's central claim — *every graph compiles to this typed DSL and
back, losslessly* — which spans the browser, `ouroboros-rest`, the engine and the database. Its
sharpest assertion is the round-trip's, **in both directions in one test**: `tokenBudget: 400_000`
retyped as `500_000` in the file must be the `500k` the canvas's inspector shows after the **Visual**
tab, and *Implement* nudged on that canvas must be the position the file's layout block prints after
the **Code** tab — with the budget still there, so neither editor's write undid the other's. Around it:
the file at parity with U.1's golden fixture, line for line and whitespace for whitespace, under
mockup 05's subline and over a synced status bar; a publish gate proved from code — `coder-maxx`
typed over *Implement*'s route refused with CH.6's finding, the finding's jump putting the cursor on
`llm("implement", {` and the error marked on that stage's lines and not on *Understand & scope*'s, the
line typed back and published, and the version moving by exactly one in the code view, after a
reload, and on the Visual tab; the seeded member served the read-only note, no **Publish**, a file
nobody can type into and the service's `403`; the whole workbench diffed in both palettes, with the
status bar's `vN draft` masked because every green publish moves it; and the shell's fixed chrome,
lit entries and 125% font scale. The whole-file cases run in a 4200px-tall window, because CodeMirror
draws only the lines near its viewport. It writes `standard-fix`'s draft and restores it in teardown;
the publish is append-only and needs no undoing, for S.8's reason. `verify-failure-modes.sh` registers
an `engine` pair for it beside the `db` one. `openPublish` and `expectPublished` moved to
`support/studio.ts` so both editors' legs drive the one dialog the same way.

Leg 14 is [#597](https://github.com/NobuData/ouroboros/issues/597)'s — CI.7, the model registry
roadmap's MVP gate — and its sharpest assertion crosses a page: **an alias rebound in the
registry's inspector must change the resolution line the routing matrix draws on `/models`.** The
line is read before the rebind and after it, so a matrix that stopped re-reading bindings goes red.
Around it: the eight seeded rows, the inspector, the why-card and run #482's chain card at parity
in both palettes; a delete guard proved from both sides — **Remove** inert on a page that knows the
alias is referenced, and the service's `409` answered to a second tab drawn before the route
existed; an import through the head's dropdown; a *bind later* alias whose **Fix in Providers →**
lands on Providers & keys; a switch-off whose confirm names the routes that will lose a hop, and a
simulation on the routing page that drops it; a draft pinning a raw model id refused at
**Publish** with CH.6's finding; the personal workspace's guidance; and the page served to
`jorge@acme-robotics.dev` with every control inert and explained. It writes more than any leg
before it, and puts every write back in teardown: its own aliases by their `e2e-` prefix, the
`docs` route, `local-free`'s switch and `standard-fix`'s draft (`support/registry.ts`).

Leg 15 is [#288](https://github.com/NobuData/ouroboros/issues/288)'s — AM.6, mockup 09's MVP gate
— and it is **the longest chain in the product**. Every other leg here crosses two or three
boundaries; this one crosses six: the browser, `ouroboros-rest`, `ouroboros-engine` twice (the
planner and the estimator), a **tracker**, the canonical sync that reads it back, the intake mirror
that reads it back again, and INTAKE-M.3's queue — which lands on the *dashboard*, a different page
owned by a different roadmap.

Its three sharpest assertions are all about things that are only true of a running deployment.
**Sync-back**: an issue the push service filed is not a special object, so ordinary WF-Q sync has to
walk the tracker and keep it as *the* canonical ticket — one, never a second beside the row the
push already wrote. **Queue-small**: decision N7 says the toggle reuses M.3 rather than adding a
queue path, and the only way to check that is to follow a pushed small ticket onto the dashboard's
queue card. **Resume**: one creation is refused mid-batch, the resume re-runs what failed, and the
tracker must then hold the intended issues and **not one more** — a claim about what was *not*
written. Around them: seeded parity for all four cards and the gantt in both palettes, a bar moved
and an epic round-tripped through its editor, the *Blocked* meter shifting because the push wired
real dependencies, a member who may draft and may not push, and the shell's own promises.

It is also the first leg with a **tracker** in the stack. `docker-compose.e2e.yml` grew a fifth
service for it — [`fixtures/tracker-stub`](fixtures/tracker-stub/server.mjs), a small Node server
holding issues, milestones, `blocked_by` relations and sub-issue links and answering GitHub's
documented shapes — because a push is only real if something created the issues, and neither of the
alternatives works: a tracker nobody may write to cannot be pushed to, and a suite that runs nightly
must not file six issues a night in somebody's repository. `ouroboros-rest` reaches it through the
same provider, the same client and the same rate-limit guard it reaches github.com with; the one
thing the deployment needs is to know where to send the request, which is
`OURO_GITHUB_API_BASE_URL` — a `baseUrl` `github.octokit.ts` has carried for GitHub Enterprise
Server since K.3 and that nothing could reach until this ticket gave it a setting. It is the only
fixture in this directory that **publishes a host port**, because the acceptance criterion is that
the pushed issues are verified *through the tracker API rather than the UI*.

**It is green from a cold volume**, and that is leg 11's position for leg 11's reason: the batch it
generates, the issues it files, the tickets those become and the one queue row have no undo on the
API. What can be put back is put back — the tracker is reset, the workspace's GitHub token is
removed, the lane it moved is moved back and the epic it edited is restored —
and `support/planning.ts` carries the table of what is not and why.

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
| `OURO_E2E_TRACKER_URL` | `http://localhost:4100` | Where the suite's own sandbox tracker answers (leg 15) |

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
nowhere else; the host ports stay published on `127.0.0.1`. It carries one more line since
leg 9 ([#206](https://github.com/NobuData/ouroboros/issues/206)) —
`OURO_PROVIDER_HEALTH_INTERVAL_SECONDS=86400`, which keeps the health sweep from rewriting
the seed in the middle of a suite — and, since leg 10
([#233](https://github.com/NobuData/ouroboros/issues/233)), one more service:
`provider-stub`, the model host that answers so that a provider can actually be connected.
That file argues both in full. Leg 11 ([#121](https://github.com/NobuData/ouroboros/issues/121)) added the fourth
line — `OURO_ESTIMATION_STALE_SECONDS=86400`, which keeps L.3's recovery sweep from
re-sizing the seed's own `estimating…` row ten minutes into a stack; that file argues it
beside the health sweep's. Between #703 and #647 the
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
├── playwright.config.ts        # the runner: the 10-minute budget, no retries, no webServer, one worker
├── playwright.readability.config.ts  # leg 8's: its own 3-minute budget, one worker
├── specs/                      # one file per leg
│   └── __screenshots__/        # legs 6, 9, 10, 11, 12 and 15's baselines, and leg 8's matrix under readability/
├── support/
│   ├── stack.ts                # addresses, timeouts, and the two budgets
│   ├── seed.ts                 # the values R__dev_seed.sql writes, copied on purpose
│   ├── dashboard.ts            # what mockup 02 renders against those values (leg 6)
│   ├── routing.ts              # what mockup 06 renders, and putting a route or a rule back (leg 9)
│   ├── providers.ts            # what mockup 07 renders, the stub's keys, and removing what leg 10 connects
│   ├── issues.ts               # what mockup 03 renders against the intake seed, and what each flow leaves behind (leg 11)
│   ├── studio.ts               # what mockup 04's canvas draws for the seeded standard-fix, stage by stage (leg 12)
│   ├── registry.ts             # what mockup 21 renders, and putting back every alias, route, switch and draft leg 14 writes
│   ├── planning.ts             # what mockup 09 renders, the sandbox tracker as a client, and what leg 15 can put back
│   ├── compose.ts              # stopping and starting the one service a spec may stop (leg 10)
│   ├── shell.ts                # the containment contract as assertions (leg 7)
│   ├── readability.ts          # the matrix roster and the 150% probes (leg 8)
│   ├── contrast.ts             # WCAG ratios over what the browser painted (leg 8)
│   ├── settle.ts               # read it twice: why an `evaluate` needs what a screenshot gets free
│   ├── plants.ts               # the offences planted on purpose, and what must catch each
│   ├── theme.ts                # pinning a palette through the control a reader would use
│   ├── session.ts              # signing in — one HTTP call; read the header
│   ├── workspace.ts            # putting a context into a workspace without re-clicking
│   ├── settings.ts             # the font scale and the auto-merge switch, set and put back
│   ├── rest.ts                 # a write on a context's behalf, and a restore that never throws
│   └── api.ts                  # scripted requests and their failure messages
├── fixtures/
│   ├── provider-stub/          # the provider leg 10 connects to, and really stops
│   └── tracker-stub/           # the sandbox tracker leg 15 pushes to, and reads back
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
| the smoke suite, every leg but 8 | 10 minutes | `SUITE_BUDGET_MS` | is the deployment the product? (#56) |
| the readability matrix, leg 8 | 3 minutes | `READABILITY_BUDGET_MS` | is it still usable at 150%? (#650) |

Both are `globalTimeout`s rather than sentences somebody measures. They are separate because
they are separate acceptance criteria owned by separate issues: folded into one number, the
first gate to grow would spend the other's allowance and neither issue's criterion would
still be checked. In CI they are two steps of the same job, sharing one compose stack —
bringing the stack up is the expensive part, and `run.sh --keep` has already paid for it.

Five things in [`playwright.config.ts`](playwright.config.ts) are decisions rather than
defaults, and each is argued in that file: there is **no `webServer`** (what is under test
is the compose stack, and `docker compose up --wait` is a stronger definition of ready than
a port opening), the ten-minute budget is **enforced** by `globalTimeout` rather than
measured by hand, there are **no retries** (a gate that needs a second attempt is not
reporting on the system, and it is precisely the mechanism by which "each leg fails
meaningfully" quietly stops being true), there is **one worker**, and screenshot baselines
live in **one directory for the suite** with the platform in each name, because pixels are a
platform artefact.

The single worker is [#206](https://github.com/NobuData/ouroboros/issues/206)'s, and it is
the one of the five that changed. Every browser leg signs the **same seeded owner** into the
**same seeded workspace**, and three of them now write the reader's font scale — a row keyed
on the person. Run side by side they photograph each other's preference, which reads as flake
rather than as the ordering nobody declared: about one run in four went red, on a different
test each time. The same is true of every other row a leg arranges — the auto-merge switch, a
route's chain, an escalation rule — and the suite is scheduled to gain a dozen more legs that
will each want to arrange them. Forty seconds serial against twelve parallel, inside a
ten-minute budget, is the whole of the cost.

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

Legs 9, 10 and 11 add pairs, taken through a **larger window** than the suite's Desktop
Chrome: `PARITY_WINDOW` in [`specs/routing.spec.ts`](specs/routing.spec.ts) is 1920 × 2200,
[`specs/providers.spec.ts`](specs/providers.spec.ts)'s is 1920 × 1800 and
[`specs/issues.spec.ts`](specs/issues.spec.ts)'s is 1920 × 1700 — two pairs there, the seeded
backlog with `#485` checked and open, and the personal workspace's guidance —
and the routing file says why. The short version is that the shell's pane is the only scroll
container, so an element screenshot of a `<main>` taller than the viewport cannot reveal what
is below the fold — it records the tail as bare ground, which is how the first recording of
this pair lost two of the five cards it was meant to be comparing. Giving the window the
page's own height makes the pane not scroll, and the leg asserts that it does not, so a page
that outgrows the window turns red rather than being quietly cropped.

Leg 12's pair is of the **canvas region alone** rather than the page —
`studio-canvas-{light,dark}` in [`specs/studio.spec.ts`](specs/studio.spec.ts), through a
1920 × 1400 window the leg asserts the canvas fits whole. The studio's head says *Last edited 2h
ago*, measured from a draft stamp that moves with the clock, and the canvas is what #149's
parity criterion is about. The pair draws **no accent path**: the mockup's four accent edges are
an execution path, and nothing on the page draws one until S.6's dry run
([#152](https://github.com/NobuData/ouroboros/issues/152)), which re-records the pair. S.5
([#151](https://github.com/NobuData/ouroboros/issues/151)) last re-recorded it, with the toolbar's editing
controls (**Undo**, **Redo**, a live **Add stage ▾**), the mockup's whole hint, and the narrower canvas
S.4's inspector track leaves (#150 had not re-recorded it). A selected stage shows no connection dots,
because they appear only under the pointer, so *Implement* still wears the mockup's `.sel` picture.

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

Legs 6, 9, 10, 11, 12, 13, 14 and 15's pairs refresh the same way with `yarn e2e specs/dashboard.spec.ts
--update-snapshots` — or `specs/routing.spec.ts`, `specs/providers.spec.ts`,
`specs/issues.spec.ts`, `specs/studio.spec.ts`, `specs/code-editor.spec.ts`,
`specs/registry.spec.ts` or `specs/planning.spec.ts` — at step 2. The precondition is the same,
and it is the same seed.

**Leg 15's pair has one more precondition, and it is the same volume rule its whole file lives
under.** The parity group asserts the seeded OTA batch *before* it has been pushed, so the pair
must be recorded on a volume the chain has not yet run against — which is to say, immediately
after step 1 above. Recording it on a stack that has already run the suite photographs a batch
somebody has pushed.

**Leg 11 makes the fresh volume a precondition of a green run, not only of a recording.**
Two of its writes have no undo on the API — the queue row it creates (`GET /api/v1/queue`
is deliberately read-only) and the estimate version it produces (versions are append-only)
— and the tenants leg's rule applies: the leg does not pretend to clean up. The version is
made harmless by choice of issue (`support/issues.ts` § re-estimate: the rule engine
reproduces `#487`'s seeded row, so the table's parity survives it); the queue row cannot be.
A second run against the same volume finds `#484` already queued and the dashboard's
*Queued issues* at thirteen, and both that leg and leg 6 are red at parity **by design**
until `docker compose down -v`. `scripts/run.sh` keeps the volume on purpose (its header
says why), so a developer re-running it starts with step 1 above; CI always starts cold.

Leg 10's pair masks one thing, and it is worth knowing why before re-recording: each card's
meta row ends in a **relative** time. `R__dev_seed_providers.sql` writes `last_used_at` as
`now() - interval`, and that `now()` is *migration* time — so the same card reads *last used
3m ago* on a stack that has just come up and *1h 13m ago* an hour later. The row is masked
rather than the clock pinned; its stable half, `Added by Ken Suenobu · 2026-06-12`, is
asserted as text elsewhere in the leg.

Leg 6's pair has **one more precondition, and it is a clock.**
`R__dev_seed_dashboard.sql` dates its merged runs relative to `now()`, and the page head's
second sentence counts what merged *since midnight UTC* — so a stack seeded in the first
three quarters of an hour after UTC midnight has nothing to count, the sentence collapses
from two lines to one, and every card below it moves up twenty-odd pixels. That seed's own
header says as much: *a stack brought up at 00:05 has no morning to have merged six things
in*. It is not a regression and it is not something to re-record over — record and verify
outside that window, as CI's 03:17 schedule always does.

**Baselines are Linux's.** A refresh recorded on macOS will be rejected by CI for a reason
that is not a regression; the platform is in every filename so this is visible rather than
mysterious.

This procedure was exercised once when #650 landed, which is how the stale-seed precondition
came to be written down: the first recording of the matrix was made against a week-old
volume and produced a dashboard reading zeroes.

### Adding a leg

This suite is scheduled to grow. Every mockup roadmap amends a leg into
[#56](https://github.com/NobuData/ouroboros/issues/56) — the dashboard leg in
[#88](https://github.com/NobuData/ouroboros/issues/88) was the first, the issues leg in
[#121](https://github.com/NobuData/ouroboros/issues/121), the studio's in
[#149](https://github.com/NobuData/ouroboros/issues/149) the latest (S.8,
[#154](https://github.com/NobuData/ouroboros/issues/154), extends it), and a dozen more — each with a
stated runtime budget of its own. Two rules keep that from becoming a suite nobody can run:

1. **The budget is one number.** `SUITE_BUDGET_MS` in `support/stack.ts` is the total, and
   the runner enforces it. A leg that does not fit is a leg that has to be made cheaper, not
   a number to raise quietly. Leg 6's own stated allowance is **two minutes**, which fits
   inside the ten with room to spare, so the total did not move.

   Leg 15's stated allowance is **three minutes** — the largest of any leg, because it is the
   only one that waits on the engine twice and on two sync cycles. `SUITE_BUDGET_MS` did not
   move for it either, and that is the rule rather than an observation: if the total overruns
   once this leg is in, the leg is what has to become cheaper. Its chain is a single `slow()`
   test, which raises that test's own timeout and leaves the suite's number alone.

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
- [#206](https://github.com/NobuData/ouroboros/issues/206) — leg 9, routing, and the mockup 06 roadmap's MVP gate
- [#192](https://github.com/NobuData/ouroboros/issues/192) — the routing seed leg 9 asserts against
- [#196](https://github.com/NobuData/ouroboros/issues/196) — the provider health sweep leg 9 asks the stack to slow down
- [#233](https://github.com/NobuData/ouroboros/issues/233) — leg 10, providers, and the mockup 07 roadmap's MVP gate
- [#221](https://github.com/NobuData/ouroboros/issues/221) — the providers seed leg 10 asserts against
- [#223](https://github.com/NobuData/ouroboros/issues/223) — the credential lifecycle leg 10 certifies end to end
- [#121](https://github.com/NobuData/ouroboros/issues/121) — leg 11, issues, and the mockup 03 roadmap's MVP gate
- [#103](https://github.com/NobuData/ouroboros/issues/103) — the intake seed leg 11 asserts against
- [#112](https://github.com/NobuData/ouroboros/issues/112) — the queue write leg 11 follows onto the dashboard
- [#108](https://github.com/NobuData/ouroboros/issues/108) — the re-estimation leg 11 drives through the engine
- [#107](https://github.com/NobuData/ouroboros/issues/107) — the recovery sweep leg 11 asks the stack to hold still
- [#149](https://github.com/NobuData/ouroboros/issues/149) — leg 12, the studio canvas in mockup 04's visual language
- [#154](https://github.com/NobuData/ouroboros/issues/154) — S.8, the studio leg's extension: editing, publish, the dry-run highlight, the member view
- [#597](https://github.com/NobuData/ouroboros/issues/597) — leg 14, the model registry, and the mockup 21 roadmap's MVP gate
- [#582](https://github.com/NobuData/ouroboros/issues/582) — the registry seed leg 14 asserts against
- [#288](https://github.com/NobuData/ouroboros/issues/288) — leg 15, planning, and the mockup 09 roadmap's MVP gate
- [#275](https://github.com/NobuData/ouroboros/issues/275) — the planning seed leg 15 asserts against
- [#279](https://github.com/NobuData/ouroboros/issues/279) — the push service leg 15 drives into the sandbox tracker
- [#280](https://github.com/NobuData/ouroboros/issues/280) — the planning API the chain is pressed through
- [#112](https://github.com/NobuData/ouroboros/issues/112) — the queue write leg 15's small tickets land in, again
