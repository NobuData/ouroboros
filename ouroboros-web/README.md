# ouroboros.build — branding site

The marketing site for **Ouroboros** (tagline: *Infinity in Autonomy*), built with
Next.js (App Router, TypeScript) and managed with **Yarn**. Deployed at
[https://ouroboros.build](https://ouroboros.build).

## Develop

```bash
yarn install   # node-modules linker (see .yarnrc.yml)
yarn dev       # http://localhost:3000
```

## Build & run

```bash
yarn build
yarn start
```

## Design

The site shares the product's design system (see `../docs/mockups/assets/ouroboros.css`):

- **Committed dark identity** — charcoal grounds, electric-cyan accent, glow reserved
  for live/primary elements. Tokens are ported into `app/globals.css`.
- **Type** — Chakra Petch (display), IBM Plex Sans (UI), IBM Plex Mono (labels/data),
  loaded via `next/font` (self-hosted at build time, zero layout shift).
- **Imagery** — the brand snake (`public/logo-mark.png`, `public/logo-lockup.png`) and
  real product screenshots from the mockup set (`public/shots/`), framed as app windows.
- **Signature moment** — the loop ring on `#loop`: the eight-stage cycle arranged as a
  circle with the dashed fail-edge returning to CODE. The ouroboros, literally.
- **Motion** — entrance rises on the hero, a stage-name marquee, and scroll-driven
  reveals via CSS `animation-timeline: view()` (progressive enhancement); everything
  respects `prefers-reduced-motion`.

## Structure

- `app/layout.tsx` — fonts, metadata (`metadataBase: https://ouroboros.build`), OG tags
- `app/page.tsx` — the single-page landing: hero → loop → dashboard shot → nine-feature
  bento (each tile links to its section) → six deep dives (`#studio`, `#models`,
  `#farm`, `#verify`, `#analyzer`, `#chatops`) → instruments trio (`#more`) →
  enterprise (`#enterprise`) → CTA (`#cta`) → footer
- `app/globals.css` — the full design system + page styles
- `app/icon.png` — favicon generated from the brand mark
