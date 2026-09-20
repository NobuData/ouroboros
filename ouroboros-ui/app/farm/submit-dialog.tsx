"use client";

import { type FormEvent, useId, useRef, useState } from "react";

import type { RunnerPool } from "@/app/api/farm";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, SelectField, TextField } from "@/app/ui";

import { parseCommandLine } from "./command-line";
import { usePools } from "./pool-store";
import {
  ARGV_PREVIEW,
  CANCEL,
  SUBMIT,
  SUBMITTING,
  SUBMIT_BUILD,
  SUBMIT_FIELDS,
  SUBMIT_NOTE,
  SUBMIT_PLACEHOLDERS,
  type SubmitDraft,
  type SubmitFieldErrors,
  USES_POOL_DEFAULT,
  draftFor,
  submissionOf,
  validateDraft,
  withPool,
} from "./submit";
import { submitBuild } from "./submit-actions";
import { type SubmitRequest, useSubmit } from "./submit-store";

/**
 * The submit-build dialog (AI.5, [#260](https://github.com/NobuData/ouroboros/issues/260)) —
 * pool, repository, ref, commit and command, **the pool's default command prefilled**.
 *
 * Every decision is `app/farm/submit.ts`'s; this holds the draft and draws it. It is mounted
 * once, at the screen, and opened through `app/farm/submit-store.tsx` by either of its doors —
 * the head's **Submit build** or a pool row's.
 *
 * ### The form is remounted per opening
 *
 * {@link SubmitForm} is keyed by the request's sequence number, and every press is a new one — so
 * each opening seeds its draft from the pool that asked, and a draft abandoned half-typed does
 * not come back under a different pool's name.
 *
 * ### The command is shown as the words it will be sent as
 *
 * The API takes argv and says the split belongs *where the person who wrote it can see the
 * result*. So under the field the dialog draws each word as its own chip, live, and a command
 * that cannot be read says why under the field instead (`app/farm/command-line.ts`).
 *
 * ### A pool that stops existing
 *
 * The pools are the live page's (`usePools`). The dialog closes nothing by itself when they
 * change; a pool that was deleted while the dialog was open is refused by the service and said
 * under the pool field.
 *
 * @returns The dialog — unmounted while closed.
 */
export function SubmitDialog() {
  const { request, close } = useSubmit();
  const { pools } = usePools();

  const shown = request !== null && pools !== null && pools.length > 0 ? { request, pools } : null;

  return (
    <ShellOverlay label={SUBMIT_BUILD} onClose={close} open={shown !== null}>
      {shown !== null && (
        <SubmitForm key={shown.request.seq} pools={shown.pools} request={shown.request} />
      )}
    </ShellOverlay>
  );
}

/**
 * The form inside the dialog.
 *
 * `noValidate`, because the sentences under the fields are this form's own
 * (`app/farm/pool-form.tsx` argues why). No field is `required` for the same reason.
 *
 * @param props.request Which door opened the dialog.
 * @param props.pools The workspace's pools — never empty.
 * @returns The form.
 */
