import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ModelsGrid } from "@/app/models/models-grid";

/**
 * The two-column layout (#204) — one component, so the two callers that draw it cannot
 * disagree about it.
 */

describe("the grid", () => {
  it("places the main seat first and the right column second, as a flex column at four of twelve", () => {
    const { container } = render(
      <ModelsGrid aside={<p>aside</p>} main={<div className="models-col--8">main</div>} />,
    );

    const grid = container.firstElementChild as HTMLElement;

    expect(grid).toHaveClass("models-grid");
    expect(grid.children).toHaveLength(2);
    expect(grid.children[0]).toHaveTextContent("main");
    expect(grid.children[1]).toHaveClass("models-col--4", "models-aside");
    expect(grid.children[1]).toHaveTextContent("aside");
  });
});
