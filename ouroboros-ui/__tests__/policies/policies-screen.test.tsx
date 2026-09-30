import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DryRunPolicy } from "@/app/api/policies";
import { POLICIES_PATH } from "@/app/paths";
import { PoliciesScreen } from "@/app/policies/policies-screen";
import {
  DRY_RUN_TITLE,
  POLICY_CANCEL,
  POLICY_READ_ONLY,
  type PolicyFlipResult,
} from "@/app/policies/view";

/**
 * Settings → Policies (BA.3, #382), rendered: the flip is a confirmation that states its
 * consequences, only the confirmation sends, a refusal is said in the dialog, and a reader below
 * admin sees the policy and why they may not flip it.
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
 * Draw the screen.
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
    <PoliciesScreen
      mayAdminister={options.mayAdminister ?? true}
      onFlip={flip}
      policy={options.policy ?? ON}
      workspaceName="Acme Robotics"
    />,
  );

  return flip;
}

/** The dry-run card. */
function row(): HTMLElement {
  return screen.getByRole("region", { name: DRY_RUN_TITLE });
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

describe("the Policies tab", () => {
  it("is the settings section's Policies tab, current", () => {
    draw();

    const tabs = screen.getByRole("navigation", { name: "Settings" });

    expect(within(tabs).getByRole("link", { name: "Policies" })).toHaveAttribute(
      "href",
      POLICIES_PATH,
    );
    expect(within(tabs).getByRole("link", { name: "Policies" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("states where the policy stands", () => {
    draw();

    expect(within(row()).getByRole("status")).toHaveTextContent(/^On — /);
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
  it("sees the policy and why they may not flip it, and cannot open the confirmation", async () => {
    const flip = draw({ mayAdminister: false });
    const button = within(row()).getByRole("button", { name: "Turn dry-run off" });

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(within(row()).getByRole("note")).toHaveTextContent(POLICY_READ_ONLY);

    await press(button);

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(flip).not.toHaveBeenCalled();
  });
});
