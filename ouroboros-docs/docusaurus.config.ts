import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import type { FooterColumnItem } from "@docusaurus/theme-common";
import type { PluginOptions } from "@easyops-cn/docusaurus-search-local";

import {
  COPYRIGHT,
  BRAND_ASSETS,
  DEFAULT_SITE_URL,
  EDIT_URL,
  MARKETING_URL,
  REPO_URL,
  SECTIONS,
} from "./site.constants";
import screenshotsPlugin from "./plugins/screenshots";

// This runs in Node.js — no browser APIs or JSX here.

/**
 * The footer's link columns: one per section, then "More".
 *
 * Each section column links the section overview and its most-used pages. Every `to` is a
 * site route, so a renamed page fails the build instead of leaving a dead footer link.
 */
const FOOTER_LINKS: FooterColumnItem[] = [
  {
    title: "User Guide",
    items: [
      { label: "Overview", to: "/user-guide" },
      { label: "Concepts", to: "/user-guide/concepts" },
      { label: "Getting started", to: "/user-guide/getting-started" },
      { label: "Glossary", to: "/user-guide/glossary" },
    ],
  },
  {
    title: "Administration",
    items: [
      { label: "Overview", to: "/administration" },
      { label: "Deploying", to: "/administration/deploy/overview" },
      { label: "Configuration reference", to: "/administration/configuration" },
      { label: "Operations", to: "/administration/operations" },
    ],
  },
  {
    title: "CLI",
    items: [
      { label: "Overview", to: "/cli" },
      { label: "install.sh", to: "/cli/install-sh" },
      { label: "ouroboros-runner", to: "/cli/runner" },
      { label: "REST API from the shell", to: "/cli/rest-api" },
    ],
  },
  {
    title: "More",
    items: [
      { label: "GitHub", href: REPO_URL },
      { label: "ouroboros.build", href: MARKETING_URL },
    ],
  },
];

/**
 * Options for `@easyops-cn/docusaurus-search-local` (roadmap decision D5).
 *
 * One docs instance served from `/` holds all three sections, so one index covers every
 * sidebar. `explicitSearchResultPath` prints each hit's path — the active navbar item (its
 * section: User Guide, Administration or CLI), the sidebar group, then the page — so a
 * reader sees which section a result lives in. `hashed` busts the browser's cached index
 * whenever the docs change.
 */
const SEARCH_OPTIONS = {
  indexDocs: true,
  indexBlog: false,
  indexPages: false,
  docsRouteBasePath: "/",
  hashed: true,
  explicitSearchResultPath: true,
} satisfies PluginOptions;

/**
 * The Ouroboros documentation site.
 *
 * One docs instance served from the site root (roadmap decision D2): the three sections —
 * User Guide, Administration, CLI — are folders under `docs/`, each with its own sidebar
 * (`sidebars.ts`) and navbar item, and `docs/index.md` is the home page at `/`. Every kind
 * of broken reference — link, Markdown link, anchor, duplicate route — fails the build.
 * The brand (CY.3, #1166) is the product's own: `src/css/tokens.css` (a synced copy of
 * `docs/design/tokens.css`) mapped onto Infima by `src/css/custom.css`, the light/dark logo
 * pair and the favicon set. Search is local and Mermaid diagrams take the brand tokens
 * (CY.4, #1167); screenshots come from the capture manifest through `plugins/screenshots.ts`
 * (CZ.2, #1171). The scaffold's blog is switched off rather than left empty, so no `/blog`
 * route exists.
 */
const config: Config = {
  title: "Ouroboros Docs",
  tagline: "Infinity in Autonomy",
  favicon: BRAND_ASSETS.faviconIco,

  // The tab icon follows the browser chrome, as in ouroboros-ui: a transparent pair chosen
  // by prefers-color-scheme, the opaque .ico above as the fallback, and the home-screen icon.
  headTags: [
    {
      tagName: "link",
      attributes: {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        media: "(prefers-color-scheme: light)",
        href: `/${BRAND_ASSETS.favicon32Light}`,
      },
    },
    {
      tagName: "link",
      attributes: {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        media: "(prefers-color-scheme: dark)",
        href: `/${BRAND_ASSETS.favicon32Dark}`,
      },
    },
    {
      tagName: "link",
      attributes: {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: `/${BRAND_ASSETS.appleTouchIcon}`,
      },
    },
  ],

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true,
  },

  url: process.env.DOCS_SITE_URL || DEFAULT_SITE_URL,
  baseUrl: "/",
  // The home page would otherwise carry a second inline script — a banner explaining a
  // misconfigured baseUrl. The image's CSP admits only the theme script (roadmap decision D8,
  // scripts/csp.ts), and baseUrl is fixed at "/", so the banner has nothing to report.
  baseUrlIssueBanner: false,

  organizationName: "NobuData",
  projectName: "ouroboros",

  // Paths are served without a trailing slash: /user-guide, not /user-guide/.
  trailingSlash: false,

  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",
  onDuplicateRoutes: "throw",

  markdown: {
    // ```mermaid code blocks render as diagrams (roadmap decision D5).
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: "throw",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          // One instance, served from the root: the sections are /user-guide,
          // /administration and /cli (roadmap decision D2).
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: EDIT_URL,
        },
        blog: false,
        theme: {
          // The tokens first, so the Infima mapping can read them.
          customCss: ["./src/css/tokens.css", "./src/css/custom.css"],
        },
      } satisfies Preset.Options,
    ],
  ],

  // <Screenshot> (CZ.2, #1171): the manifest and each capture's size, read at build time.
  plugins: [screenshotsPlugin],

  themes: [
    // Diagrams. src/theme/Mermaid wraps the theme's renderer to feed it the brand tokens.
    "@docusaurus/theme-mermaid",
    // Local search (D5): the index is built into the site, so no third-party service.
    ["@easyops-cn/docusaurus-search-local", SEARCH_OPTIONS],
  ],

  themeConfig: {
    // Mermaid's "base" theme is the one built to be recoloured; the colours themselves are
    // read from the tokens at render time (src/theme/Mermaid/brandTheme.ts).
    mermaid: {
      theme: { light: "base", dark: "base" },
    },
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "Ouroboros Docs",
      // The icon, not the glyph: the navbar draws it at 32 px, and docs/BRAND.md puts the
      // glyph's minimum at 96 px wide. Each theme takes the treatment for its own surface.
      logo: {
        alt: "Ouroboros",
        src: BRAND_ASSETS.logoLight,
        srcDark: BRAND_ASSETS.logoDark,
        width: 32,
        height: 32,
      },
      items: [
        // The sections, in order; each item is active while a page of its sidebar is open.
        ...SECTIONS.map((section) => ({
          type: "docSidebar" as const,
          sidebarId: section.sidebarId,
          label: section.label,
          position: "left" as const,
        })),
        // Right side: search, GitHub, then the theme's own colour-mode toggle.
        { type: "search", position: "right" },
        { href: REPO_URL, label: "GitHub", position: "right" },
      ],
    },
    footer: {
      // "light" leaves the footer's colours to the brand mapping, which follows the theme;
      // "dark" would pin Infima's own charcoal in both.
      style: "light",
      links: FOOTER_LINKS,
      copyright: COPYRIGHT,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
