import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Loading from "@/app/(app)/models/registry/loading";
import {
  LOADING_LABEL,
  RegistrySkeleton,
  SKELETON_ALIASES,
  SKELETON_CLAIMS,
  SKELETON_HOPS,
} from "@/app/registry/registry-skeleton";
import { REGISTRY_SUBLINE, REGISTRY_TITLE } from "@/app/registry/view";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The registry page's skeleton (#596): what stands in for the page while its reads are in
 * flight, at the page's own geometry — the table's eight columns, row for row, and the three
 * cards of the seat row skeletoned in place.
 */

describe("the route's loading file", () => {
  it("draws the skeleton", () => {
    render(<Loading />);

    expect(screen.getByRole("main", { name: LOADING_LABEL })).toBeInTheDocument();
  });
});

describe("the head", () => {
  it("is the real head — the title, the subline and the tab set — not bars", () => {
    render(<RegistrySkeleton />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(REGISTRY_TITLE);
    expect(screen.getByText(REGISTRY_SUBLINE)).toBeInTheDocument();

    const tabs = screen.getByRole("navigation", { name: "Models" });

    expect(within(tabs).getByRole("link", { name: "Model registry" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("reserves the two head actions as bars, because both depend on the role", () => {
    const { container } = render(<RegistrySkeleton />);

    expect(container.querySelectorAll(".registry-skeleton__action")).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("below the tabs", () => {
  it("reserves the seeded eight rows, each with the table's eight cells", () => {
    const { container } = render(<RegistrySkeleton />);
    const rows = container.querySelectorAll(".registry-skeleton__table > .registry-skeleton__row");

    expect(rows).toHaveLength(SKELETON_ALIASES);

    for (const row of rows) {
      expect(row.children).toHaveLength(8);
    }
  });

  it("puts each cell's own shape in the column mockup 21 draws it in", () => {
    const { container } = render(<RegistrySkeleton />);
    const cells = [...container.querySelector(".registry-skeleton__row")!.children];

    expect(cells[0]).toHaveClass("registry-skeleton__pill");
    expect(cells[1]).toHaveClass("registry-skeleton__provider");
    expect(cells[1]!.querySelector(".registry-skeleton__monogram")).not.toBeNull();
    expect(cells[3]).toHaveClass("registry-skeleton__pill--short");
    expect(cells[5]).toHaveClass("registry-skeleton__bar--num");
    expect(cells[6]).toHaveClass("registry-skeleton__bar--num");
    expect(cells[7]).toHaveClass("registry-skeleton__switch");
  });

  it("skeletons the three cards in the seat row, in place", () => {
    const { container } = render(<RegistrySkeleton />);
    const aside = container.querySelector(".registry-skeleton .registry-aside")!;

    expect(aside.children).toHaveLength(3);
    expect(aside.querySelector(".registry-skeleton__panel")).not.toBeNull();
    expect(aside.querySelectorAll(".registry-skeleton__claim")).toHaveLength(SKELETON_CLAIMS);
    expect(aside.querySelectorAll(".registry-skeleton__hop")).toHaveLength(SKELETON_HOPS);
  });

  it("says one thing to a screen reader: the busy label, and nothing from the bars", () => {
    const { container } = render(<RegistrySkeleton />);

    expect(container.querySelector(".registry-skeleton")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".registry-skeleton")!.textContent).toBe("");
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(palette, <RegistrySkeleton />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
  });

  it("draws the same markup in both", () => {
    const [light, dark] = renderInBothPalettes(<RegistrySkeleton />);

    expect(light).toBe(dark);
  });
});
