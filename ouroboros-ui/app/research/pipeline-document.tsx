"use client";

import { Fragment, useId, useState, useTransition } from "react";

import type { ResearchRoadmap, RoadmapSuggestion } from "@/app/api/research";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Chip, type Effort, EffortChip, Tag, cx } from "@/app/ui";

import {
  APPLIED_TITLE,
  APPLY_CONFIRM,
  APPLY_CONFIRM_NOTE,
  APPLY_FAILED,
  APPLY_LABEL,
  APPLY_NOTE,
  APPLY_TITLE,
  CANCEL,
  DISMISS_FAILED,
  DISMISS_LABEL,
  NO_SUGGESTIONS,
  RAW_LABEL,
  type RoadmapView,
  STEP_DOCUMENT,
  SUGGESTION_BUSY,
  SUGGESTION_READ_ONLY,
  VIEWS,
  VIEW_LABEL,
  actionName,
  appliedSuggestions,
  appliedTag,
  applyDone,
  applyRunning,
  authorTitle,
  metaLine,
  milestoneHeading,
  openSuggestions,
  suggestionParts,
  suggestionsTitle,
  versionTag,
} from "./pipeline";
import { applyRoadmapSuggestion, dismissRoadmapSuggestion } from "./pipeline-actions";

/** What the rendered document is, to a reader who cannot see it. */
const RENDERED_LABEL = "ROADMAP.md, rendered";

/** What a checkbox says to a reader who cannot see it. */
const DONE = "Done";
const NOT_DONE = "Not done";

/** The skill a re-run runs — the progress line's chip. */
const RERUN_SKILL = "create-roadmap";

/** A re-run as the card shows it: in flight, or answered with the version it wrote. */
type Rerun =
  | { readonly state: "running"; readonly from: number }
  | { readonly state: "done"; readonly from: number; readonly to: number };

/** What the step takes. */
export interface PipelineDocumentProps {
  /** The card. */
  readonly roadmap: ResearchRoadmap;
  /** Whether the reader may apply and dismiss — an `owner` or an `admin`. */
  readonly mayAdminister: boolean;
  /** Called with the card as the service now reads it, after an apply or a dismissal. */
  readonly onChanged: (roadmap: ResearchRoadmap) => void;
}

/**
 * Step 1 of the pipeline card (CN.5, [#631](https://github.com/NobuData/ouroboros/issues/631)) —
 * the document `create-roadmap` generated, and the suggestion loop under it.
 *
 * **Rendered and Raw are both the document.** Rendered is how a person reviews it: the meta line
 * (path, commit, origin brief), milestone headings, and each item with its checkbox, issue
 * number, MVP flag and effort. Raw is the Markdown exactly as it is projected to the repository,
 * read-only. Either scrolls in its own wrapper.
 *
 * **Apply is a re-run, and looks like one.** Pressing **Apply ⟳** asks first; confirming shows
 * `create-roadmap` running against the current version, and when the service answers the line
 * reads `v1 → v2`, the version tag advances, the document re-renders from the new version and
 * the suggestion moves under *Applied*. Nothing is patched in place here — the card draws only
 * what the service returned. **Dismiss** removes the row; the service records it in the audit
 * log.
 *
 * @param props See {@link PipelineDocumentProps}.
 * @returns The step.
 */
