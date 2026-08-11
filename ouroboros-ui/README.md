# ouroboros-ui

> **Status:** scaffolded ([#39](https://github.com/NobuData/ouroboros/issues/39), epic
> [#5](https://github.com/NobuData/ouroboros/issues/5)), rendering from the design tokens
> ([#40](https://github.com/NobuData/ouroboros/issues/40)), switching themes at runtime
> ([#17](https://github.com/NobuData/ouroboros/issues/17)) from a
> [visible control in the header](#theming)
> ([#42](https://github.com/NobuData/ouroboros/issues/42)), and wrapped in the
> [app shell](#app-shell) ([#41](https://github.com/NobuData/ouroboros/issues/41)) —
> `yarn dev` runs, `ci/ui` is live, and it [ships as a container](#container)
> ([#47](https://github.com/NobuData/ouroboros/issues/47)). What renders *inside* the
> shell is still a placeholder: the dashboard
> ([#45](https://github.com/NobuData/ouroboros/issues/45)) lands on top of it.

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
address of a service it is not calling. The typed API client
([#43](https://github.com/NobuData/ouroboros/issues/43)) is its first caller.

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
│   ├── shell/               # the app shell: header, sidebar, content pane
│   ├── (app)/               # signed-in screens — inside the shell
│   └── (auth)/              # signed-out screens — sign-in & tenancy #44
├── __tests__/          # Vitest suites, mirroring app/
├── public/             # brand assets, favicons
├── Dockerfile          # the production image — built from the *repo root*
├── Dockerfile.dockerignore   # …and the context that image is built from
├── eslint.config.mjs   # ESLint flat config
├── next.config.ts      # standalone output, traced from the repo root
└── vitest.config.mts   # + vitest.setup.ts
```

`(app)` and `(auth)` are **route groups**: the parentheses are organisational and
contribute nothing to the URL, so the dashboard is `/` rather than `/app`. `(app)` renders
its screens inside the [app shell](#app-shell); `(auth)` is still a pass-through, waiting
for the sign-in frame (#44).

Tests live in `__tests__/` rather than beside the code they cover, so that no file under
`app/` can ever be mistaken for a route segment. `yarn test` runs them once and exits;
`yarn test:watch` is the interactive form.

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
   its contents are placeholders until sessions
   ([#33](https://github.com/NobuData/ouroboros/issues/33)) and CP.3 (#645) fill them —
   including the profile menu's own theme control, which the design system § 1.1 puts
   there and which will drive this same `useTheme()`.

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
full epic [#5](https://github.com/NobuData/ouroboros/issues/5).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
