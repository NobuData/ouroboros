import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/analyzer/analyzer.css` that are agreements with something outside it
 * (#516): the sheet and the components name the same classes, every length scales and every hue
 * is a token — what *both themes* and *CQ.1's rem type* can be verified as, since jsdom applies no
 * stylesheet — and the page adds no chrome to the shell. Since #517 it also dresses the duration
 * chart's card and the Details sheet behind each chip, since #518 the two suggestion cards with
 * the surfaces their rows open, and since #519 the drafted-tickets card in the side column.
 */

const ANALYZER = join(import.meta.dirname, "..", "..", "app", "analyzer");
const SHEET = readFileSync(join(ANALYZER, "analyzer.css"), "utf8");

/** Every component in the directory, as one source. */
const COMPONENT = readdirSync(ANALYZER)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(ANALYZER, name), "utf8"))
  .join("\n");

/** The sheet without its prose. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * One rule's declarations — the first rule with exactly this selector.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""` when there is no such rule.
 */
function rule(selector: string): string {
  return new RegExp(`(?:^|\\}|\\s)(?<!,\\s*)${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

/** Every page class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.(analyzer[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every page class a component renders — a quoted string made only of page classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:analyzer[a-z0-9_-]*\s*)+)"/g)]
    .flatMap((match) => match[1]!.trim().split(/\s+/))
    .filter((name) => name.startsWith("analyzer")),
);

describe("the sheet and the components", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });

  it("leaves the card, buttons and tags to the design system", () => {
    expect(CODE).not.toMatch(/\.ou-/);
  });

  it("adds no fixed or sticky chrome to the shell", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky)/);
  });
});

describe("scaling and theming", () => {
  it("writes every length as a token, a rem, a ch or a hairline", () => {
    const lengths = [...CODE.matchAll(/(-?\d*\.?\d+)(px|em|rem|ch|vw|vh|%)(?![\w-])/g)];

    for (const [value, , unit] of lengths) {
      if (unit === "px") expect(value, "only a 1px hairline may be px").toBe("1px");
      else if (unit === "%") expect(value).toBe("100%");
      else if (unit === "vw") expect(value, "the popover's ceiling on a narrow screen").toBe("80vw");
      else expect(["rem", "ch"]).toContain(unit);
    }
  });

  it("sets every type size through a token, so the 125% step moves all of it", () => {
    const sizes = [...CODE.matchAll(/font-size:\s*([^;]+);/g)];

    expect(sizes.length).toBeGreaterThan(0);
    for (const [, value] of sizes) expect(value).toMatch(/^var\(--t-/);
  });

  it("names no colour except through a token, so both palettes are one sheet", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });

  it("lets the computed headline wrap between the actions, not under them", () => {
    expect(rule("\\.analyzer__head")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.analyzer__headings")).toMatch(/min-width:\s*[\d.]+rem/);
    expect(rule("\\.analyzer__title")).toMatch(/font-size:\s*var\(--t-2xl\)/);
  });
});

describe("the meta strip", () => {
  it("draws the mockup's faint uppercase mono labels and dim mono values", () => {
    expect(rule("\\.analyzer-strip__label")).toMatch(/text-transform:\s*uppercase/);
    expect(rule("\\.analyzer-strip__label")).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rule("\\.analyzer-strip__value")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.analyzer-strip__value")).toMatch(/color:\s*var\(--ink-dim\)/);
  });

  it("wraps the strip's slots on a narrow pane rather than scrolling it", () => {
    expect(rule("\\.analyzer-strip__row")).toMatch(/flex-wrap:\s*wrap/);
    expect(CODE).not.toMatch(/overflow(-x)?:\s*(auto|scroll)/);
  });

  it("draws a model pill only in the model hue — the one a deterministic run never shows", () => {
    expect(rule("\\.analyzer-strip__model")).toMatch(/color:\s*var\(--model\)/);
    expect(COMPONENT).toContain('"analyzer-strip__model"');
  });

  it("opens each popover over the page, positioned by its own value, as prose", () => {
    expect(rule("\\.analyzer-pop")).toMatch(/position:\s*relative/);
    expect(rule("\\.analyzer-pop__panel")).toMatch(/position:\s*absolute/);
    expect(rule("\\.analyzer-pop__panel")).toMatch(/text-transform:\s*none/);
  });
});

describe("run progress", () => {
  it("tells budget_exceeded (a warning: findings kept) from failed (an error) by hue", () => {
    expect(rule("\\.analyzer-progress__status--budget")).toMatch(/color:\s*var\(--warn\)/);
    expect(rule("\\.analyzer-progress__status--failed")).toMatch(/color:\s*var\(--err\)/);
    expect(rule("\\.analyzer-progress__status--complete")).toMatch(/color:\s*var\(--ok\)/);
  });
});

describe("the duration chart's card (#517)", () => {
  it("takes the mockup's main column — eight of twelve — and the whole row on a narrower pane", () => {
    expect(rule("\\.analyzer__main")).toMatch(/grid-column:\s*span 8/);
    expect(rule("\\.analyzer__main")).toMatch(/min-width:\s*0/);
    expect(CODE).toMatch(/@media \(max-width: [\d.]+rem\)\s*\{\s*\.analyzer__main\s*\{\s*grid-column:\s*span 12/);
  });

  it("leaves the scrolling to the chart's own wrapper — the card scrolls nothing itself", () => {
    // `app/charts/charts.css` owns `.chart-scroll`; this sheet must never scroll the pane's content.
    expect(CODE).not.toMatch(/overflow(-x)?:\s*(auto|scroll)/);
    expect(rule("\\.analyzer-duration")).toMatch(/min-width:\s*0/);
    expect(COMPONENT).toContain('from "@/app/charts"');
  });

  it("draws the mockup's faint caption, and holds the chart's shape while it is unread", () => {
    expect(rule("\\.analyzer-duration__caption")).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rule("\\.analyzer-duration__caption")).toMatch(/font-size:\s*var\(--t-xs\)/);
    expect(rule("\\.analyzer-duration__skeleton")).toMatch(/aspect-ratio:\s*640 \/ \d+/);
  });
});

describe("the change-point Details sheet (#517)", () => {
  it("tints the delta by its sign with the same tokens the chip uses", () => {
    expect(rule("\\.analyzer-cp__delta--warn")).toMatch(/color:\s*var\(--warn\)/);
    expect(rule("\\.analyzer-cp__delta--ok")).toMatch(/color:\s*var\(--ok\)/);
  });

  it("sets a candidate's rank, name and score on one line and its detail under them", () => {
    expect(rule("\\.analyzer-cp__candidate")).toMatch(/display:\s*grid/);
    expect(rule("\\.analyzer-cp__meta")).toMatch(/grid-column:\s*2 \/ -1/);
    expect(rule("\\.analyzer-cp__score")).toMatch(/font-family:\s*var\(--f-mono\)/);
  });

  it("wraps a long candidate name, a sha and a method rather than widening the sheet", () => {
    for (const selector of ["\\.analyzer-cp__name", "\\.analyzer-cp__mono", "\\.analyzer-ev__ref"]) {
      expect(rule(selector), selector).toMatch(/overflow-wrap:\s*anywhere/);
    }
  });

  it("draws an evidence link in the accent — a destination, not decoration", () => {
    expect(rule("\\.analyzer-ev__link")).toMatch(/color:\s*var\(--accent\)/);
  });
});

describe("the suggestion cards (#518)", () => {
  it("draws the mockup's row: a padded row on a hairline, a mono evidence line, a faint label", () => {
    expect(rule("\\.analyzer-sugg__row \\+ \\.analyzer-sugg__row")).toMatch(/border-top:\s*1px solid var\(--line\)/);
    expect(rule("\\.analyzer-sugg__evidence")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.analyzer-sugg__evidence")).toMatch(/color:\s*var\(--ink-mut\)/);
    expect(rule("\\.analyzer-sugg__label")).toMatch(/text-transform:\s*uppercase/);
    expect(rule("\\.analyzer-sugg__label")).toMatch(/color:\s*var\(--ink-faint\)/);
  });

  it("sets a row's title in the body face, as the mockup does — it is a heading, not a headline", () => {
    expect(rule("\\.analyzer-sugg__title")).toMatch(/font-family:\s*var\(--f-ui\)/);
    expect(rule("\\.analyzer-sugg__title")).toMatch(/font-weight:\s*600/);
  });

  it("pushes a row's controls right and lets the foot wrap, rather than scrolling the card", () => {
    expect(rule("\\.analyzer-sugg__foot")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.analyzer-sugg__actions")).toMatch(/margin-left:\s*auto/);
    expect(rule("\\.analyzer-sugg__actions")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.analyzer-sugg")).toMatch(/min-width:\s*0/);
  });

  it("draws `conf NN%` as the mockup's faint mono — and as a control, since it opens its scoring", () => {
    expect(rule("\\.analyzer-sugg__conf")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.analyzer-sugg__conf")).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rule("\\.analyzer-sugg__conf")).toMatch(/cursor:\s*pointer/);
    expect(rule("\\.analyzer-sugg__impact")).toMatch(/cursor:\s*pointer/);
  });

  it("takes the pills' tints from the design system's chip, never from this sheet", () => {
    expect(COMPONENT).toContain('cx("ou-chip ou-chip--ok", "analyzer-sugg__impact")');
    expect(rule("\\.analyzer-sugg__impact")).not.toMatch(/color|background|border/);
  });

  it("shows where focus landed when a row resolved under the control that had it", () => {
    expect(rule("\\.analyzer-sugg__body:focus-visible")).toMatch(/outline:\s*1px solid var\(--accent-line\)/);
  });

  it("gives a resolved row its title back without its weight, and a refusal the error hue", () => {
    expect(rule("\\.analyzer-sugg__title--resolved")).toMatch(/color:\s*var\(--ink-mut\)/);
    expect(rule("\\.analyzer-sugg__refusal")).toMatch(/color:\s*var\(--err\)/);
  });

  it("wraps a long title, evidence line and reason rather than widening the card", () => {
    for (const selector of ["\\.analyzer-sugg__title", "\\.analyzer-sugg__evidence", "\\.analyzer-sugg__reason"]) {
      expect(rule(selector), selector).toMatch(/overflow-wrap:\s*anywhere/);
    }
  });
});

describe("the consequence preview, the dismissal and the spike draft (#518)", () => {
  it("sets the concrete change apart — the sentence a reader can recognise as wrong", () => {
    expect(rule("\\.analyzer-apply__summary")).toMatch(/border:\s*1px solid var\(--accent-line\)/);
    expect(rule("\\.analyzer-apply__summary")).toMatch(/font-weight:\s*600/);
  });

  it("warns, rather than errors, for a preview that moved and a change no plane can take", () => {
    expect(rule("\\.analyzer-apply__moved,\\s*\\.analyzer-apply__blocked")).toMatch(/background:\s*var\(--warn-tint\)/);
    expect(rule("\\.analyzer-apply__error")).toMatch(/color:\s*var\(--err\)/);
  });

  it("draws a payload's identifiers and a draft's delta in mono, wrapping", () => {
    expect(rule("\\.analyzer-apply__value--mono")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.analyzer-apply__delta")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.analyzer-apply__delta")).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("marks a drafted spike as good news, in the ok hue", () => {
    expect(rule("\\.analyzer-spike__done")).toMatch(/border:\s*1px solid var\(--ok-line\)/);
  });
});

describe("a suggestion's Details sheet (#518)", () => {
  it("heads each part with the mockup's faint uppercase mono label", () => {
    expect(rule("\\.analyzer-sd__heading")).toMatch(/text-transform:\s*uppercase/);
    expect(rule("\\.analyzer-sd__heading")).toMatch(/color:\s*var\(--ink-faint\)/);
  });

  it("lays a finding's data out in columns that fold on a narrow sheet", () => {
    expect(rule("\\.analyzer-sd__facts")).toMatch(/grid-template-columns:\s*repeat\(auto-fill, minmax\([\d.]+rem, 1fr\)\)/);
  });

  it("draws its evidence with the list the change-point sheet draws — one treatment, one component", () => {
    expect(COMPONENT.match(/<ul className="analyzer-ev">/g)).toHaveLength(1);
    expect(rule("\\.analyzer-ev__detail")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.analyzer-sd__more")).toMatch(/color:\s*var\(--ink-mut\)/);
  });
});

describe("the drafted-tickets card (#519)", () => {
  it("takes the mockup's side column — four of twelve — and the whole row on a narrower pane", () => {
    expect(rule("\\.analyzer__side")).toMatch(/grid-column:\s*span 4/);
    expect(rule("\\.analyzer__side")).toMatch(/min-width:\s*0/);
    expect(rule("\\.analyzer__side")).toMatch(/flex-direction:\s*column/);
    expect(CODE).toMatch(
      /@media \(max-width: [\d.]+rem\)\s*\{[^@]*\.analyzer__side\s*\{\s*grid-column:\s*span 12/,
    );
  });

  it("scrolls a long batch in the rows' own wrapper — down only, never the pane sideways", () => {
    expect(rule("\\.analyzer-tix__rows")).toMatch(/overflow-y:\s*auto/);
    expect(rule("\\.analyzer-tix__rows")).toMatch(/max-height:\s*[\d.]+rem/);
    expect(CODE).not.toMatch(/overflow(-x)?:\s*(auto|scroll)/);
  });

  it("draws the mockup's row: an accent mono key, a weighted title, a muted mono evidence line", () => {
    expect(rule("\\.analyzer-tix__key")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.analyzer-tix__key")).toMatch(/color:\s*var\(--accent\)/);
    expect(rule("\\.analyzer-tix__title")).toMatch(/font-weight:\s*600/);
    expect(rule("\\.analyzer-tix__evidence")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.analyzer-tix__evidence")).toMatch(/color:\s*var\(--ink-mut\)/);
    expect(rule("\\.analyzer-tix__check")).toMatch(/accent-color:\s*var\(--accent-deep\)/);
  });

  it("lets a long title and a long evidence line wrap inside the narrow column", () => {
    expect(rule("\\.analyzer-tix__main")).toMatch(/min-width:\s*0/);
    expect(rule("\\.analyzer-tix__title")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule("\\.analyzer-tix__evidence")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule("\\.analyzer-tix__actions")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("tells a landed draft from a failed one by hue", () => {
    expect(rule("\\.analyzer-tix__pushed")).toMatch(/color:\s*var\(--ok\)/);
    expect(rule("\\.analyzer-tix__failed")).toMatch(/color:\s*var\(--err\)/);
    expect(rule("\\.analyzer-tix__failure")).toMatch(/color:\s*var\(--err\)/);
  });

  it("takes no room for a toast seat with nothing to say", () => {
    expect(CODE).toMatch(/\.analyzer-toast__seat:empty\s*\{\s*display:\s*none/);
    expect(COMPONENT).toContain('className="analyzer-toast__seat" role="status"');
  });

  it("leaves the checkbox, the chip and the buttons to the platform and the design system", () => {
    expect(COMPONENT).toContain("<EffortChip");
    expect(COMPONENT).toContain('type="checkbox"');
    expect(CODE).not.toMatch(/\.ou-/);
  });
});
