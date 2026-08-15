import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChromeStory } from "@/app/workshop/chrome-story";

import { renderInBothPalettes } from "../helpers/palettes";

/**
 * The workshop's in-pane chrome story (#646).
 *
 * The story exists so the CP.4 contracts have one page where all of them are visibly true
 * at once, and this suite holds it to that: every layer present, in the contract's order;
 * every anchor tab landing on a real target; the fixture long enough to scroll; the
 * fixture honest about being one. Whether anything *sticks* is the e2e leg's question —
 * here the story is markup, and the markup is the demonstration's skeleton.
 */

describe("the story's chrome, in the contract's order", () => {
  it("mounts all three layers over the fixture", () => {
    const { container } = render(<ChromeStory />);

    expect(screen.getByRole("navigation", { name: "In-pane chrome story" })).toBeInTheDocument();
    expect(container.querySelector(".ou-sticky-bar--asking")).not.toBeNull();
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getByRole("table")).toHaveClass("ou-table--sticky");
  });

  it("orders them as the contract stacks them: subnav, then bar, then table", () => {
    // The `top` chain in `ui.css` assumes the document order matches the stack — a bar
    // above the subnav in the DOM would still offset as if below it.
    const { container } = render(<ChromeStory />);

    const subnav = screen.getByRole("navigation", { name: "In-pane chrome story" });
    const bar = container.querySelector(".ou-sticky-bar");
    const table = screen.getByRole("table");

    expect(subnav.compareDocumentPosition(bar!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(bar!.compareDocumentPosition(table)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("gives the fixture enough rows that every layer is stuck long before the end", () => {
    // 48 data rows plus the head: fewer, at the largest font scale, and the demonstration
    // could end above the fold.
    render(<ChromeStory />);

    expect(screen.getAllByRole("row")).toHaveLength(49);
  });
});

describe("the anchor tabs", () => {
  it("land every tab on a target that exists, offset rules aside", () => {
    render(<ChromeStory />);

    const subnav = screen.getByRole("navigation", { name: "In-pane chrome story" });

    for (const tab of within(subnav).getAllByRole("link")) {
      const href = tab.getAttribute("href") ?? "";

      expect(href).toMatch(/^#/);
      expect(document.getElementById(href.slice(1))).not.toBeNull();
    }
  });

  it("marks one tab current, in the anchor flavour of the attribute", () => {
    render(<ChromeStory />);

    const subnav = screen.getByRole("navigation", { name: "In-pane chrome story" });

    expect(within(subnav).getByRole("link", { name: "Stacking" })).toHaveAttribute(
      "aria-current",
      "location",
    );
  });
});

describe("the fixture's honesty", () => {
  it("makes the dirty bar's controls inert, with the reason where the pointer asks", () => {
    // § 3.5: a control that cannot act explains itself. There is no draft behind the
    // workshop's bar, and Save pretending otherwise would be the screen lying.
    render(<ChromeStory />);

    for (const label of ["Save", "Discard"]) {
      const control = screen.getByRole("button", { name: label });

      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control.getAttribute("title")).toMatch(/fixture/i);
    }
  });

  it("keeps one live control: the push link the restoration section walks through", () => {
    render(<ChromeStory />);

    expect(screen.getByRole("link", { name: "push to the dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});

describe("the preserved treatments", () => {
  it("shows the model hue as a tone, inside a scrollport of its own", () => {
    // Mockup 06's purple, kept as `tone="model"` — and mounted in the sample well so its
    // published height binds to the well rather than to the pane the real subnav owns.
    const { container } = render(<ChromeStory />);

    const sample = screen.getByRole("navigation", { name: "Model routing (sample)" });

    expect(sample).toHaveClass("ou-subnav--model");
    expect(container.querySelector(".wk-sample")).toContainElement(sample);
  });
});

describe("both palettes", () => {
  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(<ChromeStory />);

    expect(light).toBe(dark);
  });
});
