/**
 * The readability bar, as a roster and four probes
 * ([#650](https://github.com/NobuData/ouroboros/issues/650), CQ.3 of
 * `docs/ROADMAP_UIUX_APP_SHELL.md`).
 *
 * `docs/DESIGN_SYSTEM_APP_SHELL.md` § 4 ends with a QA bar rather than a promise:
 *
 * > At 150%: no clipped labels, no overlapping chrome, tables degrade to horizontal scroll
 * > in their wrappers; screenshot matrix (scale × theme × key pages) in CI.
 *
 * Five scales, two themes and a dozen dense pages is a surface nobody opens by hand, and
 * the combination that breaks is always the one that was not opened. Worse, **clipping
 * hides**: text cut off by its container looks, in a screenshot review, like a sentence
 * that ended. Catching it needs a measurement — scroll size against client size — not a
 * pair of eyes. So the bar is four functions here, driven per page and per theme by
 * `specs/readability.spec.ts`.
 *
 * ## The roster, and the four pages that are not built yet
 *
 * The issue names five representative dense pages: the routing matrix, the model registry
 * table, the research brief, the dashboard and settings. **One of the five exists.** The
 * other four arrive with their own mockup roadmaps, each behind its own issue, and
 * building them here would be four roadmaps' work done under a QA ticket.
 *
 * What this module does instead is what the suite already does for the sidebar's eleven
 * entries and for `verify-failure-modes.sh`'s parked pairs: **register the whole list, run
 * what exists, and assert that the rest is still genuinely missing.** {@link MATRIX_PAGES}
 * is what the matrix photographs today; {@link AWAITED_PAGES} is what it is waiting for,
 * and `specs/readability.spec.ts` walks that list requiring each route to still answer
 * `404`. The day one of them lands, this suite goes red naming the page to move across —
 * which is a better reminder than a comment, and the reason there is no `test.fixme` in
 * this leg.
 *
 * The stand-in is deliberate rather than a coincidence: `/workshop/chrome` draws
 * forty-eight synthetic routing rows under the whole CP.4 sticky stack, which is precisely
 * the shape of the routing matrix the issue names — and it is the only built page carrying
 * a subnav, a sticky bar and a sticky table header at once, so it is the only page on which
 * the overlapping-chrome probe has three layers to compare.
 */

import { expect, type Page } from "@playwright/test";

import { type ColourSample, describe, measure } from "./contrast";
import { settle } from "./settle";
import { PANE_SELECTOR } from "./shell";
import type { FontScale } from "./settings";

/**
 * The three scales the matrix photographs.
 *
 * Three of § 4's five, and the issue's own choice: 100% is the baseline every other
 * comparison is against, 150% is the extreme the QA bar is written about, and 125% is the
 * step in between that catches a layout which degrades gradually rather than all at once.
 * The two that are left out — 87.5% and 112.5% — cannot break a layout that holds at 150%
 * for the reason 150% breaks it, and paying for them would put the matrix over its budget
 * for no bit of information.
 */
export const MATRIX_SCALES: readonly FontScale[] = ["100", "125", "150"];

/** The scale the audit runs at — the one § 4's QA bar is written about. */
export const AUDIT_SCALE: FontScale = "150";

/** A page the matrix photographs and audits. */
export interface MatrixPage {
  /** Short identifier, and the first half of every screenshot's name. */
  readonly key: string;
  /** What it is, in a test title. */
  readonly label: string;
  /** Its route. */
  readonly route: string;
  /** The `<h1>` that says the page arrived and React has hydrated. */
  readonly heading: RegExp;
  /**
   * Whether the page stacks CP.4's in-pane chrome — a `PageSubnav`, a `StickyBar` and a
   * sticky table header, all against the pane. Only such a page has three layers for
   * {@link expectNoOverlappingChrome} to compare, and declaring it here is what stops that
   * probe from passing on a page that simply has no chrome.
   */
  readonly stickyStack: boolean;
  /** Anything a reader of a failure needs to know about why this page is in the roster. */
  readonly note?: string;
}

