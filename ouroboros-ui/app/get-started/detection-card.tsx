"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import type { RepoDetection, RepoDetectionProgress, RepoDetectionRow } from "@/app/api/detection";
import type { Reading } from "@/app/api/reading";
import { GlobEditor } from "@/app/globs/glob-editor";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { KNOWLEDGE_PATH } from "@/app/paths";
import { Button, Card, CardHead, Chip, Meter, Tag } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import { previewProtectedPaths, rescanRepository, saveProtectedPaths } from "./actions";
import {
  type DetectionPollOptions,
  createDetectionPoll,
  detectionEndpoint,
} from "./detection-poll";
import {
  type RowMark,
  CONVENTIONS_ROADMAP_LABEL,
  DETECTION_TITLE,
  EVIDENCE_LABEL,
  NEVER_SCANNED_LINE,
  NEVER_SCANNED_TITLE,
  PARTIAL_LINE,
  PROGRESS_LABEL,
  PROTECTED_ADMIN_REASON,
  PROTECTED_CANCEL_LABEL,
  PROTECTED_CONSEQUENCE,
  PROTECTED_CONSEQUENCE_DETAIL,
  PROTECTED_EDIT_LABEL,
  PROTECTED_LIST_LABEL,
  PROTECTED_SAVED,
  PROTECTED_SAVE_LABEL,
  PROTECTED_SAVING,
  PROTECTED_UNCHANGED_REASON,
  RESCANNING,
  RESCAN_LABEL,
  RESCAN_VIEWER_REASON,
  RETRY_SCAN_LABEL,
  ROW_GLYPHS,
  ROW_LABELS,
  ROW_MARK_NAMES,
  SCAN_LABEL,
  STEP_DONE_TAG,
  UNDETERMINED_TAG,
  cardState,
  evidenceLines,
  evidenceName,
  globsChanged,
  isPartial,
  isScanning,
  pointsAtRoadmap,
  progressFraction,
  progressLine,
  protectedSummary,
  rescanWait,
  rescanWaitReason,
  rowLabel,
  rowMark,
  rowValue,
  scanFailure,
  scannedIn,
  splitValue,
} from "./detection-view";
import type { Abilities } from "./view";

/** What {@link DetectionCard} takes. */
export interface DetectionCardProps {
  /** The repository. */
  readonly repo: string;
  /** The first paint's read of the card. */
  readonly initial: Reading<RepoDetection> | null;
  /** Whether step 2 is done — the mockup's `✓ step 2 done` tag. */
  readonly stepDone: boolean;
  /** What the person may do: contributors re-scan, owners and admins edit protected paths. */
  readonly abilities: Abilities;
  /** Test seams for the card's poll. */
  readonly poll?: DetectionPollOptions;
  /** The clock, in epoch milliseconds — a test seam for the debounce. */
  readonly now?: () => number;
}

/**
 * The clock, re-read every second while `active` — what counts the debounce down on the button.
 *
 * @param active Whether anything is counting.
 * @param clock The clock.
 * @returns The time, in epoch milliseconds.
 */
function useTicking(active: boolean, clock: () => number): number {
  const [now, setNow] = useState(clock);

  useEffect(() => {
    if (!active) return;

    const tick = (): void => setNow(clock());
    // The first read is deferred a tick, like the rest: a clock read during the effect would
    // re-render synchronously.
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);

    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, clock]);

  return now;
}

/**
 * The newer of two progress reports, by when each scan started — so the progress a re-scan's own
 * answer reported shows until the poll has heard of that scan.
 *
 * @param polled What the poll last read.
 * @param local What the re-scan answered, or null.
 * @returns The one to draw.
 */
function newerProgress(
  polled: RepoDetectionProgress | null,
  local: RepoDetectionProgress | null,
): RepoDetectionProgress | null {
  if (local === null) return polled;
  if (polled === null) return local;

  return Date.parse(polled.startedAt) >= Date.parse(local.startedAt) ? polled : local;
}

/**
 * A row's evidence behind a keyboard-reachable control: a real button with `aria-expanded`, a
 * labelled group as the panel, Escape and a press outside close it, and Escape gives the focus
 * back to the button. The panel sits in the row's flow, so the scrolling step content never
 * clips it.
 *
 * @param props.row The row.
 * @param props.label The row's label.
 * @returns The control and, while open, the probe hits.
 */
