import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The properties of `app/models/models.css` that are agreements with something outside it.
 *
 * The generic rule — no colour literal anywhere but the token sheet — is
 * `__tests__/styles.test.ts`'s, and it covers this sheet as it covers every other. What is
 * here is narrower: the facts this sheet has to keep in step with the components that use it,
 * with the token sheet's contrast guarantees, and with the font-size preference, none of
 * which is visible from inside the file.
 *
 * **This is also where "verified in both themes" is actually verified.** jsdom applies no
 * stylesheet, so no render test in this module can read a computed colour, and one that
 * appeared to would be reading the default black under both palettes and passing for the
 * wrong reason (`__tests__/helpers/palettes.tsx` sets this out). What a render test *can*
 * prove is that the two palettes produce identical markup; what proves the palettes
 * themselves are legible is that every hue here is a published token, and both palettes
 * publish contrast for each of them against the surface it is drawn on.
 */

const UI = join(import.meta.dirname, "..", "..");
const SHEET = readFileSync(join(UI, "app", "models", "models.css"), "utf8");

/** The sheet without its prose, so a rule cannot be found inside a comment. */
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

describe("the page head", () => {
  it("lets the actions drop under the headings rather than crushing them", () => {
    // The mockup's `.page-head` at its own widths: a flex row that wraps, with the heading
    // column holding a floor so a three-sentence promise never wraps to one word a line
    // beside two buttons.
    expect(rule("\\.models__head")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.models__headings")).toMatch(/min-width:\s*[\d.]+rem/);
  });

  it("holds a measure on the subline, so the promise is a paragraph rather than a band", () => {
    expect(rule("\\.models__sub")).toMatch(/max-width:\s*\d+ch/);
  });

  it("zeroes the block margin a browser gives its paragraph", () => {
    // Added to the column's own rhythm rather than replaced by it, so an unzeroed `p` reads
    // as an uneven gap rather than as a missing rule.
    expect(rule("\\.models__sub")).toMatch(/margin:/);
  });
});

describe("the tab set's placement", () => {
  it("spans the pane rather than sitting inset from it", () => {
    // The row is sticky. Inset from the pane's edges it would leave two gutters that
    // scrolled content shows through — so the page's padding is undone as margin and
    // re-applied as padding, and the tabs still line up with the heading above them.
    expect(rule("\\.models__subnav")).toMatch(/margin:[^;]*calc\(var\(--sp-10\) \* -1\)/);
    expect(rule("\\.models__subnav")).toMatch(/padding:\s*0 var\(--sp-10\)/);
  });

  it("styles no primitive of the design system from here", () => {
    // Reaching into `.ou-*` from a page sheet would make a primitive mean something
    // different on one screen — a fork of the design system written where nobody would look
    // for it. A page places a primitive by passing its own class, never by restyling the
    // primitive's.
    expect(CODE).not.toContain(".ou-");
  });
});

describe("the health strip", () => {
  it("undoes the three defaults a browser gives the list it is built on", () => {
    // A `ul` carries a 40px inline start padding, a block margin and a bullet from the UA
    // sheet. The padding is also the one length here that would not follow the reader's
    // font-size preference, so it is undone rather than overridden with another px.
    expect(rule("\\.models-health")).toMatch(/margin:\s*0/);
    expect(rule("\\.models-health")).toMatch(/padding:\s*0/);
    expect(rule("\\.models-health")).toMatch(/list-style:\s*none/);
  });

  it("wraps rather than scrolling sideways", () => {
    // The number of providers a workspace has is small and knowable, and a strip that
    // scrolled would hide the very chip somebody is looking for.
    expect(rule("\\.models-health")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("defines a rule for every tone the strip can give a chip", () => {
    // `provider-strip.tsx` names these as class suffixes, so a tone with no rule behind it
    // is a chip that silently draws as the base treatment — which is the healthy one, on a
    // state that may be anything but.
    for (const tone of ["ok", "paused", "err", "unknown"]) {
      expect(CODE, tone).toMatch(new RegExp(`\\.models-health__chip--${tone}\\s*\\{[^}]*color:`));
    }
  });

  it("takes every hue from the palette's own status tokens", () => {
    // Both palettes publish contrast for these against the surface they sit on; a
    // hand-picked green would be legible in one theme and not the other.
    expect(rule("\\.models-health__chip--ok")).toMatch(/color:\s*var\(--ok\)/);
    expect(rule("\\.models-health__chip--err")).toMatch(/color:\s*var\(--err\)/);
    expect(rule("\\.models-health__chip--err")).toMatch(/border-color:\s*var\(--err-line\)/);
    expect(rule("\\.models-health__chip--err")).toMatch(/background:\s*var\(--err-tint\)/);
  });

  it("draws a failed check in the error hue rather than the mockup's amber", () => {
    // The correction this ticket records. `--warn` is *needs attention*; V015 defines
    // `error` as *the last check failed*, and drawing a failed check in amber would
    // under-report every real outage on this strip. The traffic-derived `degraded` state the
    // mockup imagined arrives with AB.2 (#208) and takes `--warn` when it does.
    expect(rule("\\.models-health__chip--err")).not.toMatch(/var\(--warn/);
  });
});

describe("the unknown chip, which is what this strip must not flatter", () => {
  it("is distinguishable from a healthy chip without colour vision", () => {
    // The ticket's second acceptance criterion, and the half a render test cannot reach.
    // Three signals and not one of them is a hue: a dashed boundary, a ringed dot, and the
    // word the component renders. That is what makes it hold in both palettes.
    expect(rule("\\.models-health__chip--unknown")).toMatch(/border-style:\s*dashed/);
    expect(rule("\\.models-health__dot--ring")).toMatch(/background:\s*transparent/);
    expect(rule("\\.models-health__dot--ring")).toMatch(/box-shadow:\s*inset[^;]*currentColor/);
  });

  it("is not merely a fainter version of the healthy chip", () => {
    // "Not a grey dot that reads as green in a hurry": the two differ in the boundary's
    // style and the chip's ground, not only in how loud they are.
    expect(rule("\\.models-health__chip--unknown")).toMatch(/background:\s*var\(--inset\)/);
    expect(rule("\\.models-health__chip")).toMatch(/background:\s*var\(--surface\)/);
  });

  it("recedes by surface rather than by opacity", () => {
    // Every contrast pair the token sheet publishes is measured against a surface, and a
    // translucent layer is not one of them — the rule `EmptyState` is built on.
    expect(rule("\\.models-health__chip--unknown")).not.toMatch(/opacity/);
  });
});

describe("the dot", () => {
  it("takes its colour from the chip, so the two cannot report different states", () => {
    expect(rule("\\.models-health__dot")).toMatch(/background:\s*currentColor/);
  });

  it("keeps its size on a spacing token, so it grows with the type around it", () => {
    expect(rule("\\.models-health__dot")).toMatch(/width:\s*var\(--sp-/);
    expect(rule("\\.models-health__dot")).toMatch(/height:\s*var\(--sp-/);
  });
});

describe("what the strip says when it has no chips", () => {
  it("marks a failed read as a failure rather than as an empty workspace", () => {
    // The same treatment the dashboard's failed subline takes, for the same reason: "nothing
    // is connected" and "nobody could ask" must not look alike.
    expect(CODE).toMatch(/\.models-health__note--failed[^{]*\{[^}]*color:\s*var\(--err\)/);
  });

  it("occupies the strip's own place, so the page below does not move", () => {
    expect(rule("\\.models-health__note")).toMatch(/margin:\s*0 0 var\(--sp-9\)/);
    expect(rule("\\.models-health")).toMatch(/margin:\s*0 0 var\(--sp-9\)/);
  });
});

describe("the routing matrix", () => {
  it("lays the matrix and the inspector out on the mockup's twelve columns", () => {
    expect(rule("\\.models-grid")).toMatch(/grid-template-columns:\s*repeat\(12,/);
    expect(rule("\\.models-col--8")).toMatch(/grid-column:\s*span 8/);
    expect(rule("\\.models-col--4")).toMatch(/grid-column:\s*span 4/);
  });

  it("floors each column's track at zero, so a wide table never widens the pane", () => {
    // A grid track's default minimum is `auto` — the widest thing inside it — so a table wide
    // enough to need its wrapper's scroll would push the column wider instead and start the
    // whole pane scrolling sideways, which § 1.3 forbids.
    expect(rule("\\.models-grid")).toMatch(/minmax\(0,/);
  });

  it("stacks the two cards at the dashboard's own break rather than at a new one", () => {
    // Two module pages in one product should not break to one column at two different windows.
    expect(CODE).toMatch(/@media \(max-width: 68\.75rem\)/);
  });

  it("sets the column widths on the column rather than on the cells", () => {
    // The primitive's per-column class exists for exactly this: a width written into a `td`
    // would leave the `th` above it free to disagree.
    expect(rule("\\.models-matrix__handle")).toMatch(/width:\s*[\d.]+rem/);
    expect(rule("\\.models-matrix__num")).toMatch(/width:\s*[\d.]+rem/);
  });

  it("gives both numeric columns one width, so a dash and a figure take the same room", () => {
    // "Alignment holds whether the cell has a number or a dash" — the two columns share one
    // rule, so they cannot come to differ.
    expect(CODE).toMatch(/\.models-matrix__num\s*\{/);
    expect(CODE).not.toMatch(/\.models-matrix__cost\s*\{/);
  });

  it("draws the matrix's ⠿ as the press it is, and the hop's ⠿ as the drag it is (#202)", () => {
    // The row's handle opens the editor; the hop's handle is dragged. Each says so with its
    // cursor, and neither borrows the other's.
    expect(rule("\\.models-matrix__edit")).toMatch(/cursor:\s*pointer/);
    expect(rule("\\.models-matrix__edit")).not.toMatch(/grab/);
    expect(rule("\\.models-chain__handle")).toMatch(/cursor:\s*grab/);
    expect(rule("\\.models-chain__handle:active")).toMatch(/cursor:\s*grabbing/);
  });

  it("resets the shortcut button to its glyph, so the gutter stays the mockup's", () => {
    expect(rule("\\.models-matrix__edit")).toMatch(/border:\s*0/);
    expect(rule("\\.models-matrix__edit")).toMatch(/background:\s*transparent/);
    expect(rule("\\.models-matrix__edit")).toMatch(/font:\s*inherit/);
  });

  it("prints what the server refused about a row in the error hue", () => {
    expect(rule("\\.models-matrix__problems")).toMatch(/color:\s*var\(--err\)/);
    expect(rule("\\.models-matrix__problems")).toMatch(/list-style:\s*none/);
  });

  it("keeps the empty cell's em-dash on the page's faint ink rather than hiding it", () => {
    // Half this matrix's cells can legitimately be empty, so the em-dash is the ordinary case
    // and is styled as one — not as an error, and not as something to be squinted at.
    expect(rule("\\.models-matrix__none")).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rule("\\.models-matrix__none")).not.toMatch(/display:\s*none|opacity/);
  });

  it("draws both derived lines in mono, because every part of them is a value", () => {
    expect(rule("\\.models-matrix__resolution")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.models-matrix__rule")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.models-matrix__kind")).toMatch(/font-family:\s*var\(--f-mono\)/);
  });

  it("undoes the list defaults the escalation cell is built on", () => {
    expect(rule("\\.models-matrix__rules")).toMatch(/margin:\s*0/);
    expect(rule("\\.models-matrix__rules")).toMatch(/padding:\s*0/);
    expect(rule("\\.models-matrix__rules")).toMatch(/list-style:\s*none/);
  });

  it("lets a long resolution line wrap rather than clipping the tail that identifies it", () => {
    // `text-overflow` would hide exactly the suffix that distinguishes two versions of one
    // model.
    expect(rule("\\.models-matrix__resolution")).not.toMatch(/text-overflow|white-space:\s*nowrap/);
  });
});

describe("the states and guards (#205)", () => {
  it("draws the strip's link in the accent, from the token, and underlines it on hover", () => {
    expect(rule("\\.models-health__link")).toMatch(/color:\s*var\(--accent\)/);
    expect(CODE).toMatch(/\.models-health__link:hover[^{]*\{[^}]*text-decoration:\s*underline/);
  });

  it("puts the read-only note and the failed banner in the strip's own rhythm, so the strip does not move", () => {
    // Both stand above the strip; both take its bottom margin, so a member's page and an
    // owner's page — and a failed read's page — put the chips on the same line.
    expect(rule("\\.models-readonly")).toMatch(/margin:\s*0 0 var\(--sp-9\)/);
    expect(rule("\\.models-failed")).toMatch(/margin:\s*0 0 var\(--sp-9\)/);
  });

  it("styles the banner's box nowhere here — it is the primitive's", () => {
    expect(rule("\\.models-failed")).not.toMatch(/border|background|color/);
  });

  it("keeps the read-only note's head on a named ink token, and its body on the muted one", () => {
    expect(rule("\\.models-readonly__head")).toMatch(/color:\s*var\(--ink-dim\)/);
    expect(rule("\\.models-readonly")).toMatch(/color:\s*var\(--ink-mut\)/);
  });
});

describe("the guidance card (#205)", () => {
  it("undoes the three defaults a browser gives the list it is built on", () => {
    const list = rule("\\.models-foundations");

    expect(list).toMatch(/list-style:\s*none/);
    expect(list).toMatch(/padding:\s*0/);
    expect(list).toMatch(/margin:/);
  });

  it("gives the done and next steps their hue from the published triples, and the unknown step a dashed ring", () => {
    // Done is the ok triple, next is the page's own model triple, and unknown is a shape (M8)
    // rather than a fifth hue — the same convention the strip keeps for an unmeasured state.
    expect(CODE).toMatch(/\.models-foundations__step--done \.models-foundations__mark\s*\{[^}]*border-color:\s*var\(--ok-line\)/);
    expect(CODE).toMatch(/\.models-foundations__step--done \.models-foundations__mark\s*\{[^}]*color:\s*var\(--ok\)/);
    expect(CODE).toMatch(/\.models-foundations__step--current \.models-foundations__mark\s*\{[^}]*border-color:\s*var\(--model-line\)/);
    expect(CODE).toMatch(/\.models-foundations__step--current \.models-foundations__mark\s*\{[^}]*color:\s*var\(--model\)/);
    expect(CODE).toMatch(/\.models-foundations__step--unknown \.models-foundations__mark\s*\{[^}]*border-style:\s*dashed/);
  });

  it("lets a step's note wrap inside the step rather than widening the card", () => {
    expect(rule("\\.models-foundations__body")).toMatch(/min-width:\s*0/);
    expect(rule("\\.models-foundations__note")).toMatch(/max-width:\s*\d+ch/);
  });

  it("lets the title and the state's word wrap at the narrow end", () => {
    expect(rule("\\.models-foundations__title")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("rules the development note off from the path with a hairline", () => {
    expect(rule("\\.models-foundations__dev")).toMatch(/border-block-start:\s*1px solid var\(--line\)/);
    expect(rule("\\.models-foundations__dev")).toMatch(/color:\s*var\(--ink-faint\)/);
  });
});

describe("the loading skeleton (#205)", () => {
  it("mirrors the strip's margin, so the grid starts on the same line before and after the data", () => {
    expect(rule("\\.models-skeleton__strip")).toMatch(/margin:\s*0 0 var\(--sp-9\)/);
    expect(rule("\\.models-skeleton__strip")).toMatch(/gap:\s*var\(--sp-5\)/);
  });

  it("mirrors the card head's height and its bottom margin", () => {
    // `.ou-card__head` has `margin-bottom: var(--sp-7)`, so a card's body starts in the same
    // place whether it is drawn as a skeleton or as itself.
    expect(rule("\\.models-skeleton__head")).toMatch(/margin-bottom:\s*var\(--sp-7\)/);
  });

  it("rules the matrix's rows off at the table's own cell padding", () => {
    expect(rule("\\.models-skeleton__row")).toMatch(/padding:\s*var\(--sp-6\) 0/);
    expect(rule("\\.models-skeleton__row")).toMatch(/border-block-end:\s*1px solid var\(--line\)/);
    expect(rule("\\.models-skeleton__row:last-child")).toMatch(/border-block-end:\s*none/);
  });

  it("gives the numeric cells the matrix's own column width", () => {
    // `.models-matrix__num` is 6rem; a skeleton row that reserved a different width would
    // move the whole table's columns when the data lands.
    expect(rule("\\.models-skeleton__row")).toMatch(/6rem 6rem/);
    expect(rule("\\.models-matrix__num")).toMatch(/width:\s*6rem/);
  });

  it("reserves the inspector's seat at the empty state's own floor and well", () => {
    // `.ou-empty--fill` is `min-height: 8rem` on the `--inset` well behind a dashed line.
    expect(rule("\\.models-skeleton__panel")).toMatch(/min-height:\s*8rem/);
    expect(rule("\\.models-skeleton__panel")).toMatch(/border:\s*1px dashed var\(--line-strong\)/);
    expect(rule("\\.models-skeleton__panel")).toMatch(/background:\s*var\(--inset\)/);
  });

  it("rules the rules card's rows at the card's own padding, and meters the spend card at the meter's own height", () => {
    expect(rule("\\.models-skeleton__rule")).toMatch(/padding:\s*var\(--sp-5\) 0/);
    expect(rule("\\.models-skeleton__meter")).toMatch(/height:\s*var\(--sp-3\)/);
  });

  it("names every length in rem, a token or a ratio, so it scales with the type", () => {
    // A skeleton pinned in px would reserve the right height at one font size and the wrong
    // one at every other — which is the whole failure it exists to prevent.
    const block = CODE.slice(CODE.indexOf(".models-skeleton"));

    for (const [, value] of block.matchAll(/(?:height|width):\s*([^;]+);/g)) {
      expect(value.trim()).toMatch(/^(var\(--|[\d.]+rem|100%|\d+%|auto|1px)/);
    }
  });

  it("moves only for a reader who has not asked for less motion, and pulses opacity only", () => {
    const guard = CODE.indexOf("@media (prefers-reduced-motion: no-preference)");
    const animated = CODE.indexOf("animation:");

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(animated).toBeGreaterThan(guard);

    const frames = /@keyframes models-skeleton-pulse\s*\{([\s\S]*?)\n\}/.exec(CODE);

    expect(frames).not.toBeNull();
    expect(frames?.[1]).toMatch(/opacity/);
    expect(frames?.[1]).not.toMatch(/transform|width|height|margin/);
  });

  it("animates every shape the skeleton draws, not only the plain bar", () => {
    const guarded = /@media \(prefers-reduced-motion: no-preference\)\s*\{([\s\S]*?)\n\}/.exec(CODE);

    for (const shape of ["__action", "__chip", "__head", "__bar", "__pill", "__panel", "__switch", "__meter"]) {
      expect(guarded?.[1], `${shape} does not pulse`).toContain(`.models-skeleton${shape}`);
    }
  });
});

describe("the type scale", () => {
  it("names no font size in px, so the reader's preference scales every surface", () => {
    // Design system § 3.2: all type is rem-based, from one root change. A px font size is
    // the one length that would refuse to move with it.
    expect(CODE).not.toMatch(/font-size:\s*[\d.]+px/);
  });

  it("takes every font size from the sheet rather than inventing one", () => {
    for (const [, value] of CODE.matchAll(/font-size:\s*([^;]+);/g)) {
      expect(value.trim()).toMatch(/^var\(--t-/);
    }
  });

  it("keeps every other length on a token, a rem or a ratio, hairlines excepted", () => {
    // A px length is a length the font-size preference cannot move. Borders and shadow
    // spreads are the deliberate exception: a hairline that grows with the type is a
    // different hairline.
    for (const [declaration] of CODE.matchAll(/[\w-]+:[^;{}]*?\b[\d.]+px/g)) {
      expect(declaration).toMatch(/^(?:border|box-shadow|outline)/);
    }
  });
});

describe("the right column (#204)", () => {
  it("is a flex column, so three cards stack under one another beside the matrix", () => {
    // Three `span 4` grid items would each take the next grid row and land the second one
    // under the matrix rather than under the inspector.
    expect(rule("\\.models-aside")).toMatch(/display:\s*flex/);
    expect(rule("\\.models-aside")).toMatch(/flex-direction:\s*column/);
    expect(rule("\\.models-aside")).toMatch(/min-width:\s*0/);
  });
});

describe("the rules card", () => {
  it("undoes the three defaults a browser gives the list it is built on", () => {
    expect(rule("\\.models-rules")).toMatch(/margin:\s*0/);
    expect(rule("\\.models-rules")).toMatch(/padding:\s*0/);
    expect(rule("\\.models-rules")).toMatch(/list-style:\s*none/);
  });

  it("draws the alias in the model hue, from the token and not a literal", () => {
    expect(rule("\\.models-rules__alias")).toMatch(/color:\s*var\(--model\)/);
  });

  it("sets the sentence in the data face, and lets it wrap rather than crush the switch", () => {
    expect(rule("\\.models-rules__sentence")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.models-rules__sentence")).toMatch(/min-width:\s*0/);
    expect(rule("\\.models-rules__sentence")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule("\\.models-rules__controls")).toMatch(/flex:\s*none/);
  });

  it("recedes a suspended rule by hue, which is never its only signal", () => {
    // The position is carried by the switch's aria-checked, or by the word *off* for a
    // member — the hue is a second signal.
    expect(rule("\\.models-rules__row--off \\.models-rules__sentence,\\s*\\.models-rules__row--off \\.models-rules__alias")).toMatch(
      /color:\s*var\(--ink-faint\)/,
    );
  });

  it("draws a failed write in the error hue", () => {
    expect(rule("\\.models-rules__note")).toMatch(/color:\s*var\(--err\)/);
    expect(rule("\\.models-builder__failure")).toMatch(/color:\s*var\(--err\)/);
  });
});

describe("the rule builder", () => {
  it("undoes the fieldset chrome, so the grouping is semantic rather than drawn", () => {
    expect(rule("\\.models-builder__group")).toMatch(/border:\s*none/);
    expect(rule("\\.models-builder__group")).toMatch(/padding:\s*0/);
    expect(rule("\\.models-builder__group")).toMatch(/margin:\s*0/);
  });

  it("lets the dialog's controls wrap rather than overflow the panel", () => {
    expect(rule("\\.models-builder__actions")).toMatch(/flex-wrap:\s*wrap/);
  });
});

describe("the spend card", () => {
  it("undoes the three defaults a browser gives the list it is built on", () => {
    expect(rule("\\.models-spend")).toMatch(/margin:\s*0/);
    expect(rule("\\.models-spend")).toMatch(/padding:\s*0/);
    expect(rule("\\.models-spend")).toMatch(/list-style:\s*none/);
  });

  it("keeps a figure inside the card at 150% font scale, the way the pulse rows do (#650)", () => {
    expect(rule("\\.models-spend__line")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.models-spend__name")).toMatch(/min-width:\s*0/);
  });

  it("sets the amount in the data face and the full ink", () => {
    expect(rule("\\.models-spend__amount")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.models-spend__amount")).toMatch(/color:\s*var\(--ink\)/);
  });

  it("tells the unpriced state apart from $0.00 by shape, not only by hue", () => {
    // A dashed underline on the word and a dashed track where the meter would be: a reader
    // with no colour vision still sees a different picture.
    expect(rule("\\.models-spend__unpriced")).toMatch(/text-decoration:\s*underline dashed/);
    expect(rule("\\.models-spend__unpriced")).not.toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.models-spend__track--unpriced")).toMatch(/border:\s*1px dashed var\(--line-strong\)/);
    expect(rule("\\.models-spend__track--unpriced")).toMatch(/height:\s*var\(--sp-3\)/);
  });

  it("sizes every spacing and type length in tokens or rem, so the cards follow the font-size preference", () => {
    // Hairlines stay `1px` — a border is not a length that should scale — so the check is on
    // the properties that should.
    const section = CODE.slice(CODE.indexOf(".models-aside"));

    expect(section).not.toMatch(/(?:font-size|padding|margin|gap|height|width|inset|top|left):\s*[^;]*\d+px\b/);
  });
});

describe("the chain (#202)", () => {
  it("undoes the list defaults the rail is built on", () => {
    expect(rule("\\.models-chain")).toMatch(/margin:\s*0/);
    expect(rule("\\.models-chain")).toMatch(/padding:\s*0/);
    expect(rule("\\.models-chain")).toMatch(/list-style:\s*none/);
  });

  it("draws the ring in the model hue's own pair, so it agrees with the primary's pill", () => {
    expect(rule("\\.models-chain__idx")).toMatch(/border:\s*1px solid var\(--model-line\)/);
    expect(rule("\\.models-chain__idx")).toMatch(/background:\s*var\(--model-tint\)/);
    expect(rule("\\.models-chain__idx")).toMatch(/color:\s*var\(--model\)/);
    expect(rule("\\.models-chain__idx")).toMatch(/border-radius:\s*var\(--r-round\)/);
  });

  it("draws the line between rings as a hairline border, not a px-wide box", () => {
    expect(rule("\\.models-chain__line")).toMatch(/border-inline-start:\s*1px solid/);
    expect(rule("\\.models-chain__line")).toMatch(/width:\s*0/);
  });

  it("marks a drop target by shape rather than by hue alone, and never by opacity", () => {
    expect(rule("\\.models-chain__hop--over")).toMatch(/outline:\s*1px dashed/);
    expect(CODE).not.toMatch(/models-chain[^{]*\{[^}]*opacity/);
  });

  it("resets the swap trigger to its content, so the pill inside it is the matrix's pill", () => {
    expect(rule("\\.models-chain__swap")).toMatch(/border:\s*0/);
    expect(rule("\\.models-chain__swap")).toMatch(/background:\s*transparent/);
    expect(rule("\\.models-chain__swap")).toMatch(/font:\s*inherit/);
  });

  it("keeps the menu above the page and below the shell's chrome", () => {
    // app/ui/chrome.ts owns the shell's ladder (menus at 60, overlays at 80); a page menu
    // that covered the sticky subnav would be a page menu covering the shell.
    expect(rule("\\.models-chain__menu")).toMatch(/z-index:\s*20/);
    expect(rule("\\.models-chain__menu")).toMatch(/overflow-y:\s*auto/);
  });

  it("marks the current alias in the menu the way the selected row is marked", () => {
    expect(rule('\\.models-chain__option\\[aria-checked="true"\\]')).toMatch(/box-shadow:\s*inset[^;]*var\(--model\)/);
  });

  it("prints a blocked removal's reason as a rule, not as a failure", () => {
    expect(rule("\\.models-chain__blocked")).toMatch(/color:\s*var\(--ink-mut\)/);
    expect(rule("\\.models-chain__problems")).toMatch(/color:\s*var\(--err\)/);
  });
});

describe("the inspector's health dots (#203)", () => {
  it("takes every dot's colour from the tone modifier, so the dot and its class cannot disagree", () => {
    expect(rule("\\.models-chain__dot")).toMatch(/background:\s*currentColor/);
    expect(rule("\\.models-chain__dot")).toMatch(/border-radius:\s*var\(--r-round\)/);
  });

  it("defines a rule for every tone the strip can give a connection, from the status tokens", () => {
    expect(rule("\\.models-chain__dot--ok")).toMatch(/color:\s*var\(--ok\)/);
    expect(rule("\\.models-chain__dot--err")).toMatch(/color:\s*var\(--err\)/);
    expect(rule("\\.models-chain__dot--paused")).toMatch(/color:\s*var\(--ink-mut\)/);
    expect(rule("\\.models-chain__dot--unknown")).toMatch(/color:\s*var\(--ink-faint\)/);
    expect(rule("\\.models-chain__dot--err")).not.toMatch(/var\(--warn/);
  });

  it("draws the unreported state as a ring, distinguishable from a disc without colour (M8)", () => {
    expect(rule("\\.models-chain__dot--ring")).toMatch(/background:\s*transparent/);
    expect(rule("\\.models-chain__dot--ring")).toMatch(/box-shadow:\s*inset[^;]*currentColor/);
  });
});

describe("the policy controls (#203)", () => {
  it("divides the policy from the chain with a hairline, as the mockup's divider does", () => {
    expect(rule("\\.models-policy")).toMatch(/border-block-start:\s*1px solid var\(--line\)/);
  });

  it("lets the sentence wrap and keeps the switch its size", () => {
    expect(rule("\\.models-policy__row")).toMatch(/justify-content:\s*space-between/);
    expect(rule("\\.models-policy__label")).toMatch(/min-width:\s*0/);
  });

  it("sets the floor's number in the data face, inside its sentence", () => {
    expect(rule("\\.models-policy__hop")).toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(rule("\\.models-policy__hop")).toMatch(/font:\s*inherit/);
  });

  it("gives the cost field the mockup's measure, in rem", () => {
    expect(rule("\\.models-policy__cost")).toMatch(/max-width:\s*[\d.]+rem/);
  });

  it("draws the footnote's link in the accent, from the token", () => {
    expect(rule("\\.models-policy__link")).toMatch(/color:\s*var\(--accent\)/);
  });
});

describe("the simulate panel (#203)", () => {
  it("lays the inputs out on a grid that reflows, so the panel holds at the 125% font-scale step", () => {
    expect(rule("\\.models-simulate__fields")).toMatch(/repeat\(auto-fit, minmax\([\d.]+rem, 1fr\)\)/);
  });

  it("marks a dropped hop by shape and word — a strike and the error hue on the word — never by hue alone", () => {
    expect(rule("\\.models-simulate__hop--dropped \\.models-simulate__resolution")).toMatch(/text-decoration:\s*line-through/);
    expect(rule("\\.models-simulate__hop--dropped \\.models-simulate__decision")).toMatch(/color:\s*var\(--err\)/);
  });

  it("draws a fail_run's reason as an answer, in the full ink, and a refused question in the error hue", () => {
    // A `fail_run` is the outcome the floor exists to produce, not a failure of the panel.
    expect(rule("\\.models-simulate__failure")).toMatch(/color:\s*var\(--ink\)/);
    expect(rule("\\.models-simulate__failure")).not.toMatch(/var\(--err\)/);
    expect(rule("\\.models-simulate__refused")).toMatch(/color:\s*var\(--err\)/);
  });

  it("undoes the list defaults the chain, the rules and the votes are built on", () => {
    const lists = rule("\\.models-simulate__chain,\\s*\\.models-simulate__rules,\\s*\\.models-simulate__votes");

    expect(lists).toMatch(/margin:\s*0/);
    expect(lists).toMatch(/padding:\s*0/);
    expect(lists).toMatch(/list-style:\s*none/);
  });

  it("lets every sentence wrap rather than widen the panel", () => {
    expect(rule("\\.models-simulate__explanation")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule("\\.models-simulate__sentence")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule("\\.models-simulate__resolution")).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe("the dirty-state bar (#202)", () => {
  it("spans the pane the way the tab set does, so the two stick as one stack", () => {
    expect(rule("\\.models \\.models-dirty")).toMatch(/margin:[^;]*calc\(var\(--sp-10\) \* -1\)/);
    expect(rule("\\.models \\.models-dirty")).toMatch(/padding-left:\s*var\(--sp-10\)/);
  });

  it("styles no primitive of the design system — the bar's ground and rim are the primitive's", () => {
    expect(rule("\\.models \\.models-dirty")).not.toMatch(/background|border-color|box-shadow/);
  });

  it("draws a failed save in the error hue, on its own line", () => {
    expect(rule("\\.models-dirty__failure")).toMatch(/color:\s*var\(--err\)/);
    expect(rule("\\.models-dirty__failure")).toMatch(/flex-basis:\s*100%/);
  });
});
