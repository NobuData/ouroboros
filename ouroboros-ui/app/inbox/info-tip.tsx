"use client";

import { type ReactNode, useId, useState } from "react";

import { cx } from "@/app/ui/class-names";

/** What {@link InfoTip} takes. */
export interface InfoTipProps {
  /** The control's accessible name — what the note answers. */
  readonly label: string;
  /** The note. */
  readonly children: ReactNode;
  /**
   * Where the control sits, when it is not simply followed by its note: handed the control, it
   * returns the content that holds it — a row's line, say, with the control at its end — and the
   * note opens under that content. Nothing in the frame but the control opens the note.
   *
   * A framed note is for text. A link inside one could not be tabbed to: the note is held open
   * by the control's own focus, which is gone by the time the link would take it.
   */
  readonly frame?: (control: ReactNode) => ReactNode;
}

/**
 * A note behind an ⓘ — the inbox's one tooltip (BO.3's policy note, BO.4's rule source).
 *
 * A native tooltip cannot hold a link and cannot be reached by keyboard, so this is a small
 * disclosure that behaves like one: the note shows while the control is hovered or focused, and
 * a press pins it open for a reader with neither a pointer that hovers nor a keyboard; Escape or
 * a second press lets it go. The control is described by the note, so a screen reader hears it
 * on focus without opening anything.
 *
 * The note sits in the flow of whatever holds it rather than floating over the page, so nothing
 * clips it and nothing needs positioning, and the sheet keeps the control and the note touching,
 * so a pointer can travel from one to the other without the note closing on the way. Beside its
 * control (no `frame`), the note stays open while the focus is anywhere inside it — a link in it
 * is one Tab from the control.
 *
 * @param props See {@link InfoTipProps}.
 * @returns The control — in its frame, when given one — and its note.
 */
export function InfoTip({ label, children, frame }: InfoTipProps) {
  const id = useId();
  const [pinned, setPinned] = useState(false);
  const control = (
    <button
      aria-describedby={id}
      aria-expanded={pinned}
      aria-label={label}
      className="inbox-tip__toggle"
      onClick={(event) => {
        // A pointer's second press lets go of the focus as well: the note it just unpinned would
        // otherwise stay open for as long as the pressed control held the focus. A press from the
        // keyboard (`detail` 0) keeps its place.
        if (pinned && event.detail > 0) event.currentTarget.blur();

        setPinned(!pinned);
      }}
      type="button"
    >
      <span aria-hidden>ⓘ</span>
    </button>
  );

  return (
    <span
      className={cx("inbox-tip", frame !== undefined && "inbox-tip--framed", pinned && "inbox-tip--pinned")}
      onKeyDown={(event) => {
        if (event.key === "Escape") setPinned(false);
      }}
    >
      {frame === undefined ? control : frame(control)}
      <span className="inbox-tip__note" id={id} role="note">
        {children}
      </span>
    </span>
  );
}
