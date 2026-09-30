"use client";

import { useId, useState, useTransition } from "react";

import type { RunSummary } from "@/app/api/dashboard";
import type { Playbook, PlaybookDraft } from "@/app/api/playbooks";
import type { Reading } from "@/app/api/reading";
import type { SkillList } from "@/app/api/skills";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, TextField, cx } from "@/app/ui";

import {
  CAPTURED_LEGEND,
  CHANGE_RUN,
  CREATE_ADMIN_REASON,
  CREATE_CANCEL,
  CREATE_SUBMIT,
  CREATING,
  DESCRIPTION_HINT,
  DESCRIPTION_LABEL,
  DESCRIPTION_LONG,
  DESCRIPTION_MAX,
  DRAFT_LOADING,
  LABELS_HINT,
  LABELS_LABEL,
  LABELS_MANY,
  NAME_HINT,
  NAME_LABEL,
  NAME_MAX,
  NEW_PLAYBOOK,
  NEW_PLAYBOOK_NOTE,
  NEW_PLAYBOOK_TITLE,
  NO_OVERRIDES,
  NO_RUNS,
  NO_STEERS,
  OVERRIDES_LABEL,
  PIN_LABEL,
  type PlaybookForm,
  RUNS_LEGEND,
  RUNS_LOADING,
  STEERS_LABEL,
  chooseRunName,
  createBody,
  createFailure,
  createReason,
  createdToast,
  derivedLine,
  draftFailure,
  nameError,
  openingPlaybookForm,
  overrideLines,
  pinLabel,
  playbookFormProblems,
  runConsolePath,
  runLine,
  runMeta,
  runsFailure,
} from "./playbooks";
import { createPlaybookFromRun, draftPlaybook, listRecentRuns } from "./playbooks-actions";
import type { KnowledgeToast } from "./toast";

import "./knowledge.css";

/**
 * **+ New playbook from a past run…** — the dashed tile, and the two-step dialog behind it
 * (BG.4, [#420](https://github.com/NobuData/ouroboros/issues/420)).
 *
 * The decisions are `app/knowledge/playbooks.ts`'s; what is here is state and wiring:
 *
 * 1. **A recent run that finished.** On open the dialog reads the terminal runs (`GET
 *    /api/v1/runs?status=terminal`), newest first, each linking to its console; choosing one
 *    reads what a playbook would capture from it (`GET …/from-run/{runId}`, writes nothing).
 * 2. **The preset editor.** What was captured is shown before anything is saved — the workflow
 *    pin, the skill overrides named by the slugs the page read, the steer notes, and where each
 *    came from — over the name, the description (the run's own suggested) and an optional label
 *    filter, checked before a round trip. **Save** makes one `POST …/from-run`; the new row is
 *    handed up with the toast.
 *
 * **Inert for anyone but an administrator**, with the reason: the tile keeps its place so the
 * card still says how playbooks are made. The gate that enforces is the service's.
 */

/** What the tile needs to be told. */
export interface NewPlaybookProps {
  /** The workspace's playbooks as drawn, or `null` when they could not be read — the name check's source. */
  readonly existing: readonly Playbook[] | null;
  /** The workspace's skills, or why not — what names an override's slug. */
  readonly skills: Reading<SkillList>;
  /** The instant the page was read, ISO 8601 — what a run's age is measured from. */
  readonly readAt: string;
  /** Whether this reader is an `owner` or an `admin`. */
  readonly mayAdminister: boolean;
  /** Called with the new playbook and the toast to leave. */
  readonly onCreated: (playbook: Playbook, toast: KnowledgeToast) => void;
  /** Whether the tile is the card's primary action — the empty state's — rather than its last row. */
  readonly primary?: boolean;
}

/** Where the dialog is. */
type Step =
  | { readonly kind: "runs"; readonly runs: readonly RunSummary[] | null; readonly failure: string | null }
  | { readonly kind: "drafting"; readonly run: RunSummary }
  | { readonly kind: "draft"; readonly run: RunSummary; readonly draft: PlaybookDraft };

/**
 * The tile, and its dialog.
 *
 * @param props See {@link NewPlaybookProps}.
 * @returns The tile, with the dialog beside it while it is open.
 */
