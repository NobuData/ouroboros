"use client";

import { type FormEvent, useId, useState, useTransition } from "react";

import type { ResearchToolCatalogEntry, ResearchToolEnableForm } from "@/app/api/research";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, SchemaFields } from "@/app/ui";

import {
  CANCEL,
  CLOSE,
  ENABLE_LABEL,
  ENABLE_READ_ONLY,
  ENABLE_SUBMIT,
  ENABLING,
  NOTHING_REQUIRED,
  PLANNED_TITLE,
  SECRET_NOTE,
  type SideFailure,
  enableFailure,
  enableFields,
  enableName,
  enableSubmission,
  plannedIssueLabel,
  plannedIssueUrl,
  plannedNote,
} from "./side";
import { enableTool } from "./side-actions";

/**
 * A tool row's **enable** and what it opens (CN.3,
 * [#629](https://github.com/NobuData/ouroboros/issues/629)).
 *
 * **There is no tool-specific code here.** A tool with an adapter opens a sheet whose fields are
 * the adapter's `configSchema()`, as the service flattened it, drawn by the same schema-form
 * primitive the ticket-source and provider forms use (AE.5, #231); the submission goes back in
 * that vocabulary and the service judges it. A tool this build has no adapter for opens the
 * honest note instead — when it arrives, and the issue to follow — because a form that could not
 * save would be the product pretending.
 *
 * The planned note is open to every reader: it changes nothing. The form is an administrator's,
 * and the button says so to anyone else rather than hiding.
 */

/** What the control takes. */
export interface ToolEnableProps {
  /** The tool. Its `enable` is not null — the card checks before mounting this. */
  readonly tool: ResearchToolCatalogEntry;
  /** Whether the reader may store a tool's settings. */
  readonly mayAdminister: boolean;
  /** Called once a save is stored, so the card re-reads. */
  readonly onEnabled: () => void;
}

/**
 * The enable button and its dialog.
 *
 * @param props See {@link ToolEnableProps}.
 * @returns The control.
 */
export function ToolEnable({ tool, mayAdminister, onEnabled }: ToolEnableProps) {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  const { enable } = tool;

  if (enable === null) return null;

  const planned = enable.kind === "planned";
  const title = planned ? PLANNED_TITLE : enable.title;

  return (
    <>
      <Button
        aria-label={enableName(tool)}
        onClick={() => setOpen(true)}
        reason={planned || mayAdminister ? undefined : ENABLE_READ_ONLY}
        size="sm"
        tone="ghost"
        type="button"
      >
        {ENABLE_LABEL}
      </Button>

      <ShellOverlay describedBy={noteId} label={title} onClose={() => setOpen(false)} open={open}>
        <h2 className="shell-overlay__title">{title}</h2>

        {enable.kind === "planned" ? (
          <div className="research__enable">
            <p className="research__enable-note" id={noteId}>
              {plannedNote(tool.name, enable.release)}
            </p>
            <div className="research__enable-actions">
              <Button href={plannedIssueUrl(enable.issue)} rel="noreferrer" target="_blank" tone="ghost">
                {plannedIssueLabel(enable.issue)}
              </Button>
              <Button onClick={() => setOpen(false)} tone="primary" type="button">
                {CLOSE}
              </Button>
            </div>
          </div>
        ) : (
          <EnableForm
            form={enable}
            noteId={noteId}
            onCancel={() => setOpen(false)}
            onEnabled={() => {
              setOpen(false);
              onEnabled();
            }}
            slug={tool.slug}
          />
        )}
      </ShellOverlay>
    </>
  );
}

/**
 * The schema-driven form.
 *
 * @param props.slug The tool being enabled.
 * @param props.form The service's form — title, fields and stored values.
 * @param props.noteId The id the dialog is described by.
 * @param props.onCancel Close without saving.
 * @param props.onEnabled Called once the save is stored.
 * @returns The form.
 */
function EnableForm({
  slug,
  form,
  noteId,
  onCancel,
  onEnabled,
}: Readonly<{
  slug: string;
  form: ResearchToolEnableForm;
  noteId: string;
  onCancel: () => void;
  onEnabled: () => void;
}>) {
  const id = useId();
  const [failure, setFailure] = useState<SideFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const fields = enableFields(form);
  const hasSecret = form.fields.some((field) => field.widget === "secret");

  /**
   * Submit the form as the tool's schema names it.
   *
   * @param event The submit.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (pending) return;

    const data = new FormData(event.currentTarget);
    const config = enableSubmission(form, (name) => {
      const value = data.get(name);

      return typeof value === "string" ? value : "";
    });

    setFailure(null);

    startTransition(async () => {
      const outcome = await enableTool(slug, config);

      if (!outcome.ok) {
        setFailure(enableFailure(outcome.refusal));
        return;
      }

      onEnabled();
    });
  }

  return (
    <form className="research__enable" onSubmit={submit}>
      <p className="research__enable-note" id={noteId}>
        {hasSecret ? SECRET_NOTE : NOTHING_REQUIRED}
      </p>

      <SchemaFields errors={failure?.fields} fields={fields} idPrefix={`${id}-tool`} />

      {failure !== null && (
        <p className="research__refusal" role="alert">
          {failure.message}
        </p>
      )}

      <div className="research__enable-actions">
        <Button onClick={onCancel} tone="ghost" type="button">
          {CANCEL}
        </Button>
        <Button reason={pending ? ENABLING : undefined} tone="primary" type="submit">
          {pending ? ENABLING : ENABLE_SUBMIT}
        </Button>
      </div>
    </form>
  );
}
