"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";

import type { TicketSource, TicketSourceCatalogEntry } from "@/app/api/sources";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, SchemaFields, TextField } from "@/app/ui";

import { setSourceCredentials, updateSourceConfig } from "./actions";
import {
  type AddFailure,
  CLOSE,
  CONFIGURE_DIALOG_TITLE,
  CONFIGURE_NO_CATALOG,
  CREDENTIALS_UNSUPPORTED,
  CREDENTIAL_HEADING,
  SAVE,
  SAVED,
  SAVING,
  SECRET_FIELD,
  SETTINGS_HEADING,
  SETTINGS_NOTE,
  STORE_CREDENTIAL,
  STORING,
  addFailure,
  configOf,
  credentialNote,
  credentialStored,
  secretFieldOf,
  storedFields,
} from "./catalog";
import { CONFIGURE_LABEL, CONFIGURE_READ_ONLY } from "./view";

import "./sources.css";

/**
 * The configure dialog — a source's settings, and its write-only credential
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * Two forms in one dialog, and the split is the contract's: `PATCH /api/v1/sources/{id}`
 * takes the settings whole and never the credential, and `POST …/credentials` takes the
 * credential and nothing else. So the settings form is `SchemaFields` over the entry's fields
 * **minus the secret**, each starting at what the row holds (`catalog.ts`'s `storedFields`),
 * and the credential form is one masked input over the secret field the provider declared —
 * with the row's `credentialMask` above it, which is the whole of what a reader is ever shown
 * of a stored credential. There is no reveal, and nothing here could draw one: no call in the
 * contract answers a credential's value.
 *
 * **The form is the provider's, here too.** No field is named in this file; a provider that
 * declares no secret field gets a credential section that says so, and a provider whose
 * settings are one text field gets one text field.
 *
 * Either write refreshes the route on close, so the row behind the dialog re-reads its
 * summary and its mask.
 */

/** What the dialog takes. */
export interface ConfigureSourceProps {
  /** The source. */
  readonly source: TicketSource;
  /**
   * The catalog entry for its kind, or `null` when the catalog could not be read — in which
   * case the control is inert with that as its reason, because there is no form to draw.
   */
  readonly entry: TicketSourceCatalogEntry | null;
  /** Whether this reader may change the source. `false` renders the control inert. */
  readonly mayAdminister: boolean;
}

/**
 * The **Configure** control and the dialog it opens.
 *
 * @param props See {@link ConfigureSourceProps}.
 * @returns The button, and the dialog while it is open.
 */
export function ConfigureSource({ source, entry, mayAdminister }: ConfigureSourceProps) {
  const router = useRouter();
  const [isOpen, setOpen] = useState(false);
  const [changed, setChanged] = useState(false);

  const reason = !mayAdminister
    ? CONFIGURE_READ_ONLY
    : entry === null
      ? CONFIGURE_NO_CATALOG
      : undefined;

  function close(): void {
    setOpen(false);
    if (changed) router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} reason={reason} size="sm" tone="ghost" type="button">
        {CONFIGURE_LABEL}
      </Button>

      {entry !== null && (
        <ShellOverlay label={CONFIGURE_DIALOG_TITLE} onClose={close} open={isOpen}>
          <h2 className="shell-overlay__title">
            {CONFIGURE_DIALOG_TITLE} · {source.displayName}
          </h2>

          <div className="sources-configure">
            <SettingsForm entry={entry} onChanged={() => setChanged(true)} source={source} />
            <CredentialForm entry={entry} onChanged={() => setChanged(true)} source={source} />

            <div className="sources-add__actions">
              <Button onClick={close} tone="ghost" type="button">
                {CLOSE}
              </Button>
            </div>
          </div>
        </ShellOverlay>
      )}
    </>
  );
}

/**
 * The settings half: the provider's fields, minus the secret, starting at the stored values.
 *
 * @param props.source The source.
 * @param props.entry Its kind's catalog entry.
 * @param props.onChanged Called once a save has landed.
 * @returns The form.
 */