/**
 * The dense pages the matrix runs over today.
 *
 * Two, and the roster is written so a third joins by adding a line — the same shape as
 * `IN_SHELL_ROUTES` in `specs/shell-nav.spec.ts`, and for the same reason.
 */
export const MATRIX_PAGES: readonly MatrixPage[] = [
  {
    key: "dashboard",
    label: "the dashboard",
    route: "/dashboard",
    // The greeting is client-rendered from the reader's own clock, so waiting for it is
    // also waiting for hydration.
    heading: /^Good (morning|afternoon|evening), /,
    stickyStack: false,
  },
  {
    key: "chrome",
    label: "the in-pane chrome story",
    route: "/workshop/chrome",
    heading: /^In-pane chrome$/,
    stickyStack: true,
    note:
      "Standing in for the routing matrix (#201) until it is built: forty-eight dense " +
      "rows under a subnav, a sticky bar and a sticky table header.",
  },
];

/** A page the roster is waiting for, and the issue that will build it. */
export interface AwaitedPage {
  /** What it is. */
  readonly label: string;
  /** The route it will answer on. */
  readonly route: string;
  /** The issue that builds it, as a sentence a failure can print. */
  readonly awaits: string;
}

/**
 * The four pages of the issue's five that do not exist yet.
 *
 * Each is asserted *absent* rather than skipped, so this roster cannot rot: the run goes
 * red on the day the route starts answering, naming the page to move into
 * {@link MATRIX_PAGES}.
 */
export const AWAITED_PAGES: readonly AwaitedPage[] = [
  {
    label: "the routing matrix",
    route: "/models",
    awaits: "#200 mounts the route and #201 draws the matrix (mockup 06, AA.1–AA.2)",
  },
  {
    label: "the model registry table",
    route: "/models/registry",
    awaits: "#591 mounts the route and #592 draws the table (mockup 21, CI.1–CI.2)",
  },
  {
    label: "the research brief",
    route: "/research",
    awaits: "#627 mounts the route (mockup 22, CN.1)",
  },
  {
    label: "settings",
    route: "/settings",
    awaits: "#491 mounts the route and its section nav (mockup 17, BS.1)",
  },
];

/**
 * How far apart two boxes may be before the difference is a layout fact rather than
 * sub-pixel arithmetic, in CSS pixels.
 *
 * One pixel, which is a hairline border: the chrome's layers meet edge to edge by
 * construction (`app/ui/chrome.ts` publishes each layer's measured height to the next), so
 * anything larger than a rounding error between them is a real gap or a real overlap.
 */
const EPSILON = 1;

/**
 * Wait for the page's geometry to stop moving, and say what it settled at.
 *
 * Every probe below measures a box, and a page that is still laying out gives a different
 * answer every frame: a dashboard read on arrival briefly overflows its pane by twenty-odd
 * pixels, which the containment probe would report as the § 1.3 violation it is not.
 * `support/settle.ts` argues the rule; this is the fingerprint it watches — the pane's own
 * scroll metrics, the frame around it, and how many elements there are, which together move
 * whenever anything below them does.
 *
 * Called once, by the audit's `beforeEach`, so the three geometric probes that follow share
 * one wait rather than each paying for their own.
 *
 * @param page - The page, inside the shell and claiming to be ready.
 * @returns When two consecutive readings agree.
 */
export async function settleLayout(page: Page): Promise<void> {
  await settle(
    () =>
      page.evaluate((paneSelector) => {
        const box = (selector: string) => {
          const element = document.querySelector(selector);
          if (element === null) return null;
          const { x, y, width, height } = element.getBoundingClientRect();
          return [x, y, width, height];
        };

        const pane = document.querySelector<HTMLElement>(paneSelector);

        return {
          pane:
            pane === null
              ? null
              : [pane.scrollWidth, pane.clientWidth, pane.scrollHeight, pane.clientHeight],
          frame: [box("header.shell-header"), box("nav#shell-sidebar"), box(paneSelector)],
          elements: document.querySelectorAll("*").length,
        };
      }, PANE_SELECTOR),
    "the page's layout",
  );
}

