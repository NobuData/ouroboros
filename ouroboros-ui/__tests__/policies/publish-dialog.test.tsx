import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  CLASS_MEANINGS,
  KEEP_EDITING,
  NOTE_LABEL,
  OWNER_GATE_TITLE,
  ownerGate,
} from "@/app/policies/card-view";
import { PublishDialog, type PublishDecision } from "@/app/policies/publish-dialog";

import { GATED_PREVIEW, policyPreview } from "../helpers/org-policy";

/**
 * The publish confirmation and the owner gate (BS.4, #494): the dialog names which way each
 * changed rule moves autonomy, publishes only on the reader's word, and gives an admin whose
 * edit loosens a rule an explanation and a way forward instead of a button.
 */

/**
 * Draw the dialog.
 *
 * @param preview The preview to confirm.
 * @param owners The workspace's owners.
 * @returns The spy that receives the decision.
 */
function draw(preview = policyPreview(), owners: readonly string[] = ["Ken"]) {
  const decide = vi.fn<(decision: PublishDecision) => void>();

  render(<PublishDialog onDecide={decide} owners={owners} preview={preview} />);

  return decide;
}

describe("the confirmation", () => {
  it("is titled with the version it would publish and lists each change with its class in words", () => {
    draw(
      policyPreview({
        classification: "loosening",
        changes: [
          { ruleId: "auto_merge", classification: "loosening", verb: "enabled", summary: "enabled auto-merge" },
          { ruleId: "spend_guard", classification: "tightening", verb: "changed", summary: "changed spend guard" },
        ],
      }),
    );

    const dialog = screen.getByRole("alertdialog", { name: "Publish policy v8?" });
    const rows = within(dialog).getAllByRole("listitem");

    expect(rows[0]).toHaveTextContent("Loosens");
    expect(rows[0]).toHaveTextContent("Auto-merge when all gates green");
    expect(rows[0]).toHaveTextContent("enabled auto-merge");
    expect(rows[1]).toHaveTextContent("Tightens");
    expect(rows[1]).toHaveTextContent("Spend guard");

    expect(within(dialog).getByText(CLASS_MEANINGS.loosening)).toBeInTheDocument();
    expect(within(dialog).getByText(CLASS_MEANINGS.tightening)).toBeInTheDocument();
    expect(within(dialog).queryByText(CLASS_MEANINGS.neutral)).toBeNull();
  });

  it("publishes with the trimmed note, and with none when the note is blank", () => {
    const decide = draw();

    fireEvent.change(screen.getByLabelText(NOTE_LABEL), { target: { value: "  Lower the cap  " } });
    fireEvent.click(screen.getByRole("button", { name: "Publish policy v8" }));

    expect(decide).toHaveBeenCalledExactlyOnceWith({ kind: "publish", note: "Lower the cap" });
  });

  it("publishes a first version as v1, with no note", () => {
    const decide = draw(policyPreview({ baseVersion: null }));

    fireEvent.click(screen.getByRole("button", { name: "Publish policy v1" }));

    expect(decide).toHaveBeenCalledExactlyOnceWith({ kind: "publish", note: null });
  });

  it("goes back to the card on Keep editing, and on Escape", () => {
    const decide = draw();

    fireEvent.click(screen.getByRole("button", { name: KEEP_EDITING }));
    expect(decide).toHaveBeenLastCalledWith({ kind: "keep-editing" });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(decide).toHaveBeenLastCalledWith({ kind: "keep-editing" });
  });

  it("draws nothing while there is nothing to confirm", () => {
    render(<PublishDialog onDecide={vi.fn()} owners={[]} preview={null} />);

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("the owner gate", () => {
  it("explains the loosening, names the owners, and offers no way to publish", () => {
    const decide = draw(GATED_PREVIEW, ["Ken", "Maya Chen"]);
    const gate = ownerGate(GATED_PREVIEW, ["Ken", "Maya Chen"]);

    const dialog = screen.getByRole("alertdialog", { name: OWNER_GATE_TITLE });

    expect(within(dialog).getByText("This loosens Human review required — an owner must publish.")).toBeInTheDocument();
    expect(within(dialog).getByText(gate.why)).toBeInTheDocument();
    expect(within(dialog).getByText(/Ask Ken and Maya Chen to make this change/)).toBeInTheDocument();
    expect(within(dialog).getByText(gate.alone)).toBeInTheDocument();
    expect(within(dialog).getByRole("listitem")).toHaveTextContent("Loosens");

    expect(within(dialog).queryByRole("button", { name: /Publish/ })).toBeNull();
    expect(within(dialog).queryByLabelText(NOTE_LABEL)).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: KEEP_EDITING }));
    expect(decide).toHaveBeenCalledExactlyOnceWith({ kind: "keep-editing" });
  });

  it("still says who to ask when the owners could not be read", () => {
    draw(GATED_PREVIEW, []);

    expect(screen.getByText("Ask a workspace owner to make this change.")).toBeInTheDocument();
  });
});
