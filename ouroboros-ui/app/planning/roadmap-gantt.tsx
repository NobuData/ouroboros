"use client";

import { useRouter } from "next/navigation";
import { type CSSProperties, useId, useMemo, useRef, useState } from "react";

import type { PlanningEpic, PlanningRoadmap } from "@/app/api/planning";
import { useMediaQuery } from "@/app/media-query";
import { Button, cx } from "@/app/ui";

import { EpicEditor } from "./epic-editor";
import {
  ADD_EPIC_LABEL,
  GANTT_FOOTNOTE,
  GANTT_LABEL,
  KEYBOARD_HINT,
  type MonthSpan,
  type PendingEdits,
  RANGE_EDITS,
  READ_ONLY_STEP_REASON,
  type RangeEdit,
  STEPPERS,
  STEPPER_GROUP,
  barLabel,
  barPlacement,
  beginEdit,
  chipText,
  drawnLanes,
  editSpan,
  ganttColumns,
  ganttWindow,
  keyEdit,
  laneSpan,
  monthsFromPixels,
  moveFailure,
  progressPercent,
  sameSpan,
  settleEdit,
  spanMonths,
  statusAffix,
  stepperLabel,
  stepperReason,
  withSpan,
} from "./gantt";
import { updateEpic } from "./gantt-actions";
import { TodayMarker, TodayOutsideNote } from "./today-marker";

import "./planning.css";

/**
 * `RoadmapGantt` — mockup 09's `c-12` roadmap as a CSS grid
 * (AM.4, [#286](https://github.com/NobuData/ouroboros/issues/286)).
 *
 * A label column, then one column per month of the roadmap's timeline, with a rule down each; a lane per
 * epic, its bar tinted, filled to its computed done-fraction and chipped `12 issues · 8 done`; and the
 * TODAY marker from the reader's clock (`app/planning/today-marker.tsx`). The decisions are all
 * `app/planning/gantt.ts`'s; this draws them and handles the pointer and the keyboard.
 *
 * ### It scrolls inside its own wrapper
 *
 * The grid has a floor width, so on a narrow pane it is wider than its card. The overflow is the
 * wrapper's — `.planning-gantt__scroll` — so the content pane itself never scrolls sideways (the shell's
 * one-scroll-container rule, `docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.3).
 *
 * ### Editing: month-snapped, optimistic, rolled back
 *
 * For an `owner` or an `admin`, a scheduled bar can be dragged to move it and dragged by either edge to
 * resize it. The pointer's distance becomes whole months (`monthsFromPixels`), the bar redraws at the
 * snapped months as it goes, and on release one `PATCH` is sent (AL.4,
 * [#280](https://github.com/NobuData/ouroboros/issues/280)). The bar keeps its new place while the
 * service answers; a refusal puts it back where the service last confirmed it and says why.
 *
 * Every drag has a keyboard path. A focused bar moves with `←` / `→`, its end with **Shift**, its start
 * with **Alt**; and the steppers beside its label — shown while the lane holds focus — do the same with
 * a button each. Under `prefers-reduced-motion: reduce` the bar does not follow the pointer between
 * months; it only jumps to each snapped month.
 *
 * A click (or **Enter**) opens the epic editor sheet — read-only for a reader who may not change the
 * roadmap.
 */

/** What the gantt needs to be told. */
export interface RoadmapGanttProps {
  /** The roadmap the page read — its window label and its lanes, top first. At least one lane. */
  readonly roadmap: PlanningRoadmap;
  /** The month the page was read in (`gantt.ts`'s index), for a roadmap with no months at all. */
  readonly readMonth: number;
  /** Whether this reader is an `owner` or an `admin` — who may change the roadmap. */
  readonly mayAdminister: boolean;
}

/** A drag in progress. */
interface Drag {
  /** The lane being dragged. */
  readonly lane: PlanningEpic;
  /** What the drag changes. */
  readonly edit: RangeEdit;
  /** The lane's months when the drag began. */
  readonly from: MonthSpan;
  /** The pointer's x when the drag began. */
  readonly startX: number;
  /** One month column's width, measured when the drag began. */
  readonly monthWidth: number;
  /** The months the bar is drawn at now. */
  readonly span: MonthSpan;
  /** How far past its snapped position the bar follows the pointer — zero under reduced motion. */
  readonly residual: number;
  /** Whether the pointer has moved far enough to be a drag rather than a click. */
  readonly moved: boolean;
}

