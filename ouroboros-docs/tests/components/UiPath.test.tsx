// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import UiPath, { uiPathSteps } from "../../src/components/UiPath";

describe("uiPathSteps", () => {
  it("splits on > and trims each step", () => {
    expect(uiPathSteps("Settings > Members")).toEqual(["Settings", "Members"]);
  });

  it("accepts the › separator too, and drops empty steps", () => {
    expect(uiPathSteps(" Build farm › Runners >  > Drain ")).toEqual([
      "Build farm",
      "Runners",
      "Drain",
    ]);
  });

  it("refuses a path with no step", () => {
    expect(() => uiPathSteps(" > ")).toThrow(/at least one step/);
  });
});

describe("<UiPath>", () => {
  it("renders the steps joined by › in breadcrumb style", () => {
    const { container } = render(<UiPath path="Settings > Members" />);
    expect(container.textContent).toBe("Settings › Members");
    expect(screen.getByText("Settings")).toHaveClass("step");
    expect(screen.getByText("Members")).toHaveClass("step");
  });

  it("renders a single step without a separator", () => {
    const { container } = render(<UiPath path="Inbox" />);
    expect(container.textContent).toBe("Inbox");
    expect(container.querySelector(".separator")).toBeNull();
  });

  it("fails loudly on an empty path", () => {
    expect(() => render(<UiPath path="" />)).toThrow(/at least one step/);
  });
});
