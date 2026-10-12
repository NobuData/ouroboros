import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The conversation card's sheet (CE.2, #566): every class it declares is rendered and every class
 * rendered is declared, the two bubbles are mockup 20's treatments, the messages scroll inside
 * their own bounded wrapper and nothing else does, and **both themes** and **the 125% font-size
 * step** hold because every value it reads is a token or a rem.
 *
 * jsdom applies no stylesheet, so the render suite proves the markup is identical in both
 * palettes and this suite proves the palettes are what the sheet reads.
 */

const UI = join(import.meta.dirname, "..", "..", "..");
const COPILOT_DIR = join(UI, "app", "workflows", "copilot");

/** The sheet without its prose, so a rule cannot be found inside a comment. */
const CODE = readFileSync(join(COPILOT_DIR, "conversation.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

/** The modules that draw the sheet's classes. */
const MODULES = ["conversation-card.tsx", "conversation-parts.tsx"]
  .map((name) => readFileSync(join(COPILOT_DIR, name), "utf8"))
  .join("\n");

/**
 * One rule's declarations.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""`.
 */
function rule(selector: string): string {
  return new RegExp(`(?<!,\\s*)${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

const DECLARED = new Set([...CODE.matchAll(/\.(copilot-chat[a-z0-9_-]*)/g)].map((match) => match[1]));
const RENDERED = new Set([...MODULES.matchAll(/"(copilot-chat[a-z0-9_-]*)"/g)].map((match) => match[1]));

describe("the sheet and the modules", () => {
  it("renders every class the sheet declares", () => {
    expect(DECLARED.size).toBeGreaterThan(0);
    expect([...DECLARED].filter((name) => !RENDERED.has(name))).toEqual([]);
  });

  it("declares every class the modules render", () => {
    expect([...RENDERED].filter((name) => !DECLARED.has(name))).toEqual([]);
  });

  it("builds no class name from a template — each is a literal the two lists can see", () => {
    expect(MODULES).not.toMatch(/`[^`]*copilot-chat[^`]*\$\{/);
    expect(MODULES).not.toMatch(/"[^"]*copilot-chat[a-z0-9_-]* [^"]*"/);
  });

  it("styles no primitive of the design system, none of the studio's classes and none of the frame's, from here", () => {
    expect(CODE).not.toContain(".ou-");
    expect(CODE).not.toMatch(/\.studio|\.shell-|\.copilot-view/);
  });

  it("draws nothing with an inline style", () => {
    expect(MODULES).not.toMatch(/\bstyle=/);
  });
});

describe("the bubbles", () => {
  it("puts the person's at the trailing edge in raised, and the copilot's at the leading edge in inset", () => {
    expect(rule("\\.copilot-chat__msg--user")).toMatch(/align-self:\s*flex-end/);
    expect(rule("\\.copilot-chat__msg--bot")).toMatch(/align-self:\s*flex-start/);
    expect(rule("\\.copilot-chat__bubble--user")).toMatch(/background:\s*var\(--raised\)/);
    expect(rule("\\.copilot-chat__bubble--user")).toMatch(/border-color:\s*var\(--line-strong\)/);
    expect(rule("\\.copilot-chat__bubble--bot")).toMatch(/background:\s*var\(--inset\)/);
    expect(rule("\\.copilot-chat__bubble--bot")).toMatch(/color:\s*var\(--ink-dim\)/);
  });

  it("squares the corner nearest the speaker", () => {
    expect(rule("\\.copilot-chat__bubble--user")).toMatch(/border-bottom-right-radius:\s*var\(--r-xs\)/);
    expect(rule("\\.copilot-chat__bubble--bot")).toMatch(/border-bottom-left-radius:\s*var\(--r-xs\)/);
  });

  it("sets the meta line in mono, uppercase and spaced — the copilot's in the accent", () => {
    const meta = rule("\\.copilot-chat__meta");

    expect(meta).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(meta).toMatch(/text-transform:\s*uppercase/);
    expect(meta).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rule("\\.copilot-chat__meta--bot")).toMatch(/color:\s*var\(--accent\)/);
  });

  it("wraps a long token instead of widening the card, keeps the person's own line breaks, and scrolls a code block sideways in itself", () => {
    expect(rule("\\.copilot-chat__bubble")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule("\\.copilot-chat__bubble")).toMatch(/min-width:\s*0/);
    expect(rule("\\.copilot-chat__bubble--user")).toMatch(/white-space:\s*pre-wrap/);
    expect(rule("\\.copilot-chat__pre")).toMatch(/overflow-x:\s*auto/);
  });

  it("draws a bolded word in the full ink", () => {
    expect(rule("\\.copilot-chat__strong")).toMatch(/color:\s*var\(--ink\)/);
  });
});

