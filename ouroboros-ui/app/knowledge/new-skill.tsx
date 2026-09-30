"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type { EnabledRepo } from "@/app/api/enablement";
import type { Reading } from "@/app/api/reading";
import type { SkillList } from "@/app/api/skills";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, SelectField, TextField } from "@/app/ui";

import {
  CREATE_CANCEL,
  CREATE_NOTE,
  CREATE_SUBMIT,
  CREATE_TITLE,
  CREATING,
  type CreateFailure,
  DESCRIPTION_HINT,
  DESCRIPTION_LABEL,
  DESCRIPTION_LONG,
  DESCRIPTION_MAX_LENGTH,
  NAME_HINT,
  NAME_LABEL,
  NAME_LONG,
  NAME_MAX_LENGTH,
  REPO_LABEL,
  REPO_NONE_HINT,
  REPO_UNREAD_HINT,
  SCOPE_LABEL,
  SCOPE_ORG_LABEL,
  SCOPE_REPO_LABEL,
  SLUG_HINT,
  SLUG_LABEL,
  SLUG_MAX_LENGTH,
  type SkillForm,
  type SkillFormScope,
  createBody,
  createFailure,
  createdToast,
  formProblems,
  openingForm,
  repoRef,
  slugError,
  submitReason,
  textError,
  typeName,
  typeSlug,
} from "./create";
import { type CreateSkillOutcome, createSkill } from "./create-actions";
import type { KnowledgeToast } from "./toast";
import { NEW_SKILL_LABEL } from "./view";

import "./knowledge.css";

/**
 * Mockup 14's **+ New skill** head action, and the dialog behind it
 * (BG.1, [#417](https://github.com/NobuData/ouroboros/issues/417)).
 *
 * The dialog collects what cannot be inferred — name, slug, description, scope — composes a
 * document (`app/knowledge/create.ts` sets that out) and makes one `POST`. A slug already in this
 * workspace is refused under the box as it is typed, from the list the page read; the service's
 * `409` lands on the same box for the race the list cannot see.
 *
 * On success the dialog closes, the page re-reads, and a toast names the draft — and names
 * X.2 ([#181](https://github.com/NobuData/ouroboros/issues/181)) as where the editor arrives,
 * because the code-view frame cannot open a skill document yet and a door that opens nothing is
 * the thing the design system forbids.
 *
 * **Rendered only for an administrator**: the screen does not mount this for anyone else, so there
 * is no `reason` prop here. The gate that enforces is the service's.
 */

/** What the action needs to be told. */
export interface NewSkillProps {
  /** The workspace's skills, or why they could not be read — the slug check's source. */
  readonly skills: Reading<SkillList>;
  /** The enabled repositories, or why they could not be read — the `repo` scope's choices. */
  readonly repos: Reading<readonly EnabledRepo[]>;
  /** Called with the toast to leave once the draft is stored. */
  readonly onCreated: (toast: KnowledgeToast) => void;
}

/**
 * The action, and its dialog.
 *
 * @param props See {@link NewSkillProps}.
 * @returns The primary button, with the dialog beside it while it is open.
 */
export function NewSkill({ skills, repos, onCreated }: NewSkillProps) {
  const router = useRouter();
  const fields = useId();

  const choices = repos.ok ? repos.value : [];
  const existing = skills.ok ? skills.value : null;

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SkillForm>(() => openingForm(choices));
  const [failure, setFailure] = useState<CreateFailure | null>(null);
  const [saving, startSaving] = useTransition();

  const problems = formProblems(form, existing);
  const blocked = submitReason(problems);

  /** Open on a fresh form, so a dialog dismissed halfway and reopened starts clean. */
  function openDialog(): void {
    setForm(openingForm(choices));
    setFailure(null);
    setOpen(true);
  }

  /** Close without writing. */
  function close(): void {
    setOpen(false);
  }

  /**
   * Hold the form as the reader changes it, and clear a refusal that was about the old values.
   *
   * @param next The form.
   */
  function hold(next: SkillForm): void {
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
      const outcome: CreateSkillOutcome = await createSkill(createBody(form));

      if (!outcome.ok) {
        setFailure(createFailure(outcome.refusal));
        return;
      }

      setOpen(false);
      onCreated(createdToast(outcome.slug));
      // The skills region re-reads, and the list the slug check reads gains the new slug.
      router.refresh();
    });
  }

  // The `repo` scope is offered only when there is a repository to name; the hint says why not.
  const repoHint = !repos.ok ? REPO_UNREAD_HINT : choices.length === 0 ? REPO_NONE_HINT : undefined;

  return (
    <>
      <Button onClick={openDialog} tone="primary">
        {NEW_SKILL_LABEL}
      </Button>

      <ShellOverlay label={CREATE_TITLE} onClose={close} open={open}>
        <h2 className="shell-overlay__title">{CREATE_TITLE}</h2>
        <p className="shell-overlay__note">{CREATE_NOTE}</p>

        <form className="knowledge-create" onSubmit={submit}>
          <TextField
            autoComplete="off"
            error={textError(problems.name, NAME_LONG)}
            hint={NAME_HINT}
            id={`${fields}-name`}
            label={NAME_LABEL}
            maxLength={NAME_MAX_LENGTH}
            name="name"
            onChange={(event) => { hold(typeName(form, event.currentTarget.value)); }}
            required
            value={form.name}
          />

          <TextField
            autoComplete="off"
            error={failure?.slug ?? slugError(problems.slug)}
            hint={SLUG_HINT}
            id={`${fields}-slug`}
            label={SLUG_LABEL}
            maxLength={SLUG_MAX_LENGTH}
            mono
            name="slug"
            onChange={(event) => { hold(typeSlug(form, event.currentTarget.value)); }}
            required
            value={form.slug}
          />

          <TextField
            autoComplete="off"
            error={textError(problems.description, DESCRIPTION_LONG)}
            hint={DESCRIPTION_HINT}
            id={`${fields}-description`}
            label={DESCRIPTION_LABEL}
            maxLength={DESCRIPTION_MAX_LENGTH}
            name="description"
            onChange={(event) => { hold({ ...form, description: event.currentTarget.value }); }}
            required
            value={form.description}
          />

          <SelectField
            hint={repoHint}
            id={`${fields}-scope`}
            label={SCOPE_LABEL}
            name="scope"
            onChange={(event) => { hold({ ...form, scope: event.currentTarget.value as SkillFormScope }); }}
            value={form.scope}
          >
            <option value="org">{SCOPE_ORG_LABEL}</option>
            {choices.length > 0 && <option value="repo">{SCOPE_REPO_LABEL}</option>}
          </SelectField>

          {form.scope === "repo" && (
            <SelectField
              id={`${fields}-repo`}
              label={REPO_LABEL}
              name="repoRef"
              onChange={(event) => { hold({ ...form, repoRef: event.currentTarget.value }); }}
              value={form.repoRef}
            >
              {choices.map((repo) => (
                <option key={repo.id} value={repoRef(repo)}>
                  {repoRef(repo)}
                </option>
              ))}
            </SelectField>
          )}

          {failure !== null && (
            <p className="knowledge-create__failure" role="alert">
              {failure.message}
            </p>
          )}

          {saving && (
            <p className="knowledge-create__state" role="status">
              {CREATING}
            </p>
          )}

          <div className="knowledge-create__actions">
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