/**
 * Put the in-pane chrome into the state it is asserted in: scrolled past the sticky table
 * so all three layers are actually stuck.
 *
 * A stack measured at rest proves nothing — the layers are in flow, in order, because the
 * markup put them in that order. What the contract promises is that they stay in order
 * *while stuck*, each offset by the measured height of the one above, at every font scale.
 * So the pane is driven until the table's own top edge has passed above it, which is the
 * condition under which its header can only be where it is by sticking.
 *
 * @param page - The page, already inside the shell on a route with the stack.
 * @returns When the pane reports the requested position.
 * @throws {Error} Through its assertions, if the page has no sticky table to scroll past —
 *   which would make everything measured afterwards vacuous.
 */
async function stickChromeStack(page: Page): Promise<void> {
  const target = await page.evaluate((paneSelector) => {
    const pane = document.querySelector<HTMLElement>(paneSelector);
    const table = document.querySelector<HTMLElement>(".ou-table--sticky");
    if (pane === null || table === null) return null;

    // Two hundred pixels past the table's first row, so the head row is provably stuck
    // rather than merely still in its flow position.
    const offset = table.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    return Math.round(pane.scrollTop + offset + 200);
  }, PANE_SELECTOR);

  expect(
    target,
    "the page declares a sticky chrome stack, so it must carry a sticky table to scroll past",
  ).not.toBeNull();

  const pane = page.locator(PANE_SELECTOR);
  await pane.evaluate((element, to) => element.scrollTo(0, to), target ?? 0);
  await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBe(target);
}

/** One measured layer of chrome, flattened for comparison. */
interface Layer {
  /** What it is, for the failure message. */
  readonly what: string;
  /** Its top edge, in viewport coordinates. */
  readonly top: number;
  /** Its bottom edge. */
  readonly bottom: number;
  /** Its leading edge. */
  readonly left: number;
  /** Its trailing edge. */
  readonly right: number;
}

/**
 * Measure the chrome the page actually stacks against the pane.
 *
 * "Against the pane" is the qualifier that matters, and it is computed rather than
 * assumed: an element sticks within its *nearest scrolling ancestor*, so the story page's
 * second subnav — which lives in a scrollport of its own, on purpose — is not part of the
 * pane's stack and must not be compared with it.
 *
 * @param page - The page, inside the shell.
 * @returns The shell frame's three boxes and whichever of the three in-pane layers exist.
 */
async function chromeLayers(page: Page): Promise<{
  frame: { header: Layer | null; sidebar: Layer | null; pane: Layer | null };
  stack: { subnav: Layer | null; bar: Layer | null; tableHeader: Layer | null };
}> {
  return page.evaluate((paneSelector) => {
    const pane = document.querySelector<HTMLElement>(paneSelector);

    const layer = (element: Element | null, what: string) => {
      if (element === null) return null;
      const { top, bottom, left, right } = element.getBoundingClientRect();
      return { what, top, bottom, left, right };
    };

    /** Whether an element's `position: sticky` is constrained by the pane itself. */
    const sticksToPane = (element: Element): boolean => {
      for (let node = element.parentElement; node !== null; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowY;
        if (overflow === "auto" || overflow === "scroll") return node === pane;
      }
      return false;
    };

    const firstAgainstPane = (selector: string): Element | null =>
      Array.from(document.querySelectorAll(selector)).find(sticksToPane) ?? null;

    return {
      frame: {
        header: layer(document.querySelector("header.shell-header"), "the shell header"),
        sidebar: layer(document.querySelector("nav#shell-sidebar"), "the sidebar"),
        pane: layer(pane, "the content pane"),
      },
      stack: {
        subnav: layer(firstAgainstPane(".ou-subnav"), "the page subnav"),
        bar: layer(firstAgainstPane(".ou-sticky-bar"), "the sticky bar"),
        tableHeader: layer(
          firstAgainstPane(".ou-table--sticky thead th"),
          "the sticky table header",
        ),
      },
    };
  }, PANE_SELECTOR);
}

