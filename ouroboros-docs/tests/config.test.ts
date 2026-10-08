import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

import { COPYRIGHT, DEFAULT_SITE_URL } from "../site.constants";

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

  it("refuses broken links", async () => {
    const { default: config } = await loadConfig();
    expect(config.onBrokenLinks).toBe("throw");
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