function SubmitForm({
  request,
  pools,
}: Readonly<{ request: SubmitRequest; pools: readonly RunnerPool[] }>) {
  const { close, recordSubmitted } = useSubmit();
  const prefix = useId();
  const [draft, setDraft] = useState<SubmitDraft>(() => draftFor(pools, request.pool));
  const [errors, setErrors] = useState<SubmitFieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Beside the state, for the reason `use-lifecycle.ts` gives: two presses inside one frame.
  const inFlight = useRef(false);

  const command = parseCommandLine(draft.command);
  const hasDefault =
    (pools.find((pool) => pool.name === draft.pool)?.defaultCommand ?? null) !== null;

  /**
   * Take a keystroke: the field's value, and its error with it.
   *
   * @param field The field.
   * @param value What it now holds.
   */
  function edit(field: Exclude<keyof SubmitDraft, "pool">, value: string): void {
    setDraft((held) => ({ ...held, [field]: value }));
    setErrors((held) => ({ ...held, [field]: undefined }));
  }

  /** Validate, then submit. */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (inFlight.current) return;

    const found = validateDraft(draft, pools);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;

    inFlight.current = true;
    setSubmitting(true);

    void submitBuild(submissionOf(draft, pools))
      .then((outcome) => {
        if (outcome.ok) return recordSubmitted(outcome.job);

        setErrors(outcome.fields);
        setFailure(outcome.reason);
      })
      .finally(() => {
        inFlight.current = false;
        setSubmitting(false);
      });
  }

  return (
    <form className="farm-submit" noValidate onSubmit={submit}>
      <div>
        <h2 className="shell-overlay__title">{SUBMIT_BUILD}</h2>
        <p className="shell-overlay__note">{SUBMIT_NOTE}</p>
      </div>

      <SelectField
        error={errors.pool}
        hint={SUBMIT_FIELDS.pool.hint}
        id={`${prefix}-pool`}
        label={SUBMIT_FIELDS.pool.label}
        onChange={(event) => {
          setDraft((held) => withPool(held, pools, event.target.value));
          setErrors((held) => ({
            ...held,
            pool: undefined,
            command: undefined,
          }));
        }}
        value={draft.pool}
      >
        {pools.map((pool) => (
          <option disabled={!pool.enabled} key={pool.id} value={pool.name}>
            {pool.enabled ? pool.name : `${pool.name} — disabled`}
          </option>
        ))}
      </SelectField>

      <TextField
        autoComplete="off"
        error={errors.repository}
        hint={SUBMIT_FIELDS.repository.hint}
        id={`${prefix}-repository`}
        label={SUBMIT_FIELDS.repository.label}
        mono
        onChange={(event) => edit("repository", event.target.value)}
        placeholder={SUBMIT_PLACEHOLDERS.repository}
        spellCheck={false}
        value={draft.repository}
      />

      <TextField
        autoComplete="off"
        error={errors.ref}
        hint={SUBMIT_FIELDS.ref.hint}
        id={`${prefix}-ref`}
        label={SUBMIT_FIELDS.ref.label}
        mono
        onChange={(event) => edit("ref", event.target.value)}
        placeholder={SUBMIT_PLACEHOLDERS.ref}
        spellCheck={false}
        value={draft.ref}
      />

      <TextField
        autoComplete="off"
        error={errors.commit}
        hint={SUBMIT_FIELDS.commit.hint}
        id={`${prefix}-commit`}
        label={SUBMIT_FIELDS.commit.label}
        mono
        onChange={(event) => edit("commit", event.target.value)}
        placeholder={SUBMIT_PLACEHOLDERS.commit}
        spellCheck={false}
        value={draft.commit}
      />

      <TextField
        autoComplete="off"
        error={errors.command ?? (command.ok ? undefined : command.reason)}
        hint={SUBMIT_FIELDS.command.hint}
        id={`${prefix}-command`}
        label={SUBMIT_FIELDS.command.label}
        mono
        onChange={(event) => edit("command", event.target.value)}
        placeholder={SUBMIT_PLACEHOLDERS.command}
        spellCheck={false}
        value={draft.command}
      />

      {/* What will be sent, word by word — the split, where the person who wrote it sees it. */}
      {command.ok && command.argv.length > 0 && (
        <p className="farm-submit__argv">
          <span className="farm-submit__argv-lead">{ARGV_PREVIEW}</span>
          {command.argv.map((word, index) => (
            // Position is the identity: the same word may appear twice, and words do not move.
            <code className="farm-submit__word" key={index}>
              {word === "" ? "''" : word}
            </code>
          ))}
        </p>
      )}
      {command.ok && command.argv.length === 0 && hasDefault && (
        <p className="farm-submit__argv">{USES_POOL_DEFAULT}</p>
      )}

      {failure !== null && (
        <p className="farm-submit__failure" role="alert">
          {failure}
        </p>
      )}

      <div className="farm-submit__actions">
        <Button onClick={close} size="sm" tone="ghost">
          {CANCEL}
        </Button>
        <Button aria-busy={submitting || undefined} size="sm" tone="primary" type="submit">
          {submitting ? SUBMITTING : SUBMIT}
        </Button>
      </div>
    </form>
  );
}
