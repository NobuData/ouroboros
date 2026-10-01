"use client";

import { useId, useRef, useState, useTransition } from "react";

import type { Playbook, PlaybookIssueCandidate, PlaybookLaunchReceipt } from "@/app/api/playbooks";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Chip, TextField } from "@/app/ui";

import {
  LAUNCH,
  LAUNCHING,
  LAUNCH_VIEWER_REASON,
  PICKER_CLOSE,
  PICKER_EMPTY,
  PICKER_LOADING,
  PICKER_NOTE,
  PICKER_SEARCH,
  PICKER_SEARCH_HINT,
  PICKER_SEARCH_LABEL,
  PICKER_SEARCH_MAX,
  RECEIPT_LINKS,
  RUN_ON_ISSUE,
  type RankedCandidate,
  candidateLine,
  filterLine,
  launchFailure,
  launchName,
  pickerEmptyFor,
  pickerFailure,
  pickerTitle,
  rankCandidates,
  receiptText,
} from "./playbooks";
import { launchPlaybook, listPlaybookIssues } from "./playbooks-actions";

import "./knowledge.css";

/**
 * **Run on issue… ▾** — a playbook row's action, the safety-ranked ticket picker behind it, and
 * the receipt a launch leaves (BG.4, [#420](https://github.com/NobuData/ouroboros/issues/420)).
 *
 * The decisions are `app/knowledge/playbooks.ts`'s; what is here is state and wiring:
 *
 * - **The list is the service's, ranked here.** The read starts in the same press that opens the
 *   picker rather than in an effect (the credential audit trail's rule, `app/providers/audit-trail.tsx`):
 *   the playbook's admitted issues (`GET …/{id}/issues`) are drawn safest first, and a row that
 *   cannot launch says why in place of its button. The search box asks the service again with
 *   the query.
 * - **A launch is one call, and leaves a receipt.** The row's **Queue** posts the launch; the
 *   receipt — what was queued, under which pin, at which position — replaces the list, with the
 *   links to the dashboard's queue and the issues page, and is handed up so the row and the
 *   page's toast say the same thing. A refusal lands in the row as an alert.
 *
 * Read-only for a viewer: the action itself is inert with the reason. The gate that enforces is
 * the service's.
 */

/** What the action is told. */
export interface RunOnIssueProps {
  /** The playbook to run. */
  readonly playbook: Playbook;
  /** Whether this reader is an `owner`, an `admin` or a `member` — the queue write's gate. */
  readonly mayLaunch: boolean;
  /** Called with a launch's receipt. */
  readonly onLaunched: (receipt: PlaybookLaunchReceipt) => void;
}

/** What the list is showing. */
type ListState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "listed"; readonly rows: readonly RankedCandidate[]; readonly q: string };

/**
 * The action, and its picker.
 *
 * @param props See {@link RunOnIssueProps}.
 * @returns The button, with the dialog beside it while it is open.
 */
