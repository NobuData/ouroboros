"use client";

import { type FormEvent, useId, useRef, useState } from "react";

import type {
  ServiceAccountSecret,
  ServiceScope,
  ServiceScopeName,
} from "@/app/api/settings-members";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, TextField } from "@/app/ui";

import { type Confirmation, ConfirmDialog } from "./confirm-dialog";
import {
  CANCEL,
  type MembersWrite,
  REVOKE_ACCOUNT,
  REVOKE_CONFIRM,
  ROTATE,
  ROTATE_CONFIRM,
  SERVICE_CREATE,
  SERVICE_CREATE_TITLE,
  SERVICE_CREATING,
  SERVICE_NAME,
  SERVICE_NAME_HINT,
  SERVICE_NAME_INVALID,
  SERVICE_NAME_PATTERN,
  SERVICE_NONE,
  SERVICE_SCOPES,
  SERVICE_SCOPES_REQUIRED,
  SERVICE_SUBMIT,
  SERVICE_TITLE,
  type ServiceRowModel,
  lastUsed,
  revokeWarning,
  rotateWarning,
  scopeList,
  serviceActionLabel,
} from "./view";

import "./members.css";

/** The section's writes. */
export interface ServiceAccountActions {
  readonly create: (
    name: string,
    scopes: readonly ServiceScopeName[],
  ) => Promise<MembersWrite<ServiceAccountSecret>>;
  readonly rotate: (id: string) => Promise<MembersWrite<ServiceAccountSecret>>;
  readonly revoke: (id: string) => Promise<MembersWrite<unknown>>;
}

/** What {@link ServiceAccounts} takes. */
export interface ServiceAccountsProps {
  /** The enabled accounts. */
  readonly rows: readonly ServiceRowModel[];
  /** The registered scopes — `null` for a reader who may not manage, who gets no create. */
  readonly scopes: readonly ServiceScope[] | null;
  /** Whether the reader may create, rotate and revoke. */
  readonly mayManage: boolean;
  /** What *last used* is measured against. */
  readonly now: number;
  /** The writes. */
  readonly actions: ServiceAccountActions;
  /** A create or rotate landed — the card shows its token once, then forgets it. */
  readonly onSecret: (secret: ServiceAccountSecret, rotated: boolean) => void;
  /** A revoke landed. */
  readonly onRevoked: (id: string, name: string) => void;
}

/** A row's pending destructive action. */
interface PendingAction {
  readonly kind: "rotate" | "revoke";
  readonly row: ServiceRowModel;
}

/**
 * The card's **Service accounts** section, under the table
 * (BS.3, [#493](https://github.com/NobuData/ouroboros/issues/493)): each account's scopes, its
 * masked token and when that token was last used, with **Rotate** and **Revoke** behind a
 * confirmation; and **+ Create service account** with a scope picker drawn from the registered
 * allow-list. A token is never drawn here — only its masked hint; the one showing of a token is
 * the card's `TokenOnce`.
 *
 * @param props See {@link ServiceAccountsProps}.
 * @returns The section.
 */
