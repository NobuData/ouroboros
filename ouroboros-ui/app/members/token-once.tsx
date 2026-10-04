"use client";

import { useId } from "react";

import { COPIED, COPY, COPY_FAILED } from "@/app/providers/keys";
import { useCopy } from "@/app/runs/use-copy";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import { TOKEN_DONE, TOKEN_TITLE, TOKEN_WARNING, tokenLead } from "./view";

import "./members.css";

/** A token on its one showing. */
export interface ShownToken {
  /** The account it belongs to. */
  readonly name: string;
  /** The token itself. Held by the caller only until this dialog closes. */
  readonly token: string;
  /** Whether it replaced an older token. */
  readonly rotated: boolean;
}

/**
 * The one time a service-account token is shown
 * (BS.3, [#493](https://github.com/NobuData/ouroboros/issues/493)), following #229's clipboard
 * discipline: a **Copy** that says *Copied.* and nothing more about the clipboard (a page cannot
 * keep one), a stated fallback when the browser refuses — the value is selectable right there —
 * and an explicit warning that this is the only showing, with rotation named as the remedy.
 *
 * **The caller forgets the token when this closes.** Nothing here stores it: it arrives as a prop
 * from the create or rotate answer, and the card drops that answer from its state on
 * {@link TokenOnceProps.onDone}, so the value is never rendered again anywhere.
 *
 * @param props.shown The token to show, or `null` when there is none.
 * @param props.onDone Called when the reader closes the dialog — the token must be discarded.
 * @returns The dialog.
 */
export function TokenOnce({ shown, onDone }: TokenOnceProps) {
  const described = useId();
  const { state, copy } = useCopy();

  return (
    <ShellOverlay
      describedBy={described}
      label={TOKEN_TITLE}
      onClose={onDone}
      open={shown !== null}
      role="alertdialog"
    >
      {shown !== null && (
        <div className="members-dialog">
          <h2 className="members-dialog__title">{TOKEN_TITLE}</h2>
          <p className="members-dialog__note">{tokenLead(shown.name, shown.rotated)}</p>
          <code className="members-token__value">{shown.token}</code>
          <p className="members-dialog__warning" id={described} role="note">
            {TOKEN_WARNING}
          </p>
          <div className="members-token__copy">
            <Button onClick={() => copy(shown.token)}>{COPY}</Button>
            {state === "copied" && (
              <span className="members-token__copied" role="status">
                {COPIED}
              </span>
            )}
            {state === "failed" && (
              <span className="members-token__failed" role="alert">
                {COPY_FAILED}
              </span>
            )}
          </div>
          <div className="members-dialog__actions">
            <Button onClick={onDone} tone="primary">
              {TOKEN_DONE}
            </Button>
          </div>
        </div>
      )}
    </ShellOverlay>
  );
}

/** What {@link TokenOnce} takes. */
export interface TokenOnceProps {
  readonly shown: ShownToken | null;
  readonly onDone: () => void;
}
