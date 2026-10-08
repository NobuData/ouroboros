import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MANIFEST_PATH,
  OUTPUT_DIR,
  captureInstant,
  idMatcher,
  loadManifest,
  outputPath,
  readyTimeoutMessage,
  selectEntries,
  validateManifest,
  type Entry,
  type Manifest,
} from "../../screenshots/lib/manifest.ts";

/** A valid entry to vary. */
const ENTRY: Entry = {
  id: "home.dashboard",
  route: "/dashboard",
  workspace: "acme-robotics",
  ready: "text=Mission Control",
  clip: "page",
  caption: "The dashboard.",
  alt: "The dashboard.",
};

/**
 * A manifest holding the given entries.
 *
 * @param entries the entries.
 * @returns the manifest.
 */
const manifestOf = (...entries: Entry[]): Manifest => ({ entries });

describe("the committed manifest", () => {
  it("passes its own schema", () => {
    expect(() => loadManifest()).not.toThrow();
  });

  it("lists home.dashboard, which the landing page waits for", () => {
    expect(loadManifest().entries.map((entry) => entry.id)).toContain("home.dashboard");
  });

  it("points editors at its schema", () => {
    expect(JSON.parse(readFileSync(MANIFEST_PATH, "utf8")).$schema).toBe(
      "./screenshots.manifest.schema.json",
    );
  });
});

describe("validateManifest", () => {
  it("accepts every optional field and every kind of action", () => {
    const entry: Entry = {
      ...ENTRY,
      clip: "[data-card=queue]",
      masks: ["time"],
      actions: [
        { click: "role=button[name=Invite]" },
        { hover: "text=Runners" },
        { fill: "input[name=email]", value: "maya@acme-robotics.dev" },
        { press: "Escape" },
        { press: "Enter", on: "input[name=email]" },
      ],
      capturedAt: "2026-10-08T12:00:00.000Z",
      uiVersion: "0.40.0",
      seedRef: "abc123",
    };
    expect(() =>
      validateManifest({ clock: "2026-10-08T12:00:00Z", entries: [entry] }),
    ).not.toThrow();
  });

  it.each([
    ["an id outside the four sections", { id: "blog.post" }, "/entries/0/id"],
    ["an id without a slug", { id: "home" }, "/entries/0/id"],
    ["a relative route", { route: "dashboard" }, "/entries/0/route"],
    ["an empty ready selector", { ready: "" }, "/entries/0/ready"],
    ["an unknown field", { colour: "blue" }, "/entries/0"],
    ["an action of no known kind", { actions: [{ scroll: "x" }] }, "/entries/0/actions/0"],
    ["a fill with no value", { actions: [{ fill: "input" }] }, "/entries/0/actions/0"],
  ])("refuses %s, naming where it is", (_name, change, path) => {
    expect(() => validateManifest(manifestOf({ ...ENTRY, ...change } as Entry))).toThrow(path);
  });

  it("refuses an entry missing its alt text", () => {
    const withoutAlt: Partial<Entry> = { ...ENTRY };
    delete withoutAlt.alt;
    expect(() => validateManifest(manifestOf(withoutAlt as Entry))).toThrow(/alt/);
  });

  it("refuses a clock that is not a date-time", () => {
    expect(() => validateManifest({ clock: "noon", entries: [] })).toThrow("/clock");
  });

  it("refuses two entries with one id", () => {
    expect(() => validateManifest(manifestOf(ENTRY, ENTRY))).toThrow(/home\.dashboard twice/);
  });
});

describe("selecting entries", () => {
  const manifest = manifestOf(
    ENTRY,
    { ...ENTRY, id: "user-guide.wizard.detection" },
    { ...ENTRY, id: "user-guide.wizard.templates" },
    { ...ENTRY, id: "cli.install" },
  );

  it("takes every entry without --only", () => {
    expect(selectEntries(manifest)).toHaveLength(4);
  });

  it("takes an exact id", () => {
    expect(selectEntries(manifest, "cli.install").map((entry) => entry.id)).toEqual([
      "cli.install",
    ]);
  });

  it("lets * match across dots", () => {
    expect(selectEntries(manifest, "home.*").map((entry) => entry.id)).toEqual(["home.dashboard"]);
    expect(selectEntries(manifest, "*.wizard.*")).toHaveLength(2);
  });

  it("treats the dot as a dot, not as any character", () => {
    expect(idMatcher("home.dashboard")("homeXdashboard")).toBe(false);
  });

  it("refuses a pattern that matches nothing, listing what exists", () => {
    expect(() => selectEntries(manifest, "admin.*")).toThrow(
      /matches no manifest entry.*cli\.install/,
    );
  });
});

describe("outputPath", () => {
  it("writes <section>/<slug>.<theme>.png under static/img/screenshots", () => {
    expect(outputPath("home.dashboard", "light")).toBe(
      join(OUTPUT_DIR, "home", "dashboard.light.png"),
    );
    expect(OUTPUT_DIR.endsWith(join("static", "img", "screenshots"))).toBe(true);
  });

  it("keeps a dotted slug's dots", () => {
    expect(outputPath("user-guide.wizard.detection", "dark", "/out")).toBe(
      join("/out", "user-guide", "wizard.detection.dark.png"),
    );
  });
});

describe("captureInstant", () => {
  it("uses the manifest's clock when pinned", () => {
    expect(captureInstant({ clock: "2026-10-08T09:30:00Z", entries: [] }).toISOString()).toBe(
      "2026-10-08T09:30:00.000Z",
    );
  });

  it("otherwise freezes to the start of the current hour, so runs in one hour agree", () => {
    const at = (iso: string) => captureInstant(manifestOf(), new Date(iso)).toISOString();
    expect(at("2026-10-08T14:07:31.250Z")).toBe("2026-10-08T14:00:00.000Z");
    expect(at("2026-10-08T14:59:59.999Z")).toBe("2026-10-08T14:00:00.000Z");
  });
});

describe("readyTimeoutMessage", () => {
  it("names the entry, theme, route and selector", () => {
    expect(readyTimeoutMessage(ENTRY, "dark", 20_000)).toBe(
      'home.dashboard (dark): ready selector "text=Mission Control" did not appear on /dashboard within 20000 ms',
    );
  });
});
