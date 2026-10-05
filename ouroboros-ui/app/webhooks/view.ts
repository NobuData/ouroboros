/**
 * The webhook surfaces' copy and rules, as values
 * (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495), over BR.3's endpoints,
 * [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * Three surfaces draw from here: the Integrations card's **Webhooks** management sheet
 * (`webhook-sheet.tsx`), the delivery log both sheets share (`delivery-log.tsx`), and the Audit
 * card's **Stream to SIEM** row (`siem-row.tsx`).
 *
 * ### The SIEM row is a status claim
 *
 * *Stream to SIEM ✓* asserts that the customer's security log has a complete copy. So
 * {@link siemStatus} grants the ✓ on exactly one condition — the service's own `streaming` — and
 * every other case says what is true instead: deliveries dead-lettering, the endpoint paused,
 * nothing delivered yet, a retry queued, no SIEM endpoint at all, or a status that could not be
 * read. Each state is a **word**, never a colour alone.
 *
 * ### A form that cannot send what the service refuses for a reason the browser can see
 *
 * {@link validateDraft} holds the rules a browser can check — a name, an `https` URL, at least one
 * event family, and `audit.*` for the SIEM route. What only the service can know (where the host
 * resolves, whether another endpoint already is the SIEM route) comes back as a refusal and is
 * routed to its field by {@link draftFieldErrors}.
 *
 * Framework-free and pure. A `"use server"` module exports only functions, so the actions'
 * result type lives here too.
 */

import type {
  CreateWebhookRequest,
  UpdateWebhookRequest,
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEndpoint,
  WebhookHealth,
  WebhookList,
} from "@/app/api/settings-webhooks";

/* ------------------------------------------------------------------ what a write answers */

/** What is wrong with a form's fields, by field name. */
export type WebhookFieldErrors = Readonly<Partial<Record<WebhookField, string>>>;

/**
 * An action's outcome: what the service returned, or the sentence that says why not — with the
 * service's errors per field when the refusal carried them.
 */
export type WebhookWrite<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly code: string | null;
      readonly fields?: WebhookFieldErrors;
    };

/** What a write that got no sentence from the service says. */
export const WRITE_FAILED = "The change could not be made. Nothing was changed — try again.";

/** What a read that got no sentence from the service says. */
export const READ_FAILED = "The webhook endpoints could not be read. Try again.";

/**
 * The sentence for a refusal.
 *
 * @param message The service's message, possibly empty.
 * @param fallback What to say when it is.
 * @returns The message, or the fallback.
 */
export function refusalSentence(message: string, fallback: string = WRITE_FAILED): string {
  return message.trim() === "" ? fallback : message;
}

/* ------------------------------------------------------------------ the SIEM row */

/** What every state of the row starts with — mockup 17's own words. */
export const SIEM_LABEL = "Stream to SIEM";

/** The states the row can be in. Only `streaming` is the ✓. */
export type SiemState =
  /** Active, the newest attempt succeeded, nothing dead-lettered. */
  | "streaming"
  /** Events are dead-lettered — the SIEM's record has a hole. */
  | "warning"
  /** The SIEM endpoint is switched off. */
  | "paused"
  /** The newest attempt failed and a retry is queued. */
  | "retrying"
  /** Nothing has been delivered yet. */
  | "idle"
  /** There is a SIEM endpoint and the service does not call it streaming. */
  | "stalled"
  /** No endpoint is the SIEM route. */
  | "unset"
  /** The endpoints could not be read. */
  | "unknown";

/** The row, as it is drawn. */
export interface SiemStatus {
  /** Which state. */
  readonly state: SiemState;
  /** The glyph after the label — `✓` or `⚠` — or `null`. Decoration: the words carry the state. */
  readonly mark: "✓" | "⚠" | null;
  /** What follows the label and its mark — `(webhook)`, `— paused`. */
  readonly detail: string;
  /** The state in words, for the control's accessible name and its tooltip. */
  readonly summary: string;
  /** The SIEM endpoint, or `null` when there is none to open a delivery log for. */
  readonly endpointId: string | null;
  /** The SIEM endpoint's name, or `null`. */
  readonly endpointName: string | null;
}

