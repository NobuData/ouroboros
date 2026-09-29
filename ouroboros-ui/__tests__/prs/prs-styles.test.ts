import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/prs/prs.css` that are agreements with something outside it (#363). jsdom
 * applies no stylesheet, so *both themes* and *the 125% font-scale step* are verified as what they
 * reduce to: every hue is a token, every length is a token or a rem, and every type size is a
 * token. The shell compliance half — no chrome of its own, a fixed header and sidebar while the
 * pane scrolls — is that the sheet fixes and sticks nothing.
 */

const DIRECTORY = join(import.meta.dirname, "..", "..", "app", "prs");
const SHEET = readFileSync(join(DIRECTORY, "prs.css"), "utf8");

/** Every component in the directory, as one source. */
const COMPONENT = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(DIRECTORY, name), "utf8"))
  .join("\n");

/** The sheet without its prose. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/** Every page class the sheet declares. */
const DECLARED = new Set([...CODE.matchAll(/\.(prv[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every page class a component renders — a quoted string made only of page classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:prv[a-z0-9_-]*\s*)+)"/g)]
    .flatMap((match) => match[1]!.trim().split(/\s+/))
    .filter((name) => name.startsWith("prv")),
);

describe("the sheet and the components", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) {
      expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    }
    for (const name of RENDERED) {
      expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
    }
  });

  it("write no style on an element — every treatment is a class", () => {
    expect(COMPONENT).not.toMatch(/\bstyle=\{/);
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

    for (const [, value] of CODE.matchAll(
      /(?:^|[\s;{])(?:color|background|border-color|accent-color):\s*([^;]+);/g,
    )) {
      expect(value!.trim()).toMatch(/^(var\(--[a-z0-9-]+\)|none|inherit|transparent)$/);
    }
  });
});

describe("the shell", () => {
  it("adds no fixed or sticky chrome, so the header and sidebar stay put while the pane scrolls", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky)/);
  });

  it("wraps the head and its long values rather than scrolling the page sideways", () => {
    expect(CODE).toMatch(/\.prv-head \{[^}]*flex-wrap: wrap;/);
    expect(CODE).toMatch(/\.prv-head__main \{[^}]*min-width: 0;/);
    expect(CODE).toMatch(/\.prv-head__title \{[^}]*overflow-wrap: anywhere;/);
    expect(CODE).toMatch(/\.prv-return__evidence \{[^}]*overflow-wrap: anywhere;/);
  });

  it("scrolls sideways in the strip's, the gates', the matrix's and the diff's own wrappers, downwards in the thread's, and nowhere else (#364–#368)", () => {
    const scrolling = [
      ...CODE.matchAll(/([^{}]+)\{[^}]*overflow(?:-[xy])?:\s*(?:scroll|auto)[^}]*\}/g),
    ].map((match) => match[1]!.trim());

    expect(scrolling).toEqual([
      ".prv-strip__scroll",
      ".prv-gates__scroll",
      ".prv-criteria__scroll",
      ".prv-diff__scroll",
      ".prv-thread__scroll",
    ]);
    expect(CODE).toMatch(/\.prv-strip__scroll \{[^}]*overflow-x: auto;/);
    expect(CODE).toMatch(/\.prv-gates__scroll \{[^}]*overflow-x: auto;/);
    expect(CODE).toMatch(/\.prv-criteria__scroll \{[^}]*overflow-x: auto;/);
    expect(CODE).toMatch(/\.prv-diff__scroll \{[^}]*overflow-x: auto;/);
    expect(CODE).not.toMatch(/overflow:\s*(scroll|auto)/);
  });

  it("scrolls a long thread inside the card's own wrapper, bounded in rem (#368)", () => {
    expect(CODE).toMatch(/\.prv-thread__scroll \{[^}]*max-height: 32rem;[^}]*overflow-y: auto;/);
    expect([...CODE.matchAll(/overflow-y:\s*(?:scroll|auto)/g)]).toHaveLength(1);
  });

  it("draws the blocking rule, the reply's rule and the watermark as classes (#368)", () => {
    expect(CODE).toMatch(
      /\.prv-entry--blocking \.prv-entry__body \{[^}]*border-left: 0\.125rem solid var\(--warn\);/,
    );
    expect(CODE).toMatch(/\.prv-entry__reply \{[^}]*border-left: 0\.125rem solid var\(--border\);/);
    expect(CODE).toMatch(/\.prv-entry__author--model \{[^}]*color: var\(--model\);/);
    expect(CODE).toMatch(/\.prv-entry__resolved \{[^}]*color: var\(--ok\);/);
  });

  it("keeps a step from shrinking below its measure, so the strip scrolls rather than squeezes", () => {
    expect(CODE).toMatch(/\.prv-step \{[^}]*min-width: 12\.5rem;/);
    expect(CODE).toMatch(/\.prv-strip__item \{[^}]*flex: 1 0 auto;/);
  });

  it("reads the actions from the left on a narrow pane", () => {
    expect(CODE).toMatch(
      /@media \(max-width: 68\.75rem\)\s*\{\s*\.prv-actions\s*\{\s*align-items: flex-start;/,
    );
  });
});

describe("the revision cycle strip (#364)", () => {
  it("draws each treatment apart: err, live, ghosted dashed and armed solid", () => {
    expect(CODE).toMatch(/\.prv-step--err \{[^}]*border-color: var\(--err-line\);/);
    expect(CODE).toMatch(/\.prv-step--live \{[^}]*border-color: var\(--accent-line\);/);
    expect(CODE).toMatch(/\.prv-step--ghosted \{[^}]*border-style: dashed;/);
    expect(CODE).toMatch(/\.prv-step--armed \{[^}]*border-color: var\(--accent-line\);/);
    expect(CODE).not.toMatch(/\.prv-step--armed \{[^}]*dashed/);
  });

  it("moves the live dot only for a reader who has not asked for less motion", () => {
    const guarded = [
      ...CODE.matchAll(/@media \(prefers-reduced-motion: no-preference\)\s*\{([\s\S]*?\})\s*\}/g),
    ]
      .map((match) => match[1])
      .join("\n");

    expect(guarded).toMatch(/\.prv-step__dot \{[^}]*animation: prv-step-pulse/);

    const unguarded = CODE.replace(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\}\s*\}/g,
      " ",
    );

    expect(unguarded).not.toMatch(/animation:/);
    // Standing still, the dot is still drawn — the state is not in the movement.
    expect(unguarded).toMatch(/\.prv-step__dot \{[^}]*background: var\(--accent\);/);
  });
});

describe("the verification gates card (#365)", () => {
  /**
   * One rule's declarations.
   *
   * @param selector The rule's selector, exactly.
   * @returns What it declares, or an empty string when the sheet has no such rule.
   */
  function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    return CODE.match(new RegExp(`(?:^|\\})\\s*${escaped} \\{([^}]*)\\}`))?.[1] ?? "";
  }

  it("draws pending as the mockup's gradient, from a token", () => {
    expect(rule(".prv-gate--pending")).toMatch(
      /background-image: linear-gradient\(90deg, var\(--accent-tint\), transparent 28rem\);/,
    );
  });

  it("draws unavailable apart from pending: no gradient, nothing that moves", () => {
    const unavailable = rule(".prv-gate--unavailable");

    expect(unavailable).toMatch(/border-bottom-style: dashed;/);
    expect(unavailable).not.toMatch(/gradient|animation|background/);
    expect(unavailable).not.toBe(rule(".prv-gate--pending"));
    expect(CODE).not.toMatch(/\.prv-gate--unavailable[^{]*\.prv-gate__dot/);
  });

  it("moves the pending dot only for a reader who has not asked for less motion", () => {
    expect(CODE).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.prv-gate__dot \{[^}]*animation:/,
    );
    expect(rule(".prv-gate__dot")).not.toMatch(/animation/);
  });

  it("never draws policy in the pass's green", () => {
    expect(CODE).toMatch(/\.prv-gate--green \.prv-gate__mark \{[^}]*color: var\(--ok\);/);

    for (const policy of ["not-required", "waived", "unavailable"]) {
      for (const [, declarations] of CODE.matchAll(
        new RegExp(`\\.prv-gate--${policy}[^{]*\\{([^}]*)\\}`, "g"),
      )) {
        expect(declarations, policy).not.toMatch(/var\(--ok/);
      }
    }
  });

  it("never cuts the evidence line short, and keeps the waiver in the row's own flow", () => {
    expect(rule(".prv-gate__evidence")).toMatch(/white-space: nowrap;/);
    expect(rule(".prv-gate__evidence")).not.toMatch(/text-overflow|overflow: hidden/);
    expect(rule(".prv-gate__popover")).not.toMatch(/position:/);
  });
});

describe("the criteria matrix (#366)", () => {
  it("draws the mockup's three columns: claim, evidence, pill", () => {
    expect(CODE).toMatch(
      /\.prv-crit \{[^}]*grid-template-columns: minmax\(11\.25rem, 1\.1fr\) minmax\(12\.5rem, 1\.3fr\) auto;/,
    );
  });

  it("collapses per the mockup's rule: the pill beside the claim, the evidence beneath both", () => {
    const narrow = /@media \(max-width: 56\.25rem\) \{([\s\S]*?\n)\}/.exec(CODE)?.[1] ?? "";

    expect(narrow).toMatch(/\.prv-crit \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/);
    expect(narrow).toMatch(/\.prv-crit__evidence \{[^}]*grid-column: 1 \/ -1;/);
  });

  it("quotes the claim in the sheet, so the marks are never part of the words", () => {
    expect(CODE).toMatch(/\.prv-crit__claim::before \{[^}]*content: "“";/);
    expect(CODE).toMatch(/\.prv-crit__claim::after \{[^}]*content: "”";/);
  });

  it("gives the waived row the warn treatment, from the warn token", () => {
    expect(CODE).toMatch(/\.prv-crit--waived \{[^}]*background: var\(--warn-tint\);/);
  });

  it("lets a long evidence line break rather than widen the grid", () => {
    expect(CODE).toMatch(/\.prv-crit__evidence \{[^}]*overflow-wrap: anywhere;/);
  });
});

describe("the changed files card (#367)", () => {
  /** The transcript's sheet, without its prose — where the shared diff treatments are stated. */
  const RUNS = readFileSync(join(DIRECTORY, "..", "runs", "runs.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    " ",
  );

  /**
   * One rule's colour and background.
   *
   * @param sheet The sheet.
   * @param selector The rule's selector, exactly.
   * @returns The two declarations, in the sheet's order.
   */
  function palette(sheet: string, selector: string): string[] {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const body = sheet.match(new RegExp(`(?:^|\\})\\s*${escaped} \\{([^}]*)\\}`))?.[1] ?? "";

    return [...body.matchAll(/(?:^|\s)((?:color|background): [^;]+;)/g)].map((each) => each[1]!);
  }

  it("draws del, add and ctx from the transcript's own tokens — one diff palette", () => {
    for (const kind of ["ctx", "del", "add"]) {
      const shared = palette(RUNS, `.run-entry__line--${kind}`);

      expect(shared.length, kind).toBeGreaterThan(0);
      expect(palette(CODE, `.prv-diff__line--${kind}`), kind).toEqual(shared);
    }

    expect(CODE).toMatch(/\.prv-diff__scroll \{[^}]*background: var\(--inset\);/);
    expect(RUNS).toMatch(/\.run-entry__diff \{[^}]*background: var\(--inset\);/);
  });

  it("keeps every line whole, so a long one scrolls the block and never wraps", () => {
    expect(CODE).toMatch(/\.prv-diff__line \{[^}]*white-space: pre;/);
  });

  it("colours the meter's segments from the ok and err tokens, and its rest from the track's", () => {
    expect(CODE).toMatch(/\.prv-file__meter-add \{[^}]*fill: var\(--ok\);/);
    expect(CODE).toMatch(/\.prv-file__meter-del \{[^}]*fill: var\(--err\);/);
    expect(CODE).toMatch(/\.prv-file__meter-rest \{[^}]*fill: var\(--raised\);/);
  });

  it("gives a flagged row the err tint and a rule, so the flag is not hue alone", () => {
    expect(CODE).toMatch(/\.prv-file--flagged \{[^}]*background: var\(--err-tint\);/);
    expect(CODE).toMatch(/\.prv-file--flagged \{[^}]*border-left: 0\.125rem solid var\(--err\);/);
  });

  it("marks the cited range with a rule beside the line", () => {
    expect(CODE).toMatch(/\.prv-diff__line--cited \{[^}]*box-shadow: inset/);
  });
});

describe("the merge plan, its confirmation and the spend card (#369)", () => {
  /**
   * One rule's declarations.
   *
   * @param selector The rule's selector, exactly.
   * @returns What it declares, or an empty string when the sheet has no such rule.
   */
  function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    return CODE.match(new RegExp(`(?:^|\\})\\s*${escaped} \\{([^}]*)\\}`))?.[1] ?? "";
  }

  it("draws the armed state in the strip's own treatment — accent, and a solid rule", () => {
    const armed = rule(".prv-merge--armed .prv-merge__armed");

    expect(armed).toMatch(/border-color: var\(--accent-line\);/);
    expect(armed).toMatch(/background: var\(--accent-tint\);/);
    expect(rule(".prv-merge__armed")).not.toMatch(/dashed/);
    expect(CODE).toMatch(/\.prv-step--armed \{[^}]*border-color: var\(--accent-line\);/);
  });

  it("draws the Closes warning from the warn tokens, and never in the pass's green", () => {
    const warning = rule(".prv-merge__warning");

    expect(warning).toMatch(/color: var\(--warn\);/);
    expect(warning).toMatch(/background: var\(--warn-tint\);/);
    expect(warning).toMatch(/border: 1px solid var\(--warn-line\);/);
    expect(warning).not.toMatch(/var\(--ok/);
  });

  it("draws a disarm reason in the error hue, and the receipt in the pass's", () => {
    expect(rule(".prv-merge__disarmed")).toMatch(/background: var\(--err-tint\);/);
    expect(rule(".prv-merge__disarmed-head")).toMatch(/color: var\(--err\);/);
    expect(rule(".prv-merge__receipt")).toMatch(/background: var\(--ok-tint\);/);
    // What was switched on and did not run is something to look at, not a pass.
    expect(rule(".prv-merge__skipped-row")).toMatch(/color: var\(--warn\);/);
  });

  it("sets the confirmation's terms apart in the error hue, as the return dialog's are", () => {
    expect(rule(".prv-arm__terms")).toMatch(/border: 1px solid var\(--err-line\);/);
    expect(rule(".prv-arm__terms")).toMatch(/background: var\(--err-tint\);/);
    expect(rule(".prv-return__consequences")).toMatch(/background: var\(--err-tint\);/);
  });

  it("wraps the message rather than scrolling — the card never scrolls inside itself", () => {
    const preview = rule(".prv-merge__preview");

    expect(preview).toMatch(/white-space: pre-wrap;/);
    expect(preview).toMatch(/overflow-wrap: anywhere;/);

    for (const [, selector, declarations] of CODE.matchAll(
      /(\.prv-(?:merge|arm|spend)[^{]*)\{([^}]*)\}/g,
    )) {
      expect(declarations, selector).not.toMatch(/overflow(?:-x|-y)?: (?:auto|scroll)/);
      expect(declarations, selector).not.toMatch(/text-overflow|overflow: hidden/);
    }
  });

  it("takes focus visibly, where the head's button lands the reader", () => {
    expect(rule(".prv-merge:focus-visible")).toMatch(/outline: 0\.125rem solid var\(--accent\);/);
  });

  it("colours the cap line by the verdict: over in the error hue, unknown in the warn", () => {
    expect(rule(".prv-spend__cap--err")).toMatch(/color: var\(--err\);/);
    expect(rule(".prv-spend__cap--neutral")).toMatch(/color: var\(--warn\);/);
    expect(rule(".prv-spend__cap--ok")).not.toMatch(/var\(--(?:err|warn)\)/);
    expect(rule(".prv-spend__bound")).toMatch(/color: var\(--warn\);/);
  });

  it("moves nothing — the armed state is said, not animated", () => {
    for (const [, selector, declarations] of CODE.matchAll(
      /(\.prv-(?:merge|arm|spend)[^{]*)\{([^}]*)\}/g,
    )) {
      expect(declarations, selector).not.toMatch(/animation|transition/);
    }
  });
});

describe("the states after the happy one (#370)", () => {
  /**
   * One rule's declarations.
   *
   * @param selector The rule's selector, exactly.
   * @returns What it declares, or an empty string when the sheet has no such rule.
   */
  function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    return CODE.match(new RegExp(`(?:^|\\})\\s*${escaped} \\{([^}]*)\\}`))?.[1] ?? "";
  }

  it("draws the receipt in the pass's hue, a refusal in the error's, and closed in neither", () => {
    expect(rule(".prv-state--ok")).toMatch(/background: var\(--ok-tint\);/);
    expect(rule(".prv-state--ok")).toMatch(/border-color: var\(--ok-line\);/);
    expect(rule(".prv-state--err")).toMatch(/background: var\(--err-tint\);/);
    expect(rule(".prv-state--err")).toMatch(/border-color: var\(--err-line\);/);
    expect(rule(".prv-state--neutral")).not.toMatch(/var\(--(?:ok|err|warn)/);
    expect(rule(".prv-state")).not.toMatch(/var\(--(?:ok|err|warn)/);
  });

  it("draws the banner the Merge plan card's way, so one state has one treatment", () => {
    expect(rule(".prv-state--ok")).toMatch(/background: var\(--ok-tint\);/);
    expect(rule(".prv-merge__receipt")).toMatch(/background: var\(--ok-tint\);/);
    expect(rule(".prv-state--err")).toMatch(/background: var\(--err-tint\);/);
    expect(rule(".prv-merge__disarmed")).toMatch(/background: var\(--err-tint\);/);
    // What was switched on and did not run is something to look at, not a pass.
    expect(rule(".prv-state__skipped-row")).toMatch(/color: var\(--warn\);/);
  });

  it("lets the banner's long values break rather than widen the pane", () => {
    for (const selector of [".prv-state__headline", ".prv-state__line", ".prv-state__link"]) {
      expect(rule(selector), selector).toMatch(/overflow-wrap: anywhere;/);
    }
    expect(rule(".prv-state__links")).toMatch(/flex-wrap: wrap;/);
  });

  it("emphasises a blocking gate with a tint and a rule, so it is not hue alone", () => {
    expect(rule(".prv-gate--blocking")).toMatch(/background: var\(--err-tint\);/);
    expect(rule(".prv-gate--blocking")).toMatch(/border-left: 0\.125rem solid var\(--err\);/);
    expect(rule(".prv-gate--blocking .prv-gate__name")).toMatch(/font-weight: 600;/);
  });

  it("keeps the skeleton still, and clips it rather than scrolling it", () => {
    for (const [, selector, declarations] of CODE.matchAll(
      /(\.prv-(?:skeleton|state)[^{]*)\{([^}]*)\}/g,
    )) {
      expect(declarations, selector).not.toMatch(/animation|transition/);
      expect(declarations, selector).not.toMatch(/overflow(?:-x|-y)?: (?:auto|scroll)/);
    }

    expect(rule(".prv-skeleton__card")).toMatch(/overflow: hidden;/);
    expect(rule(".prv-skeleton__steps")).toMatch(/overflow: hidden;/);
    expect(rule(".prv-skeleton__head")).toMatch(/overflow: hidden;/);
  });

  it("draws a skeleton step at a step's own measure, so the strip does not jump", () => {
    expect(rule(".prv-skeleton__step")).toMatch(/width: 12\.5rem;/);
    expect(CODE).toMatch(/\.prv-step \{[^}]*min-width: 12\.5rem;/);
  });

  it("takes focus visibly on the banner's links", () => {
    expect(rule(".prv-state__link:focus-visible")).toMatch(
      /outline: 0\.125rem solid var\(--accent\);/,
    );
  });
});
