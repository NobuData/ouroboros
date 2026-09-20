"use client";

import { clockTime } from "@/app/dashboard/view";
import { ShellOverlay } from "@/app/shell/overlay";
import { Eyebrow } from "@/app/ui";

import {
  JOB_SHEET_CLOSE,
  JOB_SHEET_EYEBROW,
  JOB_SHEET_NOTE,
  type RunnerRow,
  jobFacts,
  jobSheetLabel,
} from "./runners";

/**
 * The job sheet — what a runner's current-job cell opens until the run console exists
 * (AI.2, [#257](https://github.com/NobuData/ouroboros/issues/257)).
 *
 * The issue asks that the cell *link honestly: run detail when it exists, a job sheet
 * meanwhile*. Run detail is `/runs/:id`, which is #309 and is not built — and the payload's job
 * reference carries no run to link to until #300 adds one — so this is the *meanwhile*: a sheet
 * over what the farm page already knows about the build, which says in its own words that the
 * console is coming (`JOB_SHEET_NOTE`). It reads nothing of its own; there is no `GET` for one
 * job, and everything it lists is on the row.
 *
 * **It follows the row, not a snapshot of it.** The caller passes the live row, so a sheet left
 * open keeps its running time current with every poll — and closes by itself when the build
 * ends, because a row with no job is a sheet with nothing to say.
 *
 * The modal contract — focus in, Tab kept inside, Escape and a press outside close, focus back
 * to the cell that opened it — is the shell overlay's (`app/shell/overlay.tsx`).
 *
 * @param props.row The row whose job is open, or `null` when none is.
 * @param props.nowMs The instant the page on screen was confirmed current.
 * @param props.onClose Called when the reader dismisses the sheet.
 * @returns The sheet while a row with a job is given; nothing otherwise.
 */
export function JobSheet({
  row,
  nowMs,
  onClose,
}: Readonly<{ row: RunnerRow | null; nowMs: number; onClose: () => void }>) {
  const facts = row === null ? [] : jobFacts(row, nowMs, clockTime);
  // A row with no job has no facts, and a sheet with nothing to say is not open.
  const job = row !== null && row.jobNumber !== null && facts.length > 0 ? row : null;
  const label = job?.jobNumber ? jobSheetLabel(job.jobNumber) : JOB_SHEET_EYEBROW;

  return (
    <ShellOverlay label={label} onClose={onClose} open={job !== null}>
      {job !== null && (
        <>
          <div>
            <Eyebrow>{label}</Eyebrow>
            <h2 className="shell-overlay__title">{job.jobTitle ?? job.jobNote}</h2>
          </div>

          <dl className="farm-job">
            {facts.map((fact) => (
              <div className="farm-job__row" key={fact.term}>
                <dt className="farm-job__term">{fact.term}</dt>
                <dd className="farm-job__value">{fact.value}</dd>
              </div>
            ))}
          </dl>

          <p className="shell-overlay__note">{JOB_SHEET_NOTE}</p>

          <button className="shell-overlay__close" onClick={onClose} type="button">
            {JOB_SHEET_CLOSE}
          </button>
        </>
      )}
    </ShellOverlay>
  );
}