/**
 * Nothing covers anything else — § 4's "no overlapping chrome", asserted at the scale it
 * is written about.
 *
 * Two collisions, because the page has two kinds of chrome:
 *
 *   * **the shell frame** (§ 1.3) — the header, the sidebar and the pane are cells of one
 *     viewport-sized grid, so neither piece of chrome may reach into the pane. This holds
 *     on every page, and at 150% it is the assertion that catches a header whose contents
 *     grew taller than the row reserved for them.
 *   * **the in-pane stack** (§ 1.1 of `app/ui/chrome.ts`) — subnav above sticky bar above
 *     sticky table header, each offset by the *measured* height of the one above. The
 *     measurement is the whole reason the contract exists: a hard-coded offset is correct
 *     at exactly one font scale, and this probe is what proves the measured one is correct
 *     at three.
 *
 * @param page - The page, inside the shell at the audited scale.
 * @param stickyStack - Whether the page declares CP.4's stack ({@link MatrixPage}). When it
 *   does, all three layers must be present: a page that lost its subnav would otherwise
 *   pass this probe by having nothing left to collide.
 * @returns When the assertions have run.
 */
export async function expectNoOverlappingChrome(page: Page, stickyStack: boolean): Promise<void> {
  if (stickyStack) await stickChromeStack(page);

  const { frame, stack } = await chromeLayers(page);

  expect(frame.header, "the header must be on the page to be measured").not.toBeNull();
  expect(frame.sidebar, "the sidebar must be on the page to be measured").not.toBeNull();
  expect(frame.pane, "the content pane must be on the page to be measured").not.toBeNull();

  const header = frame.header as Layer;
  const sidebar = frame.sidebar as Layer;
  const pane = frame.pane as Layer;

  expect(
    header.bottom,
    `overlapping chrome: ${header.what} reaches ${(header.bottom - pane.top).toFixed(1)}px ` +
      "into the content pane instead of ending above it",
  ).toBeLessThanOrEqual(pane.top + EPSILON);

  expect(
    sidebar.right,
    `overlapping chrome: ${sidebar.what} reaches ` +
      `${(sidebar.right - pane.left).toFixed(1)}px into the content pane instead of ` +
      "ending beside it",
  ).toBeLessThanOrEqual(pane.left + EPSILON);

  if (!stickyStack) return;

  const layers = [stack.subnav, stack.bar, stack.tableHeader];

  for (const each of layers) {
    expect(
      each,
      "the page declares CP.4's stack, so all three layers must be present",
    ).not.toBeNull();
  }

  // Top to bottom, each layer ending where the next begins. Compared pairwise rather than
  // as a sorted list so a failure names *which* two collided.
  for (let index = 0; index < layers.length - 1; index += 1) {
    const above = layers[index] as Layer;
    const below = layers[index + 1] as Layer;

    expect(
      above.bottom,
      `overlapping chrome: ${above.what} covers ` +
        `${(above.bottom - below.top).toFixed(1)}px of ${below.what} — the stacking ` +
        "contract's offsets are not what the layers actually measure",
    ).toBeLessThanOrEqual(below.top + EPSILON);
  }

  // And the stack is stuck to the pane's own top edge rather than floating below it, which
  // is what makes the comparison above a comparison of stuck layers.
  expect(
    Math.abs((stack.subnav as Layer).top - pane.top),
    "the page subnav is not stuck to the pane's top edge, so the stack was measured at rest",
  ).toBeLessThanOrEqual(EPSILON);
}

/** One element whose own label does not fit inside it. */
interface ClippedElement {
  /** What it is, and what it says — the whole of a usable failure message. */
  readonly what: string;
  /** How much wider its content is than its box, in CSS pixels. */
  readonly overflowX: number;
  /** How much taller. */
  readonly overflowY: number;
}

