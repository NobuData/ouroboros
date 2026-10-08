import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

import {
  COPYRIGHT,
  DEFAULT_SITE_URL,
  EDIT_URL,
  MARKETING_URL,
  REPO_URL,
  SECTIONS,
} from "../site.constants";

/**
 * Loads `docusaurus.config.ts` afresh, so a test can set `DOCS_SITE_URL` before the module
 * reads it.
 *
 * @returns the config module.
 */
async function loadConfig() {
  vi.resetModules();
  return import("../docusaurus.config");
}

/**
 * The classic preset's options from a config.
 *
 * @param config the site config.
 * @returns the options object passed to the `classic` preset.
 */
function classicOptions(config: Config): Preset.Options {
  const preset = config.presets?.find(
    (entry): entry is [string, Preset.Options] => Array.isArray(entry) && entry[0] === "classic",
  );
  if (!preset) throw new Error("the classic preset is not configured");
  return preset[1];
}

describe("docusaurus.config.ts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("switches the blog off, so no /blog route exists", async () => {
    const { default: config } = await loadConfig();
    expect(classicOptions(config).blog).toBe(false);
  });

  it("serves one docs instance from the site root", async () => {
    const { default: config } = await loadConfig();
    const docs = classicOptions(config).docs;
    expect(docs).toMatchObject({ routeBasePath: "/", sidebarPath: "./sidebars.ts" });
  });

  it("refuses broken links, Markdown links and anchors, and duplicate routes", async () => {
    const { default: config } = await loadConfig();
    expect(config.onBrokenLinks).toBe("throw");
    expect(config.onBrokenAnchors).toBe("throw");
    expect(config.onDuplicateRoutes).toBe("throw");
    expect(config.markdown?.hooks?.onBrokenMarkdownLinks).toBe("throw");
  });

  it("serves paths without a trailing slash", async () => {
    const { default: config } = await loadConfig();
    expect(config.trailingSlash).toBe(false);
  });

  it("points Edit this page at the module on main", async () => {
    const { default: config } = await loadConfig();
    expect(EDIT_URL).toBe("https://github.com/NobuData/ouroboros/edit/main/ouroboros-docs/");
    expect(classicOptions(config).docs).toMatchObject({ editUrl: EDIT_URL });
  });

  it("lists the three sections in the navbar, in order, then GitHub on the right", async () => {
    const { default: config } = await loadConfig();
    const items = (config.themeConfig as Preset.ThemeConfig).navbar?.items ?? [];
    expect(items.slice(0, 3)).toEqual([
      { type: "docSidebar", sidebarId: "userGuide", label: "User Guide", position: "left" },
      {
        type: "docSidebar",
        sidebarId: "administration",
        label: "Administration",
        position: "left",
      },
      { type: "docSidebar", sidebarId: "cli", label: "CLI", position: "left" },
    ]);
    expect(items).toContainEqual({ href: REPO_URL, label: "GitHub", position: "right" });
  });

  it("puts search on the right, before GitHub", async () => {
    const { default: config } = await loadConfig();
    const items = (config.themeConfig as Preset.ThemeConfig).navbar?.items ?? [];
    const search = items.findIndex((item) => item.type === "search");
    const github = items.findIndex((item) => item.href === REPO_URL);
    expect(items[search]).toMatchObject({ position: "right" });
    expect(search).toBeLessThan(github);
  });

  it("indexes the one docs instance at / for local search, and no blog", async () => {
    const { default: config } = await loadConfig();
    const search = config.themes?.find(
      (theme): theme is [string, Record<string, unknown>] =>
        Array.isArray(theme) && theme[0] === "@easyops-cn/docusaurus-search-local",
    );
    expect(search?.[1]).toMatchObject({
      indexDocs: true,
      indexBlog: false,
      docsRouteBasePath: "/",
      hashed: true,
      // Prints each hit's path, which starts with its section's navbar label.
      explicitSearchResultPath: true,
    });
    // One index across all three sections: per-path contexts would split them.
    expect(search?.[1]).not.toHaveProperty("searchContextByPaths");
  });

  it("renders Mermaid code blocks with the recolourable base theme in both modes", async () => {
    const { default: config } = await loadConfig();
    expect(config.markdown?.mermaid).toBe(true);
    expect(config.themes).toContain("@docusaurus/theme-mermaid");
    expect((config.themeConfig as { mermaid?: unknown }).mermaid).toEqual({
      theme: { light: "base", dark: "base" },
    });
  });

  it("links the navbar's three section items to exactly the sidebars sidebars.ts exports", async () => {
    const { default: config } = await loadConfig();
    const { default: sidebars } = await import("../sidebars");
    const items = (config.themeConfig as Preset.ThemeConfig).navbar?.items ?? [];
    const sidebarItems = items.filter((item) => item.type === "docSidebar");
    expect(sidebarItems.map((item) => item.sidebarId)).toEqual(Object.keys(sidebars));
  });

  it("keeps the colour-mode toggle", async () => {
    const { default: config } = await loadConfig();
    const theme = config.themeConfig as Preset.ThemeConfig;
    expect(theme.colorMode?.disableSwitch).not.toBe(true);
  });

  it("has a footer column per section, then More with GitHub and ouroboros.build", async () => {
    const { default: config } = await loadConfig();
    const footer = (config.themeConfig as Preset.ThemeConfig).footer;
    const columns = (footer?.links ?? []) as { title: string; items: Record<string, string>[] }[];
    expect(columns.map((column) => column.title)).toEqual([
      ...SECTIONS.map((section) => section.label),
      "More",
    ]);
    SECTIONS.forEach((section, index) => {
      const targets = columns[index].items.map((item) => item.to);
      expect(targets[0], section.label).toBe(`/${section.dir}`);
      for (const target of targets) expect(target).toMatch(new RegExp(`^/${section.dir}(/|$)`));
    });
    expect(columns[3].items.map((item) => item.href)).toEqual([REPO_URL, MARKETING_URL]);
  });

  it("builds for docs.ouroboros.build by default", async () => {
    vi.stubEnv("DOCS_SITE_URL", "");
    const { default: config } = await loadConfig();
    expect(DEFAULT_SITE_URL).toBe("https://docs.ouroboros.build");
    expect(config.url).toBe(DEFAULT_SITE_URL);
    expect(config.baseUrl).toBe("/");
  });

  it("lets DOCS_SITE_URL point a preview build elsewhere", async () => {
    vi.stubEnv("DOCS_SITE_URL", "http://localhost:8080");
    const { default: config } = await loadConfig();
    expect(config.url).toBe("http://localhost:8080");
  });

  it("carries the exact copyright line", async () => {
    const { default: config } = await loadConfig();
    expect(COPYRIGHT).toBe("Copyright © 2025-2026 NobuData LLC");
    const theme = config.themeConfig as Preset.ThemeConfig;
    expect(theme.footer?.copyright).toBe(COPYRIGHT);
  });
});
