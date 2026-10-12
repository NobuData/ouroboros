import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The dry-run card's sheet (CE.4, #568): every class it declares is rendered and every class
 * rendered is declared, a row is mockup 20's `.res-row`, the `how` label has its own treatment
 * and a skip wears the warning hue, the callout's glow is built from the accent's own tokens and
 * is the only glow in the sheet, a guard violation cannot be mistaken for a failure, the diff
 * scrolls inside its own bounded wrapper, and **both themes** and **the 125% font-size step**
 * hold because every value it reads is a token or a rem.
 *
 * jsdom applies no stylesheet, so the render suite proves the markup is identical in both
 * palettes and this suite proves the palettes are what the sheet reads.
 */

const UI = join(import.meta.dirname, "..", "..", "..");
const COPILOT_DIR = join(UI, "app", "workflows", "copilot");

/** The sheet without its prose, so a rule cannot be found inside a comment. */
const CODE = readFileSync(join(COPILOT_DIR, "dry-run.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

/** The modules that draw the sheet's classes. */
const MODULES = ["dry-run-card.tsx", "dry-run-suggestions.tsx"]
  .map((name) => readFileSync(join(COPILOT_DIR, name), "utf8"))
  .join("\n");

/**
 * One rule's declarations.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""`.
 */
function rule(selector: string): string {
  return new RegExp(`(?<![,\\w-]\\s*)${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

const DECLARED = new Set([...CODE.matchAll(/\.(copilot-dry[a-z0-9_-]*)/g)].map((match) => match[1]));
const RENDERED = new Set([...MODULES.matchAll(/"(copilot-dry[a-z0-9_-]*)"/g)].map((match) => match[1]));

describe("the sheet and the modules", () => {
  it("renders every class the sheet declares", () => {
    expect(DECLARED.size).toBeGreaterThan(0);
    expect([...DECLARED].filter((name) => !RENDERED.has(name))).toEqual([]);
  });

  it("declares every class the modules render", () => {
    expect([...RENDERED].filter((name) => !DECLARED.has(name))).toEqual([]);
  });

  it("builds no class name from a template — each is a literal the two lists can see", () => {
    expect(MODULES).not.toMatch(/`[^`]*copilot-dry[^`]*\$\{/);
    expect(MODULES).not.toMatch(/"[^"]*copilot-dry[a-z0-9_-]* [^"]*"/);
  });

  it("styles no primitive of the design system, none of the studio's classes, and none of its neighbours'", () => {
    expect(CODE).not.toContain(".ou-");
    expect(CODE).not.toMatch(/\.studio|\.shell-|\.copilot-view|\.copilot-chat|\.copilot-stages|\.prv-/);
  });

  it("draws nothing with an inline style", () => {
    expect(MODULES).not.toMatch(/\bstyle=/);
  });
});

