import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import stylelint from "stylelint";
import { afterEach, describe, expect, it } from "vitest";
import type * as Preset from "@docusaurus/preset-classic";

import config from "../docusaurus.config";
import { BRAND_COPIES, findDrift, syncBrand } from "../scripts/sync-brand.mjs";
import { BRAND_ASSETS } from "../site.constants";

/** The module directory (`ouroboros-docs/`). */
const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The site's own stylesheet, which maps the tokens onto Infima. */
const CUSTOM_CSS = join(MODULE_DIR, "src/css/custom.css");

/** The synced token sheet. */
const TOKENS_CSS = join(MODULE_DIR, "src/css/tokens.css");

/** Scratch directories made by a test, removed after it. */
const scratch: string[] = [];

/**
 * Builds a throwaway repository root and docs module holding every brand source and an
 * in-sync copy of each, so drift can be provoked without touching the real files.
 *
 * @returns the fake repository root and module directory.
 */
function fakeRepo(): { root: string; module: string } {
  const root = mkdtempSync(join(tmpdir(), "docs-brand-"));
  scratch.push(root);
  const module = join(root, "ouroboros-docs");
  for (const { from, to } of BRAND_COPIES) {
    for (const path of [join(root, from), join(module, to)]) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `contents of ${from}\n`);
    }
  }
  return { root, module };
}

/**
 * Runs the sync script's command line.
 *
 * @param args the arguments after the script name.
 * @returns the exit status and output.
 */
function runScript(...args: string[]) {
  return spawnSync(process.execPath, ["scripts/sync-brand.mjs", ...args], {
    cwd: MODULE_DIR,
    encoding: "utf8",
  });
}

/**
 * Lints CSS text with the module's stylelint config, as if it lived at `filePath`.
 *
 * @param code the CSS to lint.
 * @param filePath where the code claims to live, which decides whether it is ignored.
 * @returns the rule names stylelint reported.
 */
async function lintCss(code: string, filePath = CUSTOM_CSS): Promise<string[]> {
  const result = await stylelint.lint({ code, codeFilename: filePath, cwd: MODULE_DIR });
  return result.results.flatMap((entry) => entry.warnings.map((warning) => warning.rule));
}

afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

describe("the brand copies", () => {
  it("cover the tokens, the six brand PNGs, the mockup logos and the favicon set", () => {
    const sources = BRAND_COPIES.map((copy) => copy.from);
    expect(sources).toContain("docs/design/tokens.css");
    expect(sources.filter((from) => from.startsWith("docs/brand/"))).toHaveLength(6);
    expect(sources).toEqual(
      expect.arrayContaining([
        "docs/mockups/assets/logo-lockup.png",
        "docs/mockups/assets/logo-mark.png",
        "ouroboros-ui/public/favicon.ico",
        "ouroboros-ui/public/favicon-32-light.png",
        "ouroboros-ui/public/favicon-32-dark.png",
        "ouroboros-ui/public/apple-touch-icon.png",
      ]),
    );
  });

  it("match their sources in this repository", () => {
    expect(findDrift()).toEqual({ missingSources: [], drifted: [] });
  });

  it("report a copy edited by hand", () => {
    const { root, module } = fakeRepo();
    writeFileSync(join(module, "src/css/tokens.css"), ":root { --accent: red; }\n");
    expect(findDrift(root, module)).toEqual({
      missingSources: [],
      drifted: ["src/css/tokens.css"],
    });
  });

  it("report a copy that is missing", () => {
    const { root, module } = fakeRepo();
    rmSync(join(module, "static/img/brand/icon-dark.png"));
    expect(findDrift(root, module).drifted).toEqual(["static/img/brand/icon-dark.png"]);
  });

  it("report a source that is missing", () => {
    const { root, module } = fakeRepo();
    rmSync(join(root, "docs/brand/glyph-light.png"));
    expect(findDrift(root, module).missingSources).toEqual(["docs/brand/glyph-light.png"]);
  });
});

describe("syncBrand", () => {
  it("brings every drifted copy back in line with its source", () => {
    const { root, module } = fakeRepo();
    writeFileSync(join(module, "src/css/tokens.css"), "edited\n");
    rmSync(join(module, "static/img/brand/favicon"), { recursive: true });
    expect(syncBrand(root, module)).toBe(BRAND_COPIES.length);
    expect(findDrift(root, module)).toEqual({ missingSources: [], drifted: [] });
  });

  it("refuses to sync half a brand when a source is missing", () => {
    const { root, module } = fakeRepo();
    rmSync(join(root, "docs/design/tokens.css"));
    expect(() => syncBrand(root, module)).toThrow(/docs\/design\/tokens\.css/);
  });
});

