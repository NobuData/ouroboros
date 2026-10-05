"use client";

import { useEffect, useRef, useState } from "react";

import type { WebhookEndpoint, WebhookList } from "@/app/api/settings-webhooks";
import { type Confirmation, ConfirmDialog } from "@/app/members/confirm-dialog";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, EmptyState, Tag, Toggle, cx } from "@/app/ui";

import { DeliveryLog } from "./delivery-log";
import { SecretOnce, type ShownSecret } from "./secret-once";
import {
  createWebhook,
  deleteWebhook,
  pingWebhook,
  readWebhooks,
  rotateWebhookSecret,
  updateWebhook,
} from "./webhook-actions";
import { WebhookForm } from "./webhook-form";
import {
  ACTIVE_WORD,
  ADD_ENDPOINT,
  DELETE,
  DELETE_CONFIRM,
  EDIT,
  ENDPOINTS_EMPTY_NOTE,
  ENDPOINTS_EMPTY_TITLE,
  ENDPOINTS_LOADING,
  HIDE_DELIVERIES,
  NOTICES,
  PAUSED_WORD,
  PING,
  PINGING,
  ROTATE,
  ROTATE_CONFIRM,
  SECRET_MASK,
  SHEET_NOTE,
  SHEET_TITLE,
  SHOW_DELIVERIES,
  SIEM_TAG,
  WORKING,
  type WebhookDraft,
  type WebhookWrite,
  actionLabel,
  activeCountLabel,
  createBody,
  deleteWarning,
  healthLine,
  healthWarns,
  pingSentence,
  rotateWarning,
  switchLabel,
  updateBody,
  withEndpoint,
  withoutEndpoint,
} from "./view";

import "./webhooks.css";

/** Which form is open: the create form, or one endpoint's edit form. */
type FormTarget = { readonly kind: "create" } | { readonly kind: "edit"; readonly id: string };

/** A row's pending destructive action. */
interface PendingAction {
  readonly kind: "rotate" | "delete";
  readonly endpoint: WebhookEndpoint;
}

/** The sheet's one status line. */
interface Notice {
  readonly text: string;
  readonly failed: boolean;
}

/** What a test ping produced for one endpoint: the sentence, and whether it is a failure. */
interface PingResult {
  readonly text: string;
  readonly failed: boolean;
}

/**
 * The **Webhooks** tile's management sheet
 * (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495), over BR.3,
 * [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * The endpoints with their state and health; **+ Add endpoint** and **Edit** (the form,
 * `webhook-form.tsx`); a switch that pauses and enables; **Test ping**, whose delivery row is
 * shown under the endpoint whether it succeeded or failed; **Rotate secret** and **Delete**, each
 * behind a confirmation that states the consequence first; and each endpoint's delivery log with
 * its dead-letter queue (`delivery-log.tsx`).
 *
 * ### The secret is shown once
 *
 * A signing secret arrives in the create and rotate answers and is handed straight to
 * `SecretOnce`; closing that dialog drops it from this component's state. Everywhere else an
 * endpoint's secret is a mask — no read carries one.
 *
 * ### The list is right at once, and then confirmed
 *
 * It starts from the page's own read (`initial`), or reads when opened if that failed. A write's
 * answer is applied to the list immediately, and the list is then read again for the parts no
 * answer carries (each endpoint's health, the SIEM row). The actions also re-read the page, so
 * the tile and the Audit card's SIEM row follow; a newer `initial` arriving replaces the list.
 *
 * Every control here acts at once — none of it joins the page's **Save changes**.
 *
 * @param props.open Whether the sheet is showing.
 * @param props.onClose Close it.
 * @param props.initial The page's read of the endpoints, or `null` when it failed.
 * @returns The sheet, and the dialogs it opens beside it.
 */
