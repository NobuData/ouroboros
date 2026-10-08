# ouroboros-docs

## Purpose

The Ouroboros documentation site: guides for the people who **use**, **administer** and
**script** Ouroboros, published at [docs.ouroboros.build](https://docs.ouroboros.build).
It is written for users and operators; the engineering documents in [`../docs`](../docs)
stay where they are and are linked, not moved.

The site has three sections — **User Guide** (`/user-guide`), **Administration**
(`/administration`) and **CLI** (`/cli`) — each with its own sidebar and navbar item
([#1165](https://github.com/NobuData/ouroboros/issues/1165)). Every planned page exists,
most as a stub that its content issue fills in. The plan for everything else — brand,
search, screenshots, the container image and its publish workflow — is
[`ROADMAP_OUROBOROS_DOCUMENTATION_SITE.md`](../docs/ROADMAP_OUROBOROS_DOCUMENTATION_SITE.md).

**It is a module but not a workspace** ([`CONVENTIONS.md`](../docs/CONVENTIONS.md) § 1,
limit 6). Like `ouroboros-web` it keeps its own `package.json`, `yarn.lock` and
`.yarnrc.yml`, so the root `yarn install`, `yarn dev` and `yarn test` never touch it and
its React and Docusaurus resolution never enters the product's lockfile.

## Stack

| | |
|---|---|
| Site generator | [Docusaurus](https://docusaurus.io) **3.10.2**, classic preset, TypeScript config — every `@docusaurus/*` package pinned to that one patch |
| UI runtime | **React 19** — Docusaurus 3.10 supports React 18 and 19 (`^18 \|\| ^19` peer range), and 19 is what `ouroboros-ui` and `ouroboros-web` run |
| Language | TypeScript 5 |
| Package manager | Yarn 4.18.0 via corepack, `nodeLinker: node-modules`, own lockfile |
| Runtime | Node 24 |
| Checks | ESLint 9 + typescript-eslint, Prettier, Vitest |

## Run

```bash
# From the repository root — installs this module's own lockfile and starts the dev server:
yarn dev:docs                 # http://localhost:3100

# Or from this directory:
yarn install --immutable
yarn dev                      # docusaurus start --port 3100, live reload
yarn build                    # static site into build/; a broken link or anchor fails the build
yarn serve                    # serve build/ on http://localhost:3100
yarn clear                    # drop the .docusaurus/ cache and build/
yarn lint                     # ESLint
yarn typecheck                # tsc
yarn test                     # Vitest — the config and module contract
yarn format:check             # Prettier over the code and config (yarn format fixes);
                              # Markdown is content and keeps the repo's compact tables
yarn screenshots              # placeholder: fails until the capture harness lands (CZ.1)
```

Port **3100** is the docs site's alone: `ouroboros-ui` and `ouroboros-web` both use 3000
([`CONVENTIONS.md`](../docs/CONVENTIONS.md) § 4 port map), so the docs can run beside the
product stack.

## Configuration

| Variable | Default | Read by | Purpose |
|---|---|---|---|
| `DOCS_SITE_URL` | `https://docs.ouroboros.build` | `docusaurus.config.ts`, at build time | The site's public URL, for canonical links and the sitemap. Set it only for a local or preview build served somewhere else. |

`DOCS_SITE_URL` is not an `OURO_*` variable on purpose: nothing in the application reads
it, and it never reaches a running service — it is a build input of a static site.

## Layout

```
ouroboros-docs/
├── docs/
│   ├── index.md            # the home page, served at /
│   ├── user-guide/         # User Guide      → /user-guide      (sidebar userGuide)
│   ├── administration/     # Administration  → /administration  (sidebar administration)
│   └── cli/                # CLI             → /cli             (sidebar cli)
├── src/css/custom.css      # global styles (brand tokens arrive with CY.3)
├── static/                 # files copied verbatim into the build
├── scripts/                # module tooling (the screenshots placeholder)
├── tests/                  # Vitest — the config, sidebars, planned pages and module contract
├── docusaurus.config.ts    # the site config: one docs instance at /, navbar, footer, strict links
├── site.constants.ts       # site URL default, copyright line, repo/edit URLs, the three sections
├── sidebars.ts             # one sidebar per section, generated from its folder
├── eslint.config.mjs · .prettierrc.json · vitest.config.mts · tsconfig.json
└── package.json · yarn.lock · .yarnrc.yml · .gitignore · .dockerignore
```

Every page belongs to exactly one section; only the home page sits outside them. The
navbar lists the sections in the order User Guide, Administration, CLI, with a GitHub link
and the colour-mode toggle on the right (search joins with CY.4). The footer has a link
column per section, a "More" column (GitHub, ouroboros.build) and the copyright line
`Copyright © 2025-2026 NobuData LLC`, which a test holds exactly.

The finished shape — `docs/{user-guide,administration,cli}/`, `src/{components,pages,theme}/`,
`static/img/{brand,screenshots}/`, the `screenshots/` Playwright project and the
`Dockerfile` — is drawn in the roadmap's CY.1 entry; each piece arrives with its issue.

## Authoring

### Where a page goes

Ask what the reader is doing when they need the page:

| The reader… | Section | Folder |
|---|---|---|
| uses the product UI | User Guide | `docs/user-guide/` |
| operates or configures the deployment or a workspace | Administration | `docs/administration/` |
| types a command | CLI | `docs/cli/` |

A topic with more than one side gets a page in each, linking each other — for example,
minting a runner enrollment token is Administration (build farm); the `install.sh` it
feeds is CLI.

### Files and naming

- Pages are `.mdx` files named in lower-case kebab-case after their subject
  (`pull-requests.mdx`, `install-sh.mdx`). The file path is the URL:
  `docs/cli/runner/enroll.mdx` is served at `/cli/runner/enroll`.
- A group of pages is a folder with a `_category_.json` giving its sidebar `label` and
  `position`. Its landing page is either an `index.mdx` in the folder, a doc named by
  `"link": {"type": "doc", "id": "…"}`, or a generated list of the group's pages —
  `"link": {"type": "generated-index", "slug": "/<section>/<folder>"}`. Always give a
  generated index that slug; without it Docusaurus serves it at `/category/…`.
- A section's own overview is its `index.mdx`, served at the section's root.
- Sidebars are generated from the folders, so adding a page needs no edit to
  `sidebars.ts`.

### Front matter

| Field | Required | Purpose |
|---|---|---|
| `title` | yes | The page heading and browser title — the full name (`Members, invites, roles & API tokens`) |
| `sidebar_label` | yes | The short name in the sidebar (`Members & tokens`) |
| `sidebar_position` | yes | The page's place among its siblings, from 1 |
| `description` | yes | One sentence on what the page is for; used for search results and link previews |

### Page template

A new page starts as a stub — its title, one sentence on its purpose, and a "being
written" note naming the issue that writes it — and the content issue replaces the note:

```mdx
---
title: "Needs-you inbox"
sidebar_label: "Inbox"
sidebar_position: 12
description: "Answering the decisions blocked loops wait on."
---

Answering the decisions blocked loops wait on.

:::info Being written

This page is being written in
[#1185](https://github.com/NobuData/ouroboros/issues/1185).

:::
```

`tests/pages.test.ts` lists every planned page with its issue and checks it exists, has
all four front matter fields, and — while it is still a stub — links that issue.

### Links

- Link another page by its **relative file path**, with the extension:
  `[Policies](../administration/policies.mdx)`. Docusaurus resolves it at build time and the
  build fails if the file does not exist.
- Link a heading with the file path plus the anchor: `[tokens](./members-and-tokens.mdx#api-tokens)`;
  a missing anchor fails the build too.
- Link the product's own source or engineering docs with a full GitHub URL
  (`https://github.com/NobuData/ouroboros/blob/main/…`) — they are not part of the site.
- Every page's "Edit this page" link opens the file on GitHub's editor for `main`.

## Related issues

- [#1164](https://github.com/NobuData/ouroboros/issues/1164) — CY.1 scaffold (this module)
- [#1165](https://github.com/NobuData/ouroboros/issues/1165) — CY.2 three sections, navbar, footer & stub pages
- [#1166](https://github.com/NobuData/ouroboros/issues/1166) — CY.3 brand theme, light/dark & logos
- [#1170](https://github.com/NobuData/ouroboros/issues/1170) — CZ.1 screenshot capture harness
- [#1156](https://github.com/NobuData/ouroboros/issues/1156) — Epic CY · Docs Site Foundation