describe("a result row", () => {
  it("is mockup 20's: a baseline line over a hairline, none under the last", () => {
    const line = rule("\\.copilot-dry__line");

    expect(line).toMatch(/display:\s*flex/);
    expect(line).toMatch(/align-items:\s*baseline/);
    expect(line).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.copilot-dry__row")).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
    expect(rule("\\.copilot-dry__row:last-child")).toMatch(/border-bottom:\s*0/);
  });

  it("colours each mark by its verdict: ok, warning, faint, error", () => {
    expect(rule("\\.copilot-dry__mark")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.copilot-dry__mark--ok")).toMatch(/color:\s*var\(--ok\)/);
    expect(rule("\\.copilot-dry__mark--warn")).toMatch(/color:\s*var\(--warn\)/);
    expect(rule("\\.copilot-dry__mark--idle")).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rule("\\.copilot-dry__mark--err")).toMatch(/color:\s*var\(--err\)/);
  });

  it("sets the stage in full ink on one line, and the note in muted mono at the trailing edge", () => {
    expect(rule("\\.copilot-dry__stage")).toMatch(/color:\s*var\(--ink\)/);
    expect(rule("\\.copilot-dry__stage")).toMatch(/font-weight:\s*600/);
    expect(rule("\\.copilot-dry__stage")).toMatch(/white-space:\s*nowrap/);

    const note = rule("\\.copilot-dry__note");
    expect(note).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(note).toMatch(/color:\s*var\(--ink-mut\)/);
    expect(note).toMatch(/margin-left:\s*auto/);
    expect(note).toMatch(/text-align:\s*right/);
  });

  it("gives the `how` label its own treatment — mono, never the faint ink — and a skip the warning hue", () => {
    const how = rule("\\.copilot-dry__how");

    expect(how).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(how).toMatch(/color:\s*var\(--ink-mut\)/);
    expect(how).not.toMatch(/--ink-faint/);
    expect(how).toMatch(/white-space:\s*nowrap/);
    expect(rule("\\.copilot-dry__how--warn")).toMatch(/color:\s*var\(--warn\)/);
    expect(rule("\\.copilot-dry__note--warn")).toMatch(/color:\s*var\(--warn\)/);
  });

  it("opens a row's provenance in the flow, and hides it when closed", () => {
    expect(CODE).toMatch(/\.copilot-dry__provenance,\s*\.copilot-dry__basis\s*\{[^}]*border-left:\s*3px solid var\(--accent\)/);
    expect(CODE).toMatch(/\.copilot-dry__provenance\[hidden\],\s*\.copilot-dry__basis\[hidden\]\s*\{[^}]*display:\s*none/);
  });

  it("draws the info control as the quiet mark it is", () => {
    const info = rule("\\.copilot-dry__info");

    expect(info).toMatch(/border:\s*0/);
    expect(info).toMatch(/background:\s*none/);
    expect(info).toMatch(/cursor:\s*pointer/);
  });

  it("is the containing block for its own visually hidden text, as the card is for the rest", () => {
    expect(rule("\\.copilot-dry__row")).toMatch(/position:\s*relative/);
    expect(rule("\\.copilot-dry")).toMatch(/position:\s*relative/);
  });
});

describe("the suggestion callout", () => {
  it("is mockup 20's `.suggest`: an accent rim, an accent wash and the accent's glow — all tokens", () => {
    const suggest = rule("\\.copilot-dry__suggest");

    expect(suggest).toMatch(/border:\s*1px solid var\(--accent-line\)/);
    expect(suggest).toMatch(/background:\s*linear-gradient\(180deg, var\(--accent-tint\), var\(--accent-wash\)\)/);
    expect(suggest).toMatch(/box-shadow:\s*0 0 [\d.]+rem -[\d.]+rem var\(--accent-glow\)/);
    expect(rule("\\.copilot-dry__spark")).toMatch(/color:\s*var\(--accent\)/);
    expect(rule("\\.copilot-dry__spark")).toMatch(/text-shadow:[^;]*var\(--accent-glow\)/);
  });

  it("is the only thing in the sheet that glows", () => {
    expect([...CODE.matchAll(/box-shadow:/g)]).toHaveLength(1);
    expect([...CODE.matchAll(/--accent-glow/g)]).toHaveLength(2);
  });

  it("draws the confidence as a control in the accent, and the model's label dashed in the model's hue", () => {
    const confidence = rule("\\.copilot-dry__confidence");

    expect(confidence).toMatch(/color:\s*var\(--accent\)/);
    expect(confidence).toMatch(/cursor:\s*pointer/);
    expect(rule("\\.copilot-dry__llm")).toMatch(/border:\s*1px dashed var\(--model\)/);
    expect(rule("\\.copilot-dry__llm")).toMatch(/color:\s*var\(--model\)/);
  });

  it("keeps a settled suggestion quiet: faint mono, no rim, no wash", () => {
    const line = rule("\\.copilot-dry__resolved-line");

    expect(line).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(line).not.toMatch(/border|background|shadow/);
  });
});

describe("how a run ended", () => {
  it("draws a failure and a refusal on the error tint, a budget stop on the warning one", () => {
    expect(CODE).toMatch(/\.copilot-dry__state--err,\s*\.copilot-dry__refusal\s*\{[^}]*background:\s*var\(--err-tint\)/);
    expect(rule("\\.copilot-dry__state--warn")).toMatch(/background:\s*var\(--warn-tint\)/);
    expect(rule("\\.copilot-dry__state--warn")).toMatch(/border-left-color:\s*var\(--warn\)/);
  });

  it("draws a guard violation louder than any of them: a full error rim, a heavier rule, an error heading", () => {
    const guard = rule("\\.copilot-dry__guard");

    expect(guard).toMatch(/border:\s*1px solid var\(--err\)/);
    expect(guard).toMatch(/border-left:\s*0\.375rem solid var\(--err\)/);
    expect(guard).toMatch(/background:\s*var\(--err-tint\)/);
    expect(rule("\\.copilot-dry__guard \\.copilot-dry__state-title")).toMatch(/color:\s*var\(--err\)/);
    // An ordinary failure's rim is the 35% line, never the full hue.
    expect(CODE).toMatch(/\.copilot-dry__state--err,\s*\.copilot-dry__refusal\s*\{[^}]*border-color:\s*var\(--err-line\)/);
  });
});

