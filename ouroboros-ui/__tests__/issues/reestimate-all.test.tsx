import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANCEL_LABEL,
  REESTIMATE_BUSY,
  REESTIMATE_LABEL,
  REESTIMATE_NOTE,
  REESTIMATE_NOTHING,
  REESTIMATE_TITLE,
  REESTIMATE_UNCOUNTED,
} from "@/app/issues/view";

import { UNCOUNTED, counted } from "../helpers/issues";

/**
 * **Re-estimate all** (#115) — the head action that spends the workspace's engine quota in one
 * press, and so asks first.
 *
 * The acceptance criterion is *confirms with the real issue count*, and L.4's confirmation contract
 * has two halves, both asserted here: the dialog states the scope the service will act on — every
 * mirrored issue, which is not the open count once anything has closed — and the answer reports how
 * many actually started. Around that: nothing is written until the reader commits, cancelling writes
 * nothing, and a press that could not state a number is not offered. Who sees the control at all is
 * the screen's and the route's to decide, and their suites cover it.
 */

/** What the action answers, per case. */
const reestimateAll = vi.fn();

/** What tells the server's own render that the statuses moved. */
const refresh = vi.fn();

vi.mock("@/app/issues/head-actions", () => ({
  queueSelected: vi.fn(),
  reestimateAll: () => reestimateAll(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { ReestimateAllButton } = await import("@/app/issues/reestimate-all");

/** The head control. */
function button(): HTMLElement {
  return screen.getByRole("button", { name: REESTIMATE_LABEL });
}

/** The confirmation, which must be open. */
function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: REESTIMATE_TITLE });
}

beforeEach(() => {
  reestimateAll.mockReset().mockResolvedValue({ ok: true, message: "Re-estimating 9 issues." });
  refresh.mockReset();
});

describe("the confirmation", () => {
  it("opens on a press, and nothing is written yet", () => {
    render(<ReestimateAllButton counts={counted()} />);

    fireEvent.click(button());

    expect(dialog()).toBeInTheDocument();
    expect(reestimateAll).not.toHaveBeenCalled();
  });

  it("states the seeded scope, and puts the same count on the control that commits", () => {
    render(<ReestimateAllButton counts={counted()} />);

    fireEvent.click(button());

    expect(within(dialog()).getByText("This re-estimates 9 issues.")).toBeInTheDocument();
    expect(within(dialog()).getByText(REESTIMATE_NOTE)).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Re-estimate 9 issues" })).toBeInTheDocument();
  });

  it("states every mirrored issue rather than the open count, since closed issues are claimed too", () => {
    // L.4's claim has no `state` in it. A dialog that said "9" over a press that took 12 would be
    // the untruthful scope the issue asks this to avoid.
    render(<ReestimateAllButton counts={counted({ openCount: 9, mirroredCount: 12 })} />);

    fireEvent.click(button());

    expect(within(dialog()).getByText("This re-estimates 12 issues.")).toBeInTheDocument();
    expect(within(dialog()).queryByText(/re-estimates 9 issues/)).toBeNull();
  });

  it("closes on Cancel, having written nothing", () => {
    render(<ReestimateAllButton counts={counted()} />);

    fireEvent.click(button());
    fireEvent.click(within(dialog()).getByRole("button", { name: CANCEL_LABEL }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reestimateAll).not.toHaveBeenCalled();
  });

  it("closes on Escape, having written nothing", () => {
    render(<ReestimateAllButton counts={counted()} />);

    fireEvent.click(button());
    fireEvent.keyDown(dialog(), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reestimateAll).not.toHaveBeenCalled();
  });
});

describe("committing", () => {
  it("starts the fan-out once, closes the dialog, reports what started and re-reads the route", async () => {
    render(<ReestimateAllButton counts={counted()} />);

    fireEvent.click(button());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Re-estimate 9 issues" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByRole("status")).toHaveTextContent("Re-estimating 9 issues.");
    expect(reestimateAll).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("reports how many actually started, which can be fewer than the dialog counted", async () => {
    reestimateAll.mockResolvedValue({
      ok: true,
      message: "Re-estimating 7 issues. 2 issues already being estimated were left alone.",
    });
    render(<ReestimateAllButton counts={counted()} />);

    fireEvent.click(button());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Re-estimate 9 issues" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/left alone/);
  });

  it("reports a refusal under the button and re-reads nothing", async () => {
    reestimateAll.mockResolvedValue({ ok: false, reason: REESTIMATE_BUSY });
    render(<ReestimateAllButton counts={counted()} />);

    fireEvent.click(button());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Re-estimate 9 issues" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(REESTIMATE_BUSY);
    await waitFor(() => expect(reestimateAll).toHaveBeenCalledOnce());
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("when there is no honest number to confirm", () => {
  it("is inert when the backlog could not be counted, and opens nothing", () => {
    render(<ReestimateAllButton counts={UNCOUNTED} />);

    expect(button()).toHaveAttribute("aria-disabled", "true");
    expect(button()).toHaveAttribute("title", REESTIMATE_UNCOUNTED);

    fireEvent.click(button());

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is inert for a workspace that mirrors nothing, and opens nothing", () => {
    render(
      <ReestimateAllButton counts={counted({ openCount: 0, sizedCount: 0, mirroredCount: 0 })} />,
    );

    expect(button()).toHaveAttribute("aria-disabled", "true");
    expect(button()).toHaveAttribute("title", REESTIMATE_NOTHING);

    fireEvent.click(button());

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
