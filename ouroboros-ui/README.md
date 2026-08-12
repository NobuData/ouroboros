# ouroboros-ui

> **Status:** scaffolded ([#39](https://github.com/NobuData/ouroboros/issues/39), epic
> [#5](https://github.com/NobuData/ouroboros/issues/5)), rendering from the design tokens
> ([#40](https://github.com/NobuData/ouroboros/issues/40)), switching themes at runtime
> ([#17](https://github.com/NobuData/ouroboros/issues/17)) from a
> [visible control in the header](#theming)
> ([#42](https://github.com/NobuData/ouroboros/issues/42)), wrapped in the
> [app shell](#app-shell) ([#41](https://github.com/NobuData/ouroboros/issues/41)),
> holding a [typed API client](#the-api-client) generated from the REST contract
> ([#43](https://github.com/NobuData/ouroboros/issues/43)), and serving its
> [first real screen](#sign-in--tenancy) — sign-in and workspace selection
> ([#44](https://github.com/NobuData/ouroboros/issues/44)) —
> `yarn dev` runs, `ci/ui` is live, and it [ships as a container](#container)
> ([#47](https://github.com/NobuData/ouroboros/issues/47)). What renders *inside* the
> shell is still a placeholder: the dashboard
> ([#45](https://github.com/NobuData/ouroboros/issues/45)) is the screen that replaces
> it.

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
| API client | `openapi-typescript` (types) + `openapi-fetch` (calls), generated from `ouroboros-rest/openapi.json` — see [The API client](#the-api-client) |
| Styling | CSS custom properties (design tokens), no CSS-in-JS |
| Fonts | Chakra Petch (display), IBM Plex Sans (UI), IBM Plex Mono (data) via `next/font` |
| Tests | Vitest + Testing Library |
| Lint | ESLint flat config |
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

Copy the repo-root `.env.example` and never commit a populated `.env`.

[`app/env.ts`](app/env.ts) reads and validates `OURO_REST_URL` — absolute, `http`/`https`,
trailing slash trimmed — and throws naming the variable when it is not. It is a function
rather than a module constant on purpose: a constant would be evaluated while
`next build` prerenders, failing the build on a machine that has no reason to know the
address of a service it is not calling. [The API client](#the-api-client) is its caller,
and calls it lazily for the same reason.

Two pieces of per-browser state belong to this module rather than to configuration: the
[theme choice](#theming), in `localStorage` under `ouro-theme`, and the
[active workspace](#access--who-is-signed-in-and-where), in an `HttpOnly` `ouro_tenant`
cookie that [the login screen](#sign-in--tenancy) writes. The session cookie,
`ouro_session`, is `ouroboros-rest`'s — this module forwards it and never writes it.

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
│   ├── api/                 # the typed client for ouroboros-rest — server-side
│   │   ├── schema.d.ts      #   generated from the contract by `yarn api:sync`
│   │   ├── client.ts        #   the wrapper: cookie · X-Ouro-Tenant · ApiError
│   │   ├── errors.ts        #   ApiError, and the envelope it is parsed from
│   │   ├── tenant.ts        #   the active-workspace vocabulary
│   │   ├── membership.ts    #   what a person holds in a workspace — framework-free
│   │   ├── server.ts        #   api() / anonymousApi(), and the workspace store
│   │   ├── access.ts        #   the gate: currentAccess() / requireWorkspace()
│   │   ├── tenants.ts       #   tenants.list() / tenants.read()
│   │   ├── session.ts       #   session.read() — GET /auth/me
│   │   ├── orgs.ts          #   orgs.list() / orgs.setEnabled()
│   │   ├── repos.ts         #   repos.list() / repos.setEnabled()
│   │   └── enablement.ts    #   the two composed into what one screen reads
│   ├── shell/               # the app shell: header, sidebar, content pane
│   ├── login/               # the sign-in & tenancy screen's components
│   ├── (app)/               # signed-in screens — inside the shell
│   └── (auth)/              # signed-out screens — sign-in & tenancy #44
├── __tests__/          # Vitest suites, mirroring app/
├── scripts/            # api-sync.mjs — the generator behind `yarn api:sync`
├── public/             # brand assets, favicons
├── Dockerfile          # the production image — built from the *repo root*
├── Dockerfile.dockerignore   # …and the context that image is built from
├── eslint.config.mjs   # ESLint flat config
├── next.config.ts      # standalone output, traced from the repo root
└── vitest.config.mts   # + vitest.setup.ts
```

`(app)` and `(auth)` are **route groups**: the parentheses are organisational and
contribute nothing to the URL, so the dashboard is `/` and sign-in is `/login`. `(app)`
renders its screens inside the [app shell](#app-shell); `(auth)` is a pass-through, because
a full-bleed screen would only have to undo any frame added there — see
[Sign-in & tenancy](#sign-in--tenancy).

Tests live in `__tests__/` rather than beside the code they cover, so that no file under
`app/` can ever be mistaken for a route segment. `yarn test` runs them once and exits;
`yarn test:watch` is the interactive form.

## The API client

This module talks to `ouroboros-rest` and to nothing else, through a client **generated
from that service's contract** ([#43](https://github.com/NobuData/ouroboros/issues/43),
decision D4 — [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#51-ui--rest--the-public-contract)).
Nothing here is hand-written against the API: `ouroboros-rest/openapi.yaml` is the
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
| **Session** | the `ouro_session` cookie of the request being served, forwarded — and only that cookie |
| **Workspace** | `X-Ouro-Tenant`, from the active-workspace store |
| **Failure** | the contract's `{code, message, details}` envelope, parsed into a thrown `ApiError`; a `401` redirects to `/login` first |

So a call has two outcomes rather than three: it resolves with the body the contract
describes, or it rejects with an `ApiError` carrying the `code` to branch on. There is no
`{data, error}` to unpack at the call site.

**It runs on the server.** `OURO_REST_URL` carries no `NEXT_PUBLIC_` prefix and
`ouro_session` is `HttpOnly`, so a browser could neither address the service nor
authenticate to it; [`app/api/server.ts`](app/api/server.ts) imports `server-only`, which
turns a Client Component that reaches for it into a build error rather than a runtime one.
Screens therefore fetch in Server Components and pass data down, and a Client Component
that needs to *write* calls a Server Action. The same fact decides where the active
workspace lives: an `HttpOnly` `ouro_tenant` cookie, because the header is composed while a
Server Component renders and nothing there can read `localStorage`.
[The login screen](#sign-in--tenancy) writes it with `setActiveTenant()`, from a Server
Action.

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
itself once per render for every signed-out visitor.

## Access — who is signed in, and where

[`app/api/access.ts`](app/api/access.ts) is the **data-access layer**, and it is the one
place a screen asks what it is allowed to render. Two rules come out of it, and the rest of
the application inherits both.

**A session alone is not access.** Every operation in the contract except the five public
ones is scoped to a workspace, so *signed in* and *able to render the product* are different
states — the second needs a chosen workspace this person still belongs to. `requireWorkspace()`
returns both or redirects to [sign-in](#sign-in--tenancy); `currentAccess()` answers without
redirecting, for the screen that has to ask.

**The cookie is a claim, not a fact.** `ouro_tenant` is whatever the browser was last given,
so it is resolved against the memberships `GET /api/v1/auth/me` reports *in the same request*
([`app/api/membership.ts`](app/api/membership.ts)). A hand-edited cookie, one naming a
workspace somebody has been removed from, and one naming a suspended workspace all resolve to
*no choice* — and land on the login screen rather than on a screen of somebody else's data.

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
screen to prove the design system, the session and the API together. It renders **outside the
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
│   It plans, codes, builds…    │  Step 2 · acme-robotics │
│   You watch the loop turn.    │  AR acme-robotics   [◉] │
│                               │     helios-firmware [◉] │
│   SOC 2 · SSO/SAML · self-…   │  [ Enter mission ctrl → ]│
└───────────────────────────────┴─────────────────────────┘
        55% brand panel                45% two cards
```

**One route, five outcomes**, decided by [`app/login/view.ts`](app/login/view.ts) from three
values — the session, the resolved workspace, and a `?workspace=` slug — and nothing else.
Keeping the decision pure is what makes each outcome a unit test rather than a route to drive:

| The request | What it gets |
|---|---|
| no session | step 1 live, step 2 as the mockup's dimmed preview |
| signed in, no workspace chosen | step 2 is the workspace picker |
| signed in, `?workspace=` naming the chosen one | step 2 is the organisation & repository list |
| signed in, belonging to no live workspace | step 2 explains, and names the domain match if the contract supplied one |
| signed in and settled | redirect to the dashboard |

The `?workspace=` parameter is the only unobvious part, and it exists because two of the
issue's requirements pull against each other: an authenticated visitor "skips to the
dashboard", and choosing a workspace is *followed by* enabling organisations in it — a second
step on this same screen, reached when the choice has already been made. Without something in
the request to tell them apart, the state that renders the enablement list is the state that
redirects away from it. So choosing redirects to `/login?workspace=<slug>`, in the URL rather
than in hidden state: it survives a refresh, it can be linked, and it is visible. It is never
trusted — it is compared against a membership the service reported in the same request.

### What it writes, and why each write re-checks

Three Server Actions ([`app/login/actions.ts`](app/login/actions.ts)): choose the workspace,
turn an organisation on or off, turn a repository on or off. A Server Action is a POST endpoint
against the page that renders it, reachable by anyone who can send the same request, so
rendering a form only for an owner is not a check. Each action therefore takes from the form
only *the reference to what was pressed* — an organisation login, a repository name, the state
to move to — and re-derives the rest: who from the session cookie, which workspace from
`ouro_tenant` matched against the memberships, and which role from that membership. No form
here carries a tenant id, so a hand-made POST cannot name somebody else's workspace at all.

The switches are submit buttons in one-field forms rather than `useState` toggles, which is
why this screen has **no client component on it anywhere**: it works before hydration and
without JavaScript, and on the product's first screen over an unknown connection that is worth
more than an optimistic animation. Each form carries the state to move *to*, so a stale render
asks for something specific instead of inverting whatever the flag has become since.

### What it does not pretend

- **Enterprise SSO** has no endpoint to call — SAML and OIDC are v2 — so the mockup's field and
  button render *marked unavailable, saying why* (design system § 3.5) rather than being
  dropped. The button carries `aria-disabled` rather than `disabled`, so the explanation stays
  in the tab order.
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

## App shell

Every signed-in screen renders inside the shell
([#41](https://github.com/NobuData/ouroboros/issues/41)), specified in
[`../docs/DESIGN_SYSTEM_APP_SHELL.md`](../docs/DESIGN_SYSTEM_APP_SHELL.md) § 1 — which
supersedes the top-bar navigation the mockups were drawn with.

```
┌──────────────────────────────────────────────────┐
│ ◎ OUROBOROS            [Needs you —] [⚙] [KS ▾]  │  header — no nav links
├───────────────┬──────────────────────────────────┤
│ ▦ Dashboard   │                                  │
│ ◉ Issues soon │   {page}                       ░ │  ← the only scrollbar
│ …             │                                ░ │
│ ───────────   │                                  │
│ ▣ Needs You   │                                  │
│ ⚙ Settings    │                                  │
└───────────────┴──────────────────────────────────┘
```

Four things are worth knowing before adding a screen to it.

1. **The pane is the only scroll container.** `html` and `body` are locked in
   `globals.css`; [`app/shell/app-shell.tsx`](app/shell/app-shell.tsx) is a grid of
   exactly the viewport, and the content pane owns `overflow-y`. So a page never sets
   `position: fixed` to keep something visible, and wide content (tables, diffs,
   timelines) scrolls sideways **inside its own `overflow-x` wrapper** — one page without
   that wrapper is all it takes to start the pane scrolling sideways. A screen rendered
   *outside* the shell inherits the lock and owns its own scroll container.
2. **Navigation is data.** [`app/shell/nav.ts`](app/shell/nav.ts) is the list the sidebar
   renders and the rule that decides which entry a URL belongs to: `/` matches only `/`,
   and every other entry owns its route and everything under it, so `/models/routing`
   keeps **Models** highlighted. CP.2 ([#644](https://github.com/NobuData/ouroboros/issues/644))
   replaces the list with a registry modules write into; the shape of an entry is already
   the shape of a registration.
3. **An entry links only to a route that exists.** Ten of the eleven screens are unbuilt,
   so their rows render as labelled *soon* text — not links, not in the tab order, each
   naming the issue that will build it. Building one means flipping its `status` to
   `"live"` in the same pull request as the route.
4. **What is a slot, not an omission.** The header cluster holds the needs-you pill, the
   [theme toggle](#theming) ([#42](https://github.com/NobuData/ouroboros/issues/42)), the
   settings gear and the account menu. Of those the toggle is the only one that is
   finished; the tenant chip (#77), the search pill and ⌘K palette (#79), and the real
   needs-you count (#78) each have an issue. The account menu's interaction is built and
   its contents are placeholders until CP.3 (#645) fills them — the session behind them
   now exists ([#33](https://github.com/NobuData/ouroboros/issues/33)), and
   [`requireWorkspace()`](#access--who-is-signed-in-and-where) is where a page already
   holds the person and the workspace to pass in — including the profile menu's own theme
   control, which the design system § 1.1 puts there and which will drive this same
   `useTheme()`.

Responsive collapse below 1024px is CSS, not state: the sidebar becomes a 64px icon rail
and every name becomes its tooltip. The user-controlled collapse, its per-account
persistence, and the overlay drawer below 768px are CP.2.

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
The visible switcher is
[`app/shell/theme-toggle.tsx`](app/shell/theme-toggle.tsx)
([#42](https://github.com/NobuData/ouroboros/issues/42)), in the header cluster; this is
what it calls.

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

### The switcher

One button in the header cluster, cycling **light → dark → system** and holding no state
of its own: it reads `useTheme()` and calls `setTheme`, and everything above is what
happens next. Two decisions in it are worth knowing.

**The icon is the palette, not the preference.** A sun while light is rendering, a moon
while dark is — the *resolved* value, which is what the issue asks for and what makes the
control describe the product rather than a setting. Its cost is that *light* and *system
resolving to light* draw the same sun, so the button carries an accent dot while the
choice is *system* (`.theme-toggle--auto`). The accessible name and the tooltip carry the
same fact in words — `Theme: system (dark). Switch to light.` — and both name what the
next press does.

**A screen reader hears about presses only.** The announcement is a visually hidden
`role="status"` region beside the button, whose text is written by the click handler
rather than derived from `theme`. Derived, it would also speak the correction the
provider makes to its own state just after mount, so every page load would announce a
change nobody made. The region is mounted empty from the start, because a live region
added at the same moment as its text is not reliably read at all.

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
design tokens [#16](https://github.com/NobuData/ouroboros/issues/16) ·
theme engine [#17](https://github.com/NobuData/ouroboros/issues/17) ·
theme toggle [#42](https://github.com/NobuData/ouroboros/issues/42) ·
app shell [#41](https://github.com/NobuData/ouroboros/issues/41) ·
typed API client [#43](https://github.com/NobuData/ouroboros/issues/43) ·
sign-in & tenancy [#44](https://github.com/NobuData/ouroboros/issues/44) ·
full epic [#5](https://github.com/NobuData/ouroboros/issues/5).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