/**
 * `3 events dead-lettered`.
 *
 * @param count How many.
 * @returns The phrase.
 */
export function deadLetteredPhrase(count: number): string {
  return `${String(count)} event${count === 1 ? "" : "s"} dead-lettered`;
}

/**
 * The *Stream to SIEM* row for a read of the endpoints.
 *
 * @param webhooks The endpoints as read, or `null` when they could not be.
 * @returns The row. The ✓ only when the service says `streaming`.
 */
export function siemStatus(webhooks: WebhookList | null): SiemStatus {
  if (webhooks === null) {
    return {
      state: "unknown",
      mark: null,
      detail: "— status unavailable",
      summary: "The SIEM stream's status could not be read.",
      endpointId: null,
      endpointName: null,
    };
  }

  const { siem } = webhooks;

  if (siem === null) {
    return {
      state: "unset",
      mark: null,
      detail: "— not set up",
      summary: "No webhook endpoint is the SIEM stream.",
      endpointId: null,
      endpointName: null,
    };
  }

  const endpoint = { endpointId: siem.endpointId, endpointName: siem.name };

  if (siem.warning) {
    const dead = deadLetteredPhrase(siem.health.deadLettered);

    return {
      state: "warning",
      mark: "⚠",
      detail: `— deliveries failing (${dead})`,
      summary: `Deliveries to the SIEM are failing: ${dead}. Its record has a hole until they are redelivered.`,
      ...endpoint,
    };
  }

  if (siem.streaming) {
    return {
      state: "streaming",
      mark: "✓",
      detail: "(webhook)",
      summary: "Audit events are being delivered to the SIEM.",
      ...endpoint,
    };
  }

  if (!siem.active) {
    return {
      state: "paused",
      mark: null,
      detail: "— paused",
      summary: "The SIEM endpoint is paused. Nothing is delivered until it is enabled.",
      ...endpoint,
    };
  }

  if (siem.health.state === "retrying") {
    return {
      state: "retrying",
      mark: null,
      detail: "— retrying",
      summary: "The newest delivery to the SIEM failed. A retry is queued.",
      ...endpoint,
    };
  }

  if (siem.health.state === "idle") {
    return {
      state: "idle",
      mark: null,
      detail: "— no deliveries yet",
      summary: "Nothing has been delivered to the SIEM yet.",
      ...endpoint,
    };
  }

  return {
    state: "stalled",
    mark: null,
    detail: "— not delivering",
    summary: "The SIEM endpoint is not confirmed to be delivering.",
    ...endpoint,
  };
}

/** What pressing the row does when there is a SIEM endpoint. */
export const SIEM_OPENS_LOG = "Open the delivery log.";

/** What pressing the row does when there is none. */
export const SIEM_OPENS_ENDPOINTS = "Open the webhook endpoints.";

/**
 * The row's accessible name and tooltip: the state in words, then what a press does.
 *
 * @param status The row.
 * @returns The sentence.
 */
export function siemHint(status: SiemStatus): string {
  return `${status.summary} ${status.endpointId === null ? SIEM_OPENS_ENDPOINTS : SIEM_OPENS_LOG}`;
}

/**
 * The delivery-log sheet's title.
 *
 * @param name The endpoint's name.
 * @returns The title.
 */
export function deliveryLogTitle(name: string): string {
  return `Deliveries · ${name}`;
}

/** What the SIEM sheet says under its title. */
export const SIEM_SHEET_NOTE =
  "Every attempt to deliver an audit event to the SIEM endpoint, newest first. A dead-lettered " +
  "event is missing from the SIEM's record until it is redelivered.";

/* ------------------------------------------------------------------ health and status words */

/** An endpoint's health, in a word. */
export const HEALTH_WORDS: Readonly<Record<WebhookHealth["state"], string>> = {
  idle: "no deliveries yet",
  healthy: "healthy",
  retrying: "retrying",
  dead_lettered: "dead-lettering",
};