/**
 * No label is cut off — § 4's "no clipped labels", and the half of this audit that a
 * screenshot review genuinely cannot do.
 *
 * ### What counts as a label
 *
 * An element with **its own text node**. That is the precise reading of the issue's
 * "labelled elements", and it is also what keeps the probe honest: a layout container that
 * clips is reported by the probe for the thing it actually broke — the pane's horizontal
 * scroll, its own child's box — rather than by this one, which would name a `<div>` and
 * leave the reader to find the sentence.
 *
 * ### What clipping means
 *
 * `overflow` of `hidden` or `clip` in the overflowing axis. A wrapper with `auto` or
 * `scroll` is not clipping anything: it is the § 1.3 escape hatch doing its job, which is
 * exactly the treatment a wide table is supposed to have, and flagging it would make this
 * probe argue against the design system.
 *
 * ### Deliberate truncation is allowed, once it says what it hid
 *
 * § 4's own remedy for a label that genuinely cannot fit is "truncation with tooltips". So
 * an element that truncates *horizontally* with an ellipsis and carries a `title` or an
 * `aria-label` — its own or an ancestor's — is compliant and passes. Nothing exempts
 * vertical clipping: there is no ellipsis for a line that fell out of the bottom of a box,
 * and that is the failure 150% produces.
 *
 * @param page - The page, inside the shell at the audited scale.
 * @returns When the assertion has run.
 */
export async function expectNoClippedText(page: Page): Promise<void> {
  const read = () =>
    page.evaluate((epsilon) => {
      const clipped: ClippedElement[] = [];

      for (const element of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
        // The element's own words, not its descendants' — see the module note.
        const own = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join("")
          .trim();
        if (own === "") continue;

        if (element.getClientRects().length === 0) continue;

        const style = getComputedStyle(element);
        if (style.visibility === "hidden" || Number.parseFloat(style.opacity) === 0) continue;

        // The visually-hidden pattern (`app/globals.css`, `.sr-only`) is a one-pixel box
        // clipping its text on purpose, and it is read aloud rather than looked at.
        if (element.clientWidth <= 1 || element.clientHeight <= 1) continue;

        const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
        const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";

        const overflowX = clipsX ? element.scrollWidth - element.clientWidth : 0;
        const overflowY = clipsY ? element.scrollHeight - element.clientHeight : 0;

        if (overflowX <= epsilon && overflowY <= epsilon) continue;

        // § 4's own remedy, honoured: an ellipsis that says what it hid.
        const explained =
          element.hasAttribute("title") ||
          element.hasAttribute("aria-label") ||
          element.closest("[title]") !== null;
        if (overflowY <= epsilon && style.textOverflow === "ellipsis" && explained) continue;

        const classes = element.className === "" ? "" : ` class="${String(element.className)}"`;
        const words = own.length > 60 ? `${own.slice(0, 57)}…` : own;

        clipped.push({
          what: `<${element.tagName.toLowerCase()}${classes}> “${words}”`,
          overflowX,
          overflowY,
        });
      }

      return clipped;
    }, EPSILON);

  const offenders = await settle(read, "the page's clipped elements");

  expect(
    offenders.map(
      (offender) =>
        `${offender.what} — clipped by ${offender.overflowX}px across and ` +
        `${offender.overflowY}px down`,
    ),
    "clipped text: a label does not fit inside the box that clips it, and nothing offers " +
      "the reader the rest of it (§ 4 — truncate with a tooltip, or make room)",
  ).toEqual([]);
}

/**
 * How many judged samples a contrast check must have found before its silence means
 * anything.
 *
 * Every page in the roster is dense — a page head, a sidebar of eleven entries, tables of
 * figures — so a run that judged fewer than this many distinct treatments did not walk the
 * page it thought it was walking, and its green is the kind that means nothing.
 */
const MINIMUM_CONTRAST_SAMPLES = 10;

