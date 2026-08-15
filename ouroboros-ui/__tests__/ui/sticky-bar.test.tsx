import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CHROME_BAR_PROPERTY, StickyBar } from "@/app/ui";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The sticky bar primitive (#646) — layer 2 of the in-pane stacking contract.
 *
 * As with the subnav: the sticking is CSS, asserted from the sheet
 * (`__tests__/ui/ui-styles.test.ts`); here is the markup's half — content passed through
 * untouched, the tone a class — and the effect's half, the height published for the table
 * header and the anchor offset beneath it.
 */

/**
 * Render a bar the way a page mounts one: inside the thing that scrolls.
 *
 * @param tone The treatment, when not the quiet default.
 * @returns The bar, the scroll container it published to, and the unmount.
 */
function mounted(tone?: "plain" | "asking"): {
  bar: HTMLElement;
  pane: HTMLElement;
  unmount: () => void;
} {
  const { container, unmount } = render(
    <div style={{ overflowY: "auto" }}>
      <StickyBar tone={tone}>
        <strong>Unsaved changes</strong>
      </StickyBar>
    </div>,
  );

  const pane = container.firstElementChild as HTMLElement;

  return { bar: pane.firstElementChild as HTMLElement, pane, unmount };
}

describe("the bar", () => {
  it("renders the page's content rather than deciding any of its own", () => {
    // A dirty-state bar is a status region, a bulk-action bar is not, and only the page
    // knows — role and controls come through as children.
    mounted();

    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("is quiet chrome unless the page says it is asking", () => {
    const { bar } = mounted();

    expect(bar).toHaveClass("ou-sticky-bar");
    expect(bar).not.toHaveClass("ou-sticky-bar--asking");
  });

  it("wears the asking rim for a bar that wants a decision", () => {
    const { bar } = mounted("asking");

    expect(bar).toHaveClass("ou-sticky-bar", "ou-sticky-bar--asking");
  });

  it("carries a page's placement class beside its own", () => {
    const { container } = render(<StickyBar className="wk-placed">changes</StickyBar>);

    expect(container.firstElementChild).toHaveClass("ou-sticky-bar", "wk-placed");
  });
});

describe("the published height", () => {
  it("publishes to the scroll container while mounted", () => {
    // Zero because jsdom lays nothing out; the measured case is `chrome.test.ts`'s.
    const { pane } = mounted();

    expect(pane.style.getPropertyValue(CHROME_BAR_PROPERTY)).toBe("0px");
  });

  it("withdraws it on unmount, so a saved draft's bar stops offsetting the stack", () => {
    // The dirty-state bar is exactly the chrome that comes and goes mid-page: saving
    // dismisses it, and the table header below must close the gap it leaves.
    const { pane, unmount } = mounted();

    unmount();

    expect(pane.style.getPropertyValue(CHROME_BAR_PROPERTY)).toBe("");
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    const { container } = renderInPalette(palette, <StickyBar>changes</StickyBar>);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(container.firstElementChild).toHaveClass("ou-sticky-bar");
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(<StickyBar tone="asking">changes</StickyBar>);

    expect(light).toBe(dark);
  });
});
