"use client";

import Link from "next/link";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { Reading } from "@/app/api/reading";
import type { CopilotPromotion } from "@/app/api/workflow-copilot";
import { workflowCodePath, workflowNodePath, workflowPath } from "@/app/paths";
import { EMPTY_POLL_SNAPSHOT } from "@/app/poll";
import { Card, CardHead, Chip, EmptyState, RetryBanner, Tag, cx } from "@/app/ui";

import { useCopilotLive } from "./copilot-live";
import { seatElementId, stageAnchorId } from "./copilot-view";
import { useStageTarget } from "./stage-target";
import {
  type AliasModel,
  EDIT_LABEL,
  NO_STAGES_NOTE,
  NO_STAGES_TITLE,
  OPEN_CANVAS_LABEL,
  STAGES_LABEL,
  STAGES_SCROLL_LABEL,
  STALE_HEADLINE,
  STALE_RETRY_LABEL,
  type StageDraft,
  type StageRow,
  type StageTag,
  VIEW_AS_CODE_LABEL,
  advanceStageDraft,
  editName,
  footerParts,
  openStageDraft,
  revTag,
  stageRows,
  stagesTitle,
  warningButtonName,
} from "./stages";
import { type StagesPollOptions, createStagesPoll } from "./stages-poll";

import "./copilot.css";
import "./stages.css";

/**
 * The draft's stage list (CE.3, [#567](https://github.com/NobuData/ouroboros/issues/567)) —
 * mockup 20's `DRAFT — SECURITY-PATCH · UNPUBLISHED` card, in the frame's **stages** seat.
 *
 * Every row is composed (`stages.ts`): numbered in the order a run walks the graph, the kind's
 * glyph as the canvas draws it, the stage's name, its config tags, `added by copilot` where the
 * draft's operation log says so, and **edit**, which opens the canvas focused on that stage.
 * Nothing in the list writes, so it is the same list for every reader.
 *
 * ### Three sources, one working draft
 *
 * The route's read is what the card opens on. From there it keeps itself current without a
 * reload: a **poll** of the draft (`stages-poll.ts`) every interval and whenever the window
 * regains focus — which is how a pill clears after the stage is edited on the canvas — and the
 * conversation's **stream** (`copilot-live.ts`), whose applied operations are folded into the
 * document as they arrive, so rows appear, change and reorder while the reply is still being
 * written. `stages.ts`' `advanceStageDraft` decides which of them is drawn; the poll rests while
 * a reply streams, because the stream is then the newer account.
 *
 * ### An unresolved reference is never a confident tag
 *
 * A tag naming a skill, a task kind or an alias that resolves to nothing (decision **W7**) is
 * drawn on the warning hue with `⚠`, what it is in two words, and an ⓘ that opens — in the flow
 * of the row, so nothing clips it — what is missing and where it will come from, with the
 * service's own sentence under it. The footer says the same at summary level.
 *
 * ### Scrolling, and the row a link names
 *
 * A long list scrolls inside its own bounded, focusable wrapper; the pane does not grow with it.
 * A finding's `#stage-<id>` link rings its row, brings it into view inside that wrapper and
 * moves focus to it (`stage-target.ts` — `:target` does not follow a router link). Folded twins
 * answer to every id they stand for.
 */

/** What the card takes. */
export interface StagesCardProps {
  /** The workflow's id — what the poll and the live store are keyed by. */
  readonly workflowId: string;
  /** Its slug, for the links to the canvas and the code view. */
  readonly slug: string;
  /** Its name, for the title. */
  readonly name: string;
  /** The version in force, or `null` for a workflow that has published nothing. */
  readonly currentVersion: number | null;
  /** The draft, as the route read it. */
  readonly draft: StageDraft;
  /** The workspace's model aliases — empty when they could not be read, and a tag then names the alias. */
  readonly aliases: readonly AliasModel[];
  /** The promotion summary, for the footer's guards — or why it could not be read. */
  readonly promotion: Reading<CopilotPromotion>;
  /** The poll's test seams; production passes none. */
  readonly poll?: StagesPollOptions;
}

/**
 * The stage list.
 *
 * @param props See {@link StagesCardProps}.
 * @returns The card.
 */