/**
 * An endpoint's health as the list says it — the word, and the count when events wait.
 *
 * @param health The endpoint's health.
 * @returns `healthy`, or `dead-lettering · 3 events dead-lettered`.
 */
export function healthLine(health: WebhookHealth): string {
  const word = HEALTH_WORDS[health.state];

  return health.deadLettered > 0 ? `${word} · ${deadLetteredPhrase(health.deadLettered)}` : word;
}

/** Whether an endpoint's health deserves the warning treatment. */
export function healthWarns(health: WebhookHealth): boolean {
  return health.state === "dead_lettered" || health.deadLettered > 0;
}

/** An attempt's status, in a word. */
export const STATUS_WORDS: Readonly<Record<WebhookDeliveryStatus, string>> = {
  pending: "pending",
  succeeded: "succeeded",
  failed: "failed",
  dead_lettered: "dead-lettered",
};

/** What an endpoint that delivers says. */
export const ACTIVE_WORD = "active";

/** What an endpoint that is switched off says. */
export const PAUSED_WORD = "paused";

/** The tag on the SIEM route. */
export const SIEM_TAG = "SIEM";

/* ------------------------------------------------------------------ time, codes, latencies */

/** What an absent figure is drawn as. */
export const NONE = "—";

/**
 * An instant as `2026-10-05 14:31:07`, in UTC — the zone the column names once.
 *
 * @param at An ISO-8601 instant.
 * @returns The stamp, or the input when it is not a date.
 */