export function ServiceAccounts({
  rows,
  scopes,
  mayManage,
  now,
  actions,
  onSecret,
  onRevoked,
}: ServiceAccountsProps) {
  const titleId = useId();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const canCreate = mayManage && scopes !== null;

  const confirmation: Confirmation | null =
    pending === null
      ? null
      : pending.kind === "rotate"
        ? {
            title: serviceActionLabel("Rotate", pending.row.name),
            warning: rotateWarning(pending.row.name),
            confirm: ROTATE_CONFIRM,
          }
        : {
            title: serviceActionLabel("Revoke", pending.row.name),
            warning: revokeWarning(pending.row.name),
            confirm: REVOKE_CONFIRM,
          };

  async function confirm(): Promise<MembersWrite<unknown>> {
    if (pending === null) return { ok: true, value: null };

    const { row, kind } = pending;

    if (kind === "rotate") {
      const result = await actions.rotate(row.id);
      if (result.ok) {
        setPending(null);
        onSecret(result.value, true);
      }
      return result;
    }

    const result = await actions.revoke(row.id);
    if (result.ok) {
      setPending(null);
      onRevoked(row.id, row.name);
    }
    return result;
  }

  return (
    <section aria-labelledby={titleId} className="members__services">
      <div className="members__services-head">
        <h3 className="members__services-title" id={titleId}>
          {SERVICE_TITLE}
        </h3>
        {canCreate && (
          <Button aria-haspopup="dialog" onClick={() => setCreating(true)} size="sm" tone="ghost">
            {SERVICE_CREATE}
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="members__muted">{SERVICE_NONE}</p>
      ) : (
        <ul className="members__services-list">
          {rows.map((row) => (
            <li className="members__service" key={row.id}>
              <span className="members__service-meta">
                <span className="members__name members__mono">{row.name}</span>
                <span>{scopeList(row.scopes)}</span>
                {row.hint !== null && <span className="members__mono">{row.hint}</span>}
                <span>{lastUsed(row.lastUsedAt, now)}</span>
              </span>
              {mayManage && (
                <span className="members__actions">
                  <Button
                    aria-haspopup="dialog"
                    aria-label={serviceActionLabel("Rotate", row.name)}
                    onClick={() => setPending({ kind: "rotate", row })}
                    size="sm"
                  >
                    {ROTATE}
                  </Button>
                  <Button
                    aria-haspopup="dialog"
                    aria-label={serviceActionLabel("Revoke", row.name)}
                    onClick={() => setPending({ kind: "revoke", row })}
                    size="sm"
                    tone="danger"
                  >
                    {REVOKE_ACCOUNT}
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canCreate && (
        <CreateServiceAccount
          onClose={() => setCreating(false)}
          onCreate={actions.create}
          onCreated={(secret) => {
            setCreating(false);
            onSecret(secret, false);
          }}
          open={creating}
          scopes={scopes}
        />
      )}

      <ConfirmDialog
        confirmation={confirmation}
        onClose={() => setPending(null)}
        onConfirm={confirm}
      />
    </section>
  );
}

/** What {@link CreateServiceAccount} takes. */
interface CreateServiceAccountProps {
  readonly open: boolean;
  readonly scopes: readonly ServiceScope[];
  readonly onCreate: ServiceAccountActions["create"];
  readonly onCreated: (secret: ServiceAccountSecret) => void;
  readonly onClose: () => void;
}

/**
 * The create dialog: a name held to the service's rule, and a scope picker from the registered
 * allow-list (each scope with the sentence that says what it allows). Nothing is pre-ticked — a
 * bot gets exactly what somebody chose for it.
 *
 * @param props See {@link CreateServiceAccountProps}.
 * @returns The dialog.
 */
function CreateServiceAccount({
  open,
  scopes,
  onCreate,
  onCreated,
  onClose,
}: CreateServiceAccountProps) {
  const nameId = useId();
  const legendId = useId();
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<readonly ServiceScopeName[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sent = useRef(false);

  function close(): void {
    setName("");
    setChosen([]);
    setProblem(null);
    onClose();
  }

  function toggle(scope: ServiceScopeName): void {
    setChosen((current) =>
      current.includes(scope) ? current.filter((each) => each !== scope) : [...current, scope],
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (sent.current) return;

    if (!SERVICE_NAME_PATTERN.test(name)) return setProblem(SERVICE_NAME_INVALID);
    if (chosen.length === 0) return setProblem(SERVICE_SCOPES_REQUIRED);

    sent.current = true;
    setSending(true);
    setProblem(null);

    try {
      const result = await onCreate(name, chosen);

      if (result.ok) {
        setName("");
        setChosen([]);
        onCreated(result.value);
      } else {
        setProblem(result.reason);
      }
    } finally {
      sent.current = false;
      setSending(false);
    }
  }

  return (
    <ShellOverlay label={SERVICE_CREATE_TITLE} onClose={close} open={open}>
      <form className="members-dialog" onSubmit={(event) => void submit(event)}>
        <h2 className="members-dialog__title">{SERVICE_CREATE_TITLE}</h2>
        <TextField
          autoComplete="off"
          hint={SERVICE_NAME_HINT}
          id={nameId}
          label={SERVICE_NAME}
          mono
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
        <fieldset aria-labelledby={legendId} className="members-dialog__choices">
          <legend className="members-dialog__legend" id={legendId}>
            {SERVICE_SCOPES}
          </legend>
          {scopes.map((scope) => (
            <label className="members-dialog__choice" key={scope.scope}>
              <input
                checked={chosen.includes(scope.scope)}
                onChange={() => toggle(scope.scope)}
                type="checkbox"
                value={scope.scope}
              />
              <span>
                <span className="members__mono">{scope.scope}</span>{" "}
                <span className="members-dialog__why">— {scope.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {problem !== null && (
          <p className="members-dialog__refusal" role="alert">
            {problem}
          </p>
        )}
        <div className="members-dialog__actions">
          <Button onClick={close} type="button">
            {CANCEL}
          </Button>
          <Button reason={sending ? SERVICE_CREATING : undefined} tone="primary" type="submit">
            {sending ? SERVICE_CREATING : SERVICE_SUBMIT}
          </Button>
        </div>
      </form>
    </ShellOverlay>
  );
}
