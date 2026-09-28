import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/test-results/tests.css` that are agreements with something outside it
 * (#335, and #336's timeline). jsdom applies no stylesheet, so *both themes* and *the 125% font-scale step* are
 * verified as what they reduce to: every hue is a token, every length is a token or a rem, and
 * every type size is a token. The shell compliance half — no chrome of its own, a fixed header
 * and sidebar while the pane scrolls — is that the sheet fixes and sticks nothing.
 */

const DIRECTORY = join(import.meta.dirname, "..", "..", "app", "test-results");
const SHEET = readFileSync(join(DIRECTORY, "tests.css"), "utf8");

/** Every component in the directory, as one source. */
const COMPONENT = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(DIRECTORY, name), "utf8"))
  .join("\n");

/** The sheet without its prose. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/** Every page class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.(tests[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every page class a component renders — a quoted string made only of page classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:tests[a-z0-9_-]*\s*)+)"/g)]
    .flatMap((match) => match[1]!.trim().split(/\s+/))
    .filter((name) => name.startsWith("tests")),
);

describe("the sheet and the components", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });
});

describe("scaling and theming", () => {
  it("writes every length as a token, a rem, a ch or a hairline", () => {
    for (const [value, , unit] of CODE.matchAll(/(-?\d*\.?\d+)(px|em|rem|ch|vw|vh|%)/g)) {
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
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(CODE).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/);

    for (const [, value] of CODE.matchAll(/(?:^|[\s;{])(?:color|background|border-color):\s*([^;]+);/g)) {
      expect(value!.trim()).toMatch(/^(var\(--[a-z0-9-]+\)|none|inherit|transparent)$/);
    }
  });
});

describe("the build attempts timeline (#336)", () => {
  it("scrolls sideways inside its own wrapper, so the content pane never does", () => {
    expect(CODE).toMatch(/\.tests-timeline__scroll\s*\{[^}]*overflow-x: auto;/);
    expect(CODE).toMatch(/\.tests-timeline__list\s*\{[^}]*width: max-content;/);
    // Nothing else on the page may scroll or overflow sideways, but the suites card's wrapper
    // (#337), the physical-tests card's (#338), and the artifacts card's and its viewer's (#341).
    expect([...CODE.matchAll(/overflow(?:-x)?:\s*(auto|scroll)/g)]).toHaveLength(5);
  });

  it("makes the wrapper the cards' offset parent, which is what scrolling it alone relies on", () => {
    expect(CODE).toMatch(/\.tests-timeline__scroll\s*\{[^}]*position: relative;/);
  });

  it("moves the live pulse only for a reader who has not asked for less motion", () => {
    const animated = [...CODE.matchAll(/animation:/g)];
    const guarded = CODE.match(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.tests-timeline__pulse\s*\{\s*animation:[^}]*\}\s*\}/,
    );

    expect(guarded).not.toBeNull();
    expect(animated).toHaveLength(1);
  });

  it("draws the dot and the live hue with or without motion, so the reduced variant stays legible", () => {
    const dot = CODE.match(/\.tests-timeline__pulse\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(dot).toMatch(/background: var\(--accent\);/);
    expect(dot).not.toMatch(/animation/);
    expect(CODE).toMatch(/\.tests-timeline__card--live \.tests-timeline__result\s*\{\s*color: var\(--accent\);/);
  });

  it("draws the future card dashed, in either variant", () => {
    expect(CODE).toMatch(/\.tests-timeline__card--future\s*\{[^}]*border-style: dashed;/);
  });

  it("gives each verdict its own hue, from the tokens", () => {
    for (const tone of ["err", "warn", "ok"]) {
      expect(CODE).toMatch(
        new RegExp(`\\.tests-timeline__card--${tone} \\.tests-timeline__result\\s*\\{\\s*color: var\\(--${tone}\\);`),
      );
    }
  });
});

describe("the suites card (#337)", () => {
  it("scrolls a long or wide list inside its own wrapper, so the content pane never does", () => {
    const wrapper = CODE.match(/\.tests-suites__scroll\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(wrapper).toMatch(/overflow: auto;/);
    expect(wrapper).toMatch(/max-height: [\d.]+rem;/);
    expect(CODE).toMatch(/\.tests-suites__list\s*\{[^}]*min-width: [\d.]+rem;/);
  });

  it("draws the selected row as an accent inset, which no status hue is", () => {
    const selected = CODE.match(/\.tests-suites__row\[data-selected="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(selected).toMatch(/box-shadow: inset [^;]*var\(--accent\);/);
    expect(selected).not.toMatch(/var\(--(ok|warn|err)\)/);
  });

  it("gives both of a row's buttons a visible focus ring", () => {
    expect(CODE).toMatch(/\.tests-suites__select:focus-visible::after\s*\{[^}]*outline: [^;]*var\(--accent\);/);
    expect(CODE).toMatch(/\.tests-suites__toggle:focus-visible\s*\{[^}]*outline: [^;]*var\(--accent\);/);
  });

  it("stretches the row's button over the row, and lifts the chevron above it", () => {
    expect(CODE).toMatch(/\.tests-suites__row\s*\{[^}]*position: relative;/);
    expect(CODE).toMatch(/\.tests-suites__select::after\s*\{[^}]*inset: 0;/);
    expect(CODE).toMatch(/\.tests-suites__toggle\s*\{[^}]*z-index: 1;/);
  });

  it("gives each status its own hue on the count, from the tokens", () => {
    for (const tone of ["err", "warn", "ok"]) {
      expect(CODE).toMatch(new RegExp(`\\.tests-suites__count--${tone}\\s*\\{\\s*color: var\\(--${tone}\\);`));
    }
  });
});

describe("the physical-tests card (#338)", () => {
  it("scrolls a long or wide list inside its own wrapper, so the content pane never does", () => {
    const wrapper = CODE.match(/\.tests-physical__scroll\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(wrapper).toMatch(/overflow: auto;/);
    expect(wrapper).toMatch(/max-height: [\d.]+rem;/);
    expect(CODE).toMatch(/\.tests-physical__group\s*\{[^}]*min-width: [\d.]+rem;/);
  });

  it("draws a breached value in the err hue, from the token", () => {
    expect(CODE).toMatch(/\.tests-physical__value--breached\s*\{[^}]*color: var\(--err\);/);
  });

  it("insets a selected row in the accent, and the failing one in the err hue", () => {
    const selected = CODE.match(/\.tests-physical__row\[data-selected="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
    const failing =
      CODE.match(/\.tests-physical__row\[data-selected="true"\]\[data-failing="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(selected).toMatch(/box-shadow: inset [^;]*var\(--accent\);/);
    expect(failing).toMatch(/box-shadow: inset [^;]*var\(--err\);/);
  });

  it("stretches the row's button over the row, with a visible focus ring", () => {
    expect(CODE).toMatch(/\.tests-physical__row\s*\{[^}]*position: relative;/);
    expect(CODE).toMatch(/\.tests-physical__select::after\s*\{[^}]*inset: 0;/);
    expect(CODE).toMatch(/\.tests-physical__select:focus-visible::after\s*\{[^}]*outline: [^;]*var\(--accent\);/);
  });
});

describe("the artifacts card (#341)", () => {
  it("scrolls a long list inside its own wrapper, so the content pane never does", () => {
    const wrapper = CODE.match(/\.tests-artifacts__scroll\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(wrapper).toMatch(/overflow: auto;/);
    expect(wrapper).toMatch(/max-height: [\d.]+rem;/);
    expect(CODE).toMatch(/\.tests-artifacts__list\s*\{[^}]*min-width: [\d.]+rem;/);
  });

  it("scrolls a file's text inside the viewer, both ways, without wrapping its columns", () => {
    const file = CODE.match(/\.tests-artifacts__text\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(file).toMatch(/overflow: auto;/);
    expect(file).toMatch(/max-height: [\d.]+rem;/);
    expect(file).toMatch(/white-space: pre;/);
  });

  it("colours the coverage delta ok or err, from the tokens", () => {
    expect(CODE).toMatch(/\.tests-artifacts__delta--ok\s*\{\s*color: var\(--ok\);/);
    expect(CODE).toMatch(/\.tests-artifacts__delta--err\s*\{\s*color: var\(--err\);/);
  });

  it("draws a tombstone faint and struck through, even under the pointer", () => {
    expect(CODE).toMatch(
      /\.tests-artifacts__row\[data-expired="true"\],\s*\.tests-artifacts__row\[data-expired="true"\]:hover\s*\{\s*color: var\(--ink-faint\);/,
    );
    expect(CODE).toMatch(
      /\.tests-artifacts__row\[data-expired="true"\] \.tests-artifacts__name\s*\{\s*text-decoration: line-through;/,
    );
  });

  it("gives the affordance, the viewer's link and the file a visible focus ring", () => {
    expect(CODE).toMatch(
      /\.tests-artifacts__open:focus-visible,\s*\.tests-artifacts__viewer-link:focus-visible,\s*\.tests-artifacts__text:focus-visible\s*\{[^}]*outline: [^;]*var\(--accent\);/,
    );
  });
});

describe("the shell", () => {
  it("adds no fixed or sticky chrome, so the header and sidebar stay put while the pane scrolls", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky)/);
  });

  it("stacks the strip on a narrow pane rather than scrolling the page sideways", () => {
    expect(CODE).toMatch(/@media \(max-width: 40rem\)\s*\{\s*\.tests-strip > \*\s*\{\s*grid-column: span 12;/);
    expect(CODE).toMatch(/grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/);
  });
});