/** How far the pointer must travel before a press is a drag, not a click. */
const DRAG_THRESHOLD_PX = 4;

/** The reduced-motion query. */
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** The custom properties a lane's grid placement travels in. */
const ROW_PROPERTY = "--planning-gantt-row";
const START_PROPERTY = "--planning-gantt-start";
const END_PROPERTY = "--planning-gantt-end";
const FILL_PROPERTY = "--planning-gantt-fill";
const MONTHS_PROPERTY = "--planning-gantt-months";
const RESIDUAL_PROPERTY = "--planning-gantt-residual";
const LANES_PROPERTY = "--planning-gantt-lanes";

/** How mockup 09 tints a bar — its `t-accent … t-neutral`, one class per `tint`. */
const TINT_CLASS: Record<PlanningEpic["tint"], string> = {
  accent: "planning-gantt__bar--accent",
  model: "planning-gantt__bar--model",
  warn: "planning-gantt__bar--warn",
  ok: "planning-gantt__bar--ok",
  neutral: "planning-gantt__bar--neutral",
};

/** The grid row the month heads take; lanes start below it. */
const HEAD_ROW = 1;

/**
 * The gantt, its footnote and its **Add epic** action.
 *
 * @param props See {@link RoadmapGanttProps}.
 * @returns The card body.
 */