export function RunOnIssue({ playbook, mayLaunch, onLaunched }: RunOnIssueProps) {
  const ids = useId();
  const search = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [failures, setFailures] = useState<Readonly<Record<string, string>>>({});
  const [receipt, setReceipt] = useState<PlaybookLaunchReceipt | null>(null);
  const [, startTransition] = useTransition();

  /**
   * Ask the service for the candidates.
   *
   * @param q The search, or nothing for the head of the list.
   */
  function read(q: string): void {
    setList({ kind: "loading" });

    startTransition(async () => {
      const outcome = await listPlaybookIssues(playbook.id, q);

      setList(
        outcome.ok
          ? { kind: "listed", rows: rankCandidates(outcome.value.items), q }
          : { kind: "failed", message: pickerFailure(outcome.refusal) },
      );
    });
  }

  /** Open clean, and read the head of the list in the same press. */
  function openPicker(): void {
    setTyped("");
    setFailures({});
    setReceipt(null);
    setBusy(null);
    setOpen(true);
    read("");
  }

  /** Close. */
  function close(): void {
    setOpen(false);
  }

  /**
   * Queue one candidate.
   *
   * @param candidate The issue.
   */
  function launch(candidate: PlaybookIssueCandidate): void {
    if (busy !== null) return;

    setBusy(candidate.id);
    setFailures((current) => ({ ...current, [candidate.id]: "" }));

    startTransition(async () => {
      const outcome = await launchPlaybook(playbook.id, candidate.id);

      if (!outcome.ok) {
        setFailures((current) => ({ ...current, [candidate.id]: launchFailure(outcome.refusal) }));
        setBusy(null);
        return;
      }

      setReceipt(outcome.value);
      setBusy(null);
      onLaunched(outcome.value);
    });
  }

  const title = pickerTitle(playbook);

  return (
    <>
      <Button
        aria-label={`Run on issue: ${playbook.name}`}
        onClick={openPicker}
        reason={mayLaunch ? undefined : LAUNCH_VIEWER_REASON}
        size="sm"
        tone="ghost"
      >
        {RUN_ON_ISSUE}
      </Button>

      <ShellOverlay initialFocus={search} label={title} onClose={close} open={open}>
        <h2 className="shell-overlay__title">{title}</h2>
        <p className="shell-overlay__note">{PICKER_NOTE}</p>
        <p className="knowledge-picker__filter">{filterLine(playbook)}</p>

        {receipt !== null ? (
          <div className="knowledge-picker__receipt" role="status">
            <p className="knowledge-picker__receipt-text">{receiptText(receipt, playbook)}</p>
            <div className="knowledge-picker__receipt-links">
              {RECEIPT_LINKS.map((link) => (
                <Button href={link.href} key={link.href} size="sm" tone="ghost">
                  {link.label} →
                </Button>
              ))}
            </div>
            <div className="knowledge-picker__actions">
              <Button onClick={close} tone="primary" type="button">
                {PICKER_CLOSE}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <form
              className="knowledge-picker__search"
              onSubmit={(event) => {
                event.preventDefault();
                read(typed.trim());
              }}
            >
              <TextField
                autoComplete="off"
                hint={PICKER_SEARCH_HINT}
                id={`${ids}-q`}
                label={PICKER_SEARCH_LABEL}
                maxLength={PICKER_SEARCH_MAX}
                name="q"
                onChange={(event) => { setTyped(event.currentTarget.value); }}
                ref={search}
                value={typed}
              />
              <Button size="sm" tone="ghost" type="submit">
                {PICKER_SEARCH}
              </Button>
            </form>

            {list.kind === "loading" && (
              <p className="knowledge-picker__state" role="status">
                {PICKER_LOADING}
              </p>
            )}
            {list.kind === "failed" && (
              <p className="knowledge-picker__refusal" role="alert">
                {list.message}
              </p>
            )}
            {list.kind === "listed" && list.rows.length === 0 && (
              <p className="knowledge-picker__state" role="status">
                {list.q === "" ? PICKER_EMPTY : pickerEmptyFor(list.q)}
              </p>
            )}
            {list.kind === "listed" && list.rows.length > 0 && (
              <ul className="knowledge-picker__list">
                {list.rows.map(({ candidate, launchable, reason }) => {
                  const failure = failures[candidate.id];
                  const refused = failure !== undefined && failure !== "";
                  const failureId = `${ids}-${candidate.id}-refused`;
                  const inert = busy === candidate.id ? LAUNCHING : (reason ?? undefined);

                  return (
                    <li className="knowledge-picker__row" key={candidate.id}>
                      <div className="knowledge-picker__body">
                        <p className="knowledge-picker__line">{candidateLine(candidate)}</p>
                        <p className="knowledge-picker__meta">
                          <span>{candidate.repo}</span>
                          {candidate.labels.map((label) => (
                            <Chip key={label}>{label}</Chip>
                          ))}
                          {!launchable && reason !== null && <span className="knowledge-picker__reason">{reason}</span>}
                        </p>
                        {refused && (
                          <p className="knowledge-picker__refusal" id={failureId} role="alert">
                            {failure}
                          </p>
                        )}
                      </div>
                      <Button
                        aria-describedby={refused ? failureId : undefined}
                        aria-label={launchName(candidate)}
                        onClick={() => { launch(candidate); }}
                        reason={inert}
                        size="sm"
                        tone={launchable ? "primary" : "ghost"}
                      >
                        {busy === candidate.id ? LAUNCHING : LAUNCH}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="knowledge-picker__actions">
              <Button onClick={close} tone="ghost" type="button">
                {PICKER_CLOSE}
              </Button>
            </div>
          </>
        )}
      </ShellOverlay>
    </>
  );
}
