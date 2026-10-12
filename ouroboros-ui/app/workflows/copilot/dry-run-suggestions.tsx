"use client";

import { type KeyboardEvent, useEffect, useId, useState } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button, cx } from "@/app/ui";

import { parseInline } from "./conversation";
import type { TransportOutcome } from "./conversation-transport";
import {
  ADVISORY_REASON,
  APPLYING,
  APPLY_CANCEL,
  APPLY_CONFIRM,
  APPLY_LABEL,
  APPLY_OPERATIONS_HEADING,
  APPLY_TITLE,
  BUSY_REASON,
  type DryRunExplanation,
  type DryRunHistory,
  type DryRunSuggestion,
  EVIDENCE_HEADING,
  EXPLAINING,
  EXPLAIN_CLOSE,
  EXPLAIN_LABEL,
  EXPLAIN_TITLE,
  type Fact,
  IGNORE_LABEL,
  LLM_EXPLANATION,
  LLM_LABEL,
  NO_OPERATIONS,
  OPERATIONS_HEADING,
  type OperationPreview,
  RAW_OPERATION_LABEL,
  RERUN_LABEL,
  RERUN_OFFER,
  RULE_HEADING,
  RULE_UNDESCRIBED,
  type Refusal,
  SCORING_HEADING,
  SUGGESTION_CONFLICT,
  SUGGESTION_MARK,
  applyPreview,
  basisFacts,
  confidenceButtonName,
  confidenceText,
  factsOf,
  nextRevisionLine,
  ruleLine,
  sourceLine,
  suggestionRest,
} from "./dry-run";

import "../workflows.css";
import "./dry-run.css";

/**
 * The dry-run card's suggestion callouts and the two dialogs behind them (CE.4,
 * [#568](https://github.com/NobuData/ouroboros/issues/568)) — mockup 20's `.suggest`.
 *
 * The callout is the only accent glow on the page besides the primary buttons, and it modifies a
 * workflow — so each of its three ways of asking for trust shows its work first:
 *
 * - the **confidence** is a control that opens its scoring basis, the service's method and
 *   inputs as a definition list, in the flow of the callout so nothing clips it;
 * - **Apply to draft** opens {@link ApplyDialog}, which lists the typed operations it will run
 *   and the revision they make *before* anything is posted;
 * - **Explain** opens {@link ExplainDialog}: the rule, its version, what it computed and how the
 *   confidence was scored — the service's own data, never a paraphrase.
 *
 * A suggestion the model made is labelled as one and draws no percentage, because it was never
 * scored. An advisory suggestion's Apply is inert and says why, in the callout and not only as a
 * tooltip.
 */

/**
 * A line of the service's text with its inline `code` and **bold** runs — the conversation's
 * parser (`conversation.ts`' `parseInline`), drawn in this card's own classes.
 *
 * @param props.text The text.
 * @returns The runs.
 */
export function InlineText({ text }: Readonly<{ text: string }>) {
  return (
    <>
      {parseInline(text).map((run, at) =>
        run.kind === "code" ? (
          <code className="copilot-dry__code" key={at}>
            {run.text}
          </code>
        ) : run.kind === "bold" ? (
          <strong className="copilot-dry__strong" key={at}>
            {run.text}
          </strong>
        ) : (
          run.text
        ),
      )}
    </>
  );
}

/**
 * Terms and values, as the service keyed them.
 *
 * @param props.facts The facts.
 * @param props.label What the list is.
 * @returns The definition list.
 */
