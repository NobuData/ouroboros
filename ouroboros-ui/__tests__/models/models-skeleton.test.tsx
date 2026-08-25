import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Loading from "@/app/(app)/models/(routing)/loading";
import {
  LOADING_LABEL,
  ModelsSkeleton,
  SKELETON_KINDS,
  SKELETON_PROVIDERS,
  SKELETON_RULES,
  SKELETON_SPEND_ROWS,
} from "@/app/models/models-skeleton";
import { ROUTING_TITLE } from "@/app/models/view";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The routing page's skeleton (#205): what stands in for the page while its reads are in
 * flight, at the page's own geometry.
 */

describe("the route's loading file", () => {
  it("draws the skeleton", () => {
    render(<Loading />);

    expect(screen.getByRole("main", { name: LOADING_LABEL })).toBeInTheDocument();
  });
});

describe("the head", () => {
  it("is the real head — the title, the subline and the tab set — not bars", () => {
    // The one part of the page a skeleton would make worse: the copy does not depend on the
    // reads, so drawing it as itself is what makes the swap pixel-identical.
    render(<ModelsSkeleton />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(ROUTING_TITLE);
    expect(screen.getByText(/never raw model ids/)).toBeInTheDocument();

    const tabs = screen.getByRole("navigation", { name: "Models" });

    expect(within(tabs).getByRole("link", { name: "Routing" })).toHaveAttribute("aria-current", "page");
  });

  it("reserves the two head actions as bars, because one of them depends on the role", () => {
    const { container } = render(<ModelsSkeleton />);

    expect(container.querySelectorAll(".models-skeleton__action")).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("below the tabs", () => {
  it("stands in for the strip with the seeded workspace's five chips", () => {
    const { container } = render(<ModelsSkeleton />);

    expect(container.querySelectorAll(".models-skeleton__strip > .models-skeleton__chip")).toHaveLength(
      SKELETON_PROVIDERS,
    );
  });

  it("lays the matrix and the right column out on the page's own grid", () => {
    // The same `ModelsGrid` the page draws, so the columns cannot differ from the page's.
    const { container } = render(<ModelsSkeleton />);

    const grid = container.querySelector(".models-grid");

    expect(grid).not.toBeNull();
    expect(grid?.querySelector(".models-col--8")).not.toBeNull();
    expect(grid?.querySelector(".models-col--4.models-aside")).not.toBeNull();
  });

  it("stands in for the matrix as a head over a ruled table of eight rows, six cells each", () => {
    const { container } = render(<ModelsSkeleton />);

    const matrix = container.querySelector(".models-col--8") as HTMLElement;
    const rows = matrix.querySelectorAll(".models-skeleton__row");

    expect(matrix.querySelector(".models-skeleton__head")).not.toBeNull();
    expect(matrix.querySelector(".models-skeleton__thead")).not.toBeNull();
    expect(rows).toHaveLength(SKELETON_KINDS);
    for (const row of rows) {
      expect(row.children).toHaveLength(6);
      expect(row.querySelectorAll(".models-skeleton__pill")).toHaveLength(2);
      expect(row.querySelectorAll(".models-skeleton__bar--num")).toHaveLength(2);
    }
  });

  it("stands in for each of the right column's three cards as itself, not three of one shape", () => {
    const { container } = render(<ModelsSkeleton />);

    const cards = [...container.querySelectorAll(".models-aside > .ou-card")];
    const shape = (card: Element) => ({
      head: card.querySelectorAll(".models-skeleton__head").length,
      panel: card.querySelectorAll(".models-skeleton__panel").length,
      rules: card.querySelectorAll(".models-skeleton__rule").length,
      meters: card.querySelectorAll(".models-skeleton__meter").length,
    });

    expect(cards.map(shape)).toEqual([
      // The inspector's seat: nothing is selected yet, so the empty state's well.
      { head: 1, panel: 1, rules: 0, meters: 0 },
      // The rules card: the three seeded rules.
      { head: 1, panel: 0, rules: SKELETON_RULES, meters: 0 },
      // The spend card: the four seeded rows, metered.
      { head: 1, panel: 0, rules: 0, meters: SKELETON_SPEND_ROWS },
    ]);
  });

  it("stretches every card, so a short skeleton does not leave a gap its card will not", () => {
    const { container } = render(<ModelsSkeleton />);

    for (const card of container.querySelectorAll(".models-grid .ou-card")) {
      expect(card).toHaveClass("ou-card--fill");
    }
  });
});

describe("what a screen reader is told", () => {
  it("is that the page is busy, once, by the main region's label", () => {
    render(<ModelsSkeleton />);

    const main = screen.getByRole("main", { name: LOADING_LABEL });

    expect(main).toHaveAttribute("aria-busy", "true");
  });

  it("hides the bars from the accessibility tree", () => {
    const { container } = render(<ModelsSkeleton />);

    expect(container.querySelector(".models-skeleton")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".models-skeleton__actions")).toHaveAttribute("aria-hidden", "true");
  });

  it("carries no text in any bar", () => {
    const { container } = render(<ModelsSkeleton />);

    for (const bar of container.querySelectorAll('[class*="models-skeleton__"]')) {
      expect(bar.textContent).toBe("");
    }
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(palette, <ModelsSkeleton />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("main", { name: LOADING_LABEL })).toBeInTheDocument();
  });

  it("draws the same markup in both, and carries no inline style", () => {
    const [light, dark] = renderInBothPalettes(<ModelsSkeleton />);

    expect(light).toBe(dark);
    expect(light).not.toMatch(/ style=/);
  });
});