describe("the simulated diff", () => {
  it("is the shared diff treatment: the inset well, mono, and tinted added and removed lines", () => {
    expect(rule("\\.copilot-dry__diff")).toMatch(/background:\s*var\(--inset\)/);
    expect(rule("\\.copilot-dry__diff-block")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.copilot-dry__diff-block")).toMatch(/line-height:\s*var\(--lh-loose\)/);
    expect(rule("\\.copilot-dry__diff-line")).toMatch(/white-space:\s*pre/);
    expect(rule("\\.copilot-dry__diff-line--add")).toMatch(/background:\s*var\(--ok-tint\)/);
    expect(rule("\\.copilot-dry__diff-line--add")).toMatch(/color:\s*var\(--ok\)/);
    expect(rule("\\.copilot-dry__diff-line--del")).toMatch(/background:\s*var\(--err-tint\)/);
    expect(rule("\\.copilot-dry__diff-line--del")).toMatch(/color:\s*var\(--err\)/);
  });

  it("puts what it is inside the block, in the accent", () => {
    expect(rule("\\.copilot-dry__diff-what")).toMatch(/color:\s*var\(--accent\)/);
    expect(rule("\\.copilot-dry__diff-head")).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
  });

  it("scrolls inside its own wrapper, bounded in rem so it grows with the type, and shows its focus", () => {
    const scroll = rule("\\.copilot-dry__diff-scroll");

    expect(scroll).toMatch(/overflow:\s*auto/);
    expect(scroll).toMatch(/max-block-size:\s*[\d.]+rem/);
    expect(scroll).toMatch(/overscroll-behavior:\s*contain/);
    expect(rule("\\.copilot-dry__diff-scroll:focus-visible")).toMatch(/outline:\s*1px solid var\(--accent\)/);
  });

  it("lets only the diff and an operation's raw params scroll; a long note wraps instead", () => {
    expect([...CODE.matchAll(/overflow(?:-[xy])?:\s*(?:auto|scroll)/g)]).toHaveLength(2);
    expect(rule("\\.copilot-dry__op-params")).toMatch(/overflow:\s*auto/);
    expect(rule("\\.copilot-dry__op-params")).toMatch(/max-block-size:\s*[\d.]+rem/);
    expect(rule("\\.copilot-dry__note")).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe("the flow", () => {
  it("pins nothing to the viewport and takes nothing out of the flow", () => {
    expect(CODE).not.toMatch(/position:\s*(?:fixed|sticky|absolute)/);
  });

  it("animates nothing", () => {
    expect(CODE).not.toMatch(/animation:|transition:|@keyframes/);
  });
});

describe("tokens and the type scale", () => {
  it("names no colour literal — every hue is a token both palettes define", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("takes every font size from the sheet's scale, so the reader's preference scales the surface", () => {
    expect(CODE).not.toMatch(/font-size:\s*[\d.]+px/);
    for (const [, value] of CODE.matchAll(/font-size:\s*([^;]+);/g)) {
      expect(value.trim()).toMatch(/^var\(--t-/);
    }
  });

  it("keeps every other length on a token or a rem, hairlines, rules and rings excepted", () => {
    for (const [declaration] of CODE.matchAll(/[\w-]+:[^;{}]*?\b[\d.]+px/g)) {
      expect(declaration).toMatch(/^(border|outline)/);
    }
    expect(CODE).not.toMatch(/\b2px\b/);
    expect(CODE).not.toMatch(/[\d.]em\b/);
  });

  it("sizes nothing in percentages", () => {
    expect(CODE).not.toMatch(/\d%/);
  });

  it("fixes no height a larger type could be clipped by", () => {
    expect(CODE).not.toMatch(/(?:^|[;{\s])(?:height|max-height|block-size):/);
  });
});
