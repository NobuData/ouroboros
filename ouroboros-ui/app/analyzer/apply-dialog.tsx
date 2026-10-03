"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { AnalysisSuggestion, SuggestionPreview } from "@/app/api/analyzer";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Eyebrow } from "@/app/ui";

import { applySuggestion, previewSuggestion } from "./analyzer-actions";
import { useAnalyzer } from "./analyzer-store";
import {
  ALREADY_RESOLVED,
  APPLY_ROLE_REASON,
  CANNOT_APPLY,
  GO_GLYPH,
  LANDS_LABEL,
  MEASURE_NOTE,
  NO_DELTA,
  PREVIEW_EYEBROW,
  PREVIEW_LOADING,
  PUBLISH_HUMAN_NOTE,
  STALE_NOTE,
  confirmLabels,
  deltaGroups,
  previewFacts,
} from "./suggestions-view";

/** Where the dialog is: reading the preview, showing it, or told the suggestion is gone. */
type Stage =
  | { readonly phase: "loading" }
  | { readonly phase: "failed"; readonly reason: string }
  | {
      readonly phase: "ready";
      readonly preview: SuggestionPreview;
      /** Whether this preview replaced one that had moved under the reader. */
      readonly moved: boolean;
      /** Why the last confirm was refused, or `null`. */
      readonly refusal: string | null;
    }
  | { readonly phase: "resolved"; readonly reason: string };

/**
 * The consequence preview behind **Apply** and **Draft as vN →** (BW.3,
 * [#518](https://github.com/NobuData/ouroboros/issues/518)) — the most consequential control on
 * the page, so nothing is applied from the row: the press opens this, which reads what the apply
 * would do and says it **specifically** — *forge-02 joins pool-a between 14:00–16:00 UTC on
 * weekdays* is something a reader can recognise as wrong.
 *
 * ```
 * open ─▶ read preview ─▶ summary · where it lands · the binding's own facts
 *                         └─ confirm (owner/admin) ─▶ apply(fingerprint)
 *                              ├─ applied ─▶ the row resolves; a workflow draft opens the studio
 *                              ├─ stale ───▶ the preview is read again and says it moved
 *                              ├─ resolved ▶ somebody got there first; nothing applied
 *                              └─ refused ─▶ the service's reason, the preview still open
 * ```
 *
 * The preview is rendered from the payload Apply executes, and the confirm sends that preview's
 * **fingerprint**, so what was read is what runs or nothing does. A change no plane can take yet
 * (the test-gate split) is described with the reason and offers no confirm; a member reads the
 * same preview with the confirm inert and why.
 *
 * @param props.suggestion The suggestion whose primary control was pressed, or `null`.
 * @param props.onClose Called when the reader dismisses the dialog.
 * @param props.onResolved Called with the suggestion's id once it has been applied.
 * @returns The dialog while a suggestion is given; nothing otherwise.
 */
export function ApplyDialog({
  suggestion,
  onClose,
  onResolved,
}: Readonly<{
  suggestion: AnalysisSuggestion | null;
  onClose: () => void;
  onResolved: (id: string) => void;
}>) {
  const label = suggestion === null ? PREVIEW_EYEBROW : `${PREVIEW_EYEBROW} · ${suggestion.title}`;

  return (
    <ShellOverlay label={label} onClose={onClose} open={suggestion !== null}>
      {suggestion !== null && (
        <ApplyPreview
          key={suggestion.id}
          onClose={onClose}
          onResolved={onResolved}
          suggestion={suggestion}
        />
      )}
    </ShellOverlay>
  );
}

/**
 * The dialog's content, for one suggestion.
 *
 * @param props.suggestion The suggestion.
 * @param props.onClose Called to close the dialog.
 * @param props.onResolved Called once the suggestion has been applied.
 * @returns The preview, in whichever stage it is.
 */
