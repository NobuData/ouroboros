import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CHROME_SUBNAV_PROPERTY, PageSubnav } from "@/app/ui";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The page subnav primitive (#646) — the mockups' `.subnav`, stuck to the pane.
 *
 * Whether it *sticks* is CSS and is asserted where CSS can be read
 * (`__tests__/ui/ui-styles.test.ts`); what is assertable here is the half the markup
 * carries — the named landmark, the links being the page's own, the tone being a class
 * and nothing more — and the half the effect carries, which is the published height the
 * rest of the stacking contract offsets by.
 */

/**
 * Render a subnav the way a page mounts one: inside the thing that scrolls.
 *
 * @param tone The underline hue, when not the accent.
 * @returns The scroll container the subnav should have published to.
 */
function mounted(tone?: "accent" | "model"): { pane: HTMLElement; unmount: () => void } {
  const { container, unmount } = render(
    <div style={{ overflowY: "auto" }}>
      <PageSubnav label="Models" tone={tone}>
        <a aria-current="page" href="/models/routing">
          Routing
        </a>
        <a href="/models/registry">Model registry</a>
      </PageSubnav>
    </div>,
  );

  return { pane: container.firstElementChild as HTMLElement, unmount };
}

describe("the landmark", () => {
  it("is a navigation region with the section's name, so two navs cannot blur", () => {
    // The sidebar is also a <nav>; an unnamed second one is indistinguishable in a rotor.
    mounted();

    expect(screen.getByRole("navigation", { name: "Models" })).toBeInTheDocument();
  });

  it("renders the page's links rather than links of its own", () => {
    // The tabs of a real section are route links, Settings' are anchors — only the page
    // knows, so the primitive draws what it is handed.
    mounted();

    const routing = screen.getByRole("link", { name: "Routing" });

    expect(routing).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Model registry" })).toBeInTheDocument();
  });
});

describe("the tones", () => {
  it("wears no modifier for the accent, which is the base rule's own hue", () => {
    mounted();

    expect(screen.getByRole("navigation")).toHaveClass("ou-subnav");
    expect(screen.getByRole("navigation")).not.toHaveClass("ou-subnav--model");
  });

  it("keeps mockup 06's model purple as a tone rather than normalising it away", () => {
    mounted("model");

    expect(screen.getByRole("navigation")).toHaveClass("ou-subnav", "ou-subnav--model");
  });

  it("carries a page's placement class beside its own", () => {
    render(
      <PageSubnav className="wk-placed" label="Models">
        <a href="/models">Routing</a>
      </PageSubnav>,
    );

    expect(screen.getByRole("navigation")).toHaveClass("ou-subnav", "wk-placed");
  });
});

describe("the published height", () => {
  it("publishes to the scroll container while mounted", () => {
    // jsdom measures every element at zero, so the value is the mechanism's floor — the
    // *measurement* is `chrome.test.ts`'s to assert with stubbed geometry. What matters
    // here is that mounting published the subnav's fact where the stacking rules read it.
    const { pane } = mounted();

    expect(pane.style.getPropertyValue(CHROME_SUBNAV_PROPERTY)).toBe("0px");
  });

  it("withdraws it on unmount, so a departed subnav stops offsetting the stack", () => {
    const { pane, unmount } = mounted();

    unmount();

    expect(pane.style.getPropertyValue(CHROME_SUBNAV_PROPERTY)).toBe("");
  });

  it("mounts without a scrollport without complaint", () => {
    // Outside the shell — the § 5 screens, a bare test — there is nowhere to publish, and
    // that is a case, not an error.
    expect(() =>
      render(
        <PageSubnav label="Models">
          <a href="/models">Routing</a>
        </PageSubnav>,
      ),
    ).not.toThrow();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(
      palette,
      <PageSubnav label="Models">
        <a href="/models">Routing</a>
      </PageSubnav>,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("navigation", { name: "Models" })).toHaveClass("ou-subnav");
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <PageSubnav label="Models" tone="model">
        <a aria-current="page" href="/models">
          Routing
        </a>
      </PageSubnav>,
    );

    expect(light).toBe(dark);
  });
});
