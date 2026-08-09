# Ouroboros Design System — Application Shell & UI/UX Standards

Status: **authoritative** (adopted 2026-08-09). This document supersedes the
top-bar navigation shown in `docs/mockups/*.html` for every UI issue in every
roadmap. The mockups remain the design source of truth for **page content and
card anatomy**; the **shell chrome** (header, navigation, scrolling) is defined
here. The implementing issues live in
[`ROADMAP_UIUX_APP_SHELL.md`](ROADMAP_UIUX_APP_SHELL.md).

## 1. Shell layout

Standard SaaS three-region shell:

```
┌─────────────────────────────────────────────────────────────────────┐
│ HEADER (fixed)                                                      │
│ [◎ OUROBOROS] [acme-robotics / helios-firmware ▾]      [Search ⌘K] │
│                                  [● 3 loops live] [🔔] [⚙] [KS ▾]  │
├───────────────┬─────────────────────────────────────────────────────┤
│ SIDEBAR       │ CONTENT PANE                        ← sole scroll   │
│ (fixed)       │ ┌─────────────────────────────────┐   container     │
│ ▦ Dashboard   │ │ page head                       │                 │
│ ◉ Issues      │ │ subnav (sticky in-scroll)       │                 │
│ ⑂ Workflows   │ │ cards / tables / …              │ ░ scrollbar     │
│ ⬡ Models      │ │                                 │ ░               │
│ ⛭ Build Farm  │ │                                 │ ░               │
│ ▤ Knowledge   │ └─────────────────────────────────┘                 │
│ ▦ Planning    │                                                     │
│ ◎ Research    │                                                     │
│ ∿ Insights    │                                                     │
│ ───────────   │                                                     │
│ ▣ Needs You ③ │                                                     │
│ ⚙ Settings    │                                                     │
└───────────────┴─────────────────────────────────────────────────────┘
```

### 1.1 Header (fixed, 56px)

- **Upper-left:** application brand — logo mark + `OUROBOROS` wordmark
  (links to Dashboard). Immediately right of the brand: the tenant/org
  switcher chip (`acme-robotics / helios-firmware ▾`).
- **Upper-right**, in order: search pill (`⌘K`), live-loops pill,
  notifications affordance, and the **profile menu** — avatar button opening
  a menu with: account name/email, **Font size** quick control (§4), theme
  toggle (existing #17 engine), workspace settings link, sign out.
- The header contains **no navigation links** — navigation lives in the
  sidebar. The header never scrolls.

### 1.2 Sidebar navigation (fixed, left)

- Width 240px expanded; collapsible to a 64px **icon rail** (chevron control
  at the sidebar foot; state persisted per user). Below 1024px viewport width
  the rail is the default; below 768px the sidebar becomes an overlay drawer
  opened from a hamburger in the header.
- Every entry = **icon + name** (name hidden in rail mode, shown as tooltip),
  driven by a **module registry** (id, icon, label, route, sort, badge slot,
  required capability) — modules register themselves; the sidebar renders the
  registry. Primary group (top): **Dashboard, Issues, Workflows, Models,
  Build Farm, Knowledge, Planning, Research, Insights**. Secondary group
  (bottom, above the collapse control): **Needs You** (with live count
  badge), **Settings**.
- Icon set: **lucide** (ISC license, tree-shakable) unless the implementing
  issue records otherwise. Suggested mapping: Dashboard `gauge`, Issues
  `circle-dot`, Workflows `workflow`, Models `cpu`, Build Farm `server`,
  Knowledge `book-open`, Planning `calendar-range`, Research `telescope`,
  Insights `chart-line`, Needs You `inbox`, Settings `settings`.
- Active state: accent inset bar + tinted background (the mockups' active
  treatment translated to the rail); exact-route and section matching
  (`/models/*` keeps **Models** active). Full keyboard support (arrow
  navigation, Enter, focus ring) and `aria-current="page"`.
- Sections with sub-surfaces (Models: Routing / Registry / Providers / Spend;
  Workflows: Builder / Code / Copilot) keep their **subnav tabs at the top of
  the content pane** — the sidebar stays one level deep.

### 1.3 Content pane — the only scroll container

- `html`/`body` are locked (`height:100%; overflow:hidden`); the shell is a
  grid (`auto 1fr` rows × `auto 1fr` columns); **the content pane is the sole
  vertical scroll container** (`overflow-y:auto; scrollbar-gutter:stable`).
  The header and sidebar never move while content scrolls.
- Sticky in-page chrome (page subnavs, table headers, dirty-state bars)
  sticks **within the content scroll container** (`position:sticky` against
  it), never against the viewport.
- Wide content (tables, gantts, diffs, code) scrolls horizontally inside its
  own `overflow-x:auto` wrapper — the content pane itself never scrolls
  horizontally.
- Scroll position restored per route on back/forward; anchor deep-links
  scroll the pane, not the body.
- Full-viewport overlays (dialogs, sheets, command palette) portal outside
  the pane and lock its scroll while open.

## 2. Page frame inside the pane

Every module page keeps the mockups' content anatomy: page head (eyebrow, h1,
subline, actions), optional subnav, then the card grid. Max content width
1440px, centered, with the established gutter rhythm. The mockups' topbar
markup (`.topbar`, `.nav`) is **not** implemented per page — pages render
inside the shell and start at their page head.

