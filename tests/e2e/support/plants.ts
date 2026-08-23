/**
 * The offences this suite plants on purpose, so its audits can be shown to catch them.
 *
 * A green audit cannot tell you whether the page is clean or whether the assertions look at
 * nothing; the two are indistinguishable from outside. That is the argument
 * `scripts/verify-failure-modes.sh` makes about services, and these are the same argument
 * made about CSS: each plant breaks one promise of
 * `docs/DESIGN_SYSTEM_APP_SHELL.md`, and a script requires the matching assertion to go red
 * naming it.
 *
 * | plant | breaks | must be caught by | proved by |
 * |---|---|---|---|
 * | `viewport-fixed` | § 1.3 — nothing is stuck to the viewport | `expectNoViewportFixedElements` | `scripts/verify-containment.sh` |
 * | `pane-overflow`  | § 1.3 — wide content scrolls in its own wrapper | `expectNoPaneHorizontalScroll` | `verify-containment.sh` and `verify-readability.sh` |
 * | `clipped-text`   | § 4 — at 150% no clipped labels | `expectNoClippedText` | `scripts/verify-readability.sh` |
 * | `chrome-overlap` | § 1.3 — the shell's chrome never reaches into the pane | `expectNoOverlappingChrome` | `verify-readability.sh` |
 * | `stack-overlap`  | CP.4 — subnav above bar above table header | `expectNoOverlappingChrome` | `verify-readability.sh` |
 *
 * The first two are [#647](https://github.com/NobuData/ouroboros/issues/647)'s and the last
 * three [#650](https://github.com/NobuData/ouroboros/issues/650)'s. The last two break the
 * *same* assertion in its two different halves, and they are separate plants because one
 * plant could not prove both: the frame collision is checked first and fails the test before
 * the stack comparison is ever reached, so a combined plant would leave the half the issue
 * actually names — the CP.4 stack — never shown to be catchable. They live in one module
 * rather than beside their assertions because there is exactly one of everything here — one
 * environment variable, one `addInitScript`, one vocabulary — and a second copy of that
 * machinery in the readability support would be a second spelling of `OURO_E2E_PLANT` for
 * somebody to get wrong.
 *
 * ## Why a stylesheet and not an element
 *
 * All but one plant is a `<style>` appended to `<head>`. The pane's subtree is hydrated, and
 * React reconciles a stray child straight back out of it — the first run of
 * `verify-containment.sh` discovered exactly that, by a planted element silently failing to
 * break anything. A rule in a stylesheet is not part of any component's tree, so no
 * reconciler removes it, and the boxes it produces are boxes every assertion here measures.
 * `viewport-fixed` is the exception because the assertion it must defeat *enumerates
 * elements*, so an element is what it has to be — appended to `<body>`, where hydration
 * tolerates a stray node.
 */

import type { Page } from "@playwright/test";

/** How a plant is asked for. Unset — every ordinary run — plants nothing. */
export const PLANT_VARIABLE = "OURO_E2E_PLANT";

/** The offences, spelled the way {@link PLANT_VARIABLE} accepts them. */
export const PLANTS = [
  "viewport-fixed",
  "pane-overflow",
  "clipped-text",
  "chrome-overlap",
  "stack-overlap",
] as const;

/** One of {@link PLANTS}. */
export type Plant = (typeof PLANTS)[number];

/**
 * The stylesheet each plant installs, keyed by name.
 *
 * `viewport-fixed` is absent on purpose: it is the one plant that has to be an element, and
 * {@link applyPlant} handles it directly.
 *
 * Every selector here is a **shell** selector or the pane's own attribute, so a plant works
 * on every page in the readability roster — including the four that are still parked. A
 * plant that only bit one page would quietly stop proving anything the day that page was
 * the one left out of a run.
 */
const STYLESHEETS: Readonly<Partial<Record<Plant, string>>> = {
  // A 3000px box inside the pane with no wrapper of its own — the shape of an unwrapped
  // table, which is the regression § 1.3 exists to prevent.
  "pane-overflow":
    '[data-shell-pane]::after { content: ""; display: block; width: 3000px; height: 1px; }',

  // A sidebar label squeezed to a width its text cannot fit in, with nowhere to scroll and
  // no tooltip — the shape of a label that stopped fitting at 150%. Narrow, but far wider
  // than the one-pixel box of the visually-hidden pattern, which the probe ignores.
  "clipped-text":
    ".shell-nav__label { display: block; max-width: 1.5rem; overflow: hidden; " +
    "white-space: nowrap; }",

  // The pane pulled up under the header — the shape of a header whose contents grew taller
  // than the grid row reserved for them, which is what 150% threatens to do to it. Every
  // page has a header, so this bites the whole roster.
  "chrome-overlap": "[data-shell-pane] { margin-top: -2rem; }",

  // The sticky bar dropped onto the subnav's own edge — the shape of a page that hard-coded
  // an offset instead of reading the published height (`app/ui/chrome.ts`), which is
  // correct at exactly one font scale. It bites only the pages that stack CP.4 chrome,
  // which is the point: those are the pages the contract is about.
  "stack-overlap": ".ou-sticky-bar { top: 0 !important; }",
};

/**
 * Install the requested offence, when one was requested at all.
 *
 * Called before the first `goto` of each audited test. Reads {@link PLANT_VARIABLE} from the
 * runner's own environment — the way the verify scripts pass it — so an ordinary run does
 * nothing and costs nothing.
 *
 * @param page - The page about to navigate.
 * @returns When the init script is installed, or immediately when no plant is requested.
 * @throws {Error} If the variable names a plant this module does not grow. A typo in a
 *   script should be a loud failure rather than a green run that verified nothing.
 */
export async function applyPlant(page: Page): Promise<void> {
  const plant = process.env[PLANT_VARIABLE];
  if (plant === undefined || plant === "") return;

  if (!PLANTS.includes(plant as Plant)) {
    throw new Error(
      `${PLANT_VARIABLE}=${plant} names no known plant; expected one of: ${PLANTS.join(", ")}`,
    );
  }

  const stylesheet = STYLESHEETS[plant as Plant];

  await page.addInitScript(
    ({ kind, css }) => {
      // At DOMContentLoaded the server's markup — pane included — is parsed and present;
      // nothing here waits for React, because every offence being planted is a markup or a
      // stylesheet fact.
      document.addEventListener("DOMContentLoaded", () => {
        if (css !== undefined) {
          const sheet = document.createElement("style");
          sheet.textContent = css;
          document.head.append(sheet);
          return;
        }

        if (kind === "viewport-fixed") {
          const bar = document.createElement("div");
          bar.className = "e2e-planted-viewport-fixed";
          bar.style.cssText =
            "position: fixed; top: 0; left: 0; right: 0; height: 40px; z-index: 9999;";
          document.body.append(bar);
        }
      });
    },
    { kind: plant, css: stylesheet },
  );
}
