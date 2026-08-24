import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ModelsFrame } from "@/app/models/models-frame";

import { renderInBothPalettes } from "../helpers/palettes";

/**
 * The Models section's page frame (#227) — the head and tab set every page under `/models`
 * shares.
 *
 * What the tab set does is `models-subnav.test.tsx`'s; what is here is the composition: that
 * a page's four inputs land where mockups 06 and 07 both draw them, in the order the design
 * system's anatomy (§ 2) gives — head, subnav, content — and that the frame adds no title of
 * its own beside the page's.
 */

/** Render a frame with every slot filled by something findable. */
function frame(active: "routing" | "providers" = "providers") {
  return render(
    <ModelsFrame
      active={active}
      actions={<button type="button">An action</button>}
      subline="The promise."
      title="The title"
    >
      <p>The content</p>
    </ModelsFrame>,
  );
}

describe("the anatomy", () => {
  it("is a main landmark starting at its page head, with no chrome of its own", () => {
    // Design system § 2: pages render inside the shell and start at their head. A second
    // header or a fixed element here would be a page bringing its own chrome into the pane.
    const { container } = frame();

    expect(screen.getByRole("main")).toHaveClass("models");
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("[class*='shell-']")).toBeNull();
  });

  it("puts the eyebrow, the title and the subline in the head's first column", () => {
    frame();

    const headings = document.querySelector(".models__headings") as HTMLElement;

    expect(within(headings).getByText("Models")).toHaveClass("ou-eyebrow");
    expect(within(headings).getByRole("heading", { level: 1 })).toHaveTextContent("The title");
    expect(within(headings).getByText("The promise.")).toHaveClass("models__sub");
  });

  it("puts the actions in the head's second column", () => {
    frame();

    const actions = document.querySelector(".models__actions") as HTMLElement;

    expect(within(actions).getByRole("button", { name: "An action" })).toBeInTheDocument();
  });

  it("orders head, tab set, then the page's content", () => {
    frame();

    const main = screen.getByRole("main");
    const order = [...main.children].map((child) =>
      child.classList.contains("models__head")
        ? "head"
        : child.getAttribute("aria-label") === "Models"
          ? "subnav"
          : "content",
    );

    expect(order).toEqual(["head", "subnav", "content"]);
  });

  it("has exactly one h1, so the page has one title in the outline", () => {
    // The eyebrow is a `<p>` for exactly this reason (`app/ui/eyebrow.tsx`).
    frame();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("what the page decides", () => {
  it("hands the active surface to the tab set", () => {
    frame("routing");

    expect(screen.getByRole("link", { name: "Routing" })).toHaveAttribute("aria-current", "page");
  });

  it("hands the underline's hue to the tab set, defaulting to the accent", () => {
    frame();

    expect(screen.getByRole("navigation", { name: "Models" })).not.toHaveClass(
      "ou-subnav--model",
    );

    document.body.innerHTML = "";
    render(
      <ModelsFrame actions={null} active="routing" subline="s" title="t" tone="model">
        <p />
      </ModelsFrame>,
    );

    expect(screen.getByRole("navigation", { name: "Models" })).toHaveClass("ou-subnav--model");
  });

  it("always calls the section Models, because that is what it is called", () => {
    // The eyebrow is the frame's, not the page's: a page cannot rename the section it is in.
    frame();

    expect(screen.getByText("Models")).toHaveClass("ou-eyebrow");
  });
});

describe("both palettes", () => {
  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <ModelsFrame actions={null} active="providers" subline="s" title="t">
        <p />
      </ModelsFrame>,
    );

    expect(light).toBe(dark);
  });
});
