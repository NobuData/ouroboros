import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The settings hub's sheet (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)):
 * the same frame rules the Models section draws, so two admin pages start their content on
 * the same line; mockup 17's twelve-column grid; and the shell's promises kept — the pane is
 * the only thing that scrolls, and every length that carries type is rem.
 */

const UI = join(import.meta.dirname, "..", "..");
const SETTINGS = join(UI, "app", "settings");
const SHEET = readFileSync(join(SETTINGS, "settings.css"), "utf8");
const MODELS = readFileSync(join(UI, "app", "models", "models.css"), "utf8");

const COMPONENT = readdirSync(SETTINGS)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(SETTINGS, name), "utf8"))
  .join("\n");

const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

function rule(sheet: string, selector: string): string {
  return new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(sheet.replace(/\/\*[\s\S]*?\*\//g, " "))?.[1] ?? "";
}

const DECLARED = [...CODE.matchAll(/\.(settings[a-z0-9_-]*)/g)].map((match) => match[1]);

describe("the sheet and the components", () => {
  it("declares a rule for every class the sheet names, and renders every one", () => {
    expect(DECLARED.length).toBeGreaterThan(0);

    for (const name of new Set(DECLARED)) {
      expect(COMPONENT, `${name} is declared and never rendered`).toContain(name);
    }
  });
});

describe("the frame", () => {
  it.each(["", "__head", "__headings", "__title", "__sub", "__actions", "__subnav"])(
    "draws .settings%s with the Models frame's own measurements",
    (suffix) => {
      expect(rule(SHEET, `\\.settings${suffix}`)).toBe(rule(MODELS, `\\.models${suffix}`));
    },
  );
});

describe("every colour and every size", () => {
  it("is a token, and no type size is in px", () => {
    for (const [, value] of CODE.matchAll(/(?:color|background|border[a-z-]*):([^;]*);/g)) {
      expect(value).toMatch(/var\(--|transparent|none|0/);
    }
    expect(CODE).not.toMatch(/font-size:\s*\d+px/);
  });
});

describe("the tab row", () => {
  it("wraps, so ten tabs never push the pane sideways at the larger font-size steps", () => {
    // The primitive's row is one line; mockup 17's `.section-nav` wraps, and this one must.
    expect(rule(SHEET, "\\.ou-subnav\\.settings__subnav")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("draws the rule between the two groups as a hairline in rem", () => {
    const hairline = rule(SHEET, "\\.settings__subnav-rule");

    expect(hairline).toMatch(/width:\s*1px/);
    expect(hairline).toMatch(/height:\s*[\d.]+rem/);
    expect(hairline).toMatch(/background:\s*var\(--line-strong\)/);
  });
});

describe("the section grid", () => {
  it("is mockup 17's twelve columns", () => {
    expect(rule(SHEET, "\\.settings__grid")).toMatch(/grid-template-columns:\s*repeat\(12, 1fr\)/);
  });

  it.each([
    ["5", "span 5"],
    ["7", "span 7"],
    ["12", "span 12"],
  ])("gives the mockup's c-%s seat %s", (width, span) => {
    expect(rule(SHEET, `\\.settings__seat--${width}`)).toContain(`grid-column: ${span}`);
  });

  it("gives every card the full measure below the mockup's breakpoint", () => {
    const narrow = /@media \(max-width: 68\.75rem\) \{([\s\S]*?)\n\}/.exec(CODE)?.[1] ?? "";

    expect(narrow).toMatch(/\.settings__seat--5,\s*\.settings__seat--7\s*\{\s*grid-column: span 12;/);
  });

  it("lets a seat's content shrink, so a wide table scrolls in its own wrapper", () => {
    expect(rule(SHEET, "\\.settings__seat")).toMatch(/min-width:\s*0/);
  });

  it("draws the Danger zone in the error tokens", () => {
    expect(rule(SHEET, "\\.settings__card--danger")).toMatch(/border-color:\s*var\(--err-line\)/);
    expect(rule(SHEET, "\\.settings__card--danger \\.ou-card__title")).toMatch(/color:\s*var\(--err\)/);
  });
});

describe("the dirty bar", () => {
  it.each(["__label", "__sep", "__actions", "__failure"])(
    "draws .settings-dirty%s with the Models page's bar's own measurements",
    (suffix) => {
      // Not empty on both sides: a rule neither sheet declared would compare equal.
      expect(rule(SHEET, `\\.settings-dirty${suffix}`)).not.toBe("");
      expect(rule(SHEET, `\\.settings-dirty${suffix}`)).toBe(rule(MODELS, `\\.models-dirty${suffix}`));
    },
  );

  it("sits flush under the tab row, spanning the pane, as the Models page's does", () => {
    expect(rule(SHEET, "\\.settings \\.settings-dirty")).toMatch(/margin:/);
    expect(rule(SHEET, "\\.settings \\.settings-dirty")).toBe(rule(MODELS, "\\.models \\.models-dirty"));
  });
});

describe("the shell's promises", () => {
  it("adds no scroll container: the pane is the only thing that scrolls", () => {
    expect(CODE).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/);
  });

  it("positions nothing itself: sticking is the CP.4 primitives' business", () => {
    expect(CODE).not.toMatch(/position:\s*(sticky|fixed)/);
  });

  it("writes every length that is not a hairline in rem, ch or a token", () => {
    const pixels = [...CODE.matchAll(/[\d.]+px/g)].map(([length]) => length);

    expect(pixels.length).toBeGreaterThan(0);
    for (const length of pixels) expect(length).toBe("1px");
  });
});
