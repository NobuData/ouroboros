"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { workflowPath } from "@/app/paths";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, TextField } from "@/app/ui";

import { type CreateOutcome, createWorkflow } from "./create-actions";
import {
  CREATE_CANCEL,
  CREATE_NOTE,
  CREATE_SUBMIT,
  CREATE_TITLE,
  CREATING,
  type CreateFailure,
  MAX_NAME_LENGTH,
  MAX_SLUG_LENGTH,
  NAME_HINT,
  NAME_LABEL,
  SLUG_HINT,
  SLUG_LABEL,
  createBody,
  createFailure,
  deriveSlug,
  nameError,
  nameProblem,
  slugError,
  slugProblem,
  submitReason,
} from "./create";
import { NEW_WORKFLOW_LABEL, newWorkflowReason } from "./view";

import "./workflows.css";

/**
 * Mockup 04's dashed **+ New workflow** tile, and the dialog behind it
 * (S.1, [#147](https://github.com/NobuData/ouroboros/issues/147)).
 *
 * The mockup draws the tile as a link back to itself and stops there. What the ticket asks for
 * is *a create dialog (slug + name)*, and what the contract makes of that is one `POST`: a
 * workflow and its blank draft in one transaction, published nothing, the canvas to open on
 * `draft.definition` — which is the state **Publish v1** (S.6) turns into a version.
 *
 * ### The slug follows the name until the reader takes it
 *
 * Two boxes, one of them derived. As the name is typed the slug box shows what the service
 * would derive from it (`create.ts`'s `deriveSlug`, the service's own rule restated), so the
 * ordinary case is one box to fill in and a second to glance at. The moment the reader edits
 * the slug it is theirs and stops following; emptying it hands it back. That is the whole of
 * the dialog's state beyond the two values, and it is why the slug is sent explicitly rather
 * than left for the service to derive — the reader was shown it.
 *
 * ### The slug is checked as it is typed, and the service still decides
 *
 * `slugProblem` compares against the rail the page already read, so the ordinary collision is
 * caught with no round trip; `workflow_slug_taken` is what actually decides, and
 * `createFailure` puts it under the same box. A reader never learns about a taken slug from
 * anywhere but the slug field.
 *
 * ### On success the workflow is on the rail, selected
 *
 * The dialog closes and the route is navigated to `/workflows/<slug>` — `app/paths.ts`'s
 * `workflowPath` — so the server re-reads the rail, the new entry is on it, and the head is
 * already open on it. The refresh after the navigation is for the one case the navigation is
 * a no-op: a reader who linked to `/workflows/hotfix-p1` before `hotfix-p1` existed and then
 * created it.
 */

/** What the tile needs to be told. */
export interface NewWorkflowProps {
  /**
   * Whether this reader's role may create workflows — `app/api/membership.ts`'s
   * `mayAdminister`, decided at the gate. `false` renders the tile inert with the reason and
   * the dialog can never open; the gate that *enforces* is the service's
   * (`create-actions.ts`).
   */
  readonly mayAdminister: boolean;
  /** Every slug this workspace has, as the rail read them, for the live uniqueness check. */
  readonly slugs: readonly string[];
}

/**
 * The tile, and its dialog.
 *
 * @param props See {@link NewWorkflowProps}.
 * @returns The tile, with the dialog beside it while it is open.
 */
export function NewWorkflow({ mayAdminister, slugs }: NewWorkflowProps) {
  const router = useRouter();
  const fields = useId();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  /** Whether the slug box still shows what the name derives to, or what the reader typed. */
  const [slugFollows, setSlugFollows] = useState(true);
  const [failure, setFailure] = useState<CreateFailure | null>(null);

  const [saving, startSaving] = useTransition();

  const nameIssue = nameProblem(name);
  const slugIssue = slugProblem(slug, slugs);
  const blocked = submitReason(nameIssue, slugIssue);

  /** Open the dialog on an empty form. Everything is reset here rather than on close, so a
   * dialog dismissed halfway and reopened starts clean. */
  function openDialog(): void {
    setOpen(true);
    setName("");
    setSlug("");
    setSlugFollows(true);
    setFailure(null);
  }

  /** Close without writing. Nothing is refreshed: nothing happened. */
  function close(): void {
    setOpen(false);
  }

  /**
   * Hold a name, and move the slug with it while the slug is still following.
   *
   * @param value What is in the name box.
   */
  function typeName(value: string): void {
    setName(value);
    if (slugFollows) setSlug(deriveSlug(value));
    setFailure(null);
  }

  /**
   * Hold a slug the reader chose. An emptied box follows the name again — the way back to
   * the derived value is to clear it, not to retype it.
   *
   * @param value What is in the slug box.
   */
  function typeSlug(value: string): void {
    setSlug(value);
    setSlugFollows(value === "");
    if (value === "") setSlug(deriveSlug(name));
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
      const outcome: CreateOutcome = await createWorkflow(createBody({ name, slug }));

      if (!outcome.ok) {
        setFailure(createFailure(outcome.refusal));
        return;
      }

      setOpen(false);

      // The new workflow, on the rail behind the dialog, selected. The navigation is what
      // re-reads the rail — a different slug is a different URL and cannot be answered from
      // the router's cache — and the refresh after it is for the one case the navigation is a
      // no-op.
      router.push(workflowPath(outcome.slug));
      router.refresh();
    });
  }

  return (
    <>
      <Button
        className="studio-rail__new"
        onClick={openDialog}
        reason={newWorkflowReason(mayAdminister)}
        tone="ghost"
        type="button"
      >
        {NEW_WORKFLOW_LABEL}
      </Button>

      <ShellOverlay label={CREATE_TITLE} onClose={close} open={open}>
        <h2 className="shell-overlay__title">{CREATE_TITLE}</h2>
        <p className="shell-overlay__note">{CREATE_NOTE}</p>

        <form className="studio-create" onSubmit={submit}>
          <TextField
            autoComplete="off"
            error={failure?.name ?? nameError(nameIssue)}
            hint={NAME_HINT}
            id={`${fields}-name`}
            label={NAME_LABEL}
            maxLength={MAX_NAME_LENGTH}
            name="name"
            onChange={(event) => { typeName(event.currentTarget.value); }}
            required
            value={name}
          />

          <TextField
            autoComplete="off"
            error={failure?.slug ?? slugError(slugIssue)}
            hint={SLUG_HINT}
            id={`${fields}-slug`}
            label={SLUG_LABEL}
            maxLength={MAX_SLUG_LENGTH}
            mono
            name="slug"
            onChange={(event) => { typeSlug(event.currentTarget.value); }}
            required
            spellCheck={false}
            value={slug}
          />

          {failure !== null && (
            <p className="studio-create__failure" role="alert">
              {failure.message}
            </p>
          )}

          {saving && (
            <p className="studio-create__state" role="status">
              {CREATING}
            </p>
          )}

          <div className="studio-create__actions">
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
