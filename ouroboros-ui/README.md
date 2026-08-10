# ouroboros-ui

> **Status:** scaffolded ([#39](https://github.com/NobuData/ouroboros/issues/39), epic
> [#5](https://github.com/NobuData/ouroboros/issues/5)), rendering from the design tokens
> ([#40](https://github.com/NobuData/ouroboros/issues/40)), and switching themes at
> runtime ([#17](https://github.com/NobuData/ouroboros/issues/17)) — `yarn dev` runs and
> `ci/ui` is live. What renders is still a placeholder: the visible theme switcher
> ([#42](https://github.com/NobuData/ouroboros/issues/42)) and the app shell
> ([#41](https://github.com/NobuData/ouroboros/issues/41)) land on top of it.

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
| Container | Multi-stage Dockerfile, Next.js standalone output ([#47](https://github.com/NobuData/ouroboros/issues/47)) |

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
│   ├── (app)/               # signed-in screens — shell #41 → dashboard #45
│   └── (auth)/              # signed-out screens — sign-in & tenancy #44
├── __tests__/          # Vitest suites, mirroring app/
├── public/             # brand assets, favicons
├── eslint.config.mjs   # ESLint flat config
├── next.config.ts
└── vitest.config.mts   # + vitest.setup.ts
```

`(app)` and `(auth)` are **route groups**: the parentheses are organisational and
contribute nothing to the URL, so the dashboard is `/` rather than `/app`. Both hold a
pass-through layout today — the chrome that belongs in them is #41 and #44.

Still to arrive: the `Dockerfile`
([#47](https://github.com/NobuData/ouroboros/issues/47)).

Tests live in `__tests__/` rather than beside the code they cover, so that no file under
`app/` can ever be mistaken for a route segment. `yarn test` runs them once and exits;
`yarn test:watch` is the interactive form.

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
The visible switcher is [#42](https://github.com/NobuData/ouroboros/issues/42); this is
what it will call.

```tsx
"use client";
import { useTheme } from "@/app/theme-provider";

const { theme, resolved, setTheme } = useTheme();
// theme    → "light" | "dark" | "system"   — what the user chose
// resolved → "light" | "dark"              — what is actually rendering
// setTheme → applies, persists, re-renders
```

Four things make it work, and each is a decision worth knowing before changing any of it.

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
full epic [#5](https://github.com/NobuData/ouroboros/issues/5).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
