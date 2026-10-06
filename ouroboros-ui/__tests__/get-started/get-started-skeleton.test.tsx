import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GetStartedSkeleton, SKELETON_CARDS } from "@/app/get-started/get-started-skeleton";
import { STEP_COUNT } from "@/app/get-started/view";

/**
 * `/get-started`'s loading state (BC.6, #395): the frame's geometry reserved — head, four step
 * shapes, card shapes, the bar — with nothing ticked and nothing named, because every one of
 * those is the service's answer.
 */

afterEach(() => {
  cleanup();
});

describe("the skeleton", () => {
  it("draws the real head and reserves the rail, the content and the bar", () => {
    const { container } = render(<GetStartedSkeleton />);
    const parts = [...container.firstElementChild!.children].map((child) => child.className);

    expect(container.firstElementChild).toHaveClass("wizard", "wizard-skeleton");
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
    expect(parts).toEqual(["wizard__head", "wizard-rail", "wizard__content", "wizard-bar"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your first loop in about 4 minutes.");
    expect(screen.getByRole("status")).toHaveTextContent("Loading Get Started");
    expect(container.querySelectorAll(".wizard-skeleton__step")).toHaveLength(STEP_COUNT);
    expect(container.querySelectorAll(".wizard-skeleton__card")).toHaveLength(SKELETON_CARDS);
  });

  it("claims no state: no mark is ticked, no step is named, no control is drawn", () => {
    const { container } = render(<GetStartedSkeleton />);

    expect(container.textContent).not.toMatch(/✓|Step \d|Connect GitHub|Run my first loop/);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("link")).toEqual([]);
    expect(container.querySelector(".wizard-rail")).toHaveAttribute("aria-hidden", "true");
  });
});
