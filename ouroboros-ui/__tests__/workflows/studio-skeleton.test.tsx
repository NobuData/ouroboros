import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Loading from "@/app/(app)/workflows/loading";
import { WORKFLOWS_PATH } from "@/app/paths";
import {
  LOADING_LABEL,
  SKELETON_ACTIONS,
  SKELETON_WORKFLOWS,
  StudioSkeleton,
} from "@/app/workflows/studio-skeleton";
import { STUDIO_EYEBROW } from "@/app/workflows/view";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The studio's skeleton (#147): what stands in for the page while its reads are in flight, at
 * the page's own geometry.
 */

describe("the route's loading file", () => {
  it("draws the skeleton", () => {
    render(<Loading />);

    expect(screen.getByRole("main", { name: LOADING_LABEL })).toBeInTheDocument();
  });
});

describe("the head", () => {
  it("draws the eyebrow and the segmented control as themselves, because neither depends on the reads", () => {
    render(<StudioSkeleton />);

    expect(screen.getByText(STUDIO_EYEBROW, { selector: ".ou-eyebrow" })).toBeInTheDocument();

    const segments = screen.getByRole("navigation", { name: STUDIO_EYEBROW });

    expect(within(segments).getByRole("link", { name: "Visual" })).toHaveAttribute(
      "href",
      WORKFLOWS_PATH,
    );
  });

  it("draws the title and the subline as bars, because both depend on the reads", () => {
    // The one difference from the routing skeleton: the title is the selected workflow's name.
    const { container } = render(<StudioSkeleton />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("");
    expect(container.querySelector(".studio__title > .studio-skeleton__title")).not.toBeNull();
    expect(container.querySelector(".studio__sub > .studio-skeleton__sub")).not.toBeNull();
  });

  it("reserves the three head actions as bars, and draws no control", () => {
    const { container } = render(<StudioSkeleton />);

    expect(container.querySelectorAll(".studio-skeleton__action")).toHaveLength(SKELETON_ACTIONS);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("below the control", () => {
  it("stands in for the rail with the seeded workspace's five items and the tile", () => {
    const { container } = render(<StudioSkeleton />);

    expect(container.querySelectorAll(".studio-skeleton__rail > .studio-skeleton__item")).toHaveLength(
      SKELETON_WORKFLOWS,
    );
    expect(container.querySelectorAll(".studio-skeleton__rail > .studio-skeleton__new")).toHaveLength(1);
  });

  it("stands in for the seat, on the grid's own rule", () => {
    const { container } = render(<StudioSkeleton />);

    expect(container.querySelector(".studio__grid > .studio-skeleton__seat")).not.toBeNull();
  });

  it("says one thing to a screen reader, not twenty", () => {
    // The frame is busy and labelled once; the region below the control is hidden.
    const { container } = render(<StudioSkeleton />);

    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".studio-skeleton")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(palette, <StudioSkeleton />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("main", { name: LOADING_LABEL })).toBeInTheDocument();
  });

  it("draws the same markup in both", () => {
    const [light, dark] = renderInBothPalettes(<StudioSkeleton />);

    expect(light).toBe(dark);
  });
});
