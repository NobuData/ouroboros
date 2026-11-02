import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type * as Preset from "@docusaurus/preset-classic";

import { RELEASE, RELEASE_NOTES_PATH } from "../site.constants";

/** The release's feature page, a standalone page outside the three doc sections. */
const NOTES_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "pages",
  `${RELEASE_NOTES_PATH.slice(1)}.mdx`,
);

describe("the release the site names", () => {
  it("is RC1", () => {
    expect(RELEASE).toBe("RC1");
  });

  it("closes the navbar on every page, and is exposed to the pages", async () => {
    const { default: config } = await import("../docusaurus.config");
    const items = (config.themeConfig as Preset.ThemeConfig).navbar?.items ?? [];
    expect(items.at(-1)).toMatchObject({ type: "html", position: "right" });
    expect(String(items.at(-1)?.value)).toContain(`>${RELEASE}<`);
    expect(config.customFields?.release).toBe(RELEASE);
  });
});

describe("the release's feature page", () => {
  const page = existsSync(NOTES_FILE) ? readFileSync(NOTES_FILE, "utf8") : "";

  it("is what the navbar's release marker opens", async () => {
    const { default: config } = await import("../docusaurus.config");
    const items = (config.themeConfig as Preset.ThemeConfig).navbar?.items ?? [];
    expect(RELEASE_NOTES_PATH).toBe("/releases/rc1");
    expect(String(items.at(-1)?.value)).toContain(`<a class="navbar__release" href="${RELEASE_NOTES_PATH}"`);
    expect(existsSync(NOTES_FILE)).toBe(true);
  });

  it("names the release and lists its features, each linked to the page that documents it", () => {
    expect(page).toMatch(new RegExp(`^# ${RELEASE} — release candidate 1$`, "m"));
    expect(page).toMatch(/^## What is new in RC1$/m);
    for (const group of ["The live loop", "Knowing what is real", "Your first loop", "Fixed in RC1"]) {
      expect(page).toMatch(new RegExp(`^### ${group}$`, "m"));
    }
    const features = page.match(/^- \*\*[^*]+\*\*/gm) ?? [];
    expect(features.length).toBeGreaterThanOrEqual(15);
    // Every feature bullet in "What is new" carries a link into the site.
    const news = page.slice(page.indexOf("## What is new"), page.indexOf("## What RC1 does not do"));
    for (const bullet of news.split(/\n(?=- )/).filter((b) => b.startsWith("- "))) {
      expect(bullet, bullet.slice(0, 60)).toMatch(/\]\(\/(user-guide|administration|cli)\//);
    }
  });

  it("says what the release does not do, as plainly as what it does", () => {
    expect(page).toMatch(/^## What RC1 does not do$/m);
    expect(page).toContain("**It does not merge.**");
    expect(page).toContain("**It is off until you switch it on.**");
    expect(page).toContain("**The coding agent has file tools only**");
  });

  it("states no rate and names no internal ticket", () => {
    expect(page).not.toMatch(/\d+(\.\d+)?\s?%/);
    expect(page).not.toMatch(/\[[A-Z]{1,2}\.\d+\]|#\d{2,}|issues\/\d+/);
  });
});