export function StagesCard({ workflowId, slug, name, currentVersion, draft, aliases, promotion, poll: pollOptions }: StagesCardProps) {
  const element = seatElementId("stages");
  const titleId = `${element}-title`;
  const live = useCopilotLive(workflowId);

  // One loop per card; the card is keyed by its workflow.
  const [poll] = useState(() => createStagesPoll(workflowId, pollOptions));
  const polled = useSyncExternalStore(poll.subscribe, poll.snapshot, () => EMPTY_POLL_SNAPSHOT);

  useEffect(() => {
    // While a reply streams, the stream is the newer account of the draft; asking again when it
    // ends is the loop's own first act.
    if (live.streaming) return;

    const stop = poll.start();
    const onFocus = (): void => poll.refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      stop();
    };
  }, [poll, live.streaming]);

  // Something other than the conversation changed the draft — the dry-run card applied a
  // suggestion (CE.4, #568) — so the list asks again now rather than at its next interval.
  useEffect(() => {
    if (live.revision > 0) poll.refresh();
  }, [poll, live.revision]);

  // The working draft, advanced during render by whatever has arrived — React's *adjusting state
  // when a prop changes*, since each source is an input and the fold is pure.
  const [held, setHeld] = useState(() => openStageDraft(draft, live));
  const state = advanceStageDraft(held, { server: draft, polled: polled.data, live });
  if (state !== held) setHeld(state);

  const rows = useMemo(
    () => stageRows({ definition: state.definition, provenance: state.provenance, warnings: state.warnings, aliases }),
    [state.definition, state.provenance, state.warnings, aliases],
  );
  const foot = footerParts({ rows: rows.length, warnings: state.warnings, promotion });

  const target = useStageTarget();
  const targetRow = target === null ? null : (rows.find((row) => row.nodeIds.includes(target.nodeId))?.id ?? null);
  const elements = useRef(new Map<string, HTMLLIElement>());
  const stamp = target?.stamp ?? null;

  useEffect(() => {
    if (targetRow === null) return;

    const row = elements.current.get(targetRow);
    if (row === undefined) return;

    // jsdom has no layout and no `scrollIntoView`; a browser brings the row into view inside the
    // list's own wrapper, and the pane only as far as it must.
    if (typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
    row.focus({ preventScroll: true });
  }, [targetRow, stamp]);

  return (
    <Card aria-labelledby={titleId} as="section" className={cx("copilot-view__seat", "copilot-stages")} id={element}>
      <CardHead
        beside={state.definition === null ? undefined : <Tag>{revTag(state.label)}</Tag>}
        className="copilot-stages__head"
        title={stagesTitle(name, currentVersion)}
        titleId={titleId}
        trailing={
          <Link className="copilot-stages__code" href={workflowCodePath(slug)}>
            {VIEW_AS_CODE_LABEL}
          </Link>
        }
      />

      {polled.error !== null && (
        <RetryBanner
          className="copilot-stages__stale"
          headline={STALE_HEADLINE}
          onRetry={poll.refresh}
          reason={polled.error}
          retryLabel={STALE_RETRY_LABEL}
          retryingLabel={STALE_RETRY_LABEL}
        />
      )}

      {rows.length === 0 ? (
        <EmptyState note={NO_STAGES_NOTE} title={NO_STAGES_TITLE} variant="flush">
          <Link className="copilot-stages__open" href={workflowPath(slug)}>
            {OPEN_CANVAS_LABEL}
          </Link>
        </EmptyState>
      ) : (
        <>
          {/* The one thing here that scrolls: focusable, so a keyboard can scroll it, and named. */}
          <div aria-label={STAGES_SCROLL_LABEL} className="copilot-stages__scroll" role="group" tabIndex={0}>
            <ol aria-label={STAGES_LABEL} className="copilot-stages__list">
              {rows.map((row) => {
                const marks = row.nodeIds.reduce((sum, id) => sum + (state.fresh[id] ?? 0), 0);

                return (
                  <StageItem
                    // A stage changed again is a row drawn again, so its highlight plays again.
                    key={`${row.id}:${marks}`}
                    fresh={marks > 0}
                    onElement={(node) => {
                      if (node === null) elements.current.delete(row.id);
                      else elements.current.set(row.id, node);
                    }}
                    row={row}
                    slug={slug}
                    targeted={targetRow === row.id}
                  />
                );
              })}
            </ol>
          </div>

          <p className="copilot-stages__foot">
            {foot.map((part, index) => (
              <span key={part.key}>
                {index > 0 && <span aria-hidden="true"> · </span>}
                <span className={cx("copilot-stages__fact", part.tone === "warn" && "copilot-stages__fact--warn")}>
                  {part.text}
                </span>
              </span>
            ))}
          </p>
        </>
      )}
    </Card>
  );
}

