"use client";

import { useId, useState, useTransition } from "react";

import type { EnabledRepo } from "@/app/api/enablement";
import type { Fact } from "@/app/api/facts";
import type { Reading } from "@/app/api/reading";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, SelectField, TextAreaField, TextField } from "@/app/ui";

import { repoRef } from "./create";
import {
  ADD_ANCHOR,
  ADD_FACT_CANCEL,
  ADD_FACT_LABEL,
  ADD_FACT_NOTE,
  ADD_FACT_SUBMIT,
  ADD_FACT_TITLE,
  ANCHORS_HINT,
  ANCHORS_LABEL,
  ANCHOR_KINDS,
  ANCHOR_KIND_LABEL,
  ANCHOR_KIND_LABELS,
  ANCHOR_VALUE_EXAMPLES,
  ANCHOR_VALUE_LABEL,
  ANCHOR_VALUE_MAX,
  FACT_PROVENANCE_HINT,
  FACT_PROVENANCE_LABEL,
  FACT_PROVENANCE_MAX,
  FACT_REPO_LABEL,
  FACT_REPO_UNREAD_HINT,
  FACT_REPO_WORKSPACE,
  FACT_TEXT_HINT,
  FACT_TEXT_LABEL,
  FACT_TEXT_LONG,
  FACT_TEXT_MAX,
  type FactForm,
  PROPOSING,
  type ProposeFailure,
  REMOVE_ANCHOR,
  VIEWER_REASON,
  addAnchor,
  factFormProblems,
  factSubmitReason,
  openingFactForm,
  proposeBody,
  proposeFailure,
  proposedToast,
  removeAnchor,
  setAnchor,
} from "./facts";
import { proposeFact } from "./facts-actions";
import type { KnowledgeToast } from "./toast";

import "./knowledge.css";

/**
 * The facts card's **+ Add fact**, and the dialog behind it
 * (BG.3, [#419](https://github.com/NobuData/ouroboros/issues/419)).
 *
 * Manual authoring: the sentence, where it applies, an optional provenance line, and the
 * **anchor editor** — any number of path-glob, dependency or platform-version anchors, which are
 * why the fact can expire. It lands `proposed`, like every fact (decision K3): the dialog says
 * so before the reader presses anything, and the toast says so after.
 *
 * The service refuses an anchor it would not watch (`422 fact_anchor_invalid`) or one given
 * twice (`409 fact_anchor_exists`), naming the kind and the value; the dialog lands that under
 * the anchor it was about.
 *
 * Drawn inert with the reason for a viewer; the gate that enforces is the service's.
 */

/** What the action needs to be told. */
export interface AddFactProps {
  /** The enabled repositories, or why they could not be read — the *Applies to* choices. */
  readonly repos: Reading<readonly EnabledRepo[]>;
  /** Whether the reader may propose. */
  readonly mayDecide: boolean;
  /** Called with the new proposal and the toast to leave. */
  readonly onProposed: (fact: Fact, toast: KnowledgeToast) => void;
  /**
   * Whether the action stands on its own — in the empty card's state (#422), where it is the
   * one thing the state offers and so is drawn as a control in its own right — rather than as
   * the ghost beside a card head's count. Never the accent fill: the page has one primary
   * action, and it is the head's.
   */
  readonly standalone?: boolean;
}

/**
 * The action, and its dialog.
 *
 * @param props See {@link AddFactProps}.
 * @returns The button, with the dialog beside it while it is open.
 */
