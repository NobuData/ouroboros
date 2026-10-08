// Values the site config reads and the tests assert. They live here rather than as named
// exports of docusaurus.config.ts because Docusaurus rejects any export of that file it
// does not recognise as a config field.

/**
 * The public address the site is built for. Docusaurus needs it at build time for canonical
 * links, the sitemap and (from CY.4) the search index. `DOCS_SITE_URL` exists only so a
 * local or preview build can point somewhere else (roadmap decision D10).
 */
export const DEFAULT_SITE_URL = "https://docs.ouroboros.build";

/** The footer copyright, exactly as roadmap decision D3 states it. */
export const COPYRIGHT = "Copyright © 2025-2026 NobuData LLC";

/** The repository the site's sources live in — the navbar and footer GitHub links. */
export const REPO_URL = "https://github.com/NobuData/ouroboros";

/**
 * Where a page's "Edit this page" link points. Docusaurus appends the page's path relative
 * to the site (`docs/user-guide/…`), so this ends at the module directory.
 */
export const EDIT_URL = `${REPO_URL}/edit/main/ouroboros-docs/`;

/** The product's marketing site, linked from the footer's "More" column. */
export const MARKETING_URL = "https://ouroboros.build";

/**
 * The brand files the config and pages reference, relative to `static/` (each is a synced copy —
 * see `scripts/sync-brand.mjs`). The navbar logo is the icon pair; the favicons are the set
 * `scripts/build-favicons.py` derives for ouroboros-ui.
 */
export const BRAND_ASSETS = {
  logoLight: "img/brand/icon-light.png",
  logoDark: "img/brand/icon-dark.png",
  lockupLight: "img/brand/lockup-tagline-light.png",
  lockupDark: "img/brand/lockup-tagline-dark.png",
  faviconIco: "img/brand/favicon/favicon.ico",
  favicon32Light: "img/brand/favicon/favicon-32-light.png",
  favicon32Dark: "img/brand/favicon/favicon-32-dark.png",
  appleTouchIcon: "img/brand/favicon/apple-touch-icon.png",
} as const;

/** One of the site's three sections (roadmap decision D2). */
export interface Section {
  /** The sidebar's id in `sidebars.ts`, and the navbar item's `sidebarId`. */
  sidebarId: string;
  /** The folder under `docs/` holding the section's pages; also its route, `/<dir>`. */
  dir: string;
  /** The navbar label and the footer column title. */
  label: string;
  /** One sentence on who the section is for — the section's card on overview pages. */
  description: string;
}

/** The three sections, in navbar order: User Guide, Administration, CLI. */
export const SECTIONS: readonly Section[] = [
  {
    sidebarId: "userGuide",
    dir: "user-guide",
    label: "User Guide",
    description: "Use the app: issues, workflows, runs, pull requests and the inbox.",
  },
  {
    sidebarId: "administration",
    dir: "administration",
    label: "Administration",
    description: "Run and configure it: deployment, settings, members, sources and the farm.",
  },
  {
    sidebarId: "cli",
    dir: "cli",
    label: "CLI",
    description: "Command-line tools: the runner installer and agent, stack verbs, the REST API.",
  },
];

/**
 * The local plugin that reads the screenshot manifest at build time (`plugins/screenshots.ts`)
 * — the name `<Screenshot>` reads its global data under.
 */
export const SCREENSHOTS_PLUGIN = "ouroboros-screenshots";
