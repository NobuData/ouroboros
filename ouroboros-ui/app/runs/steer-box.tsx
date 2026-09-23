"use client";

import { useId, useState, type FormEvent } from "react";

import { Button, cx } from "@/app/ui";

import { MAX_STEER_LENGTH, steerText } from "./controls";
import {
  STEER_CAPTION,
  STEER_EMPTY,
  STEER_LABEL,
  STEER_PLACEHOLDER,
  STEER_SEND,
  STEER_SENDING,
} from "./transcript";

/** What the steering box is told. */
export interface SteerBoxProps {
  /** Why steering is closed — the run has ended, the reader is a viewer — or `null` when open. */
  readonly closedReason: string | null;
  /**
   * Send a steer. Resolves `true` once it was queued (the box then clears) and `false` when it
   * was refused (the text stays, so nothing typed is lost).
   */
  readonly onSend: (text: string) => Promise<boolean>;
}

/**
 * The steering input under the transcript ([#312](https://github.com/NobuData/ouroboros/issues/312))
 * — mockup 10's box, its placeholder verbatim.
 *
 * **A real action, treated as one.** Send is inert, with its reason as the tooltip, while
 * nothing is typed or a steer is on its way; the whole box is disabled, with the reason printed
 * beneath it, on a run that has ended or for a viewer — never a button that silently does
 * nothing. The caption is decision R9's: no Slack sentence until #318 makes it true.
 *
 * @param props See {@link SteerBoxProps}.
 * @returns The form.
 */
export function SteerBox({ closedReason, onSend }: SteerBoxProps) {
  const input = useId();
  const caption = useId();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const closed = closedReason !== null;
  const ready = steerText(text) !== null;
  const reason = sending ? STEER_SENDING : ready ? undefined : STEER_EMPTY;

  /**
   * Send what was typed, once.
   *
   * @param event The submission — the button, or Enter in the field.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const steer = steerText(text);
    if (closed || sending || steer === null) return;

    setSending(true);
    void onSend(steer).then((queued) => {
      setSending(false);
      if (queued) setText("");
    });
  }

  return (
    <form className="run-steer" noValidate onSubmit={submit}>
      <div className="run-steer__row">
        <label className="sr-only" htmlFor={input}>
          {STEER_LABEL}
        </label>
        <input
          aria-describedby={caption}
          autoComplete="off"
          className={cx("ou-input", "ou-input--mono", "run-steer__input")}
          disabled={closed}
          id={input}
          maxLength={MAX_STEER_LENGTH}
          onChange={(event) => setText(event.target.value)}
          placeholder={STEER_PLACEHOLDER}
          type="text"
          value={text}
        />
        {closed ? (
          <Button reason={closedReason} size="sm" type="submit">
            {STEER_SEND}
          </Button>
        ) : (
          <Button reason={reason} size="sm" type="submit">
            {sending ? STEER_SENDING : STEER_SEND}
          </Button>
        )}
      </div>
      <p className="run-steer__caption" id={caption}>
        {closed ? closedReason : STEER_CAPTION}
      </p>
    </form>
  );
}