/**
 * One row: its number, glyph and name, its tags, its pill, and **edit**.
 *
 * The row is a list item that can be focused by script and not by Tab — a finding's link lands
 * on it — and it carries the element id of its first stage; a folded twin's id is on an empty
 * anchor inside it, so every stage the row stands for can be linked to.
 *
 * One warning's note is open at a time, under the row's line. Escape closes it and returns focus
 * to the ⓘ that opened it.
 *
 * @param props.row The row.
 * @param props.slug The workflow's slug.
 * @param props.targeted Whether the address points at this row.
 * @param props.fresh Whether a live operation has just added or changed it.
 * @param props.onElement Told the row's element, and `null` when it goes.
 * @returns The list item.
 */
function StageItem({
  row,
  slug,
  targeted,
  fresh,
  onElement,
}: Readonly<{
  row: StageRow;
  slug: string;
  targeted: boolean;
  fresh: boolean;
  onElement: (node: HTMLLIElement | null) => void;
}>) {
  const ids = useId();
  const [open, setOpen] = useState<string | null>(null);
  const shown = row.tags.find((tag) => tag.warning !== null && tag.key === open) ?? null;
  const noteId = `${ids}-note`;

  /**
   * The ⓘ's element id, which is how Escape finds the control to give focus back to.
   *
   * @param tag The warning tag.
   * @returns The id.
   */
  const toggleId = (tag: StageTag): string => `${ids}-info-${row.tags.indexOf(tag)}`;

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>): void {
    if (event.key !== "Escape" || shown === null) return;

    event.stopPropagation();
    setOpen(null);
    document.getElementById(toggleId(shown))?.focus();
  }

  return (
    <li
      className={cx("copilot-stages__row", targeted && "copilot-stages__row--target", fresh && "copilot-stages__row--fresh")}
      id={stageAnchorId(row.id)}
      onKeyDown={onKeyDown}
      ref={onElement}
      tabIndex={-1}
    >
      {row.nodeIds.slice(1).map((id) => (
        <span className="copilot-stages__anchor" id={stageAnchorId(id)} key={id} />
      ))}

      <div className="copilot-stages__line">
        <span className="copilot-stages__idx">{row.number}</span>
        <span aria-hidden="true" className="copilot-stages__glyph">
          {row.glyph}
        </span>
        <span className="copilot-stages__name">
          {row.name}
          <span className="sr-only">{`, ${row.kindWord} stage`}</span>
        </span>

        {row.tags.map((tag) =>
          tag.warning === null ? (
            <Tag key={tag.key}>{tag.text}</Tag>
          ) : (
            <span className="copilot-stages__warn" key={tag.key}>
              <Chip mono tone="warn">
                <span>
                  {tag.text} <span aria-hidden="true">⚠</span>
                  <span className="sr-only">warning:</span> {tag.warning.summary}
                </span>
              </Chip>
              <button
                aria-controls={noteId}
                aria-expanded={open === tag.key}
                aria-label={warningButtonName(tag.text)}
                className="copilot-stages__info"
                id={toggleId(tag)}
                onClick={() => setOpen(open === tag.key ? null : tag.key)}
                type="button"
              >
                <span aria-hidden="true">ⓘ</span>
              </button>
            </span>
          ),
        )}

        {row.pill !== null && <Chip tone="warn">{row.pill}</Chip>}

        <Link aria-label={editName(row.name)} className="copilot-stages__edit" href={workflowNodePath(slug, row.id)}>
          {EDIT_LABEL}
        </Link>
      </div>

      {/* In the tree whenever a tag warns, so the ⓘ's `aria-controls` names something; shown when one is open. */}
      {row.tags.some((tag) => tag.warning !== null) && (
        <div className="copilot-stages__note" hidden={shown === null} id={noteId} role="note">
          {shown?.warning != null && (
            <>
              <p className="copilot-stages__missing">{shown.warning.explanation}</p>
              <p className="copilot-stages__said">{shown.warning.message}</p>
            </>
          )}
        </div>
      )}
    </li>
  );
}