export function PipelineDocument({ roadmap, mayAdminister, onChanged }: PipelineDocumentProps) {
  const [view, setView] = useState<RoadmapView>("rendered");
  const [confirming, setConfirming] = useState<RoadmapSuggestion | null>(null);
  const [rerun, setRerun] = useState<Rerun | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const noteId = useId();
  const open = openSuggestions(roadmap);
  const applied = appliedSuggestions(roadmap);
  const investigationId = roadmap.investigation.id;
  const reason = !mayAdminister ? SUGGESTION_READ_ONLY : pending ? SUGGESTION_BUSY : undefined;

  /**
   * Re-run `create-roadmap` with a suggestion.
   *
   * @param suggestion The suggestion the reader confirmed.
   */
  function apply(suggestion: RoadmapSuggestion): void {
    const from = roadmap.doc.version;

    setConfirming(null);
    setFailure(null);
    setRerun({ state: "running", from });

    startTransition(async () => {
      const outcome = await applyRoadmapSuggestion(investigationId, suggestion.id);

      if (!outcome.ok) {
        setRerun(null);
        setFailure(outcome.refusal.message.length === 0 ? APPLY_FAILED : outcome.refusal.message);
        return;
      }

      setRerun({ state: "done", from, to: outcome.roadmap.doc.version });
      onChanged(outcome.roadmap);
    });
  }

  /**
   * Dismiss a suggestion.
   *
   * @param suggestion The suggestion.
   */
  function dismiss(suggestion: RoadmapSuggestion): void {
    setFailure(null);

    startTransition(async () => {
      const outcome = await dismissRoadmapSuggestion(investigationId, suggestion.id);

      if (!outcome.ok) {
        setFailure(outcome.refusal.message.length === 0 ? DISMISS_FAILED : outcome.refusal.message);
        return;
      }

      onChanged(outcome.roadmap);
    });
  }

  return (
    <div aria-label={STEP_DOCUMENT} className="research__pipe-step" role="group">
      <div className="research__pipe-step-head">
        <h3 className="research__pipe-step-title">{STEP_DOCUMENT}</h3>
        <Tag title={roadmap.doc.generatedBy}>{versionTag(roadmap)}</Tag>
        <div aria-label={VIEW_LABEL} className="research__kinds" role="radiogroup">
          {VIEWS.map((option) => (
            <button
              aria-checked={view === option.id}
              className={cx("research__kind", view === option.id && "research__kind--sel")}
              key={option.id}
              onClick={() => setView(option.id)}
              role="radio"
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* A scroll container must be reachable without a pointer. */}
      {view === "rendered" ? (
        <div aria-label={RENDERED_LABEL} className="research__pipe-scroll research__md" role="group" tabIndex={0}>
          <p className="research__md-meta">{metaLine(roadmap)}</p>
          <h4 className="research__md-h1">{roadmap.doc.title}</h4>
          {roadmap.milestones.map((milestone) => (
            <Fragment key={milestone.key}>
              <h5 className="research__md-h2">{milestoneHeading(milestone)}</h5>
              <ul className="research__md-items">
                {milestone.items.map((item) => (
                  <li className="research__md-item" key={item.key}>
                    <span
                      aria-label={item.checked ? DONE : NOT_DONE}
                      className={cx("research__md-box", item.checked && "research__md-box--done")}
                      role="img"
                    >
                      {item.checked ? "[x]" : "[ ]"}
                    </span>
                    <span className="research__md-text">
                      {item.ticket !== null && <span className="research__md-num">{item.ticket.key} </span>}
                      {item.title}
                    </span>
                    {item.mvp && <span className="research__mvp">MVP</span>}
                    {item.effort !== null && <EffortChip effort={item.effort.toUpperCase() as Effort} />}
                  </li>
                ))}
              </ul>
            </Fragment>
          ))}
        </div>
      ) : (
        <pre aria-label={RAW_LABEL} className="research__pipe-scroll research__md research__md-raw" tabIndex={0}>
          {roadmap.markdown}
        </pre>
      )}

      {roadmap.projection.problem !== null && <p className="research__pipe-note">{roadmap.projection.problem}</p>}

      <div className="research__pipe-step-head research__pipe-step-head--sub">
        <h3 className="research__pipe-step-title">{suggestionsTitle(open.length)}</h3>
        <span className="research__pipe-hint">{APPLY_NOTE}</span>
      </div>

      <p className="research__pipe-progress" role="status">
        {rerun?.state === "running" && (
          <>
            <Chip dot="pulse" tone="accent">
              {RERUN_SKILL}
            </Chip>
            {applyRunning(rerun.from)}
          </>
        )}
        {rerun?.state === "done" && (
          <>
            <Chip tone="ok">{`✓ v${String(rerun.to)}`}</Chip>
            {applyDone(rerun.from, rerun.to)}
          </>
        )}
      </p>

      {failure !== null && (
        <p className="research__refusal" role="alert">
          {failure}
        </p>
      )}

      {open.length === 0 && <p className="research__pipe-note">{NO_SUGGESTIONS}</p>}

      {open.length > 0 && (
        <ul className="research__sugg-list">
          {open.map((suggestion) => (
            <li className="research__sugg" key={suggestion.id}>
              <SuggestionBody suggestion={suggestion} />
              <Button
                aria-label={actionName(APPLY_LABEL, suggestion)}
                onClick={() => setConfirming(suggestion)}
                reason={reason}
                size="sm"
                tone="ghost"
                type="button"
              >
                {APPLY_LABEL}
              </Button>
              <Button
                aria-label={actionName(DISMISS_LABEL, suggestion)}
                onClick={() => dismiss(suggestion)}
                reason={reason}
                size="sm"
                tone="ghost"
                type="button"
              >
                {DISMISS_LABEL}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {applied.length > 0 && (
        <ul aria-label={APPLIED_TITLE} className="research__sugg-list research__sugg-list--applied">
          {applied.map((suggestion) => (
            <li className="research__sugg" key={suggestion.id}>
              <SuggestionBody suggestion={suggestion} />
              <Tag>{appliedTag(suggestion)}</Tag>
            </li>
          ))}
        </ul>
      )}

      <ShellOverlay
        describedBy={noteId}
        label={APPLY_TITLE}
        onClose={() => setConfirming(null)}
        open={confirming !== null}
      >
        <div className="research__enable">
          <h2 className="shell-overlay__title">{APPLY_TITLE}</h2>
          <p className="research__enable-note" id={noteId}>
            {confirming !== null && <strong>{confirming.text}</strong>} {APPLY_CONFIRM_NOTE}
          </p>
          <div className="research__enable-actions">
            <Button onClick={() => setConfirming(null)} tone="ghost" type="button">
              {CANCEL}
            </Button>
            <Button
              onClick={() => {
                if (confirming !== null) apply(confirming);
              }}
              tone="primary"
              type="button"
            >
              {APPLY_CONFIRM}
            </Button>
          </div>
        </div>
      </ShellOverlay>
    </div>
  );
}

/**
 * Who suggested a change, and what — the author's chip and the text with its issue references
 * in the accent.
 *
 * @param props.suggestion The suggestion.
 * @returns The chip and the text.
 */
function SuggestionBody({ suggestion }: Readonly<{ suggestion: RoadmapSuggestion }>) {
  return (
    <>
      <span
        className={cx("research__sugg-who", suggestion.authorKind === "ai" && "research__sugg-who--ai")}
        title={authorTitle(suggestion)}
      >
        {suggestion.authorLabel}
      </span>
      <span className="research__sugg-text">
        {suggestionParts(suggestion.text).map((part, index) =>
          part.ref ? (
            // Positions are stable: a suggestion's text is never edited.
            <span className="research__sugg-ref" key={index}>
              {part.text}
            </span>
          ) : (
            part.text
          ),
        )}
      </span>
    </>
  );
}