export function attemptStamp(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;

  const pad = (value: number): string => String(value).padStart(2, "0");

  return (
    `${String(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

/**
 * An attempt's HTTP code.
 *
 * @param code The receiver's status, or `null` when it never answered.
 * @returns The code, or {@link NONE}.
 */
export function codeOf(code: number | null): string {
  return code === null ? NONE : String(code);
}

/**
 * An attempt's latency.
 *
 * @param latencyMs Milliseconds to the receiver's answer, or `null`.
 * @returns `182 ms`, or {@link NONE}.
 */
export function latencyOf(latencyMs: number | null): string {
  return latencyMs === null ? NONE : `${String(latencyMs)} ms`;
}

/**
 * What an attempt has to say for itself: the failure reason, else the receiver's answer.
 *
 * @param delivery The attempt.
 * @returns The text, or {@link NONE}.
 */
export function detailOf(delivery: WebhookDelivery): string {
  return delivery.error ?? delivery.responseExcerpt ?? NONE;
}

/* ------------------------------------------------------------------ the delivery log */

/** How many attempts one page of the log holds. */
export const DELIVERY_PAGE_SIZE = 25;

/** Which part of the log is shown. */
export type DeliveryFilter = "all" | "dead_lettered";

/** The filter's two choices, in order. */
export const DELIVERY_FILTERS: readonly { readonly id: DeliveryFilter; readonly label: string }[] = [
  { id: "all", label: "All attempts" },
  { id: "dead_lettered", label: "Dead-lettered" },
];

/** The filter group's accessible name. */
export const DELIVERY_FILTER_LABEL = "Which attempts";

/** The log's column headings. */
export const DELIVERY_COLUMNS = {
  at: "When (UTC)",
  event: "Event",
  attempt: "Attempt",
  status: "Status",
  code: "HTTP",
  latency: "Latency",
  detail: "Error / response",
  action: "Redeliver",
} as const;

/** While the log is being read. */
export const DELIVERIES_LOADING = "Reading the delivery log…";

/** A log with nothing in it. */
export const DELIVERIES_EMPTY = "Nothing has been sent to this endpoint yet.";

/** A dead-letter queue with nothing in it. */
export const DLQ_EMPTY = "No dead-lettered events. Nothing is waiting to be redelivered.";

/** What a log that could not be read says when the service gave no sentence. */
export const DELIVERIES_FAILED = "The delivery log could not be read. Try again.";

/** The button on a dead-lettered row. */
export const REDELIVER = "Redeliver";

/** The same button, while its request is out. */
export const REDELIVERING = "Redelivering…";

/** The pager's two directions. The log is newest first, so *older* is the next page. */
export const NEWER = "Newer";
export const OLDER = "Older";

/**
 * Which rows of how many a page shows — `1–25 of 132` — so a log is never silently cut short.
 *
 * @param offset How many rows were skipped.
 * @param count How many rows the page holds.
 * @param total How many rows the log holds.
 * @returns The range, or `0 of 0` for an empty page.
 */
export function rangeLabel(offset: number, count: number, total: number): string {
  if (count === 0) return `0 of ${String(total)}`;

  return `${String(offset + 1)}–${String(offset + count)} of ${String(total)}`;
}

/**
 * The **Redeliver** button's accessible name for one row.
 *
 * @param delivery The dead-lettered attempt.
 * @returns The name.
 */
export function redeliverLabel(delivery: WebhookDelivery): string {
  return `${REDELIVER} ${delivery.eventType}, attempt ${String(delivery.attempt)}`;
}

/**
 * What a queued redelivery says.
 *
 * @param delivery The new pending attempt.
 * @returns The sentence.
 */
export function redeliveredSentence(delivery: WebhookDelivery): string {
  return (
    `${delivery.eventType} was queued again as attempt ${String(delivery.attempt)}. It gets one ` +
    "try: success clears it from the dead-letter queue, failure returns it there."
  );
}

/* ------------------------------------------------------------------ the test ping */

/** The per-endpoint button. */
export const PING = "Test ping";

/** The same button, while its request is out. */
export const PINGING = "Pinging…";

/**
 * What a test ping's delivery row says, success or failure.
 *
 * @param delivery The delivery-log row the ping produced.
 * @returns `Ping succeeded · HTTP 200 · 182 ms`, or the failure with its reason.
 */
export function pingSentence(delivery: WebhookDelivery): string {
  const outcome = delivery.status === "succeeded" ? "Ping succeeded" : `Ping ${STATUS_WORDS[delivery.status]}`;
  const parts = [outcome];

  if (delivery.responseCode !== null) parts.push(`HTTP ${String(delivery.responseCode)}`);
  if (delivery.latencyMs !== null) parts.push(latencyOf(delivery.latencyMs));
  if (delivery.status !== "succeeded" && delivery.error !== null) parts.push(delivery.error);

  return parts.join(" · ");
}

/* ------------------------------------------------------------------ the sheet */

/** The management sheet's title. */
export const SHEET_TITLE = "Webhook endpoints";

/** What the sheet says under its title. */
export const SHEET_NOTE =
  "Where this workspace's events are delivered, signed with a per-endpoint secret. Every " +
  "control here acts at once.";

/** While the endpoints are being read. */
export const ENDPOINTS_LOADING = "Reading the webhook endpoints…";

/** A workspace with no endpoint. */
export const ENDPOINTS_EMPTY_TITLE = "No webhook endpoints";
export const ENDPOINTS_EMPTY_NOTE =
  "Add one to deliver audit, decision, run and pull-request events to a URL of yours.";

/** The sheet's create action. */
export const ADD_ENDPOINT = "+ Add endpoint";

/** A row's actions. */
export const EDIT = "Edit";
export const ROTATE = "Rotate secret";
export const DELETE = "Delete";
export const SHOW_DELIVERIES = "Deliveries";
export const HIDE_DELIVERIES = "Hide deliveries";

/** A request is out. */
export const WORKING = "Working…";

/** Dismiss a form or a dialog without acting. */
export const CANCEL = "Cancel";

/**
 * A row action's accessible name — the action and whose it is.
 *
 * @param action What it does.
 * @param name The endpoint's name.
 * @returns `Edit siem-forwarder`.
 */
export function actionLabel(action: string, name: string): string {
  return `${action} ${name}`;
}

/**
 * The switch's accessible name: what pressing it would do.
 *
 * @param endpoint The endpoint.
 * @returns `Pause siem-forwarder`, or `Enable siem-forwarder`.
 */
export function switchLabel(endpoint: Pick<WebhookEndpoint, "name" | "active">): string {
  return `${endpoint.active ? "Pause" : "Enable"} ${endpoint.name}`;
}

/**
 * `2 active` — the sheet's count, the same the Integrations tile prints.
 *
 * @param count How many endpoints are active.
 * @returns The phrase.
 */
export function activeCountLabel(count: number): string {
  return `${String(count)} active`;
}

/** What each landed write says in the sheet's status line. */
export const NOTICES = {
  created: (name: string): string => `${name} was created.`,
  updated: (name: string): string => `${name} was saved.`,
  enabled: (name: string): string => `${name} is enabled. Queued attempts are delivered now.`,
  paused: (name: string): string =>
    `${name} is paused. Attempts queued for it wait until it is enabled again.`,
  deleted: (name: string): string => `${name} and its delivery log were deleted.`,
  rotated: (name: string): string => `${name}'s signing secret was rotated.`,
} as const;

/* ------------------------------------------------------------------ confirmations */

/** The confirming buttons. */
export const ROTATE_CONFIRM = "Rotate secret";
export const DELETE_CONFIRM = "Delete endpoint";

/**
 * What rotating a secret does, said before it does.
 *
 * @param name The endpoint's name.
 * @returns The warning.
 */
export function rotateWarning(name: string): string {
  return (
    `The current signing secret of ${name} stops signing at once: every delivery from this ` +
    "moment is signed with the new one, and a receiver still checking the old one will reject " +
    "them. The new secret is shown once."
  );
}

/**
 * What deleting an endpoint does, said before it does.
 *
 * @param endpoint The endpoint.
 * @returns The warning — naming the SIEM stream when this is it.
 */
export function deleteWarning(endpoint: Pick<WebhookEndpoint, "name" | "siem">): string {
  const base =
    `${endpoint.name} stops receiving events and its delivery log is deleted with it. This ` +
    "cannot be undone.";

  return endpoint.siem ? `${base} It is the SIEM stream: audit events stop reaching the SIEM.` : base;
}

/* ------------------------------------------------------------------ the one-time secret */

/** The secret dialog's title. */
export const SECRET_TITLE = "Signing secret";

/** Why the secret must be copied now. */
export const SECRET_WARNING =
  "This is the only time this secret is shown. It is stored sealed and cannot be read back — " +
  "if it is lost, rotate the secret to get a new one.";

/** The dialog's one way out. */
export const SECRET_DONE = "I have copied it";

/** What stands where a secret would be, everywhere but that dialog. */
export const SECRET_MASK = "secret ••••••••";

/**
 * What the secret dialog says above the value.
 *
 * @param name The endpoint's name.
 * @param rotated Whether it replaced an older secret.
 * @returns The sentence.
 */
export function secretLead(name: string, rotated: boolean): string {
  return rotated
    ? `The new signing secret of ${name}. The old one signs nothing from this moment.`
    : `The signing secret of ${name}. Deliveries are signed with it (HMAC-SHA256).`;
}

/* ------------------------------------------------------------------ the form */

/** The form's fields. */
export type WebhookField = "name" | "url" | "description" | "families" | "siem";

/** An endpoint as the form holds it. */
export interface WebhookDraft {
  /** What the endpoint is called. */
  readonly name: string;
  /** Where events are delivered. */
  readonly url: string;
  /** What it is for. Empty means none. */
  readonly description: string;
  /** The subscribed families and exact event types. */
  readonly families: readonly string[];
  /** Whether it is the workspace's SIEM route. */
  readonly siem: boolean;
}

/** The form's titles, labels and hints. */
export const FORM_CREATE_TITLE = "Add endpoint";
export const FORM_NAME = "Name";
export const FORM_URL = "URL";
export const FORM_URL_HINT =
  "https only. The host must resolve to an external address — internal targets are refused.";
export const FORM_DESCRIPTION = "Description";
export const FORM_DESCRIPTION_HINT = "Optional — what receives these events.";
export const FORM_FAMILIES = "Event families";
export const FORM_SIEM = "Use as the SIEM stream";
export const FORM_SIEM_HINT =
  "At most one endpoint is the SIEM stream, and it must subscribe to audit.*.";
export const FORM_SECRET_NOTE =
  "The signing secret is minted by the service and shown once, right after the endpoint is created.";
export const FORM_CREATE = "Create endpoint";
export const FORM_SAVE = "Save endpoint";
export const FORM_SAVING = "Saving…";

/** The family the SIEM route must subscribe to. */
export const AUDIT_FAMILY = "audit.*";

/** What the browser's checks say. */
export const NAME_REQUIRED = "Give the endpoint a name.";
export const URL_REQUIRED = "Give the URL events are delivered to.";
export const URL_INVALID = "This is not a URL.";
export const URL_NOT_HTTPS = "The URL must be https.";
export const FAMILIES_REQUIRED = "Choose at least one event family.";
export const SIEM_NEEDS_AUDIT = "The SIEM stream must subscribe to audit.*.";

/**
 * The edit form's title.
 *
 * @param name The endpoint's name.
 * @returns The title.
 */
export function formEditTitle(name: string): string {
  return `Edit ${name}`;
}

/** A form with nothing in it. */
export const EMPTY_DRAFT: WebhookDraft = {
  name: "",
  url: "",
  description: "",
  families: [],
  siem: false,
};

/**
 * An endpoint as the form holds it.
 *
 * @param endpoint The endpoint to edit.
 * @returns The draft.
 */
export function draftOf(endpoint: WebhookEndpoint): WebhookDraft {
  return {
    name: endpoint.name,
    url: endpoint.url,
    description: endpoint.description ?? "",
    families: endpoint.eventFamilies,
    siem: endpoint.siem,
  };
}

/**
 * The choices the family picker offers: the registry's families, then anything the endpoint
 * already subscribes to that is not one of them (an exact event type), so an edit never drops a
 * subscription by not drawing it.
 *
 * @param registryFamilies The registry's family wildcards.
 * @param subscribed What the endpoint subscribes to now.
 * @returns The choices, in order, each once.
 */
export function familyChoices(
  registryFamilies: readonly string[],
  subscribed: readonly string[],
): readonly string[] {
  return [...registryFamilies, ...subscribed.filter((entry) => !registryFamilies.includes(entry))];
}

/**
 * A draft's families with one switched.
 *
 * @param families The subscribed families.
 * @param family The one pressed.
 * @returns The list without it when it was there, with it when it was not.
 */
export function toggleFamily(families: readonly string[], family: string): readonly string[] {
  return families.includes(family)
    ? families.filter((entry) => entry !== family)
    : [...families, family];
}

/**
 * Check a draft in the browser, before anything is sent.
 *
 * @param draft The form as it stands.
 * @returns An error per field that is wrong; empty when the draft may be sent.
 */
export function validateDraft(draft: WebhookDraft): WebhookFieldErrors {
  const errors: Partial<Record<WebhookField, string>> = {};
  const url = draft.url.trim();

  if (draft.name.trim() === "") errors.name = NAME_REQUIRED;

  if (url === "") {
    errors.url = URL_REQUIRED;
  } else if (!URL.canParse(url)) {
    errors.url = URL_INVALID;
  } else if (new URL(url).protocol !== "https:") {
    errors.url = URL_NOT_HTTPS;
  }

  if (draft.families.length === 0) errors.families = FAMILIES_REQUIRED;
  else if (draft.siem && !draft.families.includes(AUDIT_FAMILY)) errors.siem = SIEM_NEEDS_AUDIT;

  return errors;
}

/**
 * The body that creates the endpoint a draft describes.
 *
 * @param draft A draft {@link validateDraft} passed.
 * @returns The request. An empty description is sent as none.
 */
export function createBody(draft: WebhookDraft): CreateWebhookRequest {
  const description = draft.description.trim();

  return {
    name: draft.name.trim(),
    url: draft.url.trim(),
    eventFamilies: [...draft.families],
    siem: draft.siem,
    ...(description === "" ? {} : { description }),
  };
}

/**
 * Whether two family lists subscribe to the same things, in any order.
 *
 * @param a One list.
 * @param b The other.
 * @returns `true` when they hold the same entries.
 */
function sameFamilies(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry) => b.includes(entry));
}

