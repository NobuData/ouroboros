import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { checkWording, parseAllowList, type AllowEntry } from "../scripts/loop-wording.ts";

/** The module directory (`ouroboros-docs/`). */
const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The committed allow-list. */
const ALLOW_FILE = join(MODULE_DIR, "loop-wording.allow.json");

/**
 * Runs the guard's command line.
 *
 * @param args the arguments after the script name.
 * @returns the exit status and output.
 */
function runGuard(...args: string[]) {
  return spawnSync(process.execPath, ["scripts/check-loop-wording.ts", ...args], {
    cwd: MODULE_DIR,
    encoding: "utf8",
  });
}

/** One entry allowing the simulator's label on one page. */
const LABEL: AllowEntry = { text: "**Simulated**", files: ["a.mdx"], reason: "the origin label" };

describe("checkWording", () => {
  it("passes an occurrence inside an allowed phrase on its page", () => {
    const pages = new Map([["a.mdx", "Labelled **Simulated** in words."]]);
    expect(checkWording(pages, [LABEL])).toEqual({ occurrences: [], stale: [] });
  });

  it("fails an occurrence on a page the phrase is not allowed on", () => {
    const pages = new Map([
      ["a.mdx", "Labelled **Simulated**."],
      ["b.mdx", "Labelled **Simulated**."],
    ]);
    expect(checkWording(pages, [LABEL]).occurrences).toEqual([
      { file: "b.mdx", line: 1, text: "Labelled **Simulated**." },
    ]);
  });

  it("fails a second occurrence on a line whose first is allowed", () => {
    const pages = new Map([["a.mdx", "Labelled **Simulated** — and the loop is simulated."]]);
    expect(checkWording(pages, [LABEL]).occurrences).toHaveLength(1);
  });

  it("matches the word in any case and reports its line", () => {
    const pages = new Map([["a.mdx", "**Simulated**\n\nSIMULATED builds."]]);
    expect(checkWording(pages, [LABEL]).occurrences).toEqual([
      { file: "a.mdx", line: 3, text: "SIMULATED builds." },
    ]);
  });

  it("reports an entry that matches nothing on one of its pages as stale", () => {
    const entry = { ...LABEL, files: ["a.mdx", "b.mdx"] };
    const pages = new Map([
      ["a.mdx", "**Simulated**"],
      ["b.mdx", "Nothing here."],
    ]);
    expect(checkWording(pages, [entry]).stale).toEqual(["b.mdx: **Simulated**"]);
  });

  it("leaves other words alone", () => {
    const pages = new Map([["a.mdx", "Simulate routing, the run simulator, a simulation."]]);
    expect(checkWording(pages, [])).toEqual({ occurrences: [], stale: [] });
  });
});

describe("parseAllowList", () => {
  it("reads the committed allow-list, every entry with a reason", () => {
    const entries = parseAllowList(readFileSync(ALLOW_FILE, "utf8"));
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e.reason.trim()).not.toBe("");
  });

  it.each([
    ["no entries array", "{}"],
    ["an entry with no reason", '{"entries":[{"text":"simulated","files":["a.mdx"]}]}'],
    ["an entry with no files", '{"entries":[{"text":"simulated","files":[],"reason":"r"}]}'],
    ["a phrase without the word", '{"entries":[{"text":"draft","files":["a.mdx"],"reason":"r"}]}'],
  ])("refuses %s", (_name, raw) => {
    expect(() => parseAllowList(raw)).toThrow();
  });
});

describe("yarn check:loop-wording", () => {
  it("is green on the committed pages", () => {
    const run = runGuard();
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/every "simulated" is on the allow-list/);
  });

  it("is red on a planted occurrence, naming the page and line", () => {
    const docs = mkdtempSync(join(tmpdir(), "loop-wording-"));
    cpSync(join(MODULE_DIR, "docs"), docs, { recursive: true });
    const page = join(docs, "user-guide", "dashboard.mdx");
    writeFileSync(page, `${readFileSync(page, "utf8")}\nEvery loop here is simulated.\n`);
    const run = runGuard("--docs", docs);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/docs\/user-guide\/dashboard\.mdx:\d+ says "simulated": Every loop here is simulated\./);
    expect(run.stderr).toMatch(/loop-wording\.allow\.json/);
  });

  it("is red on a stale allow-list entry", () => {
    const allow = join(mkdtempSync(join(tmpdir(), "loop-wording-")), "allow.json");
    const list = JSON.parse(readFileSync(ALLOW_FILE, "utf8")) as { entries: AllowEntry[] };
    list.entries.push({ text: "a simulated phrase no page has", files: ["user-guide/glossary.mdx"], reason: "r" });
    writeFileSync(allow, JSON.stringify(list));
    const run = runGuard("--allow", allow);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/stale allow-list entry/);
  });

  it("exits two on a malformed allow-list", () => {
    const allow = join(mkdtempSync(join(tmpdir(), "loop-wording-")), "allow.json");
    writeFileSync(allow, "{}");
    expect(runGuard("--allow", allow).status).toBe(2);
  });
});
