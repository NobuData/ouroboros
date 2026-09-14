import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RULE_REASONS } from "@/app/workflows/canvas/view";
import { ConnectRow } from "@/app/workflows/inspector/connect-row";
import {
  CONNECTED_NOTE,
  CONNECT_CHOOSE_REASON,
  CONNECT_LABEL,
  CONNECT_TARGET_LABEL,
  MEMBER_REASON,
} from "@/app/workflows/inspector/inspector";

import { standardFixDefinition } from "../../helpers/workflows";

/**
 * **Connect to** (#151) — the keyboard's connection: a stage chosen, the rules a drag is judged by, and
 * the reason under the field and on the button when the choice would break one.
 */

/**
 * Open the row on the seeded Plan stage.
 *
 * @param readOnlyReason Why the reader may not edit, when they may not.
 * @returns The callback.
 */
function open(readOnlyReason?: string) {
  const onConnect = vi.fn();
  render(<ConnectRow definition={standardFixDefinition()} from="plan" onConnect={onConnect} readOnlyReason={readOnlyReason} />);
  return onConnect;
}

/** The target select. */
function target(): HTMLElement {
  return screen.getByRole("combobox", { name: CONNECT_TARGET_LABEL });
}

/** The Connect button. */
function connect(): HTMLElement {
  return screen.getByRole("button", { name: CONNECT_LABEL });
}

describe("connecting from a stage", () => {
  it("offers every other stage, and waits for one to be chosen", () => {
    open();

    const values = [...target().querySelectorAll("option")].map((option) => option.getAttribute("value"));

    expect(values).toHaveLength(12);
    expect(values).not.toContain("plan");
    expect(connect()).toHaveAttribute("aria-disabled", "true");
    expect(connect()).toHaveAttribute("title", CONNECT_CHOOSE_REASON);
  });

  it("hands up the stage chosen, clears the choice, and says it connected", () => {
    const onConnect = open();

    fireEvent.change(target(), { target: { value: "build" } });
    expect(connect()).not.toHaveAttribute("aria-disabled");
    fireEvent.click(connect());

    expect(onConnect).toHaveBeenCalledExactlyOnceWith("build");
    expect(target()).toHaveValue("");
    expect(screen.getByText(CONNECTED_NOTE)).toBeInTheDocument();
  });

  it.each([
    ["the trigger", "issue-queued", "edge.into_trigger"],
    ["a stage it already connects to", "implement", "edge.duplicate"],
  ] as const)("refuses %s, with the rule's reason under the field and on the button", (_what, stage, rule) => {
    const onConnect = open();

    fireEvent.change(target(), { target: { value: stage } });

    expect(screen.getByText(RULE_REASONS[rule])).toBeInTheDocument();
    expect(connect()).toHaveAttribute("title", RULE_REASONS[rule]);
    fireEvent.click(connect());
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("is inert with the reason for a reader who may not edit", () => {
    open(MEMBER_REASON);

    fireEvent.change(target(), { target: { value: "build" } });

    expect(connect()).toHaveAttribute("title", MEMBER_REASON);
  });
});
