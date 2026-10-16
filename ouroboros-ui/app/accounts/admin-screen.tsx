"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";

import type { AdminAccount, PreapprovedEmail } from "@/app/api/accounts";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Card, CardHead, TextField } from "@/app/ui";

import {
  ADD_LABEL,
  ADMIN_LEAD,
  ADMIN_TITLE,
  APPROVE_LABEL,
  type AdminWrite,
  CANCEL_LABEL,
  DENIED_EMPTY,
  DENIED_SECTION,
  DENY_LABEL,
  DENY_WARNING,
  EMAIL_LABEL,
  EMAIL_REQUIRED,
  NOTE_LABEL,
  NOTE_MAX_LENGTH,
  PENDING_EMPTY,
  PENDING_SECTION,
  PREAPPROVED_EMPTY,
  PREAPPROVED_HINT,
  PREAPPROVED_SECTION,
  REMOVE_LABEL,
  WORKING_LABEL,
  addedBy,
  approvedToast,
  deniedAgo,
  deniedToast,
  denyTitle,
  githubHandle,
  preapprovedToast,
  removedToast,
  signedInAgo,
} from "./admin";
import {
  addPreapprovedEmail,
  approveAccount,
  denyAccount,
  removePreapprovedEmail,
} from "./admin-actions";

import "./accounts.css";

/** What {@link AdminAccountsScreen} takes — the three lists, and when they were read. */
export interface AdminAccountsScreenProps {
  /** Accounts waiting for approval, newest first. */
  readonly pending: readonly AdminAccount[];
  /** Accounts an administrator refused, newest first. */
  readonly denied: readonly AdminAccount[];
  /** The pre-approved emails. */
  readonly preapproved: readonly PreapprovedEmail[];
  /** When the page was read, ISO 8601 — what every *… ago* counts from, on server and client. */
  readonly readAt: string;
}

/** The page's one toast. */
interface Toast {
  /** What to say. */
  readonly message: string;
  /** `ok` is a `status`; `error` is an `alert` and draws in the error colours. */
  readonly tone: "ok" | "error";
}

/** The section-specific class beside `accounts-card`, a literal per section for the style suite. */
const SECTION_CLASS = {
  pending: "accounts-card accounts-card--pending",
  denied: "accounts-card accounts-card--denied",
  preapproved: "accounts-card accounts-card--preapproved",
} as const;

/**
 * `/admin/accounts` (account approval): who is waiting, who was refused, and which emails are let
 * in ahead of time — for an application administrator.
 *
 * Every write is one Server Action; on success the page says so in a toast and re-reads all
 * three lists (`router.refresh()`), since one write can move an account between them — approving
 * a denied account, or pre-approving the email of somebody waiting. One write at a time: while
 * one is out every other button is inert with the reason *Working…*.
 *
 * **Deny asks first** (an `alertdialog`), because the person is signed out of the product until
 * somebody approves them. Approve does not: it is the undo of a deny and the reason the page
 * exists.
 *
 * @param props See {@link AdminAccountsScreenProps}.
 * @returns The page.
 */