/**
 * The body that edits an endpoint into what a draft describes — **only what changed**.
 *
 * @param draft A draft {@link validateDraft} passed.
 * @param endpoint The endpoint as stored.
 * @returns The request; an empty object when nothing changed, which a caller does not send.
 */
export function updateBody(draft: WebhookDraft, endpoint: WebhookEndpoint): UpdateWebhookRequest {
  const body: UpdateWebhookRequest = {};
  const name = draft.name.trim();
  const url = draft.url.trim();
  const description = draft.description.trim();

  if (name !== endpoint.name) body.name = name;
  if (url !== endpoint.url) body.url = url;
  if (description !== (endpoint.description ?? "")) {
    body.description = description === "" ? null : description;
  }
  if (!sameFamilies(draft.families, endpoint.eventFamilies)) body.eventFamilies = [...draft.families];
  if (draft.siem !== endpoint.siem) body.siem = draft.siem;

  return body;
}

/** The service's field paths, and the form field each belongs to. */
const FIELD_OF: Readonly<Record<string, WebhookField>> = {
  name: "name",
  url: "url",
  description: "description",
  eventFamilies: "families",
  siem: "siem",
};

/**
 * Route a refusal's `details.fields` to the form's fields.
 *
 * @param details The `ApiError`'s details.
 * @returns The first message of each field the form draws; empty when the refusal named none.
 */
