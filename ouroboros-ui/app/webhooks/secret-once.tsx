"use client";

import { useId } from "react";

import { COPIED, COPY, COPY_FAILED } from "@/app/providers/keys";
import { useCopy } from "@/app/runs/use-copy";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import { SECRET_DONE, SECRET_TITLE, SECRET_WARNING, secretLead } from "./view";

import "./webhooks.css";

/** A signing secret on its one showing. */
export interface ShownSecret {
  /** The endpoint it signs for. */
  readonly name: string;
  /** The secret itself. Held by the caller only until this dialog closes. */
  readonly secret: string;
  /** Whether it replaced an older secret. */
  readonly rotated: boolean;
}

/** What {@link SecretOnce} takes. */
export interface SecretOnceProps {
  /** The secret to show, or `null` when there is none. */
  readonly shown: ShownSecret | null;
  /** Called when the reader closes the dialog — the secret must be discarded. */
  readonly onDone: () => void;
}

/**
 * The one time a webhook signing secret is shown
 * (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)) — `app/members/token-once.tsx`'s
 * discipline for a different secret: a **Copy** that says *Copied.* and nothing more about the
 * clipboard, a stated fallback when the browser refuses (the value is selectable right there),
 * and the warning that this is the only showing, with rotation named as the remedy.
 *
 * **The caller forgets the secret when this closes.** Nothing here stores it: it arrives from
 * the create or rotate answer, and the sheet drops that answer from its state on
 * {@link SecretOnceProps.onDone}, so the value is never rendered again anywhere.
 *
 * @param props See {@link SecretOnceProps}.
 * @returns The dialog.
 */
export function SecretOnce({ shown, onDone }: SecretOnceProps) {
  const described = useId();
  const { state, copy } = useCopy();

  return (
    <ShellOverlay
      describedBy={described}
      label={SECRET_TITLE}
      onClose={onDone}
      open={shown !== null}
      role="alertdialog"
    >
      {shown !== null && (
        <div className="webhooks-dialog">
          <h2 className="webhooks-dialog__title">{SECRET_TITLE}</h2>
          <p className="webhooks-dialog__note">{secretLead(shown.name, shown.rotated)}</p>
          <code className="webhooks-secret__value">{shown.secret}</code>
          <p className="webhooks-dialog__warning" id={described} role="note">
            {SECRET_WARNING}
          </p>
          <div className="webhooks-secret__copy">
            <Button onClick={() => copy(shown.secret)}>{COPY}</Button>
            {state === "copied" && (
              <span className="webhooks-secret__copied" role="status">
                {COPIED}
              </span>
            )}
            {state === "failed" && (
              <span className="webhooks-secret__failed" role="alert">
                {COPY_FAILED}
              </span>
            )}
          </div>
          <div className="webhooks-dialog__actions">
            <Button onClick={onDone} tone="primary">
              {SECRET_DONE}
            </Button>
          </div>
        </div>
      )}
    </ShellOverlay>
  );
}
