import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Page from "@/app/(app)/page";

describe("the placeholder home page", () => {
  it("renders one top-level heading", () => {
    render(<Page />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Infinity in autonomy" }),
    ).toBeInTheDocument();
  });

  it("is a main landmark, so the shell (#41) has something to wrap", () => {
    // The shell contributes header, navigation and the content pane; `main` is the
    // page's own landmark inside that pane.
    render(<Page />);

    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("styles itself through classes only — no inline style survives review", () => {
    const { container } = render(<Page />);
    const main = container.querySelector("main");

    expect(main).toHaveClass("placeholder");
    expect(main?.getAttribute("style")).toBeNull();
  });

  it("names what lands next, so the placeholder explains itself", () => {
    render(<Page />);

    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toHaveLength(2);
    expect(items.join(" ")).toContain("#42");
    // The shell has landed, so the list no longer promises it.
    expect(items.join(" ")).not.toContain("#41");
  });
});
