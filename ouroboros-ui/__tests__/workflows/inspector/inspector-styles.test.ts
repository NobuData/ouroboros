import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/workflows/inspector/inspector.css` that are agreements with something
 * outside it (#150): the components that render its classes, the page chrome it sticks under, the
 * mockup's placement, and the studio grid's third track in `workflows.css`.
 *
 * The generic rules — colours only from tokens, no px type sizes — are `__tests__/styles.test.ts`'s
 * and cover this sheet too. **This is where "both themes" is verified** for the panel: jsdom applies
 * no stylesheet, so what proves the palettes legible is that every hue here is a published token.
 */

const UI = join(import.meta.dirname, "..", "..", "..");
const INSPECTOR = join(UI, "app", "workflows", "inspector");
const SHEET = readFileSync(join(INSPECTOR, "inspector.css"), "utf8");
const STUDIO = readFileSync(join(UI, "app", "workflows", "workflows.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

/** Every inspector component, as one source. */
const COMPONENTS = readdirSync(INSPECTOR)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(INSPECTOR, name), "utf8"))
  .join("\n");

/** The sheet without its prose. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * One rule's declarations.
 *
 * @param selector The selector, as a regular expression fragment.
 * @param source The stylesheet to look in.
 * @returns What is between its braces, or `""`.
 */
function rule(selector: string, source = CODE): string {
  return new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? "";
}

/** Every class the sheet declares a rule for. */
const DECLARED = new Set([...CODE.matchAll(/\.(studio-inspector[a-z0-9_-]*)/g)].map((match) => match[1]));

describe("the sheet and the components", () => {
  it("declares a rule for every class it renders, and renders every class it declares", () => {
    const rendered = new Set([...COMPONENTS.matchAll(/"(studio-inspector(?:__[a-z0-9-]+)?)"/g)].map((match) => match[1]));

    expect(rendered.size).toBeGreaterThan(20);
    for (const name of rendered) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
    for (const name of DECLARED) expect(COMPONENTS, `${name} is declared and never rendered`).toContain(name);
  });

  it("restyles none of the #46 primitives the panel is built from", () => {
    expect(CODE).not.toContain(".ou-");
  });
});

describe("placement — sticky, and scrolling in its own wrapper", () => {
  it("sticks under the page's published chrome and never outgrows the viewport", () => {
    const panel = rule("\\.studio-inspector");

    expect(panel).toMatch(/position:\s*sticky/);
    expect(panel).toMatch(/top:\s*calc\(var\(--ou-chrome-subnav, 0rem\) \+ var\(--ou-chrome-bar, 0rem\)/);
    expect(panel).toMatch(/max-height:\s*calc\(100vh/);
    expect(panel).toMatch(/overflow-y:\s*auto/);
  });

  it("stacks static under the canvas at the mockup's break, as `.inspector { position: static }` does", () => {
    expect(CODE).toMatch(/@media \(max-width: 68\.75rem\)\s*\{\s*\.studio-inspector\s*\{[^}]*position:\s*static/);
  });

  it("is the studio grid's 300px third track, with the empty seat spanning canvas and inspector", () => {
    expect(rule("\\.studio__grid", STUDIO)).toMatch(/grid-template-columns:\s*13\.75rem minmax\(0, 1fr\) 18\.75rem/);
    expect(rule("\\.studio__seat", STUDIO)).toMatch(/grid-column:\s*span 2/);
    // One track below the break: a span of two would add a column.
    expect(STUDIO).toMatch(/@media \(max-width: 68\.75rem\)\s*\{[\s\S]*?\.studio__seat\s*\{\s*grid-column:\s*auto/);
  });
});

describe("the mockup's treatments, from tokens", () => {
  it("draws the type line and every placeholder in the model hue", () => {
    expect(rule("\\.studio-inspector__type")).toContain("var(--model)");
    expect(rule("\\.studio-inspector__variable")).toContain("var(--model)");
    expect(rule("\\.studio-inspector__token")).toContain("var(--model)");
  });

  it("draws the chosen mode segment and the checked routing row in the accent", () => {
    expect(rule("\\.studio-inspector__seg-option--on")).toContain("var(--accent)");
    expect(rule("\\.studio-inspector__radio-row--checked")).toContain("var(--accent-line)");
  });

  it("warns in the warn hue, errs in the error hue, and draws the P9 note as neither", () => {
    expect(rule("\\.studio-inspector__warning")).toContain("var(--warn)");
    expect(rule("\\.studio-inspector__error")).toContain("var(--err)");
    expect(rule("\\.studio-inspector__declared")).not.toMatch(/var\(--(err|warn)\)/);
  });

  it("stacks the textarea exactly over its highlight layer, in one font and one wrapping rule", () => {
    const shared = rule("\\.studio-inspector__highlight,\\s*\\.studio-inspector__template");

    expect(shared).toMatch(/grid-area:\s*1 \/ 1/);
    expect(shared).toContain("var(--f-mono)");
    expect(shared).toMatch(/white-space:\s*pre-wrap/);
    // The textarea's own rule — the one after a closing brace, not the shared rule above it.
    const template = rule("\\}\\s*\\.studio-inspector__template");
    expect(template).toMatch(/(?:^|\s)color:\s*transparent/);
    expect(template).toContain("caret-color: var(--ink)");
  });

  it("keeps the radio a focusable control while the segment is its label", () => {
    expect(rule("\\.studio-inspector__seg-input")).toMatch(/opacity:\s*0/);
    expect(rule("\\.studio-inspector__seg-input")).not.toMatch(/display:\s*none/);
    expect(CODE).toMatch(/\.studio-inspector__seg-option:has\(\.studio-inspector__seg-input:focus-visible\)/);
  });

  it("takes every colour from a token", () => {
    const colours = [...CODE.matchAll(/(?:^|[;{\s])(?:color|background|border-color):\s*([^;]+);/g)];

    expect(colours.length).toBeGreaterThan(10);
    for (const [, value] of colours) expect(value.trim(), value).toMatch(/var\(--|transparent|currentColor|inherit/);
  });

  it("sizes type from the token scale only", () => {
    for (const [, value] of CODE.matchAll(/font-size:\s*([^;]+);/g)) expect(value).toMatch(/^var\(--t-/);
  });
});
