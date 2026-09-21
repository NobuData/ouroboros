import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Loading from "@/app/(app)/build-farm/loading";
import { FarmSkeleton } from "@/app/farm/farm-skeleton";
import { FARM_LOADING_LABEL } from "@/app/farm/states";
import { FARM_EYEBROW, FARM_SUBLINE } from "@/app/farm/view";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The build farm's loading state (#262): the page's own frame and grid with bars where the live
 * values go, so nothing moves when the cards land — and one sentence to a screen reader rather
 * than forty empty boxes.
 */

/** The grid. */
function grid(): HTMLElement {
  const found = document.querySelector<HTMLElement>(".farm__grid");

  if (!found) throw new Error("no grid");
  return found;
}

describe("the skeleton", () => {
  it("is the page's one main landmark, busy, and named once", () => {
    render(<FarmSkeleton />);

    const main = screen.getByRole("main", { name: FARM_LOADING_LABEL });

    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(main).toHaveClass("farm");
  });

  it("draws what is known before any read — the eyebrow and the subline — and a bar for the live headline", () => {
    render(<FarmSkeleton />);

    expect(screen.getByText(FARM_EYEBROW)).toBeInTheDocument();
    expect(screen.getByText(FARM_SUBLINE)).toBeInTheDocument();
    // Three live values in a sentence: nothing to claim yet, so no heading is drawn at all.
    expect(screen.queryByRole("heading")).toBeNull();
    expect(document.querySelector(".farm__headings .farm-skeleton__bar--title")).not.toBeNull();
  });

  it("hides the bars from the accessibility tree", () => {
    render(<FarmSkeleton />);

    expect(grid()).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("reserves the screen's own geometry: four threes, the eight beside the four, then the twelve", () => {
    render(<FarmSkeleton />);

    const spans = [...grid().children].map(
      (child) => [...child.classList].find((name) => name.startsWith("farm-col--")) ?? "",
    );

    expect(spans).toEqual([
      "farm-col--3",
      "farm-col--3",
      "farm-col--3",
      "farm-col--3",
      "farm-col--8",
      "farm-col--4",
      "farm-col--12",
    ]);
  });

  it("draws each stat tile as itself — a caption, a tall figure, the line under it", () => {
    render(<FarmSkeleton />);

    const tiles = grid().querySelectorAll(":scope > .farm-col--3");

    for (const tile of tiles) {
      expect(tile).toHaveClass("ou-card--fill");
      expect(
        [...tile.querySelectorAll(".farm-skeleton__bar")].map((bar) =>
          [...bar.classList].find((name) => name.startsWith("farm-skeleton__bar--")),
        ),
      ).toEqual([
        "farm-skeleton__bar--caption",
        "farm-skeleton__bar--figure",
        "farm-skeleton__bar--line",
      ]);
    }
  });

  it("rules five rows under the runners card's head — the seeded fleet's table", () => {
    render(<FarmSkeleton />);

    const runners = grid().querySelector(":scope > .farm-col--8")!;

    expect(runners.querySelectorAll(".farm-skeleton__bar--head")).toHaveLength(1);
    expect(runners.querySelectorAll(".farm-skeleton__row")).toHaveLength(5);
  });

  it("stacks two cards in the right-hand column — the command's block over the pools' two rows", () => {
    render(<FarmSkeleton />);

    const side = grid().querySelector(":scope > .farm__side")!;
    const [enroll, pools] = [...side.children];

    expect(side.children).toHaveLength(2);
    expect(enroll?.querySelectorAll(".farm-skeleton__block")).toHaveLength(1);
    expect(pools?.querySelectorAll(".farm-skeleton__row")).toHaveLength(2);
  });

  it("reserves the log pane under the live card's head", () => {
    render(<FarmSkeleton />);

    const live = grid().querySelector(":scope > .farm-col--12")!;

    expect(live.querySelectorAll(".farm-skeleton__bar--head")).toHaveLength(1);
    expect(live.querySelectorAll(".farm-skeleton__block")).toHaveLength(1);
  });

  it("puts every bar in a line of its own, so it can shrink to a narrow card", () => {
    render(<FarmSkeleton />);

    for (const bar of document.querySelectorAll(".farm-skeleton__bar")) {
      expect(bar.parentElement).toHaveClass("farm-skeleton__line");
    }
  });

  it("carries no text in the grid and writes no inline style, so every size is the sheet's rem", () => {
    const { container } = render(<FarmSkeleton />);

    expect(grid().textContent).toBe("");
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("renders the same markup under either palette", () => {
    const [light, dark] = renderInBothPalettes(<FarmSkeleton />);

    expect(light).toContain("farm-skeleton__bar");
    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});

describe("the loading route", () => {
  it("is the skeleton", () => {
    const route = render(<Loading />);
    const asRoute = route.container.innerHTML;
    route.unmount();

    const { container } = render(<FarmSkeleton />);

    expect(asRoute).toBe(container.innerHTML);
    expect(screen.getByRole("main", { name: FARM_LOADING_LABEL })).toBeInTheDocument();
  });
});
