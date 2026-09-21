import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/farm/farm.css` that are agreements with something outside it (#256, and
 * the runners table's, #257). The
 * generic rules — no colour literal outside the token sheet, no px type — are
 * `__tests__/styles.test.ts`'s and stylelint's; what is here is that the sheet and the components
 * name the same classes, that every length scales and every hue is a token (which is what *both
 * themes* and *the 125% font-scale step* can be verified as, since jsdom applies no stylesheet),
 * the mockup's grid, and that the page adds no chrome to the shell.
 */

const FARM = join(import.meta.dirname, "..", "..", "app", "farm");
const SHEET = readFileSync(join(FARM, "farm.css"), "utf8");

/** Every component in the directory, as one source. */
const COMPONENT = readdirSync(FARM)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(FARM, name), "utf8"))
  .join("\n");

/** The sheet without its prose. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * One rule's declarations.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""` when there is no such rule.
 */
function rule(selector: string): string {
  return new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

/** Every page class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.(farm[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every page class a component renders — a quoted string made only of page classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:farm[a-z0-9_-]*\s*)+)"/g)]
    .flatMap((match) => match[1]!.trim().split(/\s+/))
    .filter((name) => name.startsWith("farm")),
);

describe("the sheet and the components", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });

  it("leaves the stat tile to the design system rather than drawing a second one", () => {
    // The acceptance criterion is *via the shared StatCard composition*: a `.farm-stat` here
    // would be the dashboard's tile written twice.
    expect(CODE).not.toMatch(/\.farm-stat|\.ou-stat/);
    expect(COMPONENT).toContain("StatCard");
  });
});

describe("scaling and theming", () => {
  it("writes every length as a token, a rem, a ch or a hairline", () => {
    const lengths = [...CODE.matchAll(/(-?\d*\.?\d+)(px|em|rem|ch|vw|vh|%)/g)];

    for (const [value, , unit] of lengths) {
      if (unit === "px") expect(value, "only a 1px hairline may be px").toBe("1px");
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

  it("lets a headline whose length changes with the fleet wrap between the actions, not under them", () => {
    expect(rule("\\.farm__head")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.farm__headings")).toMatch(/min-width:\s*[\d.]+rem/);
    expect(rule("\\.farm__title")).toMatch(/text-wrap:\s*balance/);
    expect(rule("\\.farm__title")).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });
});

describe("the grid", () => {
  it("is the mockup's twelve columns, with the stat row at four threes", () => {
    expect(rule("\\.farm__grid")).toMatch(/grid-template-columns:\s*repeat\(12,\s*1fr\)/);
    expect(rule("\\.farm-col--3")).toMatch(/grid-column:\s*span 3/);
  });

  it("halves the stat row before it stacks, at the mockup's two widths", () => {
    expect(CODE).toMatch(/@media \(max-width: 68\.75rem\)\s*\{\s*\.farm-col--3\s*\{\s*grid-column:\s*span 6;/);
    expect(CODE).toMatch(/@media \(max-width: 40rem\)\s*\{\s*\.farm__grid > \*\s*\{\s*grid-column:\s*span 12;/);
  });
});

describe("the runners table (#257)", () => {
  it("takes the mockup's eight columns, and the full row once the pane narrows", () => {
    expect(rule("\\.farm-col--8")).toMatch(/grid-column:\s*span 8/);
    expect(CODE).toMatch(/@media \(max-width: 68\.75rem\)\s*\{[^@]*\.farm-col--8\s*\{\s*grid-column:\s*span 12;/);
  });

  it("lets the card shrink under its table, so the table scrolls in its wrapper and the pane does not", () => {
    // A grid item's automatic minimum is its content's width: without this, nine nowrap columns
    // hold the track open and the content pane scrolls sideways.
    expect(rule("\\.farm-col--8")).toMatch(/min-width:\s*0/);
  });

  it("leaves the table, its wrapper and its rows to the design system", () => {
    expect(CODE).not.toMatch(/\.ou-/);
    expect(COMPONENT).toContain("<Table");
  });

  it("never wraps a cell, so a figure that grows a digit cannot change a row's height", () => {
    expect(rule("(?<!,\\s*)\\.farm-runners")).toMatch(/white-space:\s*nowrap/);
  });

  it("keeps a live percentage from jittering: a fixed measure and tabular digits", () => {
    expect(rule("\\.farm-runners__cpu-pct")).toMatch(/width:\s*[\d.]+rem/);
    expect(rule("\\.farm-runners__cpu-pct")).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("dims the offline row by ink — a token in both palettes — and never by opacity", () => {
    expect(rule("\\.farm-runners__row--dim td")).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rule("\\.farm-runners__row--dim \\.farm-runners__name")).toMatch(/color:\s*var\(--ink-mut\)/);
    expect(CODE).not.toMatch(/opacity/);
  });

  it("draws the security affix in the warning ink, not a faint one nobody would see", () => {
    expect(rule("\\.farm-runners__shield")).toMatch(/color:\s*var\(--warn\)/);
  });

  it("sizes the affix's icon in rem, so it follows the 125% step with the name beside it", () => {
    expect(rule("\\.farm-runners__shield-icon")).toMatch(/width:\s*var\(--sp-\d+\)/);
    expect(rule("\\.farm-runners__shield-icon")).toMatch(/height:\s*var\(--sp-\d+\)/);
    expect(COMPONENT).not.toMatch(/<svg[^>]*\b(width|height)=/);
  });

  it("draws the grouping control's on-state off aria-pressed, in the accent triple", () => {
    const pressed = rule('\\.farm-runners__group\\[aria-pressed="true"\\]');

    expect(pressed).toMatch(/border-color:\s*var\(--accent-line\)/);
    expect(pressed).toMatch(/background:\s*var\(--accent-tint\)/);
    expect(pressed).toMatch(/color:\s*var\(--accent\)/);
  });

  it("animates nothing itself — the one moving part is the design system's meter", () => {
    expect(CODE).not.toMatch(/transition|animation/);
  });
});

describe("the shell", () => {
  it("adds no fixed or sticky chrome, so the header and sidebar stay the shell's", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky)/);
  });

  it("scrolls nothing of its own — the pane is the scroll container", () => {
    expect(CODE).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/);
  });
});

describe("the enroll card (#258)", () => {
  it("takes the mockup's four columns beside the table, and the full row once the pane narrows", () => {
    expect(rule("\\.farm-col--4")).toMatch(/grid-column:\s*span 4/);
    expect(CODE).toMatch(/@media \(max-width: 68\.75rem\)\s*\{[^@]*\.farm-col--4\s*\{\s*grid-column:\s*span 12;/);
  });

  it("lets the card shrink under its command, so a long URL cannot hold the track open", () => {
    expect(rule("\\.farm-col--4")).toMatch(/min-width:\s*0/);
  });

  it("wraps the command rather than scrolling it, keeping the service's own line breaks", () => {
    const code = rule("\\.farm-enroll__code");

    expect(code).toMatch(/white-space:\s*pre-wrap/);
    expect(code).toMatch(/overflow-wrap:\s*anywhere/);
    expect(code).not.toMatch(/overflow(-x)?:\s*(auto|scroll)/);
  });

  it("draws the command in the mono face at a token size, so the 125% step moves it", () => {
    const code = rule("\\.farm-enroll__code");

    expect(code).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(code).toMatch(/font-size:\s*var\(--t-/);
  });

  it("draws the toast in the accent triple — *this happened*, not an alarm", () => {
    const toast = rule("\\.farm-enroll__toast");

    expect(toast).toMatch(/border:\s*1px solid var\(--accent-line\)/);
    expect(toast).toMatch(/background:\s*var\(--accent-tint\)/);
  });

  it("gives an empty live region no room, so a card with nothing to say has no gap", () => {
    expect(rule("\\.farm-enroll__toast-seat:empty")).toMatch(/display:\s*none/);
    expect(rule("\\.farm-tokens__said:empty")).toMatch(/display:\s*none/);
  });

  it("says a refusal in the error hue, on the card and in the list", () => {
    expect(rule("\\.farm-enroll__failure")).toMatch(/color:\s*var\(--err\)/);
    expect(rule('\\.farm-tokens__said\\[role="alert"\\]')).toMatch(/color:\s*var\(--err\)/);
  });
});

describe("the token list (#258)", () => {
  it("wraps every row, because it is drawn at a sheet's measure and at a page's", () => {
    expect(rule("\\.farm-tokens__row")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("keeps the revoke on the trailing edge however the facts before it wrapped", () => {
    expect(rule("\\.farm-tokens__revoke")).toMatch(/margin-left:\s*auto/);
  });

  it("recedes a dead token by ink rather than by opacity, as the offline runner's row does", () => {
    expect(CODE).toMatch(/\.farm-tokens__row--dead \.farm-tokens__mask,\s*\.farm-tokens__row--dead \.farm-tokens__fact\s*\{\s*color:\s*var\(--ink-faint\)/);
    expect(CODE).not.toMatch(/opacity/);
  });

  it("uses the design system's buttons and tags rather than drawing its own", () => {
    expect(COMPONENT).toContain("<Tag>");
    expect(CODE).not.toMatch(/\.ou-/);
  });
});

describe("the pools card and its sheet (#259)", () => {
  it("stacks the enroll card and the pools card in the mockup's one right-hand column", () => {
    expect(rule("\\.farm__side")).toMatch(/flex-direction:\s*column/);
    expect(rule("\\.farm__side")).toMatch(/gap:\s*var\(--sp-8\)/);
    // The grid's own gap, so the stack and the row it sits in keep one rhythm.
    expect(rule("\\.farm__grid")).toMatch(/gap:\s*var\(--sp-8\)/);
  });

  it("draws the mockup's row: a mono name, a muted line, and a hairline between pools", () => {
    expect(rule("\\.farm-pool__name")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.farm-pool__meta")).toMatch(/color:\s*var\(--ink-mut\)/);
    expect(rule("\\.farm-pool \\+ \\.farm-pool")).toMatch(/border-top:\s*1px solid var\(--line\)/);
  });

  it("lets a long description wrap inside the row instead of pushing the switch out of the card", () => {
    expect(rule("\\.farm-pool__info")).toMatch(/min-width:\s*0/);
    expect(rule("\\.farm-pool__meta")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule("\\.farm-pool__name")).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("draws the sub-toggle in the mockup's well", () => {
    expect(rule("\\.farm-pool__subtoggle")).toMatch(/background:\s*var\(--inset\)/);
    expect(rule("\\.farm-pool__subtoggle")).toMatch(/border:\s*1px solid var\(--line\)/);
  });

  it("draws the v2 affix as readable text — never hidden, and not the faintest ink in the well", () => {
    const affix = rule("\\.farm-pool__affix");

    expect(affix).toMatch(/color:\s*var\(--ink-mut\)/);
    expect(affix).not.toMatch(/display:\s*none|visibility|opacity|clip|font-size:\s*0/);
    expect(rule("\\.farm-pool__keep")).toMatch(/color:\s*var\(--ink-faint\)/);
  });

  it("says a refusal in the error hue, on the card and in the sheet", () => {
    expect(rule("\\.farm-pool__failure")).toMatch(/color:\s*var\(--err\)/);
    expect(rule("\\.farm-pool-form__failure")).toMatch(/color:\s*var\(--err\)/);
    expect(rule("\\.farm-pool-form__confirm")).toMatch(/background:\s*var\(--err-tint\)/);
  });

  it("wraps the sheet's actions rather than crowding them, and gives an empty status region no room", () => {
    expect(rule("\\.farm-pool-form__actions")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.farm-pool-form__notice:empty")).toMatch(/display:\s*none/);
  });
});

describe("the live log card (#261)", () => {
  it("takes the mockup's full measure, and lets a long log line scroll inside its pane", () => {
    expect(rule("\\.farm-col--12")).toMatch(/grid-column:\s*span 12/);
    expect(rule("\\.farm-col--12")).toMatch(/min-width:\s*0/);
  });

  it("keeps the ticking elapsed time from nudging the head: mono, tabular digits", () => {
    expect(rule("\\.farm-live__elapsed")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.farm-live__elapsed")).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("leaves the pane's scrolling and its cursor to the pane's own sheet", () => {
    // The page-wide promises above — nothing scrolls, nothing animates — still hold of this sheet.
    expect(CODE).not.toMatch(/\.log-pane/);
    expect(COMPONENT).toContain('import "./log-pane.css"');
  });
});

describe("the first run (#262)", () => {
  it("gives the promoted column five of the twelve and the table's seat seven", () => {
    expect(rule("\\.farm__grid--first-run > \\.farm__side")).toMatch(/grid-column:\s*span 5/);
    expect(rule("\\.farm__grid--first-run > \\.farm-col--8")).toMatch(/grid-column:\s*span 7/);
  });

  it("stacks both at the mockup's first width, where the modifier would otherwise outrank the page's own step", () => {
    const narrow = /@media \(max-width: 68\.75rem\)\s*\{\s*\.farm__grid--first-run > \.farm__side\s*\{\s*grid-column:\s*span 12;\s*\}\s*\.farm__grid--first-run > \.farm-col--8\s*\{\s*grid-column:\s*span 12;/;

    expect(CODE).toMatch(narrow);
  });

  it("reorders nothing in the sheet — the order is the document's, so the tab order follows it", () => {
    expect(CODE).not.toMatch(/(^|[\s;{])order:/);
    expect(CODE).not.toMatch(/flex-direction:\s*(row|column)-reverse/);
  });

  it("promotes step one's card in the accent line, with enough weight to outrank the card's own border", () => {
    expect(rule("\\.farm__grid \\.farm-promoted")).toMatch(/border-color:\s*var\(--accent-line\)/);
  });

  it("reads the seat's steps from the left, at a measure, inside a panel that centres its text", () => {
    const steps = rule("\\.farm-first-run");

    expect(steps).toMatch(/text-align:\s*left/);
    expect(steps).toMatch(/max-width:\s*[\d.]+ch/);
    expect(rule("\\.farm-first-run__title")).toMatch(/color:\s*var\(--ink\)/);
  });
});

describe("the read-only note and the offline-heavy strip (#262)", () => {
  it("sets the note at a prose measure, in the quiet ink, with the role a step darker", () => {
    expect(rule("\\.farm-readonly")).toMatch(/max-width:\s*[\d.]+ch/);
    expect(rule("\\.farm-readonly")).toMatch(/color:\s*var\(--ink-mut\)/);
    expect(rule("\\.farm-readonly__head")).toMatch(/color:\s*var\(--ink-dim\)/);
  });

  it("draws the strip in the warning triple, with the state in the warn ink", () => {
    const strip = rule("\\.farm-fleet");

    expect(strip).toMatch(/border:\s*1px solid var\(--warn-line\)/);
    expect(strip).toMatch(/background:\s*var\(--warn-tint\)/);
    expect(rule("\\.farm-fleet__headline")).toMatch(/color:\s*var\(--warn\)/);
  });

  it("gives the strip's empty live region no room", () => {
    expect(rule("\\.farm-fleet-seat:empty")).toMatch(/display:\s*none/);
  });
});

describe("the loading skeleton (#262)", () => {
  it("draws every bar on a token surface, so both palettes are one sheet", () => {
    expect(rule("\\.farm-skeleton__bar")).toMatch(/background:\s*var\(--raised\)/);
    expect(rule("\\.farm-skeleton__cell")).toMatch(/background:\s*var\(--raised\)/);
    expect(rule("\\.farm-skeleton__block")).toMatch(/background:\s*var\(--inset\)/);
  });

  it("lets a bar shrink to a narrow card: a flex item with its measure as the basis, in a flex line", () => {
    expect(rule("\\.farm-skeleton__line")).toMatch(/display:\s*flex/);
    expect(rule("\\.farm-skeleton__bar")).toMatch(/flex:\s*0 1 [\d.]+rem/);
    expect(rule("\\.farm-skeleton__bar")).toMatch(/min-width:\s*0/);
  });

  it("gives the stat tile's figure and the headline the height of the type they stand in for", () => {
    expect(rule("\\.farm-skeleton__bar--figure")).toMatch(/height:\s*var\(--sp-11\)/);
    expect(rule("\\.farm-skeleton__bar--title")).toMatch(/height:\s*var\(--sp-11\)/);
  });

  it("rules its rows off with the hairline the table and the pools list draw", () => {
    expect(rule("\\.farm-skeleton__row")).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
    expect(rule("\\.farm-skeleton__row:last-child")).toMatch(/border-bottom:\s*0/);
  });
});
