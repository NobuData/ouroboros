"use client";

import { clockTime } from "@/app/dashboard/view";
import { ShellOverlay } from "@/app/shell/overlay";
import { Eyebrow } from "@/app/ui";

import {
  LOG_LABEL,
  LOG_SHEET_NOTE,
  type LiveJob,
  emptyLogNote,
  logSheetFacts,
  logSheetLabel,
} from "./live";
import { LogPane } from "./log-pane";
import type { LogStreamOptions } from "./log-stream";
import { JOB_SHEET_CLOSE, JOB_SHEET_EYEBROW } from "./runners";
import { useLogStream } from "./use-log-stream";

/**
 * The full-log sheet — what **Full log ↗** opens until the run console exists
 * (AI.6, [#261](https://github.com/NobuData/ouroboros/issues/261)).
 *
 * The control's destination in the mockup is mockup 10's run console, which is #309 and is not
 * built, and the link from a build into it is AJ.3's (#265). `app/farm/job-sheet.tsx` is the
 * same *meanwhile* for the runners table's job cell; this is the one for the log, and unlike
 * that sheet it has something of its own to read: **the whole log**, which AH.5 defines as this
 * same resource paged from `after=0` until `nextOffset` reaches `end`. So it is a second stream
 * over the same build, in `full` mode — it never jumps to the tail — drawn by the same pane,
 * which keeps following while the build runs and keeps the DOM bounded however long the log is.
 *
 * **It holds the build it was opened for**, not whatever the card is about now: a reader who
 * opened a log is reading *that* log, and the card moving on to a newer build underneath must
 * not swap the text out from under them. It reads only while it is open; closing it drops the
 * stream, and opening it again reads from the start.
 *
 * The modal contract — focus in, Tab kept inside, Escape and a press outside close, focus back
 * to the control that opened it — is the shell overlay's (`app/shell/overlay.tsx`).
 *
 * @param props.job The build whose log is open, or `null` when none is.
 * @param props.log Test seams for the stream.
 * @param props.onClose Called when the reader dismisses the sheet.
 * @returns The sheet while a build is given; nothing otherwise.
 */
export function LogSheet({
  job,
  log,
  onClose,
}: Readonly<{ job: LiveJob | null; log?: LogStreamOptions; onClose: () => void }>) {
  return (
    <ShellOverlay
      label={job === null ? JOB_SHEET_EYEBROW : logSheetLabel(job)}
      onClose={onClose}
      open={job !== null}
      wide
    >
      {job !== null && <FullLog job={job} key={job.id} log={log} onClose={onClose} />}
    </ShellOverlay>
  );
}

/**
 * The sheet's content for one build. A component of its own so the stream lives exactly as long
 * as the sheet is open.
 *
 * @param props.job The build.
 * @param props.log Test seams for the stream.
 * @param props.onClose Called by the sheet's own dismissal.
 * @returns The heading, the facts, the log and the way out.
 */
function FullLog({
  job,
  log,
  onClose,
}: Readonly<{ job: LiveJob; log?: LogStreamOptions; onClose: () => void }>) {
  const view = useLogStream(job.id, { ...log, mode: "full" });

  return (
    <>
      <div>
        <Eyebrow>{logSheetLabel(job)}</Eyebrow>
        <h2 className="shell-overlay__title">{job.title}</h2>
      </div>

      <dl className="farm-job">
        {logSheetFacts(job, view.live, clockTime).map((fact) => (
          <div className="farm-job__row" key={fact.term}>
            <dt className="farm-job__term">{fact.term}</dt>
            <dd className="farm-job__value">{fact.value}</dd>
          </div>
        ))}
      </dl>

      <LogPane
        columns={view.columns}
        emptyNote={emptyLogNote(view.live, view.retained)}
        label={LOG_LABEL}
        live={view.live === true}
        rows={view.rows}
        tall
      />

      {view.error !== null && (
        <p className="farm-live__error" role="status">
          {view.error}
        </p>
      )}

      <p className="shell-overlay__note">{LOG_SHEET_NOTE}</p>

      <button className="shell-overlay__close" onClick={onClose} type="button">
        {JOB_SHEET_CLOSE}
      </button>
    </>
  );
}
