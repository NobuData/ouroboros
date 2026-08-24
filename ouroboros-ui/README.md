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
> [model routing](#model-routing) ([#200](https://github.com/NobuData/ouroboros/issues/200)) —
> `yarn dev` runs, `ci/ui` is live, and it [ships as a container](#container)
> ([#47](https://github.com/NobuData/ouroboros/issues/47)). The scaffold's placeholder
> page is gone: `/` redirects to `/dashboard`, and every screen the sidebar names beyond
> those two is labelled *soon* rather than linked.

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
| Styling | CSS custom properties (design tokens) over plain global sheets — no CSS-in-JS, no component framework; the shared set is [`app/ui/`](#ui-primitives) |
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
│   ├── paths.ts             # the two routes this application redirects to
│   ├── browser.ts           # window and localStorage, read in the way that cannot throw
│   ├── media-query.ts       # useMediaQuery() — asking CSS a question from React
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
│   │   └── dashboard/route.ts   # GET /api/dashboard — the poll, on this origin
│   ├── ui/                  # the UI component primitives — the design system
│   │   ├── ui.css           #   one token-driven sheet, every class prefixed `ou-`
│   │   ├── button.tsx       #   Button — default · primary · ghost · danger
│   │   ├── card.tsx         #   Card + CardHead
│   │   ├── chip.tsx         #   Chip (status · model) + EffortChip
│   │   ├── badge.tsx        #   Tag (metadata) + Badge (a count)
│   │   ├── table.tsx        #   Table, inside its own scroll container
│   │   ├── field.tsx        #   TextField · SelectField · Toggle
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
`/models` and sign-in is `/login`.
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
twelve-column grid, and the compositions built on top — the stat tile, the system list and
the pulse card's captioned meters.

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
the same treatment the sidebar gives nine destinations, and the same reason: #49's own first
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

**Neither `All issues →` nor a `needs human` row navigates yet.** The issues screen is mockup
03 and the needs-you inbox is mockup 16; #49 holds both routes and is post-MVP. Each is an
inert button carrying what is missing, which is the treatment the sidebar already gives both
destinations — and #49's own first criterion, *no dead nav links*.

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

**Neither `Manage queue →` nor the footer navigates yet.** The queue screen is mockup 03 and
#49 holds its route, which is post-MVP; both are inert buttons carrying the one reason, which
keeps the explanation in the tab order, and both become an `href` the day #49 lands. Two
controls pointing at one missing screen carry one sentence rather than two, because two would
read as two missing screens.

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
  in a tooltip. Neither destination exists —
  [#49](https://github.com/NobuData/ouroboros/issues/49) holds their place and is post-MVP —
  and a control that appeared to pull an issue would be the one dishonest thing on the screen.
  It is the same treatment the sidebar gives `/issues` and `/workflows`; linking them to routes
  nobody has written would break #49's own first criterion, *no dead nav links*.
  `aria-disabled` rather than `disabled`, so the explanation keeps its place in the tab order.
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

## Model routing

`/models` ([#200](https://github.com/NobuData/ouroboros/issues/200)) is
[`docs/mockups/06-model-routing.html`](../docs/mockups/06-model-routing.html)'s **frame**: the
page head, the Models tab set, and the provider health strip. It renders **inside** the
[app shell](#app-shell) and is reached from the sidebar's **Models** entry, which stopped being
a *soon* row on the commit that built this — retiring the `/models` placeholder
[#49](https://github.com/NobuData/ouroboros/issues/49) held for it.

```
MODELS
Route every kind of work to the model that earns it.  [ Simulate routing ] [ Save routes ]
Each task kind resolves to a primary model with…        ↑ #203 not built    ↑ nothing staged
────────────────────────────────────────────────────────────────────────────────────────────
 Routing    Model registry soon   Providers & keys soon   Spend soon      ← sticky in the pane
 ▔▔▔▔▔▔▔ (the model purple)
(● Anthropic Claude 42ms) (● Cursor) (● GitHub Copilot error · elevated latency)
(● OpenAI-compatible · local vLLM  10.0.4.20 · vLLM local) (◌ Fresh connection unknown)
```

The matrix, the inspector, the rules card and the spend card are #201–#205; the space they will
fill carries an empty state naming them. A placeholder table of invented rows would be the one
dishonest thing on a page built to be honest — and indistinguishable, in a screenshot, from the
real one.

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
page is broken. `pending` is zero today because nothing here can change a route until
[#201](https://github.com/NobuData/ouroboros/issues/201) and
[#202](https://github.com/NobuData/ouroboros/issues/202) land — and when one of them supplies a
number, the control enables itself.

Both head actions are inert through `Button`'s `reason`, so each says what is missing rather than
sitting dead; the three sibling tabs are `SubnavSoon`, which does the same for a destination.

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

The loop itself is [`app/dashboard/summary-poll.ts`](app/dashboard/summary-poll.ts) and is
framework-free, so every clause of the contract is a unit test against mocked timers rather
than a rendered page: fifteen seconds while visible, **nothing at all** while hidden and an
immediate ask on return, the `ETag` echoed as `If-None-Match` and replaced by each answer,
and `X-Ouro-Poll-After` as the effective interval — which is how an operator raising
`OURO_DASHBOARD_POLL_SECONDS` slows every open dashboard within one poll cycle, with nothing
shipped to a browser. Requests never overlap: an ask that overtakes another wins, and the
overtaken answer is dropped on arrival rather than raced into the store.

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
│ ◉ Issues soon │   {page}                                       ░ │  ← the only
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
3. **An entry links only to a route that exists.** Ten of the eleven screens are unbuilt,
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
      │  ▸ Go to Issues       Issue intake · #115 │  ← and skip these
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
| `Table` | Columns and rows, inside their own horizontal scroll container | `.tbl` |
| `Meter` | A proportion drawn as a bar — a stage, a rate, a budget | `.meter` |
| `TextField` / `SelectField` / `Toggle` | A labelled field, a native select, and a switch | `.field` / `.input` / `.switch` |
| `EmptyState` | A surface that is not ready, labelled rather than blank | — |
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
login screen's workspace rows and the dashboard's stat tile are compositions built *from*
these, in their own directories, with their own sheets.

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
model routing [#200](https://github.com/NobuData/ouroboros/issues/200) ·
full epic [#5](https://github.com/NobuData/ouroboros/issues/5).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