function ApplyPreview({
  suggestion,
  onClose,
  onResolved,
}: Readonly<{ suggestion: AnalysisSuggestion; onClose: () => void; onResolved: (id: string) => void }>) {
  const { mayAdminister, resolveLocally, refresh } = useAnalyzer();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ phase: "loading" });
  const [applying, setApplying] = useState(false);
  const { id } = suggestion;

  /**
   * Read the preview.
   *
   * @param moved Whether this read replaces a preview that moved under the reader.
   * @param live Whether the dialog is still open on this suggestion.
   */
  const read = useCallback(
    (moved: boolean, live: () => boolean = () => true) => {
      void previewSuggestion(id).then((answer) => {
        if (!live()) return;

        setStage(
          answer.ok
            ? { phase: "ready", preview: answer.preview, moved, refusal: null }
            : { phase: "failed", reason: answer.reason },
        );
      });
    },
    [id],
  );

  useEffect(() => {
    let open = true;
    read(false, () => open);

    return () => {
      open = false;
    };
  }, [read]);

  /**
   * Apply exactly the preview on screen.
   *
   * @param preview The preview that was read.
   */
  function confirm(preview: SuggestionPreview): void {
    if (applying || !mayAdminister) return;

    setApplying(true);
    void applySuggestion(id, preview.fingerprint).then((outcome) => {
      setApplying(false);

      switch (outcome.kind) {
        case "applied": {
          resolveLocally(id, {
            status: "applied",
            at: outcome.applied.suggestion.resolvedAt,
            reason: null,
            draftBatchId: null,
            windowDays: outcome.applied.measurement.windowDays,
          });
          onResolved(id);

          const studio = outcome.applied.preview.studioPath;
          if (studio !== null) router.push(studio);
          return;
        }
        case "stale":
          setStage({ phase: "loading" });
          read(true);
          return;
        case "resolved":
          refresh();
          setStage({ phase: "resolved", reason: outcome.reason });
          return;
        case "refused":
          setStage({ phase: "ready", preview, moved: false, refusal: outcome.reason });
      }
    });
  }

  return (
    <div className="analyzer-apply">
      <div>
        <Eyebrow>{PREVIEW_EYEBROW}</Eyebrow>
        <h2 className="shell-overlay__title">{suggestion.title}</h2>
      </div>

      {stage.phase === "loading" && (
        <p className="analyzer-apply__note" role="status">
          {PREVIEW_LOADING}
        </p>
      )}

      {stage.phase === "failed" && (
        <>
          <p className="analyzer-apply__error" role="alert">
            {stage.reason}
          </p>
          <div className="analyzer-apply__actions">
            <Button onClick={onClose} tone="ghost">
              Close
            </Button>
            <Button
              onClick={() => {
                setStage({ phase: "loading" });
                read(false);
              }}
            >
              Read it again
            </Button>
          </div>
        </>
      )}

      {stage.phase === "resolved" && (
        <>
          <p className="analyzer-apply__error" role="alert">
            {ALREADY_RESOLVED} {stage.reason}
          </p>
          <div className="analyzer-apply__actions">
            <Button onClick={onClose}>Close</Button>
          </div>
        </>
      )}

      {stage.phase === "ready" && (
        <Consequences
          applying={applying}
          mayAdminister={mayAdminister}
          moved={stage.moved}
          onClose={onClose}
          onConfirm={() => confirm(stage.preview)}
          preview={stage.preview}
          refusal={stage.refusal}
        />
      )}
    </div>
  );
}

/**
 * A read preview: what would change, where it lands, the binding's own facts, and the confirm.
 *
 * @param props.preview The preview.
 * @param props.moved Whether it replaced one that moved under the reader.
 * @param props.refusal Why the last confirm was refused, or `null`.
 * @param props.applying Whether a confirm is on its way.
 * @param props.mayAdminister Whether this person may apply.
 * @param props.onConfirm Called to apply this preview.
 * @param props.onClose Called to close the dialog.
 * @returns The preview's body and its controls.
 */
function Consequences({
  preview,
  moved,
  refusal,
  applying,
  mayAdminister,
  onConfirm,
  onClose,
}: Readonly<{
  preview: SuggestionPreview;
  moved: boolean;
  refusal: string | null;
  applying: boolean;
  mayAdminister: boolean;
  onConfirm: () => void;
  onClose: () => void;
}>) {
  const facts = previewFacts(preview);
  const groups = deltaGroups(preview.delta);
  const confirm = confirmLabels(preview);

  return (
    <>
      {moved && (
        <p className="analyzer-apply__moved" role="status">
          {STALE_NOTE}
        </p>
      )}
      <p className="analyzer-apply__summary">{preview.summary}</p>

      <dl className="analyzer-apply__facts">
        <div className="analyzer-apply__fact">
          <dt className="analyzer-apply__label">{LANDS_LABEL}</dt>
          <dd className="analyzer-apply__value">{preview.lands}</dd>
        </div>
        {facts.map((fact) => (
          <div className="analyzer-apply__fact" key={fact.label}>
            <dt className="analyzer-apply__label">{fact.label}</dt>
            <dd className={fact.mono ? "analyzer-apply__value analyzer-apply__value--mono" : "analyzer-apply__value"}>
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>

      {preview.delta !== null &&
        (groups.length === 0 ? (
          <p className="analyzer-apply__note">{NO_DELTA}</p>
        ) : (
          groups.map((group) => (
            <section aria-label={group.heading} key={group.heading}>
              <h3 className="analyzer-apply__label">{group.heading}</h3>
              <ul className="analyzer-apply__delta">
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))
        ))}

      {preview.appliable ? (
        <p className="analyzer-apply__note">{preview.plane === "workflow" ? PUBLISH_HUMAN_NOTE : MEASURE_NOTE}</p>
      ) : (
        <div className="analyzer-apply__blocked" role="note">
          <h3 className="analyzer-apply__label">{CANNOT_APPLY}</h3>
          <p className="analyzer-apply__reason">{preview.reason}</p>
        </div>
      )}

      {refusal !== null && (
        <p className="analyzer-apply__error" role="alert">
          {refusal}
        </p>
      )}

      <div className="analyzer-apply__actions">
        <Button onClick={onClose} tone="ghost">
          {preview.appliable ? "Cancel" : "Close"}
        </Button>
        {preview.appliable && (
          <Button
            onClick={onConfirm}
            reason={!mayAdminister ? APPLY_ROLE_REASON : applying ? confirm.busy : undefined}
            tone="primary"
          >
            {applying ? confirm.busy : confirm.label}
            {confirm.leads && !applying && (
              <>
                {" "}
                <span aria-hidden="true">{GO_GLYPH}</span>
              </>
            )}
          </Button>
        )}
      </div>
    </>
  );
}