export function Facts({ facts, label }: Readonly<{ facts: readonly Fact[]; label?: string }>) {
  return (
    <dl aria-label={label} className="copilot-dry__facts">
      {facts.map((fact, at) => (
        <div className="copilot-dry__fact" key={`${at}-${fact.term}`}>
          <dt className="copilot-dry__term">{fact.term}</dt>
          <dd className="copilot-dry__value">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The typed operations an Apply runs: each in the conversation's quiet words, with its raw kind
 * and params behind a disclosure.
 *
 * @param props.operations The previews.
 * @returns The list.
 */
function Operations({ operations }: Readonly<{ operations: readonly OperationPreview[] }>) {
  return (
    <ol className="copilot-dry__ops">
      {operations.map((operation, at) => (
        <li className="copilot-dry__op" key={at}>
          <span className="copilot-dry__op-phrase">{operation.phrase}</span>
          <details className="copilot-dry__op-raw">
            <summary className="copilot-dry__op-summary">
              <span className="copilot-dry__op-kind">{operation.kind}</span> — {RAW_OPERATION_LABEL}
            </summary>
            <pre className="copilot-dry__op-params">{operation.params}</pre>
          </details>
        </li>
      ))}
    </ol>
  );
}

/** What a callout takes. */
export interface SuggestionCalloutProps {
  /** The suggestion — open. */
  readonly suggestion: DryRunSuggestion;
  /** Why Apply cannot act, or `undefined`. */
  readonly applyReason: string | undefined;
  /** Why Ignore cannot act, or `undefined`. */
  readonly ignoreReason: string | undefined;
  /** Open the Apply preview. */
  readonly onApply: () => void;
  /** Open the explanation. */
  readonly onExplain: () => void;
  /** Ignore it; resolves to the refusal to show, or `null` once it took. */
  readonly onIgnore: () => Promise<Refusal | null>;
}

/**
 * One callout: `✦`, the title and what follows it, the confidence that opens its basis — or the
 * model's label — and the three actions.
 *
 * @param props See {@link SuggestionCalloutProps}.
 * @returns The list item.
 */
export function SuggestionCallout({
  suggestion,
  applyReason,
  ignoreReason,
  onApply,
  onExplain,
  onIgnore,
}: SuggestionCalloutProps) {
  const ids = useId();
  const [basisOpen, setBasisOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const confidence = confidenceText(suggestion);
  const basisId = `${ids}-basis`;
  const toggleId = `${ids}-confidence`;
  const titleId = `${ids}-title`;

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>): void {
    if (event.key !== "Escape" || !basisOpen) return;

    event.stopPropagation();
    setBasisOpen(false);
    document.getElementById(toggleId)?.focus();
  }

  /** Ignore, once. */
  async function ignore(): Promise<void> {
    if (pending) return;

    setPending(true);
    setFailure(null);
    try {
      const refusal = await onIgnore();
      setFailure(refusal === null ? null : refusal.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <li aria-labelledby={titleId} className="copilot-dry__suggest" onKeyDown={onKeyDown}>
      <span aria-hidden="true" className="copilot-dry__spark">
        {SUGGESTION_MARK}
      </span>

      <div className="copilot-dry__suggest-main">
        <p className="copilot-dry__suggest-body">
          <strong className="copilot-dry__suggest-title" id={titleId}>
            {suggestion.title}
          </strong>
          {" — "}
          <InlineText text={suggestionRest(suggestion)} />{" "}
          {confidence === null ? (
            <span className="copilot-dry__llm">{LLM_LABEL}</span>
          ) : (
            <button
              aria-controls={basisId}
              aria-expanded={basisOpen}
              aria-label={confidenceButtonName(confidence)}
              className="copilot-dry__confidence"
              id={toggleId}
              onClick={() => setBasisOpen(!basisOpen)}
              type="button"
            >
              {confidence} <span aria-hidden="true">ⓘ</span>
            </button>
          )}
        </p>

        {confidence !== null && (
          <>
            <p className="copilot-dry__source">{sourceLine(suggestion)}</p>
            <div className="copilot-dry__basis" hidden={!basisOpen} id={basisId} role="note">
              {basisOpen && <Facts facts={basisFacts(suggestion.confidenceBasis)} label={SCORING_HEADING} />}
            </div>
          </>
        )}

        <div className="copilot-dry__suggest-actions">
          <Button onClick={onApply} reason={applyReason} size="sm" tone="primary">
            {APPLY_LABEL}
          </Button>
          <Button onClick={onExplain} size="sm" tone="ghost">
            {EXPLAIN_LABEL}
          </Button>
          <Button onClick={() => void ignore()} reason={pending ? BUSY_REASON : ignoreReason} size="sm" tone="ghost">
            {IGNORE_LABEL}
          </Button>
        </div>

        {!suggestion.applicable && <p className="copilot-dry__advice">{ADVISORY_REASON}</p>}
        {failure !== null && (
          <p className="copilot-dry__failure" role="alert">
            {failure}
          </p>
        )}
      </div>
    </li>
  );
}

/** What the Apply preview takes. */
export interface ApplyDialogProps {
  /** The suggestion being applied. */
  readonly suggestion: DryRunSuggestion;
  /** The draft as it stands — what the new revision is counted from. */
  readonly draft: DryRunHistory["draft"];
  /** Apply; resolves to the refusal to show, or `null` once it took. */
  readonly onConfirm: () => Promise<Refusal | null>;
  /** Do nothing — Cancel, Escape, or a press outside the dialog. */
  readonly onCancel: () => void;
  /** Re-run the dry run — what a conflict offers. `undefined` when the reader cannot. */
  readonly onRerun?: () => void;
}

/**
 * The preview **Apply to draft** shows before anything is posted: the typed operations, in the
 * order they run, and the revision they make.
 *
 * A refusal stays in the dialog, in the service's words. A draft that moved since the run
 * (`409 dry_run_suggestion_conflict`) changed nothing and is offered the one thing that helps:
 * **Re-run dry run**.
 *
 * Mounted only while open, so every opening starts with no stale refusal.
 *
 * @param props See {@link ApplyDialogProps}.
 * @returns The dialog.
 */
export function ApplyDialog({ suggestion, draft, onConfirm, onCancel, onRerun }: ApplyDialogProps) {
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const conflict = refusal?.code === SUGGESTION_CONFLICT;

  /** Apply, once. */
  async function confirm(): Promise<void> {
    if (pending) return;

    setPending(true);
    setRefusal(null);
    try {
      setRefusal(await onConfirm());
    } finally {
      setPending(false);
    }
  }

  return (
    <ShellOverlay label={APPLY_TITLE} onClose={onCancel} open wide>
      <h2 className="shell-overlay__title">{APPLY_TITLE}</h2>
      <p className="shell-overlay__note">
        <strong className="copilot-dry__strong">{suggestion.title}</strong>
        {" — "}
        <InlineText text={suggestionRest(suggestion)} />
      </p>

      <h3 className="copilot-dry__dialog-heading">{APPLY_OPERATIONS_HEADING}</h3>
      <Operations operations={applyPreview(suggestion.proposedOps)} />
      <p className="copilot-dry__revision">{nextRevisionLine(draft)}</p>

      {refusal !== null && (
        <div className="copilot-dry__dialog-refusal" role="alert">
          <p className="copilot-dry__dialog-refusal-text">{refusal.message}</p>
          {conflict && <p className="copilot-dry__dialog-refusal-text">{RERUN_OFFER}</p>}
        </div>
      )}
      {pending && (
        <p className="studio-dialog__state" role="status">
          {APPLYING}
        </p>
      )}

      <div className="studio-confirm__actions">
        {conflict && onRerun !== undefined ? (
          <Button onClick={onRerun} tone="primary" type="button">
            {RERUN_LABEL}
          </Button>
        ) : (
          <Button onClick={() => void confirm()} reason={pending ? APPLYING : undefined} tone="primary" type="button">
            {APPLY_CONFIRM}
          </Button>
        )}
        <Button onClick={onCancel} tone="ghost" type="button">
          {APPLY_CANCEL}
        </Button>
      </div>
    </ShellOverlay>
  );
}

/** What the explanation takes. */
export interface ExplainDialogProps {
  /** The suggestion being explained. */
  readonly suggestion: DryRunSuggestion;
  /** Read the explanation. Stable for the dialog's life. */
  readonly load: () => Promise<TransportOutcome<DryRunExplanation>>;
  /** Close — the button, Escape, or a press outside the dialog. */
  readonly onClose: () => void;
}

/**
 * **Explain**: how a suggestion was derived, as the service computed it.
 *
 * For a rule: its id, version and pack version, when it fires and what it proposes, how each
 * factor of the confidence is chosen, the evidence it computed — the service's keys and values as
 * a definition list — the scoring basis, and the operations. For a suggestion the model made:
 * that it came from the model and is unscored, said plainly, with its basis.
 *
 * Mounted only while open; the read starts when it mounts.
 *
 * @param props See {@link ExplainDialogProps}.
 * @returns The dialog.
 */
export function ExplainDialog({ suggestion, load, onClose }: ExplainDialogProps) {
  const [outcome, setOutcome] = useState<TransportOutcome<DryRunExplanation> | null>(null);

  useEffect(() => {
    let current = true;

    void load().then((answer) => {
      if (current) setOutcome(answer);
    });

    return () => {
      current = false;
    };
  }, [load]);

  const explanation = outcome !== null && outcome.ok ? outcome.value : null;

  return (
    <ShellOverlay label={EXPLAIN_TITLE} onClose={onClose} open wide>
      <h2 className="shell-overlay__title">{EXPLAIN_TITLE}</h2>
      <p className="shell-overlay__note">{suggestion.title}</p>

      {outcome === null && (
        <p className="studio-dialog__state" role="status">
          {EXPLAINING}
        </p>
      )}
      {outcome !== null && !outcome.ok && (
        <p className="studio-dialog__failure" role="alert">
          {outcome.refusal.message}
        </p>
      )}

      {explanation !== null && (
        <div className="copilot-dry__explain">
          <h3 className="copilot-dry__dialog-heading">{RULE_HEADING}</h3>
          {explanation.rule === null ? (
            <p className={cx("copilot-dry__explain-text", "copilot-dry__explain-text--model")}>{LLM_EXPLANATION}</p>
          ) : (
            <>
              <p className="copilot-dry__rule">{ruleLine(explanation.rule)}</p>
              {explanation.rule.firesWhen === null && explanation.rule.proposes === null ? (
                <p className="copilot-dry__explain-text">{RULE_UNDESCRIBED}</p>
              ) : (
                <Facts
                  facts={[
                    ...(explanation.rule.firesWhen === null ? [] : [{ term: "fires when", value: explanation.rule.firesWhen }]),
                    ...(explanation.rule.proposes === null ? [] : [{ term: "proposes", value: explanation.rule.proposes }]),
                  ]}
                />
              )}
            </>
          )}

          <h3 className="copilot-dry__dialog-heading">{EVIDENCE_HEADING}</h3>
          <Facts facts={factsOf(explanation.evidence)} label={EVIDENCE_HEADING} />

          <h3 className="copilot-dry__dialog-heading">{SCORING_HEADING}</h3>
          {explanation.rule?.scoring != null && (
            <Facts
              facts={[
                { term: "strength", value: explanation.rule.scoring.strength },
                { term: "adequacy", value: explanation.rule.scoring.adequacy },
              ]}
            />
          )}
          <Facts facts={basisFacts(explanation.confidenceBasis)} label={SCORING_HEADING} />

          <h3 className="copilot-dry__dialog-heading">{OPERATIONS_HEADING}</h3>
          {explanation.proposedOps.length === 0 ? (
            <p className="copilot-dry__explain-text">{NO_OPERATIONS}</p>
          ) : (
            <Operations operations={applyPreview(explanation.proposedOps)} />
          )}
        </div>
      )}

      <div className="studio-confirm__actions">
        <Button onClick={onClose} tone="ghost" type="button">
          {EXPLAIN_CLOSE}
        </Button>
      </div>
    </ShellOverlay>
  );
}
