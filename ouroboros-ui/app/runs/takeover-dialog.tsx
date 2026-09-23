"use client";

import { Check, Copy } from "lucide-react";
import { useId } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Chip } from "@/app/ui";

import type { DeliveryChip } from "./controls";
import {
  COMMANDS_LABEL,
  COPIED_COMMANDS,
  COPY_COMMANDS_FAILED,
  COPY_COMMANDS_LABEL,
  HANDOFF_CLOSE,
  HANDOFF_LIMITATION,
  HANDOFF_NOTE,
  HANDOFF_TITLE,
  NO_BRANCH_HANDOFF,
  TICKET_LINK,
  TRANSCRIPT_LINK,
  checkoutCommands,
  transcriptUrl,
} from "./handoff";
import { useCopy } from "./use-copy";

/** What the dialog is told. */
export interface TakeoverDialogProps {
  /** Whether it is open. */
  readonly open: boolean;
  /** Close it. The loop stays paused; *Resume* on the page is how it comes back. */
  readonly onClose: () => void;
  /** The run's id — the transcript link's. */
  readonly runId: string;
  /** The loop's branch, or `null` before it has one. */
  readonly branch: string | null;
  /** The ticket on its tracker, or `null` when there is no link to build. */
  readonly trackerUrl: string | null;
  /** Where the pause that preceded the hand-off has got to, or `null` before there is one. */
  readonly pause: DeliveryChip | null;
  /** Why the pause could not be sent, or `null`. */
  readonly failure: string | null;
}

/**
 * *Take over in IDE* — decision **R7**'s hand-off
 * ([#310](https://github.com/NobuData/ouroboros/issues/310)).
 *
 * **It does not pretend to be IDE magic.** Opening the dialog pauses the loop (the head queues
 * the pause as the button is pressed); the dialog then shows that pause's real delivery state,
 * the branch with copy-able `git fetch` / `git switch` commands, and links to the ticket and
 * the transcript export — and says in plain words that deep IDE integration is arriving
 * (#316). Someone reading it knows exactly what they are getting.
 *
 * @param props See {@link TakeoverDialogProps}.
 * @returns The dialog while open, nothing otherwise.
 */
export function TakeoverDialog({
  open,
  onClose,
  runId,
  branch,
  trackerUrl,
  pause,
  failure,
}: TakeoverDialogProps) {
  const description = useId();
  const { state, copy } = useCopy();

  const commands = branch === null ? null : checkoutCommands(branch);

  return (
    <ShellOverlay describedBy={description} label={HANDOFF_TITLE} onClose={onClose} open={open}>
      <div className="run-dialog">
        <h2 className="shell-overlay__title">{HANDOFF_TITLE}</h2>
        <p className="run-dialog__text" id={description}>
          {HANDOFF_NOTE}
        </p>

        <div aria-live="polite" className="run-dialog__status" role="status">
          {pause !== null && (
            <Chip dot={pause.dot} title={pause.detail ?? undefined} tone={pause.tone}>
              {pause.label}
            </Chip>
          )}
          {failure !== null && <span className="run-dialog__error">{failure}</span>}
        </div>

        {commands === null ? (
          <p className="run-dialog__text">{NO_BRANCH_HANDOFF}</p>
        ) : (
          <div className="run-handoff">
            <div className="run-handoff__head">
              <span className="run-handoff__label">{COMMANDS_LABEL}</span>
              <button
                aria-label={COPY_COMMANDS_LABEL}
                className="run-head__copy"
                onClick={() => copy(commands)}
                title={COPY_COMMANDS_LABEL}
                type="button"
              >
                {state === "copied" ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
              </button>
              <span aria-live="polite" className="run-head__copy-status" role="status">
                {state === "copied" ? COPIED_COMMANDS : state === "failed" ? COPY_COMMANDS_FAILED : ""}
              </span>
            </div>
            <pre className="run-handoff__commands">
              <code>{commands}</code>
            </pre>
          </div>
        )}

        <ul className="run-handoff__links">
          {trackerUrl !== null && (
            <li>
              <a className="run-handoff__link" href={trackerUrl} rel="noopener noreferrer" target="_blank">
                {TICKET_LINK}
              </a>
            </li>
          )}
          <li>
            <a className="run-handoff__link" href={transcriptUrl(runId)} rel="noopener noreferrer" target="_blank">
              {TRANSCRIPT_LINK}
            </a>
          </li>
        </ul>

        <p className="run-handoff__limitation" role="note">
          {HANDOFF_LIMITATION}
        </p>

        <div className="run-dialog__actions">
          <Button onClick={onClose} tone="ghost" type="button">
            {HANDOFF_CLOSE}
          </Button>
        </div>
      </div>
    </ShellOverlay>
  );
}
