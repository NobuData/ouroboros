import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The status bar's sheet and the flow notice's (V.6, #174): every class each declares is rendered and every
 * class rendered is declared; mockup 05's `.statusbar` treatment — the raised ground under a hairline, mono,
 * the sync word in the accent, the right cluster at the trailing edge in the faint ink — is on the tokens it
 * names; and **both themes** hold because every value either sheet reads is a token.
 *
 * jsdom applies no stylesheet, so `code-flows-flow.test.tsx` proves the markup is identical in both palettes
 * and this suite proves the palettes are what the sheets read.
 */

const CODE_DIR = join(import.meta.dirname, "..", "..", "..", "app", "workflows", "code");
const MOCKUP = join(import.meta.dirname, "..", "..", "..", "..", "docs", "mockups", "05-workflow-code.html");

/**
 * A sheet without its prose, so a rule cannot be found inside a comment.
 *
 * @param path The sheet.
 * @returns Its rules.
 */
function sheet(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * One rule's declarations.
 *
 * @param css The sheet.
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""`.
 */
function rule(css: string, selector: string): string {
  return new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

/**
 * The classes a sheet declares and a module renders, under one prefix.
 *
 * @param css The sheet.
 * @param module The module's source.
 * @param prefix The prefix the sheet owns.
 * @returns Both sets.
 */
function classes(css: string, module: string, prefix: string) {
  const owned = new RegExp(`^${prefix}`);
  const declared = new Set([...css.matchAll(new RegExp(`\\.(${prefix}[a-z0-9_-]*)`, "g"))].map((match) => match[1]));
  const rendered = new Set(
    [...module.matchAll(/"([^"\n]*)"/g)]
      .flatMap((match) => (match[1] ?? "").split(/\s+/))
      .filter((name) => owned.test(name)),
  );
  return { declared, rendered };
}

const STATUS = sheet(join(CODE_DIR, "code-status-bar.css"));
const FLOWS = sheet(join(CODE_DIR, "code-flows.css"));
const STATUS_MODULE = readFileSync(join(CODE_DIR, "code-status-bar.tsx"), "utf8");
const FLOWS_MODULE = readFileSync(join(CODE_DIR, "code-flows-view.tsx"), "utf8");

describe.each([
  ["the status bar", STATUS, STATUS_MODULE, "code-status"],
  ["the flow notice", FLOWS, FLOWS_MODULE, "code-flows"],
])("%s's sheet and module", (_name, css, module, prefix) => {
  const { declared, rendered } = classes(css, module, prefix);

  it("renders every class the sheet declares", () => {
    expect(declared.size).toBeGreaterThan(0);
    expect([...declared].filter((name) => !rendered.has(name))).toEqual([]);
  });

  it("declares every class the module renders", () => {
    expect([...rendered].filter((name) => !declared.has(name))).toEqual([]);
  });
});

describe("mockup 05's status bar", () => {
  it("is the mockup's strip: the raised ground under a hairline rule, in mono and the muted ink", () => {
    const strip = rule(STATUS, "\\.code-status");

    expect(strip).toMatch(/background:\s*var\(--raised\)/);
    expect(strip).toMatch(/border-block-start:\s*1px solid var\(--line\)/);
    expect(strip).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(strip).toMatch(/color:\s*var\(--ink-mut\)/);
    expect(strip).toMatch(/flex-wrap:\s*wrap/);
  });

  it("draws the sync word in the accent, as the mockup's `.sync` is", () => {
    expect(readFileSync(MOCKUP, "utf8")).toMatch(/\.statusbar \.sync\s*\{\s*color:\s*var\(--accent\)/);
    expect(rule(STATUS, "\\.code-status__sync--synced")).toMatch(/color:\s*var\(--accent\)/);
  });

  it("draws a state that is not synced in the status hue for the same fact", () => {
    expect(rule(STATUS, "\\.code-status__sync--err")).toMatch(/color:\s*var\(--err\)/);
    expect(rule(STATUS, "\\.code-status__sync--warn")).toMatch(/color:\s*var\(--warn\)/);
  });

  it("pushes the right cluster to the trailing edge, in the faint ink, on one line", () => {
    const right = rule(STATUS, "\\.code-status__right");

    expect(right).toMatch(/margin-inline-start:\s*auto/);
    expect(right).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(right).toMatch(/white-space:\s*nowrap/);
  });
});

describe("the flow notice", () => {
  it("puts a stopped flow on the error line and tint", () => {
    const stopped = rule(FLOWS, "\\.studio-toast\\.code-flows__notice--err");

    expect(stopped).toMatch(/border-color:\s*var\(--err-line\)/);
    expect(stopped).toMatch(/background:\s*var\(--err-tint\)/);
  });
});

describe.each([
  ["the status bar", STATUS],
  ["the flow notice", FLOWS],
])("%s's tokens and type scale", (_name, css) => {
  it("names no colour literal — every hue is a token both palettes define", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("takes every font size from the sheet's scale", () => {
    for (const [, value] of css.matchAll(/font-size:\s*([^;]+);/g)) expect(value?.trim()).toMatch(/^var\(--t-/);
  });

  it("keeps every other length on a token or a rem — hairlines excepted", () => {
    for (const [declaration] of css.matchAll(/[\w-]+:[^;{}]*?\b[\d.]+px/g)) {
      expect(declaration).toMatch(/^border/);
    }
  });
});
