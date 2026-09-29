import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TextDialog, type TextDialogProps } from "@/app/prs/text-dialog";

/**
 * The one-field dialog (#366), and the classes a page other than the PR verification page draws
 * it with (#340): the dialog is shared, and each page's sheet is its own.
 */

/**
 * Draw the dialog, open.
 *
 * @param over What to change.
 * @returns The confirmation, to be asked what was sent.
 */
function draw(over: Partial<TextDialogProps> = {}) {
  const onConfirm = vi.fn<TextDialogProps["onConfirm"]>().mockResolvedValue({
    ok: false,
    reason: "Refused.",
  });

  render(
    <TextDialog
      cancel="Keep on this page"
      confirm="Send"
      hint="Required."
      label="Why"
      lead={<p>About this.</p>}
      maxLength={100}
      needs="Write why."
      onClose={() => {}}
      onConfirm={onConfirm}
      open
      sending="Sending."
      title="A reason"
      {...over}
    />,
  );

  return onConfirm;
}

/**
 * The class of each of the dialog's four parts, once a refusal is drawn.
 *
 * @returns The form's, the lead's, the refusal's and the buttons' row's.
 */
async function parts(): Promise<string[]> {
  const dialog = screen.getByRole("dialog", { name: "A reason" });

  fireEvent.change(within(dialog).getByRole("textbox", { name: "Why" }), {
    target: { value: "because" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));

  const refusal = await within(dialog).findByRole("alert");
  const form = dialog.querySelector("form")!;

  return [
    form.className,
    within(dialog).getByText("About this.").parentElement!.className,
    refusal.className,
    within(dialog).getByRole("button", { name: "Keep on this page" }).parentElement!.className,
  ];
}

describe("TextDialog", () => {
  it("is drawn with the PR verification page's classes unless told otherwise", async () => {
    draw();

    expect(await parts()).toEqual([
      "prv-dialog",
      "prv-dialog__lead",
      "prv-dialog__error",
      "prv-dialog__actions",
    ]);
  });

  it("is drawn with another page's classes, and none of the PR page's", async () => {
    draw({
      classes: {
        form: "tests-waive",
        lead: "tests-waive__lead",
        error: "tests-waive__error",
        actions: "tests-waive__actions",
      },
    });

    expect(await parts()).toEqual([
      "tests-waive",
      "tests-waive__lead",
      "tests-waive__error",
      "tests-waive__actions",
    ]);
    expect(document.body.innerHTML).not.toContain("prv-dialog");
  });

  it("sends the text trimmed, once, whichever classes it wears", async () => {
    const onConfirm = draw({
      classes: { form: "a", lead: "b", error: "c", actions: "d" },
    });
    const dialog = within(screen.getByRole("dialog", { name: "A reason" }));

    fireEvent.change(dialog.getByRole("textbox", { name: "Why" }), {
      target: { value: "  because  " },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Send" }));
    await dialog.findByRole("alert");

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("because");
  });
});
