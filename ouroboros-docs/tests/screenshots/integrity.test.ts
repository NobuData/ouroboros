import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_IMAGE_BYTES,
  MAX_TOTAL_BYTES,
  checkIntegrity,
  expectedImages,
  findUsages,
  formatBytes,
  formatStaleTable,
  imagePath,
  listImages,
  majorMinor,
  staleEntries,
  stripCode,
  usagesIn,
  type ImageFile,
} from "../../screenshots/lib/integrity.ts";
import type { Entry, Manifest } from "../../screenshots/lib/manifest.ts";

/** The module directory. */
const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * A manifest entry with every required field.
 *
 * @param id the entry's id.
 * @param extra fields to add or override.
 * @returns the entry.
 */
function entry(id: string, extra: Partial<Entry> = {}): Entry {
  return {
    id,
    route: "/",
    workspace: "acme-robotics",
    ready: "main",
    clip: "page",
    caption: "A caption.",
    alt: "Alt text.",
    ...extra,
  };
}

/** One entry, `home.dashboard`, and both its files at a modest size. */
const manifest: Manifest = { entries: [entry("home.dashboard")] };
const images: ImageFile[] = [
  { path: "home/dashboard.dark.png", bytes: 1000 },
  { path: "home/dashboard.light.png", bytes: 1000 },
];

describe("imagePath / expectedImages", () => {
  it("names both themes' files under the section folder, slug dots kept", () => {
    expect(imagePath("user-guide.wizard.step-1", "dark")).toBe("user-guide/wizard.step-1.dark.png");
    expect(expectedImages(manifest)).toEqual([
      "home/dashboard.light.png",
      "home/dashboard.dark.png",
    ]);
  });
});

describe("checkIntegrity", () => {
  it("passes when manifest, files and pages agree", () => {
    expect(
      checkIntegrity(manifest, images, [{ id: "home.dashboard", file: "a.mdx", line: 1 }]),
    ).toEqual([]);
  });

  it("names a missing theme file", () => {
    const problems = checkIntegrity(manifest, [images[1]], []);
    expect(problems).toHaveLength(1);
    expect(problems[0].code).toBe("missing-image");
    expect(problems[0].message).toMatch(/home\.dashboard has no dark capture/);
    expect(problems[0].message).toContain("home/dashboard.dark.png");
  });

  it("names a page using an id the manifest does not list", () => {
    const problems = checkIntegrity(manifest, images, [
      { id: "user-guide.inbox", file: "docs/user-guide/inbox.mdx", line: 7 },
    ]);
    expect(problems).toEqual([
      {
        code: "unknown-screenshot-id",
        message: expect.stringContaining(
          'docs/user-guide/inbox.mdx:7 uses <Screenshot id="user-guide.inbox">',
        ),
      },
    ]);
  });

  it("names a file no entry accounts for, whatever its extension", () => {
    const problems = checkIntegrity(
      manifest,
      [...images, { path: "home/old.light.png", bytes: 10 }, { path: "notes.txt", bytes: 10 }],
      [],
    );
    expect(problems.map((problem) => problem.code)).toEqual(["orphan-image", "orphan-image"]);
    expect(problems[0].message).toContain("static/img/screenshots/home/old.light.png");
  });

  it("allows an image of exactly the budget and refuses one byte more", () => {
    expect(
      checkIntegrity(manifest, [{ ...images[0], bytes: MAX_IMAGE_BYTES }, images[1]], []),
    ).toEqual([]);
    const problems = checkIntegrity(
      manifest,
      [{ ...images[0], bytes: MAX_IMAGE_BYTES + 1 }, images[1]],
      [],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].code).toBe("image-over-budget");
    expect(problems[0].message).toMatch(/over the 350\.0 KiB per-image budget/);
  });

  it("refuses a total over the budget even when every image is within its own", () => {
    const count = Math.ceil(MAX_TOTAL_BYTES / MAX_IMAGE_BYTES) + 1;
    const many: Manifest = {
      entries: Array.from({ length: count }, (_, index) => entry(`home.shot-${index}`)),
    };
    const files = many.entries.flatMap((each) =>
      (["light", "dark"] as const).map((theme) => ({
        path: imagePath(each.id, theme),
        bytes: MAX_IMAGE_BYTES / 2,
      })),
    );
    const problems = checkIntegrity(many, files, []);
    expect(problems.map((problem) => problem.code)).toEqual(["total-over-budget"]);
    expect(problems[0].message).toMatch(/over the 40\.0 MiB total budget/);
  });

  it("reports every failure, not just the first", () => {
    const problems = checkIntegrity(
      manifest,
      [
        { path: "home/dashboard.light.png", bytes: MAX_IMAGE_BYTES + 1 },
        { path: "x.png", bytes: 1 },
      ],
      [{ id: "nope", file: "p.md", line: 1 }],
    );
    expect(new Set(problems.map((problem) => problem.code))).toEqual(
      new Set(["missing-image", "unknown-screenshot-id", "orphan-image", "image-over-budget"]),
    );
  });
});

