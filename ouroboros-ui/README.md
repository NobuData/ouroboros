# ouroboros-ui

> **Status:** scaffolded ([#39](https://github.com/NobuData/ouroboros/issues/39), epic
> [#5](https://github.com/NobuData/ouroboros/issues/5)), rendering from the design tokens
> ([#40](https://github.com/NobuData/ouroboros/issues/40)), switching themes at runtime
> ([#17](https://github.com/NobuData/ouroboros/issues/17)) from a
> [visible control in the header](#theming)
> ([#42](https://github.com/NobuData/ouroboros/issues/42)), wrapped in the
> [app shell](#app-shell) ([#41](https://github.com/NobuData/ouroboros/issues/41)),
> holding a [typed API client](#the-generated-client) generated from the REST contract
> ([#43](https://github.com/NobuData/ouroboros/issues/43)), serving
> [sign-in and workspace selection](#sign-in--tenancy)
> ([#44](https://github.com/NobuData/ouroboros/issues/44)) over
> [BetterAuth's own client](#the-two-client-rule)
> ([#716](https://github.com/NobuData/ouroboros/issues/716)) and, behind it, the
> [dashboard](#dashboard) ([#45](https://github.com/NobuData/ouroboros/issues/45)), both
> built from the [UI primitives](#ui-primitives)
> ([#46](https://github.com/NobuData/ouroboros/issues/46)) and, beside it,
> [issue intake](#issue-intake) ([#115](https://github.com/NobuData/ouroboros/issues/115)),
> [model routing](#model-routing) ([#200](https://github.com/NobuData/ouroboros/issues/200)),
> [providers & keys](#providers--keys) ([#227](https://github.com/NobuData/ouroboros/issues/227))
> with its [provider cards](#the-provider-cards)
> ([#228](https://github.com/NobuData/ouroboros/issues/228)) and
> [add-provider flow](#the-add-provider-flow)
> ([#231](https://github.com/NobuData/ouroboros/issues/231))
> and the [credential audit trail](#the-credential-audit-trail)
> ([#225](https://github.com/NobuData/ouroboros/issues/225)), under Settings,
> [ticket sources](#ticket-sources) ([#141](https://github.com/NobuData/ouroboros/issues/141)),
> and the [workflow studio](#workflow-studio)
> ([#147](https://github.com/NobuData/ouroboros/issues/147)) with its
> [React Flow canvas](#the-canvas-is-react-flow-and-that-is-a-recorded-exception)
> ([#148](https://github.com/NobuData/ouroboros/issues/148)) and its code view's
> [CodeMirror editor](#the-editor-is-codemirror-6-and-that-is-a-recorded-exception)
> ([#170](https://github.com/NobuData/ouroboros/issues/170)) —
> `yarn dev` runs, `ci/ui` is live, and it [ships as a container](#container)
> ([#47](https://github.com/NobuData/ouroboros/issues/47)). The scaffold's placeholder
> page is gone: `/` redirects to `/dashboard`, and every screen the sidebar names beyond
> the six that are built — the dashboard, Issues, Workflows, Models, Planning
> ([#283](https://github.com/NobuData/ouroboros/issues/283), with its
> [generator card](#the-generator-card) from [#284](https://github.com/NobuData/ouroboros/issues/284))
> and Settings — is
> labelled *soon* rather than linked.

## Purpose

The **product UI** — the application users sign into, distinct from the marketing site
in [`../ouroboros-web`](../ouroboros-web). It renders the screens designed in
[`../docs/mockups`](../docs/mockups) against the app shell specified in
[`../docs/DESIGN_SYSTEM_APP_SHELL.md`](../docs/DESIGN_SYSTEM_APP_SHELL.md), with
on-the-fly light/dark theme switching.

This module talks to **`ouroboros-rest` only**. It never reaches the database or the
engine directly — that boundary is what keeps tenancy enforcement in one place.

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router), React 19 |
| Language | TypeScript 5, `strict` |
| Package manager | Yarn 4 via corepack (`nodeLinker: node-modules`) |
| Runtime | Node 24 |
| API client | `openapi-typescript` (types) + `openapi-fetch` (calls), generated from `ouroboros-rest/openapi.json` — see [The generated client](#the-generated-client) |
| Auth client | `better-auth` with the organization plugin, for `/api/auth/*` only — see [The two-client rule](#the-two-client-rule) |
| Styling | CSS custom properties (design tokens) over plain global sheets — no CSS-in-JS, no component framework; the shared set is [`app/ui/`](#ui-primitives). Two documented exceptions: the workflow canvas is [React Flow](#the-canvas-is-react-flow-and-that-is-a-recorded-exception) (decision P2, [#148](https://github.com/NobuData/ouroboros/issues/148)) and the code editor is [CodeMirror 6](#the-editor-is-codemirror-6-and-that-is-a-recorded-exception) (decision C1, [#170](https://github.com/NobuData/ouroboros/issues/170)), both themed entirely from the tokens |
| Fonts | Chakra Petch (display), IBM Plex Sans (UI), IBM Plex Mono (data) via `next/font` |
| Tests | Vitest + Testing Library |
| Lint | ESLint flat config, plus stylelint on `app/**/*.css` — the px type ban (#648) that keeps every sheet scalable by the font-size preference |
| Container | Multi-stage Dockerfile on `node:24-alpine`, Next.js standalone output — see [Container](#container) |

## Run

```bash
yarn install    # immutable install from the committed lockfile
yarn dev        # http://localhost:3000
yarn lint
yarn typecheck
yarn test
yarn build && yarn start

yarn api:sync   # regenerate the API client from ouroboros-rest/openapi.json
yarn api:check  # …or just report that it has drifted (what the suite runs)
```

`lint`, `typecheck`, `test` and `build` are what `ci/ui` runs on every pull request
touching this directory — see [conventions](../docs/CONVENTIONS.md#9-ci).

All of them work from here, which is how CI runs them, but this module is a **Yarn
workspace**: the lockfile it installs from, the Yarn version it is pinned to and the
`nodeLinker` setting all live at the repository root, and Yarn finds them from inside
this directory. `yarn install` here therefore installs every workspace, not only this
one.

`yarn dev` from the repo root starts this UI alongside `ouroboros-rest`,
`ouroboros-engine` and a migrated database rather than on its own — which is what you
want the moment anything here calls the API
([conventions § 1](../docs/CONVENTIONS.md#1-repository-shape)).

## Configuration

Development default port: **3000** (`PORT`).

| Variable | Purpose |
|---|---|
| `PORT` | HTTP listen port (unprefixed by convention — see [conventions](../docs/CONVENTIONS.md)) |
| `OURO_REST_URL` | Base URL of `ouroboros-rest`, e.g. `http://localhost:4000` |

Copy [`.env.example`](.env.example) — **this module's**, not the repo-root one — and never
commit a populated `.env`:

```bash
cp ouroboros-ui/.env.example ouroboros-ui/.env
```

The other services read the repo-root `.env` and then their own
([conventions § 4](../docs/CONVENTIONS.md#4-configuration--environment-variables)); this
one reads neither by itself, because Next.js does the loading and loads `.env` files from
the project directory only. `PORT` is the exception in the other direction: the `next` CLI
resolves the listen port before it loads that file, so pass it on the command line
(`PORT=3001 yarn dev`) rather than setting it there.

[`app/env.ts`](app/env.ts) reads and validates `OURO_REST_URL` — absolute, `http`/`https`,
trailing slash trimmed — and throws naming the variable when it is not. It is a function
rather than a module constant on purpose: a constant would be evaluated while
`next build` prerenders, failing the build on a machine that has no reason to know the
address of a service it is not calling. [The generated client](#the-generated-client) is its caller,
and calls it lazily for the same reason.

Two pieces of per-browser state belong to this module rather than to configuration: the
[theme choice](#theming), in `localStorage` under `ouro-theme`, and a note that this browser
has been through [step 2](#sign-in--tenancy), in an `HttpOnly` `ouro_tenant` cookie. That
cookie **named the active workspace** until
[#719](https://github.com/NobuData/ouroboros/issues/719); the workspace is
`session."activeOrganizationId"` now, so what is left of it authorizes nothing. The session
cookies are `ouroboros-rest`'s — this module forwards them and never writes them.

**Both clients forward the same pair**, and for a while they did not.
[`app/api/auth-server.ts`](app/api/auth-server.ts) and
[`app/api/client.ts`](app/api/client.ts) each send BetterAuth's `better-auth.session_token`
and `better-auth.session_data` — the second because the service answers a session from that
signed snapshot without a database lookup, so a client that dropped it would turn every call
into a query. The generated client forwarded `ouro_session` until it was re-pointed, which
[#703](https://github.com/NobuData/ouroboros/issues/703) had made wrong — a session is a row
now, and that cookie names nothing. The gap cost a redirect loop, and `client.ts` records the
shape of it: two clients disagreeing about a credential is not a failed request, it is a
screen that renders for somebody the API then refuses.

## Container

[`Dockerfile`](Dockerfile) is the production image
([#47](https://github.com/NobuData/ouroboros/issues/47)) — `deps` → `build` → a runtime
that carries no toolchain, per [conventions § 5](../docs/CONVENTIONS.md#5-containers).
**Build it from the repository root, not from here:**

```bash
docker build -f ouroboros-ui/Dockerfile -t ouroboros-ui .          # from the repo root
docker run --rm -p 3000:3000 -e OURO_REST_URL=http://localhost:4000 ouroboros-ui
```

The context is the root because this module is a Yarn workspace: the lockfile it
installs from, the Yarn version and `nodeLinker` all live there, so a context of
`ouroboros-ui/` could not run an immutable install at all. Two things follow from it,
and both are easy to trip over.

**The ignore file is named for the Dockerfile.** BuildKit reads
`<dockerfile>.dockerignore` in preference to `<context>/.dockerignore`, so
[`Dockerfile.dockerignore`](Dockerfile.dockerignore) is what governs this build — a root
`.dockerignore` would apply to every image in the repo, and an `ouroboros-ui/.dockerignore`
would apply to nothing while looking exactly like the file that does. It is an
**allow-list**: `*`, then the root manifests, the sibling workspace manifests Yarn has to
resolve before it installs anything, and this directory.

**The standalone tree is rooted at the repository.**
[`next.config.ts`](next.config.ts) sets `outputFileTracingRoot` to the repo root, because
`nodeLinker: node-modules` hoists this module's dependencies one level above the default
tracing root — left at the default, the trace copies none of them and the image builds
cleanly and then dies on a missing module. So the output unpacks as `./node_modules` and
`./ouroboros-ui/server.js`, which is the path `CMD` names.

| Property | Value |
|---|---|
| Base image | `node:24-alpine`, every stage |
| User | `nextjs`, created in the runtime stage; nothing runs as root |
| Port | 3000 (`PORT`), bound on `0.0.0.0` (`HOSTNAME`) |
| Healthcheck | BusyBox `wget` against `/` every 30 s, after a 10 s grace |
| Size | 71 MB to pull, 217 MB of layers unpacked — against a 300 MB budget |
| Runtime config | `OURO_REST_URL`, supplied per environment — never baked into a layer |

On Docker's containerd snapshotter `docker images` reports a third number — 288 MB of
*disk usage*, which is those same layers plus the per-file overhead of unpacking some
thousands of small `node_modules` files. Every measure is inside the budget; that is the
largest of the three.

`OURO_REST_URL` is deliberately absent from the image. The standalone server reads it
from the process at request time, so it is `docker run -e` or the compose service that
supplies it; a default in a layer would turn a missing value into a silent call to the
wrong host instead of the error `app/env.ts` raises by name.

[`__tests__/container.test.ts`](__tests__/container.test.ts) asserts every one of these
properties that is decided in the repository — the stages, the pinned base, the non-root
user, the healthcheck, the copied manifests and the allow-list — because `ci/ui` cannot
run a `docker build`. Notably it fails when a new workspace gains a `package.json` and
the `deps` stage has not been taught to copy it, which is exactly the change that would
otherwise break the image from another module's pull request.

The compose service that runs this image is
[#55](https://github.com/NobuData/ouroboros/issues/55); the repo-root
[`docker-compose.yml`](../docker-compose.yml) is the data tier until then.

## Layout

```
ouroboros-ui/
├── app/
│   ├── layout.tsx           # the root layout: fonts, theme bootstrap, provider
│   ├── tokens.css           # the design tokens — a copy of docs/design/tokens.css
│   ├── globals.css          # base element styles, built on those tokens
│   ├── theme.ts             # the theme engine: vocabulary, DOM ops, boot script
│   ├── theme-provider.tsx   # ThemeProvider / useTheme()
│   ├── env.ts               # OURO_REST_URL, read and validated
│   ├── paths.ts             # every route more than one module has to agree about
│   ├── browser.ts           # window and localStorage, read in the way that cannot throw
│   ├── media-query.ts       # useMediaQuery() — asking CSS a question from React
│   ├── format.ts            # relativeAgo(), ageOfSeconds() — the clock-to-words rules
│   ├── catalog-tiles.ts     # a picker's tiles — live entries and honest *coming soon* ones
│   ├── api/                 # the two clients for ouroboros-rest
│   │   ├── schema.d.ts      #   generated from the contract by `yarn api:sync`
│   │   ├── client.ts        #   the wrapper: cookie · X-Ouro-Tenant · ApiError
│   │   ├── auth-client.ts   #   the other family: BetterAuth's client — the browser's
│   │   ├── auth-server.ts   #   …and the server's, plus readSession() / signOutSession()
│   │   ├── errors.ts        #   ApiError, and the envelope it is parsed from
│   │   ├── tenant.ts        #   the workspace-reference vocabulary
│   │   ├── identity.ts      #   Session / SessionUser — framework-free
│   │   ├── membership.ts    #   what a person holds in a workspace — framework-free
│   │   ├── server.ts        #   api() / anonymousApi(), and the step-2 hint
│   │   ├── request.ts       #   where this request was going, as proxy.ts stamped it
│   │   ├── access.ts        #   the gate: currentAccess() / requireWorkspace()
│   │   ├── tenants.ts       #   tenants.list() — step 2's row model, and a session's
│   │   ├── members.ts       #   members.list() — the dashboard's count
│   │   ├── orgs.ts          #   orgs.list() / orgs.setEnabled()
│   │   ├── repos.ts         #   repos.list() / repos.setEnabled()
│   │   ├── enablement.ts    #   the two composed into what one screen reads
│   │   ├── engine.ts        #   engine.status() — GET /engine/status
│   │   ├── health.ts        #   readReadiness() — one of two reads not via the client
│   │   ├── dashboard-summary.ts # …and the other: the aggregate, read conditionally
│   │   ├── reading.ts       #   Reading<T> + attempt() — a read allowed to fail
│   │   ├── routing.ts       #   routing.providers() — the model page's health strip
│   │   ├── audit.ts         #   audit.events() — the credential trail, org-scoped
│   │   ├── sources.ts       #   sources.* — /api/v1/sources, the catalog, test, sync, status
│   │   ├── workflows.ts     #   workflows.list() / read() / create() / saveDraft() / publish() / dryRun()
│   │   ├── planning.ts      #   planning.roadmap() / createEpic() — mockup 09's roadmap head and New roadmap
│   │   ├── farm.ts          #   farm.page() / observe() — mockup 08 in one observation, and its cadence · #256
│   │   │                    #   + enrollCommand() (it mints) / tokens() / revokeToken() / pools() · #258
│   │   ├── farm-page.ts     #   readFarmPage() — the same read, answered for the farm's poll
│   │   ├── farm/route.ts    #   GET /api/farm — that poll, on this origin
│   │   └── dashboard/route.ts   # GET /api/dashboard — the poll, on this origin
│   ├── ui/                  # the UI component primitives — the design system
│   │   ├── ui.css           #   one token-driven sheet, every class prefixed `ou-`
│   │   ├── button.tsx       #   Button — default · primary · ghost · danger
│   │   ├── card.tsx         #   Card + CardHead
│   │   ├── chip.tsx         #   Chip (status · model) + EffortChip
│   │   ├── badge.tsx        #   Tag (metadata) + Badge (a count)
│   │   ├── table.tsx        #   Table, inside its own scroll container
│   │   ├── stat-card.tsx    #   StatCard — caption, figure, the line under it · #81, shared since #256
│   │   ├── field.tsx        #   TextField · TextAreaField · SelectField · Toggle
│   │   ├── schema-form.tsx  #   SchemaFields — a form drawn from a provider's declared fields
│   │   ├── empty-state.tsx  #   EmptyState — a surface that is not ready
│   │   ├── eyebrow.tsx      #   Eyebrow — the caption above a title
│   │   ├── page-subnav.tsx  #   PageSubnav + SubnavSoon — a section's tab row
│   │   ├── sticky-bar.tsx   #   StickyBar — the dirty-state bar, under the subnav
│   │   ├── class-names.ts   #   cx(), the one class-list join
│   │   └── index.ts         #   the barrel: `import { Button } from "@/app/ui"`
│   ├── shell/               # the app shell: header, sidebar, pane, overlay layer
│   │   ├── nav.ts           #   the navigation model — ordering, gating, active route
│   │   ├── nav-registry.ts  #   the registry modules register into, plus badges
│   │   ├── nav-modules.ts   #   the eleven seeded entries, registering at load
│   │   ├── sidebar-state.ts #   the collapse choice and the drawer, plus a boot script
│   │   ├── focus-trap.ts    #   the Tab cycle the overlay and the drawer share
│   │   └── …                #   the components over them
│   ├── login/               # the sign-in & tenancy screen's components
│   ├── dashboard/           # the dashboard's reader, decisions, components, sheet
│   │   ├── summary.ts       #   the polling contract's vocabulary — both sides read it
│   │   ├── summary-poll.ts  #   the loop: 15s · 304-aware · tab-aware · backoff-aware
│   │   ├── summary-store.tsx #  the provider at (app), and useDashboardSummary()
│   │   └── summary-refresh.ts # "ask again now", published by the workspace switch
│   ├── models/              # model routing's reader, decisions, components, sheet
│   │   ├── view.ts          #   the chip treatments, the hover line, the two actions
│   │   ├── data.ts          #   readModels() — the strip, degraded rather than thrown
│   │   ├── provider-strip.tsx #  the `.phealth` strip: one chip per connection
│   │   └── models-screen.tsx  #  the page head, the tab set, and what is not built yet
│   ├── farm/                # mockup 08's head, stat row, runners table and enroll card · #256–#258
│   │   ├── view.ts          #   the computed headline, the four tiles, down-is-good, the head's actions
│   │   ├── data.ts          #   readFarm() — the first paint's read, degraded rather than thrown
│   │   ├── farm-poll.ts     #   the loop's reader and guard — the fleet's own ten-second cadence
│   │   ├── farm-store.tsx   #   the provider at the screen, and useFarm() — one poll, every region
│   │   ├── farm-head.tsx    #   the live h1, two honest soons, and + Enroll runner
│   │   ├── farm-stat-row.tsx #  four shared StatCards, one with a meter
│   │   ├── farm-banner.tsx  #   the DASH-I.7 banner: stale or unread, and the retry
│   │   ├── runners.ts       #   every judgement the runners table makes — pure, flat rows · #257
│   │   ├── runners-card.tsx #   the RUNNERS card: the live table, the grouping, the keyboard
│   │   ├── runner-cells.tsx #   its cells, memoised over primitives — a poll re-renders what moved
│   │   ├── job-sheet.tsx    #   what a current-job cell opens until the run console (#309) exists
│   │   ├── enroll.ts        #   every judgement of the enroll flow — the mask, the TTL, the rows · #258
│   │   ├── enroll-actions.ts #  the Server Actions: mint (masked on the server), list, revoke
│   │   ├── token-data.ts    #   readTokenListing() — the tokens, with pool and member names
│   │   ├── clipboard.ts     #   copyWhenReady() — a write asked for inside the press
│   │   ├── enroll-card.tsx  #   the ENROLL A RUNNER card: Copy command is the mint
│   │   ├── token-list.tsx   #   the token list and the revoke — mounted twice
│   │   ├── token-sheet.tsx  #   …as the sheet Manage tokens → opens
│   │   ├── farm-tokens-screen.tsx # …and as the settings section's Farm tokens tab
│   │   ├── farm-tokens-skeleton.tsx # that tab's loading state
│   │   └── farm-screen.tsx  #   the frame the rest of mockup 08 mounts in
│   ├── planning/            # mockup 09's frame: head, honest actions, the 7 / 5 + 12 grid · #283
│   │   ├── view.ts          #   the verbatim head copy and what each region is headed with
│   │   ├── data.ts          #   readPlanning() — every region's read, degraded rather than thrown
│   │   ├── create.ts        #   New roadmap's judgements: the form, the body, what a refusal says
│   │   ├── create-actions.ts #  the Server Action — one lane create, no workspace to forge
│   │   ├── new-roadmap.tsx  #   the head's primary action and its dialog
│   │   ├── sync.ts          #   the sync card's claims: direction per capability, the cadence · #285
│   │   ├── tracker-sync-card.tsx # the rows, the dots, connect ↗ into #141
│   │   ├── health.ts        #   the health card's meters, hues and nightly footnote · #285
│   │   ├── backlog-health-card.tsx # the three meters and the last-run detail
│   │   ├── states.ts        #   empty, degraded and guarded — what each state says · #287
│   │   ├── planning-banner.tsx #  the DASH-I.7 banner: the reason once, with the retry
│   │   ├── planning-skeleton.tsx # the loading state, at the real grid's geometry
│   │   └── planning-screen.tsx # the page head and the four cards
│   ├── providers/           # mockup 07's Audit log action and the sheet behind it · #225
│   ├── settings/            # the settings section's frame and tab row — mockup 17 · #141
│   │   ├── view.ts          #   the eight tabs, two live (Sources, Farm tokens); the eyebrow
│   │   └── settings-frame.tsx #  the head, the tab row, and the page beneath
│   ├── sources/             # ticket sources — the section's first built tab · #141
│   │   ├── view.ts          #   the status pill, the summary, the sync line, every label
│   │   ├── catalog.ts       #   the kind picker's tiles, and a submission's shape
│   │   ├── data.ts          #   readSources() — the list, the catalog and every status
│   │   ├── actions.ts       #   the Server Actions: add · configure · credentials · test · sync · pause
│   │   ├── add-source.tsx   #   the add-source flow: pick a kind, fill its form, done
│   │   ├── configure-source.tsx # the settings form and the write-only credential form
│   │   └── source-row.tsx   #   one source, its controls, and the honest reason it stopped
│   │   ├── view.ts          #   the four ways a trail lies, and what stops each
│   │   ├── audit-actions.ts #   the Server Action — no arguments, so nothing to forge
│   │   └── audit-trail.tsx  #   <AuditTrail /> — the button and its sheet, mountable
│   ├── workflows/           # the workflow studio's frame — mockup 04 · #147
│   │   ├── view.ts          #   the trigger in words, the subline, the segments, the rail's items
│   │   ├── states.ts        #   the five states, the head and the seat for each, the read-only note
│   │   ├── data.ts          #   readStudio() — the rail, then the workflow the URL names
│   │   ├── create.ts        #   the create dialog's decisions: slug derivation, the live checks
│   │   ├── create-actions.ts #  the Server Action behind + New workflow
│   │   ├── new-workflow.tsx #   the dashed tile and its dialog
│   │   ├── workflow-rail.tsx #  the .wf-list rail: one link per workflow, the err-dot, the tile
│   │   ├── studio-screen.tsx #  the head, the segmented control, the rail and the canvas's seat
│   │   ├── studio-session.tsx #  one open workflow's session: autosave, publish, dry run — #152
│   │   ├── autosave.ts      #   when a draft is written, the save line, draft edits, the conflict's words
│   │   ├── use-autosave.ts  #   the debounced, serial, etag-guarded write
│   │   ├── publish.ts       #   the change note, the findings and the stage each is anchored to
│   │   ├── dry-run.ts       #   the picker's issues, the painted path, the sheet's words
│   │   ├── draft-actions.ts #   the Server Actions: save · publish · dry run · sized issues
│   │   ├── publish-dialog.tsx · dry-run-dialog.tsx · reload-dialog.tsx # the three dialogs
│   │   ├── dry-run-sheet.tsx #  the step sheet, in the inspector's track
│   │   └── canvas/          #   the React Flow canvas — #148 — in mockup 04's visual language #149
│   │       ├── graph.ts     #     the document ⇄ graph projection, and the execution path laid over it
│   │       ├── viewport.ts  #     the zoom ladder, and each reader's place per workflow
│   │       ├── treatment.ts #     each stage's type line, chips and shape; each label's tone and place
│   │       ├── view.ts      #     every word and glyph the canvas prints
│   │       ├── stage-node.tsx #   the five node treatments and the mini pill
│   │       ├── stage-edge.tsx #   plain, loop and active edges, the arrowheads, the label pills
│   │       └── studio-canvas.tsx # the canvas, its toolbar, and highlight mode
│   ├── workshop/            # stories for surfaces whose page has not landed yet
│   ├── (app)/               # signed-in screens — inside the shell
│   └── (auth)/              # signed-out screens — sign-in & tenancy #44
├── __tests__/          # Vitest suites, mirroring app/
├── scripts/            # api-sync.mjs — the generator behind `yarn api:sync`
├── public/             # brand assets, favicons
├── proxy.ts            # forwards /api/auth/* — and stamps every page request's address
├── Dockerfile          # the production image — built from the *repo root*
├── Dockerfile.dockerignore   # …and the context that image is built from
├── eslint.config.mjs   # ESLint flat config
├── stylelint.config.mjs # the px type ban (#648) — yarn lint runs both
├── next.config.ts      # standalone output, traced from the repo root
└── vitest.config.mts   # + vitest.setup.ts
```

`(app)` and `(auth)` are **route groups**: the parentheses are organisational and
contribute nothing to the URL, so the dashboard is `/dashboard`, model routing is
`/models`, the workflow studio is `/workflows` (and `/workflows/<slug>` for one workflow),
ticket sources are `/settings/sources`, the build farm's enrollment tokens are
`/settings/farm-tokens` and sign-in is `/login`.
`/` belongs to no module and is a redirect to the dashboard, kept so that everything
already pointing at it still arrives. `(app)`
renders its screens inside the [app shell](#app-shell); `(auth)` is a pass-through, because
a full-bleed screen would only have to undo any frame added there — see
[Sign-in & tenancy](#sign-in--tenancy).

Tests live in `__tests__/` rather than beside the code they cover, so that no file under
`app/` can ever be mistaken for a route segment. `yarn test` runs them once and exits;
`yarn test:watch` is the interactive form.

## The two-client rule

This module talks to `ouroboros-rest` and to nothing else — but **through two clients, not
one**, and which one a call goes through is decided by the path rather than by preference
([#711](https://github.com/NobuData/ouroboros/issues/711)).

| Family | Paths | Client | Generated? |
|---|---|---|---|
| Auth | `/api/auth/*` — sign-in, session, organizations | [`app/api/auth-client.ts`](app/api/auth-client.ts) | **No — BetterAuth ships its own** |
| Everything else | `/api/v1/*` — tenants, enablement, engine | [`app/api/client.ts`](app/api/client.ts) | Yes, from the contract |

`ouroboros-rest/openapi.yaml` describes both families and says the same thing at the top of
its own description. The split exists because BetterAuth serves its routes itself and ships a
typed client that already knows their bodies, their cookies and their error codes, so **the
auth family is excluded from code generation** — `app/api/schema.d.ts` has no entry for any of
those paths, which is what makes reaching for the wrong client a compile error rather than a
convention.

```ts
import { authApi, readSession } from "@/app/api/auth-server";   // server
import { useSession, signIn } from "@/app/api/auth-client";     // browser
```

That is `createAuthClient({plugins: [organizationClient()]})`
([#716](https://github.com/NobuData/ouroboros/issues/716)), typed against the library's own
route table rather than against interfaces copied out of the contract by hand — which is what
the stand-in it replaced was, and why a renamed field used to surface as `undefined` at render
time instead of as a compile error.

### Two instances, because a browser and a server share nothing a client holds

|  | Browser — [`auth-client.ts`](app/api/auth-client.ts) | Server — [`auth-server.ts`](app/api/auth-server.ts) |
|---|---|---|
| **Address** | this origin, `/api/auth`, forwarded by [`proxy.ts`](proxy.ts) | `OURO_REST_URL`, which the browser must never learn |
| **Cookies** | the browser's own, `credentials: "include"` | `better-auth.session_token` **and** `better-auth.session_data`, composed by hand from the request being served |
| **Entry point** | `better-auth/react` — one session store per tab, refetched on focus, broadcast between tabs | `better-auth/client` — a process that renders one request and forgets it |
| **A `401`** | navigates to `/login?next=…` | Next.js's redirect signal to `/login` |

The second cookie is the signed five-minute snapshot the service answers a session from
without a database lookup; dropping it is a silent cost rather than a failure. What the two
instances *share* is `auth-client.ts` itself — the base path, the cookie names, the `AuthError`
shape and the two translations — because those are what would be wrong in two places if each
kept its own.

**A role is widened on the way in.** The organization plugin's client is typed against the
library's three default roles; `ouroboros-rest` configures a fourth (`viewer`) and the
contract publishes all four. `asRole` is the seam, and it degrades anything unrecognised to
`viewer` — the least the API grants, because a screen that guessed high would render a control
the service then refuses.

### Reading a session

```tsx
// a Server Component, which is what every shipped screen is
const { session, membership } = await requireWorkspace();   // app/api/access.ts

// a Client Component — the account menu (#721) is the case this exists for
"use client";
const { data, isPending } = useSession();
```

Prefer the server helper. `/login` is Server Components with Server Action writes and
[`page.tsx`](<app/(auth)/login/page.tsx>) documents why; the hook is right only where a
component is already a Client Component for some other reason.

**Who is signed in is two calls, and there is no third.**
[`readSession()`](app/api/auth-server.ts) composes `getSession` (the person, and where the
session is acting) with `GET /api/v1/orgs` (every workspace they belong to — roles, counts,
monogram and all). `GET /api/v1/auth/me` used to answer it in one and was deleted in #711:
two routes answering *who is signed in* are two answers that can disagree. **Do not add
another** — if the generated client seems to be missing a session call, that is the rule
working.

It was three calls, and one of them was *per workspace*: `organization.list` returns
organizations without roles, so a role cost a `getActiveMemberRole` each.
[#714](https://github.com/NobuData/ouroboros/issues/714)'s row model carries both, and
[#719](https://github.com/NobuData/ouroboros/issues/719) is what retired the fan-out — which
is also why `Membership` is a generated type again.

### Signing out clears three things

[`signOutSession()`](app/api/auth-server.ts) ends the session **row** on the service, deletes
both auth cookies from the response, and forgets the step-2 hint, then lands on `/login`.
All three are needed and only the first is BetterAuth's: the library's own `Set-Cookie` cannot
reach the browser from a server-side call — the header arrives at this process and stops — and
`ouro_tenant` is this application's own, so nothing else deletes it. The active workspace
goes with the row: the pointer lives *on* it. A session merely forgotten by the browser is a
session a copied cookie still opens. The form that binds a press to it is
[`app/shell/actions.ts`](app/shell/actions.ts) — the `"use server"` wrapper #716
deliberately left unwritten until there was a menu to submit it
([#721](https://github.com/NobuData/ouroboros/issues/721)).

### Where a `401` goes

Both clients route one to [the login screen](#sign-in--tenancy), and both carry `?next=` —
where the request was — which [`page.tsx`](<app/(auth)/login/page.tsx>) honours once the
visitor is settled. The value is never trusted: `safeReturnTo` in
[`app/paths.ts`](app/paths.ts) accepts only a path on this origin, because a link carrying
`?next=https://evil.test` would otherwise hand a freshly signed-in visitor to somebody else's
page.

Where the two differ is only in how they *learn* where they are. The browser reads
`window.location`; a Server Component cannot read the URL it is rendering for at all, so
[`proxy.ts`](proxy.ts) stamps it on a request header and
[`app/api/request.ts`](app/api/request.ts) reads it back
([#720](https://github.com/NobuData/ouroboros/issues/720)). One call —
`loginDestination()` — composes it for all three server-side redirects:
[`requireWorkspace()`](app/api/access.ts) and the `401` handlers in
[`app/api/server.ts`](app/api/server.ts) and
[`app/api/auth-server.ts`](app/api/auth-server.ts).

### The proxy is not the auth gate, and that is a decision

[`proxy.ts`](proxy.ts) is Next.js 16's name for middleware, and it runs on every page
request. It **does not check whether a request may proceed** — [`app/api/access.ts`](app/api/access.ts)
is the only answer to that — and the file argues the case at length under *Why this file is
not the auth gate*. In short: there is no protected content to flash, because a page in
`(app)` composes nothing until the gate has returned; an edge check could only be
optimistic, since proxy runs on every prefetch and so may not call the service; it would
need a list of protected routes when `(app)` is already one; and nothing in `(app)` is
static. So what proxy carries upstream is a fact — the request's own address — and never a
decision.

The one thing an edge gate *would* improve is recorded there too rather than glossed: a
signed-out deep link is answered as a `200` carrying a streamed redirect rather than a bare
`307`, because [`loading.tsx`](<app/(app)/dashboard/loading.tsx>) opens a Suspense boundary
and the shell flushes before the gate resolves. It would not improve the commoner case — a
visitor whose session merely expired still carries a cookie, and an optimistic check passes
them through to the same stream.

## The generated client

For everything under `/api/v1`, the client is **generated from the service's contract**
([#43](https://github.com/NobuData/ouroboros/issues/43),
decision D4 — [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#51-ui--rest--the-public-contract)).
Nothing in that family is hand-written against the API: `ouroboros-rest/openapi.yaml` is the
contract, `yarn openapi` renders it to `openapi.json`, and `yarn api:sync` turns that into
[`app/api/schema.d.ts`](app/api/schema.d.ts).

```ts
import { tenants } from "@/app/api/tenants";

const page = await tenants.list({ limit: 10 });   // → TenantPage, typed end to end
page.items[0].slug;                               // a compile error if the field is renamed
```

Under it, [`app/api/client.ts`](app/api/client.ts) adds the four things every call needs
and no call should repeat:

| | |
|---|---|
| **Base URL** | `OURO_REST_URL`, via [`app/env.ts`](app/env.ts) |
| **Session** | BetterAuth's two cookies from the request being served, forwarded — and only those. The same pair the **auth** client sends: `better-auth.session_token`, plus the `better-auth.session_data` snapshot that saves the service a query per call |
| **Workspace** | nothing. The session carries it (#719) — see below |
| **Failure** | the contract's `{code, message, details}` envelope, parsed into a thrown `ApiError`; a `401` redirects to `/login?next=…` first |

So a call has two outcomes rather than three: it resolves with the body the contract
describes, or it rejects with an `ApiError` carrying the `code` to branch on. There is no
`{data, error}` to unpack at the call site.

**It runs on the server.** `OURO_REST_URL` carries no `NEXT_PUBLIC_` prefix and the session
cookies are `HttpOnly`, so a browser could neither address the service nor
authenticate to it; [`app/api/server.ts`](app/api/server.ts) imports `server-only`, which
turns a Client Component that reaches for it into a build error rather than a runtime one.
Screens therefore fetch in Server Components and pass data down, and a Client Component
that needs to *write* calls a Server Action.

**There is one exception, and it is a route handler**
([#87](https://github.com/NobuData/ouroboros/issues/87)). The dashboard poll is neither a
render nor a write: it is the browser asking for the same payload every fifteen seconds, and
what makes that cheap is HTTP's — `If-None-Match` echoed back, a `304` with no body, and the
`X-Ouro-Poll-After` header that lets the server slow every open dashboard by changing one
variable. A Server Action would have had to carry the tag as an argument and mime the answer
as a return value, which is that exchange with the status line rewritten as data. So
[`app/api/dashboard/route.ts`](app/api/dashboard/route.ts) answers `GET /api/dashboard` on
this origin and forwards the exchange unchanged over
[`app/api/dashboard-summary.ts`](app/api/dashboard-summary.ts), which is still server-side
and still forwards the same two cookies. It gates nothing itself: a visitor with no session
gets the service's `401`, which is the same authority every rendered screen is checked
against. See [the polling store](#the-polling-store).

**Neither client sends `X-Ouro-Tenant` any more.** Both did, from the `ouro_tenant` cookie,
until [#719](https://github.com/NobuData/ouroboros/issues/719). The header is an *override* of
the session's active organization since
[#713](https://github.com/NobuData/ouroboros/issues/713), and an override this application
never means to exercise is one it should not be sending: a stale value alongside a path naming
the workspace somebody is actually in is `422 tenant_mismatch` on a request that would
otherwise have succeeded. [`app/api/client.ts`](app/api/client.ts) keeps the capability; nothing
wires it.

Three properties are worth knowing before changing any of it.

1. **The generated file is committed, and staleness fails CI.** `yarn api:check` is run by
   the suite ([`__tests__/api/sync.test.ts`](__tests__/api/sync.test.ts)), and
   [`ui.yml`](../.github/workflows/ui.yml) watches `ouroboros-rest/openapi.json` — so a
   pull request that renames a field in the contract and nowhere else queues `ci/ui` and
   fails it. Fixing it is `yarn api:sync` plus whatever the typecheck then reports, which
   is the entire point of generating the client rather than writing it.
2. **A resource file is a vocabulary, not a layer.**
   [`app/api/tenants.ts`](app/api/tenants.ts) is one line per operation over the generated
   client, and is the pattern for the resources that follow. Types come from the schema,
   never from a hand-written interface — a facade that reshaped the contract would be a
   second contract to keep in step with the first.
3. **A value from a cookie is untrusted on its way into a header.** Both the workspace
   reference and the session value are validated before they are composed
   ([`app/api/tenant.ts`](app/api/tenant.ts)), because an edited cookie carrying a newline
   is a header-injection attempt. An unreadable *workspace* cookie is treated as no choice
   at all rather than as an error — a bad cookie must not be able to stop the application
   rendering.

Two clients are wired, not one. [`api()`](app/api/server.ts) turns a `401` into a redirect
to `/login`; `anonymousApi()` is the same client with that one handler removed, for the one
caller that must be able to *hear* a `401` — the login screen, which `api()` would send to
itself once per render for every signed-out visitor. Its caller today is
[`app/api/discovery.ts`](app/api/discovery.ts), the one public operation this module calls,
submitted from step 1 by somebody who has not signed in yet.

## Access — who is signed in, and where

[`app/api/access.ts`](app/api/access.ts) is the **data-access layer**, and it is the one
place a screen asks what it is allowed to render. Two rules come out of it, and the rest of
the application inherits both.

**A session alone is not access.** Every operation in the contract except the five public
ones is scoped to a workspace, so *signed in* and *able to render the product* are different
states — the second needs a chosen workspace this person still belongs to. `requireWorkspace()`
returns both or redirects to [sign-in](#sign-in--tenancy); `currentAccess()` answers without
redirecting, for the screen that has to ask.

**The pointer is a reference, not a fact.** The active workspace is
`session."activeOrganizationId"` — server state, written only by
`POST /api/auth/organization/set-active` — and it is still resolved against the memberships
[`readSession()`](#the-two-client-rule) reports *in the same request*
([`app/api/membership.ts`](app/api/membership.ts)). A session pointing at a workspace somebody
has since been removed from resolves to *no choice*, and lands on the login screen rather than
on a screen of somebody else's data. That check was doing much more when the reference came
from a cookie; it costs one comparison and it stays.

```tsx
// every screen in app/(app)
const { session, membership } = await requireWorkspace();
```

Three things about the shape are deliberate.

1. **It is not in a layout.** A layout does not re-render on a client-side navigation between
   sibling routes, and it does not control whether the rest of the route renders at all — so a
   check in one can be true when a page is first reached and stale when it is reached again
   (`node_modules/next/dist/docs/01-app/02-guides/authentication.md` § Layouts and auth
   checks). Calling the gate is instead how a page *gets* its workspace, which makes the page
   that skipped the check the page with nothing to draw.
2. **It is memoised per request** with React's `cache`, so a layout, a page and a Server Action
   in the same request share one call to the service. That is what makes calling it freely the
   right thing to do rather than a cost to count.
3. **It declares that it needs a request.** `await connection()` is the first line, so
   `next build` never tries to prerender a screen whose content depends on who is asking —
   which would reach `OURO_REST_URL` on a machine that has no reason to know it.

## Sign-in & tenancy

`/login` ([#44](https://github.com/NobuData/ouroboros/issues/44)) is
[`docs/mockups/01-login.html`](../docs/mockups/01-login.html) as a working page, and the first
screen to prove the design system, the session and the API together. Every card, button,
chip, field and switch on it is a [UI primitive](#ui-primitives); what
[`app/login/`](app/login) owns is the two-panel frame, the brand panel, the workspace rows,
and the monogram beside them. It renders **outside the
app shell** — the design system § 5 puts login and the onboarding wizard there, because a
visitor who has not signed in has no workspace for the shell to describe — so it owns its own
scroll container, `html`/`body` being locked for the shell's benefit.

```
┌───────────────────────────────┬─────────────────────────┐
│                               │  Step 1 · Sign in       │
│      ◎ OUROBOROS              │  [ Continue with GitHub]│
│      Infinity in Autonomy     │  ─ or enterprise SSO ─  │
│                               │  Company domain  ▢      │
│   Point it at your backlog.   ├─────────────────────────┤
│   It plans, codes, builds…    │  After sign-in · Step 2 │
│   You watch the loop turn.    │  ◉ AR acme-robotics ✓[◉]│
│                               │  ○ AL acme-labs      [○]│
│   SOC 2 · SSO/SAML · self-…   │  [ Enter mission ctrl → ]│
└───────────────────────────────┴─────────────────────────┘
        55% brand panel                45% two cards
```

**One route, four outcomes**, decided by [`app/login/view.ts`](app/login/view.ts) from three
values — the session, a `?workspace=` slug, and whether this browser has been through step 2
before — and nothing else. Keeping the decision pure is what makes each outcome a unit test
rather than a route to drive:

| The request | What it gets |
|---|---|
| no session | step 1 live, step 2 as the mockup's dimmed preview |
| signed in, not yet asked where the loop runs | step 2: **every workspace as a row**, with its counts, its `personal` pill and its switch |
| signed in, `?workspace=` naming one they belong to | the same card, opened on that row |
| signed in, belonging to no workspace | step 2 explains, and names the domain match if the contract supplied one |
| signed in and settled | redirect to the dashboard |

**Step 2 is one card since [#719](https://github.com/NobuData/ouroboros/issues/719)**, which
is what the mockup draws: three workspaces, three switches, one **Enter mission control →**.
It used to be two steps — pick a workspace, then enable organisations inside it — because the
second needed a workspace to fetch with; `GET /api/v1/orgs` answers every workspace with its
roles and counts at once, so choosing is a radio on a row rather than a screen of its own.

Two things about the request are worth knowing.

**Why a hint in a cookie decides whether step 2 renders.** Every signed-in request names a
workspace: `ouroboros-rest` stamps `session."activeOrganizationId"` at session creation, so
that step 2 opens on a row already selected. That means the pointer cannot also be the
evidence that somebody has *chosen* — a screen reading it that way would send everybody
straight past the question it exists to ask. `ouro_tenant` is that evidence, it authorizes
nothing, and the worst a forged one can do is skip a step the person could have skipped by
typing `/dashboard`.

**Why `?workspace=` exists.** "An authenticated visitor skips to the dashboard" and "a
signed-in person may come back and change where the loop runs" are otherwise the same request.
The parameter is in the URL rather than in hidden state: it survives a refresh, it can be
linked, and it is visible. It is never trusted — it is compared against a membership the
service reported in the same request.

### What it writes, and why each write re-checks

Two of the three Server Actions ([`app/login/actions.ts`](app/login/actions.ts)) write:
`enterMissionControl` makes a workspace the session's active organization and leaves for the
dashboard, and `setWorkspaceEnabled` moves its switch. A Server Action is a POST endpoint
against the page that renders it, reachable by anyone who can send the same request, so
rendering a form only for an owner is not a check. Each action therefore takes from the form
only *the reference to what was pressed* — a workspace, and the state to move to — and
re-derives the rest: **who** from the session cookie, and **which role** from the membership
the reference resolves to.

**The form carries a workspace now**, where it used to be implied by `ouro_tenant`, and that
is a change of which untrusted place the reference arrives from rather than a loosening — a
cookie is as forgeable as a form field, and the check that made one safe
([`activeMembership`](app/api/membership.ts), against the memberships the service reported in
this same request) is the check that makes the other safe. A hand-made POST naming somebody
else's workspace resolves to nothing and lands on the login screen.

The third, `discoverDomain`, is the exception and deliberately so: it takes no authority and
checks none, because the endpoint behind it is public and its caller is a visitor with no
session. What makes *that* safe is the contract rather than a check — the service answers the
same body, in the same time, for a domain a workspace holds and one nothing does, so there is
nothing it can tell a stranger that it does not tell everybody.

Step 2's switches are submit buttons in one-field forms rather than `useState` toggles, and
its radios reach the CTA's form by `form=` rather than by being inside it — a form may not
contain another form, and every switch is one. So that half of the screen works before
hydration and without JavaScript — on the product's first
screen over an unknown connection that is worth more than an optimistic animation. Each form
carries the state to move *to*, so a stale render asks for something specific instead of
inverting whatever the flag has become since.

### The three client components on step 1, and why each one is

The screen was Server Components the whole way down until
[#718](https://github.com/NobuData/ouroboros/issues/718), and the three exceptions are worth
naming individually rather than as "sign-in needs a client":

| Component | Why |
|---|---|
| [`sign-in-button.tsx`](app/login/sign-in-button.tsx) | BetterAuth answers a social sign-in with a URL the **browser** navigates to, rather than redirecting to it |
| [`dev-sign-in.tsx`](app/login/dev-sign-in.tsx) | the session cookie is set by `Set-Cookie`, which reaches a browser only on a request the browser itself made |
| [`sso-form.tsx`](app/login/sso-form.tsx) | the call **is** a Server Action; rendering what it returned is what needs `useActionState` |

The first two are the same fact seen twice, and it is the fact that keeps sign-in out of
Server Actions entirely: a `Set-Cookie` sent to the Next.js process is a session nobody holds.
The third is the only rendering decision, and the alternatives were weighed —
a `redirect()` back to `/login` carrying the message would put a company's own domain in a
URL, a browser history and a `Referer` header, which is precisely what the discovery endpoint
is a `POST` rather than a `GET` to avoid.

### What it does not pretend

- **Enterprise SSO says what the service says**, and nothing of its own. The field and button
  rendered inert behind one `SSO_UNAVAILABLE` constant until
  [#712](https://github.com/NobuData/ouroboros/issues/712) gave them an endpoint — the design
  system's answer (§ 3.5) to a control that cannot act. They submit now, to
  `POST /api/v1/auth/discover`, and the sentence under them is the response's `message` in
  both branches of `ssoAvailable`. The constant is gone rather than moved, which is the whole
  point: a client that says "not configured" is right today by luck and wrong the moment
  [#722](https://github.com/NobuData/ouroboros/issues/722) lands. The only copy this module
  still owns for that half says *we could not ask*, which is its own fact to report.
- **Email and password is development scaffolding**, and says so on the card. `ouroboros-rest`
  enables it on `NODE_ENV !== "production"` and nothing else, which is the security boundary;
  what this module adds is two gates that keep a production screen from offering a control the
  service would refuse — the card does not compose the form, and the form refuses to render.
  Neither its copy nor its field ids appear in a production `next build`.
- **The mockup's three example organisations** are not invented for a visitor who has not
  signed in. The preview card says what the step will ask.
- **`member` and `viewer`** see every switch, in its real state, marked read-only with the
  reason — administering a workspace is `owner` or `admin`, and a list with the switches hidden
  would look like a list with no settings.
- **The counts are the service's own totals**, so a page holding fewer rows than exist says so
  instead of presenting a hundred as all of them.
- **Repository switches are an addition to the mockup**, which draws only a count: "toggle a
  repo" is one of the issue's acceptance criteria. They are indented under their organisation
  because a repository is in scope only when its own flag *and* its organisation's are both
  true, and the summary line says so when the two disagree.
- **The monogram is one treatment, not the mockup's three.** Per-identity hues would be three
  colour literals invented here and measured nowhere; the accent panel is the token pair that
  already exists for this, and its contrast is published.

## Dashboard

`/dashboard` ([#45](https://github.com/NobuData/ouroboros/issues/45); its frame and page head
are [#80](https://github.com/NobuData/ouroboros/issues/80), its stat row
[#81](https://github.com/NobuData/ouroboros/issues/81), its active-loops table
[#82](https://github.com/NobuData/ouroboros/issues/82), its loop pulse
[#83](https://github.com/NobuData/ouroboros/issues/83), its completions table
[#84](https://github.com/NobuData/ouroboros/issues/84) and its queue card
[#85](https://github.com/NobuData/ouroboros/issues/85)) is
[`docs/mockups/02-dashboard.html`](../docs/mockups/02-dashboard.html) as a working page, and
where a signed-in request with a chosen workspace lands. It renders **inside** the
[app shell](#app-shell), so it starts at its page head and contributes no chrome of its own
(design system § 2). Its cards, actions, status chips and empty states are
[UI primitives](#ui-primitives); [`app/dashboard/`](app/dashboard) owns the page head, the
twelve-column grid, and the compositions built on top — the system list and the pulse card's
captioned meters. (The stat tile was one of them until the [build farm](#build-farm) drew the
same row; it is the [`StatCard` primitive](#ui-primitives) now.)

```
MISSION CONTROL
Good afternoon, Ken — the loop is turning.  [ Edit workflows ] [ ⟳ Pull next issue ]
3 issues in flight, 12 queued behind them.      ↑ both inert, and say why
Ouroboros merged 6 pull requests since midnight UTC.

┌ LOOPS LIVE ─┐┌ QUEUED ISSUES ┐┌ PRS MERGED·7D ┐┌ TOKEN SPEND·TODAY ┐
│      3      ││      12       ││      27       ││       4.2M        │
│ 1 coding ·… ││ est. 9h 40m … ││ ▲ 8 vs last … ││ ≈ $18.60 across 4 │
└─────────────┘└───────────────┘└───────────────┘└───────────────────┘
┌ ACTIVE LOOPS  ● live ──────────────┐┌ LOOP PULSE       7 days ─┐
│ #482 Fix flaky… [standard-fix]     ││          ( ◎ )           │
│   Implementing · 4/6  ▓▓▓▓▓▓▓░░░   ││ merge rate 14d  92% ▓▓▓▓▓░│
│   [claude-fable-5]  12m 40s (coding)││ cycle 7d    14m 20s ▓▓░░░│
└────────────────────────────────────┘│ ─────────────────────────│
┌ SYSTEM      ◐ operational ┐         │ Auto-merge …      [ on ]  │
│ REST API            [ up ]│         └──────────────────────────┘
└───────────────────────────┘
┌ RECENTLY CLOSED BY THE LOOP ────── All issues → ┐┌ UP NEXT ── Manage queue → ┐
│ #474 → PR #512 Debounce…  11m  14/14 (merged)   ││ #485 Watchdog… [M ][std] │
│ #465 → PR #504 Refactor…  42m  13/14 (needs human) [Review →]  … [XS][docs]  │
└─────────────────────────────────────────────────┘│           + 7 queued →   │
                                                    └──────────────────────────┘
```

**Two kinds of card sit on the same grid, and the difference is the point.** The stat row is
drawn from the aggregate's `stats`, the active-loops table from its `activeRuns`, the loop
pulse from its `pulse`, the completions table from its `recentRuns`, the queue card from its
`queueHead`, and the system card from `/health/ready` and `/api/v1/engine/status` — every
figure on them came from the service. **Every panel of the mockup now has a card drawing it
from data**, so nothing on this screen is a copy of the mockup's own rows.

**One control on the whole page changes anything**, and it is the pulse card's auto-merge
switch ([#74](https://github.com/NobuData/ouroboros/issues/74)'s operation). Everything else
here reads.

The route is three lines: [`app/api/access.ts`](app/api/access.ts) returns the workspace,
[`app/dashboard/data.ts`](app/dashboard/data.ts) turns it into everything the screen draws,
and [`app/dashboard/dashboard-screen.tsx`](app/dashboard/dashboard-screen.tsx) draws it.
Every decision in between — what a figure is, whether it is an em dash, which pill is green
— is [`app/dashboard/view.ts`](app/dashboard/view.ts), which is pure, so each is a unit test
on a function rather than a page to drive.

### The page head carries two pieces of page-level truth

**Who is looking**, and **what the loop is doing right now**. They come from opposite
directions, and that is the whole design of this head.

The greeting is the module's **one client component**
([`app/dashboard/greeting.tsx`](app/dashboard/greeting.tsx)), because a daypart is a fact
about the reader rather than about the server: "good afternoon" rendered in Denver is wrong
for the half of a workspace that is in Berlin (decision F7). It reads the browser's clock
through [`useClientValue`](app/shell/client-value.ts) — React's `useSyncExternalStore` with a
server snapshot and a client snapshot — so the heading is a complete `h1` from the first paint
(*"Hello, Ken"*) and the daypart lands in the same commit rather than in a cascading second
render. No `new Date()` in a render body, and so no hydration mismatch to throw markup away
over.

The subline is server data: the aggregate's `activity`
([#70](https://github.com/NobuData/ouroboros/issues/70)), composed in
[`view.ts`](app/dashboard/view.ts) with the pluralisation written once (`countOf`). Three
things it will not do —

- **It does not say "this morning".** The figure is counted from **midnight UTC**, the same
  boundary the day's token spend uses; thirteen hours away that is not this morning, and a
  page whose whole argument is that its numbers are real should not round a timezone off the
  only figure on it that has one.
- **It does not count to zero at an empty workspace.** *0 issues in flight, 0 queued behind
  them* is true and useless; a workspace that has not started reads *"Nothing is running yet
  — the loop starts when an issue reaches the queue."*
- **It does not render an unread aggregate as an idle one.** A refusal puts the service's
  reason there in the error hue, and the heading drops its closing clause rather than claiming
  a loop is turning that nobody could ask about.

### The stat row: four figures, and one line that is allowed to be absent

Each of the mockup's four `c-3` tiles is a caption, a figure and a line explaining the
figure, and three of the four derive that line rather than printing one
([`view.ts`](app/dashboard/view.ts)):

| Card | Figure | Line beneath it |
|---|---|---|
| Loops live | the total, in the accent | `1 coding · 1 building · 1 in review`, from `byStatus` |
| Queued issues | the count | `est. 9h 40m of autonomous work`, from `estMinutes` |
| PRs merged · 7d | the count | `▲ 8 vs last week` — arrow, wording and hue from the sign |
| Token spend · today | compact tokens, `4.2M` | `≈ $18.60 across 4 providers` |

The formatters behind them are [`app/format.ts`](app/format.ts) — compact counts, durations
and money — written out rather than delegated to `Intl.NumberFormat`, whose compact output
depends on the ICU data the runtime was built with (a server render and its hydration would
disagree about the same figure) and which cannot be asked for the `1.0M` this design draws.
Their boundaries are the things that make a page look designed rather than generated, so
each is a case in [`__tests__/format.test.ts`](__tests__/format.test.ts): `999,950` is
`1.0M` and never `1000.0k`; `580` minutes is `9h 40m` and never `9.7h`; `60` is `1h` and not
`1h 0m`.

Four rules the row is written under, and the third is the one worth stating twice:

- **`byStatus` is the run table's arithmetic, not the mockup's caption.** The mockup prints
  *"2 coding · 1 in review"* over a table holding one run in each of three statuses;
  decision F.5 settled that in favour of the table. A status holding nothing is left out
  rather than printed as a zero.
- **The delta's direction is in the glyph as well as the hue**, so `▲` and `▼` separate an
  up week from a down one without colour vision — and a week that matched the one before is
  *"Level with last week"*, neither arrow nor colour, rather than an up week with a zero
  on it.
- **A cost nobody has priced is not `$0`.** `costCents` sums only the events that carry a
  price, so a day of purely unpriced usage — local inference on a workstation is the honest
  case — sums to zero while having cost something unknown. The line is **hidden** in that
  state. The `≈` is not decoration either: it appears exactly when `unpricedEvents` is
  non-zero, which is what makes *"≈ $18.60"* an honest floor. Giving that state its own
  *cost unavailable* line is [#92](https://github.com/NobuData/ouroboros/issues/92)'s.
- **The row is one read, so it fails as one.** Every figure comes from the aggregate, so a
  refusal leaves all four carrying an em dash and the service's reason rather than four
  zeros — and a workspace with nothing in it reads as four zeros and four sentences, which
  is a different thing and must not look alike.

### The active loops table: six columns, two of them moving

The `c-8` card ([#82](https://github.com/NobuData/ouroboros/issues/82)) is the one the page is
named after — everything else on the grid measures the last day or the last week, and this is
the present tense. It draws the aggregate's `activeRuns` through the #46
[`Table`](app/ui/table.tsx), with each row's arithmetic in [`view.ts`](app/dashboard/view.ts)
and no arithmetic at all in the card:

| Column | What it draws |
|---|---|
| Issue | the mono number and the title the run recorded |
| Workflow | the tag, as free text — there is no workflow catalogue to look it up in |
| Stage | `Implementing · 4/6` over a [`Meter`](app/ui/meter.tsx) at `index/total`, ok-toned in review |
| Model | the identifier, opaque (decision F8), in the model hue |
| Elapsed | `now − startedAt`, counting |
| Status | `coding → run` · `building → warn` · `review → ok` |

**The meter rounds down.** Four steps into six is 66.67%, and a progress bar is a claim about
work that has *finished* — so the only honest way to round one is towards the work that
certainly has, which also keeps `100%` reachable only by a run that has actually reached its
last step.

**Elapsed counts from the run's start, not from the figure the server computed.** Adding a
second per tick would drift on every throttled frame and could never be checked against
anything; [`elapsed.tsx`](app/dashboard/elapsed.tsx) holds `startedAt` and recomputes the
difference against a clock instead. Three properties fall out of that rather than out of a
guard somebody has to remember: a poll cannot move the number (the same run polls back with
the same immutable `startedAt`), a tab that was backgrounded catches up instead of falling
behind, and the only moment the figure could go backwards — hydration, where two machines
answer *what time is it* — is closed by treating the server's own reading as a floor. The
clock behind it, [`app/shell/clock.ts`](app/shell/clock.ts), is one `useSyncExternalStore`
singleton quantised to whole seconds: **one interval for the page**, so ten rows tick on one
beat, and none at all once the last of them unmounts.

*Now* is therefore an input to this render. [`data.ts`](app/dashboard/data.ts) reads it once,
after the fetches, and puts it in `DashboardReadings.readAt` — two cards reading their own
clocks could disagree about what time it is, and a clock read inside a component is a clock no
test can pin.

**Nothing in the card is a link yet.** The rows will open the run console, which is mockup 10;
`Open run console →` and `+N more running →` will go to #49's placeholder routes. None of
those exists, so all three are labelled with what is missing rather than pointed at a `404` —
the same treatment the sidebar gives the eight destinations nobody has built, and the same reason: #49's own first
criterion is *no dead nav links*.

### The loop pulse: three meters, two windows, and the page's one write

The `c-4` card ([#83](https://github.com/NobuData/ouroboros/issues/83)) is the qualitative
read on the loop — how often it finishes without a person, how long a cycle takes, how often
it stops for one — over the aggregate's `pulse`, with every figure and every width decided in
[`view.ts`](app/dashboard/view.ts) (`pulseMeters`).

| Meter | Figure | Bar | Window |
|---|---|---|---|
| Autonomous merge rate | `92%` | the rate itself | **14 days** |
| Avg. cycle time | `14m 20s` | against a 30-minute target | 7 days |
| Human interventions | `2 this week` | against a budget of 25 | 7 days |

**Two of the three bars needed a denominator the payload does not carry**, and both are
exported constants — `CYCLE_TIME_TARGET_SECONDS` and `INTERVENTION_BUDGET_7D` — that
reproduce the mockup's widths exactly (860 ÷ 1800 rounds to 48%; 2 ÷ 25 *is* 8%). A width
nobody can explain is a width nobody can check, so neither is a number matched to a
screenshot. Both round to a whole percent, because a ratio against a target somebody chose is
a gauge rather than a measurement — and because a bar drawn at 91.5% under a figure printed
`92%` is a card disagreeing with itself.

**Each row prints the window it was measured over.** The head keeps the mockup's `7 days`
tag and the merge rate says `14 days`, which is the window the contract publishes it under:
the mockup's own `27 merged`, `2 interventions` and `92%` cannot all be true of one
seven-day window. The figure beside each bar is hidden from the accessibility tree and the
bar carries it in words instead — `92% of runs merged without a person, over 14 days` — so
the caption speaks for the eye and the bar for the reader, never both.

**The glyph is the [#14](https://github.com/NobuData/ouroboros/issues/14) asset, drawn and
not painted over.** Both treatments are stacked in one grid cell with CSS choosing between
them, exactly as the header's mark and the login lockup are, so the right one is painted
before any JavaScript runs and the card renders identically under both palettes. The mockup's
`mix-blend-mode: screen` and its `drop-shadow` are gone: they are one workaround for a crop
that still had its background attached, `docs/BRAND.md` § Rules bans both on this pair, and
on a light card the blend would erase the mark outright.

**The switch is optimistic, and its failure is loud.**
[`auto-merge-switch.tsx`](app/dashboard/auto-merge-switch.tsx) is a Client Component over the
Server Action in [`pulse-actions.ts`](app/dashboard/pulse-actions.ts) — the browser cannot
reach REST, so a write goes through the same seam the font scale and the repository listing
use. The optimistic position is `useOptimistic`'s, which means it lives exactly as long as
the transition that set it, and three bugs stop being possible: a failed `PATCH` needs no
rollback path to remember, a write that landed on a different value than it sent is drawn
from the row rather than from the request, and a change nobody made in this browser arrives
as a changed prop and is simply drawn. A landed write calls `router.refresh()` *inside* that
transition, so the route's Server Components re-render from a fresh aggregate — which is the
issue's *"verified by the next poll"* until [#87](https://github.com/NobuData/ouroboros/issues/87)'s
polling hook lands.

Where the login screen's switches are submit buttons in one-field forms — that screen is the
first one, on an unknown connection, and working before hydration is worth more there than an
animation — this one is a setting on a page nobody reaches without a session, beside a table
already ticking a clock.

**A `member` or a `viewer` sees the switch, disabled, with the reason in its tooltip and its
description** (§ 3.3), `aria-disabled` rather than `disabled` so the explanation keeps its
place in the tab order. The gate that decides is the service's: a Server Action is a POST
endpoint anybody can reach, so the browser's copy of the rule is presentation, and a forged
write is answered with the `403` in the same sentence the tooltip carries.

### The completions table: what the loop actually shipped

The `c-7` card ([#84](https://github.com/NobuData/ouroboros/issues/84)) is the receipt beside
the active table's promise: the aggregate's `recentRuns` through the same #46
[`Table`](app/ui/table.tsx), five columns, every figure decided in
[`view.ts`](app/dashboard/view.ts) (`recentCompletions`).

| Column | What it draws |
|---|---|
| Issue → PR | `#474 → PR #512` in mono, then the title the run recorded |
| Model | the identifier, opaque (decision F8), in the model hue |
| Cycle | `finishedAt − startedAt`, in #81's compact formatter — `11m` |
| Checks | `14/14`, tinted warn when fewer passed than ran |
| Outcome | `merged → ok` · `needs human → warn` · `failed → danger` |

**The honest rows are drawn exactly like the good ones.** A `needs human` row keeps the same
columns, the same type and the same weight; the outcome pill and the tint on its short check
count are the whole of the difference. A card that tucked its interventions away would be
reporting a merge rate rather than a week — and the tint is on the **comparison** rather than
on the status, so a run that merged with a check outstanding is as visible as one that stopped
for it. The fraction says `13/14` in figures and the cell says *1 check did not pass.* in its
tooltip, because meaning is never carried in hue alone (design system § 3.4).

**A cycle is compact where the elapsed column is padded**, and the two functions are two
functions for one reason: a cycle has stopped. `11m` rather than `11m 00s` — there is no
figure moving that a hidden zero part would make look stuck — and it is `durationOfMinutes`,
the same formatter the *Queued issues* estimate is drawn with, so two durations on one page
cannot be written two ways. It also needs no clock: both instants are in the payload, which
is why this card takes no `readAt`.

**`failed` is mapped although neither the mockup nor the seed has one.** The status is in the
contract, the danger treatment is in the design system, and a run that failed is exactly the
row this card must not quietly drop — so it is a fixture in
[`recently-closed-card.test.tsx`](__tests__/dashboard/recently-closed-card.test.tsx) rather
than a branch nobody has ever rendered.

**Four rows of the eight that arrive.** The endpoint answers eight so a client that expands
the card already holds them; the mockup draws four, and `COMPLETIONS_SHOWN` is that number
written down. Nothing is re-sorted — the endpoint orders the whole table, newest first by
`finishedAt`, and four rows sorted again here would come out in a different order from the
listing that shows all of them.

**A `needs human` row does not navigate yet.** The needs-you inbox is mockup 16 and #49 holds
its route, which is post-MVP; the row's control is an inert button carrying what is missing,
which is the treatment the sidebar already gives that destination — and #49's own first
criterion, *no dead nav links*. **`All issues →` is a link** since
[#115](https://github.com/NobuData/ouroboros/issues/115) built the [issues screen](#issue-intake),
to the same `ISSUES_PATH` the sidebar's **Issues** entry names.

### The queue card: what the loop will do next

The `c-5` card ([#85](https://github.com/NobuData/ouroboros/issues/85)) is the forward-looking
half of the page: the aggregate's `queueHead` in queue order, one row per issue, decided in
[`view.ts`](app/dashboard/view.ts) (`queueRows`, `moreQueued`) and drawn by
[`queue-card.tsx`](app/dashboard/queue-card.tsx).

```
#485  Watchdog reset on I²C bus lockup       [ M  ]  [standard-fix]
#488  Typo sweep in operator manual          [ XS ]  [docs-loop]
#490  Migrate build to Zephyr 4.2            [ XL ]  [deps-refresh]
                                                        + 7 queued →
```

**A list, not a table.** The two cards beside it have columns — a heading over each cell saying
what the figure in it means. A queue row has none: it is one issue, and the effort chip and the
workflow tag are properties *of* it rather than a second and third measurement. So it is a
`ul`, which is also what a screen reader is best served by — *list of five items*, then five
issues, rather than a grid whose column headers would have to be invented to justify the markup.

**This is the one surface in the product that draws all five effort chips at once**, which is
what makes it the place the scale is proved. The hue is derived from the size by the #46
[chip](app/ui/chip.tsx) — `XS`/`S` are cheap, `M` is the ordinary case, `L`/`XL` are the ones
worth a second look — never passed by a call site, because an `L` that was green somewhere
would make the scale mean nothing. The size is a **judgement** and is deliberately not a
function of the estimate beside it (contract `QueueEffort`): if one were derived from the other,
the stat row's `est. 9h 40m` would be a restatement of the chips rather than a second fact.

**`+7 queued` is a subtraction over two separately true figures**, not a flag: `queueHead` is
capped at five by the service and `stats.queued.count` speaks for the whole queue, so the
footer appears only when the count exceeds the rows and says exactly the remainder. It shares
its arithmetic with the loops table's `+N more`, so two footers on one page cannot disagree.

**`Manage queue →` and the footer link to the issues screen.** The
[issues screen](#issue-intake) is where the queue is filled: its backlog table selects issues
(#117) and its selection bar queues them under a chosen workflow
([#118](https://github.com/NobuData/ouroboros/issues/118)). Until that bar landed both were inert
buttons carrying one reason, because a link to a screen with nothing yet to manage the queue with
is a dead end; the bar turned them into the `href` they were always going to be, and its toast
links back here, at this card's heading, through the one fragment
[`app/paths.ts`](app/paths.ts) owns. The page head's *⟳ Pull next issue* stays inert with its own
sentence, `PULL_NEXT_SOON` in [`app/dashboard/view.ts`](app/dashboard/view.ts): pulling takes
the head of the queue and starts a run, which is the engine's move and arrives with its ingestion
bridge (#91).

The empty state is the card's own until [#86](https://github.com/NobuData/ouroboros/issues/86)
designs every card's together: a workspace that has caught up with its own queue reads
*Nothing is queued*, and an aggregate nobody could read reads the service's reason.

### One failed read is one degraded card

The three reads go out together — the aggregate, the readiness probe and the engine's status
— and each is wrapped independently, so an aggregate that fails leaves the status pills
intact. The wrapper catches an `ApiError` and **nothing else**: a `401` arrives here as
Next.js's redirect signal rather than as an error, and a `catch` wide enough to hold it would
swallow the navigation to the login screen and draw a dashboard captioned with the
framework's internal message.

It was five until #81. The members listing and the enablement lists fed #45's stat row, which
counted people, organisations and repositories while nothing could report on a loop; the row
is now the aggregate's own four figures, so both reads lost their card — and a page that
fetched them anyway would pay for two round trips per render, and per poll, to draw nothing.
Both operations are unchanged and still read elsewhere ([app shell](#app-shell)).

One of the three is the aggregate, and it is **one** call by design (decision F5):
[`app/api/dashboard.ts`](app/api/dashboard.ts) wraps `GET /api/v1/dashboard`, which answers
every number, list and switch the mockup draws in a single payload, so the page paints in one
round trip rather than in eight. It sends no `If-None-Match` — this is the *first* read, made
by a Server Component so the page arrives rendered, and the `ETag` loop that keeps it fresh
afterwards is [#87](https://github.com/NobuData/ouroboros/issues/87)'s.

### Empty, loading and failed, designed together

The mockup draws only the busy state. The other three
([#86](https://github.com/NobuData/ouroboros/issues/86)) are the ones a real workspace spends
most of its first week in.

**Nothing is fabricated at zero.** A fresh workspace — the `kensuenobu` seed org — reads as
zeros and sentences, never as an em dash: these zeros *were read*. Each card says what is not
there and what would put something there — *Nothing is running right now*, *Nothing closed
yet*, *Nothing is queued* — and the pulse card keeps its three meters at zero under a note
saying they have nothing to measure, because three empty bars and no sentence would read as a
merge rate of nought. None of the mockup's plausible rows appears anywhere.

**The skeleton is each card's own shape.** [`loading.tsx`](<app/(app)/dashboard/loading.tsx>)
draws the nine cards at their real geometry — the stat tile's tall figure, the tables' ruled
rows, the pulse card's mark at `512×296` over three meters with a switch under a rule — from
classes that mirror the cards' own. Nine copies of one generic block reserve the wrong height
for eight of them, which is a skeleton that passes its own test and still lets the page jump.

**A failed read degrades; it does not blank the page.**
[`freshness.tsx`](app/dashboard/freshness.tsx) holds the last render that worked, so a service
that stops answering mid-session leaves the reader's figures on screen under
[a banner](app/dashboard/stale-banner.tsx) saying *"Showing data from 14:02 — the latest
refresh failed"*, with the page's only retry beside it. It holds the rendered **tree**, not the
payload, which is what keeps every card a Server Component — this and the auto-merge switch are
the whole of the client code on this screen. `router.refresh()` re-runs the route and merges
the result without discarding client state, so a retry that fails again still shows the data
from before the failures started; #87's polling hook will drive the same boundary.

**The reason is said once.** Before this, one refused aggregate printed the service's sentence
**nine times** — four stat tiles, four cards and the page head's subline — which reads as nine
problems rather than one and buries the single retry that would fix them. The rule now: **a
card says what could not be read, and the banner says why.**

### The system card, and why one read skips the client

`/health/ready` is the only read in this module that does not go through the typed client,
and the reason is particular to it: **its failure is its answer.** The contract has it reply
`200` when every dependency answered and `503` when one did not, carrying the *same body*
either way — the `503` is the response that names which dependency is down and why. The
client's middleware turns every non-`ok` response into a thrown `ApiError`, and a
`HealthReport` is not the contract's error envelope, so a client call would convert the one
response the card exists to render into a rejection carrying none of it. It costs nothing
else: the route answers without authentication, so there is no session cookie to forward and
no `401` to route. [`app/api/health.ts`](app/api/health.ts) says all of this at length.

The probe decides every state; `/api/v1/engine/status` supplies the engine's build, and its
state only when the probe does not name the engine at all. They are separate round trips and
a service can stop between them, so the precedence is one-directional rather than a second
opinion. Stop the engine and the engine's pill degrades while the database's does not.

### What it does not pretend

- **No run and no queued issue is invented.** Every row on this page came from `activeRuns`,
  `recentRuns` or `queueHead`. None of the mockup's own rows is copied anywhere: a workspace
  with an empty queue draws a designed empty state, not five plausible issues.
- **No model, workflow or stage name is interpreted.** They are opaque strings (decision F8),
  so `ollama/qwen3-coder` is rendered rather than split into a vendor and a version, and a run
  whose workflow has since been renamed still reads under the word it recorded.
- **Both page-head actions are inert**, as are the active-loops card's two, and each says why
  in a tooltip naming the issue it waits for. *Edit workflows* waits for the workflow builder,
  whose route [#49](https://github.com/NobuData/ouroboros/issues/49) still holds; *Pull next
  issue* waits for the engine's ingestion bridge (#91), which is what pulls the head of the
  queue into a run — the queue itself is filled from the issues screen since #118 — and a
  control that appeared to pull an issue would be the one dishonest thing on the screen. Linking
  either to a route that cannot yet do what its label offers would break #49's own first
  criterion, *no dead nav links*. `aria-disabled` rather than `disabled`, so the explanation
  keeps its place in the tab order.
- **A figure that could not be read is an em dash**, never a zero — and the reason it could
  not be read is said once, in the banner, rather than repeated under every figure.
- **A dependency nobody could ask about is *unknown*, never green** — and the summary pill
  reads *degraded* rather than *operational* when any row is.
- **A cost nobody has priced is hidden, not drawn as `$0`.**
- **A pulse with nothing to measure says so**, rather than reporting a 0% merge rate: all
  three of its figures are floors when no run has closed in the window, and a workspace that
  has never finished one has not merged nothing — it has not started.
- **A switch is never drawn in a position the server does not hold.** An aggregate nobody
  could read has no position, so the row says that instead of defaulting to `off`; an
  optimistic flip that did not persist goes back and says why.
- **The pills differ in shape as well as in hue**, so *operational* and *degraded* are
  distinguishable without colour vision — as do the stat row's deltas, which carry an arrow.

The real dashboard is specified card by card under
[#62](https://github.com/NobuData/ouroboros/issues/62) (Epic I).
[#80](https://github.com/NobuData/ouroboros/issues/80) has replaced the frame and the page
head on top of #45's route, readers, status logic and redirect,
[#81](https://github.com/NobuData/ouroboros/issues/81) the stat row,
[#82](https://github.com/NobuData/ouroboros/issues/82) the active-loops table,
[#83](https://github.com/NobuData/ouroboros/issues/83) the loop pulse,
[#84](https://github.com/NobuData/ouroboros/issues/84) the completions table and
[#85](https://github.com/NobuData/ouroboros/issues/85) the queue card. **Every card of the grid
is now drawn from the aggregate this page already fetches**, and
[#86](https://github.com/NobuData/ouroboros/issues/86) has designed the three states the mockup
does not draw — empty, loading and failed — across all of them at once. What is left of Epic I
is [#87](https://github.com/NobuData/ouroboros/issues/87), which keeps the page fresh with the
`ETag` poll and drives #86's freshness boundary instead of its manual retry.

## Issue intake

`/issues` ([#115](https://github.com/NobuData/ouroboros/issues/115)) is
[`docs/mockups/03-issues.html`](../docs/mockups/03-issues.html): the page head, its live counts
and its two actions; since [#116](https://github.com/NobuData/ouroboros/issues/116) the filter
bar under them; since [#117](https://github.com/NobuData/ouroboros/issues/117) the backlog
table under that — the page's core, polled so its statuses are live; since
[#118](https://github.com/NobuData/ouroboros/issues/118) the selection bar under the table,
where a selection becomes work; and since
[#119](https://github.com/NobuData/ouroboros/issues/119) the detail panel beside them — the
sizing story for one row, polled so it moves with the pipeline; and since
[#120](https://github.com/NobuData/ouroboros/issues/120) every state the mockup does not show —
the guidance where the rows would be, the sync banner over them, and the route's skeleton. It
retires the `/issues` placeholder #49 was to build — never built, so nothing was deleted — and the
sidebar's **Issues** entry became a link on the same commit.

```
ISSUE INTAKE
9 open issues. 7 already sized.                   [ Re-estimate all ] [ Queue 2 selected ⟳ ]
Ouroboros watches the GitHub backlog and            owner/admin only    the table's selection;
continuously estimates effort, risk, and routing    → confirms "This    inert at zero and for
for every open issue — before you ever ask it       re-estimates 9      a viewer
to work.                                            issues."
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ [helios-firmware ▾] (bug ✓)(enhancement)(good-first-issue)(tech-debt) [Open ▾]             │
│ [Sort: estimated effort ▾] [Filter by title, #number, or label…          ] [Clear all]      │
└────────────────────────────────────────────────────────────────────────────────────────────┘
        └──────────── every control lives in ?repo=&labels=&state=&sort=&q=&page= ──────────┘
┌─ BACKLOG · AS OUROBOROS SEES IT ────────────────────────────────────── (synced 40s ago) ─┐
│ [–] Issue                          Effort   Suggested workflow  Routed model     Status   │
│ [✓] #485 Watchdog reset on I²C…    M  92%   standard-fix        claude-fable-5   queued   │
│ [ ] #484 Motor PID integral…       M  88%   standard-fix        cursor/composer-2  sized  │
│ [ ] #483 Telemetry frame drops…    sizing…  —                   —              estimating…│
│ [✓] #490 Migrate build to Zephyr…  XL 61%   deps-refresh        claude-fable-5   queued   │
│                                                            1–25 of 42  [← Previous] [Next →] │
└────────────────────────────────────────────────────────────────────────────────────────────┘
┌─(glow)─────────────────────────────────────────────────────────────────────────────────────┐
│ 2 issues selected · est. 3h 45m combined autonomous work   [Assign workflow ▾] [Queue → suggested] │
└────────────────────────────────────────────────────────────────────────────────────────────┘
┌─ ISSUE DETAIL ─────────────────────────────────────────────────────── (queued) ── [×] ─┐  c-4,
│ #485 · opened 2d ago by field-support                                                   │  beside
│ Watchdog reset on I²C bus lockup   [bug][i2c][watchdog][priority-high]                 │  the
│ │ "Unit 07 in the Fremont pilot rebooted 14 times overnight…"                          │  table
│ ── AI WORK BREAKDOWN ──  files · Est. tokens ~180k · Est. cycle 12–18 min · M conf 92% │
│ Regression risk  low ▓▓░░░░░░░  "Isolated to the I²C driver path…"  [standard-fix]     │
│ [Queue for loop] [Re-estimate] [Open on GitHub ↗]                                       │
│ ▾ ESTIMATION TRACE  sized by heuristic-v0 · 2m ago · signals: none recorded             │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### The sentence is the mockup's; the numbers are the service's

The head reads `GET /api/v1/backlog` ([#110](https://github.com/NobuData/ouroboros/issues/110))
through [`app/api/backlog.ts`](app/api/backlog.ts): *"`N` open issues. `M` already sized."* from
`meta.openCount` and `meta.sizedCount`, so the seeded workspace reads **nine and seven** where the
mockup draws 42 and 38. `__tests__/issues/view.test.ts` reads the mockup and feeds its own figures
back in, which is how the sentence is held to the mockup while the numbers are not. A backlog that
could not be counted says so, with the service's reason, rather than drawing zeros.

**One listing, asked for `state=all`, one row long.** The two head counts are scoped by the
workspace alone, so `state=all` leaves them where they are — and it turns `total` into every issue
the workspace mirrors, which is exactly the set **Re-estimate all** claims from. The head's figures
and the confirmation's count are therefore one snapshot; [`app/issues/data.ts`](app/issues/data.ts)
has the argument.

### Re-estimate all asks first, and states what it will act on

`POST /api/v1/backlog/estimate-all` ([#108](https://github.com/NobuData/ouroboros/issues/108))
spends the workspace's engine quota in one press, so the control is drawn for an **owner or admin
only** and opens a confirmation: *"This re-estimates N issues."* N is the **mirrored** count, open
and closed, because L.4's claim has no `state` in it — the open count would promise less than the
press does the moment one issue closed. The answer says how many actually started (*"Re-estimating
7 issues. 2 issues already being estimated were left alone."*), since issues already in flight are
skipped. With nothing counted, or nothing mirrored, the button is inert with the reason and no
dialog opens.

### Queue N selected ⟳ reads the selection the table writes

The label is the live count of [`app/issues/selection.tsx`](app/issues/selection.tsx)'s store — a
provider around the screen, ordered the way the selection was built, because
`POST /api/v1/backlog/queue` ([#112](https://github.com/NobuData/ouroboros/issues/112)) hands out
queue positions down the list it is sent. The backlog table's checkboxes write into it
([#117](https://github.com/NobuData/ouroboros/issues/117)); at zero the button is inert and says
where a selection is made. A viewer's button is inert whatever is selected. A press sends the ids
with no workflow — *each issue under the workflow its own estimate suggested* — and a press that took
clears the selection and re-reads the route, while a refusal keeps it, because the write is all or
nothing.

Both actions report under their own button through one line,
[`app/issues/head-outcome.tsx`](app/issues/head-outcome.tsx): a `status` for a press that took and an
`alert` for a refusal. Their Server Actions, [`app/issues/head-actions.ts`](app/issues/head-actions.ts),
refuse a forged selection that is not a list of ids before anything is sent; every other gate is the
service's.

### The filter bar is a query-string editor

The card under the head ([#116](https://github.com/NobuData/ouroboros/issues/116)) is the mockup's
`.filter-bar`, and **every control in it lives in the address** — decision K8's
`?repo=&labels=&state=&sort=&q=`. [`app/issues/filter.ts`](app/issues/filter.ts) reads a query string
into a filter and writes one back; the route reads it on the server, so the first paint is already
the filtered view; [`app/issues/filter-bar.tsx`](app/issues/filter-bar.tsx) writes the next address
with `router.replace` and the Server Components re-query M.1. Pasting the address into a new tab
reproduces the view, **Back** means *the page I came from* rather than *one chip ago*, and a filter
kept in React that could quietly disagree with the table under it does not exist. Defaults are never
written, so the default view has one address: `/issues`.

- **The repository select** is filled from the enablement list (`enabledRepos`, both flags), and it
  **is the header's focus repository seen from the page** ([#77](https://github.com/NobuData/ouroboros/issues/77)):
  choosing here publishes to the store the tenant chip draws from, a choice made in the chip is
  followed into the address, and on arrival the address decides — a pasted `?repo=` wins and is
  published, a bare `/issues` adopts the header's choice and says so in the address, and a stored
  choice the workspace no longer enables is dropped, as the chip's own menu drops it
  (`focusArrival`).
- **The chips** are M.1's `labelFacets` — every label in scope, ascending by name, not narrowed by
  the chips already on — drawn as the design system's tag on a `<button aria-pressed>`; the
  mockup's `chip-on` treatment is keyed on that attribute, in the token sheet's accent triple, so
  both palettes are the sheet's and the treatment cannot disagree with what a screen reader hears.
  Toggling ANDs, as the contract does. A label the address names and the facets do not is drawn
  pressed and last, so it can be pressed off.
- **The state and sort selects** are the ticket's — Open (default) / Closed / All, and estimated
  effort (default, per the mockup) / confidence / updated / number.
- **The search box** waits 300 ms after the last keystroke, then writes `q` trimmed — M.1's
  semantics: a substring of the title, a label name in full, or `#485`. Every other control flushes
  it, so a chip pressed mid-word asks for the word too; the text is reset from the address only
  when the address moved by another hand.
- **Clear all** is drawn whenever anything differs from the default view — the sort included, since
  a table sorted by number is not the default view — and goes to `/issues`, clearing the header's
  focus with it.

**The head's counts follow the repository, and the confirmation does not.** The contract scopes
`meta.openCount` and `meta.sizedCount` by `repo` and by nothing else in the bar, so
[`app/issues/data.ts`](app/issues/data.ts) now reads twice: the **view** — M.1 asked with the bar's
query, one row long, which is the head's sentence and the chip set — and the **scope** — `state=all`
and nothing else — whose `total` is every issue the workspace mirrors, the set L.4's claim acts on
whatever the bar says. The enablement list is the third read, beside them. Each degrades alone: a
chip set that could not be read says so under the row, with the service's reason, and the bar still
draws the address's own chips.

The bar scrolls with the page, as the mockup draws it. The page's one sticky slot
(`app/ui/chrome.ts`) is the [selection bar's](#the-selection-bar-turns-the-selection-into-work),
below the table.

### The backlog table is the address's page, kept fresh

The card under the bar ([#117](https://github.com/NobuData/ouroboros/issues/117)) is the
mockup's `BACKLOG · AS OUROBOROS SEES IT`: the route reads one page of M.1's listing —
`limit`/`offset` from `&page=`, which rides beside the bar's five controls
([`app/issues/paging.ts`](app/issues/paging.ts)) and is reset by every one of them, since the bar
navigates with the filter alone — and
[`app/issues/backlog-table.tsx`](app/issues/backlog-table.tsx) draws it over
[`app/issues/table.ts`](app/issues/table.ts)'s decisions. Every treatment is the mockup's: the
mono number, the tag row, the effort chip with its mono confidence, the suggested workflow as a
tag and the routed model as a pill — both opaque strings, drawn as given — and the status pill in
the ticket's map (`sized`/neutral, `queued`/accent, `estimating…`/warn, `needs human`/err, plus
M.1's fifth state `unsized`, neutral under its own word). An issue with no estimate prints
`sizing…` in the effort cell and an em dash where a workflow and a model would be: the mockup's
`#483` names both, and an estimate is one answer rather than four fields that arrive separately.

**The statuses are live.** Once mounted, the table polls `GET /api/backlog`
([`app/api/backlog/route.ts`](app/api/backlog/route.ts)) — a second route handler on this origin,
asked with the same query string the page was rendered from and parsed with the same two functions,
so nothing from the address reaches the service but the five controls and the page — on the
[polling store](#the-polling-store)'s cadence, through the same loop made generic
([`app/poll.ts`](app/poll.ts)). What the table draws is the latest listing there is: the poll's once
it has one, the server's until then; a poll that fails leaves the rows in place under a line saying
so. The poll is keyed on the address ([`use-backlog-poll.ts`](app/issues/use-backlog-poll.ts)) —
a chip press or a page turn is a new loop — and hears the workspace switch through the same signal
the dashboard's store does. A pill whose row has been seen to change status is keyed on the status
and carries the attribute the sheet animates, under the reduced-motion guard, so `estimating…`
becomes `sized` within one poll of the pipeline finishing and says so with a movement — and a fresh
page never fades in at once.

**Two selections, one store.** The checkboxes write the selection the head reads — `toggle` per
row, `select`/`deselect` over the page for the header's box, which reports the *page's* coverage
and is indeterminate when some of it is selected — and the store sits above everything the route
re-renders, so a filter change or a page turn keeps what was selected, ids off the page included.
Checked rows wear the mockup's `tr.sel` through the Table primitive's accent selection. A row's
click, or `Enter` on it, is the other state: it opens the issue's detail (`inspect` on the same
store, the [detail panel](#the-detail-panel-is-the-sizing-story-for-one-row) draws), and the
inspected row lights its number in the accent — a quiet mark,
distinct from the check glow, since the mockup's `#485` is both and nothing in it draws the second
state alone. The keyboard keeps the three verbs apart: the arrows, `Home` and `End` move the tab
stop, `Space` checks, `Enter` opens — the Table primitive's checkable shape (`TableMultiSelection`).

**The freshness tag is a control.** `synced 40s ago` is `meta.syncedAt` — M.4's stored stamp, the
*oldest* enabled repository's — against the reader's own clock, ticking on `app/shell/clock.ts`'s one
interval, with the server's reading as the first paint. It is the design system's tag on a button:
a press is `POST /api/v1/backlog/sync` through [`head-actions.ts`](app/issues/head-actions.ts),
which reports *syncing now* and asks the poll at once, reports a cycle already in flight as the
thing asked for happening, and says how long to wait when the last cycle was too recent. A viewer's
tag is inert with the role as its reason.

The table scrolls inside its own wrapper, as the acceptance criterion asks; the sticky header the
same line asks for is the wrapper's opposite in the primitive's recipe, and the wrapper won. The
pagination footer is drawn for a backlog beyond a page — `1–25 of 42`, **← Previous** and
**Next →** as `next/link`s that keep the filter and the selection, inert with a reason at either
end — and for an address that has run past the end, with the way back to the first page.

### The selection bar turns the selection into work

Under the table, and only while something is ticked
([#118](https://github.com/NobuData/ouroboros/issues/118)): mockup 03's `.sel-bar` in the page's
one `StickyBar` slot, wearing the `asking` rim that is the mockup's glow.
[`app/issues/selection-bar.tsx`](app/issues/selection-bar.tsx) draws it over
[`app/issues/bar.ts`](app/issues/bar.ts)'s decisions — every sentence, every label, every judgement
about a selection, as data and pure functions the suite reads the mockup to hold.

```
┌─(glow)────────────────────────────────────────────────────────────────────────────────────┐
│ 3 issues selected · est. 2h 5m combined autonomous work   [Assign workflow ▾] [Queue → standard-fix] │
└───────────────────────────────────────────────────────────────────────────────────────────┘
   refused ─▶ dialog "Nothing was queued" · "#483 is still being sized." · [Deselect 1 issue] [Close]
   took    ─▶ selection cleared · route re-read · toast "Queued 3 issues · est. 2h 5m …" → dashboard
```

**The estimate is a preview; the service's is the truth.** *"est. 2h 5m combined autonomous
work"* is summed client-side from each selected row's `estimate.estMinutes` — a fifth field M.1's
row grew for this bar (`ouroboros-rest` 0.31.8), read out of the estimate's breakdown the way the
queue write reads it for the copy, so the listing, the panel and the queue row cannot disagree
about one issue. The selection outlives the page it was made on, so the bar sums the rows **as
the table last saw them**: [`app/issues/seen-rows.ts`](app/issues/seen-rows.ts) is a store the
table publishes every listing to and the bar reads through `useSyncExternalStore` — the shape
`app/poll.ts` keeps, because the rows arrive in an effect and a `setState` there is what the
hooks lint refuses. An issue with no estimate is counted apart (*· 1 issue not sized yet*) before
the press is refused for it. The mockup's *1h 10m* is design copy: the seeds carry 45, 50 and 30
minutes for the mockup's trio and M.3 answers 125 for that selection, so the seeded bar reads
*2h 5m*, as the head reads nine and seven.

**Assign workflow ▾ is a menu over the fixed set.** *Use suggested* first — no workflow in the
request, each issue under the one its own estimate suggested, which is what the head's **Queue N
selected ⟳** always does — then the four tags of decision K5, typed against the contract's enum so
a tag the service stopped accepting is a compile error here. The rows are `menuitemradio` with the
current choice checked; the keyboard is `app/shell/menu.ts`'s, as the registry's import menu and
the routing page's alias menu use it. **Queue → workflow** reflects the choice: the chosen tag, or
under *use suggested* the one tag the selection agrees on, or `Queue → suggested` over a mixed
selection.

**A press is one transaction, and the bar says which way it went.** `queueUnder` in
[`head-actions.ts`](app/issues/head-actions.ts) — the fourth Server Action, which the head's
`queueSelected` now goes through — sends the ids in the order they were selected and the workflow
or no key at all, and answers a refusal with the sentence *and* the issues `details.issues` named,
read defensively out of an open map. A press that **took** clears the selection, re-reads the route
so the `queued` pills follow, and leaves a toast in the bar's place with the service's own count and
sum and a link to the dashboard's *Up next in queue* card; it stays until dismissed, because a link
that vanished on a timer is one a keyboard reader never reaches. A refusal that **names issues**
opens the shell's overlay under *Nothing was queued*: one sentence per issue from its code and
status (*"#483 is still being sized."*, *"#490 needs a human before it can be queued."*, *"#484 is
already in the queue."*; a `404` carries no number, so it is named from the seen rows), the
all-or-nothing note for the rest, and **Deselect N issues** so the reader drops exactly what was
named and presses again. A refusal naming **none** — a role, a request the service could not read —
is a line in the bar, as the head's are. No code is ever printed, and a refusal clears nothing.

**The dashboard's controls parted ways when this landed.** *Manage queue →* and *+N queued →*
on the [queue card](#the-queue-card-what-the-loop-will-do-next) link to `/issues` now that the bar
fills the queue, and the toast links back to the card's heading through one fragment
[`app/paths.ts`](app/paths.ts) owns; *⟳ Pull next issue* stays inert and names what it actually
waits for. The e2e leg — select three, queue, watch the card gain rows — is N.7's
([#121](https://github.com/NobuData/ouroboros/issues/121)).

### The detail panel is the sizing story for one row

Beside the table, in the mockup's grid — `c-8` for the table and the selection bar, `c-4` for
the panel, one column below the mockup's own break
([#119](https://github.com/NobuData/ouroboros/issues/119)): mockup 03's `ISSUE DETAIL` card,
[`app/issues/detail-panel.tsx`](app/issues/detail-panel.tsx) over
[`app/issues/panel.ts`](app/issues/panel.ts)'s copy and decisions — every word the mockup's panel
prints, which the suite reads the mockup to hold, and every judgement about one issue's sizing
story. The card is always seated: with no row open it says how to open one, so the table does not
shift under the pointer that clicks a row.

```
row click / Enter ─▶ selection store's `detail` ─▶ GET /api/backlog/{id}  (this origin, polled)
                                                     └─▶ ouroboros-rest GET /api/v1/backlog/{id}
  unsized     ─▶ excerpt · "First estimate pending" · [Re-estimate]
  estimating… ─▶ excerpt · "Sizing now" over the breakdown's skeleton · both writes inert
  sized       ─▶ excerpt · breakdown · risk meter · [standard-fix][claude-fable-5] · actions · trace
  needs human ─▶ the estimate that sent it there · trace opens with "confidence 61% was under the floor"
```

**The issue is the store's; the answer is a poll's.** The row a click or `Enter` opened is the
[selection store](#queue-n-selected--reads-the-selection-the-table-writes)'s `detail`, and what the
panel draws about it is the last answer of `GET /api/backlog/{id}`
([`app/api/backlog/[id]/route.ts`](app/api/backlog/[id]/route.ts) over
[`app/api/backlog-detail.ts`](app/api/backlog-detail.ts)) — a third route handler on this origin,
over M.2's one-issue read, asked on the [polling store](#the-polling-store)'s cadence through the
same loop the table keeps. That loop is keyed on whatever it asks for now
([`app/issues/use-keyed-poll.ts`](app/issues/use-keyed-poll.ts); the table's
[`use-backlog-poll.ts`](app/issues/use-backlog-poll.ts) delegates, and a `null` key holds no loop),
and the server-side translation of a read into the loop's four answers is one function both readers
share ([`app/api/poll-read.ts`](app/api/poll-read.ts)). Between a row being opened and its detail
arriving, the head — number, title, tags, pill — is the row as the table last saw it
([`seen-rows.ts`](app/issues/seen-rows.ts)) over the breakdown's skeleton, so the panel opens on the
click rather than a round trip later; another row is a new loop; closing is a `null` id and no
request at all. A poll that fails leaves the issue in place under a line saying so.

**The trace is the trace's, and nothing else** — decision K10, the honesty rule this panel exists to
keep. *sized by heuristic-v0 · 2m ago* is the estimator's own name and the instant it sized the
issue, on the reader's ticking clock; tokens appear only when any were spent, since a rule engine
spends none and `0 tokens` would dress an absence as a measurement; the version appears only past
the first; and the signals line is the signals the trace recorded, or *signals: none recorded by
this estimator*. The mockup's `claude-sonnet-5` and its three knowledge signals appear nowhere, and
the suite asserts that divergence rather than avoiding it. The file list keeps the same rule: a live
`heuristic-v0` estimate answers `files: []` because it cannot know files, and the panel draws *the
file estimate arrives with the full estimator* in the list's place; the seed writes the mockup's
three paths for `#485`, so the seeded panel draws the list.

**Four states, one guard.** `unsized` is the issue's content, *First estimate pending* and a live
**Re-estimate**; `estimating…` is the warn pill and *Sizing now* over the breakdown's skeleton, both
writes inert with their reasons; `sized` is the whole panel — the left-ruled italic excerpt cut at
a word and expandable in place, the **AI Work Breakdown** with the mockup's `~180k` and `12–18 min`,
the effort chip through the same map the table's row uses, the risk meter in the level's hue and
length with the level in words beside it, the workflow tag and the model pill as given; and `needs
human` is the err pill, the estimate that sent it there, and a trace opening in the error hue with
why. A `sized` answer carrying no estimate is drawn as `unsized` rather than as a breakdown over
nothing. The head's pill is the table's rule — `queued` first — so the panel and the row it was
opened from cannot disagree; the seeded `#485` therefore reads `queued`, as the table's does.

**Three actions, and a press asks every poll now.** **Queue for loop** is the bar's `queueUnder`
with one id — the contract makes the three queue affordances one write — and a refusal is drawn in
the bar's own sentence for the issue it names. **Re-estimate** is L.4's single re-estimate through
`reestimateIssue` in [`head-actions.ts`](app/issues/head-actions.ts), the fifth Server Action: a
forged id is refused before a path is built from it, a `403` is the role's sentence, a `404` says the
issue is gone, a `409` is reported as the thing asked for happening, a `429` carries the wait; it is
inert while the issue is `estimating…`. **Open on GitHub ↗** is the button primitive's link form
over `ghUrl`, in a new tab with `rel="noopener noreferrer"` — and the address is checked to be a
web address at the boundary rather than trusted into an `href`, inert with a reason otherwise. A
press that took publishes the same *ask again* signal the workspace switch does
([`summary-refresh.ts`](app/dashboard/summary-refresh.ts)), so the panel draws the `estimating…` the
service has already written at once, the table's pill follows, and the dashboard's queue card hears
about a queued issue — no `router.refresh()`, because everything the panel draws is the poll's. The
line under the actions clears when the state moves: *sizing again* over a breakdown that has already
landed would be a sentence about a moment that has passed.

**Keyboard and width.** `Enter` on a row opens the panel, which follows the table in the document,
so `Tab` from the row reaches it; every control in it is a native button, link or `<details>`; and
focus is deliberately not moved on open, since a reader arrowing through rows to compare them would
lose their place on every `Enter`. Below the mockup's break the panel stacks under the table, and a
long path or token wraps inside the column rather than widening it. The composed round trip — a
**Re-estimate** pressed in a browser and the pill watched round — is N.7's
([#121](https://github.com/NobuData/ouroboros/issues/121)).

### Every state the mockup does not show

The mockup draws a full backlog. Reality starts with no GitHub token, or a token pointed at no
enabled repository, or a first sync still running, or a repository with nothing open, or a filter
that matches nothing — and each is a different problem with a different fix
([#120](https://github.com/NobuData/ouroboros/issues/120)). All of them are drawn inside the table
card, from M.4's sync status ([`GET /api/v1/backlog/sync-status`](../ouroboros-rest/openapi.yaml))
read beside the page and carried by the table's poll afterwards:

```
no token     ─▶ "Connect GitHub to watch your backlog"  [Open settings] admin, inert: #141 · member: who can
no repos     ─▶ "Enable an org and repos to begin"      [Choose repos] → /login?workspace=… · member: who can
first sync   ─▶ "First sync running"                   busy · over rows: "First sync running — 120 open issues so far…"
0 open       ─▶ "✓ Backlog clear"                       the good kind of empty
0 matches    ─▶ "No issues match this filter"          [Clear filters] → the bar's own Clear all
paused       ─▶ banner: "Sync paused — GitHub's rate limit is reached." + M.4's sentence · "Resumes in about 20 minutes."
loading      ─▶ app/(app)/issues/loading.tsx: the head as itself, bars at the page's own geometry
```

**Which nothing it is** is [`app/issues/states.ts`](app/issues/states.ts)'s decision, in the order
M.4 ranks the reasons: the filter's doing first (a narrowed view of a backlog that has open issues is
the bar's problem whatever the sync is doing), then no token, then no repository, then a first sync
that has not delivered, then *clear* — honest only over a loop that is running and has synced at
least once — and the plain *no issues yet* for a pause the banner explains or a loop that never ran.
[`guidance.tsx`](app/issues/guidance.tsx) draws each as the #46 empty state with the control a reader
of this role can act on: **Choose repos** links to sign-in's step 2 opened on the workspace, which
exists; **Open settings** is drawn inert naming the issue that builds its destination, because the
ticket-source settings surface is [#141](https://github.com/NobuData/ouroboros/issues/141)'s and a
link to a `404` is the one thing #49 forbids; a member gets a sentence naming who can act instead of
an actionless admin button. **Clear filters** asks the bar to do what its own **Clear all** does,
through a signal ([`clear-filters.ts`](app/issues/clear-filters.ts)) rather than a link, since only
the bar can clear the header's focus repository and settle its search box in the right order.

**The banner is DASH-I.7's, and the reason is the service's.** Over the rows — or over an empty
state that is not itself the explanation — [`sync-banner.tsx`](app/issues/sync-banner.tsx) draws
the retry banner with the kind of pause as its headline and M.4's own sentence under it, so a
rate-limited source explains itself in the service's words whatever provider it is; a rate limit's
wait counts down against the reader's clock, as a relative time rather than the ticket's *Resumes
14:20*, because a clock time formatted on the server and again in the browser is a hydration
mismatch. Its one control is **Check again**, the poll asked now; and since the status rides the
same answer the rows do ([`backlog-page.ts`](app/api/backlog-page.ts) reads both in one ask), a
banner clears on its own when the pause ends. Nothing is said twice: when the empty state *is* the
guidance for the pause, the banner stays away. The freshness tag reads *syncing…* while the status
says a cycle is in flight, since a press would only be refused.

**The skeleton is the page's own geometry.** [`issues-skeleton.tsx`](app/issues/issues-skeleton.tsx)
draws the eyebrow and subline as themselves — copy that does not depend on the reads — and bars
where the reads land: the filter bar's three selects, four chips and search box at their own
heights, and the table as a head over the seeded nine rows, each six cells at the row's rhythm —
checkbox, title line over tags, effort pair, workflow tag, model pill, status pill — from rules in
`issues.css` that mirror the cells they stand in for, so the first paint does not jump. The filter
bar reports the address moving under its row (*Updating the backlog…*), navigating inside a
transition. Every state renders identically in both palettes, and the seeded personal workspace
— two enabled repositories and no token — shows the no-token guidance rather than an empty table.

## Model routing

`/models` ([#200](https://github.com/NobuData/ouroboros/issues/200)) is
[`docs/mockups/06-model-routing.html`](../docs/mockups/06-model-routing.html)'s **frame**: the
page head, the Models tab set, and the provider health strip — and, since
[#205](https://github.com/NobuData/ouroboros/issues/205), a designed answer for every state
the mockup does not draw (see [Empty, loading, failed and read-only](#empty-loading-failed-and-read-only)). It renders **inside** the
[app shell](#app-shell) and is reached from the sidebar's **Models** entry, which stopped being
a *soon* row on the commit that built this — retiring the `/models` placeholder
[#49](https://github.com/NobuData/ouroboros/issues/49) held for it.

```
MODELS
Route every kind of work to the model that earns it.  [ Simulate routing ] [ Save routes ]
Each task kind resolves to a primary model with…        ↑ opens the sheet   ↑ nothing staged
────────────────────────────────────────────────────────────────────────────────────────────
 Routing    Model registry soon   Providers & keys   Spend soon      ← sticky in the pane
 ▔▔▔▔▔▔▔ (the model purple)      ↑ a link since #227
(● Anthropic Claude 42ms) (● Cursor) (● GitHub Copilot error · elevated latency)
(● OpenAI-compatible · local vLLM  10.0.4.20 · vLLM local) (◌ Fresh connection unknown)
```

Below the strip, the routing matrix ([#201](https://github.com/NobuData/ouroboros/issues/201))
takes eight of twelve columns and a right column stacks the
[route inspector](#the-route-inspector-and-the-simulate-panel)
([#202](https://github.com/NobuData/ouroboros/issues/202),
[#203](https://github.com/NobuData/ouroboros/issues/203)), the
[escalation rules card and the spend card](#the-rules-card-and-the-spend-card)
([#204](https://github.com/NobuData/ouroboros/issues/204)).

### The strip is the page's one claim about the outside world

It is drawn from `GET /api/v1/routing/providers`
([#196](https://github.com/NobuData/ouroboros/issues/196)) — stored snapshots a scheduler in
`ouroboros-rest` writes on a jittered cadence. There is **no refresh control**, and that is a
decision rather than an omission: a *check now* button would let anybody holding a session make
the service issue outbound requests at whatever rate they can click, against a vendor's rate
limit and signed with the workspace's own credential.

Three rules keep it worth trusting, and each is a test rather than a comment:

1. **`unknown` never renders as healthy.** A connection nothing has checked is a real state
   (decision M8), and it differs from a healthy chip **three times over, none of them a hue**:
   a ring rather than a disc, a dashed boundary rather than a solid one, and the word *unknown*.
   Hue alone could not carry it — the palettes differ in lightness as much as in hue, and "a grey
   dot that reads as green in a hurry" is exactly the failure the state exists to prevent.
2. **A latency appears only where a check measured one.** `latencyMs` and `models` arrive `null`
   when nothing produced them and nothing supplies a default, so `0ms` — an excellent latency for
   a provider nothing has ever called — appears nowhere.
3. **The chip's line is the service's, rendered rather than re-derived.** The contract composes
   `meta` so that the strip and the route inspector cannot draw two different sentences from one
   row; a client that recomposed would *be* that second sentence.

Every chip carries its state in words as well as in hue. On a healthy chip the word is `sr-only`
— the mockup draws a bare `Anthropic ●`, and four chips announcing *healthy* would drown the one
that is not — so it is in the accessibility tree either way. Hovering any chip gives the last
check's UTC time, which question it answered, and the reason.

**A failed check is drawn in the error hue, not the mockup's amber.** The mockup's Copilot chip
reads *degraded · elevated latency*; `degraded` is a traffic-derived state
[#208](https://github.com/NobuData/ouroboros/issues/208) introduces and no check this product
performs can produce. The seeded row holds `error`, which the schema defines as *the last check
failed* — and drawing a failed check in the amber reserved for *needs attention* would
under-report every real outage on the strip.

### Save routes is disabled by a rule

`saveRoutesReason(pending)` is the whole of it. A save button that is always enabled teaches
nothing about whether there is anything to save; one hard-coded to *disabled* teaches that the
page is broken. `pending` is the route editor's count of routes that differ from what the server
holds ([#202](https://github.com/NobuData/ouroboros/issues/202)) — a chain edit or, since
[#203](https://github.com/NobuData/ouroboros/issues/203), a policy edit on the same draft — and
the control enables itself the moment it is above zero. **Simulate routing** answers to the same
shape of rule, `simulateReason(kinds)`: it opens the sheet for any member, and is inert with its
reason only for a workspace with no task kinds to ask about.

An inert head action carries `Button`'s `reason`, so it says what is missing rather than sitting
dead; the one unbuilt sibling tab is `SubnavSoon`, which does the same for a destination. The head
and the tab set themselves are the **section's** since
[#227](https://github.com/NobuData/ouroboros/issues/227) — see the next section.

### The route inspector and the simulate panel

Mockup 06's **ROUTE — implement-primary** card, whole
([#203](https://github.com/NobuData/ouroboros/issues/203)), around the chain
[#202](https://github.com/NobuData/ouroboros/issues/202) put in it:

```
ROUTE — implement-primary                               selected
① coder-max      → claude-fable-5 · Anthropic Claude  ●   Primary · healthy · 42ms
② coder-fallback → gpt-5-codex · GitHub Copilot       ●   Fallback on 5xx / timeouts
③ local-docs     → qwen3-coder:32b · Ollama · work…   ●   Offline mode — keeps the loop turning…
──────────────────────────────────────────────────────────────────────────────────
Allow fallback to local models                                              [on ]
Fail run instead of degrading below fallback 2                              [off]
Max cost per run  [$2.50    ]
Aliases resolve in the Model registry — routes never name raw models. Open registry →
[Simulate this route]
```

**The dots are the strip's read, indexed.** A route hop carries no status — the contract
publishes health once, on `GET /api/v1/routing/providers`, so that it cannot be shown two ways
at once — and the inspector looks each hop's connection up in the same read the strip above the
matrix is drawn from ([`app/models/inspector.ts`](app/models/inspector.ts)'s `hopHealthIndex`,
formed on the server). The dot wears `providerChip`'s treatment, its `title` is the strip's
last-checked detail, and `unknown` is a ring with the word here as it is there — as are an alias
bound to no provider, a strip that could not be read, and a connection the strip does not list,
each with its own hover.

**The line under a hop is the operator's note, or the hop's health line.** The seed stores hops
2 and 3's notes and leaves hop 1's null on purpose: the mockup's *Primary · API key valid, 42ms
to us-east* is a position, a state and a measurement, and a note that froze those would disagree
with the chip the first time a check ran. A hop with no note prints `Primary · healthy · 42ms` —
the role, the state's word and the service's composed `meta`, the shape the simulate panel's
kept-hop sentence takes.

**Policy edits join the dirty batch, and nothing on the card saves on change.** The two switches
and the cap edit the route editor's draft through the same path a hop move takes
([`app/models/chain.ts`](app/models/chain.ts)'s `setAllowLocal`, `setFloor`, `setMaxCost`), so a
flipped switch marks the row *changed*, counts in the bar, is discarded by **Discard** and commits
with **Save routes**. The floor is drawn as the mockup's sentence with the floor as its number —
`floorHopIndex` itself, the hop the rail prints — which becomes a select over the chain's hops
while the switch is on, and names the floor the switch would set (one above the last resort)
while it is off. The cap is parsed in whole cents by string arithmetic on every keystroke, refused
inline for a fraction of a cent or a `$0.00` (*a route that can never run*), and read as no cap
when the field is empty. A member sees every control in its real position, inert with one
reason.

**The simulate panel renders and never narrates.** [`app/models/simulate-sheet.tsx`](app/models/simulate-sheet.tsx)
takes a task kind, an effort, labels and a diff kind — the rules grammar's own vocabulary — and
asks Z.4's `POST /api/v1/routing/simulate` through a Server Action, sending only the facts the
reader set (an absent fact is *unknown*, never small, and never `null`). The answer is the
`Resolution` drawn whole: every hop kept or dropped with its explanation verbatim, dropped hops
struck through with the word beside them, every matched rule with *applied* or *did not apply*
and its reason, the votes, the floor's sentence, the cap. A **`fail_run` is the answer, not an
error** — the outcome chip, the failure's own sentence first, as a status and never an alert —
because a run that stops *and says why* is the whole point of the floor. The panel resolves the
routes as saved and says so above the form whenever the page holds an unsaved edit.

### The rules card and the spend card

Two cards, two different ways to lie, and [`app/models/rules.ts`](app/models/rules.ts) and
[`app/models/spend.ts`](app/models/spend.ts) are where each is stopped
([#204](https://github.com/NobuData/ouroboros/issues/204)).

```
ESCALATION RULES                                  3 active
effort ≥ L → implement uses coder-max (max thinking)   [on]
security label → review adds second-opinion vote       [on]
docs-only diff → everything routes local               [on]
[+ Add rule]              ← when ▾ · then ▾ · target ▾ — selects, no text box

SPEND BY PROVIDER · 30D                     [Full report →]  ← inert, names #210
Anthropic                        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  $412.80
GitHub Copilot                   ▓▓▓                $76.00
Cursor                           ▓▓                 $64.10
Local (Ollama + OpenAI-compatible) ▓ (ok)   $0.00 · 5 unpriced calls
Local models served 31% of all tokens.
```

**The rules card renders sentences, and never composes one.** Every line is the database's
generated `display` (V018), which the contract refuses in a request body; the only thing the
card decides about a sentence is which run of it is the alias, and that is derived from the
rule's *structure* (`then.use_alias.alias`) rather than from the text. The **+ Add rule** dialog
composes structure from selects — a predicate and its operand, an action, and the target the
action names — and `composeRule` is total over every value those selects can hold, so an
invalid combination is unreachable rather than refused after the press. The one typed value is a
GitHub label name, which is an operand the grammar takes from outside the product's vocabulary,
not a sentence. There is no preview: the server writes the sentence when the rule is saved, and
the card prints what comes back.

The switches are optimistic on the [auto-merge switch's](#dashboard) pattern — a flip that did
not persist goes back and says why — and every write goes through a Server Action in
[`app/models/rule-actions.ts`](app/models/rule-actions.ts), because the browser cannot reach
REST. The role gate is the service's; what the page does with the role is **absence**: a
`member` sees the rules and the count, the word *off* beside a suspended one, and no switch,
builder or delete — not a disabled control, because a rule's position is already in the
sentence's treatment and the count, and a control somebody cannot use is not a way to show it.
Deleting asks first, and the confirmation says what the switch is for.

**The spend card renders money, and keeps two zeros apart.** `spendCents: 0` is calls priced
at nothing and prints `$0.00`; `spendCents: null` is calls nobody priced and prints the word
*unpriced* in its own treatment — a dashed underline, and a dashed track where the meter would
be — so a reader scanning the column cannot take it for a figure. A row can carry both facts,
and the seeded local row does: `$0.00` from 260 calls priced at nothing, beside *5 unpriced
calls*. A workspace that has spent nothing gets a sentence, not four rows of `$0.00`. The meters
are the service's widths relative to the largest row, floored at a visible sliver so the local
row's ok-meter can be seen; the footnote is computed from the served share, `<1%` rather than
`0%` for a share too small to round. **Full report →** is a `Button` with a `reason` naming
[#210](https://github.com/NobuData/ouroboros/issues/210), because an inert link has no honest
rendering.

Two of the seeded figures are not mockup 06's — Copilot reads `$76.00` and Cursor `$64.10`
rather than `$96.40` and `$54.10` — and the reason is upstream: a thirty-day window contains the
calendar month it is asked to be smaller than, so the mockup's two figures are unreachable from
any ledger that also satisfies mockup 07's (see the Z.5 note in
[`docs/ROADMAP_MOCKUP_06_MODEL_ROUTING.md`](../docs/ROADMAP_MOCKUP_06_MODEL_ROUTING.md)). The local
row is named from the kinds the ledger records — *Local (Ollama + OpenAI-compatible)* — rather
than the mockup's *vLLM*, because the ledger knows the adapter, not the product behind it.

### Empty, loading, failed and read-only

Mockup 06 draws the busy state and nothing else. The other four
([#205](https://github.com/NobuData/ouroboros/issues/205)) are the ones a real workspace
spends its first week in, and [`app/models/states.ts`](app/models/states.ts) decides which the
page is in from its two reads — `failed`, `no-providers`, `no-routes` or `populated` — so each
is a unit test on a small object and one thing the screen draws.

```
Viewing routing as a member. Routes, policies and escalation rules are changed by…   ← read-only
No providers are connected. … connect one on Providers & keys.                       ← the strip
┌ SET UP ROUTING ──────────────────────────────────┐  ┌ ESCALATION RULES   0 active ┐
│ Routing needs a provider connection               │  │ No escalation rules         │
│ ① Connect a provider (next)   [Providers & keys →]│  └─────────────────────────────┘
│ ② Seed the default routes (then)                  │  ┌ SPEND BY PROVIDER · 30D ────┐
│ ─ Exploring locally? … acme-robotics …            │  │ No spend recorded           │
└───────────────────────────────────────────────────┘  └─────────────────────────────┘
```

**The guidance is one card with two steps, and the strip decides which is next.** The
personal workspace's seed — no providers, no kinds, no routes — lands on step one, and
**Providers & keys →** is a link into the surface AE.1 built (the ticket asked for an honest
pointer to a page that did not exist then; the honest pointer now is the link). A provider
connected ticks step one off with the count and makes step two next; a strip that could not
be read marks step one *unknown* with a dashed ring rather than guessing either way, the
strip's own M8 rule carried onto the path. The right column keeps its zero-states beside the
card, so the populated page is approached rather than jumped to.

**Seed default routes is drawn inert, with its reason printed under it.** A task kind is a row
nothing in the routing contract writes — `PUT /api/v1/routing/routes` refuses a kind the
workspace does not have — and the eight defaults come from `R__dev_seed_routing.sql` and
nowhere else. Until the service can write them, the control says so (§ 3.5) rather than
opening a flow that ends in a `422`; the day it can, the handler is the one edit this page
needs.

**A refused matrix is the dashboard's banner, once.** The DASH-I.7 shape is a primitive now —
[`app/ui/retry-banner.tsx`](app/ui/retry-banner.tsx), which the dashboard's stale-data banner
draws through too — and [`app/models/routing-banner.tsx`](app/models/routing-banner.tsx) puts
it above the strip with the page's one retry (`router.refresh()`, so a selected row survives).
The matrix's seat says what is missing and points up; the reason is said once. *Could not be
read* wears the banner and *empty* wears the guidance card, and the two cannot be mistaken.

**The skeleton is the page's own shape, behind a route group.**
[`app/models/models-skeleton.tsx`](app/models/models-skeleton.tsx) draws the head and the tab
set **as themselves** — their copy does not depend on the reads — and reserves the strip's
five chips, the matrix's eight rows at the table's own cell padding, the inspector's empty
seat, three ruled rule rows and four metered spend rows, in tokens and rem so the reservation
holds at 125%. It is returned by
[`loading.tsx`](<app/(app)/models/(routing)/loading.tsx>) inside a `(routing)` group, because
a `loading.tsx` wraps every child segment too and one at `models/` would have stood in for
the providers page at the wrong geometry. The group changes no URL.

**Read-only is a rendering mode, and the role is explained.** A member's page has no handle
column, no **Save routes**, no dirty bar, no move/remove/swap/add on the chain and no switch,
builder or delete on the rules — absence, not disabled controls — with the policy switches the
one place the disabled-with-reason rule applies, because a position has no other carrier. The
page names the role once, under the tab set: *Viewing routing as a member.* and what that
means here. `mayAdminister` is still the only decision; the name is printed, never decided
from.

## Providers & keys

`/models/providers` ([#227](https://github.com/NobuData/ouroboros/issues/227)) is
[`docs/mockups/07-providers.html`](../docs/mockups/07-providers.html)'s **frame**: the page
head with the security model's sentence in it, the two head actions, and the Models tab set
with **Providers & keys** live. It is the section's second page, and the first thing it proves
is that the section *has* pages: the head and the tab row are
[`app/models/models-frame.tsx`](app/models/models-frame.tsx)'s now, drawn once for both, so
`/models` and `/models/providers` differ in exactly what mockups 06 and 07 differ in.

```
MODELS
Providers & keys                                        [ Audit log ] [ + Add provider ]
Credentials live in Acme Robotics's encrypted vault,      ↑ AD.4's sheet   ↑ AE.5's catalog
scoped to this workspace. Keys never leave the control
plane — workers never receive them at all.
────────────────────────────────────────────────────────────────────────────────────────────
 Routing → /models   Model registry → /models/registry   Providers & keys   Spend soon
                                                            ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ (the accent)
┌ [AN] Anthropic Claude      (connected) [on] ┐   ┌ [CU] Cursor              (connected) [on] ┐
│ [••••Xq4A] [Reveal] [Rotate]                │   │ …                                         │
│ Added by Ken · 2026-06-12 · last used 3m ago│   └───────────────────────────────────────────┘
│ MODELS AVAILABLE (claude-fable-5)… (priority tier)  ┌ [GH] GitHub Copilot   (error) [on] ┐
│ This month $412.80 of $600 cap ▓▓▓▓▓▓▓░░░   │   │ This month $76.00 of $95 cap ▓▓▓▓▓▓▓▓░ │
│ [Test connection]          Monthly cap [$600]│   └ (warn meter, at 80%) ─────────────────┘
└─────────────────────────────────────────────┘   ┌ + Connect Anthropic, Ollama, …          ┐
  … vLLM (Base URL + optional key), Ollama (Host, pull-list) …   │  [ Browse catalog ]  │
```

### The subline is not this module's to write

It is the sentence that makes the security claim, and the mockup's version — *"workers only
ever see short-lived tokens"* — describes a system this is not. AD.5
([#226](https://github.com/NobuData/ouroboros/issues/226)) owns the wording:
[`../docs/SECURITY_MODEL.md` § 8.2](../docs/SECURITY_MODEL.md#82-the-page-head-subline) is
rendered **verbatim**, with `{workspace}` filled from the active membership's display name and
nothing else touched. `__tests__/providers/view.test.ts` reads the document and compares, so a
change to either that is not a change to both fails the suite — which is the document's own
rule: a change there is a change to the product's claims.

Two consequences are worth knowing. The possessive is the template's (`{workspace}'s`) and is
applied as written, so the seeded workspace reads *Acme Robotics's* — an apostrophe rule would
be an adjustment to copy that is not the UI's to adjust, and belongs in § 7.2 if it is wanted.
And the name is substituted literally rather than through `String.replace`'s pattern syntax,
because a name is data and `$&` in one must not read the placeholder back into the sentence.

### Both directions, from one list

The Models tab set is one list (`MODELS_TABS`, [`app/models/view.ts`](app/models/view.ts))
drawn by one component ([`app/models/models-subnav.tsx`](app/models/models-subnav.tsx)), and
each page says only which tab it *is*. That is what makes the ticket's criterion — tab states
correct navigating 06 → 07 and 07 → 06, and 06 ⇄ 21 ⇄ 07 once the registry landed — a property
rather than a coincidence: the pages' rows differ in `aria-current` and in nothing else, and a
built surface's id is a type (`ModelsSurface`), so no page can claim a tab that leads nowhere.
The sidebar's **Models** entry stays lit on all three because the route is *under* `/models`
([`app/paths.ts`](app/paths.ts)), which is the sidebar's ordinary section rule and not a
special case.

The registry tab went live with CI.1 ([#591](https://github.com/NobuData/ouroboros/issues/591))
and this file did not change for it — one list, so all three pages learned it at once. The
spend report ([#210](https://github.com/NobuData/ouroboros/issues/210)) is the last honest
`soon` tab. Below the tab set are [the provider cards](#the-provider-cards)
([#228](https://github.com/NobuData/ouroboros/issues/228)); in the head, **Audit log** is
[the trail](#the-credential-audit-trail), mounted where it was built to be, and
**+ Add provider** — with the dashed card's **Browse catalog** beside it — is
[the add-provider flow](#the-add-provider-flow).

### The provider cards

One component, `ProviderCard` ([`app/providers/provider-card.tsx`](app/providers/provider-card.tsx)),
drawn once per connection ([#228](https://github.com/NobuData/ouroboros/issues/228)). Five
cards look like five components, and written that way they drift apart by the second sprint —
so the card is **composed from the adapter's own answers**, which cross the wire on the
catalog entry, and there is no provider kind in the component and no branch on one. Every
decision is a pure function in [`app/providers/cards.ts`](app/providers/cards.ts), and the
proof the ticket asks for is a test rather than a promise: `__tests__/providers/provider-card.test.tsx`
feeds the card a **sixth connection of the conformance kit's fake adapter** — a kind no file
under `app/providers/` names — and reads a correct card off it with zero changes to card code.
The same suite reads the two components' source with their comments stripped and fails if any
of V015's six spellings appears.

**What decides each region.** The catalog entry's `fields` decide the key row: a `url` field is
an address row under whatever label the adapter titled it — *Base URL* on the vLLM card, *Host*
on Ollama's — and the `secret` field is the masked key row, with the mockup's **Reveal** and
**Rotate** (or **Save**, for an optional key left empty) live since AE.3 ([the key management
flows](#the-key-management-flows), [#229](https://github.com/NobuData/ouroboros/issues/229)).
The entry's `capabilities.pull`
decides whether the models region is chips or Ollama's pull-list, and its `capabilities.discovery`
whether that region offers a **Refresh models** at all (a fixed catalog has nothing to refresh)
— both live since AE.4 ([the live surfaces](#the-live-surfaces),
[#230](https://github.com/NobuData/ouroboros/issues/230)). Whether a cap exists decides
between a meter and an em-dash. The monogram's two letters and tint are the one thing written
per kind, and they are *copy*: a token map with a fallback that derives an unknown kind's
letters from its own name in the neutral tint.

**What the cards read.** [`app/providers/data.ts`](app/providers/data.ts) composes seven
readings — the listing, the catalog, the health strip, the month's spend, the registry's
aliases (each card's dependent routes, for AE.3's delete guard and switch-off confirm), each
connection's models, and each *pulling* connection's pulls in flight — under the rule every
reader here keeps: one failed read is one degraded region. A catalog that could not be read leaves every key row under a fallback label; a month
that could not be read leaves every meter at *no spend recorded*; one card's models failing
says so on that card. The listing failing is the one read the grid cannot survive, and it says
so where the grid would be. Three of those readings are new to the contract with this issue
and were added to `ouroboros-rest` on #231's precedent: each catalog entry carries the
adapter's four **capability flags**; each connection carries **`addedByName`**, so the meta row
prints *Added by Ken* and never an id; and `GET /api/v1/providers/spend` answers the **UTC
calendar month's** spend per provider kind — decision **P7**'s window, computed by the same
statement as the routing page's thirty-day card with one instant changed, and the window
`tests/seed.sql` asserts the seeded meters against.

**The honesty rules, per region** (decision **P8**). The meter prints priced spend only: the
seeded cards read `$412.80 of $600 cap` at 69%, `$64.10 of $120 cap`, and `$76.00 of $95 cap`
on the warn meter at exactly 80%. A cloud kind nobody priced reads *unpriced*, never `$0.00`.
A local kind reads *no metered spend* beside its on-box tokens — `2.1M tokens on-box` for the
seeded Ollama card — because `$0.00` and *we do not meter this* are different facts and only
the second is true of a machine the workspace already owns; real money on a local kind is
still printed, because money is never hidden. A null cap is an em-dash in the foot's read-only
**Monthly cap** field, not `$0`. The `priority tier` pill exists only where discovery reported
a `tier` on a model — the four seeded Anthropic rows carry the real signal, nothing else does
— and the `· 4 seats` suffix only where a check's detail carries a count, read by the same
spelling the service writes it in (`provider.entitlements.ts`). A connection never used shows
an em-dash for last-used, and every relative time is measured from the one instant the reader
took, so a server render and its hydration agree. The status pill is `connected` for an active
connection (the taxonomy's own word) and the health strip's words for the other three, with
the last check's detail on hover — except that an `error` whose snapshot carries the class a
test wrote draws the taxonomy's finer pill, `degraded upstream` or `key rejected`, which is
how the mockup's Copilot card earns its word after a reload (AE.4).

**The switch persists.** [`app/providers/provider-switch.tsx`](app/providers/provider-switch.tsx)
is the dashboard's auto-merge switch to the line — optimistic, reconciled by `router.refresh()`,
a refused press going back with the reason under it — over a Server Action
([`app/providers/card-actions.ts`](app/providers/card-actions.ts)) that `PATCH`es `{ enabled }`
and nothing else. A switched-off card dims and says under its switch that routing skips it,
which is the service's own rule (resolution reads `where enabled`, V018) made visible. A member's
switch renders in its real position, read-only, with the reason. **The switch-off now asks
first** when routes resolve through the connection (AE.3): disabling has the same practical
effect on a running loop as deleting, and unlike delete the service has no guard to catch it,
so the confirmation names the routes.

#### The live surfaces

**Test connection, the chips' refresh, and the Ollama pull-list — the places where the card
stops describing stored state and starts reflecting the world** ([#230](https://github.com/NobuData/ouroboros/issues/230),
decisions **P6** and **P9**). Three client islands on the server-rendered card, over one
`"use server"` module ([`app/providers/live-actions.ts`](app/providers/live-actions.ts)) and
one pure decision module ([`app/providers/live.ts`](app/providers/live.ts)), on AE.3's
pattern; and five routes added to `ouroboros-rest` for them (0.30.15 → 0.30.16), because the
adapter's three questions can only be asked by the module that resolves a connection for a
workspace and opens its credential for one call.

```
[Test connection] ─▶ POST …/test ─▶ ✓ 200 · 38ms   △ 503 upstream · retrying   ✗ key rejected (401)
                                  └─▶ written to the strip's snapshot ─▶ router.refresh() ─▶ pill
MODELS AVAILABLE  [Refresh models] ─▶ POST …/discover ─▶ chips enter/leave · ⚠ alias local-ds still points here →
DETECTED MODELS   qwen3-coder:32b [19 GB] [Pull latest] ─▶ POST …/pulls ─▶ ▓▓▓▓▓▓░░░░ 61% ─ polled ─▶ ✓ pulled
                  phi4:14b        [9.1 GB] queued…                                   ← reload: still 61%
```

**The note is the service's sentence, and a provider that is down is a `200`.**
[`app/providers/test-connection.tsx`](app/providers/test-connection.tsx) presses
`POST /api/v1/providers/{id}/test`, which runs the adapter's own `validate` — a models-list
or a version ping, never a completion — and answers *whatever it found* as a value: the
status the column was set to, the pill, the note composed through the taxonomy, the measured
latency (only on a pass; a failure has none, by design), and the class. The island adds the
glyph and the `· 38ms` and draws the note whole; because the service wrote the answer to
`provider_connections.status` and the health snapshot before answering, the island then asks
the router to re-read the card, which is how the head's pill and the chips change without the
foot knowing how to draw either. The snapshot gained an `errorClass` probe key for this, so
the finer pill survives a reload and the routing page's strip describes the same measurement.
**`· retrying` is the taxonomy's word, and the card gives it exactly one bounded retry**:
an `upstream` failure earns one automatic re-test after `RETRY_DELAY_MS`, drawn busy while it
waits; a `429`, a closed socket and a refused key earn none, because retrying those is either
what a rate limit asks you not to do or a wait that changes nothing. Testing is an
administrator's; a member's button is inert with the reason, and the API is the enforcer.

**Discovery replaces the catalog, and the alias is what is flagged.** After a pass the same
Server Action runs `POST …/discover`; **Refresh models**
([`app/providers/models-region.tsx`](app/providers/models-region.tsx)) runs it on demand,
hidden where the adapter's `discovery` flag is false because a fixed catalog has nothing to
refresh. The service upserts what the provider reported on V017's key and **deletes what it
no longer lists** — `provider_models` is discovery's report of what exists, and the registry,
alias validation and the import wizard all read it as exactly that — and answers `unlisted`:
every alias on the connection whose model the catalog no longer holds. The island draws a chip
that appeared entering and keeps a vanished one drawn, leaving, for `CHIP_LEAVE_MS` before it
goes (motion only where the reader allows it), and draws each stranded model as
[`app/providers/unlisted-flag.tsx`](app/providers/unlisted-flag.tsx): the id in the warn tone,
*not listed upstream*, and a link to the alias on the registry page (`aliasPath`, a query
parameter the alias table will honour when CI.2 lands). Nothing is flagged on a connection
nothing has discovered on — a gap is not a mismatch. A provider that did not answer its list is
`502 provider_discovery_failed`, **the list is unchanged**, and the region says so with the
provider's own phrase.

**Progress lives on the server, and the page polls it.**
[`app/providers/pull-list.tsx`](app/providers/pull-list.tsx) is the Ollama card's rows — mono
name, the size in bytes turned into `19 GB` / `9.1 GB` by `sizeTag` (decimal, as `ollama list`
prints them), **Pull latest**. A press asks `POST …/pulls`, which answers at once with the
record AC.4's tracker holds — `running`, or `queued` behind the connection's one active pull —
and from then on the list polls `GET /api/providers/{id}/pulls`, a route handler on this origin
([`app/api/providers/[id]/pulls/route.ts`](app/api/providers/[id]/pulls/route.ts)) for the
reason the dashboard's summary poll is one, every `PULL_POLL_MS` while anything moves. The
reader hands a pulling card its records *with the page*, so **a reload mid-pull lands on the bar
at the transfer's real percentage** rather than on an idle button, and the list stops polling by
itself when nothing is in flight. The bar is a `progressbar` announcing `llama4:scout · 61%`,
indeterminate while the daemon has not yet said how big the transfer is; a finished pull is
`succeeded`, not `100%` — the daemon's last line carries no counts and the service reports what
it said. When a pull lands the service re-runs discovery itself, whether or not a page is still
watching; the list waits `PULL_SETTLE_MS` and re-reads the card, which is how the new size
reaches the row. Queue management proper — ordering, cancellation, disk awareness — is AF.5's
(#238); the e2e leg that stops the compose Ollama and pulls a real model is AE.7's (#233).

#### The key management flows

The security-critical half of the card — **Reveal**, **Rotate**, the address **Save**, and the
overflow menu's **Delete** — is AE.3 ([#229](https://github.com/NobuData/ouroboros/issues/229)),
and it makes AD.2's ([#223](https://github.com/NobuData/ouroboros/issues/223)) safety rails
*visible* rather than trusting them silently. Each control is a client island of the otherwise
server-rendered card; the copy and every refusal-to-sentence mapping live as pure values in
[`app/providers/keys.ts`](app/providers/keys.ts), and the server hops are one `"use server"`
module, [`app/providers/key-actions.ts`](app/providers/key-actions.ts), on `card-actions.ts`'s
posture — a refusal is a value the control draws, never a rejection that replaces the page.

- **Reveal** ([`key-row.tsx`](app/providers/key-row.tsx)) is `masked → step-up → shown →
  masked`. A click asks `POST /api/v1/providers/{id}/reveal`; without a recent
  re-authentication the service answers `401 step_up_required`, which
  [`app/api/errors.ts`](app/api/errors.ts) is careful **not** to read as a session gone — it is
  the one `401` that is a challenge to act on in place rather than a sign-out. The
  [`step-up-dialog.tsx`](app/providers/step-up-dialog.tsx) offers the two methods BetterAuth
  gives this build and no third: a password confirmed through the service, or a fresh sign-in
  (a sign-out with this page as the return-to — the only method a GitHub-only account has). A
  **wrong password answers exactly as an absent one**, so the dialog can only re-challenge. A
  revealed value carries a **countdown** (off the service's own `expiresAt`, driven by the
  shell clock so there is one interval per page, not one per row), a visible **audited-notice**,
  and a **copy** button that claims nothing about the clipboard — and it **auto-masks on the
  timer and on navigating away**, by clearing the value from state so it is not merely hidden.
- **Rotate** ([`secret-dialog.tsx`](app/providers/secret-dialog.tsx)) renders a state machine
  honestly: `entering → validating → swapped`, or `entering → validating → failed`. The
  service verifies the new key with the provider before one conditional `UPDATE` retires the
  old one, so a failure means the old key is still live — and the failed state **says so**,
  standing *your existing key is still active* beside the provider's own reason, not a toast.
  The same dialog stores a first key on a connection whose adapter left the credential optional
  (the vLLM card's **Save**). A success updates the masked suffix without a reload.
- **Base URL / Host** ([`address-row.tsx`](app/providers/address-row.tsx)) saves with the same
  validate-on-save discipline — the service checks the address and asks the provider at it
  before writing, so a bad endpoint does not overwrite a working one, and the row says the
  working address is unchanged on a refusal.
- **Delete** ([`card-menu.tsx`](app/providers/card-menu.tsx), on `app/shell/menu.ts`'s ARIA
  menu pattern) carries the dependency guard: the service returns `409` naming the aliases that
  still resolve through the connection, and the dialog lists them and links to routing rather
  than showing a bare failure.
- **A member sees none of these affordances**: the buttons, the menu and the editable address
  are all gated on `mayAdminister`, and the service is the enforcer behind the presentation.

**Responsive and rem.** The grid is two cards abreast collapsing to one at a rem breakpoint,
so at the 125% font-scale step it gives up its second column sooner, which is the point. Every
size on the card is a token or a rem; the monogram tints are the token sheet's published
`-line` / `-tint` triples rather than the mockup's `color-mix()`, so both palettes carry
measured contrast. Both palettes render byte-identical markup, and `providers-styles.test.ts`
holds the sheet to each of those agreements.

### The add-provider flow

**+ Add provider** and **Browse catalog** open one dialog
([#231](https://github.com/NobuData/ouroboros/issues/231)): a catalog of provider kinds, a
form behind each tile, and a done step. Three properties are what the ticket is about, and
each is a test rather than a promise.

**The tiles derive from the adapter registry.** `ouroboros-rest` answers
`GET /api/v1/providers/catalog` from its registry — one entry per registered kind, each
carrying the form its adapter's `configSchema()` derives to — and
[`app/providers/catalog.ts`](app/providers/catalog.ts)'s `catalogTiles` draws one tile per
entry with nothing added. There is no list of kinds anywhere in this module to be absent
from, which is what makes decision **P1** true at the surface: the conformance kit's fake
adapter, registered under `custom`, comes out of the catalog with a working form, and
`__tests__/providers/add-provider.test.tsx` drives the dialog with it as the proof. The three
kinds mockup 07's dashed card promises — OpenAI, Google, Bedrock — are honest `coming soon`
tiles: plain list items, not buttons, naming AF.3
([#236](https://github.com/NobuData/ouroboros/issues/236)) as where they come from, and each
retires itself the moment the registry answers its kind.

**The form is the adapter's, with no per-kind UI code.**
[`app/ui/schema-form.tsx`](app/ui/schema-form.tsx)'s `SchemaFields` draws a column of fields
from the entry's list — `text`, `url`, `secret` and `select`, the four widgets the service's
form dialect derives — onto the field primitives with the constraints the browser enforces.
It is a primitive rather than the dialog's own component because WF-S.4
([#150](https://github.com/NobuData/ouroboros/issues/150)) needs the same thing for workflow
node types; the one field the dialog adds is **Name**, the card's heading, which is a fact
about the connection rather than a provider setting.

**A bad key never creates a card.** The service asks the provider before it writes
(`POST /api/v1/providers`), so a refusal means nothing was stored — and the dialog says so,
keeps the form open with every value where the reader left it (the inputs are uncontrolled),
and puts the adapter's designed error where it belongs: *key rejected (401)* under the key
row, a schema violation under the field it names. Before the provider is asked, a submission
of the same kind at the same endpoint as an existing connection is stopped once with a
warning and **Connect anyway**; it is legal, and usually a mistake. Success is a step rather
than a closed dialog, because somebody has just handed over a key and deserves a sentence
saying it took; **Done** refreshes the route, and the new card is in the grid behind it.

For a `member` or a `viewer` both openers are inert with the reason, and the dialog never
opens; the gate that enforces is the service's `403`, which
[`app/providers/add-actions.ts`](app/providers/add-actions.ts) hands back as a sentence.

### Caps, the strip, and the states

AE.6 ([#232](https://github.com/NobuData/ouroboros/issues/232)) is the last of the page's
surfaces: the foot's **Monthly cap** goes live, mockup 07's security strip is drawn under the
grid with the copy the security model approved, and every state the page can be in that is
not *five cards* is designed rather than blank.

```
 This month            $76.00 of $95 cap · 4 seats ⓘ ← "Warning only — enforcement arrives with invocation."
 ▓▓▓▓▓▓▓▓░░ (warn, 80%)                              ↑ CAP_WARNING_ONLY, removed by AF.4 (#237)
 ─────────────────────────────────────────────────────────────
 [Test connection]                       Monthly cap [   $95]  ← blur or Enter saves; empty → null (—)
                                                                  $0 → zero, a real cap

 ◈  Keys are sealed per-tenant with envelope encryption (AES-256-GCM). Workers never see
    your keys — every provider call is made by the control plane, and your keys never
    leave your deployment.                 [self-hosted]        [ Read the security model ↗ ]
```

**The cap is parsed in the browser, stored in integer cents, and null is not zero.**
[`app/providers/caps.ts`](app/providers/caps.ts)'s `parseCap` reads `$95`, `95` and
`1,250.50`, computes cents in integers rather than through a float, refuses a word, a negative
or a third decimal with a sentence under the field and no round trip, and mirrors the
contract's `int32` ceiling. An emptied field stores `null` — *no cap*, the em-dash, which the
editable box shows as its placeholder — and `$0` stores zero, a real cap meaning *spend
nothing*; a lone `$` is refused rather than read as *clear*. The field
([`app/providers/cap-field.tsx`](app/providers/cap-field.tsx)) commits on blur and on Enter
and puts the stored value back on Escape, because a Save button beside a 92-pixel input would
double its width. The write is `card-actions.ts`'s second hop, a `PATCH { monthlyCapCents }`
and nothing else.

**The meter moves before the server answers.** The meter and the field share the cap through
a context — `CapScope` holds it, `CapMeter` reads it, `CapField` writes it — so the card, a
Server Component, still places each where the mockup does and stays a description of a card.
The card model carries the meter's *inputs* rather than a decided line, and `cards.ts`'s
`meterFor` is one pure function the server calls for the first paint and the island calls
again with the cap just typed. The optimistic cap lives exactly as long as the transition that
set it: a refused save goes back on its own with the reason under the field, and
`router.refresh()` brings the stored figure with the re-read.

**Decision P7, in two places, and one deletion removes both.** Caps are stored, they meter,
and they warn — and nothing stops spend until the invocation gateway (AF.2,
[#235](https://github.com/NobuData/ouroboros/issues/235)) and the spend gate (AF.4,
[#237](https://github.com/NobuData/ouroboros/issues/237)) exist. A cap field that silently
does nothing is a trap for exactly the person who cared enough to set one, so
`CAP_WARNING_ONLY` is the `ⓘ` after every capped meter's note and the editable field's
description and tooltip. AF.4 deletes the constant; everything that names it then fails the
typecheck.

**The strip is `docs/SECURITY_MODEL.md` § 7.1, verbatim, with no unearned badge.**
[`app/providers/security-strip.tsx`](app/providers/security-strip.tsx) draws the shield, the
sentence with its one emphasis, a tag row of exactly one word, and the ghost link to the
document — from constants in [`app/providers/view.ts`](app/providers/view.ts) that
`__tests__/providers/view.test.ts` holds to the document by reading it, as it already did for
the subline. The mockup's `SOC 2 Type II` and `ISO 27001` are absent because § 7.3 withdrew
them: a certification badge renders only when the certification exists, carries its date, and
comes down when it lapses — until then the slot renders nothing, not a hedge.
`security-strip.test.tsx` is the review at the surface: it greps the rendered strip for `SOC`,
`ISO`, `KMS`, `15-minute` and `token` and finds none.

**The states are decided in [`app/providers/states.ts`](app/providers/states.ts) and
explained once.** `providersState` is `failed`, `empty` or `populated` from the listing alone,
because it is the one read the grid cannot survive; `degradedReads` names whichever of the
four grid-wide reads failed — the catalog, the health strip, the month, the aliases — and the
page draws the DASH-I.7 banner ([`app/providers/providers-banner.tsx`](app/providers/providers-banner.tsx))
for either, with the service's sentence once and the page's one retry. *Could not be read*
wears the banner and a seat that points up; *empty* wears the guidance — **Connect your first
provider**, across the whole grid, with **+ Add provider** on it for an owner or admin and a
sentence naming who can act for a member. The dashed card is not drawn beside the guidance
(two doors to one dialog in one view) and returns with the first card. A member's page names
the role once under the tab set, the routing page's note on this page; every control that
would write is drawn switched off with its reason as the tooltip, the address field a member
cannot edit now says why too, and the key actions and the card menu are not drawn at all. A
switched-off card's frame goes dashed as well as dim — the sheet's *not in play* treatment —
so it is tellable from a degraded one, which stays solid at full ink with its warn or error
pill.

**The skeleton is the card's own anatomy.**
[`app/providers/providers-skeleton.tsx`](app/providers/providers-skeleton.tsx), behind
[`loading.tsx`](<app/(app)/models/providers/loading.tsx>), draws five card shapes from the
card's region classes with bars at the box of each control in rem, the dashed card's shape
after them, and the strip as itself. The head is the real head with one slot: the workspace's
name is the one word the skeleton cannot know, so § 7.2's sentence is drawn around a bar the
width of a name and wraps on the same line before and after the data lands — the reason
`ModelsFrame.subline` is a `ReactNode`. The file sits beside the page rather than in a route
group because `providers/` is a leaf segment.

## The credential audit trail

Mockup 07 puts an **Audit log** ghost action in its page head beside **+ Add provider**, and
AD.4 ([#225](https://github.com/NobuData/ouroboros/issues/225)) is what turns it from a button
into the visible end of a trail that starts at every key operation.

```
[ Audit log ]  ← press
┌──────────────────────────────────────────────────────────────────────── sheet over the pane ─┐
│ Credential audit log                                                                          │
│ Every credential operation in this workspace, newest first. Refusals are recorded too.        │
│ No entry ever holds a key.                                                                    │
│                                                                                               │
│ When (UTC)        Who          What                                          Provider         │
│ 2026-08-24 16:13  Ken Suenobu  revealed the credential                       anthropic        │
│ 2026-08-24 15:23  —            was granted a provider lease                  ollama           │
│ 2026-08-22 10:53  Maya Chen    rotated the credential  [refused · provider_validation_failed] │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

### It ships as a head action, because the page is somebody else's

`/models/providers` is AE.1's ([#227](https://github.com/NobuData/ouroboros/issues/227)), and
it had not landed when the trail did. Rather than invent a page frame that ticket would then
hand over, `<AuditTrail />` is **the button and its sheet as one element**: AE.1 now renders
it in its own page head ([`app/providers/providers-screen.tsx`](app/providers/providers-screen.tsx))
and nothing in [`app/providers/audit-trail.tsx`](app/providers/audit-trail.tsx) changed when
it did. It stays mounted at `/workshop/providers-audit` as well, which is the role
[`app/workshop/chrome-story.tsx`](app/workshop/chrome-story.tsx) plays for a primitive: the
element on its own, without the page around it.

The sheet's frame is [`ShellOverlay`](#app-shell)'s rather than a new one — the portal above
the pane, the scroll lock, the focus trap, Escape and focus restoration are one implementation
in this product, and the keyboard-shortcuts sheet is the same file with different content
inside.

### It reads when opened, and again on every open

A page-load read would make every visit to the providers page pay for an audit query — one a
`viewer` or a `member` is not even allowed to make, so most of them would be `403`s discarded
before render. And a trail is a moving surface: somebody opening it twice during an incident
wants the second read to include what happened in between, so nothing is cached. The cost is a
line saying *Reading the trail…* the first time, which is the honest trade for a surface whose
job is to be available when it is wanted.

The read is a Server Action ([`audit-actions.ts`](app/providers/audit-actions.ts)) taking **no
arguments at all**: there is no workspace in the call and no person, so there is nothing to
forge — the trail belongs to the workspace the caller's own session is acting in, and the role
gate is `ouroboros-rest`'s.

### Four ways a trail lies, and what stops each

[`app/providers/view.ts`](app/providers/view.ts) is where the sheet's judgements live, and it
is organised around them:

| It would lie by… | What stops it |
|---|---|
| inventing an actor | `actorOf` answers `—` where there is none, and never an id — a lease grant never had one, and a deleted person leaves none behind |
| rendering an unknown action | `SENTENCES` is `Record<AuditAction, string>` over the contract's own union, so an eleventh action is a **build error** rather than a row printing `provider.cap_changed` at somebody |
| drawing a refusal as an act | `outcomeOf` reads `detail.outcome`, and the marker is a **word** in the error hue rather than the hue alone |
| printing a time in a zone nobody named | `stampOf` formats in UTC, and the column heading says so once rather than every row saying it fifty times |

## Model registry

`/models/registry` ([#591](https://github.com/NobuData/ouroboros/issues/591)) is
[`docs/mockups/21-model-registry.html`](../docs/mockups/21-model-registry.html)'s **frame**:
the naming promise in the head, the two actions that create aliases, and the Models tab set
with **Model registry** finally live. It is the section's third page, and it retires the `#49`
placeholder this route was. Since CI.2
([#592](https://github.com/NobuData/ouroboros/issues/592)) the frame holds the mockup's centre
of gravity — the eight-column **ALLOWED MODELS** table — with the inspector's seat beneath it,
and since CI.4 ([#594](https://github.com/NobuData/ouroboros/issues/594)) both head actions
work: the create dialog and the import wizard are the two ways a name enters the registry.

```
MODELS
Every model gets a name. Every route points at the name.  [ Import from provider ▾ ] [ + New alias ]
Registry aliases bind a provider key to a model id.         ↑ a wizard per connection  ↑ a dialog
Workflows and routing only ever see the alias — swap the
provider behind it and nothing else changes. That's the
point of bring-your-own-key.
──────────────────────────────────────────────────────────────────────────────────────────────────
 Routing → /models   Model registry   Providers & keys → /models/providers   Spend soon
                     ▔▔▔▔▔▔▔▔▔▔▔▔▔▔ (the accent)
ALLOWED MODELS · 8 aliases                                                    Manage providers →
 ALIAS            PROVIDER          MODEL            PARAMS                HEALTH      $ PER 1M IN·OUT  USED BY  ON
▌(coder-max)      [AN] Anthropic…   claude-fable-5   (max thinking)(400k)  ● ok        $10 · $50        4 routes [on]   ◀ selected
 (coder-fallback) [GH] GitHub Cop…  gpt-5-codex      —                     ● degraded  seat-based       2 routes [on]
 (gpt5-experiments) no provider     gpt-5.2-preview  —                     ● no key — connect a provider
                                                                           [Fix in Providers →]   —    0 routes [off ⓘ]   ← dimmed, health cell exempt
 Aliases are unique per workspace. Deleting one is blocked while any route or workflow references it.
┌ EDIT — CODER-MAX (coder-max) ┐ ┌ WHY ALIASES ┐ ┌ RESOLUTION CHAIN ┐
```

### The head is the product's argument, and it is verbatim

*"Every model gets a name. Every route points at the name."* is not a heading, it is the
sentence the rest of the page defends — and the subline under it is why anyone should care: an
alias is an **indirection**, so the provider behind a name can be replaced without touching a
route or a workflow. Both are constants in [`app/registry/view.ts`](app/registry/view.ts) and
`__tests__/registry/view.test.ts` reads the mockup and compares, so a paraphrase in
implementation fails the suite rather than passing review.

### Import from provider is a real menu, over a state the mockup does not draw

The drawing shows a ghost button with a caret and stops there. What a fresh workspace meets is
the state it leaves out — nothing connected at all — so the control has two shapes and
[`app/registry/import-menu.tsx`](app/registry/import-menu.tsx) draws both:

| The reader | What they get |
| --- | --- |
| an owner or admin, with providers connected | the menu, one row per connection, in the order the strip on `/models` shows them |
| an owner or admin, with none connected | inert, *"No provider is connected yet"*, and the one link that fixes it |
| an owner or admin, when the read failed | inert, *"could not be read just now"*, and **no** link — nothing here fixes that |
| a member or a viewer | inert, *"Creating and importing aliases is for workspace owners and admins"* |

Those three blocked reasons are deliberately three sentences and not one *"unavailable"*:
collapsing them would send an admin looking for a permission they already have, or a member to
a page that would also refuse them. `importState` is what keeps them apart, and it settles the
order — **role first**, because the link is only offered to somebody who could use it.

**Choosing a row opens the import wizard scoped to that connection** — the menu row *is* the
wizard's connection step, which is why the wizard has none of its own. Health is deliberately
not a filter here: a paused connection is still a connection this workspace has, and whether it
has anything to import is a question the wizard answers by asking. The blocked trigger uses
`aria-disabled` rather than `disabled`, so the reader who most needs the tooltip is not the one
who cannot reach it. The keyboard is [`app/shell/menu.ts`](app/shell/menu.ts)'s — the same ARIA
menu pattern the shell's two menus use, and a third copy of it would be a third copy to keep
correct.

Both actions are inert for a member or a viewer, with the role reason — see *States & guards*
below for the whole page's read-only pass — and the writes behind both flows are the service's
to refuse whatever the page draws.

### The tab, from the same list as the other two

`MODELS_TABS` gained a route where it had a note, and that one edit turned the stub into a link
on `/models`, on `/models/providers` and here — which is the whole reason the section keeps one
list. The registry's `href` joined `app/paths.ts` beside the other two (decision **R10**), so
the sidebar's **Models** entry stays lit here for the ordinary reason: the URL is under
`/models`. **Spend** is the last honest `soon` tab and waits for AB.4
([#210](https://github.com/NobuData/ouroboros/issues/210)).

### The allowed-models table

Eight columns, each a different subsystem's truth, and almost none of it decided here.
[`app/registry/table.ts`](app/registry/table.ts) decides the rows over CH.5's one payload
(`GET /api/v1/registry`, [`app/api/registry.ts`](app/api/registry.ts)) and
[`app/registry/registry-table.tsx`](app/registry/registry-table.tsx) draws them through the
#46 `Table`:

| Cell | What it is | What it must not do |
| --- | --- | --- |
| **Alias** | the accent-tinted mono pill — the mockup's `.pill.alias` | read like a cell of data: it is the name everything else points at |
| **Provider** | the AE.2 monogram ([`provider-monogram.tsx`](app/providers/provider-monogram.tsx), the *same* component mockup 07's cards draw, at its 24px size) and the connection's name; *no provider* in the faint ink | be a second monogram: the letters are the server's, the tint is AE.2's map |
| **Model** | the raw id, mono — the only place in the product one renders | — |
| **Params** | the server's chips, `—` when there are none | derive a chip client-side |
| **Health** | a dot, the state word, the check's own note; **Fix in Providers →** inside the cell where the server said there is a fix | draw `unknown` as healthy — it is warn, and a **ring** (decision M8) |
| **$ per 1M in·out** | what CH.3 resolved — `$10 · $50`, `seat-based`, `usage-based`, `$0`, `—` — with the provenance on hover (`bundled@<version>` or `org override`) | re-derive the figure, or give a `—` a provenance |
| **Used by** | `N routes`; clicking selects the row | disagree with the inspector's chips — both come off one array |
| **On** | CH.1's switch ([`alias-switch.tsx`](app/registry/alias-switch.tsx)) | take routes down silently |

**The unbound row is dimmed and its health cell is not** — the mockup's `tr.dim` and
`td.no-dim`. The #46 Table gained a `rowClassName` for the first half (a state the row as a
whole is in), and the page's sheet exempts the health cell by its column's own class. The
same ticket gave `TableSelection` a `tone`: mockup 21 selects in the **accent** where mockup
06 selects in the model violet, and the difference is the mockups' own, so it is declared on
the table rather than written over `.ou-table` from this page's sheet.

**The switch asks before it drops hops.** Switching off an alias anything references opens
the shell's overlay naming every referrer as a chip — *3 routes reference this alias — their
hops through it will be dropped at the next resolution* — and cancel or Escape writes nothing.
Switching on never asks. The round trip is the provider card's: optimistic for exactly the
transition's lifetime, `router.refresh()` on success, the refusal under the track as an alert
on failure ([`switch-actions.ts`](app/registry/switch-actions.ts) maps the service's
`forbidden`, `model_alias_not_found` and `model_alias_unbound` to sentences). The unbound
row's switch is `aria-disabled` with the reason *before* the service can refuse it; a member's
is `aria-disabled` with the role reason.

**Selection is the routing matrix's arrangement.** Client state, reflected into `?alias=`
(`app/paths.ts`'s `ALIAS_PARAM` — the provider card's *not listed upstream* link now lands on
its row) with `history.replaceState`, and read back server-side by the route so the first
paint has the right row. One tab stop per table, arrow keys and Home/End between rows, a key
pressed on a switch left to the switch, and a `role="status"` region saying which alias was
selected. The seat beneath the table follows the selection — the mockup's `EDIT — CODER-MAX`
with the pill beside it — which is what CI.3's inspector
([#593](https://github.com/NobuData/ouroboros/issues/593)) builds on; its body names the
issues that fill the rest of the page.

**When there is no table**, `tableState` keeps *could not be read* apart from *no aliases yet*,
and each has its own designed state — see *States & guards* below.

### States & guards

CI.6 ([#596](https://github.com/NobuData/ouroboros/issues/596)) is what the page looks like
before it has anything to show, while it loads, when it fails, and to somebody who may only read
it. Every decision is a pure function in [`app/registry/view.ts`](app/registry/view.ts).

```
empty (has providers)   ─▶ "Name your first model"  ① Connect a provider ✓  ② Name a model · next  [+ New alias] [Import ▾]
empty (no providers)    ─▶ ① Connect a provider · next [Connect a provider first →]  ② then [+ New alias] (bind later)
member                  ─▶ "Viewing the registry as a member." · every control in place, inert, same reason
loading                 ─▶ loading.tsx → 8 skeleton rows on the table's own column widths · 3 cards in place
registry read refused   ─▶ [The registry could not be read. <reason> (Retry)] over the last table this browser read
pricing subsystem down  ─▶ price column "—" + hover "not an unpriced model" + the service's sentence under the table
```

| State | Where | What keeps it honest |
| --- | --- | --- |
| **Empty** | [`registry-guidance.tsx`](app/registry/registry-guidance.tsx) | the routing page's two-step path, so a reader sees step two coming; which ways in exist is decided by the provider read (`guidanceState`), and a member gets the path without the controls |
| **Member** | the note under the tab set, and every control's `reason` | nothing hidden: a member can read the table, the inspector and both cards; every refusal ends in the same clause (`ownersAndAdmins` in `table.ts`) |
| **Loading** | [`registry-skeleton.tsx`](app/registry/registry-skeleton.tsx) | the head is the real head; the rows' grid mirrors `.registry-table__*`'s widths in rem, so nothing moves when the table lands, at 125% type too |
| **Failed read** | [`registry-banner.tsx`](app/registry/registry-banner.tsx), [`registry-freshness.tsx`](app/registry/registry-freshness.tsx) | DASH-I.7's rule — the reason and the retry said once; the dashboard's technique — the last table that read is held under the banner, in the same slot, so the selection and an unsaved inspector draft survive |
| **Pricing down** | `degraded.pricing` on `GET /api/v1/registry` | the service degrades the column instead of failing the page, and says so, because `—` alone cannot tell an outage from an unpriced model |

**One unbound story.** The create dialog's *bind later* notice, the unbound row's switch, the
inspector's banner and the no-providers guidance each open with `UNBOUND_STATE` — *an alias
with no provider stays switched off, and nothing resolves through it, until it is bound to a
connection* — and add only where the reader is standing. `__tests__/registry/table.test.ts`
holds all four to it.

The fixture behind all of it ([`__tests__/helpers/registry.ts`](__tests__/helpers/registry.ts))
transcribes the REST integration suite's eight expected rows rather than inventing eight
plausible ones — which is why it prints `$10 · $50` where the mockup draws `$15 · $75`: the
shipped catalog says so, and the table renders what the service resolved.

### The two ways a name enters the registry

CI.4 ([#594](https://github.com/NobuData/ouroboros/issues/594)) is the head's two actions made
real: one curated alias at a time, or a reviewed batch from what a provider actually offers.
Five calls sit behind them ([`app/api/registry.ts`](app/api/registry.ts)), three of them read as
the reader moves through a dialog rather than paid for on every visit.

**The create dialog exists to make one state reachable.** The mockup's own table has a
`gpt5-experiments` row with **no provider**, decision **R2** has always allowed it, and before
this there was no way to make one through the product — the particular kind of bug nobody
files, because the feature is there and no one can get to it. So
[`new-alias.tsx`](app/registry/new-alias.tsx) has a mode:

| Mode | What it asks for | What it creates |
| --- | --- | --- |
| **Bind now** | a connection → one of its models, *listed live from the provider* → whatever that model can be tuned with | a bound alias, switched on |
| **Bind later** | a model id, and a notice saying what the row will look like | the mockup's orphan row: dimmed, off, `✗ no key — connect a provider` |

The mode is **not a fork in the client**. CH.1's `POST /registry/aliases` takes both shapes in
one body with the connection absent for the second ([`createBody`](app/registry/create.ts)), and
`enabled` is never sent because the contract's own default — on for a bound alias, forced off
for an unbound one — is exactly what the two modes promise. Saying what the orphan row will look
like *before* it is made is what makes that row read as a state somebody chose.

The name is checked as it is typed against the aliases the table already read, so the ordinary
collision costs no round trip; there is no *is-this-free* endpoint and there should not be, since
an answer to that question is stale the moment it is given. `model_alias_name_taken` is what
decides, and `createFailure` puts it under the same box — a reader never learns about a taken
name from anywhere but the name field. On success the dialog closes and the page navigates to
`?alias=<the new name>`, so the row is in the table and selected with the inspector's seat open
on it.

**A form for a model nobody wrote UI for.** [`param-fields.tsx`](app/registry/param-fields.tsx)
renders CH.2's five widgets ([#585](https://github.com/NobuData/ouroboros/issues/585)) and
contains no list of parameters — the suite that proves it feeds the component a tunable no
adapter in this build has. It is the registry's own form rather than an extension of
[`app/ui/schema-form.tsx`](app/ui/schema-form.tsx), because the two dialects are deliberately
closed and a primitive names no domain concept; and it is **controlled**, unlike every other form
in this module, because the field set is replaced whenever the model is and a `Toggle` has no
value to submit. `defaultValue` is drawn in the hint and never typed into the box, exactly as
the contract asks: a dialog clicked through without touching the parameters creates an alias with
`params: {}` — the provider's own defaults.

**The import wizard is review, not automation** (decision **R7**). Forty discovered models must
not become forty machine-named aliases, and naming forty by hand is not it either, so
[`import-wizard.tsx`](app/registry/import-wizard.tsx) puts discovery's truth and the operator's
vocabulary side by side:

```
Import from Anthropic Claude          [Connection] [Models] [Review]
 IMPORT  MODEL                ALIAS         $ PER 1M IN·OUT  CAPABILITIES
 ☐       claude-fable-5       [fable-5]     $15 · $75        thinking · 1.0M ctx · 64.0k out
         aliased: coder-max
 ☑       claude-opus-5        [opus-5]      $10 · $50        thinking · 1.0M ctx · 64.0k out
 ─▶ Review: 1 alias will be created, switched on ─▶ Create aliases ─▶ the row appears
```

Every cell is the service's — CH.3's price string, CH.2's capability headline, the mark on a
model something already names — and only the name is the operator's. Already-aliased rows arrive
marked and unticked, `select all` skips them, and the tick a row starts on is CH.4's `selected`
rather than a second opinion computed here. Re-entry is idempotent because the **read** is: the
candidates are re-read on every open, so two models just imported come back marked.

**Nothing is created until every row is acceptable.** The batch is one transaction, so a `422`
means nothing landed and names every offending item; `importItemErrors` maps those back onto
rows through the order the body was built in, and `rowProblems` anticipates the ordinary
collisions — a name edited into one somebody else has, two rows asking for the same thing —
before a round trip is spent on them. Both end as a line under the row's own name box. A
connection that has reported nothing gets the honest empty state the contract guarantees
(`empty` is non-null exactly when `candidates` is), naming the connection and linking to
Providers & keys.

## Ticket sources

`/settings/sources` ([#141](https://github.com/NobuData/ouroboros/issues/141)) is where a
workspace says where its tickets come from — mockup 17's **Ticket sources** section, mounted
as the first built tab of the settings frame. The sidebar's **Settings** entry is live and
leads to `/settings`, which redirects here until BS.1
([#491](https://github.com/NobuData/ouroboros/issues/491)) builds the hub; the six mockup
tabs — Workspace, Members, Policies, Integrations, Audit, Danger zone — are drawn in the tab
row and say honestly that they arrive with #491. The second mounted tab is
[**Farm tokens**](#the-enroll-card) ([#258](https://github.com/NobuData/ouroboros/issues/258)).

```
SETTINGS · acme-robotics
Ticket sources                                                          [ + Add source ]
Where this workspace's tickets come from. Connect a tracker, test it before
trusting it, and see honestly why syncing has stopped.
──────────────────────────────────────────────────────────────────────────────────────────
 Workspace soon  Members soon  Policies soon  Sources  Integrations soon  Audit soon  Danger zone soon
                                             ▔▔▔▔▔▔▔
[GH] GitHub · acme-robotics   GitHub  ● active
     acme-robotics · 4 repositories
     synced 40s ago · last sync imported 2 · updated 1 · unchanged 6
                                   [Test connection] [Sync now] [Pause] [Configure]
[GH] GitHub · helios-labs      GitHub  ● error
     helios-labs · 1 repository
     rate limited until 14:20 UTC
                                   [Test connection] [Sync now] [Resume] [Configure]
```

**Every row is the service's words.** [`app/sources/view.ts`](app/sources/view.ts) turns a
`TicketSource` and its `TicketSourceStatusReport` into the pill, the summary and the second
line, and nothing here composes a reason: `rate limited until 14:20 UTC` is V031's
`statusReason`, printed as it arrived, and a `running` report is what turns the pill into the
pulsing *syncing*. The summary — `acme-robotics · 4 repositories` — is read off the provider's
own catalog fields, so a kind this module has never heard of still gets a sentence; when the
catalog could not be read it degrades to the stored keys and says so once, in the banner.

**The form is not GitHub's.** The add-source flow
([`add-source.tsx`](app/sources/add-source.tsx)) draws its kind picker from
`GET /api/v1/sources/catalog` — GitHub live, and Jira, Linear and GitLab as *coming soon*
tiles that name the v2 ticket each arrives with — and then draws the chosen kind's form from
the fields that entry declares, through the same `SchemaFields` the model-provider dialog uses,
now with a `list` widget for the repositories or projects a tracker is scoped to. The
acceptance criterion is that no GitHub form is hard-coded, and the proof is the suite pointing
the same component at the fake provider's schema and reading the fake provider's form off it.

**A credential goes in and never comes out.** The configure dialog
([`configure-source.tsx`](app/sources/configure-source.tsx)) is two forms: the settings,
starting at what the row holds, and a write-only credential box beside the mask the service
answers — `••••` and, once something has just been stored, its last four characters. The input
is cleared after the store, the dialog never receives a value to show, and the test asserts no
token-shaped string is in its markup.

**The controls are the service's answers.** *Test connection* prints what `validateConfig`
found, tick or reason, and writes nothing; *Sync now* accepts a `202` and polls the status
until `running` clears, and prints the service's own refusal for a paused source or one synced
under thirty seconds ago; *Pause* and *Resume* are the one `PATCH` of `status`. A member sees
every row and every control, each inert with its reason in the tooltip; `owner` and `admin`
may press them. The intake screen's *no token* guidance (#120's amendment) links here.

## Build farm

`/build-farm` ([#256](https://github.com/NobuData/ouroboros/issues/256)) is
[`docs/mockups/08-build-farm.html`](../docs/mockups/08-build-farm.html)'s **head and stat row**,
[the runners table](#the-runners-table) ([#257](https://github.com/NobuData/ouroboros/issues/257)),
[the enroll card](#the-enroll-card) ([#258](https://github.com/NobuData/ouroboros/issues/258)),
and the frame the rest of that page mounts in: the pools card
([#259](https://github.com/NobuData/ouroboros/issues/259)) and the live log
([#261](https://github.com/NobuData/ouroboros/issues/261)). The sidebar's **Build Farm** entry is
live and leads here; the mockup's topbar is superseded by the shell, and the page adds no chrome
of its own, so the header and the sidebar stay put while the pane scrolls.

```
BUILD FARM
5 runners. 2 pools. 78% cache hits.      [✦ Build Analyzer SOON] [Pool settings SOON] [+ Enroll runner]
The Ouroboros server dispatches builds to your own machines over an outbound-only agent
connection — your hardware, your network, no inbound ports.
┌ RUNNERS ONLINE ──┐ ┌ BUILDS TODAY ────┐ ┌ AVG BUILD TIME ──┐ ┌ CACHE HIT RATE ──────┐
│ 4/5              │ │ 23               │ │ 4m 12s           │ │ 78%  ▓▓▓▓▓▓▓▓░░      │
│ forge-03 offline │ │ 19 clean · 3 re- │ │ ▼ 38s vs last    │ │ ccache · per-runner  │
│ · 2h             │ │ tried · 1 failed │ │ week   (= good)  │ │                      │
└──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────────────┘
  empty org ▸ No runners yet. No pools yet. No cache data today. ▸ 0/0 · 0 · — · —
```

Every judgement is a pure function in [`app/farm/view.ts`](app/farm/view.ts), so each acceptance
criterion is a unit test on a small value.

| What it says | Where it is decided |
|---|---|
| **The `h1` is three live values in a sentence**, and it degrades clause by clause: `1 runner.` not `1 runners.`, *No runners yet.* / *No pools yet.* rather than a bare `0`, and *No cache data today.* rather than `0%`. The runner count is `stats.runnersOnline.total` — the first tile's denominator — so the heading and the `4/5` under it cannot disagree | `farmHeadline` |
| **`null` is not `0`.** A count of nothing is a genuine zero (`0/0`, `0`); an *average* of nothing is an em dash — never `0m 00s`, never `0%` — and the cache tile then draws **no meter**, because an empty bar is a picture of `0%` | `buildTimeStat`, `cacheStat` |
| **Down is good.** `▼ 38s vs last week` takes the tile's `up` tone (which names *goodness*, not direction) and `▲` takes `down`. With no prior week the line is **absent** — not `▼ 0s`, which would claim a comparison nobody made — and a real comparison that came out level says so in words | `buildTimeDelta` |
| **The cache label is the payload's**, composed by the service from decision **B5**: `ccache · per-runner` until AJ.2 ([#264](https://github.com/NobuData/ouroboros/issues/264)) makes the mockup's *shared per pool* true. The percentage is honest either way; the label is what could lie, so it has one author | `cacheStat` |
| **The split is always printed** once there is a build to split (`5 clean · 0 retried · 0 failed` is a good day said out loud); a cancelled build joins the line only when there is one, so the seeded day reads as the mockup does and the line still adds up | `buildsStat` |
| **The offline note is the service's**, re-aged on every poll by the clock that also decided *offline* | `runnersStat` |

**The three actions are honest.** Two have nothing to open yet, so each is an inert button
carrying a *soon* mark whose tooltip names the issue it waits for: **✦ Build Analyzer** →
[#516](https://github.com/NobuData/ouroboros/issues/516) (mockup 18 — the mockup links it to a page
that does not exist; here it navigates nowhere, and becomes a link to `/analyzer` on the commit that
builds that route) and **Pool settings** → [#259](https://github.com/NobuData/ouroboros/issues/259).
**+ Enroll runner** acts since [#258](https://github.com/NobuData/ouroboros/issues/258): it moves
focus to [the enroll card](#the-enroll-card)'s first control — focus, because the pane rather than
the window is the scroll container and focus is what scrolls it natively. Every member, a `viewer`
included, may look at the farm; the one thing a role changes is the enroll flow, which the route
decides once through `mayAdminister` and hands down as a boolean. For a reader who may not mint,
**+ Enroll runner** is the same control, inert, with the reason.

**The page stays live, from one poll.** `GET /api/v1/farm` is the page in one observation — its
figures are claims about each other — so [`farm-store.tsx`](app/farm/farm-store.tsx) provides it
once per screen and the head, the stat row and every region still to come read `useFarm()`:
exactly one request per interval however many regions subscribe. The first answer is the
server's render ([`data.ts`](app/farm/data.ts)); from then on the browser asks
[`/api/farm`](app/api/farm/route.ts) on [the polling pattern](#the-polling-store), at **the fleet's
own cadence** — the service's `X-Ouro-Poll-After: 10` travels through
[`farm.observe()`](app/api/farm.ts) and [`readFarmPage()`](app/api/farm-page.ts) intact, so the
interval is one variable on the server. A hidden tab polls not at all, and a workspace switch asks
at once.

**A failed refresh keeps the page.** The last good page stays on screen under one banner
([`farm-banner.tsx`](app/farm/farm-banner.tsx), the design system's `RetryBanner`): *Showing data
from 14:02 — the latest refresh failed.*, the service's reason once, and a retry that is **the poll
asking now** and says *Retrying…* while it does. The next answer that works clears it without a
press. A first paint that could not be read draws the head, the actions and four named tiles
holding em dashes under the same banner — a page reporting a failure, not a page that lost its
shape.

**The stat tile is shared.** The row is four [`StatCard`](#ui-primitives)s — the dashboard's tile,
moved to `app/ui` on the commit that made this its second caller — so the two rows cannot drift.
[`farm.css`](app/farm/farm.css) holds only what is this page's: the head, the twelve-column grid
(the stat row halves below `68.75rem` and stacks below `40rem`), the *soon* mark, and what the
runners table puts inside its cells. Every colour
is a token and every length a rem, which is what makes both palettes and the 125% font-scale step
correct from one sheet.

### The runners table

The `RUNNERS` card ([#257](https://github.com/NobuData/ouroboros/issues/257)) is the one table in
the product that renders **machines that are running right now** rather than stored records. It
reads the same store as the tiles above it, so `4/5` and the rows it counts are one answer.

```
RUNNERS  (● 1 building)                                  [Group by status] [Health history → SOON]
RUNNER          POOL     STATUS                     CURRENT JOB                   CPU        RAM         QUEUE  UPTIME
forge-01        pool-a   (● building)               #479 zephyr build             ▓▓▓▓░ 82%  14.2/32 GB  q:2    41d     ⋯
forge-02        pool-a   (● idle)                   —                             ░░░░░  3%   2.1/32 GB  q:0    41d     ⋯
forge-03        pool-a   (● offline) last seen 2h ago  —                          —          —           q:0    —       ⋯   ← dimmed
anvil-mac 🛡    pool-b   (● idle)                   —                             ░░░░░  6%   5.0/64 GB  q:0    12d     ⋯   ← bearer_fallback
bigiron         pool-b   (● draining)               #472 HIL test rig · finishing ▓▓▓░░ 54%  88/256 GB   q:1    3d      ⋯
```

Every judgement is a pure function in [`app/farm/runners.ts`](app/farm/runners.ts):

| What it says | Where it is decided |
|---|---|
| **Stale data is not rendered as current.** A row the fleet cannot vouch for (`offline`) draws an em dash in every cell an *agent* reported — CPU, RAM, uptime — **whatever the payload carries**, is dimmed (by ink, as the mockup does it, not by opacity), and says `last seen 2h ago`. What the *control plane* knows stays: `q:0` is its own count | `runnerRow`, `isVouchedFor`, `lastSeen` |
| **`null` is an em dash, never zero.** A metric a platform could not report is `—` with **no meter** (an empty bar is a picture of `0%`), beside the metrics it could; a measured `0%` keeps its meter | `cpuReading`, `ramReading`, `uptimeReading` |
| **The pill**: `building` accent + pulse · `online` reads **idle** · `draining` warn · `offline` err. Every status differs by its word and its dot, not only its hue | `RUNNER_PILLS` |
| **CPU warns at ≥ 80**, healthy under 50, plain accent between — decided on the figure that is *drawn*, so `79.6` reads `80%` and warns | `cpuReading` |
| **RAM is `14.2/32 GB`** — decimal gigabytes, one decimal under 100 GB (`5.0`, not `5`, so the column keeps its width), whole numbers from there (`88/256 GB`) | `ramReading` |
| **`bearer_fallback` is visible** (decision B3): a small shield in the warning ink beside the name, whose tooltip, hidden text and row announcement all say it in words | `RunnerRow.degraded`, `BEARER_FALLBACK_NOTE` |
| **The order is pool, then name** — facts that do not move on a heartbeat, and a total order, so a row never moves because a build started. **Group by status** is the reader's opt-in to the mockup's own order (building · idle · draining · offline) | `sortRunners` |
| **`last seen` and the tile's `offline · 2h` are one figure**: both are `ageOfSeconds` ([`app/format.ts`](app/format.ts)) — the rule the service composes its note by — measured from the store's `dataAt`, so a server render and its hydration agree | `lastSeen` |

**Live updates do not flicker, and that is tested.** Rows are keyed by the runner's id and cells are
memoised over the flat row's primitives ([`runner-cells.tsx`](app/farm/runner-cells.tsx)), so a poll
changes a text node and a meter's custom property and replaces nothing; the meter's fill eases to its
new width (`.ou-meter__fill`, inside the reduced-motion guard).
[`runners-live.test.tsx`](__tests__/farm/runners-live.test.tsx) holds both halves — a
`MutationObserver` over the table body sees no element added or removed and no mutation outside the
row that moved, and a spied `Meter` shows one CPU cell rendering, not four — and that a runner
reported offline flips **the same row element** to dimmed em dashes on the poll that reports it.

**The keyboard** is the design system's selectable grid ([`Table`](#ui-primitives)): one tab stop,
then `↑` `↓` `Home` `End` between rows, with the landing row announced from a polite region (which
also covers a pointer, which moves no focus). Nothing is selected on arrival, and a selection whose
runner has left the fleet is dropped so the table is never unreachable.

**What cannot act yet says so.** `Health history →` waits for
[#266](https://github.com/NobuData/ouroboros/issues/266) and each row's `⋯` for
[#260](https://github.com/NobuData/ouroboros/issues/260): both are inert *soon* controls, and neither
navigates. The **current-job cell** opens a **job sheet** ([`job-sheet.tsx`](app/farm/job-sheet.tsx))
over what the page already knows — the run console it will link to is
[#309](https://github.com/NobuData/ouroboros/issues/309), and the payload carries no run to link to
until [#300](https://github.com/NobuData/ouroboros/issues/300). The sheet is held by the *job*, so it
closes itself when the build ends rather than becoming a sheet about the next one. The mockup's
`· helios-firmware` is not drawn: the payload's job reference carries no repository.

**The table scrolls inside its own wrapper.** The card is a grid item with `min-width: 0`, so nine
`nowrap` columns scroll in `.ou-table-scroll` and the pane never moves sideways. That wrapper is now
`position: relative` too: visually hidden text is absolutely positioned, and a hidden heading over
the last column of a wide table otherwise sits outside the clip and widens the *document*.

### The enroll card

The `ENROLL A RUNNER` card ([#258](https://github.com/NobuData/ouroboros/issues/258)) prints a
command that **actually enrols a runner**, which makes it a credential surface. The mockup's
static text would look right and do nothing; the card mints a real scoped token (AH.2,
[#250](https://github.com/NobuData/ouroboros/issues/250)) through AH.6's enroll-command read
([#254](https://github.com/NobuData/ouroboros/issues/254)).

```
AT REST — nothing minted                          AFTER Copy command
┌ ENROLL A RUNNER ─────────────────────────┐      ┌ ENROLL A RUNNER ──────────────────────────────┐
│ Run this on any machine that can reach   │      │ …that can reach ouroboros.acme.dev:443 — …    │
│ this deployment — no inbound ports…      │      │ Pool [pool-a ▾]                               │
│ Pool [pool-a ▾]                          │      │ curl -fsSL 'https://ouroboros.acme.dev/       │
│ curl -fsSL <this deployment>/install.sh  │      │   install.sh?version=0.9.0' | sh -s -- \      │
│   | sh -s -- \                           │      │   --tenant 'acme-robotics' --pool 'pool-a' \  │
│   --tenant acme-robotics --pool pool-a \ │      │   --token 'orb_enroll_••••a4b7'               │
│   --token orb_enroll_••••                │      │ The agent connects outbound over mTLS…        │
│ The agent connects outbound over mTLS…   │      │ [Copy command]             [Manage tokens →]  │
│ [Copy command]        [Manage tokens →]  │      │ Token orb_enroll_••••a4b7: expires in 24h ·   │
└──────────────────────────────────────────┘      │   1 of 1 use left                             │
  member ▸ explainer, shape and mTLS note only    │ ( Copied — treat this as a secret.        × ) │
           — no selector, no copy, no sheet       └───────────────────────────────────────────────┘
```

Every judgement is a pure function in [`app/farm/enroll.ts`](app/farm/enroll.ts):

| What it says | Where it is decided |
|---|---|
| **The mint is the copy.** `GET /api/v1/farm/enroll-command` mints on every call and is the only read that knows this deployment's origin and pinned agent version — so nothing is minted to draw the card. At rest the block is the command's *shape* and the explainer names no host (a guess from `window.location` would be the UI's address, not the one runner machines reach); one press of **Copy command** mints one single-use token | `restingCommand`, `explainer` |
| **The token's value is never in the DOM, and never in React state.** The Server Action answers the command twice — whole, and **masked on the server** — and the whole one goes from the action's promise straight into the clipboard write. What the card keeps is `MintedView`, which has no field for the value. The mask **fails closed**: a command with no `--token` flag, or with a token-shaped value before it, is withheld rather than shown | `maskedCommand`, `MintedView` |
| **The command is the deployment's own**: its origin and a pinned `?version=`, as the service rendered them — never the mockup's `get.ouroboros.dev` — and once a mint has answered, the explainer names the real `host:port` | `hostOf` |
| **The toast says it is a secret and promises nothing about the clipboard.** It stays until dismissed | `COPIED_TOAST` |
| **TTL and uses are said at mint time**: `expires in 24h · 1 of 1 use left`. A day-long token reads `24h`, not `1d` and not `23h` | `tokenLine`, `tokenWindow` |
| **A blocked copy leaves nothing live.** If the browser refuses the clipboard after the mint took, the value is lost and the token is not — so it is revoked at once and the card says so | `COPY_BLOCKED_REVOKED` |
| **A refusal always says whether anything was minted** — a deleted pool, a deployment with no `OURO_FARM_PUBLIC_URL` or no runner release, a role that changed | `mintRefusal` |

**The clipboard write is asked for inside the press** ([`clipboard.ts`](app/farm/clipboard.ts)): the
text does not exist yet when the press happens, so where the engine has one the write is a
`ClipboardItem` over the mint's promise — the only form Safari accepts — and `writeText` after the
wait elsewhere.

**Minted tokens have a way back.** *Manage tokens →* opens a sheet
([`token-sheet.tsx`](app/farm/token-sheet.tsx)) listing every token the workspace has minted — mask,
pool, window, uses left, who minted it — with **Revoke** on each one that is still live; expired,
spent and revoked tokens stay listed, dimmed, because *this token let four machines in before it was
killed* is the question an incident asks. A revoke replaces its row in place and says what it did
with the number of machines the token had admitted. The pools' and the members' names are
decoration: a listing of either that failed leaves an em dash or no name, never *deleted pool* or
*a former member* over something that was merely not read
([`token-data.ts`](app/farm/token-data.ts)).

**The same list is the settings section's _Farm tokens_ tab**, at `/settings/farm-tokens` — the
amendment on #258, which is decision S2 of the Workspace Settings roadmap: `/settings` is the
administration hub, and existing admin surfaces mount in its nav rather than being written twice.
[`token-list.tsx`](app/farm/token-list.tsx) is mounted by both; the route reads the listing only
for a reader who may have it, and tells anybody else so by role.

**The gates that decide are the service's.** Minting, listing and revoking are `owner` or `admin`
at `ouroboros-rest`, and minting and revoking are audited there (AH.2). What the UI does for a
member — no selector, no copy, no sheet — is presentation.

## Planning

`/planning` ([#283](https://github.com/NobuData/ouroboros/issues/283)) is
[`docs/mockups/09-planning.html`](../docs/mockups/09-planning.html)'s **frame**: the page head,
its two actions, and the grid the three regions sit in — with the
[generator card](#the-generator-card) ([#284](https://github.com/NobuData/ouroboros/issues/284))
in its `c-7` and the [roadmap gantt](#the-roadmap-gantt) ([#286](https://github.com/NobuData/ouroboros/issues/286))
in its `c-12`. The sidebar's **Planning** entry is live and leads here; the mockup's topbar is
superseded by the shell.

```
PLANNING
Describe the work. Ouroboros writes the tickets.                 [Import from Jira SOON] [New roadmap]
Draft epics and tickets straight into GitHub Issues, Jira, or Linear — sized by the
estimator, wired with dependencies, and queued for the loop the moment you approve them.
┌ GENERATE TICKETS ─── [estimator v0] ──┐ ┌ TRACKER SYNC ───── [every 5m] ─┐
│ prompt · outline · trackers · drafts  │ │ [GH] GitHub · acme-robotics  ● │
│                                       │ │      two-way sync · 42 issues  │
│                                       │ ├ BACKLOG HEALTH ─── [42 open] ──┤
│                                       │ │ Sized ▓▓▓▓▓▓▓▓▓░ 38/42      ok │
└───────────────────────────────────────┘ └────────────────────────────────┘
┌ ROADMAP — HELIOS 2.1  [Q3–Q4 2026] ─────────────────────── [Share ↗ SOON] ┐
│              JUL 2026  AUG  ║ SEP   OCT   NOV   DEC                        │
│ OTA hardening [▓▓▓▓▓▓░░ 12 issues · 8 done]                                │
└────────────────────────────────────────────────────────────────────────────┘
```

**The head is verbatim, and its actions are honest.** *Import from Jira* is AN.3
([#291](https://github.com/NobuData/ouroboros/issues/291)) and does not exist, so it is an inert
ghost button marked *soon* whose tooltip names the issue — it opens nothing. *New roadmap* is live
for `owner` and `admin` and inert with the reason for everyone else.

**A new roadmap is its first epic, named.** AK.3 stores a roadmap's name and window on its epics
and the roadmap head is the top named lane's, so
[`new-roadmap.tsx`](app/planning/new-roadmap.tsx) asks for the roadmap name, an optional window,
the first epic's name and an optional month pair, and makes one `POST /api/v1/planning/epics`
([`create.ts`](app/planning/create.ts) holds every judgement; an epic with no months is sent as
`unscoped`). When a roadmap already exists the dialog opens on its name and window. On success the
page refreshes and the roadmap card is headed with the name. Every lane after the first is the
gantt's **Add epic** ([#286](https://github.com/NobuData/ouroboros/issues/286)).

**The grid is the mockup's 7 / 5 + 12**, collapsing to one column below `68.75rem`. Every card reads
real data, and a failed read degrades that card rather than the page.

### The generator card

[`generator-card.tsx`](app/planning/generator-card.tsx) is the mockup's `c-7`
([#284](https://github.com/NobuData/ouroboros/issues/284)). Every judgement it draws is a pure
function in [`generator.ts`](app/planning/generator.ts); every write is a Server Action in
[`generator-actions.ts`](app/planning/generator-actions.ts).

```
prompt ─ ▸ structured outline ─ (GH●|JI|LN) [Milestone ▾] [auto-size][queue XS/S] [Draft tickets ⟳]
  │                                                                   │
  │               POST /planning/batches ◀────────────────────────────┘  → /planning?batch=<id>
  ▼
DRAFT — 6 TICKETS  [✓ all sized]     ◀── GET /api/planning/batches/{id}  every 3 s while sizing
☑ OTA-1  Partition table…  blocks OTA-3  [L] [feature-loop] [Edit]   ── PATCH …/drafts/{key}
est. total ~3 days of loop time · $14 est. spend   [Regenerate] [Push 6 tickets to GitHub →]
                                                                      └─ push / push/resume
```

| Rule | Where it is kept |
|---|---|
| `✓ all sized` only when **every** draft has an estimate; `sizing…` per row, `sized N of M` until then | `allSized`, `rowSizing` |
| A tracker nobody connected, or one the catalog cannot write to, is **disabled with its reason** — never a push that fails on click | `trackerOptions`, `pushReason` |
| The push button's count is the **live** selection — a click moves it before the service answers, and a refusal puts it back | `selectedCount`, the card's pending map |
| The footer's `$` exists only when `summary.spend` does (N10); a partial price is a floor, `$14+` | `footerText` |
| Each draft says what its push did — `pushed ✓ #612` (a link), `failed — reason` — and **Resume push** appears exactly while something selected did not land | `rowPush`, `pushMode` |
| Narrative-only input's `notes` render as a hint whose action opens and focuses the outline | the card's guidance aside |

**The address carries the batch.** Generating replaces it with `/planning?batch=<id>`, so a reload,
a shared link, or another surface's deep link (#519's **Edit drafts**) opens the same batch —
the seeded one is `/planning?batch=5eed0021-0000-4000-8000-000000000001`. The planner's `notes` are
not stored by the service, so only a generation's own answer shows them.

**The batch drawn is the newest heard.** A batch arrives from the server read, from an action's
answer and from the poll ([`batch-poll.ts`](app/planning/batch-poll.ts), answered by
[`app/api/planning/batches/[id]/route.ts`](app/api/planning/batches/[id]/route.ts)); each is
stamped and the newest wins, and every action asks the poll again so an answer already in the air is
dropped. The route handler sets the cadence from the batch — 3 s while a draft waits on the
estimator, the contract's 15 s after — and a push in flight asks every 2 s so rows land as they do.

**Roles.** Drafting, selecting and editing are `owner|admin|member`; push and resume are
`owner|admin`; a viewer reads. **Milestones** are the chosen tracker's own; *New milestone…* is a
name, created by the push. **Keyboard:** the segment's buttons and each row's checkbox are tab stops;
**Edit** moves focus into its title, **Escape** returns it to **Edit**.

### The tracker-sync and backlog-health cards

The side column's `c-5` ([#285](https://github.com/NobuData/ouroboros/issues/285)). Every judgement
is a pure function — [`sync.ts`](app/planning/sync.ts) and [`health.ts`](app/planning/health.ts) —
and the two components only draw them.

```
┌ TRACKER SYNC ──────────────────────────────── [every 5m] ┐  ← real poll configuration,
│ [GH] GitHub · acme-robotics                           ●  │    not a constant
│      two-way sync · 42 issues   ← only because GitHub    │
│ [JI] Jira · PROJ                  can actually write  ◌  │
│      not syncing · 0 issues     ← no Jira provider here  │
│ [LN] Linear                                ◌ [connect ↗] │ → /settings/sources
└──────────────────────────────────────────────────────────┘
┌ BACKLOG HEALTH ───────────────────────────────  [42 open] ┐
│ Sized        ▓▓▓▓▓▓▓▓▓░  38/42                         ok │
│ Blocked      ▓                4                      warn │
│ Stale > 30d  ▓                6                       err │ ← threshold from config
│ Estimator re-runs nightly…      ⓘ last run 9h 46m ago ✓  │ ← a checkable claim
└───────────────────────────────────────────────────────────┘
```

| Rule | Where it is kept |
|---|---|
| `two-way sync` is asserted **only** where `capabilities.write.createTicket` is live; a read-only source says `read sync · N issues` | `syncRows`, `directionOf` |
| A kind the catalog does not list has **no provider in this build**, so the row says `not syncing` and goes idle rather than claiming a sync nothing performs | `directionOf`, `dotOf` |
| The cadence tag is `OURO_BACKLOG_SYNC_INTERVAL_SECONDS`, spelled in the largest unit that divides it — `every 5m` at the default, **not** the mockup's `every 60s` | `cadenceTag`, `cadenceOf` |
| The count is the **canonical** `tickets` backlog, never the `github_issues` mirror mockup 03 counts | `openTicketCount` on the contract |
| A row is named what the workspace named the source, so the card and the settings list agree | `nameOf` |
| Sized fills out of its own total; blocked and stale out of the open backlog — the mockup's own widths | `healthMeters`, `barFill` |
| The stale label carries the real `thresholdDays`, so a fortnight deployment reads `Stale > 14d` | `staleLabel` |
| The footnote's tooltip is the job's **real** last run — instant, outcome, and this workspace's own counts | `lastRunNote`, `lastRunPhrase` |

**Two contract fields were added for this card** (`ouroboros-rest` 0.35.15, both additive):
`TicketSource.openTicketCount` and `TicketSourcePage.pollIntervalSeconds`. Neither existed, and the
card's two figures are not inventable from anything else the page reads.

**The meters are figures, not links, and the card says why.** The ticket asks each to drill through
to a filtered intake view, and AL.5 already emits the filter descriptors for it — but these counts
are over the canonical `tickets` and `/issues` lists the `github_issues` mirror, which is a
different set of rows *by design* (`R__dev_seed_ticket_planning.sql`'s header argues it, and the
seed gives the two backlogs non-overlapping numbers). A link would land a reader on tickets that are
not the ones counted, so AM.3a ([#968](https://github.com/NobuData/ouroboros/issues/968)) builds the
view first.

**A deliberate divergence from the mockup.** The mockup draws Jira as `epics mirror milestones` with
a healthy dot. This build registers no Jira provider — Q.2's loop *skips* a kind it cannot resolve —
so the row says so instead. The generator card beside it already disables Jira for the same reason,
and the ticket's own argument (*"a capability claim, not a label"*) is what settles it.

### The roadmap gantt

[`roadmap-gantt.tsx`](app/planning/roadmap-gantt.tsx) is the mockup's `c-12`
([#286](https://github.com/NobuData/ouroboros/issues/286)): a CSS grid, not a gantt library
(option 3-A) — a label column, one column per month, a rule down each, a lane per epic. Every
judgement is a pure function in [`gantt.ts`](app/planning/gantt.ts); every write is a Server Action in
[`gantt-actions.ts`](app/planning/gantt-actions.ts).

```
              JUL 2026   AUG  ║   SEP      OCT      NOV      DEC
OTA hardening [▓▓▓▓▓▓░░ OTA hardening · 12 issues · 8 done]            ← drag: move · edges: resize
BLE prov v2              [▓░ BLE provisioning v2 · 9 issues · 2 done]      snapped to months
Zephyr 4.2 proposed                               ┊╌╌ unscoped ╌╌╌╌╌┊     → PATCH /planning/epics/{id}
                         ║ TODAY — the reader's clock, the exact fraction through the month
Bars are epics; Ouroboros keeps them in sync with the trackers.            [Add epic]
```

| Rule | Where it is kept |
|---|---|
| Columns are the window label (`Q3–Q4 2026` → Jul–Dec) widened to every scheduled lane; nothing parseable and no months is six months from the read | `windowFromLabel`, `ganttWindow` |
| TODAY is the exact fraction of the reader's month — Aug 8 00:00 is `7/31` through August — drawn only in the browser, and a today outside the window says which side | `todayPosition`, [`today-marker.tsx`](app/planning/today-marker.tsx) |
| Fill is the computed done-fraction; the chip is `N issues · M done`, or `unscoped` for a lane with no months, drawn dashed across the window's last two columns | `progressPercent`, `chipText`, `barPlacement` |
| A drag's pixels become whole months; a move keeps its length and stops at the window, an edge never makes a bar shorter than a month | `monthsFromPixels`, `editSpan` |
| A change draws at once and rolls back to the last lane the service confirmed if refused, saying why | `beginEdit`, `settleEdit`, `moveFailure` |

**It scrolls inside `.planning-gantt__scroll`**, never the content pane. **Keyboard:** a focused bar
moves with ← →, its end with **Shift**, its start with **Alt**, and **Enter** opens it; each lane's
steppers (start / move / end, earlier / later) show while it holds focus. Under
`prefers-reduced-motion: reduce` a dragged bar jumps month to month rather than following the pointer.
**Share ↗** is AN.4 ([#292](https://github.com/NobuData/ouroboros/issues/292)) — inert, marked *soon*.
The footnote drops the mockup's *"and re-plans when reality drifts"* until AN.5
([#293](https://github.com/NobuData/ouroboros/issues/293)) makes it true.

**The epic editor** ([`epic-editor.tsx`](app/planning/epic-editor.tsx),
[`epic-draft.ts`](app/planning/epic-draft.ts)) opens on a click: name, tint, status and months saved as
one `PATCH` of only what changed; the linked tickets with their synced states
(`GET /planning/epics/{id}/tickets`), unlinked at once, and a picker searching
`GET /planning/tickets?q=` that links at once — each answering the lane with its chip recomputed, which
the bar draws immediately; and where the lane is mirrored in a tracker. **Add epic** opens it empty and
files the lane under the roadmap's own head. **Roles:** every edit is `owner|admin`; anyone else reads
the gantt and the sheet with the controls inert or absent.

### The page's states

Empty, degraded and guarded (AM.5, [#287](https://github.com/NobuData/ouroboros/issues/287)). Every
judgement is a pure function in [`states.ts`](app/planning/states.ts).

| State | What the page does |
|---|---|
| A read failed | The [banner](app/planning/planning-banner.tsx) carries the reason **once**, with the page's only retry (`router.refresh()`); each affected card names what is missing and points at it |
| Nothing to draft against | The generator stays fully visible and says a tracker has to be connected, with **Open settings** → `/settings/sources` for an admin and the sentence naming who can for anyone else |
| No roadmap, or a roadmap with no epics | Two different sentences, each with a working **New roadmap** control *in the card* rather than only in the page head |
| A member | Drafts and edits; push and every roadmap write are inert **with the reason on them** — scoped, not broken |
| Sizing still running | The row's `sizing…` plus the note explaining the shared estimator queue, so a wait does not read as a hang |
| Loading | [Skeletons](app/planning/planning-skeleton.tsx) at the real grid's geometry — the head drawn for real, since none of it is read |

**Could not be read and nothing here yet are different sentences**, which is the distinction the
ticket asks for and DASH-I.7 ([#86](https://github.com/NobuData/ouroboros/issues/86)) before it.
Before this, every card printed the service's own reason into its own `EmptyState`, so a full
outage put four failure messages down the page in the treatment an empty workspace gets.

**Drafting needs a tracker, and the page says so.** The issue assumed generation was tracker-free;
the contract is not — `PlanningBatchCreate.targetSourceId` is required and
`draft_batches.target_source_id` is `not null`, with a tenancy trigger resolving the workspace
*through* it. So the honest half-working state is not *draft now, push later*: it is a generator
that stays on screen, keeps its prompt, and is plain about what it needs. The note says a draft is
*filed* against a tracker rather than *pushed* to one, because a reader told only that push is
disabled would reasonably expect to draft and be refused on the first click.

## Workflow Studio

`/workflows` ([#147](https://github.com/NobuData/ouroboros/issues/147)) is
[`docs/mockups/04-workflow-builder.html`](../docs/mockups/04-workflow-builder.html)'s
**frame**: the page head bound to the selected workflow, the segmented **Visual** · **Code** ·
Copilot control, the three actions, and the `.wf-list` rail down the left edge. It retires the
`#49` placeholder this route was, and the sidebar's **Workflows** entry — and the dashboard's
*Edit workflows* — became links on the same commit. The
[canvas](#the-canvas-is-react-flow-and-that-is-a-recorded-exception) (S.2,
[#148](https://github.com/NobuData/ouroboros/issues/148)) sits in the seat the frame reserved
for it, with the inspector (S.4, [#150](https://github.com/NobuData/ouroboros/issues/150)) beside
it and [the editing operations](#the-canvas-builds-and-refuses-what-the-dsl-forbids) (S.5,
[#151](https://github.com/NobuData/ouroboros/issues/151)) on its toolbar; and
[the draft, publish and dry-run flows](#drafts-save-publishes-gate-dry-runs-walk) (S.6,
[#152](https://github.com/NobuData/ouroboros/issues/152)) behind the head's actions and the canvas's
save line. `/workflows/<slug>` is the same screen opened on a named
workflow, which is what the rail links to, and `/workflows/<slug>/code` is
[the code view](#the-code-view-is-a-second-face-of-the-same-draft) (V.1,
[#169](https://github.com/NobuData/ouroboros/issues/169)) — the same workflow's other tab.

```
WORKFLOW STUDIO
standard-fix                                   [Browse templates] [Dry run] [Publish v15]
Runs when a sized issue with effort ≤ M is queued. Last edited 2h ago · v14 · used by 42% of runs.
──────────────────────────────────────────────────────────────────────────────────────────
 Visual   Code   Copilot soon
 ▔▔▔▔▔▔
▌standard-fix             ┌ · · · · · · · · · · · · · · · · · · · · · · · · · · · · · ┐
│ 12 stages · auto-merge  · ┌TRIGGER──────┐  ┌MODEL────────┐  ┌FLOW─────────┐ ·
│ feature-loop            · │Issue queued │─▶│Understand & │─▶│Effort       │ ·
│ 7 stages · auto-merge   · └─────────────┘  │scope        │  │re-check     │ ·
│ deps-refresh            ·                  └─────────────┘  └──────┬──────┘ ·
│ 5 stages · needs review ·      ┌MODEL────────┐   > M ↘            │ ≤ M ↓ ·
│ docs-loop               ·  ◀───│Split into   │◀──────────  ┌MODEL─▼───────┐ ·
│ 4 stages · auto-merge   ·      │subtasks     │             │Write attack  │ ·
│ hotfix-p0            ●  ·      └─────────────┘             │plan          │ ·
│ 5 stages · paused       · · · · · · · · · · · · · · · · · · └──────────────┘ ·
└ + New workflow          ├───────────────────────────────────────────────────────────┤
                          │ [−][100%][+]  Auto-layout  Add stage ▾  Undo  Redo   ⌥ drag to pan · … │
                          └───────────────────────────────────────────────────────────┘
```

### Every value in the head is real, and one of them is derived

The `<h1>` is the workflow's name, `v14` is its `currentVersion`, *used by 42% of runs* is
P.4's ([#135](https://github.com/NobuData/ouroboros/issues/135)) `usageCaption` printed as
served, and *Last edited 2h ago* is the draft's `updatedAt` measured against the instant the
page was read. The one sentence the studio composes is the trigger's: the contract serves the
predicate as structure — `{event: "ticket_queued", conditions: {effort_lte: "m"}}` — and
[`app/workflows/view.ts`](app/workflows/view.ts)'s `triggerSentence` turns it into words on
every render, stored nowhere. A definition with no trigger says so rather than claiming a
predicate that does not exist. Two of the head's strings are not the mockup's, and both are
the seed's doing (P.5, [#136](https://github.com/NobuData/ouroboros/issues/136)): the rail
reads `12 stages` because a stage is a node and the seeded v14 is the mockup's own twelve-node
canvas, and the usage reads `42%` because no integer count of the seeded runs rounds to `61%`.

### The segmented control is the section's tab row

The mockup draws `.seg` beside the actions; the shell specification renders it as the CP.4
`PageSubnav`, sticky in the pane, because the three segments are sub-surfaces of one sidebar
entry. **Visual** and **Code** link to the selected workflow's two URLs — Code since V.1
([#169](https://github.com/NobuData/ouroboros/issues/169)), which amended S.1's control — through
the [mode guard](#the-code-view-is-a-second-face-of-the-same-draft). **Copilot** is `SubnavSoon`
— a span, out of the tab order, naming the issue that builds it
([#565](https://github.com/NobuData/ouroboros/issues/565)) — which is S.1's own honesty
obligation: *they ship visibly disabled and labelled, not as buttons that quietly do nothing.*
With no workflow selected, Code has nothing to open and is `SubnavInert`: the same span, saying
why, without a *soon* mark, because it is built.

### The rail links, the tile creates

Every entry is a link to `/workflows/<slug>`, so a workflow is linkable; the selected one
carries `aria-current` and the mockup's accent gradient, the paused one its err-dot beside a
caption that already says *paused*. The dashed **+ New workflow** tile
([`app/workflows/new-workflow.tsx`](app/workflows/new-workflow.tsx)) opens a dialog taking a
name and a slug — the slug following the name by the service's own derivation until the
reader edits it, checked live against the rail, and sent explicitly because it is the one
thing `PATCH` cannot change later. On success the page lands on the workflow it made. A
member sees the tile inert with the reason, no **Publish**, and a note naming their role.

### The three actions

**Browse templates** is drawn where the mockup draws it and is inert, naming
[#159](https://github.com/NobuData/ouroboros/issues/159). **Dry run** opens the picker for every
member, because a dry run writes nothing. **Publish vN+1** is drawn for an `owner` or `admin` and for
nobody else, and its label counts from the version in force — the session's, so it moves the moment a
publish takes. On a page whose workflow could not be read, Dry run and Publish are inert and say that
there is no definition to walk or to freeze. Both flows are
[below](#drafts-save-publishes-gate-dry-runs-walk).

### Every state the mockup does not show

[`app/workflows/states.ts`](app/workflows/states.ts) decides five. A refused rail wears the
DASH-I.7 banner over an empty seat, carrying the service's own reason; an empty workspace
(the personal-org seed) reads *No workflows yet — start from a template or blank* (S.7,
[#153](https://github.com/NobuData/ouroboros/issues/153)). Its calls to action depend on the role:
an owner or admin gets **Start blank**, which opens the tile's create dialog, and **Browse
templates**, inert until #159; a member gets no buttons and a note saying who can create one.
The development seed is named for a developer. A URL naming a workflow the rail does not hold
draws the studio's own *No such workflow* beside the rail rather than the framework's
not-found page, because the rail is what a reader who followed a stale link needs next; a
workflow whose own read failed keeps the rail's facts in the head and says which read failed.
The fifth, populated, is the canvas. Loading is
[`app/workflows/studio-skeleton.tsx`](app/workflows/studio-skeleton.tsx): one skeleton for
both visual routes, at the frame's own geometry, with the title and subline as bars because —
unlike the routing page's — both depend on the reads. Below the control it reserves all three
grid tracks: the rail, the canvas card (its stage held to `.studio-canvas__stage`'s own height
rules by a style test, then the toolbar row), and the inspector. The code view has its own.

**A member's studio is read-only and still navigable.** The canvas pans, zooms and selects; the
inspector renders every value inside a disabled fieldset, and each control that would change the
draft is inert, with *Only an owner or admin may change a workflow.* as its reason; Publish is not
drawn. The paused rail row (`hotfix-p0`) wears the mockup's err-dot and says *paused* in its
caption — the contract's statuses are `active`, `paused` and `archived`, so the err-dot is the
paused state rather than a separate error state.

### The code view is a second face of the same draft

`/workflows/<slug>/code` (V.1, [#169](https://github.com/NobuData/ouroboros/issues/169)) is
[`docs/mockups/05-workflow-code.html`](../docs/mockups/05-workflow-code.html)'s page head over the
workflow's file: *Workflow Studio*, `standard-fix.loop.ts`, the mockup's subline verbatim,
**Validate** and **Publish v15**, and the segmented control with **Code** current. It is a tab of
the studio rather than a section of its own — the same frame, in the content pane, under the
sidebar's **Workflows** entry, which stays lit.

```
WORKFLOW STUDIO
standard-fix.loop.ts                                                  [Validate] [Publish v15]
The same loop as the visual canvas — every graph compiles to this typed DSL and back, losslessly.
──────────────────────────────────────────────────────────────────────────────────────────
 Visual   Code   Copilot soon
          ▔▔▔▔
┌ workflows/standard-fix.loop.ts                              Printed from the draft · Saves as you type. ┐
│  1  import { defineLoop, trigger, llm, … } from "@ouroboros/sdk";                            │
│  2                                                                                            │
│  3▌ export default defineLoop("standard-fix", {▏                            ← current line    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**One draft, two editors (decision C3).** The file is U.3's `GET /api/v1/workflows/{slug}/code`,
printed from the draft slot the canvas reads — its `etag` is the canvas's — and each route reads
that slot when it renders ([`app/workflows/code/code-data.ts`](app/workflows/code/code-data.ts)).
So a switch converts nothing and keeps nothing on the client that could drift from the draft.
Visual → Code → Visual shows whatever the draft holds; the cross-editor round trip in a browser is
V.8's leg ([#176](https://github.com/NobuData/ouroboros/issues/176)).

**The one thing a switch can lose asks first (decision C4).** Code that has not parsed never
reaches the draft, so it exists only in the page. `app/(app)/workflows/[slug]/layout.tsx` mounts
[`app/workflows/mode-guard.tsx`](app/workflows/mode-guard.tsx) around both editors: an editor
holding such a buffer says so through `useUnsavedBuffer` — V.4
([#172](https://github.com/NobuData/ouroboros/issues/172)) is its caller — and a plain press on
the other segment then asks *Discard code that has not parsed?* before navigating. A switch with
nothing held, a press on the open tab and a modified click are never interrupted; the rules are
[`app/workflows/mode-switch.ts`](app/workflows/mode-switch.ts)'s. A hold is released on a
successful parse and when its editor unmounts, so a browser Back cannot leave a stale one behind.

**The file is in the editor.** It opens in CodeMirror (V.2,
[#170](https://github.com/NobuData/ouroboros/issues/170),
[below](#the-editor-is-codemirror-6-and-that-is-a-recorded-exception)): editable for a role that
may publish, and read-only for a member or a published version. A change is saved into the draft as
it is typed ([below](#the-file-saves-as-it-is-typed)). **Validate** runs the shared checks without
publishing, and **Publish vN+1** opens S.6's shared dialog (#152) — both V.6's
([#174](https://github.com/NobuData/ouroboros/issues/174),
[below](#the-status-bar-validate-and-publish)). Publish is drawn for an `owner` or `admin`; a member
reaches the route, reads the file, may validate it, and gets the same role note the visual editor
gives (`studio-readonly-note.tsx`, shared). A member's session is verified read-only at screen level
(V.7, [#175](https://github.com/NobuData/ouroboros/issues/175)): the note names the role and why,
the file says *Read-only*, ⌘S writes nothing, no Publish is drawn, and the explorer, the tabs and the
right panel stay navigable.

**States.** [`app/workflows/code/code-view.ts`](app/workflows/code/code-view.ts) decides six: the
visual editor's five, in the code view's words — an unknown slug points at the Visual tab's rail,
since this route has none — and **unprojectable**: a draft U.3 cannot print faithfully yet (the
blank canvas **+ New workflow** leaves) is a `409 workflow_code_unprojectable`, drawn with the
validator's findings and a link to Visual rather than a retry, because nothing failed. A refused
rail or file wears the DASH-I.7 banner with the service's own reason.

**An empty workspace is S.7's seat** (the personal-org seed opens on it). Both tabs draw
[`app/workflows/empty-workspace-actions.tsx`](app/workflows/empty-workspace-actions.tsx) under
*No workflows yet — start from a template or blank*: **Start blank** and an inert **Browse
templates** for an owner or admin, no buttons and a note naming who can create one for a member,
and the development-seed note. The code view adds one mono line of its own — *There is no
workflows/\*.loop.ts to open* — and its owner note points at the canvas, not a rail.

**The skeleton is the workbench's geometry.**
[`app/workflows/code/code-skeleton.tsx`](app/workflows/code/code-skeleton.tsx) draws the same head
and two actions, then the workbench card **on the workbench's own layout classes**: the row of
toggles, the explorer's track with the seeded five files, one open tab, the source line over the
editor's well (held to the editor's `70vh` bound by a style test), the right panel's track and the
status bar. Every track, strip and floor — and the 1000px collapse — is therefore the loaded page's;
only the bars inside are the skeleton's.

**Below 1000px** mockup 05 hides the explorer and the right panel. A row of toggles opens the card
instead (`code-toggle.tsx`): **Explorer** shows the tree as a bounded full-width row above the
editor, and **Checks & outline** shows the panel under it. The editor keeps the width between them,
and the explorer's toggle is drawn in every state that has a workbench.

### The explorer and the tabs are the virtual project

Under the control, the code view is mockup 05's `.ide` frame (V.3,
[#171](https://github.com/NobuData/ouroboros/issues/171),
[`app/workflows/code/code-workbench.tsx`](app/workflows/code/code-workbench.tsx)): the explorer
beside a tab strip, over the open file.

```
┌ EXPLORER · ACME ROBOTICS ──┬ ●standard-fix.loop.ts × │ ouroboros.config.ts × ┐
│ ▾ workflows/               │ Printed from the draft · Saves as you type.         │
│   standard-fix.loop.ts  ◀  │  1  import { defineLoop, … } from "@ouroboros/sdk"; │
│   feature-loop.loop.ts     │  2                                                  │
│   …                        │  3  export default defineLoop("standard-fix", {     │
│   hotfix-p0.loop.ts  ●     │                                                     │
│ ouroboros.config.ts read-only                                                    │
└────────────────────────────┴─────────────────────────────────────────────────────┘
```

**The tree claims only what exists (decision C6).** Its rows are U.3's `GET …/code-tree`, grouped
by the directory in each `path` ([`code-tree.ts`](app/workflows/code/code-tree.ts)). That is one
`.loop.ts` per workflow on the rail, a paused workflow with the rail's err-dot, and
`ouroboros.config.ts` with a read-only badge. A directory is drawn only when a file under it is
served, so `skills/` and `lib/` arrive with X.2
([#181](https://github.com/NobuData/ouroboros/issues/181)) and never as placeholders. The head
names the workspace, because the files belong to it rather than to a repository.

**A workflow's file is its route.** Opening another workflow, from a row or a tab, navigates to its
`/workflows/<slug>/code`, so the head and a deep link always match the pane. `ouroboros.config.ts`
(`GET …/code-config`) is read with the page and opens in place, in the editor's read-only variant.
The route reads the file list and the configuration in parallel with the file, and a refusal
degrades only its own region.

**Tabs and buffers last for the browser session.** [`code-tabs.ts`](app/workflows/code/code-tabs.ts)
decides the session: the tabs, the open one, and each file's unsaved text over the text it was
typed on. [`code-session.ts`](app/workflows/code/code-session.ts) keeps one session per workspace
in a store above any page, written through to `sessionStorage`. An edit therefore survives a detour
to another workflow, and a reload. Storage that throws leaves the store working in memory. **The
modified-dot is that buffer and nothing else.** The edit sets it. Typing the text back, a later read
that caught up, or `markSaved` clears it. `markSaved` is the call V.4
([#172](https://github.com/NobuData/ouroboros/issues/172)) makes when a save succeeds. Closing a
tab keeps its buffer, and each buffer keeps the etag it was typed under.

**Keyboard.** The tree is the WAI-ARIA tree pattern: arrows, Home, End, and Enter or Space. The
strip is the tabs pattern: one tab stop, Left and Right to move, and Delete to close. **Alt+W**
closes the open tab from anywhere in the workbench, because ⌘W and Ctrl+W close the browser's tab.
As in the mockup, the explorer is hidden below 1000px.

### The file saves as it is typed

V.4 ([#172](https://github.com/NobuData/ouroboros/issues/172)) is the editing loop, on U.3's
`PUT /api/v1/workflows/{slug}/code`. Every edit goes to the tab's buffer first, then to
[`use-code-save.ts`](app/workflows/code/use-code-save.ts), which writes the whole file once typing has
rested for 800 ms, or at once on **⌘S** / **Ctrl+S**. The write goes through the `saveCode` Server
Action ([`code-actions.ts`](app/workflows/code/code-actions.ts)) with the draft's etag in `If-Match`.
What each answer means is decided in [`code-save.ts`](app/workflows/code/code-save.ts):

```
type ─ debounce ─ PUT (If-Match) ─▶ 200  dot clears · etag moves
                                  ├▶ 422  squiggles + gutter markers + strip · text kept · draft untouched
                                  ├▶ 409  conflict dialog: Keep mine │ Reload theirs
                                  └▶ offline / 5xx  banner with the real reason · retried
```

**A typo never reaches the draft (decision C4).** The service parses before it writes, so a file that
does not read is a `422 workflow_code_invalid` that changes nothing. The canvas keeps showing the last
draft that parsed. The text stays in the tab with its dot. The response's `details.diagnostics` are
drawn by CodeMirror's lint gutter as squiggles, gutter markers and a hover card, and counted in a strip
under the editor. The strip's first message jumps to its place. The ranges count the text that was
*sent*, so [`code-diagnostics.ts`](app/workflows/code/code-diagnostics.ts) moves them past anything typed
since. After that, CodeMirror carries them through later edits. While the file does not parse, the mode
guard holds the buffer, so switching to Visual asks first. Confirming the switch drops the buffer, which
keeps the prompt's *discards it* true. The next edit is the next attempt, and a save that parses clears
all of it.

**No keystroke is lost.** One write is in flight at most. Whatever is typed meanwhile is pending, and is
written next with the etag the first write was answered with. A save's answer is the file printed
canonically, and it never replaces the editor's text. The dot is measured from the text that was
*sent*, so it stays up for anything typed while the save was in flight. When the page is hidden, left
or unmounted, anything waiting is written at once.

**A concurrent edit asks.** A `409 workflow_draft_conflict` stops the loop, and nothing is ever sent
with `*`. The dialog names the editor that changed the draft and when. **Keep mine** keeps the buffer
and re-reads the page. The route keys the workbench by the file's etag, so the fresh read starts a fresh
loop. A buffer whose base is neither the text read nor typed under the etag read is **diverged**
(`isDiverged`). Nothing saves it; a panel shows a line diff
([`code-diff.ts`](app/workflows/code/code-diff.ts)) with **Save mine over theirs** and **Reload
theirs**. The same check catches a buffer an earlier page left over a draft that has since moved. The
dialog's **Reload theirs** drops the buffer and re-reads; dismissing the dialog with Escape keeps mine,
because dismissing a question must never be the answer that drops text.

**A write that did not arrive says why.** Offline, or a service error, keeps the text and draws
DASH-I.7's retry banner ([#86](https://github.com/NobuData/ouroboros/issues/86)) over the editor. Its
reason is *This browser is offline* first, then the service's own sentence, then that nothing came
back. The write is retried after 2 s, doubling up to 30 s, at once when the browser comes back online,
and whenever **Retry** is pressed. A refusal a retry cannot change, such as `403`, is said and not
retried on its own.

### The editor is CodeMirror 6, and that is a recorded exception

The code view's file (V.2, [#170](https://github.com/NobuData/ouroboros/issues/170)) is edited in
[CodeMirror 6](https://codemirror.net/) (MIT). That is mockup 05's roadmap decision **C1**, and the
second exception to the [stack table](#stack)'s no-framework rule. Monaco was the alternative, and a
real one: the mockup's status bar reads `TypeScript 5.9 · LSP ready`, which Monaco's TypeScript
worker gives almost for free. But the file is a closed grammar, not general TypeScript. Monaco's
checker would pass code the service's parser refuses, the DSL's completions and diagnostics would
still be ours to write, and it costs 2–5 MB gzipped. CodeMirror gives the same hooks for a fraction
of that, with class-based theming precise enough for the mockup's skin. Its cost, measured as P2's
was:

| `/workflows/[slug]/code`, gzipped | before #170 | after | delta |
|---|---:|---:|---:|
| Everything the route loads (layouts + page) | 61.1 kB | 159.0 kB | **+97.9 kB** |
| What the page adds over the shell | 0.3 kB | 98.4 kB | +98.1 kB |
| The same, uncompressed | 0.4 kB | 306.8 kB | +306.4 kB |

Almost all of it is one chunk of 304.1 kB (97.4 kB gzipped). It holds `@codemirror/view`, `state`,
`language` and `commands`, `@lezer/common` and `@lezer/highlight`, and the editor's own modules,
and only the code route loads it; the visual editor's route and every other page are unchanged. The
issue estimated about 150 kB configured; the measured figure is about twice that uncompressed, and
this table is the record. `yarn build && node scripts/route-weight.mjs
'/(app)/workflows/[slug]/code/page'` re-measures it.

**What is mounted, and what is not.**
[`code-editor-extensions.ts`](app/workflows/code/code-editor-extensions.ts) builds the editor from
extensions rather than `basicSetup`. Both variants get the DSL language, line numbers and
special-character marks. The editable one adds undo history, the drawn selection and caret, the
current line and its gutter, and the default keymap, with Tab left unbound so the keyboard can leave.
There is no fold gutter, bracket matching, search panel or autocompletion, because each brings
colours of its own. W.1's `dslIntelligence(table)` joins the list when a page reads the symbol
table.

**The language is a stream parser.** [`dsl-language.ts`](app/workflows/code/dsl-language.ts)
tokenises U.1's grammar into mockup 05's five classes:

- `c-kw`, keywords
- `c-str`, strings and template-literal prompts
- `c-num`, numbers, with `400_000` kept whole
- `c-fn`, callees: a name followed by `(`, so `defineLoop` and `.lte` but not `route` or `effort.M`
- `c-cm`, comments

Between lines it carries only whether a prompt or a block comment is still open. A Lezer grammar
would need a generator step and would build a tree nothing reads, since the parse that can refuse a
file is the service's (V.4). The highlighter gives each class a CSS class and no style.

**Two variants.** A role that may publish gets the editable editor on any file the service does not
mark `readOnly`. It carries the lint gutter for a refused save, and the card says where the save
stands. A member, or anyone reading a published version, gets the read-only
variant. It has no caret, no current line, no history and no keymap, and carries `aria-readonly`.
It stays focusable, so the keyboard can still scroll and select. The config file (V.3,
[#171](https://github.com/NobuData/ouroboros/issues/171)) takes the same `readOnly`.

**Both themes from tokens, and no library colour leaks.**
[`code-editor.css`](app/workflows/code/code-editor.css) is mockup 05's `.ed` skin on tokens:

- the inset well
- `--ink-faint` line numbers in a 3.5rem column with no rule beside them
- the current line in `--accent-tint`, its number in `--accent`, with a 2px `--accent-deep` inset
- a two-pixel `--accent` caret under `--accent-glow`, blinking at the mockup's 1.1 s and held still
  under `prefers-reduced-motion`
- the selection in `--accent-select`
- the five classes in `--accent`, `--ok`, `--warn`, `--model` and italic `--ink-faint`

CodeMirror mounts a base theme with light and dark colours of its own.
`__tests__/workflows/code/code-editor-styles.test.ts` reads that theme from the installed library.
Every colour rule in it must either be re-coloured here on a token or belong to an extension that is
not mounted, so an upgrade that adds a colour goes red. Every rule here is scoped `.code-editor
.cm-editor`, which out-counts the base theme's generated selectors.

The editor is capped at 70vh and scrolls both ways inside itself. Before it mounts, the text is
served as a plain `<pre>` in the same metrics, and the sheet hides that once CodeMirror is in its
host.

**Measured in a browser.** jsdom paints nothing, so the picture was checked in Chromium over the
golden `standard-fix.loop.ts`, in both palettes. Every colour above resolved to its token and none
of CodeMirror's defaults did. Typing 200 characters mid-file at 40 a second dropped no frame: 335
frames, none over 17.5 ms, with key-event processing under 0.2 ms against a 16.7 ms frame. A
500-character line scrolled the editor and left the pane's horizontal overflow at zero.
`code-editor.test.tsx` keeps a jsdom bound on the same work: the median keystroke under one frame. The
screenshot pair is e2e leg 13,
[`tests/e2e/specs/code-editor.spec.ts`](../tests/e2e/specs/code-editor.spec.ts).

### The canvas is React Flow, and that is a recorded exception

The canvas (S.2, [#148](https://github.com/NobuData/ouroboros/issues/148)) is mockup 04's
`.canvas-card` — the dot-grid stage with the definition's stages and connections on it, and
the toolbar beneath — built on [`@xyflow/react`](https://reactflow.dev/) (MIT, 12.x). That is
mockup 04's roadmap decision **P2**, and it is the one exception to the rule in the
[stack table](#stack) that this module takes no component framework. The alternative was
weighed and is recorded there: the mockup is literally absolutely-positioned boxes and SVG
paths, but pan, zoom, drag, rubber-band selection, keyboard navigation and a controlled graph
are weeks of undifferentiated work, and the result would have been a worse React Flow. The
trade is visible rather than assumed, so its cost is measured:

| `/workflows/[slug]`, gzipped | before #148 | after | delta |
|---|---:|---:|---:|
| Everything the route loads (layouts + page) | 60.7 kB | 120.5 kB | **+59.8 kB** |
| What the page adds over the shell | 5.4 kB | 65.2 kB | +59.8 kB |
| The same, uncompressed | 14.8 kB | 207.7 kB | +192.9 kB |

Almost all of it is one chunk — the library, its `d3-zoom`/`d3-drag` and `zustand`
dependencies — that only the two studio routes load; no other page's bundle moves. The figures
come from [`scripts/route-weight.mjs`](scripts/route-weight.mjs), which reads a finished
`next build`'s client-reference manifest and gzips what the route names, because Next 16 prints
no size table: `yarn build && node scripts/route-weight.mjs '/(app)/workflows/[slug]/page'`
re-measures it, and the same script is what mockup 05's decision C1 will use for CodeMirror.

**What the canvas does, and where each thing is decided.** The graph is
**controlled**: [`app/workflows/canvas/graph.ts`](app/workflows/canvas/graph.ts) projects the
P.2 document into React Flow's nodes and edges — one node per stage at the document's own
position, one edge per connection between the sides the two positions decide, the loop edge
arcing over the rows as the mockup's *fail ↺* does — and projects positions back
(`withPositions`) when a move settles, so the seeded `standard-fix` opens at the mockup's
exact positions and a drag ends with the document holding the new one, whole pixels, nothing
else touched. A draft that is not yet a document is read defensively — a node with no position
is placed at the origin, an edge naming a stage that is gone is not drawn — because the
studio's job is to let a reader repair one, and validation is the publish gate's.
[`viewport.ts`](app/workflows/canvas/viewport.ts) remembers where each reader is on each
workflow in `localStorage` under the workflow's id, so following the rail away and back does
not lose the place; home is the origin at 100%, where the mockup's picture is, and the
toolbar's **100%** returns there. Its **−** and **+** climb a ladder of presets rather than a
factor, so a press from 100% lands on 125% and not 120%.
[`studio-canvas.tsx`](app/workflows/canvas/studio-canvas.tsx) mounts the library with a plain
drag as a **selection** and panning on **⌥** or **space** with the drag (the mockup's own
hint), or the middle or right button; the wheel and pinch zoom; React Flow's keyboard model —
Tab to a stage or an edge, Enter to select, arrows to move, Escape to clear — is left on and
named in the hint. A single selected stage or edge is reported to whoever mounts the canvas —
the inspector's binding (S.4) — and the toolbar says what is selected. Every edit, a move
included, is followed by *Edited, not saved — autosave arrives with #152*, because a page that
let a reader build a graph and reload would have lied by omission. What the canvas edits, and
how, is [its own section](#the-canvas-builds-and-refuses-what-the-dsl-forbids).

**Both themes from tokens, and no library colour leaks.** Only React Flow's structural sheet
(`base.css`) is imported, never its default look, and every `--xy-*-default` it would fall
back to is redefined on a token in [`canvas.css`](app/workflows/canvas/canvas.css);
`__tests__/workflows/canvas/canvas-styles.test.ts` reads the library's own sheet and holds the
list equal, so a library upgrade that adds a colour goes red there rather than grey on the
canvas. The library's `colorMode` is never set: the tokens already switch with the palette.
What the stages and edges look like is the next section's.

The suites render the real library under jsdom through
[`__tests__/helpers/react-flow.ts`](__tests__/helpers/react-flow.ts), the shim React Flow's
own testing guide gives, and open on the committed
`schemas/workflow-dsl/fixtures/valid/standard-fix.json` — the document the seed stores — so
*the seeded graph renders at the mockup's positions* is asserted against the seed and not a
second transcription of it. What jsdom cannot prove is a pixel: the dot grid's 18px lattice and
the picture itself were checked in Chrome against the seeded workspace in both palettes, and
the 60fps criterion was measured there as main-thread cost per interaction event — under 2 ms
at the 95th percentile for both wheel zoom and a button-drag pan over the twelve-node graph,
against a 16.7 ms frame — which is the part of *smooth* a script can measure.

### Stages and edges speak mockup 04's visual language

The octagonal decisions, the chip rows and the glowing dashed loop-back are what make the canvas
recognisably Ouroboros rather than a generic node editor, and they are the one part of it React
Flow cannot supply (S.3, [#149](https://github.com/NobuData/ouroboros/issues/149)).

**Five treatments, one per type.** [`stage-node.tsx`](app/workflows/canvas/stage-node.tsx) draws
each stage in its type's treatment — the trigger's accent rail and top rule, the model stage's
violet, the infra stage's warn, the flow node's dim ink cut to an octagon, the terminal's green —
and *Back to queue* (`back_to_queue`, the one terminal that hands a ticket back rather than
finishing it) as the mockup's mini pill. A treatment is one custom property in
[`canvas.css`](app/workflows/canvas/canvas.css), `--studio-node-hue`, which the rail and the type
line are drawn in, so hover and selection change the rim without restating five colours. The
selected stage wears the mockup's `.sel` ring — the accent rim, a ring in the accent tint and the
accent's glow — and a selected octagon, which clips its own box-shadow, wears it as drop-shadows
on React Flow's unclipped wrapper.

**The type line and the chips are read from the document on every render**
([`treatment.ts`](app/workflows/canvas/treatment.ts)). The type line is the type's glyph and the
stage's role: *Trigger* and *Terminal* from the type, *Decision* or *Gate* from a flow node's
`kind`, and a model or infra stage's id (`analyze` → *Analyze*), which is the one place the
document names what such a stage is for. The chips come from `config` — `skill:<name>` or
`prompt template`, the pinned alias or `routed by task`, the command and `runner <pool>`, the
predicate (`effort ≤ M`, `required checks: 3`), `squash · delete branch` — and the trigger node's
from the document's root trigger, where the DSL keeps the predicate. Nothing is stored, so editing
a stage's config is editing its chip, with no second write to forget. Where that differs from the
mockup's picture the document wins — registry aliases where the mockup prints model ids, three
checks where it prints fourteen — and the module's header lists every difference.

**Edges** ([`stage-edge.tsx`](app/workflows/canvas/stage-edge.tsx)) are one custom edge in three
treatments: the plain line, the dashed accent-deep **loop** under its own glow, and the accent
**active** path, each ending in one of the mockup's three arrowheads — defined once per canvas and
filled from tokens, because the library's markers take their colour from an attribute the token
sheet cannot switch. A label is an HTML pill in React Flow's label layer, in the tone its
**condition** reports (checks passed ok, failed err; an effort within its bound the accent, past
it warn) and never one read from the label's text; it sits above a row's edge, beside a column's
and on a curve, as the mockup sets them, and is hidden from the accessibility tree because the
edge's name already carries it. A branch that changes rows leaves its decision's bottom, as the
mockup's `> M ↘` does, rather than crossing back over the edge that arrived.

**Highlight mode.** `StudioCanvas`'s `highlight` prop takes an execution path in the dry run's own
shape — `highlight_path`, a list of `{from, to}` — and draws those edges active. It is laid over
the edges at render (`graph.ts`'s `withHighlight`) and never stored in them, so S.6
([#152](https://github.com/NobuData/ouroboros/issues/152)) hands the dry run's answer straight
through and clears it with `null` without remounting the canvas under a reader. The suites
exercise it with the mockup's own four accent edges (`MOCKUP_ACTIVE_PATH`), which is also S.6's
criterion for the dry run of `#485`.

**Each claim is proven where it can be.** `treatment.test.ts` holds every derivation to the
seed; `stage-node.test.tsx` re-renders React Flow with one config field changed and nothing else,
and watches the chip follow; `studio-canvas.test.tsx` asserts the treatments, the arrowheads, the
tones and the highlight on the rendered canvas; `canvas-styles.test.ts` holds each treatment to
its token. The picture is the e2e suite's: leg 12
([`tests/e2e/specs/studio.spec.ts`](../tests/e2e/specs/studio.spec.ts)) diffs the canvas with
*Implement* selected in both palettes and asks the browser for what jsdom cannot compute — the
octagon's clip-path, the pill's 176 × 44, the loop's dash and its accent-deep in each palette, the
selection's glow. Its baselines draw no accent path, because nothing on the page draws one until
S.6. The marketplace's provenance chip (`⊞ slug@version`, mockup 23's amendment to this ticket) is
[#798](https://github.com/NobuData/ouroboros/issues/798)'s.

### The canvas builds, and refuses what the DSL forbids

S.5 ([#151](https://github.com/NobuData/ouroboros/issues/151)) makes the mockup's toolbar keep its
promises — **Add stage ▾**, **Auto-layout**, *double-click edge to add stage* — and adds what a
builder needs beside them: connecting, editing an edge, deleting with a confirmation, and undo.

**Every edit is a function over the document.** [`canvas/edit.ts`](app/workflows/canvas/edit.ts)
adds a stage from the catalog's defaults (its id slugged from the title, numbered when taken), draws
a connection, replaces an edge's kind, label and condition, inserts a stage into an edge and deletes
a selection; each takes the draft and returns a new one, the input untouched.
[`studio-editor.tsx`](app/workflows/studio-editor.tsx) holds the draft as a bounded history of those
documents ([`history.ts`](app/workflows/history.ts), fifty steps), so **Undo** and **Redo** — on the
toolbar, and ⌘Z / Ctrl+Z and ⇧⌘Z / Ctrl+Y over the canvas — show a previous document again with no
inverse operation to write. The canvas reconciles its nodes against whatever document it is handed:
position, config and name from the document, measurements and selection kept. The editor's
`onDraftChange` is the seam S.6's autosave will write from.

**The DSL's rules are checked at the edit, not at publish.**
[`canvas/rules.ts`](app/workflows/canvas/rules.ts) is `docs/WORKFLOW_DSL.md` § 7 in the browser, and
`rules.test.ts` replays every structural case of `schemas/workflow-dsl/fixtures/expected.json` — the
parity file both validators are held to — against it, so the canvas and the publish gate refuse the
same things in the same terms. Each edit asks it first and is refused with the rule's reason where
the edit was made: a connection drawn on the canvas says *Not connected: Nothing can leave a
terminal — it is where a run ends.* on the toolbar's notice line; the Add stage menu keeps *Trigger*
in its list, inert, with *A workflow can only have one trigger.* under it; the edge panel says why a
branch or a loop is illegal under its field and keeps **Apply** inert. The rules that describe an
unfinished graph — no terminal yet, a stage not yet connected — stay the publish gate's, because
every graph is unfinished while it is being built.

**Connecting, inserting, deleting.** A drag from any side of a stage to another draws a `default`
edge; the handles show on a hovered or selected stage, and React Flow connects in its loose mode so
either handle of a side will do. A double-click on an edge opens the same catalog menu to insert a
stage into it: `A → B` becomes `A → new`, which keeps the old edge's kind, label and condition
(they describe how a run leaves `A`), and `new → B`, a plain edge — a loop stays legal, because the
new stage reaches back through `B`. A trigger or a terminal cannot sit between two stages, and the
menu says which rule each would break. Delete or Backspace over a selection, **Delete stage** and
**Delete edge** all ask first ([`confirm-delete.tsx`](app/workflows/confirm-delete.tsx)), naming what
goes and how many connected edges go with it.

**The edge panel.** Selecting an edge opens
[`inspector/edge-inspector.tsx`](app/workflows/inspector/edge-inspector.tsx): its kind, its label,
and — for a branch, where it is required, or a loop, where it is optional — its condition in P8's
structured shape, drawn by the predicate builder a flow node's predicate uses (`PredicateFields`)
from the grammar the catalog serves. **Insert stage ▾** and **Delete edge** sit beside **Apply**.

**Auto-layout** ([`canvas/auto-layout.ts`](app/workflows/canvas/auto-layout.ts)) is
[dagre](https://github.com/dagrejs/dagre)'s layered layout, left to right, at the mockup's rhythm:
columns 282px apart and the graph starting where the trigger does, at `(24, 40)`. Loop edges are left
out of the layering, so a loop still reads as a way back, and each stage is laid out at least as
large as `canvas.css` draws it — larger when React Flow has measured it bigger — so no two overlap.
The module is imported when the button is pressed, so dagre is not in the studio's first load. It is
not called `layout.ts`: anywhere under `app/`, Next.js reads a file of that name as a route layout.

**Every operation has a keyboard path.** Add stage, Auto-layout, Undo and Redo are toolbar buttons;
Tab and Enter select a stage or an edge, the arrows move a stage, Delete removes the selection; a
stage's panel has **Connect to**, which draws the edge a drag would; an edge's panel edits its kind,
label and condition and inserts into it. A member sees each structural edit inert with *Only an owner
or admin may change a workflow.*, and a Delete or a double-click says so on the notice line.

**Each criterion is a suite.** `studio-editor-editing.test.tsx` builds `docs-loop` from a blank
canvas — its four stages from the catalog; the model stage's prompt, route, limits and declarations
and the build and terminal configs through the inspector; two connections from the keyboard and one
on the canvas; then Auto-layout — and holds the result to the published `v1.json` (ajv, 2020-12,
strict) and the structural rules, and to the node types, configs and connections
`R__dev_seed_workflows.sql` stores for `docs-loop`. Two things stay the catalog's: the stages' titles
(the inspector renames nothing, S.4's decision) and the trigger's conditions (a trigger has no form),
so the built document fires on every queued ticket. The same suite steps back and forward through
an add, a move and a delete. `studio-canvas-editing.test.tsx` connects by React Flow's
click-to-connect, the path jsdom can drive, which runs the same `onConnect` a drag does;
`auto-layout.test.ts` lays the seeded graph out with no overlaps and every non-loop edge ending in a
later column; `edit.test.ts` inserts a stage into every seeded edge and finds each result
structurally sound.

### Drafts save, publishes gate, dry runs walk

S.6 ([#152](https://github.com/NobuData/ouroboros/issues/152)) makes the editor's draft durable,
publishable and explainable. One open workflow's page is wrapped in
[`studio-session.tsx`](app/workflows/studio-session.tsx), keyed by the workflow's id. It holds the draft
the editor hands up, the etag it was saved under, the version in force and the dry run on the canvas.
The head's actions and subline, the editor and the toast read it through
`studio-session-context.ts`. That module is kept apart from the provider because the provider calls the
Server Actions, and a part that only reads the session must still render on its own.

```
edit ─▶ autosave (1.2 s, If-Match etag) ─┬─ 200 ─▶ "All changes saved." · head: Last edited · v14 · draft edits
                                         └─ 409 ─▶ reload dialog — nothing overwritten, autosave stops
Publish v15 ─▶ write what waits ─▶ POST /publish ─┬─ 422 findings ─▶ click one = select that stage
                                                  └─ 200 ─▶ "Published v15." · Publish v16 · rail refreshed
Dry run ─▶ pick a sized issue (#485) ─▶ write what waits ─▶ POST /dry-run ─▶ accent path + step sheet ─▶ any edit clears it
```

**Autosave never clobbers.** [`use-autosave.ts`](app/workflows/use-autosave.ts) writes an edit once it
has rested ([`autosave.ts`](app/workflows/autosave.ts)'s `AUTOSAVE_DELAY_MS`), one write at a time, each
carrying the etag the previous write was answered with. A `409 workflow_draft_conflict` stops it for
good. The reload dialog then says which editor changed the draft and when, that nothing was
overwritten, and that **Reload the draft** reloads the page. **Not now** leaves the page readable, and
the toolbar says autosave is paused. A document equal to the stored one is never written (the editor's
opening hand-up, an undo back to it), and key order does not count. When the tab is hidden, left or
unmounted, whatever is waiting is written at once, and leaving with an unwritten edit asks first. That
is how *edit → close the tab → reopen* finds the draft intact. A member's page writes nothing.

**The head says when the draft is not what runs.** `view.ts`' `sublineOf` composes the subline from
facts, so the server and the session share one sentence. `draft edits` joins it beside the version
whenever the draft diverges from the version in force.

**Publish gates, and a refusal is something to act on.** [`publish-dialog.tsx`](app/workflows/publish-dialog.tsx)
takes an optional change note. The session writes any waiting edit first, so the version is the
picture on the screen, then asks the gate. A `422` lists every finding in
[`finding-list.tsx`](app/workflows/finding-list.tsx) with the validator that raised it.
[`publish.ts`](app/workflows/publish.ts)' `findingAnchor` resolves a finding's `node`, else the stage its
`edge` leaves, else the node its JSON Pointer points into, and that finding becomes a button. Pressing
it closes the dialog and asks the canvas (its `focus` prop) to select the stage, report it to the
inspector and bring it into view. A finding about the whole document is listed as text. A success moves
the version, leaves a toast that stays until dismissed, and refreshes the route so the rail's captions
follow.

**The dry run is the engine's walk, on the canvas.** The picker
([`dry-run-dialog.tsx`](app/workflows/dry-run-dialog.tsx)) offers the workspace's open, sized issues and
opens on `#485` when the workspace has it. `ouroboros-rest`'s `POST /api/v1/workflows/{id}/dry-run`
(added by this ticket) reads that issue's labels and effort itself, walks the stored draft through the
engine, and answers in camelCase. The canvas paints the whole `highlightPath`. For the seeded
`standard-fix` and `#485`, the mockup's four accent edges are its prefix, as the engine's own suite
asserts.

[`dry-run-sheet.tsx`](app/workflows/dry-run-sheet.tsx) takes the inspector's track. It lists every stage
reached, with the simulator's verdict and annotation and the predicate it tested (marked when only a run
could answer it). Under each stage it lists **every edge out of it**: taken, not taken or loop, each with
the engine's explanation and each loop with its retry bound. A step's title selects its stage without
closing the sheet. **Any new draft clears the overlay**, a move or an undo included, because a walk of
another draft would be a lie about this one. The code view's **Publish** opens the same dialog
([#174](https://github.com/NobuData/ouroboros/issues/174), [below](#the-status-bar-validate-and-publish)).

**Each criterion is a suite.** `studio-flows.test.tsx` drives the session, head, editor on the real
canvas, dialogs and toast over mocked Server Actions:
- a hidden tab writes the moved stage with the page's etag;
- a `409` opens the reload dialog and nothing more is sent;
- an invalid publish's finding selects `implement`;
- a publish moves the head to `v15` and the label to `Publish v16`;
- the dry run paints `MOCKUP_ACTIVE_PATH`, and a move clears it.

`use-autosave.test.tsx` holds the debounce, the serial etags, the stop on conflict and the page-hide
write on a fake clock. `dry-run-sheet.test.tsx` holds both branches and the loop bound. `autosave`,
`publish`, `dry-run` and `draft-actions` are unit suites, and `flows-styles.test.ts` holds the sheet's
placement.

### The right panel — checks, types, outline

V.5 ([#173](https://github.com/NobuData/ouroboros/issues/173)) is mockup 05's `.rp`, beside the
route's file while its tab is open. Every decision is in
[`code-panel.ts`](app/workflows/code/code-panel.ts); the drawing is
[`code-panel-view.tsx`](app/workflows/code/code-panel-view.tsx) and
[`code-panel.css`](app/workflows/code/code-panel.css).

```
┌ LOOP CHECKS ─────────────────────────────┐
│ ✓ Graph acyclic except declared gate loop │   GET …/{slug}/code/checks (W.2)
│ ✓ All task routes resolve                 │
│     models configured for analyze · …     │   no infra row (C7)
├ TYPES ───────────────────────────────────┤
│ route.task(name: TaskKind): ModelRoute    │   hoverAt(table, text, cursor) — or nothing
├ OUTLINE ─────────────────────────────────┤
│ 07 ▸ implement                            │   the file's spans, node order
│ 11 ⟲ checks-green       back-edge → 07    │   onFail at the option depth
└──────────────────────────────────────────┘   click a row ─▶ the editor's cursor on that call
```

**The route reads it beside the file.** `code-data.ts` asks `workflows.codeChecks(slug)` and
`workflows.codeSymbols()` in parallel with the file, and each is its own degraded region: refused
checks say why in place of the rows, and a refused table draws a sentence instead of a card.

**Nothing is drawn that was not observed.** Only the row ids the panel knows (`graph`, `references`)
are drawn, so mockup 05's *pool-a has 1 runner offline* cannot appear, even from a service that sent
it (decision **C7**). The Types card is the table's card for the symbol at the cursor, and nothing for
a word the table does not describe. Rows derived before a save say they predate it.

**The outline is the span map, and its jump is a diagnostic's.** One row per stage call, numbered
from `01` in node order. A call that declares `onFail` two spaces deeper than itself is the `⟲` row,
in the accent, noted with the rows its loop edges return to. The span map is kept with the text it
counts, the read's and then each save's, and a row's jump goes through `CodeEditor`'s `reveal`, so it
lands on the call's line after lines are typed above it, and in a member's read-only editor too.

**Below 1000px** the panel hides, as the mockup's media rule does. A **Checks & outline** disclosure
button in the workbench's row of toggles (V.7, beside **Explorer**) shows it again as a row under the
editor.

The suites run on the golden files: `code-panel.test.ts` (decisions, with the printer's
`standard-fix.loop.ts` and `spans.json`), `code-panel-view.test.tsx` (the drawing, C7 against the
mockup's own row, both palettes), `code-panel-flow.test.tsx` (the whole page: the cursor, the jumps,
the toggle) and `code-panel-styles.test.ts` (the sheet).

### The status bar, Validate and Publish

V.6 ([#174](https://github.com/NobuData/ouroboros/issues/174)) closes the workbench with mockup 05's
`.statusbar` and makes the head's two actions run the pipelines the visual editor runs.

```
⟲ synced with visual editor · v15 draft               DSL analyzer · Ln 24, Col 18 · UTF-8
  └ saving… │ parse error │ conflict │ not saved          └ C5: never "LSP ready"

[Validate]    ─▶ flush the save ─▶ POST …/{slug}/code/validate ─▶ Loop Checks + editor diagnostics
                                    (zod ▸ registry ▸ engine, nothing written)
[Publish v15] ─▶ S.6's PublishDialog ─▶ flush ─▶ publishWorkflow ─┬ refused: findings in the dialog and the file
                                                                   └ taken: v16 on the head, the strip, and Visual
```

**The strip says only what was observed** ([`code-status.ts`](app/workflows/code/code-status.ts),
drawn by [`code-status-bar.tsx`](app/workflows/code/code-status-bar.tsx)). *synced with visual editor*
holds only while nothing typed is unwritten. From the first keystroke it reads *saving…*, then
*parse error* while the service refuses the text, *conflict* when another editor's change stops the
loop or a kept text waits beside a moved draft, and *not saved* while a failed write waits for its
retry. `vN draft` counts from the version in force, as Publish does; a file printed from the version
in force with nothing written reads `v14 in force`. `Ln`/`Col` is the editor's cursor in line feeds
and UTF-16 units, the service's own range units. The right cluster reads **`DSL analyzer`**, not the
mockup's `TypeScript 5.9 · LSP ready` (decision **C5**): there is no language server behind this editor,
and #183's ADR is where that wording is revisited.

**Validate is "check my work".** It writes what is waiting, then calls the `validateCode` Server
Action. `ouroboros-rest` runs the publish gate itself (zod, the registry, then the engine) over the
stored draft and writes nothing. The answer's rows replace Loop Checks. Its findings are drawn in the
editor while the page still holds the draft they were found in; after a later save, the panel says
its rows predate the save instead. A file that does not parse, a conflict or a failed write stops it
first, and an engine that cannot answer is said in words, never reported green. Every member may
validate.

**Publish is S.6's dialog** ([`code-flows-session.tsx`](app/workflows/code/code-flows-session.tsx)).
Its submit writes what is waiting, then calls the same `publishWorkflow` the canvas calls. A refusal's
findings are listed in the dialog, anchored through the file's span map
([`code-findings.ts`](app/workflows/code/code-findings.ts)). Each one puts the editor's cursor on its
stage when selected, and all are drawn on their stages' lines. A success moves **Publish** and the
strip to the next version and leaves the notice. It also refreshes the route, so the rail, and the
visual editor's head that reads it, show the same version.

Without a file on the page (a refused read, or a draft with no spelling as code) both actions are
inert and say why.

`code-status.test.ts`, `code-flows.test.ts` and `code-findings.test.ts` hold the decisions.
`code-flows-flow.test.tsx` drives the page over the three mocked Server Actions: every save state in the
strip, the live cursor, Validate's checks and diagnostics with no publish, the version bump, and a
refused publish's findings. `code-status-bar-styles.test.ts` holds the sheets, and
`workflows-code-validate.test.ts` holds the wire.

### Code intelligence — completions and hover docs

The code editor itself is V.2's ([#170](https://github.com/NobuData/ouroboros/issues/170),
[above](#the-editor-is-codemirror-6-and-that-is-a-recorded-exception)). What W.1
([#177](https://github.com/NobuData/ouroboros/issues/177)) ships is the intelligence that editor
is built to mount, in [`app/workflows/code/`](app/workflows/code). The code route now reads the
symbol table for the right panel's Types card ([below](#the-right-panel--checks-types-outline)), but
the editor extension itself is not mounted yet:

```ts
const table = await workflows.codeSymbols();           // server-side, passed to the editor's client component
new EditorView({ extensions: [basicSetup, dslIntelligence(table)] });
```

| Module | What it does |
|---|---|
| `context.ts` | Names the cursor's place — `stage.llm.options`, `route.task`, `predicate.effort` — with a small scanner that skips strings, template literals and comments and never fails on a half-typed file |
| `completions.ts` | The CodeMirror completion source: the scope's entries and no others, string values quoted, workspace names labelled *suggested* |
| `hover.ts` | The CodeMirror hover tooltip: the card for a described symbol, and **no tooltip at all** for anything else |
| `hover-doc.tsx` | `HoverDocCard`, mockup 05's Types card, for the panel V.5 ([#173](https://github.com/NobuData/ouroboros/issues/173)) mounts; the tooltip builds the same markup |
| `intelligence.ts` | Both, as one extension |

**The table is the service's**, `GET /api/v1/workflows/code-symbols`. Nothing in this directory
knows an option key, an enum value or a doc, so a key added to the grammar is offered with no change
here. What `context.ts` does know is the grammar's *shape*: that `stages` holds stage calls, that
`branches` holds edge entries, that `route.` and an arrow's parameter start member chains.

**The card says only what the schema says.** Its doc line is the schema's `description`, verbatim;
a symbol with none draws no doc line, and a name the table does not describe draws no card. The
mockup's *"Falls back to the tenant default chain."* is not drawn, because routing has no such
chain.

The suites in `__tests__/workflows/code/` run against the shared golden files: the table
`ouroboros-rest` asserts it serves (`schemas/workflow-dsl/fixtures/code-symbols/table.json`) and the
printer's `standard-fix.loop.ts`. Both themes are proven as the primitives' are: identical markup
under both palettes, and every hue a token both palettes define (`code-styles.test.ts`).

`@codemirror/state`, `@codemirror/view` and `@codemirror/autocomplete` (MIT) arrive with this
directory. No route imports it yet, so no page's bundle grows until V.2 mounts the editor and
records the delta (decision **C1**).

## The polling store

The page's cards and the header's two pills all want the same freshness, and
[`../docs/ARCHITECTURE.md` § 5.4](../docs/ARCHITECTURE.md#54-the-polling-contract) is the
contract that gives it to them from **one loop**
([#87](https://github.com/NobuData/ouroboros/issues/87)). Independent pollers would multiply
the server's cost and — worse — let a pill and a card disagree, on one screen at one moment,
about how many loops are live.

```
(app)/layout.tsx
  └─ <DashboardSummaryProvider>          one poll, built here and nowhere lower
       ├─ header · live pill · needs-you pill      ┐
       └─ page  · stat cards · tables · banner     ┘ all read useDashboardSummary()
```

```ts
const { data, updatedAt, error } = useDashboardSummary();
```

| Field | What it means |
|---|---|
| `data` | the last payload read, or `null` before the first answer. **Survives a failure** — the numbers on screen were true a moment ago, and blanking them replaces a slightly old truth with none |
| `updatedAt` | when `data` was last *confirmed current*, epoch ms. A `304` moves it as surely as a `200` does: *nothing has changed* is a fresh statement about the payload already held |
| `error` | why the last attempt failed, as a sentence for a person, or `null`. Cleared by the next success, so it describes the current state rather than the worst thing that ever happened to the page |

The loop itself is [`app/poll.ts`](app/poll.ts) — generic over what it polls since
[#117](https://github.com/NobuData/ouroboros/issues/117), when the backlog table needed the same
thing over a different payload — and
[`app/dashboard/summary-poll.ts`](app/dashboard/summary-poll.ts) is the dashboard's reader over
it. It is framework-free, so every clause of the contract is a unit test against mocked timers
rather than a rendered page: fifteen seconds while visible, **nothing at all** while hidden and an
immediate ask on return, the `ETag` echoed as `If-None-Match` and replaced by each answer,
and `X-Ouro-Poll-After` as the effective interval — which is how an operator raising
`OURO_DASHBOARD_POLL_SECONDS` slows every open dashboard within one poll cycle, with nothing
shipped to a browser. Requests never overlap: an ask that overtakes another wins, and the
overtaken answer is dropped on arrival rather than raced into the store. The route handlers
that answer a poll on this origin share one translation from an answer to HTTP,
[`app/api/poll-response.ts`](app/api/poll-response.ts): a `304` with no body, a `401` said
plainly rather than redirected, a failure under this hop's own code with the service's sentence.

**Two moments do not wait out the interval**, and both say so through
[`summary-refresh.ts`](app/dashboard/summary-refresh.ts) rather than by holding the poll: a
workspace switch (`switchWorkspace()` publishes it — `router.refresh()` moves the server's
half and knows nothing about client state) and, with
[#83](https://github.com/NobuData/ouroboros/issues/83), the auto-merge write.

**A `401` stops the loop rather than navigating.** A poll is not a render, so the session
ending is an answer — `error` says so, the interval stops, and coming back to the tab tries
once more, which is what makes signing in again in another tab enough to revive this one. The
thing that actually sends somebody to `/login` is the next render of any `(app)` screen,
through `requireWorkspace()`.

## App shell

Every signed-in screen renders inside the shell
([#41](https://github.com/NobuData/ouroboros/issues/41), completed by
[CP.1 #643](https://github.com/NobuData/ouroboros/issues/643) and
[CP.2 #644](https://github.com/NobuData/ouroboros/issues/644)), specified in
[`../docs/DESIGN_SYSTEM_APP_SHELL.md`](../docs/DESIGN_SYSTEM_APP_SHELL.md) § 1 — which
supersedes the top-bar navigation the mockups were drawn with.

```
┌──────────────────────────────────────────────────────────────────┐
│ ◎ OUROBOROS [acme-robotics]                                      │  header —
│        [Search ⌘K] [● 3 loops live] [● Needs you · 2] [🔔] [KS ▾] │  no nav links
├───────────────┬──────────────────────────────────────────────────┤
│ ▦ Dashboard   │                                                  │
│ ◉ Issues      │   {page}                                       ░ │  ← the only
│ …             │                                                ░ │    scrollbar
│ ───────────   │                                                  │
│ ▣ Needs You   │                                                  │
│ ⚙ Settings    │                                                  │
└───────────────┴──────────────────────────────────────────────────┘
        overlays portal here — beside the pane, never inside it
```

Five things are worth knowing before adding a screen to it.

1. **The pane is the only scroll container.** `html` and `body` are locked in
   `globals.css`; [`app/shell/app-shell.tsx`](app/shell/app-shell.tsx) is a grid of
   exactly the viewport, and the content pane owns `overflow-y`. So a page never sets
   `position: fixed` to keep something visible, and wide content (tables, diffs,
   timelines) scrolls sideways **inside its own `overflow-x` wrapper** — one page without
   that wrapper is all it takes to start the pane scrolling sideways. The pane carries
   `data-shell-pane` so CP.5 ([#647](https://github.com/NobuData/ouroboros/issues/647))
   can audit exactly that, per route. A screen rendered *outside* the shell inherits the
   lock and owns its own scroll container.
2. **Navigation is a registry, and adding an entry needs no shell edit.** A module
   registers itself and [`app/shell/sidebar-nav.tsx`](app/shell/sidebar-nav.tsx) renders
   whatever is registered — it names no module and does not change to gain one:

   ```ts
   import { registerNavEntry } from "@/app/shell/nav-registry";
   import { Telescope } from "lucide-react";

   registerNavEntry({
     id: "research", label: "Research", route: "/research",
     icon: Telescope, group: "primary", sort: 80,
   });
   ```

   [`nav-registry.ts`](app/shell/nav-registry.ts) is the registry,
   [`nav-modules.ts`](app/shell/nav-modules.ts) seeds the eleven entries § 1.2 names (with
   **lucide** icons, this module's recorded icon set), and [`nav.ts`](app/shell/nav.ts) is
   the pure model over both: the ordering rule (`sort`, then id — never registration order,
   which is a bundler's business), the capability filter, and the rule that decides which
   entry a URL belongs to. `/` matches only `/`; every other entry owns its route **and
   everything under it**, so `/models/registry` keeps **Models** highlighted.

   Two things a registration may also carry. `badgeSource` names a count rather than
   holding one — whoever can compute it calls `setNavBadge(source, count)`, and a source
   that has published nothing draws **no badge**, because "we have not counted" is not the
   same claim as "nothing is waiting". `capability` hides the entry, with no gap left
   behind, until that capability is among the set `setNavCapabilities` published; both
   publishers refuse to run outside the browser, since a module singleton on the server is
   shared by every request the process handles.
3. **An entry links only to a route that exists.** Eight of the eleven screens are unbuilt,
   so their rows render as labelled *soon* text — not links, not in the tab order, not in
   the arrow-key ring, each naming the issue that will build it (the registry refuses a
   `soon` entry that does not). Building one means dropping its `status` in the same pull
   request as the route.
4. **What is a slot, not an omission.** The bar carries every slot § 1.1 names, in its
   order: the tenant chip beside the brand, then search · live-loops · needs-you ·
   notifications · [account menu](#the-account-menu). The menu, the chip and both pills are
   finished; the ⌘K palette behind the search pill is #79. Nothing shows a number nobody
   computed, which is the design system's honesty rule (§ 3.5) — and since H.2
   ([#78](https://github.com/NobuData/ouroboros/issues/78)) that cuts both ways: the pills
   carry the [store](#the-polling-store)'s real counts, and a pill with nothing to report is
   **not drawn at all** rather than drawn as a zero, so an empty workspace gets an empty slot
   instead of a pair of noughts. The count that moves does so inside an `aria-live="polite"`
   region that was already on the page, so a change is announced as an update rather than
   missed as an insertion. The theme control and the settings entry   live *inside* the profile menu since CP.3
   ([#645](https://github.com/NobuData/ouroboros/issues/645)) — § 1.1 puts them there,
   and a control drawn twice is a state that can be read twice differently.
5. **Overlays render beside the pane, not inside it.**
   [`app/shell/overlay.tsx`](app/shell/overlay.tsx) portals into a layer that is a sibling
   of the pane, so a dialog can cover the header instead of being clipped by the grid cell
   it was opened from — and it **locks the pane's scroll** while it is up, restoring the
   position on close. The lock is
   [`app/shell/pane-scroll.ts`](app/shell/pane-scroll.ts), which is worth reading before
   changing: `scrollbar-gutter: stable` reserves the scrollbar's width only for an
   `overflow` of `scroll` or `auto`, so locking with `hidden` un-reserves it and the pane's
   contents reflow underneath the dialog unless the measured width is handed back as
   padding. Anything full-viewport — a sheet, a confirmation, the palette — builds on this
   rather than on a `position: fixed` of its own.

### The sidebar's three widths

All three § 1.2 names are custom properties on the shell and the grid's first column is
`auto`, so moving between them is a one-property change and no layout is touched:

| Width | Reached by |
|---|---|
| 240px expanded | the default above 1024px, or the chevron at any width |
| 64px icon rail | the default below 1024px, or the chevron at any width |
| overlay drawer | below 768px, from the header's hamburger — out of flow, so the slot is 0 |

The **rail's own treatment** — names becoming tooltips — is a container query on the
sidebar's measured width rather than a rule per trigger, because "is there room for the
word?" is one question however the width was arrived at (and the drawer, at 240px, keeps its
labels). The label is hidden *visually* and left in the accessibility tree, so a row is
announced identically at both widths.

The **collapse choice is remembered per reader** and applied before the first paint:
[`sidebar-state.ts`](app/shell/sidebar-state.ts) stamps `data-sidebar` on `<html>` from an
inline boot script, the same pattern (and for the same reason) as the
[theme engine](#theming) — a sidebar collapsed last week must not be seen collapsing again.
A server-side account preference is CQ.2's
([#649](https://github.com/NobuData/ouroboros/issues/649)); the local mirror is what boots
either way.

The **drawer** is focus-trapped and closes on Escape, on the ground behind it, on a link
followed out of it, and on the window growing past 768px. The trap is
[`focus-trap.ts`](app/shell/focus-trap.ts), shared with the overlay above.

The **keyboard** through all of it: one roving tab stop, arrows and Home/End between entries
(wrapping at both ends), and Enter needing no handler because every reachable entry is a
real `<a href>`.

### The ⌘K palette, and its action registry

`⌘K` / `Ctrl+K` from any screen — or the header's search pill — opens
[`app/shell/command-palette.tsx`](app/shell/command-palette.tsx)
([#79](https://github.com/NobuData/ouroboros/issues/79)). **MVP scope is navigation**, which
is the issue's own decision and the reason the palette says so on its face: content search
needs issue and run data that only partly exists, and a search shipped now would be a search
that finds nothing.

```
⌘K ─▶ ┌ Search screens and commands…──────────────┐
      │ NAVIGATION                                │
      │  ▸ Go to Dashboard                        │  ← ↑↓ walk these
      │  ▸ Go to Issues                           │
      │  ▸ Go to Workflows    Builder · mockup 04 │  ← and skip these
      │ ACTIONS                                   │
      │  ▸ Toggle theme                   to dark │
      │  ▸ Sign out                               │
      └───────────────────────────────────────────┘
```

**It names no source.** A surface registers what it can contribute and the palette renders
whatever is registered — the same argument the sidebar's registry makes, and the reason
[#93](https://github.com/NobuData/ouroboros/issues/93)'s content search is a new file rather
than an edit to this one:

```ts
import { registerCommandSource } from "@/app/shell/command-registry";

registerCommandSource({
  id: "issues",
  sort: 30,
  async find(query, context, signal) {          // over the wire, debounced, abortable
    const found = await searchIssues(query, { signal });
    return found.map((issue) => ({
      id: `issues:${issue.number}`,             // source-prefixed, unique across the palette
      label: `#${issue.number} ${issue.title}`,
      group: "Issues",                          // its own heading, below Navigation
      run: () => context.navigate(`/issues/${issue.number}`),
    }));
  },
});
```

A source has **two halves and needs at least one** (the registry refuses one with neither).
`list(context)` answers synchronously from what the shell already knows and is filtered by the
palette's own matcher; `find(query, context, signal)` answers over the wire, is asked only for
a non-empty query, is **debounced by the palette** and handed a signal that fires when the
query moves on — and its results are *not* re-filtered, because a source that searched has
already decided what matches. A rejection contributes nothing; saying so is the source's own
business, and the shape for it is an unavailable action carrying the reason. The `context` is
what the shell knows and a source cannot ask for itself — the permitted navigation entries,
`navigate`, the resolved theme and `setTheme`, and `signOut` — because a source is a plain
object registered at module scope and has no hooks.

An action either **does something or says why it cannot**, enforced by the type rather than by
an assertion: `run` and `unavailable` are the two arms of a union. That is what lets the ten
unbuilt screens be listed, marked and skipped by the arrow ring instead of dropped — answering
*Issues* with "no matches" would claim there is no such screen, when the truth is that it is
not built yet (§ 3.5). Matching is a **fuzzy subsequence** ([`command.ts`](app/shell/command.ts)):
`gtd` reaches *Go to Dashboard*, contiguous runs and word starts score, gaps cost, and a label
match always outranks a keyword one.

It is a **combobox**, not a menu: focus stays in the text box and the highlighted row is named
by `aria-activedescendant` rather than focused, which is what leaves every other key — Home and
End included — to the query. Everything a dialog owes the keyboard is
[`overlay.tsx`](app/shell/overlay.tsx)'s; the one thing the palette asks it for is
`initialFocus`, because React runs a child's effects before its parent's and a box that focused
itself would be recorded as the element Escape has to give focus back to.

### The account menu

[`app/shell/user-menu.tsx`](app/shell/user-menu.tsx) is the one surface in this module that
reads the session **client-side** ([#721](https://github.com/NobuData/ouroboros/issues/721)).
It is a Client Component because it is a menu, and once it was one anyway the hook is the
honest source: a layout does not re-render on a client-side navigation between siblings, and
awaiting a session there would hold up the shell a route's `loading.tsx` is drawn inside.

```
[ (avatar) ▾ ]
     ├─ Ken Suenobu · ken@acme-robotics.dev · owner
     ├─ Font size  [A−] ▪▪▪▫▫ [A+]           ← live, persisted per account (#649)
     ├─ Theme      ○ Light ○ Dark ● System   ← radios over the #17 engine
     ├─ Switch workspace  acme-robotics  ▸ ─┬─ ● acme-robotics
     │                                      ├─ ○ acme-labs
     │                                      └─ ○ kensuenobu
     ├─ Workspace settings                  (#491)
     ├─ Keyboard shortcuts ─▶ sheet over the pane (ShellOverlay)
     └─ Sign out ─▶ session row deleted ─▶ /login
```

**The two controls hold no state of their own** (CP.3,
[#645](https://github.com/NobuData/ouroboros/issues/645)). The stepper reads
`useFontScale()` and writes `setFontScale` — [the font scale](#the-font-scale)'s store —
then persists through the `saveFontScale` Server Action, quietly; the theme radios read
`useTheme()` and call `setTheme`, so engine, persistence and boot are all
[the theming machinery](#theming)'s. The role beside the address is
`organization.getActiveMemberRole`, collapsed by `primaryRole()` and shown only once known —
no guessed word while the fetch is out (§ 3.5). The shortcuts sheet
([`app/shell/shortcuts-sheet.tsx`](app/shell/shortcuts-sheet.tsx)) rides `ShellOverlay` and
lists only bindings that exist; a new binding adds its row in the change that wires it.

**The two writes go opposite ways, and which side of the wire can write the cookie is why.**
Switching workspace is `organization.setActive` called from the browser — that is the call
whose answer carries BetterAuth's refreshed `session_data` cookie *to* the browser, and it is
what invalidates the plugin's own session and listing stores, so the menu redraws itself.
`router.refresh()` then re-renders the route's Server Components against the workspace the
session now names, with no navigation. Signing out is a Server Action, because script cannot
delete an `HttpOnly` cookie and `ouro_tenant` is this application's own.

**It reads the plugin's listing, not `GET /api/v1/orgs`.** `useListOrganizations()` answers
*which workspace am I in and what may I move to*; the contract's row model answers *what is in
each of them* — roles, counts, the monogram — which is [step 2's card](#sign-in--tenancy).
Neither is a fallback for the other, and
[`app/api/auth-client.ts`](app/api/auth-client.ts) states the split.

**A chooser with one option is drawn as a statement.** When there is no workspace the session
is not already in, the row states the name and holds no control — the design system's honesty
rule (§ 3.5), and the same call step 2 makes when it replaces a radio group of one with a
hidden field. What the menu decides is
[`app/shell/account.ts`](app/shell/account.ts), which is pure, so each outcome — pending,
signed out, signed in, nowhere to switch — is a case rather than a query selector.

## UI primitives

Every screen in this module is built from one set of components
([#46](https://github.com/NobuData/ouroboros/issues/46)), in [`app/ui/`](app/ui). They are
[`../docs/mockups/assets/ouroboros.css`](../docs/mockups/assets/ouroboros.css) — the design
system the twenty-two mockups were drawn against — expressed in the
[design tokens](#design-tokens), so the product has one definition of a button rather than
one per screen.

```tsx
import { Button, Card, CardHead, Chip, EmptyState } from "@/app/ui";
```

| Primitive | What it is | The mockups' class |
|---|---|---|
| `Button` | The one button: `default` · `primary` · `ghost` · `danger`, in three sizes. Renders `<a>` when it navigates | `.btn` |
| `Card` / `CardHead` | The raised plane a panel is drawn on, on three surfaces, and the head that names one | `.card` / `.card-head` |
| `Chip` / `EffortChip` | A small marker carrying a state in its hue, optionally with a dot; and the square XS–XL estimate | `.pill` / `.effort` |
| `Tag` / `Badge` | Metadata with no state; and a count attached to something else | `.tag` / `.nav-badge` |
| `Table` | Columns and rows, inside their own horizontal scroll container — which is also the containing block for anything positioned inside it, so visually hidden text in a far column cannot widen the page ([#257](https://github.com/NobuData/ouroboros/issues/257)); rows selectable one at a time, or checkable any number at a time | `.tbl` |
| `Meter` | A proportion drawn as a bar — a stage, a rate, a budget, a live CPU figure. Over live data the fill eases to its new width rather than jumping, inside the reduced-motion guard ([#257](https://github.com/NobuData/ouroboros/issues/257)) | `.meter` |
| `StatCard` | A caption, a figure and a line about the figure, in a card — with an optional quieter suffix on the figure (`4/5`) and a slot for a meter. The dashboard's composition ([#81](https://github.com/NobuData/ouroboros/issues/81)) until the build farm drew the same row ([#256](https://github.com/NobuData/ouroboros/issues/256)) | `.stat` |
| `TextField` / `SelectField` / `Toggle` | A labelled field, a native select, and a switch | `.field` / `.input` / `.switch` |
| `EmptyState` | A surface that is not ready, labelled rather than blank | — |
| `SchemaFields` / `SchemaField` | A column of fields drawn from a list the renderer did not write — the schema-driven form (#231, shared with #150) | — |
| `Eyebrow` | The caption above a title | `.eyebrow` |

Six decisions in the set are worth knowing before adding to it.

**Plain CSS, not CSS Modules or vanilla-extract.** The issue left the choice open and this is
where it was made. The module already had token-driven global sheets, one naming convention
inside them, and one test walking every `.css` file under `app/` for a colour literal; a
fourth sheet in that shape keeps all of it true. Hashed class names would make the design
system unreadable in devtools and unassertable from the sheet tests this module relies on,
and vanilla-extract adds a build plugin for a set of primitives that computes no style at
all. Every class is prefixed `ou-`, which is the whole of the scoping story: a page **places**
a primitive by passing its own class (`className`), and never by restyling `.ou-*` from its
own sheet. Both screens' suites assert that neither has.

**A control that cannot act takes a `reason`, not a boolean.** The design system
([§ 3.5](../docs/DESIGN_SYSTEM_APP_SHELL.md)) asks that such a control be labelled rather
than dropped or left dead, so there is no way to switch a button off here without saying
what is missing. It sets `aria-disabled` rather than `disabled` — a disabled button leaves
the tab order and takes its explanation with it — and it drops `onClick`, so an inert
control cannot fire a handler whatever the caller passed.

**A badge never renders a zero**, and an empty state is not a count of nothing. "No loops
have run" is a claim about a loop engine; "nothing here can tell you yet" is the truth, and
only the second is what an empty state says.

**Hue is never the only signal.** Every chip carries its state in words, and where two sit
side by side the dot's *shape* differs — filled for a state that was reported, a ring for one
nobody could. Each tone is one of the token sheet's published triples (ink, a 35% border, a
10–12% fill), so no hue is invented at a call site and every pair's contrast is measured.

**An empty state recedes by surface, never by opacity.** Every contrast pair
[`../docs/DESIGN_TOKENS.md`](../docs/DESIGN_TOKENS.md) publishes is measured against a
surface, and a translucent layer is not one of them — so a panel carrying sentences somebody
is meant to read cannot be dimmed. The same rule is why the login screen's step 2 recedes
onto the well before sign-in instead of taking the mockup's `opacity: 0.66`.

**A number a component cannot know is passed as a custom property, not as a style.** `Meter`
is the case: its height, radius, track and fill are the sheet's, and only *how full it is*
comes from data — so that one value arrives as `--ou-meter-fill` and the sheet still owns the
`width` declaration. It is the only inline style on the dashboard, and the screen's suite
asserts that it is the only one there.

**A primitive names no domain concept.** That is the line between this directory and a
screen's own components: there is no `<WorkspaceCard>` here and there should not be. The
login screen's workspace rows and the dashboard's system list are compositions built *from*
these, in their own directories, with their own sheets. **A composition becomes a primitive when
a second screen draws it** — which is how `StatCard` got here: it names no domain concept, and
the build farm ([#256](https://github.com/NobuData/ouroboros/issues/256)) needed the dashboard's
tile exactly.

### What the tests can prove

Each primitive has a render test in both palettes, and
[`__tests__/helpers/palettes.tsx`](__tests__/helpers/palettes.tsx) is careful about what that
means. jsdom applies no stylesheet — Vitest resolves a CSS import to nothing — so no test
here can read a computed colour, and one that appeared to would be reading the same default
under both themes and passing for the wrong reason. What the tests *do* prove is the
property that belongs to a component rather than to a palette: a primitive expresses the
theme entirely in CSS, rendering byte-identical markup under `data-theme="light"` and
`data-theme="dark"`. A component that branched on the theme in JavaScript would be one the
boot script could not paint before hydration. Whether the dark palette itself is correct is
[`verify-tokens.sh`](../scripts/verify-tokens.sh)'s question, and it answers it from the
token sheet where the values are.

[`__tests__/ui/ui-styles.test.ts`](__tests__/ui/ui-styles.test.ts) holds the sheet and the
components together in both directions: every class a primitive renders has a rule, and
every rule is rendered by something — a rule nobody renders is a rule nobody keeps correct.

### What is still to come

The shell's own primitives — ShellHeader, SidebarNav, ContentPane, StickyBar, PageSubnav —
join this set with CP.1/CP.2/CP.4
([#646](https://github.com/NobuData/ouroboros/issues/646)), and the isolated playground with
theme switching is the component workshop
([#48](https://github.com/NobuData/ouroboros/issues/48)). `PageSubnav` gained **`SubnavSoon`**
with [#200](https://github.com/NobuData/ouroboros/issues/200) — the tab whose surface is not
built yet, drawn the way the sidebar draws an unbuilt row, because mockups 06, 07, 17 and 21 all
have tabs pointing at surfaces other roadmaps own and four hand-rolled versions of that treatment
is the drift the primitive was extracted to stop. Chart primitives are their own
issue ([#442](https://github.com/NobuData/ouroboros/issues/442)) and build on these.

## Design tokens

The palettes already exist. [`../docs/design/tokens.css`](../docs/design/tokens.css) is the
light and dark palettes, the type, spacing and shape scales, and nothing else
([#16](https://github.com/NobuData/ouroboros/issues/16));
[`../docs/DESIGN_TOKENS.md`](../docs/DESIGN_TOKENS.md) documents every token and publishes
the measured WCAG contrast for both palettes.

Three things the module owes it:

1. **Copy, do not fork.** `app/tokens.css` is a byte-identical copy of
   `docs/design/tokens.css`, imported first from `globals.css`. A change to the palette is
   made at the source, where `scripts/verify-tokens.sh` and the contrast tables can see
   it, and copied down — that script holds the two files identical, so a fork fails a
   check rather than surviving as a second palette nobody measured. **Done**
   ([#40](https://github.com/NobuData/ouroboros/issues/40)).
2. **Point `next/font` at the family tokens.** The three faces load through `next/font`,
   each under its own `--font-*` variable, and `globals.css` maps them onto `--f-disp`,
   `--f-ui` and `--f-mono` — the only tokens the application overrides, and the reason no
   component names a font. Mapping in the stylesheet rather than naming the token in
   `layout.tsx` is deliberate: both would target `<html>` with equal specificity, so
   writing the same name twice would leave the winner to stylesheet order. **Done.**
3. **Stamp `data-theme` before first paint.** Nothing on `<html>` means *system*, and the
   sheet's `prefers-color-scheme` block decides. **Done**
   ([#17](https://github.com/NobuData/ouroboros/issues/17)) — see [Theming](#theming).

`app/tokens.css` is the only file in this module that may write a colour down.
`__tests__/styles.test.ts` fails `ci/ui` if a literal appears in any other stylesheet,
which is what makes the sentence above a rule rather than an intention.

Every colour in this module is a `var(--token)`. There is no second place a colour may come
from, which is what makes the theme switch a redefinition rather than a restyle.

## Theming

Three states — `light`, `dark`, `system` — and *system* is the default. The engine is
[`app/theme.ts`](app/theme.ts) (vocabulary, the two DOM operations, and the boot script)
plus [`app/theme-provider.tsx`](app/theme-provider.tsx) (`ThemeProvider`, `useTheme()`).
The visible control is the [account menu](#the-account-menu)'s radio group — three
`menuitemradio`s over `setTheme`, where CP.3
([#645](https://github.com/NobuData/ouroboros/issues/645)) folded the header's cycling
toggle ([#42](https://github.com/NobuData/ouroboros/issues/42)); this is what it calls.

```tsx
"use client";
import { useTheme } from "@/app/theme-provider";

const { theme, resolved, setTheme } = useTheme();
// theme    → "light" | "dark" | "system"   — what the user chose
// resolved → "light" | "dark"              — what is actually rendering
// setTheme → applies, persists, re-renders
```

Five things make it work, and each is a decision worth knowing before changing any of it.

**Absence is `system`.** `data-theme` on `<html>` is `"light"`, `"dark"`, or **not
there** — the contract
[`../docs/DESIGN_TOKENS.md`](../docs/DESIGN_TOKENS.md#the-contract-for-17) sets out. So
while the choice is *system* the attribute is removed, the sheet's
`prefers-color-scheme` block applies, and the OS is tracked **by CSS, with no JavaScript
running at all**. The provider does listen to `matchMedia`, but only to keep `resolved`
truthful for a control that has to draw a sun or a moon — never to stamp. `system` is
likewise stored as the *absence* of the `ouro-theme` key, so there is exactly one
representation of it in storage and one on the element.

**The boot script is inline, in `<head>`, and generated.** It runs while the browser
parses the HTML — before the first paint, before React exists — because on a slow
connection the browser paints the server's HTML long before hydration. It is built from
the same constants the module reads, so the key and the attribute cannot drift; it never
consults the OS, never writes, and cannot throw. Not `next/script`:
`beforeInteractive` is preloaded rather than parser-blocking and its own documentation
says it does not block hydration, which is weaker than this needs.

**React's initial state matches the server, not storage.** A lazy initialiser reading
`localStorage` would make the first client render disagree with the server's HTML — a
hydration mismatch in every consumer. Instead the state starts where the server left it
and a layout effect corrects it after hydration but *before paint*, so no consumer needs
`suppressHydrationWarning` and nothing visible was ever wrong: the colours came from the
boot script. That effect also re-stamps the attribute, which repairs the one in
development that React's Strict Mode drops when it remounts and resets `<html>` to the
attributes it renders from JSX.

**`color-scheme` is not set here.** The sheet declares it in all three palette blocks, so
native scrollbars, form controls and the browser's own canvas follow the theme for the
same reason the palette does. There is no second place a theme is expressed.

**The swap is a cross-fade, and it is armed rather than standing.** A redefinition of
every colour at once lands between two paints, so `setTheme` puts a second attribute —
`data-theme-fade` — on `<html>` for the length of one change, and `globals.css` transitions
the colour properties only while it is there. Standing, that transition would also slow the
things colour is used to *report*: a status turning red, a stage going live. Three
consequences follow. The duration lives in two places by necessity (CSS runs the fade, only
JavaScript can end it) and `__tests__/styles.test.ts` fails the build if they drift. The
rule reaches descendants only — `<html>`'s own colour is the system `CanvasText` that
`color-scheme` flips, and while an ancestor transitions an inherited property Chrome
restarts that property's transition on every descendant, which lands all the product's text
about twice as late as the surface behind it. And `prefers-reduced-motion: reduce` gets the
instant swap that was here before, decided in the stylesheet, because the engine does not
ask the OS anything.

An OS flip while the choice is *system* arms the fade too, but only best-effort: CSS
repaints that one on its own, so whether it fades depends on the change reaching the
listener before the frame that paints it. Losing that race costs nothing — the swap is
simply instant.

### The control

Three radios in the [account menu](#the-account-menu) — Light, Dark, System — holding no
state of their own: each press calls `setTheme`, and everything above is what happens
next. It replaced the header's one-button cycle when CP.3
([#645](https://github.com/NobuData/ouroboros/issues/645)) folded the control into the
menu: a menu row has room for the three states the cycle had to fold into one icon, and
`aria-checked` says which is chosen where the old toggle needed a marker dot and a
tooltip. The *System* radio's title still resolves what the choice renders as
(`describeTheme` in [`app/theme.ts`](app/theme.ts)), because "system" alone does not say
which palette is on the screen.

**A screen reader hears about presses only.** The announcement goes through the menu's
own `role="status"` region, written by the click handler rather than derived from
`theme`. Derived, it would also speak the correction the provider makes to its own state
just after mount, so every page load would announce a change nobody made. The region is
mounted empty from the start, because a live region added at the same moment as its text
is not reliably read at all.

## The font scale

The five-step font-size preference of
[`../docs/DESIGN_SYSTEM_APP_SHELL.md`](../docs/DESIGN_SYSTEM_APP_SHELL.md) § 4
([#649](https://github.com/NobuData/ouroboros/issues/649)): **87.5 · 100 · 112.5 · 125 ·
150 %** of the browser's base size, applied as `data-font-scale` on `<html>` and turned
into a root `font-size` by five rules in [`app/globals.css`](app/globals.css). Every
length in the product is rem (lint-enforced, #648), so that one attribute rescales every
surface — and percentages compose with browser zoom rather than fighting it.

The engine is [`app/font-scale.ts`](app/font-scale.ts) — the third instance of the
theme's no-flash pattern, and the first whose **truth is the account rather than the
browser**: `GET`/`PATCH /api/v1/me/preferences` owns the value, `localStorage` is only
the mirror that makes the first paint instant, and
[`app/shell/font-scale-sync.tsx`](app/shell/font-scale-sync.tsx) reconciles the two when
the session loads (server wins — it is the cross-device truth). Writes hop through the
Server Actions in [`app/shell/preference-actions.ts`](app/shell/preference-actions.ts),
because the browser cannot reach REST. The boot script sits in the root layout beside
the theme's, which is what makes `/login` honour the mirror with no session at all.

Controls subscribe through `useFontScale()`
([`app/use-font-scale.ts`](app/use-font-scale.ts)); the profile-menu stepper is CP.3
([#645](https://github.com/NobuData/ouroboros/issues/645)) and the Settings → Appearance
row is [#492](https://github.com/NobuData/ouroboros/issues/492) — two surfaces over this
one store, which is the whole of how they stay in sync.

## Favicons and the web-app manifest

[`public/`](public) already holds the browser and home-screen icon set, generated from
the brand icon pair by [`../scripts/build-favicons.py`](../scripts/build-favicons.py)
([#15](https://github.com/NobuData/ouroboros/issues/15)). It landed ahead of the scaffold
because none of it is application code — the files are static, and two of them work with
no wiring at all.

| File | Size | Transparent | For |
|---|---|---|---|
| [`public/favicon.ico`](public/favicon.ico) | 16, 32, 48 | no | The tab, the address bar, the desktop shortcut. Served at `/favicon.ico`, which every browser probes on its own |
| [`public/favicon-32-light.png`](public/favicon-32-light.png) | 32×32 | yes | The tab under light browser chrome |
| [`public/favicon-32-dark.png`](public/favicon-32-dark.png) | 32×32 | yes | The tab under dark browser chrome |
| [`public/apple-touch-icon.png`](public/apple-touch-icon.png) | 180×180 | no | The iOS home screen. Served at `/apple-touch-icon.png`, which iOS Safari probes on its own |
| [`public/icon-192.png`](public/icon-192.png) | 192×192 | no | Manifest icon — Android home screen, task switcher |
| [`public/icon-512.png`](public/icon-512.png) | 512×512 | no | Manifest icon — splash screen, install prompt |
| [`public/manifest.webmanifest`](public/manifest.webmanifest) | — | — | App name, scheme colours and the two icons above |

Why two kinds. A browser tab is a surface whose colour the page does not own, so the tab
icons are a transparent pair and the browser picks one by `prefers-color-scheme` — the
rule [`../docs/BRAND.md`](../docs/BRAND.md) sets out, that the treatment follows the
surface it sits on. A home screen is an unknown background, which the same document
answers by putting the mark on a brand-coloured panel first, so every icon a launcher
draws is flattened onto the dark ground `#12181d` and carries no alpha channel at all.

### What is still to wire

`favicon.ico` and `apple-touch-icon.png` resolve by convention, but the theme-aware pair
and the manifest need `<link>` tags, which means the Metadata API. The scaffold is in
place; adding this to `app/layout.tsx` is what closes
[#15](https://github.com/NobuData/ouroboros/issues/15):

```ts
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  icons: {
    icon: [
      {
        url: "/favicon-32-light.png",
        type: "image/png",
        sizes: "32x32",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/favicon-32-dark.png",
        type: "image/png",
        sizes: "32x32",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  manifest: "/manifest.webmanifest",
};

// themeColor is a viewport export in Next 14+, not a metadata field. The manifest
// carries one colour because the format has one; the per-scheme pair lives here.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#12181d" },
  ],
};
```

Two things to leave alone. Do not add `app/favicon.ico` or `app/icon.*`: those are
Next's own file conventions and they would emit a second, competing set of `<link>` tags
alongside the ones above. And do not hand-edit anything in `public/` — regenerate:

```bash
uv run --with Pillow scripts/build-favicons.py           # rewrite ouroboros-ui/public/
uv run --with Pillow scripts/build-favicons.py --check   # still match the brand icons?
scripts/verify-favicons.sh                               # files ↔ manifest ↔ this document
```

## Related issues

Scaffold [#39](https://github.com/NobuData/ouroboros/issues/39) ·
favicons [#15](https://github.com/NobuData/ouroboros/issues/15) ·
UI primitives [#46](https://github.com/NobuData/ouroboros/issues/46) ·
design tokens [#16](https://github.com/NobuData/ouroboros/issues/16) ·
theme engine [#17](https://github.com/NobuData/ouroboros/issues/17) ·
theme toggle [#42](https://github.com/NobuData/ouroboros/issues/42) ·
app shell [#41](https://github.com/NobuData/ouroboros/issues/41) ·
⌘K navigation palette [#79](https://github.com/NobuData/ouroboros/issues/79) ·
typed API client [#43](https://github.com/NobuData/ouroboros/issues/43) ·
BetterAuth client & session store [#716](https://github.com/NobuData/ouroboros/issues/716) ·
route guards & session-aware redirects [#720](https://github.com/NobuData/ouroboros/issues/720) ·
sign-in & tenancy [#44](https://github.com/NobuData/ouroboros/issues/44) ·
dashboard [#45](https://github.com/NobuData/ouroboros/issues/45) ·
issue intake [#115](https://github.com/NobuData/ouroboros/issues/115) ·
the selection action bar [#118](https://github.com/NobuData/ouroboros/issues/118) ·
model routing [#200](https://github.com/NobuData/ouroboros/issues/200) ·
providers & keys [#227](https://github.com/NobuData/ouroboros/issues/227) ·
provider cards [#228](https://github.com/NobuData/ouroboros/issues/228) ·
the add-provider flow [#231](https://github.com/NobuData/ouroboros/issues/231) ·
caps, the strip and the states [#232](https://github.com/NobuData/ouroboros/issues/232) ·
the credential audit trail [#225](https://github.com/NobuData/ouroboros/issues/225) ·
ticket sources [#141](https://github.com/NobuData/ouroboros/issues/141) ·
planning [#283](https://github.com/NobuData/ouroboros/issues/283) ·
build farm [#256](https://github.com/NobuData/ouroboros/issues/256) ·
the runners table [#257](https://github.com/NobuData/ouroboros/issues/257) ·
workflow studio [#147](https://github.com/NobuData/ouroboros/issues/147) ·
the React Flow canvas [#148](https://github.com/NobuData/ouroboros/issues/148) ·
full epic [#5](https://github.com/NobuData/ouroboros/issues/5).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
