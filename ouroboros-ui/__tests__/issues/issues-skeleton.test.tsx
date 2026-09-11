import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Loading from "@/app/(app)/issues/loading";
import {
  IssuesSkeleton,
  LOADING_LABEL,
  SKELETON_CHIPS,
  SKELETON_ROWS,
} from "@/app/issues/issues-skeleton";
import { ISSUES_EYEBROW, ISSUES_SUBLINE } from "@/app/issues/view";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The intake page's skeleton (#120): what stands in for the page while its reads are in
 * flight, at the page's own geometry.
 *
 * Two things can go wrong with a skeleton and both are asserted: it can be the wrong *shape*,
 * so the page jumps when the data arrives — so the table is checked row by row, six cells at
 * the columns the real rows draw — and it can be read aloud, so what a screen reader is told is
 * checked too.
 */

describe("the route's loading file", () => {
  it("draws the skeleton", () => {
    render(<Loading />);

    expect(screen.getByRole("main", { name: LOADING_LABEL })).toBeInTheDocument();
  });
});

describe("the head", () => {
  it("is the real eyebrow and subline, not bars, over a bar where the headline's figures go", () => {
    const { container } = render(<IssuesSkeleton />);

    expect(screen.getByText(ISSUES_EYEBROW)).toHaveClass("ou-eyebrow");
    expect(screen.getByText(ISSUES_SUBLINE)).toHaveClass("issues__sub");
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelector(".issues__headings > .issues-skeleton__bar--title")).not.toBeNull();
  });

  it("reserves the two head actions as bars, because one of them depends on the role", () => {
    const { container } = render(<IssuesSkeleton />);

    expect(container.querySelectorAll(".issues__actions > .issues-skeleton__action")).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("below the head", () => {
  it("stands in for the filter bar as its own card: three selects, the seeded chips, the search box", () => {
    const { container } = render(<IssuesSkeleton />);

    const bar = container.querySelector(".issues-filter") as HTMLElement;

    expect(bar).toHaveClass("ou-card");
    expect(bar.querySelectorAll(".issues-filter__row > .issues-skeleton__select")).toHaveLength(3);
    expect(bar.querySelectorAll(".issues-filter__chips > .issues-skeleton__chip")).toHaveLength(SKELETON_CHIPS);
    expect(bar.querySelectorAll(".issues-skeleton__search")).toHaveLength(1);
  });

  it("lays the table and the panel out on the page's own grid", () => {
    // The same classes the screen draws its grid with, so the columns cannot differ from the page's.
    const { container } = render(<IssuesSkeleton />);

    const grid = container.querySelector(".issues__grid");

    expect(grid).not.toBeNull();
    expect(grid?.querySelector(".issues__main > .ou-card")).not.toBeNull();
    expect(grid?.querySelector(".issues__aside > .ou-card.issues-panel")).not.toBeNull();
  });

  it("stands in for the table as a head over a ruled table of the seeded nine rows, six cells each", () => {
    const { container } = render(<IssuesSkeleton />);

    const table = container.querySelector(".issues__main > .ou-card") as HTMLElement;
    const rows = table.querySelectorAll(".issues-skeleton__row");

    expect(table.querySelector(".issues-skeleton__head")).not.toBeNull();
    expect(table.querySelector(".issues-skeleton__thead")).not.toBeNull();
    expect(rows).toHaveLength(SKELETON_ROWS);
    for (const row of rows) {
      expect(row.children).toHaveLength(6);
      expect(row.querySelector(".issues-skeleton__check")).not.toBeNull();
      // The issue cell: a title line over a tag row, as the real cell is.
      expect(row.querySelector(".issues-skeleton__issue > .issues-skeleton__bar--line")).not.toBeNull();
      expect(row.querySelectorAll(".issues-skeleton__issue .issues-skeleton__tag")).toHaveLength(2);
      // The effort pair, the workflow tag, the model pill and the status pill.
      expect(row.querySelector(".issues-skeleton__effort > .issues-skeleton__pill")).not.toBeNull();
      expect(row.querySelectorAll(":scope > .issues-skeleton__pill")).toHaveLength(2);
      expect(row.querySelector(".issues-skeleton__pill--model")).not.toBeNull();
    }
  });

  it("stands in for the panel as its head over the empty seat it holds", () => {
    const { container } = render(<IssuesSkeleton />);

    const panel = container.querySelector(".issues__aside > .ou-card") as HTMLElement;

    expect(within(panel).queryByText(/./)).toBeNull();
    expect(panel.querySelector(".issues-skeleton__head")).not.toBeNull();
    expect(panel.querySelector(".issues-skeleton__panel")).not.toBeNull();
  });
});

describe("what a screen reader is told", () => {
  it("is that the page is busy, once, by the main region's label", () => {
    render(<IssuesSkeleton />);

    expect(screen.getByRole("main", { name: LOADING_LABEL })).toHaveAttribute("aria-busy", "true");
  });

  it("hides the bars from the accessibility tree", () => {
    const { container } = render(<IssuesSkeleton />);

    expect(container.querySelector(".issues-skeleton")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".issues__actions")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".issues-skeleton__bar--title")).toHaveAttribute("aria-hidden", "true");
  });

  it("carries no text in any bar", () => {
    const { container } = render(<IssuesSkeleton />);

    for (const bar of container.querySelectorAll('[class*="issues-skeleton__"]')) {
      expect(bar.textContent).toBe("");
    }
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(palette, <IssuesSkeleton />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("main", { name: LOADING_LABEL })).toBeInTheDocument();
  });

  it("draws the same markup in both, and carries no inline style", () => {
    const [light, dark] = renderInBothPalettes(<IssuesSkeleton />);

    expect(light).toBe(dark);
    expect(light).not.toMatch(/ style=/);
  });
});
