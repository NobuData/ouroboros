import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Loading from "@/app/(app)/settings/sources/loading";
import { LOADING_LABEL, SKELETON_ROWS, SourcesSkeleton } from "@/app/sources/sources-skeleton";
import { SOURCES_TITLE } from "@/app/sources/view";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The loading state ([#141](https://github.com/NobuData/ouroboros/issues/141)): the real
 * head and tab row, and bars where the rows will be.
 */

describe("the route's loading file", () => {
  it("draws the skeleton", () => {
    render(<Loading />);

    expect(screen.getByRole("main", { name: LOADING_LABEL })).toHaveAttribute("aria-busy", "true");
  });
});

describe("the skeleton", () => {
  it("draws the real head and the tab row, not bars", () => {
    render(<SourcesSkeleton />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(SOURCES_TITLE);

    const tabs = screen.getByRole("navigation", { name: "Settings" });

    expect(within(tabs).getByRole("link", { name: "Sources" })).toHaveAttribute("aria-current", "page");
  });

  it("reserves the rows' geometry, hidden from assistive technology", () => {
    const { container } = render(<SourcesSkeleton />);

    expect(container.querySelectorAll(".sources-skeleton__row")).toHaveLength(SKELETON_ROWS);
    expect(container.querySelector(".sources-skeleton")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<SourcesSkeleton />);

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
