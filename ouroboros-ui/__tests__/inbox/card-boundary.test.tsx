import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InboxCardBoundary } from "@/app/inbox/card-boundary";
import { CARD_FAILED_NOTE, CARD_FAILED_TITLE } from "@/app/inbox/view";

/** One inbox card's designed error (BO.5, #470): one card that cannot draw degrades only itself. */

/** A card that cannot draw what it was sent. */
function Broken(): never {
  throw new Error("an unexpected shape");
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the boundary", () => {
  it("draws the card when it draws", () => {
    render(
      <InboxCardBoundary label="What needs a human">
        <p>the card</p>
      </InboxCardBoundary>,
    );

    expect(screen.getByText("the card")).toBeInTheDocument();
  });

  it("stands in for a card that throws, named as the card, with the designed words", () => {
    render(
      <>
        <InboxCardBoundary label="What needs a human">
          <Broken />
        </InboxCardBoundary>
        <InboxCardBoundary label="This week">
          <p>the neighbour</p>
        </InboxCardBoundary>
      </>,
    );

    const standIn = screen.getByRole("region", { name: "What needs a human" });

    expect(standIn).toHaveClass("inbox-fault");
    expect(standIn).toHaveTextContent(CARD_FAILED_TITLE);
    expect(standIn).toHaveTextContent(CARD_FAILED_NOTE);
    expect(screen.getByText("the neighbour")).toBeInTheDocument();
  });

  it("says what failed in the console, where a developer looks", () => {
    render(
      <InboxCardBoundary label="This week">
        <Broken />
      </InboxCardBoundary>,
    );

    expect(console.error).toHaveBeenCalledWith(
      'Inbox card "This week" failed to draw',
      expect.any(Error),
      expect.anything(),
    );
  });
});