describe("the chips", () => {
  it("are mono pills, the answered one in the accent's tint", () => {
    const chip = rule("\\.copilot-chat__chip");

    expect(chip).toMatch(/border-radius:\s*var\(--r-pill\)/);
    expect(chip).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.copilot-chat__chip--selected")).toMatch(/color:\s*var\(--accent\)/);
    expect(rule("\\.copilot-chat__chip--selected")).toMatch(/background:\s*var\(--accent-tint\)/);
  });

  it("stop offering to be pressed once they cannot be", () => {
    expect(rule("\\.copilot-chat__chip:disabled")).toMatch(/cursor:\s*default/);
    expect(CODE).toMatch(/\.copilot-chat__chip:hover:enabled/);
    expect(CODE).not.toMatch(/\.copilot-chat__chip:hover\s*\{/);
  });

  it("wrap as a row", () => {
    expect(rule("\\.copilot-chat__choice-row")).toMatch(/flex-wrap:\s*wrap/);
  });
});

describe("the markers", () => {
  it("are quiet: mono, small, in the muted ink", () => {
    const marker = rule("\\.copilot-chat__marker");

    expect(marker).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(marker).toMatch(/font-size:\s*var\(--t-xs\)/);
    expect(marker).toMatch(/color:\s*var\(--ink-mut\)/);
  });

  it("never draw a proposed guard in the ok hue — it is not a protection", () => {
    expect(rule("\\.copilot-chat__marker--proposed")).toMatch(/color:\s*var\(--warn\)/);
    expect(CODE).not.toMatch(/--ok\b/);
  });

  it("draw the disclosure as the quiet line it is, not as a button box", () => {
    const toggle = rule("\\.copilot-chat__trace-toggle");

    expect(toggle).toMatch(/border:\s*0/);
    expect(toggle).toMatch(/background:\s*none/);
    expect(toggle).toMatch(/cursor:\s*pointer/);
  });
});

describe("the endings", () => {
  it("put a failure on the error rule and a close on a neutral one", () => {
    expect(rule("\\.copilot-chat__ending--failed")).toMatch(/border-left:\s*3px solid var\(--err\)/);
    expect(rule("\\.copilot-chat__ending--closed")).toMatch(/border-left:\s*3px solid var\(--line-strong\)/);
    expect(rule("\\.copilot-chat__ending--closed")).not.toMatch(/--err|--warn/);
  });

  it("put the missing prerequisite on the warning rule", () => {
    expect(rule("\\.copilot-chat__notice")).toMatch(/border-left:\s*3px solid var\(--warn\)/);
  });
});

describe("the scroller", () => {
  it("is the one thing that scrolls inside itself, bounded in rem so it grows with the type", () => {
    const scroll = rule("\\.copilot-chat__scroll");

    expect(scroll).toMatch(/overflow-y:\s*auto/);
    expect(scroll).toMatch(/max-block-size:\s*[\d.]+rem/);
    expect(scroll).toMatch(/min-block-size:\s*[\d.]+rem/);
    expect(scroll).toMatch(/overscroll-behavior:\s*contain/);
    expect([...CODE.matchAll(/overflow-y:\s*(?:auto|scroll)/g)]).toHaveLength(1);
    expect(CODE).not.toMatch(/overflow:\s*(?:auto|scroll)/);
  });

  it("pins nothing to the viewport", () => {
    expect(CODE).not.toMatch(/position:\s*(?:fixed|sticky|absolute)/);
  });
});

describe("the composer", () => {
  it("keeps Send at the box's foot, lets the box be dragged taller, and floors it in rem", () => {
    expect(rule("\\.copilot-chat__entry")).toMatch(/align-items:\s*flex-end/);
    expect(rule("\\.copilot-chat__input")).toMatch(/resize:\s*vertical/);
    expect(rule("\\.copilot-chat__input")).toMatch(/min-height:\s*[\d.]+rem/);
  });

  it("shows a switched-off box as switched off", () => {
    expect(rule('\\.copilot-chat__input\\[aria-disabled="true"\\]')).toMatch(/cursor:\s*not-allowed/);
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

  it("keeps every other length on a token or a rem, hairlines and rules excepted", () => {
    for (const [declaration] of CODE.matchAll(/[\w-]+:[^;{}]*?\b[\d.]+px/g)) {
      expect(declaration).toMatch(/^border/);
    }
    expect(CODE).not.toMatch(/\b2px\b/);
  });

  it("sizes nothing in percentages", () => {
    expect(CODE).not.toMatch(/\d%/);
  });

  it("fixes no height a larger type could be clipped by", () => {
    expect(CODE).not.toMatch(/(?:^|[;{\s])(?:height|max-height|block-size):/);
  });
});