function EvidencePopover({ row, label }: Readonly<{ row: RepoDetectionRow; label: string }>) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const evidence = evidenceLines(row);

  useEffect(() => {
    if (!open) return;

    /** Close on Escape, and give focus back to the control. */
    function onKey(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;

      setOpen(false);
      button.current?.focus();
    }

    /** Close on a press outside the control and its panel. */
    function onPress(event: MouseEvent): void {
      if (!(event.target instanceof Node) || root.current?.contains(event.target) !== true)
        setOpen(false);
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPress);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPress);
    };
  }, [open]);

  return (
    <div className="detect-evidence" ref={root}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={evidenceName(label)}
        className="detect-evidence__toggle"
        onClick={() => setOpen(!open)}
        ref={button}
        type="button"
      >
        {EVIDENCE_LABEL}
      </button>
      {open && (
        <div
          aria-label={evidenceName(label)}
          className="detect-evidence__panel"
          id={panelId}
          role="group"
        >
          {evidence.found !== null && (
            <p className="detect-evidence__line">
              Found <span className="detect-evidence__path">{evidence.found}</span>
            </p>
          )}
          {evidence.probes.length > 0 ? (
            <ul aria-label="Probe hits" className="detect-evidence__probes">
              {evidence.probes.map((probe) => (
                <li className="detect-evidence__probe" key={probe}>
                  {probe}
                </li>
              ))}
            </ul>
          ) : (
            <p className="detect-evidence__line">No probe is recorded for this row.</p>
          )}
          {evidence.unfinished.length > 0 && (
            <ul
              aria-label="Did not finish"
              className="detect-evidence__probes detect-evidence__probes--unfinished"
            >
              {evidence.unfinished.map((probe) => (
                <li className="detect-evidence__probe" key={probe}>
                  {probe}
                </li>
              ))}
            </ul>
          )}
          {(evidence.pack !== null || evidence.confidence !== null) && (
            <p className="detect-evidence__meta">
              {evidence.pack !== null && <>rule pack {evidence.pack}</>}
              {evidence.pack !== null && evidence.confidence !== null && " · "}
              {evidence.confidence !== null && <>{evidence.confidence} confidence</>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One row — mark, label, mono value with its dim affix, the honesty chip, and its evidence.
 *
 * @param props.row The row.
 * @param props.value What replaces the value, for the protected-paths row.
 * @param props.below What opens under the row's line — the protected-paths editor.
 * @returns The row.
 */
function DetectionRowView({
  row,
  value,
  below,
}: Readonly<{ row: RepoDetectionRow; value?: ReactNode; below?: ReactNode }>) {
  const mark = rowMark(row);
  const label = rowLabel(row.rowKey);
  const { claim, affix } = splitValue(rowValue(row));

  return (
    <li className={cx("detect-row", MARK_CLASS[mark])}>
      <div className="detect-row__line">
        <span aria-hidden className="detect-row__mark">
          {ROW_GLYPHS[mark]}
        </span>
        <span className="detect-row__label">
          <span className="sr-only">{ROW_MARK_NAMES[mark]}: </span>
          {label}
        </span>
        <span className="detect-row__value">
          {value ?? (
            <>
              {claim}
              {affix !== "" && <span className="detect-row__affix"> {affix}</span>}
              {pointsAtRoadmap(row) && (
                <>
                  {" "}
                  <Link className="detect-row__link" href={KNOWLEDGE_PATH}>
                    {CONVENTIONS_ROADMAP_LABEL} →
                  </Link>
                </>
              )}
            </>
          )}
        </span>
        <span className="detect-row__chips">
          {mark === "undetermined" && <Tag>{UNDETERMINED_TAG}</Tag>}
          <Chip tone={row.label === "measured" ? "ok" : "neutral"}>{row.label}</Chip>
        </span>
        <EvidencePopover label={label} row={row} />
      </div>
      {below}
    </li>
  );
}

/**
 * The protected-paths row's value and its inline editor — the highest-consequence control on the
 * card, so the consequence is stated beside it and only an owner or admin may save.
 *
 * @param props.repo The repository.
 * @param props.paths The stored list.
 * @param props.administer Whether the person may save.
 * @param props.onSaved Hands the card the re-read answer.
 * @param props.children Places the value (in the row's line) and the editor (under it).
 * @returns The row the children build.
 */
function ProtectedPaths({
  repo,
  paths,
  administer,
  onSaved,
  children,
}: Readonly<{
  repo: string;
  paths: RepoDetection["protectedPaths"];
  administer: boolean;
  onSaved: (detection: RepoDetection) => void;
  children: (value: ReactNode, editor: ReactNode) => ReactNode;
}>) {
  const editorId = useId();
  const consequenceId = useId();
  const stored = paths.map((path) => path.glob);
  const [draft, setDraft] = useState<readonly string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{
    readonly tone: "ok" | "refused";
    readonly text: string;
  } | null>(null);
  const summary = protectedSummary(paths);
  const changed = draft !== null && globsChanged(draft, stored);

  /** Save the draft, then hand the card what the service stored. */
  function save(): void {
    if (draft === null || saving || !changed) return;

    setSaving(true);
    setStatus(null);
    void saveProtectedPaths(repo, draft).then((outcome) => {
      setSaving(false);

      if (outcome.ok) {
        setDraft(null);
        setStatus({ tone: "ok", text: PROTECTED_SAVED });
        onSaved(outcome.value);
      } else {
        setStatus({ tone: "refused", text: outcome.reason });
      }
    });
  }

  const value = (
    <>
      <span className="detect-row__claim">{summary.globs}</span>
      {summary.provenance !== "" && (
        <span className="detect-row__affix"> {summary.provenance}</span>
      )}
      <span className="detect-row__affix"> · </span>
      <Button
        aria-controls={draft === null ? undefined : editorId}
        aria-expanded={draft !== null}
        className="detect-row__edit"
        onClick={() => {
          setStatus(null);
          setDraft(draft === null ? stored : null);
        }}
        reason={administer ? undefined : PROTECTED_ADMIN_REASON}
        size="sm"
        tone="ghost"
      >
        {PROTECTED_EDIT_LABEL}
      </Button>
      {status !== null && (
        <span
          className={cx(
            "detect-protect__status",
            status.tone === "refused" && "detect-protect__status--refused",
          )}
          role={status.tone === "refused" ? "alert" : "status"}
        >
          {status.text}
        </span>
      )}
    </>
  );

  const editor = draft !== null && (
    <div
      aria-describedby={consequenceId}
      className="detect-protect"
      id={editorId}
      role="group"
      aria-label={PROTECTED_LIST_LABEL}
    >
      <p className="detect-protect__consequence" id={consequenceId}>
        <strong className="detect-protect__term">{PROTECTED_CONSEQUENCE}</strong>{" "}
        {PROTECTED_CONSEQUENCE_DETAIL}
      </p>
      <GlobEditor
        globs={draft}
        id={`${editorId}-globs`}
        label={PROTECTED_LIST_LABEL}
        onChange={setDraft}
        preview={(globs) => previewProtectedPaths(repo, globs)}
        readOnly={saving}
      />
      <div className="detect-protect__actions">
        <Button
          onClick={save}
          reason={saving ? PROTECTED_SAVING : !changed ? PROTECTED_UNCHANGED_REASON : undefined}
          tone="primary"
        >
          {saving ? PROTECTED_SAVING : PROTECTED_SAVE_LABEL}
        </Button>
        <Button
          onClick={() => setDraft(null)}
          reason={saving ? PROTECTED_SAVING : undefined}
          tone="ghost"
        >
          {PROTECTED_CANCEL_LABEL}
        </Button>
      </div>
    </div>
  );

  return children(value, editor);
}

/** Each mark's row modifier — the hue of its glyph. */
const MARK_CLASS: Readonly<Record<RowMark, string>> = {
  ok: "detect-row--ok",
  warn: "detect-row--warn",
  missing: "detect-row--missing",
  undetermined: "detect-row--undetermined",
};

/** The protected-paths row's key — the row the editor replaces the value of. */
const PROTECTED_ROW = "protected_paths";

/**
 * The *"We already figured this out"* card (BC.2, [#391](https://github.com/NobuData/ouroboros/issues/391),
 * mockup 13) — the scan's rows, each showing its evidence and whether it was detected or measured,
 * and the one row that is an input: the protected paths.
 *
 * **States.** Never scanned (a line saying what a scan does, and a button to run one); the first
 * scan running (its progress); a stored scan, partial when the budget ran out (undetermined rows
 * marked, not hidden); and a failed scan with a retry. A re-scan runs **beside** the stored scan:
 * its rows stay on screen, with the progress above them, until the poll reads the new `scanSeq`.
 *
 * @param props See {@link DetectionCardProps}.
 * @returns The card.
 */
export function DetectionCard({
  repo,
  initial,
  stepDone,
  abilities,
  poll,
  now: clock = Date.now,
}: DetectionCardProps) {
  const titleId = useId();
  const { snapshot, refresh } = useKeyedPoll(detectionEndpoint(repo), (endpoint) =>
    createDetectionPoll(endpoint, poll),
  );
  const [saved, setSaved] = useState<{
    readonly answer: RepoDetection;
    readonly over: RepoDetection | null;
  } | null>(null);
  const polled = snapshot.data ?? (initial?.ok === true ? initial.value : null);
  // A saved list shows at once; the poll's next answer (a different object) takes over from it.
  const detection = saved !== null && saved.over === polled ? saved.answer : polled;
  const [pending, setPending] = useState(false);
  const [localProgress, setLocalProgress] = useState<RepoDetectionProgress | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const progress = newerProgress(detection?.progress ?? null, localProgress);
  const scanning = isScanning(progress);
  const now = useTicking(!scanning && progress !== null, clock);
  const wait = rescanWait(progress, now);

  /** Start a scan, or join the running one, then read the card at once. */
  function rescan(): void {
    if (pending || scanning) return;

    setPending(true);
    setRefusal(null);
    void rescanRepository(repo).then((outcome) => {
      setPending(false);

      if (outcome.ok) {
        setLocalProgress(outcome.value.progress);
        refresh();
      } else {
        setRefusal(outcome.reason);
      }
    });
  }

  if (detection === null) {
    const failure = snapshot.error ?? (initial?.ok === false ? initial.reason : null);

    return (
      <Card aria-labelledby={titleId} as="section" className="detect">
        <CardHead title={DETECTION_TITLE} titleId={titleId} />
        <p className="detect__line" role={failure === null ? undefined : "alert"}>
          {failure ?? NEVER_SCANNED_LINE}
        </p>
      </Card>
    );
  }

  const state = cardState({ ...detection, progress });
  const failure = scanFailure({ ...detection, progress });
  const held = !abilities.contribute
    ? RESCAN_VIEWER_REASON
    : pending || scanning
      ? RESCANNING
      : wait > 0
        ? rescanWaitReason(wait)
        : undefined;
  const label = failure !== null ? RETRY_SCAN_LABEL : state === "never" ? SCAN_LABEL : RESCAN_LABEL;
  const rows = detection.rows;
  const hasProtectedRow = rows.some((row) => row.rowKey === PROTECTED_ROW);

  /**
   * The protected-paths row, built around the row the scan stored — or a row of its own when the
   * scan stored none (a list saved before any scan, or a pack that did not run).
   *
   * @param row The stored row, or undefined.
   * @returns The row.
   */
  const protectedRow = (row: RepoDetectionRow | undefined) => (
    <ProtectedPaths
      administer={abilities.administer}
      key={PROTECTED_ROW}
      onSaved={(answer) => setSaved({ answer, over: polled })}
      paths={detection.protectedPaths}
      repo={repo}
    >
      {(value, editor) =>
        row === undefined ? (
          <li className={cx("detect-row", MARK_CLASS.ok)}>
            <div className="detect-row__line">
              <span aria-hidden className="detect-row__mark">
                {ROW_GLYPHS.ok}
              </span>
              <span className="detect-row__label">{ROW_LABELS[PROTECTED_ROW]}</span>
              <span className="detect-row__value">{value}</span>
            </div>
            {editor}
          </li>
        ) : (
          <DetectionRowView below={editor} row={row} value={value} />
        )
      }
    </ProtectedPaths>
  );

  return (
    <Card aria-labelledby={titleId} as="section" className="detect">
      <CardHead
        beside={stepDone ? <Chip tone="ok">{STEP_DONE_TAG}</Chip> : undefined}
        title={DETECTION_TITLE}
        titleId={titleId}
        trailing={
          <span className="detect__trail">
            {detection.scan !== null && <Tag>{scannedIn(detection.scan.durationMs)}</Tag>}
            <Button onClick={rescan} reason={held} size="sm" tone="ghost">
              {pending || scanning ? RESCANNING : label}
            </Button>
          </span>
        }
      />

      {scanning && progress !== null && (
        <div className="detect-progress" role="status">
          <Meter
            label={PROGRESS_LABEL}
            value={progressFraction(progress)}
            valueText={progressLine(progress)}
          />
          <span className="detect-progress__line">{progressLine(progress)}</span>
        </div>
      )}

      {failure !== null && !scanning && (
        <p className="detect__failure" role="alert">
          {failure}
        </p>
      )}

      {refusal !== null && (
        <p className="detect__failure" role="alert">
          {refusal}
        </p>
      )}

      {state === "never" && (
        <div className="detect__empty">
          <h3 className="detect__empty-title">{NEVER_SCANNED_TITLE}</h3>
          <p className="detect__line">{NEVER_SCANNED_LINE}</p>
        </div>
      )}

      {state === "ready" && isPartial(rows) && <p className="detect__partial">{PARTIAL_LINE}</p>}

      {state === "ready" && (
        <ul aria-label={DETECTION_TITLE} className="detect__rows">
          {rows.map((row) =>
            row.rowKey === PROTECTED_ROW ? (
              protectedRow(row)
            ) : (
              <DetectionRowView key={row.rowKey} row={row} />
            ),
          )}
          {!hasProtectedRow && protectedRow(undefined)}
        </ul>
      )}
    </Card>
  );
}