describe("usagesIn", () => {
  it("finds double-quoted, single-quoted and expression ids with their lines", () => {
    const text = [
      "# Page",
      '<Screenshot id="home.dashboard" />',
      "",
      "<Screenshot caption=\"x\" id='user-guide.inbox' />",
      '<Screenshot id={ "cli.run" } alt="A" />',
    ].join("\n");
    expect(usagesIn(text, "p.mdx", true)).toEqual([
      { id: "home.dashboard", file: "p.mdx", line: 2 },
      { id: "user-guide.inbox", file: "p.mdx", line: 4 },
      { id: "cli.run", file: "p.mdx", line: 5 },
    ]);
  });

  it("finds a template-literal id in TSX, where code is not stripped", () => {
    expect(usagesIn("<Screenshot id={`cli.help`} />", "p.tsx", false)).toEqual([
      { id: "cli.help", file: "p.tsx", line: 1 },
    ]);
  });

  it("skips code samples in Markdown but keeps line numbers", () => {
    const text = [
      "```mdx",
      '<Screenshot id="example.only" />',
      "```",
      'Write `<Screenshot id="inline.example" />` to show one.',
      '<Screenshot id="home.dashboard" />',
    ].join("\n");
    expect(usagesIn(text, "p.md", true)).toEqual([{ id: "home.dashboard", file: "p.md", line: 5 }]);
  });

  it("does not mistake other components or attributes for a screenshot", () => {
    expect(usagesIn('<ScreenshotGallery id="a" /><Image id="b" />', "p.mdx", true)).toEqual([]);
  });
});

describe("stripCode", () => {
  it("keeps the text's length and newlines", () => {
    const text = "a `b` c\n```\nd\n```\ne";
    const stripped = stripCode(text);
    expect(stripped).toHaveLength(text.length);
    expect(stripped.split("\n")).toHaveLength(text.split("\n").length);
    expect(stripped).not.toMatch(/[bd]/);
  });
});

describe("on disk", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "docs-integrity-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists every file under the root with its size, sorted", () => {
    mkdirSync(join(root, "home"));
    writeFileSync(join(root, "home", "b.png"), "12345");
    writeFileSync(join(root, "a.png"), "1");
    expect(listImages(root)).toEqual([
      { path: "a.png", bytes: 1 },
      { path: "home/b.png", bytes: 5 },
    ]);
  });

  it("treats a missing root as no images", () => {
    expect(listImages(join(root, "absent"))).toEqual([]);
  });

  it("searches md, mdx and tsx pages, skipping other files and missing directories", () => {
    mkdirSync(join(root, "docs", "guide"), { recursive: true });
    writeFileSync(join(root, "docs", "guide", "a.mdx"), '<Screenshot id="a.one" />');
    writeFileSync(join(root, "docs", "b.md"), '<Screenshot id="b.two" />');
    writeFileSync(join(root, "docs", "c.json"), '<Screenshot id="c.three" />');
    mkdirSync(join(root, "src", "pages"), { recursive: true });
    writeFileSync(join(root, "src", "pages", "index.tsx"), 'x = <Screenshot id="home.d" />;');
    expect(findUsages(root, ["docs", "src/pages", "missing"])).toEqual([
      { id: "b.two", file: "docs/b.md", line: 1 },
      { id: "a.one", file: "docs/guide/a.mdx", line: 1 },
      { id: "home.d", file: "src/pages/index.tsx", line: 1 },
    ]);
  });

  it("finds the home page's dashboard in the committed site", () => {
    expect(findUsages(MODULE_DIR, ["src/pages"])).toContainEqual(
      expect.objectContaining({ id: "home.dashboard", file: "src/pages/index.tsx" }),
    );
  });
});

describe("staleness", () => {
  it("parses major.minor, tolerating a v prefix and pre-release", () => {
    expect(majorMinor("0.144.1")).toEqual([0, 144]);
    expect(majorMinor("v1.2.3-rc.1")).toEqual([1, 2]);
    expect(majorMinor("1.2")).toEqual([1, 2]);
    expect(majorMinor("latest")).toBeUndefined();
  });

  it("lists entries a minor or major behind, or unstamped — never a patch behind", () => {
    const stamped: Manifest = {
      entries: [
        entry("a.current", { uiVersion: "0.144.0" }),
        entry("a.ahead", { uiVersion: "0.145.0" }),
        entry("a.minor", { uiVersion: "0.143.9", capturedAt: "2026-10-01T00:00:00.000Z" }),
        entry("a.unstamped"),
        entry("a.garbled", { uiVersion: "dev" }),
      ],
    };
    expect(staleEntries(stamped, "0.144.7")).toEqual([
      { id: "a.minor", uiVersion: "0.143.9", capturedAt: "2026-10-01T00:00:00.000Z" },
      { id: "a.unstamped", uiVersion: "unstamped", capturedAt: "—" },
      { id: "a.garbled", uiVersion: "dev", capturedAt: "—" },
    ]);
    expect(staleEntries({ entries: [entry("b", { uiVersion: "0.200.0" })] }, "1.0.0")).toHaveLength(
      1,
    );
  });

  it("refuses a current version that is not semver", () => {
    expect(() => staleEntries(manifest, "next")).toThrow(/not semver/);
  });

  it("prints an aligned table, or an all-clear", () => {
    const table = formatStaleTable(
      [
        { id: "home.dashboard", uiVersion: "0.143.0", capturedAt: "2026-10-01T00:00:00.000Z" },
        { id: "cli.x", uiVersion: "unstamped", capturedAt: "—" },
      ],
      "0.144.1",
    );
    expect(table.split("\n")).toEqual([
      "2 screenshot(s) captured before ouroboros-ui 0.144 — recapture when convenient:",
      "",
      "id              uiVersion  capturedAt",
      "--------------  ---------  ------------------------",
      "home.dashboard  0.143.0    2026-10-01T00:00:00.000Z",
      "cli.x           unstamped  —",
    ]);
    expect(formatStaleTable([], "0.144.1")).toMatch(/No stale screenshots.*0\.144\.x/);
  });
});

describe("formatBytes", () => {
  it("uses KiB below a MiB and MiB from there", () => {
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(MAX_TOTAL_BYTES)).toBe("40.0 MiB");
  });
});
