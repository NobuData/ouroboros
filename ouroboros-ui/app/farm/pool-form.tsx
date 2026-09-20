"use client";

import { type FormEvent, useEffect, useId, useRef, useState, useTransition } from "react";

import type { RunnerPool } from "@/app/api/farm";
import { Button, SelectField, TextAreaField, TextField } from "@/app/ui";
import { LIST_ROWS } from "@/app/ui/schema-form";

import { createPool, deletePool, updatePool } from "./pool-actions";
import { usePools } from "./pool-store";
import {
  CREATE,
  CREATED,
  DELETING,
  DESCRIPTION_MAX,
  EXECUTOR_CHOICES,
  FIELD_HINTS,
  FIELD_LABELS,
  IMAGE_MAX,
  KEEP,
  NOTHING_TO_SAVE,
  POOL_MEMBER_REASON,
  type PoolDraft,
  type PoolExecutor,
  type PoolFieldErrors,
  SAVE,
  SAVED,
  SAVING,
  deleteConfirmLabel,
  deleteGuard,
  deleteQuestion,
  deletedNote,
  draftOf,
  hasChanges,
  poolChanges,
  poolCreate,
  validatePoolDraft,
} from "./pools";

/**
 * One pool's configuration form — and, for `pool: null`, a new pool's
 * (AI.4, [#259](https://github.com/NobuData/ouroboros/issues/259)).
 *
 * Every judgement is `app/farm/pools.ts`'s: what a valid form is, what a save sends (**only what
 * differs**), when a delete is blocked and what a refusal says. This holds the form as typed and
 * draws it.
 *
 * - **The executor is the field that matters** (decision **B4**): it changes which runners
 *   dispatch (#252) may send this pool's next builds to, and its hint says so. **Image is drawn
 *   only for a container pool** — a shell pool pins none, and the save sends `image: null` beside
 *   the executor. What was typed is kept across a flip and back.
 * - **The allow-list is the #46 list control**, one name per line, and is what the shell
 *   executor (AG.4, #246) enforces.
 * - **Delete is guarded**: a pool with runners draws `Delete — blocked: 3 runners`, inert, with
 *   the reason; an empty one asks first. The service counts retired machines and builds too, and
 *   its refusal is shown with its counts.
 * - **A reader who may not write** gets genuinely `disabled` fields and inert controls with the
 *   reason (`app/ui/field.tsx` says why a field is disabled rather than `aria-disabled`).
 *
 * ### Focus is never left on the page behind
 *
 * Asking before a delete swaps the form's actions for the confirmation, which unmounts the
 * control that was pressed — and a browser then hands focus to `<body>`, outside the dialog, where
 * Escape closes nothing and Tab walks the page underneath. So opening the confirmation moves
 * focus to **Keep it** (the safe answer, under a stray Enter) and leaving it moves focus back to
 * **Delete**. It only ever *rescues* focus: a reader typing in a field is left where they are.
 *
 * `noValidate`, because the sentences under the fields are this form's own — and a browser's
 * bubble would say less, in another voice, and block the submit that shows them.
 *
 * @param props.pool The pool being configured, or `null` for a create.
 * @param props.mayAdminister Whether this reader may write.
 * @param props.onSettled Called when a write took: which pool the sheet should now show (`null`
 *   for the first), and what to say in its status region.
 * @param props.onTouched Called when the reader edits or submits again, so the sheet stops saying
 *   what the last write did.
 * @returns The form.
 */
