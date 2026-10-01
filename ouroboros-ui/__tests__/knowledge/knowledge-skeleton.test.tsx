import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KnowledgeSkeleton, LOADING_LABEL } from "@/app/knowledge/knowledge-skeleton";
import { KNOWLEDGE_SUBLINE, KNOWLEDGE_TITLE } from "@/app/knowledge/view";

/**
 * The knowledge route's loading state (#417): the head is drawn for real, the seats are reserved
 * in the page's own classes, and a screen reader is told one thing.
 */

describe("the skeleton", () => {
  it("draws the head for real and marks the page busy once", () => {
    render(<KnowledgeSkeleton />);

    const main = screen.getByRole("main");

    expect(main).toHaveAttribute("aria-busy", "true");
    expect(main).toHaveAccessibleName(LOADING_LABEL);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(KNOWLEDGE_TITLE);
    expect(screen.getByText(KNOWLEDGE_SUBLINE)).toBeInTheDocument();
  });

  it("reserves the grid in the page's own classes, hidden from assistive technology", () => {
    const { container } = render(<KnowledgeSkeleton />);

    expect(container.querySelector(".knowledge__grid")).toHaveAttribute("aria-hidden");
    expect(container.querySelector(".knowledge__actions")).toHaveAttribute("aria-hidden");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reserves a seat for every card the screen draws — two on the left, three on the right (#421)", () => {
    const { container } = render(<KnowledgeSkeleton />);

    expect(container.querySelectorAll(".knowledge__main > .ou-card")).toHaveLength(2);
    expect(container.querySelectorAll(".knowledge__aside > .ou-card")).toHaveLength(3);
  });
});
