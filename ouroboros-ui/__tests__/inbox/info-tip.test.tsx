import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InfoTip } from "@/app/inbox/info-tip";

/**
 * The inbox's tooltip (#468's policy note, #469's rule source): a real button described by its
 * note, so the keyboard reaches it and a screen reader hears it — and a press pins it open.
 */

/** One tip over a sentence and a link. */
function tip() {
  render(
    <InfoTip label="Where this is enforced: refactor label">
      Org policy v7 · human_review <a href="/settings#policies">Configure →</a>
    </InfoTip>,
  );

  return {
    control: screen.getByRole("button", { name: "Where this is enforced: refactor label" }),
    note: screen.getByRole("note"),
  };
}

describe("the inbox tooltip", () => {
  it("is a button the keyboard can reach, described by its note", () => {
    const { control, note } = tip();

    expect(control.tagName).toBe("BUTTON");
    expect(control).toHaveAttribute("type", "button");
    expect(control).not.toHaveAttribute("tabindex", "-1");
    expect(control).toHaveAccessibleDescription(expect.stringContaining("Org policy v7 · human_review"));
    expect(note).toHaveTextContent("Org policy v7 · human_review");

    control.focus();
    expect(control).toHaveFocus();
  });

  it("keeps the note inside the control's wrapper, so focus anywhere in it holds it open", () => {
    const { control, note } = tip();
    const wrapper = control.closest(".inbox-tip")!;

    expect(wrapper).toHaveClass("inbox-tip");
    expect(wrapper).toContainElement(note);
    expect(wrapper).toContainElement(screen.getByRole("link", { name: "Configure →" }));
  });

  it("pins open on a press and lets go on a second", () => {
    const { control } = tip();
    const wrapper = control.closest(".inbox-tip")!;

    expect(control).toHaveAttribute("aria-expanded", "false");
    expect(wrapper).not.toHaveClass("inbox-tip--pinned");

    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-expanded", "true");
    expect(wrapper).toHaveClass("inbox-tip--pinned");

    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-expanded", "false");
    expect(wrapper).not.toHaveClass("inbox-tip--pinned");
  });

  it("lets go of the focus too when a pointer unpins it — the note would stay open on it otherwise", () => {
    const { control } = tip();

    control.focus();
    fireEvent.click(control, { detail: 1 });
    // Pinning keeps the focus where the press put it.
    expect(control).toHaveFocus();

    fireEvent.click(control, { detail: 1 });
    expect(control).not.toHaveFocus();
  });

  it("keeps the keyboard's place when Enter unpins it", () => {
    const { control } = tip();

    control.focus();
    // A click raised by Enter or Space carries no click count.
    fireEvent.click(control, { detail: 0 });
    fireEvent.click(control, { detail: 0 });

    expect(control).toHaveFocus();
    expect(control).toHaveAttribute("aria-expanded", "false");
  });

  it("is not framed unless it is given a frame", () => {
    const { control } = tip();

    expect(control.closest(".inbox-tip")).not.toHaveClass("inbox-tip--framed");
  });

  it("lets go on Escape, from the control or from inside the note", () => {
    const { control } = tip();
    const wrapper = control.closest(".inbox-tip")!;

    fireEvent.click(control);
    fireEvent.keyDown(control, { key: "Escape" });
    expect(wrapper).not.toHaveClass("inbox-tip--pinned");

    fireEvent.click(control);
    fireEvent.keyDown(screen.getByRole("link", { name: "Configure →" }), { key: "Escape" });
    expect(wrapper).not.toHaveClass("inbox-tip--pinned");
  });

  it("ignores every other key", () => {
    const { control } = tip();

    fireEvent.click(control);
    fireEvent.keyDown(control, { key: "a" });

    expect(control.parentElement).toHaveClass("inbox-tip--pinned");
  });

  it("puts the control wherever its frame says, and the note after the frame", () => {
    render(
      <InfoTip
        frame={(control) => (
          <span data-testid="line">
            <a href="/settings#policies">edit →</a>
            {control}
          </span>
        )}
        label="Where this is enforced: effort L+"
      >
        Org policy v7
      </InfoTip>,
    );

    const control = screen.getByRole("button", { name: "Where this is enforced: effort L+" });
    const line = screen.getByTestId("line");

    expect(line).toContainElement(control);
    expect(line.lastElementChild).toBe(control);
    expect(line.nextElementSibling).toBe(screen.getByRole("note"));
    expect(line.parentElement).toHaveClass("inbox-tip", "inbox-tip--framed");
    expect(control).toHaveAccessibleDescription("Org policy v7");

    // Pinning and Escape work from the frame as they do without one.
    fireEvent.click(control);
    expect(line.parentElement).toHaveClass("inbox-tip--pinned");
    fireEvent.keyDown(screen.getByRole("link", { name: "edit →" }), { key: "Escape" });
    expect(line.parentElement).not.toHaveClass("inbox-tip--pinned");
  });

  it("gives two tips two notes of their own", () => {
    render(
      <>
        <InfoTip label="first">one</InfoTip>
        <InfoTip label="second">two</InfoTip>
      </>,
    );

    expect(screen.getByRole("button", { name: "first" })).toHaveAccessibleDescription("one");
    expect(screen.getByRole("button", { name: "second" })).toHaveAccessibleDescription("two");
  });
});