describe("yarn check:brand", () => {
  it("passes while the copies match", () => {
    const run = runScript("--check");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`${BRAND_COPIES.length} copies match`);
  });

  it("refuses an unknown argument", () => {
    const run = runScript("--chek");
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("--chek");
  });
});

describe("stylelint", () => {
  it("passes the site's own stylesheet", async () => {
    expect(await lintCss(readFileSync(CUSTOM_CSS, "utf8"))).toEqual([]);
  });

  it.each([
    ["a hex colour", ".x { color: #07708e; }", "color-no-hex"],
    ["a named colour", ".x { color: red; }", "color-named"],
    ["an rgb() colour", ".x { color: rgb(7 112 142); }", "function-disallowed-list"],
    ["an hsl() colour", ".x { background: hsl(193 90% 29%); }", "function-disallowed-list"],
  ])("fails %s in custom.css", async (_name, code, rule) => {
    expect(await lintCss(code)).toContain(rule);
  });

  it("leaves the token sheet alone — it is the one place literals live", async () => {
    expect(await lintCss(":root { --accent: #07708e; }", TOKENS_CSS)).toEqual([]);
  });
});

describe("the brand mapping", () => {
  /** Every custom property the token sheet defines. */
  const tokens = new Set(
    [...readFileSync(TOKENS_CSS, "utf8").matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]),
  );
  /** The site's stylesheet. */
  const css = readFileSync(CUSTOM_CSS, "utf8");

  it("reads only tokens the token sheet defines", () => {
    const used = [...css.matchAll(/var\((--[\w-]+)\)/g)].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !tokens.has(name))).toEqual([]);
  });

  it.each([
    ["--ifm-color-primary", "--accent"],
    ["--ifm-background-color", "--ground"],
    ["--ifm-background-surface-color", "--surface"],
    ["--ifm-font-family-base", "--f-ui"],
    ["--ifm-heading-font-family", "--f-disp"],
    ["--ifm-font-family-monospace", "--f-mono"],
    ["--ifm-global-radius", "--r-md"],
  ])("maps %s to var(%s)", (infima, token) => {
    expect(css).toContain(`${infima}: var(${token});`);
  });

  it("covers both themes with selectors as specific as Infima's dark block", () => {
    expect(css).toContain('html[data-theme="light"]');
    expect(css).toContain('html[data-theme="dark"]');
  });

  it("self-hosts the three faces the tokens name", () => {
    for (const face of ["chakra-petch", "ibm-plex-sans", "ibm-plex-mono"]) {
      expect(css, face).toContain(`@import "@fontsource/${face}/`);
    }
  });
});

describe("docusaurus.config.ts brand wiring", () => {
  const theme = config.themeConfig as Preset.ThemeConfig;

  it("loads the tokens before the stylesheet that maps them", () => {
    const preset = config.presets?.find(
      (entry): entry is [string, Preset.Options] => Array.isArray(entry) && entry[0] === "classic",
    );
    const theme = preset?.[1].theme as { customCss?: string[] } | undefined;
    expect(theme?.customCss).toEqual(["./src/css/tokens.css", "./src/css/custom.css"]);
  });

  it("follows the OS colour scheme until the reader picks one", () => {
    expect(theme.colorMode?.respectPrefersColorScheme).toBe(true);
  });

  it("swaps the navbar logo between the light and dark icon", () => {
    expect(theme.navbar?.logo).toMatchObject({
      src: BRAND_ASSETS.logoLight,
      srcDark: BRAND_ASSETS.logoDark,
    });
    expect(BRAND_ASSETS.logoLight).toMatch(/icon-light\.png$/);
    expect(BRAND_ASSETS.logoDark).toMatch(/icon-dark\.png$/);
  });

  it("leaves the footer's colours to the brand mapping", () => {
    expect(theme.footer?.style).toBe("light");
  });

  it("uses the .ico fallback and the light/dark tab icons", () => {
    expect(config.favicon).toBe(BRAND_ASSETS.faviconIco);
    const icons = (config.headTags ?? []).map((tag) => tag.attributes);
    expect(icons).toContainEqual(
      expect.objectContaining({
        media: "(prefers-color-scheme: light)",
        href: `/${BRAND_ASSETS.favicon32Light}`,
      }),
    );
    expect(icons).toContainEqual(
      expect.objectContaining({
        media: "(prefers-color-scheme: dark)",
        href: `/${BRAND_ASSETS.favicon32Dark}`,
      }),
    );
    expect(icons).toContainEqual(
      expect.objectContaining({ rel: "apple-touch-icon", href: `/${BRAND_ASSETS.appleTouchIcon}` }),
    );
  });

  it.each(Object.entries(BRAND_ASSETS))("finds %s in static/", (_name, path) => {
    expect(existsSync(join(MODULE_DIR, "static", path))).toBe(true);
  });
});