## 3. Component & UX standards (applies to every roadmap UI issue)

1. **Tokens, both themes** — all color/spacing/type via the #16 token sheet;
   every surface verified light + dark (house rule, restated).
2. **rem-based type & spacing** — no hard-coded `px` font sizes in
   application CSS; type, line-height, and key spacing derive from `rem` so
   the font-size preference (§4) scales the entire UI. Lint-enforced.
3. **States** — every surface designs empty, loading (skeleton), error
   (banner + retry), and permission-limited (member read-only) states; no
   blank regions.
4. **Keyboard & a11y** — focus-visible rings, logical tab order, arrow-key
   navigation in menus/tables where the mockups imply it, `aria` labels on
   icon-only controls, WCAG AA contrast in both themes at every font scale.
5. **Honesty** — computed numbers or em-dash; disabled controls explain
   themselves (tooltip/why-line); "soon" surfaces are labeled, never dead.
6. **Density** — the mockups' dense information design is intentional; do
   not inflate paddings. (An explicit comfortable/compact mode is a v2
   option — CR.1.)

## 4. Font-size preference (readability on high-resolution monitors)

- A per-user **Font size** setting with five steps applied to the root
  element: **87.5% · 100% (default) · 112.5% · 125% · 150%** of the
  browser's base size (respects user-agent/browser zoom rather than fighting
  it). Because all type is rem-based (§3.2), one root change scales every
  surface, both themes, all pages.
- Surfaces: a quick control in the **profile menu** (stepper with live
  preview) and the full control in **Settings → Appearance** (alongside the
  theme choice; mockup-17 roadmap amended).
- Persistence: account preference (server-side, per user) mirrored to
  `localStorage` for **no-flash boot** application — the same pattern as the
  #17 runtime theme engine; anonymous/login screens honor the local mirror.
- QA bar: at 150% no clipped labels, no overlapping chrome, tables degrade
  to horizontal scroll in their wrappers; screenshot matrix (scale × theme ×
  key pages) in CI (CQ.3).

## 5. What this supersedes / amends

| Existing artifact | Disposition |
|---|---|
| Mockup `.topbar`/`.nav` chrome (all `docs/mockups/*.html`) | Superseded by §1 — mockups stay authoritative for page content only. |
| Scaffolding #41 (`App shell — top bar, navigation, footer`) | Re-scoped: header per §1.1, **sidebar** per §1.2, scroll containment per §1.3 (amendment recorded in the scaffolding roadmap + CP.1/CP.2). |
| #16 design tokens, #46 primitives | Amended: rem-based type scale (CQ.1); shell primitives (SidebarNav, ShellHeader, ContentPane, StickyBar) join #46. |
| #17 runtime theme engine | Pattern reused for font-scale boot application (CQ.2). |
| Every mockup roadmap's route/frame + e2e issues | Amended via each roadmap's **UI/UX Shell Compliance** section: mount in the content pane, register a sidebar entry (or declare contextual/pre-shell), sticky-in-scroll subnavs, shell + font-scale e2e assertions. |
| Mockup 17 (Settings) roadmap | Gains the Settings → Appearance font-size control (CQ.2 amendment). |
| Mockup 16 (Needs You) roadmap | Sidebar badge count wired to its inbox counts (CP.2 badge slot). |

Screens **outside the shell**: login/auth (mockup 01 / BetterAuth) and the
pre-workspace onboarding wizard (mockup 13) render standalone (no sidebar);
§3 standards and §4 font scaling still apply to them.