/**
 * AA holds, at the scale where tinted small text is most at risk.
 *
 * The sampling is deduplicated by *treatment* rather than by element: a forty-eight-row
 * table of the same muted mono cells is one question asked once, not forty-eight, which is
 * what keeps this probe inside the matrix's budget while still walking every surface on
 * the page.
 *
 * ### What is deliberately not judged
 *
 * **Inactive controls**, which WCAG 1.4.3 exempts and this product draws deliberately dim
 * (`app/ui/button.tsx`'s `reason`), and **text over an image or a gradient**, which is not
 * a pair of colours and cannot honestly be reduced to one. Both are counted rather than
 * ignored, and the count is what {@link MINIMUM_CONTRAST_SAMPLES} guards: a page that
 * became all gradients would fail this probe by having nothing left to judge.
 *
 * @param page - The page, inside the shell at the audited scale, in a pinned palette.
 * @returns When the assertion has run.
 */
export async function expectContrastMeetsAA(page: Page): Promise<void> {
  const read = () =>
    page.evaluate(() => {
      /** The alpha of a computed colour, without parsing the rest of it. */
      const alphaOf = (css: string): number => {
        const match = /^rgba?\(([^)]+)\)$/i.exec(css.trim());
        if (match === null) return css.trim() === "transparent" ? 0 : 1;

        const parts = (match[1] ?? "").split(/[\s,/]+/).filter((part) => part !== "");
        return parts.length >= 4 ? Number.parseFloat(parts[3] ?? "1") : 1;
      };

      const found: ColourSample[] = [];
      const seen = new Set<string>();

      for (const element of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
        const own = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join("")
          .trim();
        if (own === "") continue;

        if (element.getClientRects().length === 0) continue;
        if (element.clientWidth <= 1 || element.clientHeight <= 1) continue;

        const style = getComputedStyle(element);
        if (style.visibility === "hidden" || Number.parseFloat(style.opacity) === 0) continue;

        // 1.4.3 exempts an inactive control; this product dims one on purpose.
        if (element.closest('[aria-disabled="true"], :disabled') !== null) continue;

        // The chain of backgrounds behind the text, nearest first, stopping at the first
        // opaque one. A gradient or an image on the way up ends the walk with nothing, and
        // the sample is dropped: it is not a pair of colours.
        const backgrounds: string[] = [];
        let opaque = false;

        for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
          const behind = getComputedStyle(node);
          if (behind.backgroundImage !== "none") break;

          backgrounds.push(behind.backgroundColor);
          if (alphaOf(behind.backgroundColor) >= 1) {
            opaque = true;
            break;
          }
        }
        if (!opaque) continue;

        const fontSizePx = Number.parseFloat(style.fontSize);
        const fontWeight = Number.parseFloat(style.fontWeight);

        // One question per treatment, not per element.
        const signature = [
          element.tagName,
          String(element.className),
          style.color,
          backgrounds.join(">"),
          String(fontSizePx),
          String(fontWeight),
        ].join("|");
        if (seen.has(signature)) continue;
        seen.add(signature);

        const classes = element.className === "" ? "" : ` class="${String(element.className)}"`;
        found.push({
          what: `<${element.tagName.toLowerCase()}${classes}>`,
          colour: style.color,
          backgrounds,
          fontSizePx,
          fontWeight,
        });
      }

      return found;
    });

  // Read twice and required to agree: immediately after a palette is pinned, a computed
  // colour is still a fraction of the swap, and a ratio computed from it is plausible and
  // wrong. `support/settle.ts` is the finding in full.
  const samples = await settle(read, "the page's colours");

  const measurements = samples.map(measure);
  const judged = measurements.filter((each) => each.ratio !== null);

  expect(
    judged.length,
    "the contrast probe judged almost nothing, so its silence is not evidence — the page " +
      "did not render, or every surface on it became unmeasurable",
  ).toBeGreaterThanOrEqual(MINIMUM_CONTRAST_SAMPLES);

  const failing = judged.filter(
    // Compared at the two decimals every contrast tool reports, so a ratio that rounds to
    // the threshold is the pass the design tokens were chosen against.
    (each) => Number.parseFloat((each.ratio ?? 0).toFixed(2)) < each.required,
  );

  expect(
    failing.map(describe),
    "WCAG AA contrast: text on this page is below the ratio its size requires (design " +
      "system § 3.4 — AA in both themes at every font scale)",
  ).toEqual([]);
}
