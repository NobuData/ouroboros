import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

import { COPYRIGHT, DEFAULT_SITE_URL } from "./site.constants";

// This runs in Node.js — no browser APIs or JSX here.

/**
 * The Ouroboros documentation site — scaffold (CY.1, #1164).
 *
 * Deliberately empty: one docs instance served from the site root, holding only the
 * placeholder home page (`docs/index.md`, which Docusaurus needs at least one of). The
 * three sections, their sidebars, the navbar and the footer columns arrive with CY.2
 * (#1165); brand colours and logos with CY.3 (#1166). The scaffold's blog is switched off
 * rather than left empty, so no `/blog` route is generated at all.
 */
const config: Config = {
  title: "Ouroboros Docs",
  tagline: "Infinity in Autonomy",

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true,
  },

  url: process.env.DOCS_SITE_URL || DEFAULT_SITE_URL,
  baseUrl: "/",

  organizationName: "NobuData",
  projectName: "ouroboros",

  onBrokenLinks: "throw",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          // One instance, served from the root: the sections become /user-guide,
          // /administration and /cli (roadmap decision D2) once CY.2 adds them.
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "Ouroboros Docs",
      items: [],
    },
    footer: {
      style: "dark",
      copyright: COPYRIGHT,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