export function AdminAccountsScreen({
  pending,
  denied,
  preapproved,
  readAt,
}: AdminAccountsScreenProps) {
  const router = useRouter();
  const now = new Date(readAt);
  const ids = {
    title: useId(),
    pending: useId(),
    denied: useId(),
    preapproved: useId(),
    warning: useId(),
    email: useId(),
    note: useId(),
  };

  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [denying, setDenying] = useState<AdminAccount | null>(null);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>(undefined);

  const inert = busy !== null ? WORKING_LABEL : undefined;

  /**
   * Send one write, unless another is out; toast the outcome and re-read on success.
   *
   * @param key Which control pressed it — the one whose label reads *Working…*.
   * @param write The Server Action call.
   * @param success The toast for a write that went through, or how to word it from the answer.
   * @returns Whether it went through.
   */
  async function run<T>(
    key: string,
    write: () => Promise<AdminWrite<T>>,
    success: string | ((value: T) => string),
  ): Promise<boolean> {
    if (busy !== null) return false;

    setBusy(key);
    try {
      const outcome = await write();
      if (!outcome.ok) {
        setToast({ message: outcome.reason, tone: "error" });
        return false;
      }
      setToast({
        message: typeof success === "string" ? success : success(outcome.value),
        tone: "ok",
      });
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  }

  /** Deny the account the confirmation is about, closing it first. */
  function confirmDeny(): void {
    if (denying === null) return;

    const account = denying;
    setDenying(null);
    void run(`deny:${account.id}`, () => denyAccount(account.id), deniedToast(account.email));
  }

  /**
   * Pre-approve the typed email.
   *
   * @param event The form's submission.
   */
  async function add(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const typed = email.trim();
    if (typed === "") {
      setEmailError(EMAIL_REQUIRED);
      return;
    }
    setEmailError(undefined);

    // The service says whether the email belonged to somebody waiting — it approved them in
    // the same request — so the toast reads its answer rather than guessing from the list.
    const ok = await run(
      "add",
      () => addPreapprovedEmail(typed, note),
      (added) => preapprovedToast(added.email, added.approvedAccount !== null),
    );

    if (ok) {
      setEmail("");
      setNote("");
    }
  }

  /**
   * One button's label: its own, or *Working…* while its request is out.
   *
   * @param key The control.
   * @param label Its resting label.
   * @returns What to draw.
   */
  function labelFor(key: string, label: string): string {
    return busy === key ? WORKING_LABEL : label;
  }

  return (
    <main aria-labelledby={ids.title} className="accounts-admin">
      <header className="accounts-admin__head">
        <h1 className="accounts-admin__title" id={ids.title}>
          {ADMIN_TITLE}
        </h1>
        <p className="accounts-admin__lead">{ADMIN_LEAD}</p>
      </header>

      <Card aria-labelledby={ids.pending} as="section" className={SECTION_CLASS.pending}>
        <CardHead
          title={PENDING_SECTION}
          titleId={ids.pending}
          trailing={<span className="accounts-card__count">{pending.length}</span>}
        />
        {pending.length === 0 ? (
          <p className="accounts-card__empty">{PENDING_EMPTY}</p>
        ) : (
          <ul className="accounts-list">
            {pending.map((account) => (
              <AccountRow
                account={account}
                key={account.id}
                meta={signedInAgo(account.createdAt, now)}
              >
                <Button
                  onClick={() =>
                    void run(
                      `approve:${account.id}`,
                      () => approveAccount(account.id),
                      approvedToast(account.email),
                    )
                  }
                  reason={inert}
                  size="sm"
                  tone="primary"
                >
                  {labelFor(`approve:${account.id}`, APPROVE_LABEL)}
                </Button>
                <Button
                  onClick={() => setDenying(account)}
                  reason={inert}
                  size="sm"
                  tone="danger"
                >
                  {labelFor(`deny:${account.id}`, DENY_LABEL)}
                </Button>
              </AccountRow>
            ))}
          </ul>
        )}
      </Card>

      <Card aria-labelledby={ids.denied} as="section" className={SECTION_CLASS.denied}>
        <CardHead
          title={DENIED_SECTION}
          titleId={ids.denied}
          trailing={<span className="accounts-card__count">{denied.length}</span>}
        />
        {denied.length === 0 ? (
          <p className="accounts-card__empty">{DENIED_EMPTY}</p>
        ) : (
          <ul className="accounts-list">
            {denied.map((account) => (
              <AccountRow
                account={account}
                key={account.id}
                meta={deniedAgo(
                  account.statusChangedAt,
                  account.statusChangedBy,
                  account.createdAt,
                  now,
                )}
              >
                <Button
                  onClick={() =>
                    void run(
                      `approve:${account.id}`,
                      () => approveAccount(account.id),
                      approvedToast(account.email),
                    )
                  }
                  reason={inert}
                  size="sm"
                >
                  {labelFor(`approve:${account.id}`, APPROVE_LABEL)}
                </Button>
              </AccountRow>
            ))}
          </ul>
        )}
      </Card>

      <Card aria-labelledby={ids.preapproved} as="section" className={SECTION_CLASS.preapproved}>
        <CardHead
          title={PREAPPROVED_SECTION}
          titleId={ids.preapproved}
          trailing={<span className="accounts-card__count">{preapproved.length}</span>}
        />
        <p className="accounts-card__hint">{PREAPPROVED_HINT}</p>
        {preapproved.length === 0 ? (
          <p className="accounts-card__empty">{PREAPPROVED_EMPTY}</p>
        ) : (
          <ul className="accounts-list">
            {preapproved.map((entry) => (
              <li className="accounts-row" key={entry.email}>
                <div className="accounts-row__who">
                  <span className="accounts-row__email">{entry.email}</span>
                  {entry.note !== null && entry.note !== "" && (
                    <span className="accounts-row__note">{entry.note}</span>
                  )}
                  <span className="accounts-row__meta">
                    {addedBy(entry.addedBy, entry.createdAt, now)}
                  </span>
                </div>
                <div className="accounts-row__actions">
                  <Button
                    aria-label={`${REMOVE_LABEL} ${entry.email}`}
                    onClick={() =>
                      void run(
                        `remove:${entry.email}`,
                        () => removePreapprovedEmail(entry.email),
                        removedToast(entry.email),
                      )
                    }
                    reason={inert}
                    size="sm"
                    tone="ghost"
                  >
                    {labelFor(`remove:${entry.email}`, REMOVE_LABEL)}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form className="accounts-add" noValidate onSubmit={(event) => void add(event)}>
          <TextField
            autoComplete="off"
            className="accounts-add__email"
            error={emailError}
            id={ids.email}
            label={EMAIL_LABEL}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
          <TextField
            autoComplete="off"
            className="accounts-add__note"
            id={ids.note}
            label={NOTE_LABEL}
            maxLength={NOTE_MAX_LENGTH}
            onChange={(event) => setNote(event.target.value)}
            value={note}
          />
          <div className="accounts-add__submit">
            <Button reason={inert} type="submit">
              {labelFor("add", ADD_LABEL)}
            </Button>
          </div>
        </form>
      </Card>

      {toast !== null && (
        <p
          className={
            toast.tone === "error" ? "accounts-toast accounts-toast--error" : "accounts-toast"
          }
          role={toast.tone === "error" ? "alert" : "status"}
        >
          {toast.message}
        </p>
      )}

      <ShellOverlay
        describedBy={ids.warning}
        label={denying === null ? "" : denyTitle(denying.email)}
        onClose={() => setDenying(null)}
        open={denying !== null}
        role="alertdialog"
      >
        {denying !== null && (
          <div className="accounts-confirm">
            <h2 className="accounts-confirm__title">{denyTitle(denying.email)}</h2>
            <p className="accounts-confirm__warning" id={ids.warning}>
              {DENY_WARNING}
            </p>
            <div className="accounts-confirm__actions">
              <Button onClick={() => setDenying(null)} type="button">
                {CANCEL_LABEL}
              </Button>
              <Button onClick={confirmDeny} tone="danger">
                {DENY_LABEL}
              </Button>
            </div>
          </div>
        )}
      </ShellOverlay>
    </main>
  );
}

/**
 * One account's row: who, and what the section lets an administrator do about them.
 *
 * @param props.account The account.
 * @param props.meta The row's *when* line — signed in, or denied.
 * @param props.children The row's buttons.
 * @returns The row.
 */
function AccountRow({
  account,
  meta,
  children,
}: Readonly<{ account: AdminAccount; meta: string; children: React.ReactNode }>) {
  const handle = githubHandle(account.githubLogin);

  return (
    <li className="accounts-row">
      <div className="accounts-row__who">
        <span className="accounts-row__name">{account.name}</span>
        <span className="accounts-row__email">{account.email}</span>
        {handle !== null && <span className="accounts-row__github">{handle}</span>}
        <span className="accounts-row__meta">{meta}</span>
      </div>
      <div className="accounts-row__actions">{children}</div>
    </li>
  );
}
