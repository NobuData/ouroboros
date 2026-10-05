"use client";

import { type FormEvent, useId, useState } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Tag, TextField, cx } from "@/app/ui";

import {
  CLASS_MEANINGS,
  CLASS_VERBS,
  type ChangeClass,
  KEEP_EDITING,
  NOTE_HINT,
  NOTE_LABEL,
  NOTE_MAX_LENGTH,
  OWNER_GATE_TITLE,
  type PolicyPreview,
  type RuleChange,
  confirmTitle,
  ownerGate,
  publishLabel,
  ruleLabel,
} from "./card-view";

import "./policy-card.css";

/**
 * The publish confirmation, and the owner gate
 * (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)).
 *
 * A save of the Autonomy policies card stops here before anything is published. The dialog
 * lists every rule the edit changes with **which way it moves autonomy** — tightens, loosens or
 * neither — in the service's own classification (BQ.2's `POST /api/v1/policies/preview`), so a
 * reader agreeing to let more merge unattended has read that this is what they are agreeing to.
 *
 * It has two forms, decided by the preview's `mayPublish`:
 *
 * - **A reader who may publish** gets the list, an optional change note for the history, and
 *   one button that publishes — drawn as the dangerous one when anything loosens.
 * - **An admin whose edit loosens a rule** gets no publish button at all, and is told why: which
 *   rules loosen, that publishing a loosening is an owner's decision, who the owners are, and
 *   what they can still do alone. An explanation with a way forward, not a control that fails.
 *
 * The dialog decides nothing and sends nothing: it reports the reader's choice to
 * `onDecide`, and the card does the rest.
 */

/** What the reader chose. */
export type PublishDecision =
  /** Publish, with this note (`null` for none). */
  | { readonly kind: "publish"; readonly note: string | null }
  /** Go back to the card with the edits unsaved. */
  | { readonly kind: "keep-editing" };

/** What the dialog takes. */
export interface PublishDialogProps {
  /** What publishing would do — or `null` while there is nothing to confirm. */
  readonly preview: PolicyPreview | null;
  /** The workspace's owners, by name, for the owner gate. */
  readonly owners: readonly string[];
  /** Called once with the reader's choice. Escape and a press outside are **Keep editing**. */
  readonly onDecide: (decision: PublishDecision) => void;
}

/** The classes a preview's changes carry, in the order the dialog explains them. */
const CLASS_ORDER: readonly ChangeClass[] = ["loosening", "tightening", "neutral"];

/**
 * The dialog.
 *
 * @param props See {@link PublishDialogProps}.
 * @returns The confirmation or the owner gate while there is a preview; nothing otherwise.
 */
export function PublishDialog({ preview, owners, onDecide }: PublishDialogProps) {
  const described = useId();
  const noteId = useId();
  const [note, setNote] = useState("");

  /** Report the choice, leaving no note behind for the next opening. */
  function decide(decision: PublishDecision): void {
    setNote("");
    onDecide(decision);
  }

  /**
   * Publish — the form's submission.
   *
   * @param event The submission.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (preview === null || !preview.mayPublish) return;

    const trimmed = note.trim();
    decide({ kind: "publish", note: trimmed === "" ? null : trimmed });
  }

  const gated = preview !== null && !preview.mayPublish;
  const title =
    preview === null ? "" : gated ? OWNER_GATE_TITLE : confirmTitle(preview.baseVersion);

  return (
    <ShellOverlay
      describedBy={described}
      label={title}
      onClose={() => {
        decide({ kind: "keep-editing" });
      }}
      open={preview !== null}
      role="alertdialog"
    >
      {preview !== null && (
        <form className="policy-publish" noValidate onSubmit={submit}>
          <h2 className="shell-overlay__title">{title}</h2>

          <div className="policy-publish__body" id={described}>
            {gated && <OwnerGateNote owners={owners} preview={preview} />}

            <ul className="policy-publish__changes">
              {preview.changes.map((change) => (
                <ChangeRow change={change} key={change.ruleId} />
              ))}
            </ul>

            {CLASS_ORDER.filter((kind) =>
              preview.changes.some((change) => change.classification === kind),
            ).map((kind) => (
              <p className="policy-publish__meaning" key={kind}>
                {CLASS_MEANINGS[kind]}
              </p>
            ))}
          </div>

          {!gated && (
            <TextField
              hint={NOTE_HINT}
              id={noteId}
              label={NOTE_LABEL}
              maxLength={NOTE_MAX_LENGTH}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              value={note}
            />
          )}

          <div className="policy-publish__actions">
            {!gated && (
              <Button
                tone={preview.classification === "loosening" ? "danger" : "primary"}
                type="submit"
              >
                {publishLabel(preview.baseVersion)}
              </Button>
            )}
            <Button
              onClick={() => {
                decide({ kind: "keep-editing" });
              }}
              tone={gated ? "default" : "ghost"}
              type="button"
            >
              {KEEP_EDITING}
            </Button>
          </div>
        </form>
      )}
    </ShellOverlay>
  );
}

/**
 * One changed rule: which way it moves, in a word, then the rule and what happened to it.
 *
 * @param props.change The change.
 * @returns The row.
 */
function ChangeRow({ change }: Readonly<{ change: RuleChange }>) {
  return (
    <li
      className={cx(
        "policy-publish__change",
        change.classification === "loosening" && "policy-publish__change--loosens",
      )}
    >
      <Tag className="policy-publish__class">{CLASS_VERBS[change.classification]}</Tag>
      <span className="policy-publish__rule">{ruleLabel(change.ruleId)}</span>
      <span className="policy-publish__summary">{change.summary}</span>
    </li>
  );
}

/**
 * Why this reader cannot publish, and what to do about it.
 *
 * @param props.preview The preview that named the loosening.
 * @param props.owners The workspace's owners, by name.
 * @returns The explanation.
 */
function OwnerGateNote({
  preview,
  owners,
}: Readonly<{ preview: PolicyPreview; owners: readonly string[] }>) {
  const gate = ownerGate(preview, owners);

  return (
    <div className="policy-publish__gate">
      <p className="policy-publish__gate-head">{gate.head}</p>
      <p className="policy-publish__gate-line">{gate.why}</p>
      <p className="policy-publish__gate-line">{gate.ask}</p>
      <p className="policy-publish__gate-line">{gate.alone}</p>
    </div>
  );
}