export function RoadmapGantt({ roadmap, readMonth, mayAdminister }: RoadmapGanttProps) {
  const router = useRouter();
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const grid = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const pending = useRef<PendingEdits>(new Map());
  const clickSuppressed = useRef(false);
  const dragging = useRef<Drag | null>(null);
  const hintId = useId();

  const [inFlight, setInFlight] = useState<PendingEdits>(() => new Map());
  const [settled, setSettled] = useState<ReadonlyMap<string, PlanningEpic>>(new Map());
  const [readFrom, setReadFrom] = useState(roadmap);
  const [drag, setDragState] = useState<Drag | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ readonly epicId: string } | "add" | null>(null);

  // A fresh read supersedes every lane the service answered since the last one.
  if (readFrom !== roadmap) {
    setReadFrom(roadmap);
    setSettled(new Map());
  }

  // From the read, not the drawn lanes, so the columns do not shift under a drag.
  const timeline = useMemo(() => ganttWindow(roadmap, readMonth), [roadmap, readMonth]);
  const columns = ganttColumns(timeline);
  const lanes = drawnLanes(roadmap.lanes, settled, inFlight).map((lane) =>
    drag !== null && drag.lane.id === lane.id ? withSpan(lane, drag.span) : lane,
  );
  const editingLane =
    editing !== null && editing !== "add" ? (lanes.find((lane) => lane.id === editing.epicId) ?? null) : null;

  /**
   * Hold the drag in a ref as well as in state, so a second pointer event in the same frame reads the
   * drag the first one left rather than the one the last render saw.
   *
   * @param next The drag, or `null` when none is in progress.
   */
  function setDrag(next: Drag | null): void {
    dragging.current = next;
    setDragState(next);
  }

  /**
   * Send one lane's new months, drawing them at once and rolling back if refused.
   *
   * @param lane The lane as drawn before the change.
   * @param span Its new months.
   */
  function commit(lane: PlanningEpic, span: MonthSpan): void {
    const from = laneSpan(lane);

    if (from === null || sameSpan(from, span)) return;

    sequence.current += 1;

    const request = sequence.current;

    pending.current = beginEdit(pending.current, lane, withSpan(lane, span), request);
    setInFlight(pending.current);
    setFailure(null);

    void updateEpic(lane.id, spanMonths(span)).then((outcome) => {
      const result = settleEdit(pending.current, lane.id, request, outcome.ok ? outcome.value : null);

      pending.current = result.pending;
      setInFlight(result.pending);

      if (result.settled !== null) {
        const stored = result.settled;

        setSettled((current) => new Map(current).set(stored.id, stored));
      }

      if (!outcome.ok && result.rolledBack) {
        setFailure(moveFailure(lane.name, outcome.refusal.code));
        return;
      }

      if (outcome.ok) router.refresh();
    });
  }

  /**
   * Begin a drag on a bar, or on one of its edges.
   *
   * @param event The press.
   * @param lane The lane.
   */
  function pressBar(event: React.PointerEvent<HTMLButtonElement>, lane: PlanningEpic): void {
    clickSuppressed.current = false;

    const span = laneSpan(lane);

    if (!mayAdminister || span === null || event.button !== 0) return;

    const edge = (event.target as HTMLElement).closest<HTMLElement>("[data-edge]")?.dataset.edge;
    const head = grid.current?.querySelector<HTMLElement>(".planning-gantt__month");
    const monthWidth = head?.getBoundingClientRect().width ?? 0;

    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({
      lane,
      edit: edge === "start" || edge === "end" ? edge : "move",
      from: span,
      startX: event.clientX,
      monthWidth,
      span,
      residual: 0,
      moved: false,
    });
  }

  /**
   * Follow the pointer, snapping the bar to whole months.
   *
   * @param event The move.
   */
  function followPointer(event: React.PointerEvent<HTMLButtonElement>): void {
    const drag = dragging.current;

    if (drag === null) return;

    const pixels = event.clientX - drag.startX;
    const months = monthsFromPixels(pixels, drag.monthWidth);
    const span = editSpan(drag.from, drag.edit, months, timeline);
    const snappedPixels = (span.first - drag.from.first) * drag.monthWidth;
    const follows = !reducedMotion && drag.edit === "move";

    setDrag({
      ...drag,
      span,
      residual: follows ? pixels - snappedPixels : 0,
      moved: drag.moved || Math.abs(pixels) >= DRAG_THRESHOLD_PX,
    });
  }

  /** Finish a drag: send the snapped months, if they changed. */
  function releaseBar(): void {
    const drag = dragging.current;

    if (drag === null) return;

    setDrag(null);

    if (!drag.moved) return;

    // The release is followed by a click on the same button; a drag is not an open.
    clickSuppressed.current = true;
    commit(drag.lane, drag.span);
  }

  /**
   * The keyboard's drag: arrows move the bar, Shift its end, Alt its start.
   *
   * @param event The key press on a focused bar.
   * @param lane The lane.
   */
  function keyBar(event: React.KeyboardEvent<HTMLButtonElement>, lane: PlanningEpic): void {
    const wanted = keyEdit(event.key, event);
    const span = laneSpan(lane);

    // A reader who may not edit keeps the arrows for scrolling the wrapper.
    if (wanted === null || !mayAdminister) return;

    event.preventDefault();

    if (span !== null) commit(lane, editSpan(span, wanted.edit, wanted.months, timeline));
  }

  /**
   * Open the editor, unless this click is the tail of a drag.
   *
   * @param lane The lane.
   */
  function openLane(lane: PlanningEpic): void {
    if (clickSuppressed.current) {
      clickSuppressed.current = false;
      return;
    }

    setEditing({ epicId: lane.id });
  }

  /**
   * Keep what the editor stored, and re-read the page.
   *
   * @param epic The stored lane.
   */
  function editorSaved(epic: PlanningEpic): void {
    setSettled((current) => new Map(current).set(epic.id, epic));
    router.refresh();
  }

  return (
    <div className="planning-gantt">
      <div className="planning-gantt__scroll">
        <div
          aria-label={GANTT_LABEL}
          className="planning-gantt__grid"
          ref={grid}
          role="group"
          style={
            {
              [MONTHS_PROPERTY]: String(columns.length),
              [LANES_PROPERTY]: String(lanes.length),
            } as CSSProperties
          }
        >
          {columns.map((column) => (
            <span
              aria-hidden
              className="planning-gantt__rule"
              key={`rule-${column.month}`}
              style={{ [START_PROPERTY]: String(column.column) } as CSSProperties}
            />
          ))}
          {columns.map((column) => (
            <span
              className="planning-gantt__month"
              key={`month-${column.month}`}
              style={{ [START_PROPERTY]: String(column.column) } as CSSProperties}
            >
              {column.label}
            </span>
          ))}

          {lanes.map((lane, index) => {
            const row = HEAD_ROW + 1 + index;
            const placement = barPlacement(lane, timeline);
            const fill = progressPercent(lane.chips);
            const affix = statusAffix(lane.status);
            const dragged = drag?.lane.id === lane.id;
            const editable = mayAdminister && placement.scheduled;

            return (
              <div className="planning-gantt__lane" key={lane.id}>
                <span
                  className="planning-gantt__label"
                  style={{ [ROW_PROPERTY]: String(row) } as CSSProperties}
                >
                  {lane.name}
                  {affix !== null && <span className="planning-gantt__affix">{affix}</span>}
                </span>

                <button
                  aria-describedby={mayAdminister ? hintId : undefined}
                  aria-label={barLabel(lane)}
                  className={cx(
                    "planning-gantt__bar",
                    TINT_CLASS[lane.tint],
                    !placement.scheduled && "planning-gantt__bar--unscoped",
                    editable && "planning-gantt__bar--editable",
                    dragged && "planning-gantt__bar--dragging",
                    inFlight.has(lane.id) && "planning-gantt__bar--saving",
                  )}
                  onClick={() => { openLane(lane); }}
                  onKeyDown={(event) => { keyBar(event, lane); }}
                  onPointerCancel={() => { setDrag(null); }}
                  onPointerDown={(event) => { pressBar(event, lane); }}
                  onPointerMove={followPointer}
                  onPointerUp={() => { releaseBar(); }}
                  style={
                    {
                      [ROW_PROPERTY]: String(row),
                      [START_PROPERTY]: String(placement.columnStart),
                      [END_PROPERTY]: String(placement.columnEnd),
                      [RESIDUAL_PROPERTY]: dragged ? `${String(drag.residual)}px` : "0px",
                      ...(fill === null ? {} : { [FILL_PROPERTY]: `${String(fill)}%` }),
                    } as CSSProperties
                  }
                  type="button"
                >
                  {fill !== null && <span aria-hidden className="planning-gantt__fill" />}
                  {editable && <span aria-hidden className="planning-gantt__edge planning-gantt__edge--start" data-edge="start" />}
                  <span className="planning-gantt__name">{lane.name}</span>
                  <span className="planning-gantt__chip">{chipText(lane)}</span>
                  {editable && <span aria-hidden className="planning-gantt__edge planning-gantt__edge--end" data-edge="end" />}
                </button>

                {mayAdminister && (
                  <span
                    aria-label={`${lane.name} months`}
                    className="planning-gantt__steppers"
                    role="toolbar"
                    style={{ [ROW_PROPERTY]: String(row) } as CSSProperties}
                  >
                    {RANGE_EDITS.map((edit) => (
                      <span className="planning-gantt__step-group" key={edit}>
                        <span aria-hidden className="planning-gantt__step-label">
                          {STEPPER_GROUP[edit]}
                        </span>
                        {STEPPERS.filter((stepper) => stepper.edit === edit).map((stepper) => (
                          <Button
                            aria-label={stepperLabel(stepper, lane.name)}
                            className="planning-gantt__step"
                            key={stepper.months}
                            onClick={() => {
                              const span = laneSpan(lane);

                              if (span !== null) {
                                commit(lane, editSpan(span, stepper.edit, stepper.months, timeline));
                              }
                            }}
                            reason={stepperReason(stepper, lane, timeline, mayAdminister)}
                            size="sm"
                            tone="ghost"
                          >
                            {stepper.glyph}
                          </Button>
                        ))}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            );
          })}

          <TodayMarker window={timeline} />
        </div>
      </div>

      <TodayOutsideNote window={timeline} />

      {failure !== null && (
        <p className="planning-gantt__failure" role="alert">
          {failure}
        </p>
      )}

      <div className="planning-gantt__foot">
        <p className="planning-gantt__note">{GANTT_FOOTNOTE}</p>
        {mayAdminister && (
          <p className="planning-gantt__hint" id={hintId}>
            {KEYBOARD_HINT}
          </p>
        )}
        <Button
          onClick={() => { setEditing("add"); }}
          reason={mayAdminister ? undefined : READ_ONLY_STEP_REASON}
          size="sm"
          tone="ghost"
        >
          {ADD_EPIC_LABEL}
        </Button>
      </div>

      {(editing === "add" || editingLane !== null) && (
        <EpicEditor
          epic={editingLane}
          key={editingLane?.id ?? "add"}
          mayAdminister={mayAdminister}
          onClose={() => { setEditing(null); }}
          onSaved={editorSaved}
          roadmap={roadmap}
        />
      )}
    </div>
  );
}