export function NewPlaybook({ existing, skills, readAt, mayAdminister, onCreated, primary = false }: NewPlaybookProps) {
  const fields = useId();
  const now = new Date(readAt);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "runs", runs: null, failure: null });
  const [form, setForm] = useState<PlaybookForm>({ name: "", description: "", labels: "" });
  const [failure, setFailure] = useState<ReturnType<typeof createFailure> | null>(null);
  const [saving, startSaving] = useTransition();
  const [, startReading] = useTransition();

  /** Open on the run list, freshly read. */
  function openDialog(): void {
    setStep({ kind: "runs", runs: null, failure: null });
    setFailure(null);
    setOpen(true);

    startReading(async () => {
      const outcome = await listRecentRuns();

      setStep(
        outcome.ok
          ? { kind: "runs", runs: outcome.value.items, failure: null }
          : { kind: "runs", runs: [], failure: runsFailure(outcome.refusal) },
      );
    });
  }

  /** Close without writing. */
  function close(): void {
    setOpen(false);
  }

  /**
   * Choose a run: read its draft.
   *
   * @param run The run.
   */
  function choose(run: RunSummary): void {
    setStep({ kind: "drafting", run });
    setFailure(null);

    startReading(async () => {
      const outcome = await draftPlaybook(run.id);

      if (!outcome.ok) {
        setStep({ kind: "runs", runs: step.kind === "runs" ? step.runs : null, failure: draftFailure(outcome.refusal) });
        return;
      }

      setForm(openingPlaybookForm(outcome.value));
      setStep({ kind: "draft", run, draft: outcome.value });
    });
  }

  /**
   * Hold the form as the reader changes it, and clear a refusal that was about the old values.
   *
   * @param next The form.
   */
  function hold(next: PlaybookForm): void {
    setForm(next);
    setFailure(null);
  }

  const problems = playbookFormProblems(form, existing);
  const blocked = createReason(problems);

  /**
   * Send the body.
   *
   * @param event The submit.
   * @param draft The draft the form names.
   */
  function submit(event: React.FormEvent<HTMLFormElement>, draft: PlaybookDraft): void {
    event.preventDefault();

    if (saving || blocked !== undefined) return;

    setFailure(null);

    startSaving(async () => {
      const outcome = await createPlaybookFromRun(createBody(draft, form));

      if (!outcome.ok) {
        setFailure(createFailure(outcome.refusal));
        return;
      }

      setOpen(false);
      onCreated(outcome.value, createdToast(outcome.value));
    });
  }

  const skillRows = skills.ok ? skills.value.skills : null;

  return (
    <>
      <Button
        className={cx("knowledge-playbooks__tile", primary && "knowledge-playbooks__tile--primary")}
        onClick={openDialog}
        reason={mayAdminister ? undefined : CREATE_ADMIN_REASON}
        tone={primary ? "primary" : "ghost"}
      >
        {NEW_PLAYBOOK}
      </Button>

      <ShellOverlay label={NEW_PLAYBOOK_TITLE} onClose={close} open={open}>
        <h2 className="shell-overlay__title">{NEW_PLAYBOOK_TITLE}</h2>
        <p className="shell-overlay__note">{NEW_PLAYBOOK_NOTE}</p>

        {step.kind !== "draft" && (
          <section aria-labelledby={`${fields}-runs`} className="knowledge-new-playbook__runs">
            <h3 className="knowledge-new-playbook__legend" id={`${fields}-runs`}>
              {RUNS_LEGEND}
            </h3>

            {step.kind === "drafting" && (
              <p className="knowledge-new-playbook__state" role="status">
                {DRAFT_LOADING}
              </p>
            )}
            {step.kind === "runs" && step.failure !== null && (
              <p className="knowledge-new-playbook__failure" role="alert">
                {step.failure}
              </p>
            )}
            {step.kind === "runs" && step.runs === null && (
              <p className="knowledge-new-playbook__state" role="status">
                {RUNS_LOADING}
              </p>
            )}
            {step.kind === "runs" && step.runs !== null && step.runs.length === 0 && step.failure === null && (
              <p className="knowledge-new-playbook__state">{NO_RUNS}</p>
            )}
            {step.kind === "runs" && step.runs !== null && step.runs.length > 0 && (
              <ul className="knowledge-new-playbook__list">
                {step.runs.map((run) => (
                  <li className="knowledge-new-playbook__run" key={run.id}>
                    <div className="knowledge-new-playbook__run-body">
                      <p className="knowledge-new-playbook__run-line">
                        <a className="knowledge-new-playbook__run-link" href={runConsolePath(run)}>
                          {runLine(run)}
                        </a>
                      </p>
                      <p className="knowledge-new-playbook__run-meta">{runMeta(run, now)}</p>
                    </div>
                    <Button aria-label={chooseRunName(run)} onClick={() => { choose(run); }} size="sm" tone="ghost">
                      Use this run
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {step.kind === "draft" && (
          <form className="knowledge-new-playbook__form" onSubmit={(event) => { submit(event, step.draft); }}>
            <section aria-labelledby={`${fields}-captured`} className="knowledge-new-playbook__captured">
              <h3 className="knowledge-new-playbook__legend" id={`${fields}-captured`}>
                {CAPTURED_LEGEND}
              </h3>
              <p className="knowledge-new-playbook__derived">{derivedLine(step.draft)}</p>
              <dl className="knowledge-new-playbook__facts">
                <dt>{PIN_LABEL}</dt>
                <dd className="knowledge-new-playbook__mono">{pinLabel(step.draft.workflow)}</dd>
                <dt>{OVERRIDES_LABEL}</dt>
                <dd>
                  <Overrides draft={step.draft} skills={skillRows} />
                </dd>
                <dt>{STEERS_LABEL}</dt>
                <dd>
                  {step.draft.contextPreset.steerNotes.length === 0 ? (
                    NO_STEERS
                  ) : (
                    <ul className="knowledge-new-playbook__steers">
                      {step.draft.contextPreset.steerNotes.map((note, index) => (
                        <li key={index}>{note}</li>
                      ))}
                    </ul>
                  )}
                </dd>
              </dl>
              <Button onClick={openDialog} size="sm" tone="ghost" type="button">
                {CHANGE_RUN}
              </Button>
            </section>

            <TextField
              autoComplete="off"
              autoFocus
              error={failure?.field === "name" ? failure.message : nameError(problems.name === "missing" && form.name === "" ? undefined : problems.name)}
              hint={NAME_HINT}
              id={`${fields}-name`}
              label={NAME_LABEL}
              maxLength={NAME_MAX}
              name="name"
              onChange={(event) => { hold({ ...form, name: event.currentTarget.value }); }}
              required
              value={form.name}
            />

            <TextField
              autoComplete="off"
              error={problems.description === "long" ? DESCRIPTION_LONG : undefined}
              hint={DESCRIPTION_HINT}
              id={`${fields}-description`}
              label={DESCRIPTION_LABEL}
              maxLength={DESCRIPTION_MAX}
              name="description"
              onChange={(event) => { hold({ ...form, description: event.currentTarget.value }); }}
              value={form.description}
            />

            <TextField
              autoComplete="off"
              error={problems.labels === "many" ? LABELS_MANY : undefined}
              hint={LABELS_HINT}
              id={`${fields}-labels`}
              label={LABELS_LABEL}
              name="labels"
              onChange={(event) => { hold({ ...form, labels: event.currentTarget.value }); }}
              value={form.labels}
            />

            {failure !== null && failure.field === null && (
              <p className="knowledge-new-playbook__failure" role="alert">
                {failure.message}
              </p>
            )}

            {saving && (
              <p className="knowledge-new-playbook__state" role="status">
                {CREATING}
              </p>
            )}

            <div className="knowledge-new-playbook__actions">
              <Button reason={saving ? CREATING : blocked} tone="primary" type="submit">
                {CREATE_SUBMIT}
              </Button>
              <Button onClick={close} tone="ghost" type="button">
                {CREATE_CANCEL}
              </Button>
            </div>
          </form>
        )}

        {step.kind !== "draft" && (
          <div className="knowledge-new-playbook__actions">
            <Button onClick={close} tone="ghost" type="button">
              {CREATE_CANCEL}
            </Button>
          </div>
        )}
      </ShellOverlay>
    </>
  );
}

/**
 * The override delta, named.
 *
 * @param props.draft The draft.
 * @param props.skills The skills the page read, or `null`.
 * @returns The two lists, or the sentence that there is no delta.
 */
function Overrides({ draft, skills }: Readonly<{ draft: PlaybookDraft; skills: readonly SkillList["skills"][number][] | null }>) {
  const lines = overrideLines(draft, skills);

  if (lines.enable.length === 0 && lines.disable.length === 0) return <>{NO_OVERRIDES}</>;

  return (
    <ul className="knowledge-new-playbook__overrides">
      {lines.enable.map((slug) => (
        <li key={`enable-${slug}`}>
          <span className="knowledge-new-playbook__mono">+ {slug}</span> enabled
        </li>
      ))}
      {lines.disable.map((slug) => (
        <li key={`disable-${slug}`}>
          <span className="knowledge-new-playbook__mono">− {slug}</span> disabled
        </li>
      ))}
    </ul>
  );
}
