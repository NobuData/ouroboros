import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Loading from "@/app/(app)/models/providers/loading";
import {
  LOADING_LABEL,
  ProvidersSkeleton,
  SKELETON_CARDS,
  SKELETON_CHIPS,
} from "@/app/providers/providers-skeleton";
import { PROVIDERS_TITLE, SECURITY_STRIP_LABEL, WORKSPACE_SLOT } from "@/app/providers/view";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The providers page's skeleton (#232): what stands in for the page while its reads are in
 * flight, at the page's own geometry.
 */

describe("the route's loading file", () => {
  it("draws the skeleton", () => {
    render(<Loading />);

    expect(screen.getByRole("main", { name: LOADING_LABEL })).toBeInTheDocument();
  });
});

describe("the head", () => {
  it("is the real head — the title and the tab set — not bars", () => {
    render(<ProvidersSkeleton />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PROVIDERS_TITLE);

    const tabs = screen.getByRole("navigation", { name: "Models" });
    expect(within(tabs).getByRole("link", { name: "Providers & keys" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("draws the subline as itself around a bar where the workspace's name will go", () => {
    // The one word the skeleton cannot know is a bar the width of a name, so the sentence
    // wraps on the same line before and after the data lands.
    const { container } = render(<ProvidersSkeleton />);

    const subline = container.querySelector(".models__sub") as HTMLElement;
    expect(subline).toHaveTextContent(/encrypted vault/);
    expect(subline).toHaveTextContent(/workers never receive them at all/);
    expect(subline.textContent).not.toContain(WORKSPACE_SLOT);
    expect(subline.querySelectorAll(".providers-skeleton__slot")).toHaveLength(1);
  });

  it("reserves the two head actions as bars, because one of them depends on the role", () => {
    const { container } = render(<ProvidersSkeleton />);

    expect(container.querySelectorAll(".providers-skeleton__action")).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("below the tabs", () => {
  it("lays the card shapes out on the page's own grid, five of them, then the dashed card", () => {
    const { container } = render(<ProvidersSkeleton />);

    const grid = container.querySelector(".providers-grid") as HTMLElement;
    expect(grid).toHaveClass("providers-skeleton");
    expect(grid.querySelectorAll(".providers-skeleton__card")).toHaveLength(SKELETON_CARDS);
    expect(grid.children).toHaveLength(SKELETON_CARDS + 1);
    expect(grid.children[SKELETON_CARDS]).toHaveClass("providers-add-card");
  });

  it("stands in for each card with the card's own regions, at their controls' boxes", () => {
    const { container } = render(<ProvidersSkeleton />);

    for (const card of container.querySelectorAll(".providers-skeleton__card")) {
      expect(card).toHaveClass("providers-card", "ou-card--fill");
      const head = card.querySelector(".providers-card__head") as HTMLElement;
      expect(head.querySelector(".providers-skeleton__monogram")).not.toBeNull();
      expect(head.querySelectorAll(".providers-skeleton__bar")).toHaveLength(2);
      expect(head.querySelector(".providers-skeleton__pill")).not.toBeNull();
      expect(head.querySelector(".providers-skeleton__switch")).not.toBeNull();

      const keyRow = card.querySelector(".providers-skeleton__key-row") as HTMLElement;
      expect(keyRow.querySelectorAll(".providers-skeleton__input")).toHaveLength(1);
      expect(keyRow.querySelectorAll(".providers-skeleton__button")).toHaveLength(2);

      expect(card.querySelector(".providers-skeleton__bar--meta")).not.toBeNull();
      expect(
        card.querySelectorAll(".providers-card__models .providers-skeleton__pill"),
      ).toHaveLength(SKELETON_CHIPS);
      expect(card.querySelector(".providers-card__meter .providers-skeleton__meter")).not.toBeNull();

      const foot = card.querySelector(".providers-card__foot") as HTMLElement;
      expect(foot.querySelector(".providers-skeleton__button--test")).not.toBeNull();
      expect(foot.querySelector(".providers-skeleton__input--cap")).not.toBeNull();
    }
  });

  it("draws the security strip as itself — its copy depends on no read", () => {
    render(<ProvidersSkeleton />);

    expect(screen.getByRole("complementary", { name: SECURITY_STRIP_LABEL })).toBeInTheDocument();
  });
});

describe("what a screen reader is told", () => {
  it("is that the page is busy, once, by the main region's label", () => {
    render(<ProvidersSkeleton />);

    expect(screen.getByRole("main", { name: LOADING_LABEL })).toHaveAttribute("aria-busy", "true");
  });

  it("hides the bars from the accessibility tree", () => {
    const { container } = render(<ProvidersSkeleton />);

    expect(container.querySelector(".providers-skeleton")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".providers-skeleton__actions")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".providers-skeleton__slot")).toHaveAttribute("aria-hidden", "true");
  });

  it("carries no text in any bar", () => {
    const { container } = render(<ProvidersSkeleton />);

    for (const bar of container.querySelectorAll('[class*="providers-skeleton__"]')) {
      expect(bar.textContent).toBe("");
    }
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(palette, <ProvidersSkeleton />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("main", { name: LOADING_LABEL })).toBeInTheDocument();
  });

  it("draws the same markup in both, and carries no inline style", () => {
    const [light, dark] = renderInBothPalettes(<ProvidersSkeleton />);

    expect(light).toBe(dark);
    expect(light).not.toMatch(/ style=/);
  });
});