export function PoolForm({
  pool,
  mayAdminister,
  onSettled,
  onTouched,
}: Readonly<{
  pool: RunnerPool | null;
  mayAdminister: boolean;
  onSettled: (chosen: string | null, said: string) => void;
  onTouched: () => void;
}>) {
  const { recordWrite, recordRemoval } = usePools();
  const prefix = useId();
  const [draft, setDraft] = useState<PoolDraft>(() => draftOf(pool));
  const [errors, setErrors] = useState<PoolFieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();

  /**
   * Rescue focus when the confirmation opens or closes — see the note above. Skipped on the
   * first render, where nothing has been unmounted and the overlay has just placed focus itself.
   */
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming === wasConfirming.current) return;
    wasConfirming.current = confirming;

    if (document.activeElement !== document.body) return;
    document.getElementById(confirming ? `${prefix}-keep` : `${prefix}-delete`)?.focus();
  }, [confirming, prefix]);

  const busy = saving || deleting;
  const guard = pool === null ? null : deleteGuard(pool);
  const unchanged =
    pool !== null &&
    Object.keys(validatePoolDraft(draft)).length === 0 &&
    !hasChanges(poolChanges(pool, draft));
  const saveReason = !mayAdminister ? POOL_MEMBER_REASON : unchanged ? NOTHING_TO_SAVE : undefined;

  /**
   * Take a keystroke: the field's value, and its error with it — a sentence about what *was*
   * typed should not outlive it.
   *
   * @param field The field.
   * @param value What it now holds.
   */
  function edit<Field extends keyof PoolDraft>(field: Field, value: PoolDraft[Field]): void {
    setDraft((held) => ({ ...held, [field]: value }));
    setErrors((held) => ({ ...held, [field]: undefined }));
    onTouched();
  }

  /** Validate, then create or save. */
  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy || !mayAdminister) return;

    const found = validatePoolDraft(draft);

    setErrors(found);
    setFailure(null);
    setConfirming(false);
    onTouched();
    if (Object.keys(found).length > 0) return;

    startSave(async () => {
      const outcome =
        pool === null
          ? await createPool(poolCreate(draft))
          : await updatePool(pool.id, poolChanges(pool, draft));

      if (!outcome.ok) {
        setErrors(outcome.fields);
        setFailure(outcome.reason);
        return;
      }

      recordWrite(outcome.pool);
      // As stored — trimmed, and the list one name per line — so the form matches the pool again.
      setDraft(draftOf(outcome.pool));
      onSettled(outcome.pool.id, pool === null ? CREATED : SAVED);
    });
  }

  /** Delete the pool, past the confirmation. */
  function remove(): void {
    if (busy || pool === null) return;

    setFailure(null);
    onTouched();

    startDelete(async () => {
      const outcome = await deletePool(pool.id);

      setConfirming(false);

      if (!outcome.ok) {
        setFailure(outcome.reason);
        return;
      }

      recordRemoval(pool.id);
      onSettled(null, deletedNote(pool.name));
    });
  }

  return (
    <form className="farm-pool-form" noValidate onSubmit={save}>
      <TextField
        autoComplete="off"
        disabled={!mayAdminister}
        error={errors.name}
        hint={FIELD_HINTS.name}
        id={`${prefix}-name`}
        label={FIELD_LABELS.name}
        mono
        onChange={(event) => edit("name", event.target.value)}
        spellCheck={false}
        value={draft.name}
      />

      <TextField
        disabled={!mayAdminister}
        error={errors.description}
        hint={FIELD_HINTS.description}
        id={`${prefix}-description`}
        label={FIELD_LABELS.description}
        maxLength={DESCRIPTION_MAX}
        onChange={(event) => edit("description", event.target.value)}
        value={draft.description}
      />

      <SelectField
        disabled={!mayAdminister}
        error={errors.executor}
        hint={FIELD_HINTS.executor}
        id={`${prefix}-executor`}
        label={FIELD_LABELS.executor}
        onChange={(event) => edit("executor", event.target.value as PoolExecutor)}
        value={draft.executor}
      >
        {EXECUTOR_CHOICES.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </SelectField>

      {draft.executor === "container" && (
        <TextField
          autoComplete="off"
          disabled={!mayAdminister}
          error={errors.image}
          hint={FIELD_HINTS.image}
          id={`${prefix}-image`}
          label={FIELD_LABELS.image}
          maxLength={IMAGE_MAX}
          mono
          onChange={(event) => edit("image", event.target.value)}
          spellCheck={false}
          value={draft.image}
        />
      )}

      <TextAreaField
        autoComplete="off"
        disabled={!mayAdminister}
        error={errors.envAllowlist}
        hint={FIELD_HINTS.envAllowlist}
        id={`${prefix}-env`}
        label={FIELD_LABELS.envAllowlist}
        mono
        onChange={(event) => edit("envAllowlist", event.target.value)}
        rows={LIST_ROWS}
        spellCheck={false}
        value={draft.envAllowlist}
      />

      <TextField
        disabled={!mayAdminister}
        error={errors.maxConcurrency}
        hint={FIELD_HINTS.maxConcurrency}
        id={`${prefix}-concurrency`}
        // Text with a numeric keypad rather than `type="number"`: a number input hands back `""`
        // for anything it cannot parse, so the form could not say what was wrong with `1e`.
        inputMode="numeric"
        label={FIELD_LABELS.maxConcurrency}
        onChange={(event) => edit("maxConcurrency", event.target.value)}
        value={draft.maxConcurrency}
      />

      {failure !== null && (
        <p className="farm-pool-form__failure" role="alert">
          {failure}
        </p>
      )}

      {confirming && pool !== null ? (
        <div className="farm-pool-form__confirm" role="group">
          <p className="farm-pool-form__question">{deleteQuestion(pool.name)}</p>
          <div className="farm-pool-form__actions">
            <Button id={`${prefix}-keep`} onClick={() => setConfirming(false)} size="sm" tone="ghost">
              {KEEP}
            </Button>
            <Button aria-busy={deleting || undefined} onClick={remove} size="sm" tone="danger">
              {deleting ? DELETING : deleteConfirmLabel(pool.name)}
            </Button>
          </div>
        </div>
      ) : (
        <div className="farm-pool-form__actions">
          {guard !== null && (
            <Button
              id={`${prefix}-delete`}
              onClick={() => setConfirming(true)}
              reason={mayAdminister ? (guard.reason ?? undefined) : POOL_MEMBER_REASON}
              size="sm"
              tone="ghost"
            >
              {guard.label}
            </Button>
          )}
          <Button aria-busy={saving || undefined} reason={saveReason} size="sm" tone="primary" type="submit">
            {saving ? SAVING : pool === null ? CREATE : SAVE}
          </Button>
        </div>
      )}
    </form>
  );
}
