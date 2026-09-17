import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  GANTT_LANES,
  HEALTH_METERS,
  LOADING_LABEL,
  PlanningSkeleton,
  SYNC_ROWS,
} from "@/app/planning/planning-skeleton";
import { PLANNING_EYEBROW, PLANNING_SUBLINE, PLANNING_TITLE } from "@/app/planning/view";

import Loading from "@/app/(app)/planning/loading";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The planning page's loading state (AM.5, #287).
 *
 * A skeleton earns its place by reserving the geometry the real page will take, so what is under
 * test is that it draws the *same grid seats* the screen does — and that it says one thing to a
 * screen reader rather than forty.
 */

describe("the head", () => {
  // The eyebrow, heading and subline are constants, so they are drawn for real and the head's
  // height is right by construction rather than by estimate.
  it("is the real copy, not bars", () => {
    render(<PlanningSkeleton />);

    expect(screen.getByText(PLANNING_EYEBROW)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PLANNING_TITLE);
    expect(screen.getByText(PLANNING_SUBLINE)).toBeInTheDocument();
  });
});

describe("the grid", () => {
  it("reserves the page's own three seats, in its order", () => {
    const { container } = render(<PlanningSkeleton />);
    const grid = container.querySelector(".planning__grid")!;

    expect([...grid.children].map((seat) => seat.className)).toStrictEqual([
      "planning__generator",
      "planning__side",
      "planning__roadmap",
    ]);
  });

  it("stacks two cards in the side column, as the page does", () => {
    const { container } = render(<PlanningSkeleton />);

    expect(container.querySelectorAll(".planning__side > .ou-card")).toHaveLength(2);
  });

  it("draws a seat for each of the four cards", () => {
    const { container } = render(<PlanningSkeleton />);

    expect(container.querySelectorAll(".planning__region")).toHaveLength(4);
  });

  it("reserves a row per tracker, a meter per figure and a lane per epic", () => {
    const { container } = render(<PlanningSkeleton />);

    expect(container.querySelectorAll(".planning-sync__row")).toHaveLength(SYNC_ROWS);
    expect(container.querySelectorAll(".planning-health__meter")).toHaveLength(HEALTH_METERS);
    expect(container.querySelectorAll(".planning-skeleton__lane")).toHaveLength(GANTT_LANES);
  });
});

describe("what it says", () => {
  it("is busy, and named once", () => {
    render(<PlanningSkeleton />);

    const main = screen.getByRole("main");

    expect(main).toHaveAttribute("aria-busy", "true");
    expect(main).toHaveAccessibleName(LOADING_LABEL);
  });

  it("hides the bars from the accessibility tree", () => {
    const { container } = render(<PlanningSkeleton />);

    expect(container.querySelector(".planning__grid")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".planning__actions")).toHaveAttribute("aria-hidden", "true");
  });

  it("puts no text in any bar", () => {
    const { container } = render(<PlanningSkeleton />);

    for (const bar of container.querySelectorAll("[class*='planning-skeleton__']")) {
      expect(bar.textContent).toBe("");
    }
  });

  // Nothing here is a region: four unnamed regions in the tree would be worse than none.
  it("names no region while it is still a skeleton", () => {
    render(<PlanningSkeleton />);

    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });
});

describe("both palettes", () => {
  it("renders identically under each, so the theme is the stylesheet's alone", () => {
    const [light, dark] = renderInBothPalettes(<PlanningSkeleton />);

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});

describe("the route", () => {
  // Planning was the one app route with no `loading.tsx` before #287.
  it("is what Next.js renders while the segment's reads are in flight", () => {
    const { container } = render(<Loading />);

    expect(screen.getByRole("main")).toHaveAccessibleName(LOADING_LABEL);
    expect(container.querySelectorAll(".planning__region")).toHaveLength(4);
  });
});
