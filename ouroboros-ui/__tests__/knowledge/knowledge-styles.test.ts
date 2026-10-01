import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/knowledge/knowledge.css` that are agreements with something outside it
 * (#417). The generic rules — no colour literal outside the token sheet, no px type — are
 * `__tests__/styles.test.ts`'s and stylelint's; what is here is that the sheet and the components
 * name the same classes, that every length scales and every hue is a token (which is what *both
 * themes* and *the 125% font scale* can be verified as, since jsdom applies no stylesheet), the
 * mockup's column, and that the page adds no chrome to the shell.
 */

const KNOWLEDGE = join(import.meta.dirname, "..", "..", "app", "knowledge");
const SHEET = readFileSync(join(KNOWLEDGE, "knowledge.css"), "utf8");

/** Every component in the directory, as one source. */
const COMPONENT = readdirSync(KNOWLEDGE)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(KNOWLEDGE, name), "utf8"))
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
const DECLARED = new Set([...CODE.matchAll(/\.(knowledge[a-z0-9_-]*)/g)].map((match) => match[1]!));

/** Every page class a component renders — in a `className="…"` or a string literal of page classes. */
const RENDERED = new Set(
  [...COMPONENT.matchAll(/"((?:knowledge[a-z0-9_-]*\s*)+)"/g)]
    .flatMap((match) => match[1]!.trim().split(/\s+/))
    .filter((name) => name.startsWith("knowledge")),
);

describe("the sheet and the components", () => {
  it("declare and render the same classes", () => {
    expect(DECLARED.size).toBeGreaterThan(0);

    for (const name of DECLARED) expect(RENDERED, `${name} is declared and never rendered`).toContain(name);
    for (const name of RENDERED) expect(DECLARED, `${name} is rendered and never declared`).toContain(name);
  });
});

describe("scaling and theming", () => {
  it("writes every length as a token, a rem, a ch, a percentage of its box or a hairline", () => {
    const lengths = [...CODE.matchAll(/(-?\d*\.?\d+)(px|em|rem|ch|vw|vh|%)/g)];

    for (const [value, , unit] of lengths) {
      if (unit === "px") expect(value, "only a 1px hairline may be px").toBe("1px");
      else expect(["rem", "ch", "%"]).toContain(unit);
    }
  });

  it("sets every type size through a token", () => {
    for (const [, value] of CODE.matchAll(/font-size:\s*([^;]+);/g)) expect(value).toMatch(/^var\(--t-/);
  });

  it("names no colour except through a token", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });
});

describe("the grid", () => {
  it("is the mockup's twelve columns with the left column at 7 and the right at 5, full width on a narrow pane", () => {
    expect(rule("\\.knowledge__grid")).toMatch(/grid-template-columns:\s*repeat\(12,\s*1fr\)/);
    expect(rule("\\.knowledge__main")).toMatch(/grid-column:\s*span 7/);
    expect(rule("\\.knowledge__aside")).toMatch(/grid-column:\s*span 5/);
    expect(CODE).toMatch(/@media \(max-width: [\d.]+rem\)\s*\{\s*\.knowledge__main,\s*\.knowledge__aside\s*\{\s*grid-column:\s*span 12;/);
  });

  it("gives a region's seat a scroll margin, so a toast's anchor lands under the shell's chrome", () => {
    expect(rule("\\.knowledge__seat")).toMatch(/scroll-margin-top/);
  });
});

describe("the shell", () => {
  it("adds no fixed or sticky chrome, so the header and sidebar stay the shell's", () => {
    expect(CODE).not.toMatch(/position:\s*(fixed|sticky)/);
  });

  it("scrolls nothing of its own — the content pane is the scroll container", () => {
    expect(CODE).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/);
  });
});

describe("the toast and the note", () => {
  it("collapses the toast's seat while it is empty, and tints the toast with the accent triple", () => {
    expect(rule("\\.knowledge-toast__seat:empty")).toMatch(/display:\s*none/);
    expect(rule("\\.knowledge-toast")).toMatch(/border:\s*1px solid var\(--accent-line\)/);
    expect(rule("\\.knowledge-toast")).toMatch(/background:\s*var\(--accent-tint\)/);
  });

  it("tints the statement that nothing is enabled with the warn triple, so it reads as the caveat it is", () => {
    expect(rule("\\.knowledge-import__note")).toMatch(/border:\s*1px solid var\(--warn-line\)/);
    expect(rule("\\.knowledge-import__note")).toMatch(/background:\s*var\(--warn-tint\)/);
  });
});

describe("the skills table (#418)", () => {
  it("tints the draft row's cells with the warn triple — on the cells, so the hover rule cannot hide it", () => {
    expect(rule("\\.knowledge-skills__row--draft td")).toMatch(/background:\s*var\(--warn-tint\)/);
  });

  it("sets the switch column's width in rem, so the 125% font scale widens it with the type", () => {
    expect(rule("\\.knowledge-skills__col--on")).toMatch(/width:\s*[\d.]+rem/);
  });

  it("draws a real zero in the value's ink and a draft's — in the faint one", () => {
    expect(rule("\\.knowledge-skills__used-label--zero")).toMatch(/color:\s*var\(--ink-dim\)/);
    expect(rule("\\.knowledge-skills__used-label--inert")).toMatch(/color:\s*var\(--ink-faint\)/);
  });

  it("writes the refusal under a switch in the error hue", () => {
    expect(rule("\\.knowledge-skills__refusal")).toMatch(/color:\s*var\(--err\)/);
  });
});

describe("the learned-facts card (#419)", () => {
  it("strikes the expired row's text through in the faint ink — the mockup's `.fact.expired`", () => {
    const expired = rule("\\.knowledge-facts__row--expired \\.knowledge-facts__text,\\s*\\.knowledge-facts__row--expired \\.knowledge-facts__text code");

    expect(expired).toMatch(/text-decoration:\s*line-through/);
    expect(expired).toMatch(/color:\s*var\(--ink-faint\)/);
  });

  it("draws inline code in the mono face on the raised ground", () => {
    expect(rule("\\.knowledge-facts__text code")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.knowledge-facts__text code")).toMatch(/background:\s*var\(--raised\)/);
  });

  it("names the anchor change in the warn ink, and a refusal in the error ink", () => {
    expect(rule("\\.knowledge-facts__stale")).toMatch(/color:\s*var\(--warn\)/);
    expect(rule("\\.knowledge-facts__refusal")).toMatch(/color:\s*var\(--err\)/);
  });

  it("stacks a row on a narrow pane", () => {
    expect(CODE).toMatch(/@media \(max-width: [\d.]+rem\)\s*\{[^@]*\.knowledge-facts__row,[^{]*\{\s*flex-direction:\s*column;/);
  });
});

describe("the playbooks card and the repo profile (#420)", () => {
  it("draws the new-playbook tile with the mockup's dashed hairline in the muted ink", () => {
    expect(rule("\\.knowledge-playbooks__tile")).toMatch(/border:\s*1px dashed var\(--line-strong\)/);
    expect(rule("\\.knowledge-playbooks__tile")).toMatch(/color:\s*var\(--ink-mut\)/);
  });

  it("writes the run count and the queued note in the mono face at the faint size", () => {
    const runs = rule("\\.knowledge-playbooks__runs,\\s*\\.knowledge-playbooks__queued");

    expect(runs).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(runs).toMatch(/font-size:\s*var\(--t-2xs\)/);
  });

  it("sets the profile key's measure in rem — the mockup's 106px, scaled with the type", () => {
    expect(CODE).toMatch(/\.knowledge-profile__key\s*\{\s*flex:\s*none;\s*width:\s*[\d.]+rem/);
  });

  it("draws the environment block on the raised ground in the mono face, comments in the faint ink", () => {
    expect(rule("\\.knowledge-profile__code")).toMatch(/background:\s*var\(--raised\)/);
    expect(rule("\\.knowledge-profile__code")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.knowledge-profile__code-comment")).toMatch(/color:\s*var\(--ink-faint\)/);
  });

  it("tints the receipt with the accent triple and a candidate's caveat with the warn ink", () => {
    expect(rule("\\.knowledge-picker__receipt")).toMatch(/border:\s*1px solid var\(--accent-line\)/);
    expect(rule("\\.knowledge-picker__receipt")).toMatch(/background:\s*var\(--accent-tint\)/);
    expect(rule("\\.knowledge-picker__reason")).toMatch(/color:\s*var\(--warn\)/);
  });

  it("rings the snapshot dot rather than filling it — nothing was measured", () => {
    expect(rule("\\.knowledge-profile__snapshot-dot")).toMatch(/border:\s*1px solid var\(--ink-faint\)/);
    expect(rule("\\.knowledge-profile__snapshot-dot")).not.toMatch(/background/);
  });

  it("stacks the right column's rows on a narrow pane", () => {
    expect(CODE).toMatch(/@media \(max-width: [\d.]+rem\)\s*\{[^@]*\.knowledge-profile__row\s*\{\s*flex-direction:\s*column;/);
  });
});

describe("the scope card and the manifest preview (#421)", () => {
  it("draws a step as the mockup's well, and the current one in the accent triple", () => {
    expect(rule("\\.knowledge-scope__step")).toMatch(/border:\s*1px solid var\(--line\)/);
    expect(rule("\\.knowledge-scope__step")).toMatch(/background:\s*var\(--inset\)/);
    expect(rule("\\.knowledge-scope__step--current")).toMatch(/border-color:\s*var\(--accent-line\)/);
    expect(rule("\\.knowledge-scope__step--current")).toMatch(/background:\s*var\(--accent-tint\)/);
    expect(rule("\\.knowledge-scope__step--current \\.knowledge-scope__level")).toMatch(/color:\s*var\(--accent\)/);
  });

  it("draws the pressed step apart from the current one — the accent solid", () => {
    expect(rule('\\.knowledge-scope__step\\[aria-pressed="true"\\]')).toMatch(/border-color:\s*var\(--accent\)/);
  });

  it("sets the level's measure in rem — the mockup's 74px, scaled with the type", () => {
    expect(rule("\\.knowledge-scope__level")).toMatch(/width:\s*4\.625rem/);
    expect(rule("\\.knowledge-scope__level")).toMatch(/font-family:\s*var\(--f-mono\)/);
  });

  it("lets a step wrap rather than overflow, so a long repository name or the 125% scale cannot clip the count", () => {
    expect(rule("\\.knowledge-scope__step")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.knowledge-scope__name")).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("tints the trims with the warn triple — the one tinted block in the dialog", () => {
    expect(rule("\\.knowledge-preview__section--trimmed")).toMatch(/border:\s*1px solid var\(--warn-line\)/);
    expect(rule("\\.knowledge-preview__section--trimmed")).toMatch(/background:\s*var\(--warn-tint\)/);
  });

  it("writes an absent skill in the faint ink, a refusal in the error ink and an over-budget note in the warn ink", () => {
    expect(rule("\\.knowledge-preview__slug--absent")).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rule("\\.knowledge-preview__refusal")).toMatch(/color:\s*var\(--err\)/);
    expect(rule("\\.knowledge-preview__over")).toMatch(/color:\s*var\(--warn\)/);
  });
});

describe("the states (#422)", () => {
  it("draws a pending map and a failed one apart — in line, ground and hue, not in ink alone", () => {
    const pending = rule("\\.knowledge-maps__row");

    // One line a repository: the row centres its three parts rather than stacking a notice.
    expect(pending).toMatch(/align-items:\s*center/);
    const failed = rule("\\.knowledge-maps__row--failed");

    expect(pending).toMatch(/border:\s*1px dashed var\(--line-strong\)/);
    expect(pending).toMatch(/background:\s*var\(--inset\)/);
    expect(failed).toMatch(/border-style:\s*solid/);
    expect(failed).toMatch(/border-color:\s*var\(--err-line\)/);
    expect(failed).toMatch(/background:\s*var\(--err-tint\)/);
  });

  it("writes a generation's refusal in the error ink, and the pending note and an unread status in the faint one", () => {
    expect(rule("\\.knowledge-maps__refusal")).toMatch(/color:\s*var\(--err\)/);
    expect(rule("\\.knowledge-maps__note")).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rule("\\.knowledge-maps__unread")).toMatch(/color:\s*var\(--ink-faint\)/);
  });

  it("lets a long repository name wrap rather than push the chip out of its row at the 125% scale", () => {
    expect(rule("\\.knowledge-maps__repo")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule("\\.knowledge-maps__body")).toMatch(/min-width:\s*0/);
    expect(rule("\\.knowledge-maps__state")).toMatch(/flex-shrink:\s*0/);
  });

  it("stacks a map's row on a narrow pane", () => {
    expect(CODE).toMatch(/@media \(max-width: 40rem\) \{\s*\.knowledge-maps__row \{\s*flex-direction: column;/);
  });

  it("wraps an empty state's actions, so two buttons never overflow a narrow card", () => {
    expect(rule("\\.knowledge-empty__actions,\\s*\\.knowledge-unread__actions")).toMatch(/flex-wrap:\s*wrap/);
  });
});

describe("the repo profile's head at the 125% scale (#422)", () => {
  it("wraps, and lets the repository select shrink — a rigid head pushed the pane sideways", () => {
    expect(rule("\\.knowledge-profile__head")).toMatch(/flex-wrap:\s*wrap/);

    const select = rule("\\.knowledge-profile__select");

    expect(select).toMatch(/min-width:\s*0/);
    expect(select).toMatch(/max-width:\s*100%/);
    expect(select).not.toMatch(/min-width:\s*14rem/);
  });
});

describe("the skeleton (#422)", () => {
  it("sets the profile key's measure to the card's own, so the values line up where they will land", () => {
    expect(rule("\\.knowledge-skeleton__key")).toMatch(/width:\s*6\.625rem/);
    // The card's own rule, past the narrow-pane override that precedes it in the sheet.
    expect(CODE).toMatch(/\.knowledge-profile__key\s*\{\s*flex:\s*none;\s*width:\s*6\.625rem/);
  });

  it("separates rows with the hairline the cards use, and never animates a bar", () => {
    expect(rule("\\.knowledge-skeleton__row")).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
    expect(CODE).not.toMatch(/knowledge-skeleton[^{]*\{[^}]*animation/);
  });
});
