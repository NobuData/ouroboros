import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DryRunPolicy } from "@/app/api/policies";
import { DryRunRow } from "@/app/policies/dry-run-row";
import {
  DRY_RUN_TITLE,
  POLICY_CANCEL,
  POLICY_READ_ONLY,
  type PolicyFlipResult,
} from "@/app/policies/view";

/**
 * The dry-run policy's row (BA.3, #382), rendered — as the settings hub's Policies section
 * mounts it since BS.1 (#491): the flip is a confirmation that states its consequences, only the
 * confirmation sends, a refusal is said in the dialog, and a reader below admin sees the policy
 * and why they may not flip it, with no switched-off control.
 */

// The Server Action is never reached: every case passes its own flip.
vi.mock("@/app/policies/policy-actions", () => ({ setDryRun: vi.fn() }));

const ON: DryRunPolicy = {
  dryRun: true,
  explicit: true,
  reason: "dry-run policy active",
  updatedAt: "2026-09-30T12:00:00.000Z",
  updatedBy: null,
};

const OFF: DryRunPolicy = {
  ...ON,
  dryRun: false,
  reason: null,
  updatedBy: "user-owner",
};

/**
 * Draw the row.
 *
 * @param options The policy, whether the reader may flip, and the flip.
 * @returns The flip spy.
 */
function draw(
  options: {
    policy?: DryRunPolicy;
    mayAdminister?: boolean;
    flip?: (dryRun: boolean) => Promise<PolicyFlipResult>;
  } = {},
) {
  const flip =
    options.flip ?? vi.fn(() => Promise.resolve<PolicyFlipResult>({ ok: true, policy: OFF }));

  render(
    <DryRunRow
      mayAdminister={options.mayAdminister ?? true}
      onFlip={flip}
      policy={options.policy ?? ON}
    />,
  );

  return flip;
}

/** The dry-run row. */
function row(): HTMLElement {
  return screen.getByRole("group", { name: DRY_RUN_TITLE });
}

/**
 * Press something, and let what it sent settle.
 *
 * @param element What to press.
 */
async function press(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

describe("the row", () => {
  it("names the policy under the section's own heading, and draws no page chrome", () => {
    draw();

    // The section's card owns the `h2`; the policy is a row of it.
    expect(within(row()).getByRole("heading", { level: 3 })).toHaveTextContent(DRY_RUN_TITLE);
    expect(screen.queryByRole("main")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("states where the policy stands", () => {
    draw();

    expect(within(row()).getByRole("status")).toHaveTextContent(/^On — /);
  });

  it("never takes the accent fill: the page's one primary action is Save changes", () => {
    draw({ policy: OFF });

    const on = within(row()).getByRole("button", { name: "Turn dry-run on" });

    expect(on).not.toHaveClass("ou-btn--primary");
  });
});

describe("the flip", () => {
  it("opens a confirmation stating the consequences, and sends nothing until confirmed", async () => {
    const flip = draw();

    await press(within(row()).getByRole("button", { name: "Turn dry-run off" }));

    const dialog = screen.getByRole("alertdialog", { name: "Turn dry-run off?" });

    expect(dialog).toHaveTextContent("without a person in the loop");
    expect(flip).not.toHaveBeenCalled();

    await press(within(dialog).getByRole("button", { name: "Turn dry-run off" }));

    expect(flip).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(within(row()).getAllByRole("status")[0]).toHaveTextContent(/^Off — /);
    expect(within(row()).getByRole("button", { name: "Turn dry-run on" })).toBeInTheDocument();
  });

  it("sends nothing when cancelled", async () => {
    const flip = draw();

    await press(within(row()).getByRole("button", { name: "Turn dry-run off" }));
    await press(screen.getByRole("button", { name: POLICY_CANCEL }));

    expect(flip).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("says a refusal in the dialog and changes nothing", async () => {
    draw({
      flip: () => Promise.resolve<PolicyFlipResult>({ ok: false, reason: POLICY_READ_ONLY }),
    });

    await press(within(row()).getByRole("button", { name: "Turn dry-run off" }));
    await press(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Turn dry-run off" }),
    );

    expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toHaveTextContent(
      POLICY_READ_ONLY,
    );
    expect(within(row()).getByRole("status")).toHaveTextContent(/^On — /);
  });

  it("turns it on with the same confirmation", async () => {
    const flip = draw({
      policy: OFF,
      flip: vi.fn(() => Promise.resolve<PolicyFlipResult>({ ok: true, policy: ON })),
    });

    await press(within(row()).getByRole("button", { name: "Turn dry-run on" }));
    await press(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Turn dry-run on" }),
    );

    expect(flip).toHaveBeenCalledWith(true);
  });
});

describe("a reader below admin", () => {
  it("sees the policy and why they may not flip it, with no control drawn switched off", () => {
    const flip = draw({ mayAdminister: false });

    // Read-only is legible, not disabled: where it stands and why it cannot be changed are
    // text, and there is no button to look broken.
    expect(within(row()).getAllByRole("status")[0]).toHaveTextContent(/^On — /);
    expect(within(row()).getByRole("note")).toHaveTextContent(POLICY_READ_ONLY);
    expect(within(row()).queryByRole("button")).toBeNull();
    expect(row().querySelector("[aria-disabled]")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(flip).not.toHaveBeenCalled();
  });
});
