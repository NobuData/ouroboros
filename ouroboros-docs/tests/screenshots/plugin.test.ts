import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadContext } from "@docusaurus/types";

import screenshotsPlugin, {
  buildScreenshotIndex,
  pngSize,
  type ScreenshotIndex,
} from "../../plugins/screenshots";
import { MANIFEST_PATH, type Entry, type Manifest } from "../../screenshots/lib/manifest.ts";
import { SCREENSHOTS_PLUGIN } from "../../site.constants";

/** A valid entry to vary. */
const ENTRY: Entry = {
  id: "user-guide.inbox.head",
  route: "/inbox",
  workspace: "acme-robotics",
  ready: "text=Needs you",
  clip: "page",
  caption: "The inbox.",
  alt: "The needs-you inbox.",
};

/**
 * A blank PNG of the given size.
 *
 * @param width pixels across.
 * @param height pixels down.
 * @returns the file's bytes.
 */
function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#000" } })
    .png()
    .toBuffer();
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "screenshots-plugin-"));
  mkdirSync(join(dir, "user-guide"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Writes one theme's capture of {@link ENTRY}.
 *
 * @param theme the palette.
 * @param bytes the file.
 */
function writeCapture(theme: "light" | "dark", bytes: Buffer): void {
  writeFileSync(join(dir, "user-guide", `inbox.head.${theme}.png`), bytes);
}

describe("pngSize", () => {
  it("reads the size from the header", async () => {
    expect(pngSize(await png(37, 12))).toEqual({ width: 37, height: 12 });
  });

  it("refuses bytes that are not a PNG", () => {
    expect(() => pngSize(Buffer.from("GIF89a, not a png at all, honestly"))).toThrow(/not a PNG/);
    expect(() => pngSize(Buffer.alloc(4))).toThrow(/not a PNG/);
  });
});

describe("buildScreenshotIndex", () => {
  const manifest: Manifest = { entries: [ENTRY] };

  it("gives each entry its text, both files and its size", async () => {
    writeCapture("light", await png(40, 25));
    writeCapture("dark", await png(40, 25));
    expect(buildScreenshotIndex(manifest, dir)).toEqual({
      screenshots: {
        "user-guide.inbox.head": {
          alt: "The needs-you inbox.",
          caption: "The inbox.",
          sources: {
            light: "img/screenshots/user-guide/inbox.head.light.png",
            dark: "img/screenshots/user-guide/inbox.head.dark.png",
          },
          width: 40,
          height: 25,
        },
      },
    });
  });

  it("fails naming the entry, theme and command when a capture is missing", async () => {
    writeCapture("light", await png(40, 25));
    expect(() => buildScreenshotIndex(manifest, dir)).toThrow(
      /user-guide\.inbox\.head \(dark\).*yarn screenshots --only user-guide\.inbox\.head/,
    );
  });

  it("fails when a capture is not a PNG", async () => {
    writeCapture("light", await png(40, 25));
    writeCapture("dark", Buffer.from("not an image"));
    expect(() => buildScreenshotIndex(manifest, dir)).toThrow(/\(dark\).*not a PNG/);
  });

  it("fails when the themes differ in size, since one box must fit both", async () => {
    writeCapture("light", await png(40, 25));
    writeCapture("dark", await png(40, 26));
    expect(() => buildScreenshotIndex(manifest, dir)).toThrow(/40×25 but the dark one is 40×26/);
  });

  it("is empty for an empty manifest", () => {
    expect(buildScreenshotIndex({ entries: [] }, dir)).toEqual({ screenshots: {} });
  });

  it("covers every committed entry", () => {
    const index = buildScreenshotIndex({ entries: [{ ...ENTRY, id: "home.dashboard" }] });
    expect(index.screenshots["home.dashboard"]).toMatchObject({ width: 1440, height: 900 });
  });
});

describe("the plugin", () => {
  const plugin = screenshotsPlugin({ siteDir: "/site" } as LoadContext);

  it("is named for usePluginData", () => {
    expect(plugin.name).toBe(SCREENSHOTS_PLUGIN);
  });

  it("rebuilds when the manifest or an image changes", () => {
    expect(plugin.getPathsToWatch?.()).toEqual(
      expect.arrayContaining([MANIFEST_PATH, "/site/static/img/screenshots/**/*.png"]),
    );
  });

  it("publishes its content as global data", async () => {
    const setGlobalData = vi.fn();
    const content = { screenshots: {} };
    await plugin.contentLoaded?.({
      content,
      actions: { setGlobalData } as never,
    });
    expect(setGlobalData).toHaveBeenCalledWith(content);
  });

  it("loads the committed manifest from the site's static directory", async () => {
    const site = screenshotsPlugin({ siteDir: join(MANIFEST_PATH, "..", "..") } as LoadContext);
    const content = (await site.loadContent?.()) as ScreenshotIndex;
    expect(Object.keys(content.screenshots)).toContain("home.dashboard");
  });
});
