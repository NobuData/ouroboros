import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Loading from "@/app/(app)/chatops/loading";
import { ChatOpsSkeleton } from "@/app/chatops/chatops-skeleton";
import { CHATOPS_HEADLINE, CHATOPS_SUBLINE, LOADING_LABEL } from "@/app/chatops/view";

import { renderInBothPalettes } from "../helpers/palettes";

/** What `/chatops` draws while it reads (#541): the real head, and bars where the reads land. */
describe("the Chat Ops skeleton", () => {
  it("is what the route's loading boundary returns", () => {
    render(<Loading />);

    expect(screen.getByRole("main", { name: LOADING_LABEL })).toHaveAttribute("aria-busy", "true");
  });

  it("draws the real head, and neither action — each depends on a read", () => {
    render(<ChatOpsSkeleton />);

    expect(screen.getByRole("heading", { level: 1, name: CHATOPS_HEADLINE })).toBeInTheDocument();
    expect(screen.getByText(CHATOPS_SUBLINE)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("reserves the strip and a card of three rows", () => {
    render(<ChatOpsSkeleton />);

    expect(document.querySelectorAll(".chatops__sk-bar--strip")).toHaveLength(1);
    expect(document.querySelectorAll(".chatops__sk-bar--row")).toHaveLength(3);
  });

  it("says one thing to a screen reader: every bar is hidden", () => {
    render(<ChatOpsSkeleton />);

    for (const bar of document.querySelectorAll(".chatops__sk-bar")) {
      expect(bar.closest("[aria-hidden='true']")).not.toBeNull();
      expect(bar.textContent).toBe("");
    }
  });

  it("renders the same markup under both palettes", () => {
    const [light, dark] = renderInBothPalettes(<ChatOpsSkeleton />);

    expect(light).toBe(dark);
  });
});
