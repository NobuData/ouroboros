import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach } from "vitest";

import { type ResolvedTheme, stampTheme } from "@/app/theme";

/**
 * Rendering the same thing under both palettes.
 *
 * #46's third acceptance criterion is that every primitive has a render test in both
 * themes, and this is what one is. What such a test can and cannot prove is worth being
 * precise about, because it decides what the primitives' suites assert:
 *
 * - **jsdom applies no stylesheet.** Vitest resolves a CSS import to nothing, so no test in
 *   this module can read a computed colour, and one that appeared to would be reading the
 *   default `rgb(0, 0, 0)` under both themes and passing for the wrong reason. Whether the
 *   dark palette is *correct* is `scripts/verify-tokens.sh`'s question, and it answers it
 *   from the token sheet where the values actually are.
 * - **What is left is the property that matters here**, and it is a real one: a primitive
 *   must express the theme entirely in CSS, so that what it renders under `data-theme="dark"`
 *   is byte-identical to what it renders under `light`. A component that branched on the
 *   theme in JavaScript — picking a hue, an icon or a class from `useTheme()` — would be one
 *   the boot script could not paint before hydration, and would render differently on the
 *   server than in the browser. {@link renderInBothPalettes} is what catches that.
 *
 * The attribute is stamped on `<html>` exactly as `app/theme.ts` stamps it in the
 * application, so a primitive is rendered under the same selector the sheet's dark block is
 * written against.
 */

/** The two palettes a primitive is rendered under. Not `system`: that resolves to one. */
export const PALETTES: readonly ResolvedTheme[] = ["light", "dark"];

/** A `useId` value, in every spelling React has used for one — `:r0:`, `«r0»`, `_r_0_`. */
const REACT_ID = /(?:«r[0-9a-z]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_)/g;

/**
 * Markup with React's generated ids masked.
 *
 * React numbers `useId` per root, so two renders of one component in two containers differ
 * in their ids and — if the component is honest about the theme — in nothing else. A
 * component that emits an id (a field's `for`, a switch's `aria-describedby`) is compared
 * through this, so the ids are what is masked and the markup is what is asserted.
 *
 * @param html The container's markup.
 * @returns The same markup, every generated id replaced by one word.
 */
export function maskIds(html: string): string {
  return html.replace(REACT_ID, "id");
}

// Every test that stamps a palette leaves the document as it found it, so a suite's
// ordering can never decide what the next one renders under.
afterEach(() => {
  stampTheme("system");
});

/**
 * Render under one palette.
 *
 * @param palette Which palette to stamp on `<html>` first.
 * @param ui The element to render.
 * @returns The Testing Library render result, unchanged.
 */
export function renderInPalette(palette: ResolvedTheme, ui: ReactElement): RenderResult {
  stampTheme(palette);
  return render(ui);
}

/**
 * Render under both palettes and hand back what each produced.
 *
 * @param ui The element to render. Rendered twice, into two containers.
 * @returns The markup each palette produced, in {@link PALETTES} order.
 */
export function renderInBothPalettes(ui: ReactElement): readonly string[] {
  return PALETTES.map((palette) => {
    const { container, unmount } = renderInPalette(palette, ui);
    const html = container.innerHTML;
    unmount();
    return html;
  });
}
