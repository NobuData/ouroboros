"use client";

import { type FormEvent, useId } from "react";

import { Button, SelectField, TextField } from "@/app/ui";

import {
  ACTOR_KINDS,
  ACTOR_KIND_LABEL,
  ACTOR_KIND_LABELS,
  ACTOR_LABEL,
  ANY_OPTION,
  APPLY_LABEL,
  type AuditActorOption,
  type AuditFilterErrors,
  type AuditFilterForm,
  CLEAR_LABEL,
  FILTERS_TITLE,
  FROM_LABEL,
  PLANE_HINT,
  PLANE_LABEL,
  REF_HINT,
  REF_LABEL,
  TO_LABEL,
} from "./view";

import "./audit-log.css";

/** What {@link AuditFilters} takes. */
export interface AuditFiltersProps {
  /** The form as it stands. */
  readonly form: AuditFilterForm;
  /** What the last **Apply** found wrong, by field. */
  readonly errors: AuditFilterErrors;
  /** The actor select's options. */
  readonly actors: readonly AuditActorOption[];
  /** The form's id — what the toggle's `aria-controls` names. */
  readonly id: string;
  /** Called with the whole form on every edit. */
  readonly onChange: (form: AuditFilterForm) => void;
  /** Apply the form as it stands. */
  readonly onApply: () => void;
  /** Empty the form and go back to today's rows. */
  readonly onClear: () => void;
}

/**
 * The Audit card's filter expansion (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)):
 * a time range, an actor kind, one actor, a plane and a reference search — the dimensions BR.2's
 * query filters on, each an indexed column rather than a search over sentences.
 *
 * It holds nothing: the card owns the form, so **Show all of today** can fill it and the export
 * dialog can read what was applied. What each field becomes on the wire is
 * `app/audit-log/view.ts`'s `parseFilterForm`.
 *
 * @param props See {@link AuditFiltersProps}.
 * @returns The form.
 */
export function AuditFilters({
  form,
  errors,
  actors,
  id,
  onChange,
  onApply,
  onClear,
}: AuditFiltersProps) {
  const base = useId();

  /**
   * Apply on submit, so Enter in any field applies.
   *
   * @param event The submit.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onApply();
  }

  return (
    <form aria-label={FILTERS_TITLE} className="audit-log__filters" id={id} noValidate onSubmit={submit}>
      <div className="audit-log__fields">
        <TextField
          error={errors.from}
          id={`${base}-from`}
          label={FROM_LABEL}
          onChange={(event) => onChange({ ...form, from: event.target.value })}
          type="date"
          value={form.from}
        />
        <TextField
          error={errors.to}
          id={`${base}-to`}
          label={TO_LABEL}
          onChange={(event) => onChange({ ...form, to: event.target.value })}
          type="date"
          value={form.to}
        />
        <SelectField
          id={`${base}-kind`}
          label={ACTOR_KIND_LABEL}
          onChange={(event) =>
            onChange({ ...form, actorKind: event.target.value as AuditFilterForm["actorKind"] })
          }
          value={form.actorKind}
        >
          <option value="">{ANY_OPTION}</option>
          {ACTOR_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {ACTOR_KIND_LABELS[kind]}
            </option>
          ))}
        </SelectField>
        <SelectField
          id={`${base}-actor`}
          label={ACTOR_LABEL}
          onChange={(event) => onChange({ ...form, actor: event.target.value })}
          value={form.actor}
        >
          <option value="">{ANY_OPTION}</option>
          {actors.map((actor) => (
            <option key={actor.value} value={actor.value}>
              {actor.label}
            </option>
          ))}
        </SelectField>
        <TextField
          autoComplete="off"
          error={errors.plane}
          hint={PLANE_HINT}
          id={`${base}-plane`}
          label={PLANE_LABEL}
          mono
          onChange={(event) => onChange({ ...form, plane: event.target.value })}
          value={form.plane}
        />
        <TextField
          autoComplete="off"
          error={errors.ref}
          hint={REF_HINT}
          id={`${base}-ref`}
          label={REF_LABEL}
          mono
          onChange={(event) => onChange({ ...form, ref: event.target.value })}
          value={form.ref}
        />
      </div>
      <div className="audit-log__filter-actions">
        <Button onClick={onClear} size="sm" tone="ghost">
          {CLEAR_LABEL}
        </Button>
        <Button size="sm" tone="primary" type="submit">
          {APPLY_LABEL}
        </Button>
      </div>
    </form>
  );
}
