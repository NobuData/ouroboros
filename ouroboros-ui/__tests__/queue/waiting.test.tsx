import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WaitingChip, WaitingNotice } from "@/app/queue/waiting";
import { WAITING_COPY } from "@/app/queue/waiting-copy";

/** The chip and the notice a waiting queued issue is drawn with (DI.4, #1312). */

afterEach(() => {
  cleanup();
});

describe("the chip", () => {
  it("prints the label, and gives the sentence as the tooltip and to a screen reader", () => {
    const { container } = render(
      <WaitingChip waiting={{ reason: "needs_confirmation", scope: "item" }} />,
    );
    const copy = WAITING_COPY.needs_confirmation;

    expect(screen.getByText(copy.label)).toHaveAttribute("title", copy.sentence);
    expect(screen.getByText(copy.sentence, { exact: false })).toHaveClass("sr-only");
    expect(container.querySelector("[data-reason]")).toHaveAttribute(
      "data-reason",
      "needs_confirmation",
    );
  });

  it("wears the warning hue", () => {
    render(<WaitingChip waiting={{ reason: "concurrency_ceiling", scope: "workspace" }} />);

    expect(screen.getByText(WAITING_COPY.concurrency_ceiling.label)).toHaveClass("ou-chip--warn");
  });
});

describe("the notice", () => {
  it("says the sentence and links in-app fixes in place", () => {
    render(<WaitingNotice waiting={{ reason: "policy_not_dry_run", scope: "item" }} />);

    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(WAITING_COPY.policy_not_dry_run.sentence);
    expect(screen.getByRole("link", { name: "Policies →" })).toHaveAttribute(
      "href",
      "/settings#policies",
    );
    expect(note).toHaveAttribute("data-scope", "item");
  });

  it("opens documentation in a new tab", () => {
    render(<WaitingNotice waiting={{ reason: "deployment_disabled", scope: "workspace" }} />);

    expect(screen.getByRole("link", { name: "How to enable" })).toHaveAttribute("target", "_blank");
  });

  it("draws no link when the fix is the item's own action", () => {
    render(<WaitingNotice compact waiting={{ reason: "needs_confirmation", scope: "item" }} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("note")).toHaveClass("queue-waiting--compact");
  });
});