export function AddFact({ repos, mayDecide, onProposed, standalone = false }: AddFactProps) {
  const fields = useId();
  const choices = repos.ok ? repos.value : [];

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FactForm>(openingFactForm);
  const [failure, setFailure] = useState<ProposeFailure | null>(null);
  const [saving, startSaving] = useTransition();

  const problems = factFormProblems(form);
  const blocked = factSubmitReason(problems);

  /** Open on a fresh form. */
  function openDialog(): void {
    setForm(openingFactForm());
    setFailure(null);
    setOpen(true);
  }

  /**
   * Hold the form as the reader changes it, and clear a refusal that was about the old values.
   *
   * @param next The form.
   */
  function hold(next: FactForm): void {
    setForm(next);
    setFailure(null);
  }

  /**
   * Send the body.
   *
   * @param event The submit.
   */
  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (saving || blocked !== undefined) return;

    setFailure(null);

    startSaving(async () => {
      const outcome = await proposeFact(proposeBody(form));

      if (!outcome.ok) {
        setFailure(proposeFailure(outcome.refusal, form));
        return;
      }

      setOpen(false);
      onProposed(outcome.value, proposedToast(outcome.value));
    });
  }

  return (
    <>
      <Button onClick={openDialog} reason={mayDecide ? undefined : VIEWER_REASON} size="sm" tone={standalone ? "default" : "ghost"}>
        {ADD_FACT_LABEL}
      </Button>

      <ShellOverlay label={ADD_FACT_TITLE} onClose={() => { setOpen(false); }} open={open}>
        <h2 className="shell-overlay__title">{ADD_FACT_TITLE}</h2>
        <p className="shell-overlay__note">{ADD_FACT_NOTE}</p>

        <form className="knowledge-add-fact" onSubmit={submit}>
          <TextAreaField
            error={problems.text === "long" ? FACT_TEXT_LONG : undefined}
            hint={FACT_TEXT_HINT}
            id={`${fields}-text`}
            label={FACT_TEXT_LABEL}
            maxLength={FACT_TEXT_MAX + 1}
            name="text"
            onChange={(event) => { hold({ ...form, text: event.currentTarget.value }); }}
            required
            rows={3}
            value={form.text}
          />

          <SelectField
            hint={repos.ok ? undefined : FACT_REPO_UNREAD_HINT}
            id={`${fields}-repo`}
            label={FACT_REPO_LABEL}
            name="repoRef"
            onChange={(event) => { hold({ ...form, repoRef: event.currentTarget.value }); }}
            value={form.repoRef}
          >
            <option value="">{FACT_REPO_WORKSPACE}</option>
            {choices.map((repo) => (
              <option key={repo.id} value={repoRef(repo)}>
                {repoRef(repo)}
              </option>
            ))}
          </SelectField>

          <TextField
            autoComplete="off"
            hint={FACT_PROVENANCE_HINT}
            id={`${fields}-provenance`}
            label={FACT_PROVENANCE_LABEL}
            maxLength={FACT_PROVENANCE_MAX}
            name="provenanceLine"
            onChange={(event) => { hold({ ...form, provenanceLine: event.currentTarget.value }); }}
            value={form.provenanceLine}
          />

          <fieldset className="knowledge-add-fact__anchors">
            <legend className="knowledge-add-fact__legend">{ANCHORS_LABEL}</legend>
            <p className="knowledge-add-fact__hint">{ANCHORS_HINT}</p>
            {form.anchors.map((anchor, index) => (
              <div className="knowledge-add-fact__anchor" key={index}>
                <SelectField
                  id={`${fields}-anchor-${String(index)}-kind`}
                  label={ANCHOR_KIND_LABEL}
                  name={`anchors[${String(index)}].kind`}
                  onChange={(event) => {
                    hold(setAnchor(form, index, { ...anchor, kind: event.currentTarget.value as FactForm["anchors"][number]["kind"] }));
                  }}
                  value={anchor.kind}
                >
                  {ANCHOR_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {ANCHOR_KIND_LABELS[kind]}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  autoComplete="off"
                  error={failure?.anchorIndex === index ? failure.message : (problems.anchors[index] ?? undefined)}
                  id={`${fields}-anchor-${String(index)}-value`}
                  label={ANCHOR_VALUE_LABEL}
                  maxLength={ANCHOR_VALUE_MAX}
                  mono
                  name={`anchors[${String(index)}].value`}
                  onChange={(event) => { hold(setAnchor(form, index, { ...anchor, value: event.currentTarget.value })); }}
                  placeholder={ANCHOR_VALUE_EXAMPLES[anchor.kind]}
                  value={anchor.value}
                />
                <Button
                  aria-label={`${REMOVE_ANCHOR} anchor ${String(index + 1)}`}
                  className="knowledge-add-fact__remove"
                  onClick={() => { hold(removeAnchor(form, index)); }}
                  size="sm"
                  tone="ghost"
                  type="button"
                >
                  {REMOVE_ANCHOR}
                </Button>
              </div>
            ))}
            <Button onClick={() => { hold(addAnchor(form)); }} size="sm" tone="ghost" type="button">
              {ADD_ANCHOR}
            </Button>
          </fieldset>

          {failure !== null && failure.anchorIndex === null && (
            <p className="knowledge-create__failure" role="alert">
              {failure.message}
            </p>
          )}

          {saving && (
            <p className="knowledge-create__state" role="status">
              {PROPOSING}
            </p>
          )}

          <div className="knowledge-create__actions">
            <Button reason={saving ? PROPOSING : blocked} tone="primary" type="submit">
              {ADD_FACT_SUBMIT}
            </Button>
            <Button onClick={() => { setOpen(false); }} tone="ghost" type="button">
              {ADD_FACT_CANCEL}
            </Button>
          </div>
        </form>
      </ShellOverlay>
    </>
  );
}
