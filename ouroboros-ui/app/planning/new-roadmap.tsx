"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type { PlanningRoadmap } from "@/app/api/planning";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, TextField } from "@/app/ui";

import {
  CREATE_CANCEL,
  CREATE_NOTE,
  CREATE_SUBMIT,
  CREATE_TITLE,
  CREATING,
  type CreateFailure,
  END_MONTH_LABEL,
  EPIC_NAME_HINT,
  EPIC_NAME_LABEL,
  EXISTING_ROADMAP_NOTE,
  MAX_NAME_LENGTH,
  MAX_WINDOW_LENGTH,
  RANGE_HINT,
  ROADMAP_NAME_HINT,
  ROADMAP_NAME_LABEL,
  ROADMAP_WINDOW_HINT,
  ROADMAP_WINDOW_LABEL,
  type RoadmapDraft,
  START_MONTH_LABEL,
  createBody,
  createFailure,
  draftProblems,
  nameError,
  openingDraft,
  rangeError,
  submitReason,
} from "./create";
import { type CreateRoadmapOutcome, createRoadmap } from "./create-actions";
import { NEW_ROADMAP_LABEL, newRoadmapReason } from "./view";

import "./planning.css";

/**
 * Mockup 09's **New roadmap** head action, and the dialog behind it
 * (AM.1, [#283](https://github.com/NobuData/ouroboros/issues/283)).
 *
 * Creating a roadmap is naming it and creating its first epic — the only reading the schema allows,
 * since AK.3 stores the roadmap's name on its epics (`app/planning/create.ts` sets that out).
 * This dialog is the action's destination until AM.4's gantt editor
 * ([#286](https://github.com/NobuData/ouroboros/issues/286)) grows the same flow into lane editing.
 *
 * On success the dialog closes and the route is refreshed, so the roadmap region below re-reads
 * and is headed with the name that was just created.
 */

/** What the action needs to be told. */
export interface NewRoadmapProps {
  /**
   * Whether this reader may change the roadmap — `app/api/membership.ts`'s `mayAdminister`,
   * decided at the gate. `false` renders the control inert with the reason; the gate that
   * *enforces* is the service's.
   */
  readonly mayAdminister: boolean;
  /**
   * The roadmap the page read, or `null` when it could not be read. An existing head's name and
   * window are what the form opens on — see `openingDraft`.
   */
  readonly roadmap: PlanningRoadmap | null;
}

/**
 * The action, and its dialog.
 *
 * @param props See {@link NewRoadmapProps}.
 * @returns The primary button, with the dialog beside it while it is open.
 */
export function NewRoadmap({ mayAdminister, roadmap }: NewRoadmapProps) {
  const router = useRouter();
  const fields = useId();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RoadmapDraft>(() => openingDraft(roadmap));
  const [failure, setFailure] = useState<CreateFailure | null>(null);
  const [saving, startSaving] = useTransition();

  const problems = draftProblems(draft);
  const blocked = submitReason(problems);
  const existing = roadmap?.name != null;

  /** Open on a fresh form, so a dialog dismissed halfway and reopened starts clean. */
  function openDialog(): void {
    setDraft(openingDraft(roadmap));
    setFailure(null);
    setOpen(true);
  }

  /** Close without writing. */
  function close(): void {
    setOpen(false);
  }

  /**
   * Hold one box's value.
   *
   * @param key Which box.
   * @param value What is in it.
   */
  function type(key: keyof RoadmapDraft, value: string): void {
    setDraft((current) => ({ ...current, [key]: value }));
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
      const outcome: CreateRoadmapOutcome = await createRoadmap(createBody(draft));

      if (!outcome.ok) {
        setFailure(createFailure(outcome.refusal));
        return;
      }

      setOpen(false);
      // The roadmap region re-reads, and is headed with the name just stored.
      router.refresh();
    });
  }

  return (
    <>
      <Button onClick={openDialog} reason={newRoadmapReason(mayAdminister)} tone="primary">
        {NEW_ROADMAP_LABEL}
      </Button>

      <ShellOverlay label={CREATE_TITLE} onClose={close} open={open}>
        <h2 className="shell-overlay__title">{CREATE_TITLE}</h2>
        <p className="shell-overlay__note">{CREATE_NOTE}</p>
        {existing && <p className="shell-overlay__note">{EXISTING_ROADMAP_NOTE}</p>}

        <form className="planning-create" onSubmit={submit}>
          <TextField
            autoComplete="off"
            error={nameError(problems.roadmapName)}
            hint={ROADMAP_NAME_HINT}
            id={`${fields}-roadmap-name`}
            label={ROADMAP_NAME_LABEL}
            maxLength={MAX_NAME_LENGTH}
            name="roadmapName"
            onChange={(event) => { type("roadmapName", event.currentTarget.value); }}
            required
            value={draft.roadmapName}
          />

          <TextField
            autoComplete="off"
            hint={ROADMAP_WINDOW_HINT}
            id={`${fields}-roadmap-window`}
            label={ROADMAP_WINDOW_LABEL}
            maxLength={MAX_WINDOW_LENGTH}
            name="roadmapWindow"
            onChange={(event) => { type("roadmapWindow", event.currentTarget.value); }}
            value={draft.roadmapWindow}
          />

          <TextField
            autoComplete="off"
            error={nameError(problems.epicName)}
            hint={EPIC_NAME_HINT}
            id={`${fields}-epic-name`}
            label={EPIC_NAME_LABEL}
            maxLength={MAX_NAME_LENGTH}
            name="epicName"
            onChange={(event) => { type("epicName", event.currentTarget.value); }}
            required
            value={draft.epicName}
          />

          <div className="planning-create__months">
            <TextField
              hint={RANGE_HINT}
              id={`${fields}-start-month`}
              label={START_MONTH_LABEL}
              name="startMonth"
              onChange={(event) => { type("startMonth", event.currentTarget.value); }}
              type="month"
              value={draft.startMonth}
            />
            <TextField
              error={failure?.range ?? rangeError(problems.range)}
              id={`${fields}-end-month`}
              label={END_MONTH_LABEL}
              name="endMonth"
              onChange={(event) => { type("endMonth", event.currentTarget.value); }}
              type="month"
              value={draft.endMonth}
            />
          </div>

          {failure !== null && (
            <p className="planning-create__failure" role="alert">
              {failure.message}
            </p>
          )}

          {saving && (
            <p className="planning-create__state" role="status">
              {CREATING}
            </p>
          )}

          <div className="planning-create__actions">
            <Button reason={saving ? CREATING : blocked} tone="primary" type="submit">
              {CREATE_SUBMIT}
            </Button>
            <Button onClick={close} tone="ghost" type="button">
              {CREATE_CANCEL}
            </Button>
          </div>
        </form>
      </ShellOverlay>
    </>
  );
}
