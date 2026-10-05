"use client";

import { type FormEvent, useId, useRef, useState } from "react";

import type { WebhookEndpoint } from "@/app/api/settings-webhooks";
import { Button, TextAreaField, TextField } from "@/app/ui";

import {
  CANCEL,
  EMPTY_DRAFT,
  FORM_CREATE,
  FORM_CREATE_TITLE,
  FORM_DESCRIPTION,
  FORM_DESCRIPTION_HINT,
  FORM_FAMILIES,
  FORM_NAME,
  FORM_SAVE,
  FORM_SAVING,
  FORM_SECRET_NOTE,
  FORM_SIEM,
  FORM_SIEM_HINT,
  FORM_URL,
  FORM_URL_HINT,
  type WebhookDraft,
  type WebhookFieldErrors,
  type WebhookWrite,
  draftOf,
  familyChoices,
  formEditTitle,
  toggleFamily,
  validateDraft,
} from "./view";

import "./webhooks.css";

/** What {@link WebhookForm} takes. */
export interface WebhookFormProps {
  /** The endpoint being edited, or `null` to create one. */
  readonly endpoint: WebhookEndpoint | null;
  /** The registry's family wildcards — the subscription picker's choices. */
  readonly families: readonly string[];
  /**
   * Send the draft. A refusal keeps the form open with the service's sentence, and its errors
   * on the fields it named.
   */
  readonly onSubmit: (draft: WebhookDraft) => Promise<WebhookWrite<unknown>>;
  /** Close without sending. */
  readonly onCancel: () => void;
}

/**
 * The endpoint form — create and edit
 * (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)): a name, an `https` URL, the
 * event families as checkboxes drawn from the registry, a description, and whether this is the
 * workspace's SIEM stream.
 *
 * **There is no secret field.** The service mints every signing secret and shows it once, after
 * the endpoint exists; the form says so rather than leaving a reader looking for the input.
 *
 * The browser's checks (`validateDraft`) run before anything is sent and put each error on its
 * field. A refusal from the service — a host that resolves internally, a second SIEM route —
 * lands the same way where it named a field, and as a sentence in the form where it did not.
 *
 * @param props See {@link WebhookFormProps}.
 * @returns The form.
 */
export function WebhookForm({ endpoint, families, onSubmit, onCancel }: WebhookFormProps) {
  const base = useId();
  const [draft, setDraft] = useState<WebhookDraft>(endpoint === null ? EMPTY_DRAFT : draftOf(endpoint));
  const [errors, setErrors] = useState<WebhookFieldErrors>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // A latch beside the state: two presses inside one frame both read `sending` as false.
  const sent = useRef(false);

  const choices = familyChoices(families, endpoint?.eventFamilies ?? []);
  const title = endpoint === null ? FORM_CREATE_TITLE : formEditTitle(endpoint.name);

  /**
   * Change one field, and forget what was said about its old value.
   *
   * @param change The fields to replace.
   */
  function edit(change: Partial<WebhookDraft>): void {
    setDraft((now) => ({ ...now, ...change }));
    setErrors((now) =>
      Object.fromEntries(Object.entries(now).filter(([field]) => !(field in change))),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (sent.current) return;

    const found = validateDraft(draft);
    setErrors(found);
    setRefusal(null);
    if (Object.keys(found).length > 0) return;

    sent.current = true;
    setSending(true);

    try {
      const result = await onSubmit(draft);

      if (!result.ok) {
        setErrors(result.fields ?? {});
        setRefusal(result.reason);
      }
    } finally {
      sent.current = false;
      setSending(false);
    }
  }

  return (
    <form
      aria-labelledby={`${base}-title`}
      className="webhooks-form"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <h3 className="webhooks-form__title" id={`${base}-title`}>
        {title}
      </h3>

      <TextField
        autoComplete="off"
        error={errors.name}
        id={`${base}-name`}
        label={FORM_NAME}
        onChange={(event) => edit({ name: event.target.value })}
        value={draft.name}
      />
      <TextField
        autoComplete="off"
        error={errors.url}
        hint={FORM_URL_HINT}
        id={`${base}-url`}
        inputMode="url"
        label={FORM_URL}
        mono
        onChange={(event) => edit({ url: event.target.value })}
        placeholder="https://"
        value={draft.url}
      />

      <fieldset
        aria-describedby={errors.families === undefined ? undefined : `${base}-families-error`}
        className="webhooks-form__families"
      >
        <legend className="webhooks-form__legend">{FORM_FAMILIES}</legend>
        {choices.map((family) => (
          <label className="webhooks-form__choice" key={family}>
            <input
              checked={draft.families.includes(family)}
              className="webhooks-form__box"
              // The SIEM rule reads the families, so what was said about it leaves with them.
              onChange={() =>
                edit({ families: toggleFamily(draft.families, family), siem: draft.siem })
              }
              type="checkbox"
            />
            <span className="webhooks-form__family">{family}</span>
          </label>
        ))}
        {errors.families !== undefined && (
          <p className="webhooks-form__error" id={`${base}-families-error`} role="alert">
            {errors.families}
          </p>
        )}
      </fieldset>

      <div className="webhooks-form__siem">
        <label className="webhooks-form__choice">
          <input
            aria-describedby={`${base}-siem-hint`}
            checked={draft.siem}
            className="webhooks-form__box"
            onChange={(event) => edit({ siem: event.target.checked })}
            type="checkbox"
          />
          <span>{FORM_SIEM}</span>
        </label>
        <p className="webhooks-form__hint" id={`${base}-siem-hint`}>
          {FORM_SIEM_HINT}
        </p>
        {errors.siem !== undefined && (
          <p className="webhooks-form__error" role="alert">
            {errors.siem}
          </p>
        )}
      </div>

      <TextAreaField
        error={errors.description}
        hint={FORM_DESCRIPTION_HINT}
        id={`${base}-description`}
        label={FORM_DESCRIPTION}
        onChange={(event) => edit({ description: event.target.value })}
        rows={2}
        value={draft.description}
      />

      {endpoint === null && <p className="webhooks-form__hint">{FORM_SECRET_NOTE}</p>}

      {refusal !== null && (
        <p className="webhooks-form__error" role="alert">
          {refusal}
        </p>
      )}

      <div className="webhooks-form__actions">
        <Button onClick={onCancel} type="button">
          {CANCEL}
        </Button>
        <Button reason={sending ? FORM_SAVING : undefined} tone="primary" type="submit">
          {sending ? FORM_SAVING : endpoint === null ? FORM_CREATE : FORM_SAVE}
        </Button>
      </div>
    </form>
  );
}