export function draftFieldErrors(details: unknown): WebhookFieldErrors {
  if (typeof details !== "object" || details === null) return {};
  const fields = (details as { fields?: unknown }).fields;
  if (typeof fields !== "object" || fields === null) return {};

  const errors: Partial<Record<WebhookField, string>> = {};

  for (const [path, messages] of Object.entries(fields as Record<string, unknown>)) {
    // `eventFamilies.0` is still the families' error.
    const field = FIELD_OF[path.split(".")[0]];
    const first: unknown = Array.isArray(messages) ? messages[0] : messages;

    if (field !== undefined && errors[field] === undefined && typeof first === "string" && first !== "") {
      errors[field] = first;
    }
  }

  return errors;
}

/* ------------------------------------------------------------------ the list, kept in step */

/**
 * A list with one endpoint added or replaced, and its count recounted.
 *
 * The sheet applies a write's answer with this so it is right at once; the re-read that follows
 * brings the derived parts (the SIEM row, each endpoint's health) the answer does not carry.
 *
 * @param list The list as the sheet holds it.
 * @param endpoint The endpoint a write answered with.
 * @returns A new list. A new endpoint goes first, as the service lists newest first.
 */
export function withEndpoint(list: WebhookList, endpoint: WebhookEndpoint): WebhookList {
  const known = list.items.some((item) => item.id === endpoint.id);
  const items = known
    ? list.items.map((item) => (item.id === endpoint.id ? endpoint : item))
    : [endpoint, ...list.items];

  return { ...list, items, activeCount: items.filter((item) => item.active).length };
}

/**
 * A list without one endpoint, and its count recounted.
 *
 * @param list The list as the sheet holds it.
 * @param id The deleted endpoint.
 * @returns A new list; the SIEM row is dropped when it was that endpoint's.
 */
export function withoutEndpoint(list: WebhookList, id: string): WebhookList {
  const items = list.items.filter((item) => item.id !== id);

  return {
    ...list,
    items,
    activeCount: items.filter((item) => item.active).length,
    siem: list.siem?.endpointId === id ? null : list.siem,
  };
}