export function WebhookSheet({
  open,
  onClose,
  initial,
}: Readonly<{ open: boolean; onClose: () => void; initial: WebhookList | null }>) {
  const [list, setList] = useState<WebhookList | null>(initial);
  const [seen, setSeen] = useState<WebhookList | null>(initial);
  const [unread, setUnread] = useState<string | null>(null);
  const [form, setForm] = useState<FormTarget | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [secret, setSecret] = useState<ShownSecret | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pings, setPings] = useState<Readonly<Record<string, PingResult>>>({});
  const [logs, setLogs] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  // A latch beside the state: two presses inside one frame both read `busy` as free.
  const acting = useRef(false);

  // The page re-read the endpoints: that read is now the truth.
  if (initial !== seen) {
    setSeen(initial);
    if (initial !== null) setList(initial);
  }

  const missing = list === null;

  // Opened with nothing to draw — the page's read failed — so read now.
  useEffect(() => {
    if (!open || !missing) return;

    let current = true;

    void readWebhooks().then((result) => {
      if (!current) return;

      if (result.ok) {
        setList(result.value);
        setUnread(null);
      } else {
        setUnread(result.reason);
      }
    });

    return () => {
      current = false;
    };
  }, [open, missing]);

  /** Read the list again, for what a write's answer does not carry. A failure keeps the list. */
  async function reread(): Promise<void> {
    const result = await readWebhooks();
    if (result.ok) setList(result.value);
  }

  /**
   * Run one row action behind the latch, and say what the service refused.
   *
   * @param id The endpoint the action is on.
   * @param act The action. Returns the sentence to say when it landed, or `null` to say nothing.
   */
  async function run(id: string, act: () => Promise<WebhookWrite<string | null>>): Promise<void> {
    if (acting.current) return;

    acting.current = true;
    setBusy(id);
    setNotice(null);

    try {
      const result = await act();

      if (!result.ok) setNotice({ text: result.reason, failed: true });
      else if (result.value !== null) setNotice({ text: result.value, failed: false });
    } finally {
      acting.current = false;
      setBusy(null);
    }
  }

  /**
   * Pause or enable an endpoint.
   *
   * @param endpoint The endpoint.
   */
  function toggle(endpoint: WebhookEndpoint): void {
    void run(endpoint.id, async () => {
      const result = await updateWebhook(endpoint.id, { active: !endpoint.active });
      if (!result.ok) return result;

      setList((now) => (now === null ? now : withEndpoint(now, result.value)));
      void reread();

      return {
        ok: true,
        value: result.value.active
          ? NOTICES.enabled(result.value.name)
          : NOTICES.paused(result.value.name),
      };
    });
  }

  /**
   * Send a test ping, and show the row it produced under the endpoint.
   *
   * @param endpoint The endpoint.
   */
  function ping(endpoint: WebhookEndpoint): void {
    void run(endpoint.id, async () => {
      const result = await pingWebhook(endpoint.id);

      setPings((now) => ({
        ...now,
        [endpoint.id]: result.ok
          ? { text: pingSentence(result.value), failed: result.value.status !== "succeeded" }
          : { text: result.reason, failed: true },
      }));

      // The result is said under the endpoint, not in the sheet's line.
      return { ok: true, value: null };
    });
  }

  /**
   * Send the form: create an endpoint, or edit one with only what changed.
   *
   * @param draft The form as it stands, already checked.
   * @returns The outcome, for the form to keep a refusal.
   */
  async function submit(draft: WebhookDraft): Promise<WebhookWrite<unknown>> {
    if (form === null) return { ok: true, value: null };

    if (form.kind === "create") {
      const result = await createWebhook(createBody(draft));
      if (!result.ok) return result;

      const { endpoint } = result.value;

      setList((now) => (now === null ? now : withEndpoint(now, endpoint)));
      setSecret({ name: endpoint.name, secret: result.value.secret, rotated: false });
      setNotice({ text: NOTICES.created(endpoint.name), failed: false });
      setForm(null);
      void reread();

      return result;
    }

    const endpoint = list?.items.find((item) => item.id === form.id);
    if (endpoint === undefined) {
      setForm(null);
      return { ok: true, value: null };
    }

    const body = updateBody(draft, endpoint);
    // Nothing changed: nothing is sent, and nothing is claimed to have been saved.
    if (Object.keys(body).length === 0) {
      setForm(null);
      return { ok: true, value: null };
    }

    const result = await updateWebhook(endpoint.id, body);
    if (!result.ok) return result;

    setList((now) => (now === null ? now : withEndpoint(now, result.value)));
    setNotice({ text: NOTICES.updated(result.value.name), failed: false });
    setForm(null);
    void reread();

    return result;
  }

  /**
   * Do the confirmed action. A refusal stays in the confirmation.
   *
   * @returns The outcome, for the dialog.
   */
  async function confirm(): Promise<WebhookWrite<unknown>> {
    if (pending === null) return { ok: true, value: null };

    const { endpoint, kind } = pending;

    if (kind === "rotate") {
      const result = await rotateWebhookSecret(endpoint.id);
      if (!result.ok) return result;

      setPending(null);
      setSecret({ name: endpoint.name, secret: result.value.secret, rotated: true });
      setNotice({ text: NOTICES.rotated(endpoint.name), failed: false });

      return result;
    }

    const result = await deleteWebhook(endpoint.id);
    if (!result.ok) return result;

    setPending(null);
    setList((now) => (now === null ? now : withoutEndpoint(now, endpoint.id)));
    setForm((now) => (now?.kind === "edit" && now.id === endpoint.id ? null : now));
    setNotice({ text: NOTICES.deleted(endpoint.name), failed: false });
    void reread();

    return result;
  }

  /**
   * Show or hide one endpoint's delivery log.
   *
   * @param id The endpoint.
   */
  function toggleLog(id: string): void {
    setLogs((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  const confirmation: Confirmation | null =
    pending === null
      ? null
      : pending.kind === "rotate"
        ? {
            title: actionLabel(ROTATE, pending.endpoint.name),
            warning: rotateWarning(pending.endpoint.name),
            confirm: ROTATE_CONFIRM,
          }
        : {
            title: actionLabel(DELETE, pending.endpoint.name),
            warning: deleteWarning(pending.endpoint),
            confirm: DELETE_CONFIRM,
          };

  const editing = form?.kind === "edit" ? list?.items.find((item) => item.id === form.id) : undefined;

  return (
    <>
      <ShellOverlay label={SHEET_TITLE} onClose={onClose} open={open} wide>
        <div className="webhooks-sheet">
          <div className="webhooks-sheet__head">
            <div>
              <h2 className="shell-overlay__title">{SHEET_TITLE}</h2>
              <p className="shell-overlay__note">{SHEET_NOTE}</p>
            </div>
            {list !== null && (
              <div className="webhooks-sheet__head-actions">
                <Tag>{activeCountLabel(list.activeCount)}</Tag>
                <Button
                  onClick={() => setForm({ kind: "create" })}
                  reason={form === null ? undefined : "Finish the form that is open first."}
                  size="sm"
                  tone="primary"
                >
                  {ADD_ENDPOINT}
                </Button>
              </div>
            )}
          </div>

          {notice !== null && (
            <p
              className={cx("webhooks-sheet__notice", notice.failed && "webhooks-sheet__notice--failed")}
              role={notice.failed ? "alert" : "status"}
            >
              {notice.text}
            </p>
          )}

          {list === null && unread === null && (
            <p className="webhooks-sheet__state" role="status">
              {ENDPOINTS_LOADING}
            </p>
          )}

          {list === null && unread !== null && (
            <p className="webhooks-sheet__state" role="alert">
              {unread}
            </p>
          )}

          {list !== null && form?.kind === "create" && (
            <WebhookForm
              endpoint={null}
              families={list.registry.families}
              onCancel={() => setForm(null)}
              onSubmit={submit}
            />
          )}

          {list !== null && list.items.length === 0 && form === null && (
            <EmptyState note={ENDPOINTS_EMPTY_NOTE} title={ENDPOINTS_EMPTY_TITLE} />
          )}

          {list !== null && list.items.length > 0 && (
            <ul className="webhooks-sheet__list">
              {list.items.map((endpoint) => {
                const inert = busy === null ? undefined : WORKING;
                const pinged = pings[endpoint.id];
                const logOpen = logs.has(endpoint.id);

                return (
                  <li className="webhooks-endpoint" key={endpoint.id}>
                    <div className="webhooks-endpoint__row">
                      <Toggle
                        checked={endpoint.active}
                        label={switchLabel(endpoint)}
                        onClick={() => toggle(endpoint)}
                        reason={inert}
                      />
                      <div className="webhooks-endpoint__what">
                        <span className="webhooks-endpoint__name">
                          {endpoint.name}
                          {endpoint.siem && <Tag>{SIEM_TAG}</Tag>}
                        </span>
                        <span className="webhooks-endpoint__meta">
                          <span className="webhooks-endpoint__mono">{endpoint.host}</span>
                          <span className="webhooks-endpoint__mono">
                            {endpoint.eventFamilies.join(", ")}
                          </span>
                          <span>{endpoint.active ? ACTIVE_WORD : PAUSED_WORD}</span>
                          <span
                            className={cx(
                              "webhooks-endpoint__health",
                              healthWarns(endpoint.health) && "webhooks-endpoint__health--warn",
                            )}
                          >
                            {healthLine(endpoint.health)}
                          </span>
                          <span className="webhooks-endpoint__mono">{SECRET_MASK}</span>
                        </span>
                        {endpoint.description !== null && (
                          <span className="webhooks-endpoint__description">
                            {endpoint.description}
                          </span>
                        )}
                      </div>
                      <div className="webhooks-endpoint__actions">
                        <Button
                          aria-label={actionLabel(PING, endpoint.name)}
                          onClick={() => ping(endpoint)}
                          reason={inert}
                          size="sm"
                        >
                          {busy === endpoint.id ? PINGING : PING}
                        </Button>
                        <Button
                          aria-expanded={logOpen}
                          aria-label={actionLabel(
                            logOpen ? HIDE_DELIVERIES : SHOW_DELIVERIES,
                            endpoint.name,
                          )}
                          onClick={() => toggleLog(endpoint.id)}
                          size="sm"
                          tone="ghost"
                        >
                          {logOpen ? HIDE_DELIVERIES : SHOW_DELIVERIES}
                        </Button>
                        <Button
                          aria-label={actionLabel(EDIT, endpoint.name)}
                          onClick={() => setForm({ kind: "edit", id: endpoint.id })}
                          reason={form === null ? undefined : "Finish the form that is open first."}
                          size="sm"
                          tone="ghost"
                        >
                          {EDIT}
                        </Button>
                        <Button
                          aria-haspopup="dialog"
                          aria-label={actionLabel(ROTATE, endpoint.name)}
                          onClick={() => setPending({ kind: "rotate", endpoint })}
                          size="sm"
                        >
                          {ROTATE}
                        </Button>
                        <Button
                          aria-haspopup="dialog"
                          aria-label={actionLabel(DELETE, endpoint.name)}
                          onClick={() => setPending({ kind: "delete", endpoint })}
                          size="sm"
                          tone="danger"
                        >
                          {DELETE}
                        </Button>
                      </div>
                    </div>

                    {pinged !== undefined && (
                      <p
                        className={cx(
                          "webhooks-endpoint__ping",
                          pinged.failed && "webhooks-endpoint__ping--failed",
                        )}
                        role="status"
                      >
                        {pinged.text}
                      </p>
                    )}

                    {editing?.id === endpoint.id && (
                      <WebhookForm
                        endpoint={endpoint}
                        families={list.registry.families}
                        onCancel={() => setForm(null)}
                        onSubmit={submit}
                      />
                    )}

                    {logOpen && <DeliveryLog endpointId={endpoint.id} endpointName={endpoint.name} />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </ShellOverlay>

      {/* Beside the sheet, not inside it: two overlays nested would share one keyboard trap. */}
      <ConfirmDialog
        confirmation={confirmation}
        onClose={() => setPending(null)}
        onConfirm={confirm}
      />
      <SecretOnce onDone={() => setSecret(null)} shown={secret} />
    </>
  );
}
