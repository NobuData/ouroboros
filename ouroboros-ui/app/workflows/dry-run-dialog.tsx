"use client";

import { type FormEvent, useEffect, useId, useState } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button, SelectField } from "@/app/ui";

import { sizedTickets } from "./draft-actions";
import {
  DRY_RUN_CANCEL,
  DRY_RUN_DIALOG_NOTE,
  DRY_RUN_DIALOG_TITLE,
  LOADING_TICKETS,
  NO_SIZED_TICKETS,
  RUNNING,
  RUN_LABEL,
  TICKET_HINT,
  TICKET_LABEL,
  type TicketOption,
  defaultTicket,
  ticketLabel,
  ticketsFailure,
} from "./dry-run";

import "./workflows.css";

/** What the dialog takes. */
export interface DryRunDialogProps {
  /** Walk the draft for this issue; resolves to the refusal to show, or `null` once the walk is on the canvas. */
  readonly onRun: (ticket: TicketOption) => Promise<string | null>;
  /** Close without walking. */
  readonly onClose: () => void;
}

/** The picker's list, as it loads. */
type Tickets =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly options: readonly TicketOption[] }
  | { readonly state: "failed"; readonly reason: string };

/**
 * The dry run's ticket picker — S.6 ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * Opens on the workspace's open, sized issues, with `#485` chosen when the workspace has it (`dry-run.ts`'s
 * `defaultTicket`), and hands the choice to the session, which walks the draft and closes the dialog.
 * A refusal stays in the dialog with the service's reason.
 *
 * Mounted only while open, so each opening reads the backlog as it stands.
 *
 * @param props See {@link DryRunDialogProps}.
 * @returns The dialog.
 */
export function DryRunDialog({ onRun, onClose }: DryRunDialogProps) {
  const fields = useId();
  const [tickets, setTickets] = useState<Tickets>({ state: "loading" });
  const [chosen, setChosen] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let current = true;

    void sizedTickets().then((outcome) => {
      if (!current) return;

      if (outcome.ok) {
        setTickets({ state: "ready", options: outcome.value });
        setChosen(defaultTicket(outcome.value)?.id ?? null);
      } else {
        setTickets({ state: "failed", reason: ticketsFailure(outcome.refusal) });
      }
    });

    return () => {
      current = false;
    };
  }, []);

  const options = tickets.state === "ready" ? tickets.options : [];
  const ticket = options.find((option) => option.id === chosen) ?? null;
  const blocked = pending
    ? RUNNING
    : tickets.state === "loading"
      ? LOADING_TICKETS
      : tickets.state === "failed"
        ? tickets.reason
        : ticket === null
          ? NO_SIZED_TICKETS
          : undefined;

  /**
   * Walk the draft for the chosen issue.
   *
   * @param event The submit.
   */
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || ticket === null) return;

    setPending(true);
    setFailure(null);
    try {
      setFailure(await onRun(ticket));
    } finally {
      setPending(false);
    }
  }

  return (
    <ShellOverlay label={DRY_RUN_DIALOG_TITLE} onClose={onClose} open>
      <h2 className="shell-overlay__title">{DRY_RUN_DIALOG_TITLE}</h2>
      <p className="shell-overlay__note">{DRY_RUN_DIALOG_NOTE}</p>

      <form className="studio-dialog" onSubmit={(event) => void submit(event)}>
        {tickets.state === "loading" && (
          <p className="studio-dialog__state" role="status">
            {LOADING_TICKETS}
          </p>
        )}
        {tickets.state === "failed" && (
          <p className="studio-dialog__failure" role="alert">
            {tickets.reason}
          </p>
        )}
        {tickets.state === "ready" && options.length === 0 && <p className="studio-dialog__state">{NO_SIZED_TICKETS}</p>}
        {options.length > 0 && (
          <SelectField
            hint={TICKET_HINT}
            id={`${fields}-ticket`}
            label={TICKET_LABEL}
            name="ticket"
            onChange={(event) => {
              setChosen(event.currentTarget.value);
            }}
            value={chosen ?? ""}
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {ticketLabel(option)}
              </option>
            ))}
          </SelectField>
        )}

        {failure !== null && (
          <p className="studio-dialog__failure" role="alert">
            {failure}
          </p>
        )}
        {pending && (
          <p className="studio-dialog__state" role="status">
            {RUNNING}
          </p>
        )}

        <div className="studio-dialog__actions">
          <Button reason={blocked} tone="primary" type="submit">
            {RUN_LABEL}
          </Button>
          <Button onClick={onClose} tone="ghost" type="button">
            {DRY_RUN_CANCEL}
          </Button>
        </div>
      </form>
    </ShellOverlay>
  );
}