function SettingsForm({
  source,
  entry,
  onChanged,
}: Readonly<{
  source: TicketSource;
  entry: TicketSourceCatalogEntry;
  onChanged: () => void;
}>) {
  const id = useId();
  const fields = storedFields(entry, source);
  const [failure, setFailure] = useState<AddFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (pending) return;

    const data = new FormData(event.currentTarget);
    const config = configOf(fields, (name) => {
      const value = data.get(name);

      return typeof value === "string" ? value : "";
    });

    setFailure(null);
    setSaved(false);

    startTransition(async () => {
      const outcome = await updateSourceConfig(source.id, config);

      if (!outcome.ok) {
        setFailure(addFailure(outcome.refusal));
        return;
      }

      setSaved(true);
      onChanged();
    });
  }

  return (
    <form className="sources-configure__section" onSubmit={submit}>
      <h3 className="sources-configure__heading">{SETTINGS_HEADING}</h3>
      <p className="sources-configure__note">{SETTINGS_NOTE}</p>

      <SchemaFields errors={failure?.fields} fields={fields} idPrefix={`${id}-settings`} />

      {failure !== null && (
        <p className="sources-add__failure" role="alert">
          {failure.message}
        </p>
      )}
      {saved && (
        <p className="sources-add__state" role="status">
          {SAVED}
        </p>
      )}

      <div className="sources-add__actions">
        <Button reason={pending ? SAVING : undefined} tone="primary" type="submit">
          {SAVE}
        </Button>
      </div>
    </form>
  );
}

/**
 * The credential half: the mask, and one masked input over the provider's secret field.
 *
 * @param props.source The source.
 * @param props.entry Its kind's catalog entry.
 * @param props.onChanged Called once a store has landed.
 * @returns The form, or the sentence for a provider that takes no credential.
 */
function CredentialForm({
  source,
  entry,
  onChanged,
}: Readonly<{
  source: TicketSource;
  entry: TicketSourceCatalogEntry;
  onChanged: () => void;
}>) {
  const id = useId();
  const field = secretFieldOf(entry);
  const [mask, setMask] = useState(source.credentialMask);
  const [failure, setFailure] = useState<AddFailure | null>(null);
  const [stored, setStored] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (field === null) {
    return (
      <section className="sources-configure__section">
        <h3 className="sources-configure__heading">{CREDENTIAL_HEADING}</h3>
        <p className="sources-configure__note">{CREDENTIALS_UNSUPPORTED}</p>
      </section>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (pending) return;

    const data = new FormData(event.currentTarget);
    const secret = data.get(SECRET_FIELD);
    const form = event.currentTarget;

    setFailure(null);
    setStored(null);

    startTransition(async () => {
      const outcome = await setSourceCredentials(
        source.id,
        typeof secret === "string" ? secret : "",
      );

      if (!outcome.ok) {
        // The secret field's own sentences arrive under the field's name; the input is ours.
        const turned = addFailure(outcome.refusal);
        const own = field === null ? undefined : turned.fields[field.name];

        setFailure({
          message: turned.message,
          fields: own === undefined ? turned.fields : { ...turned.fields, [SECRET_FIELD]: own },
        });
        return;
      }

      setMask(outcome.source.credentialMask);
      setStored(credentialStored(outcome.source.credentialMask));
      // What was typed is not kept: a stored credential has no business in a form afterwards.
      form.reset();
      onChanged();
    });
  }

  const errors = failure?.fields[SECRET_FIELD];

  return (
    <form className="sources-configure__section" onSubmit={submit}>
      <h3 className="sources-configure__heading">{CREDENTIAL_HEADING}</h3>
      <p className="sources-configure__note">{credentialNote(mask)}</p>

      <TextField
        autoComplete="off"
        error={errors === undefined ? undefined : errors.join(" ")}
        hint={field.help ?? undefined}
        id={`${id}-${SECRET_FIELD}`}
        label={field.label}
        maxLength={field.maxLength ?? undefined}
        minLength={field.minLength ?? undefined}
        mono
        name={SECRET_FIELD}
        pattern={field.pattern ?? undefined}
        placeholder={field.placeholder ?? undefined}
        required
        spellCheck={false}
        type="password"
      />

      {failure !== null && (
        <p className="sources-add__failure" role="alert">
          {failure.message}
        </p>
      )}
      {stored !== null && (
        <p className="sources-add__state" role="status">
          {stored}
        </p>
      )}

      <div className="sources-add__actions">
        <Button reason={pending ? STORING : undefined} tone="primary" type="submit">
          {STORE_CREDENTIAL}
        </Button>
      </div>
    </form>
  );
}
