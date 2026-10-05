/**
 * What the Needs-You leg (`specs/inbox.spec.ts`, [#470](https://github.com/NobuData/ouroboros/issues/470),
 * BO.5) reads and writes besides the browser: the inbox's own REST surface, read and answered as a
 * signed-in person; the daily digest's preferences and the answer links it carries; one claim-waiver
 * card filed the way its emitter files one; and the seeded GitHub source's sealed credential, put
 * back after the leg has connected it.
 *
 * Every value here is either the product's own words — copied from `ouroboros-ui/app/inbox/*-view.ts`
 * and the V093 kind declarations, where the unit suites hold them — or a fact of
 * `R__dev_seed_workspace_triage_inbox.sql` (#460), copied on purpose for `support/seed.ts`'s
 * reason: a suite that derived its expectation from the seed would agree with a broken one.
 *
 * ## Why the reads here are not the assertions
 *
 * The page is what the leg asserts against. These reads are the *effect* half of each assertion —
 * the badge fell **because** `GET /api/v1/inbox/feed` counts one fewer, the card moved **because**
 * the service woke the item — so a page that drew the right thing for the wrong reason, or a
 * service that recorded nothing behind a receipt the page invented, both go red.
 *
 * ## Where the answer links go
 *
 * A digest's link is `${OURO_UI_URL}/api/v1/inbox/answer/<token>`: the UI's origin, which forwards
 * exactly that one family of `/api/v1` to `ouroboros-rest` (`ouroboros-ui/proxy.ts` § 1b) because a
 * mail reader's browser travels it. {@link answerPage} follows it there, at {@link UI_URL} — the
 * address this run reaches the stack at — so the leg walks the hop a person clicking the mail does.
 */
import { randomUUID } from "node:crypto";

import type { BrowserContext } from "@playwright/test";

import { psql } from "./insights";
import { SESSION_COOKIE, sessionTokenOf } from "./session";
import { REST_URL, UI_URL } from "./stack";

/** The page's route. */
export const INBOX_PATH = "/inbox";

/* ------------------------------------------------------------------ the seed (#460) */

/** The seeded PR the merge card is about, and the claim-waiver card the leg files is about. */
export const SEEDED_PR_ID = "5eed007c-0000-4000-8000-000000000504";

/**
 * The seed's decision items, by the literal ids it gives them.
 *
 * Three cards open at load. The claim waiver is **not** one the leg can answer: its PR #514
 * criterion is already waived (#356), so `DecisionSourceSweeper` closes it as
 * `policy(source_resolved)` within a minute of `rest` starting — the seed's own header says so —
 * and the leg waits for that rather than racing it. The protected-path card on loop #1844 is not
 * one *Allow once* can clear either: the seeded run has no driver to re-report its change-set, so
 * its re-evaluation still fails and the service answers `409 allow_once_still_blocked`. The leg
 * answers it **Deny**, from the digest — which is what makes inbox zero reachable.
 */
export const SEEDED_ITEMS = {
  /** `merge_approval` — PR #504, loop #1830; `err`, merge-class. */
  merge: "5eed0082-0000-4000-8000-000000000001",
  /** `protected_path_allow_once` — loop #1844, `boot/rollback_flag.c`; `warn`. */
  protectedPath: "5eed0082-0000-4000-8000-000000000002",
  /** `claim_waiver` — PR #514's thermal claim; swept as settled at its source. */
  sweptWaiver: "5eed0082-0000-4000-8000-000000000003",
  /** `fact_review` — the `k_msgq` fact, snoozed by Ken until tomorrow 09:00 UTC. */
  snoozedFact: "5eed0082-0000-4000-8000-000000000201",
} as const;

/** The questions the four kinds the leg answers render — V093/V097's templates, filled. */
export const QUESTIONS = {
  merge: "Approve merge for a refactor PR?",
  protectedPath: "Allow a one-time edit to a protected path?",
  waiver: "Waive a claim the bench can't verify?",
  fact: "Should the loops trust this fact?",
} as const;

/** The action labels the leg presses or follows, as V093 declares them. */
export const ACTIONS = {
  approve: { id: "approve_merge", label: "Approve & merge" },
  returnToLoop: { id: "return_to_loop", label: "Return to loop with note" },
  allowOnce: { id: "allow_once", label: "Allow once" },
  deny: { id: "deny", label: "Deny" },
  waive: { id: "waive_annotate", label: "Waive & annotate" },
} as const;

/**
 * The week the seed composes (`R__dev_seed_workspace_triage_inbox.sql`'s table): eleven answers,
 * latencies whose middle one is 41 s, and a longest loop wait of six minutes — the closure the
 * sweeper makes is left out of every figure (V097).
 */
export const SEEDED_STATS = {
  decisions: 11,
  value: "11 decisions",
  delta: "median answer time 41s · loops never waited longer than 6m",
} as const;

/** The page's own words the leg looks for — `ouroboros-ui/app/inbox/*-view.ts`. */
export const COPY = {
  queue: "Decisions waiting",
  snoozed: "Snoozed",
  resolved: "Resolved decisions",
  statsTitle: "This week",
  statsMethod: "How these figures are measured",
  zeroLabel: "Inbox zero",
  zeroLine: "Inbox zero. The loop is turning on its own.",
  zeroNote: "You'll be pinged only when policy says so.",
  unreadableQueue: "The inbox could not be read.",
  wakeNow: "Wake now",
  note: "Note",
  badgeLabel: "waiting in Needs You",
} as const;

/* ------------------------------------------------------------------ the REST surface */

/** One action on a card, resolved against the reader (`InboxAction`). */
export interface InboxAction {
  readonly id: string;
  readonly label: string;
  readonly allowed: boolean;
  readonly disabledReason: string | null;
  readonly navigates: boolean;
}

/** A ref, with the page it leads to. */
export interface InboxRef {
  readonly type: string;
  readonly id: string;
  readonly label: string;
}

/** One asking item, as `GET /api/v1/inbox` renders it. */
export interface InboxItem {
  readonly id: string;
  readonly kindId: string;
  readonly severity: "err" | "warn" | "info";
  readonly question: string;
  readonly refs: readonly InboxRef[];
  readonly mergeClass: boolean;
  readonly actions: readonly InboxAction[];
  readonly createdAt: string;
  readonly ageSeconds: number;
}

/** One snoozed item. */
export interface InboxSnoozedItem {
  readonly id: string;
  readonly kindId: string;
  readonly question: string;
  readonly createdAt: string;
  readonly ageSeconds: number;
  readonly snoozedUntil: string;
}

/** `GET /api/v1/inbox`. */
export interface InboxQueue {
  readonly head: { readonly count: number; readonly sentence: string };
  readonly items: readonly InboxItem[];
  readonly snoozed: readonly InboxSnoozedItem[];
  readonly asOf: string;
}

/** `GET /api/v1/inbox/feed` — what the sidebar badge draws. */
export interface InboxFeed {
  readonly open: number;
  readonly snoozed: number;
}

/** `GET /api/v1/inbox/stats`. */
export interface InboxStats {
  readonly week: string;
  readonly decisions: number | null;
  readonly display: {
    readonly decisions: string;
    readonly medianAnswer: string;
    readonly maxLoopWait: string;
  };
}

/** One row of `GET /api/v1/inbox/resolved`. */
export interface InboxResolvedRow {
  readonly itemId: string;
  readonly kindId: string;
  readonly subject: string;
  readonly verdict: string;
  readonly actionId: string;
  readonly resolver: "human" | "policy";
  readonly policy: string | null;
  readonly actor: { readonly id: string; readonly name: string } | null;
  readonly channel: string;
  readonly outcome: Readonly<Record<string, unknown>>;
}

/** `GET /api/v1/inbox/resolved`. */
export interface InboxResolved {
  readonly day: string;
  readonly count: number;
  readonly rows: readonly InboxResolvedRow[];
}

/** What an answer came to: the status, and the document either way. */
export interface Answered {
  readonly status: number;
  readonly body: {
    /** On `200` — the resolution and its receipt. */
    readonly resolution?: InboxResolvedRow & { readonly resolvedAt: string };
    readonly receipt?: { readonly effects: readonly string[] };
    /** On a refusal — the error envelope (`docs/ARCHITECTURE.md` § 5.3). */
    readonly code?: string;
    readonly message?: string;
    readonly details?: {
      readonly resolution?: { readonly actor: { readonly name: string } | null };
    };
  };
}

/**
 * Call the inbox's REST surface as the context's person, **without** insisting it worked.
 *
 * `support/rest.ts`'s `requestAs` throws on any refusal, which is right for arranging state and
 * wrong here: half of this leg's assertions are about *what* the service refused, and with which
 * code — a member's `403`, a race's `409`.
 *
 * @param context - A signed-in context, already in the seeded workspace.
 * @param method - `GET` or `POST`.
 * @param path - The path under `/api/v1/inbox`, beginning with a slash, or empty.
 * @param body - The request body, or `null`.
 * @returns The status and the parsed document.
 */
export async function inboxCallAs(
  context: BrowserContext,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body: Readonly<Record<string, unknown>> | null,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const token = await sessionTokenOf(context, `${method} /api/v1/inbox${path}`);
  const response = await fetch(`${REST_URL}/api/v1/inbox${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: body === null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();

  return { status: response.status, body: text === "" ? null : (JSON.parse(text) as unknown) };
}

/**
 * Read one of the inbox's documents, and insist it answered.
 *
 * @param context - A signed-in context.
 * @param path - The path under `/api/v1/inbox`.
 * @returns The document.
 * @throws When the service refused, with what it said.
 */
async function read<Answer>(context: BrowserContext, path: string): Promise<Answer> {
  const { status, body } = await inboxCallAs(context, "GET", path, null);

  if (status !== 200) {
    throw new Error(`GET /api/v1/inbox${path} answered ${status}: ${JSON.stringify(body)}`);
  }

  return body as Answer;
}

/**
 * The queue — which also wakes every snooze that has run out (`decision_items_wake` runs on every
 * read, V095), exactly as the page's own poll does.
 *
 * @param context - A signed-in context.
 * @returns The queue.
 */
export function inboxQueue(context: BrowserContext): Promise<InboxQueue> {
  return read<InboxQueue>(context, "");
}

/**
 * The badge's count.
 *
 * @param context - A signed-in context.
 * @returns The feed.
 */
export function inboxFeed(context: BrowserContext): Promise<InboxFeed> {
  return read<InboxFeed>(context, "/feed");
}

/**
 * The week's figures.
 *
 * @param context - A signed-in context.
 * @returns The stats.
 */
export function inboxStats(context: BrowserContext): Promise<InboxStats> {
  return read<InboxStats>(context, "/stats");
}

/**
 * Today's resolved decisions, in the service's UTC day.
 *
 * @param context - A signed-in context.
 * @returns The day.
 */
export function inboxResolved(context: BrowserContext): Promise<InboxResolved> {
  return read<InboxResolved>(context, "/resolved");
}

/**
 * Answer an item as the context's person — the same `POST` the card makes.
 *
 * @param context - A signed-in context.
 * @param itemId - The item.
 * @param actionId - The declared action.
 * @param idempotencyKey - The attempt's key. Two presses that must race carry two keys: one key
 *   twice is a replay, which the service answers with the first attempt's result by design.
 * @param note - The note, for an action that takes one.
 * @returns What the service answered — never thrown.
 */
export async function answerAs(
  context: BrowserContext,
  itemId: string,
  actionId: string,
  idempotencyKey: string,
  note?: string,
): Promise<Answered> {
  const answered = await inboxCallAs(
    context,
    "POST",
    `/items/${encodeURIComponent(itemId)}/actions/${encodeURIComponent(actionId)}`,
    { idempotencyKey, ...(note === undefined ? {} : { note }) },
  );

  return answered as Answered;
}

/**
 * Snooze one item for some minutes.
 *
 * The page offers an hour, four or a day; the service takes any whole number from one
 * (`InboxSnoozeDto`), and one is what lets the leg watch a snooze run out inside its budget.
 *
 * @param context - A signed-in context holding a snoozing role.
 * @param itemId - The item.
 * @param minutes - How long.
 * @returns When woken, ISO-8601.
 * @throws When the service refused.
 */
export async function snoozeItem(
  context: BrowserContext,
  itemId: string,
  minutes: number,
): Promise<string> {
  const { status, body } = await inboxCallAs(
    context,
    "POST",
    `/items/${encodeURIComponent(itemId)}/snooze`,
    { minutes, reason: "e2e: the snooze leg (#470)" },
  );

  if (status !== 200) {
    throw new Error(`snoozing ${itemId} answered ${status}: ${JSON.stringify(body)}`);
  }

  return (body as { until: string }).until;
}

/** One person's notification preferences, as `GET /api/v1/inbox/notifications` answers them. */
export interface NotificationPreferences {
  readonly digest: {
    readonly enabled: boolean;
    readonly time: string;
    readonly nextSendAt: string | null;
  };
}

/**
 * Read or change the context's person's notification preferences.
 *
 * @param context - A signed-in context.
 * @param patch - The fields to change, or `null` to read.
 * @returns The preferences after.
 * @throws When the service refused.
 */
export async function notificationPreferences(
  context: BrowserContext,
  patch: Readonly<{ digestEnabled?: boolean; digestTime?: string }> | null,
): Promise<NotificationPreferences> {
  const { status, body } = await inboxCallAs(
    context,
    patch === null ? "GET" : "PATCH",
    "/notifications",
    patch,
  );

  if (status !== 200) {
    throw new Error(`notification preferences answered ${status}: ${JSON.stringify(body)}`);
  }

  return body as NotificationPreferences;
}

/**
 * The current UTC minute as the digest's clock spells it — `HH:MM`.
 *
 * A digest is due at its time and for six hours after, once twenty hours have passed since the last
 * (`digest.schedule.ts`), so setting it to *now* makes the scheduler's next tick send.
 *
 * @param now - The instant.
 * @returns `14:07`.
 */
export function utcMinute(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");

  return `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
}

/** A run's timeline, as the run console's `GET /api/v1/runs/{id}` reads it. */
export interface RunTimeline {
  readonly timeline: {
    readonly stages: readonly { readonly stageKey: string; readonly status: string }[];
  };
}

/**
 * One stage's latest status on a run.
 *
 * @param context - A signed-in context.
 * @param runId - The run.
 * @param stageKey - The stage — `implement`.
 * @returns `succeeded`, `failed`, `active`, … or `undefined` when the run never reached it.
 */
export async function stageStatus(
  context: BrowserContext,
  runId: string,
  stageKey: string,
): Promise<string | undefined> {
  const token = await sessionTokenOf(context, `reading run ${runId}`);
  const response = await fetch(`${REST_URL}/api/v1/runs/${encodeURIComponent(runId)}`, {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });

  if (!response.ok) throw new Error(`GET /api/v1/runs/${runId} answered ${response.status}`);

  const run = (await response.json()) as RunTimeline;

  return run.timeline.stages.find((stage) => stage.stageKey === stageKey)?.status;
}

/* ------------------------------------------------------------------ the digest's links */

/** One answer link in a digest. */
export interface DigestLink {
  /** The link's token — what follows `/api/v1/inbox/answer/`. */
  readonly token: string;
  /** Whether its line said it asks for a session first — the merge-class marker. */
  readonly asksToSignIn: boolean;
}

/** One card's answer links in a digest, keyed by the action's label. */
export type DigestCardLinks = ReadonlyMap<string, DigestLink>;

/** An action's line: `  <label>[ (asks you to sign in first)]: <url>`. */
const ACTION_LINE =
  /^ {2}(.+?)( \(asks you to sign in first\))?: \S*\/api\/v1\/inbox\/answer\/(\S+)$/;

/** A card's last line: `  Open in Ouroboros: …/inbox?item=<id>`. */
const OPEN_LINE = /^ {2}Open in Ouroboros: \S*[?&]item=([0-9a-f-]{36})/;

/**
 * Read a digest's plain-text part into each card's answer links.
 *
 * The composer (`decision-mail.compose.ts`'s `cardText`) writes a card as its prose lines, then one
 * line per action it minted a token for, then `Open in Ouroboros` naming the item — so the item a
 * link answers is read from the mail itself rather than guessed from its question, which two
 * protected-path cards share.
 *
 * @param text - The mail's plain-text part.
 * @returns Each card's links, by item id.
 */
export function digestLinks(text: string): ReadonlyMap<string, DigestCardLinks> {
  const cards = new Map<string, DigestCardLinks>();
  let pending = new Map<string, DigestLink>();

  for (const line of text.split(/\r?\n/)) {
    const action = ACTION_LINE.exec(line);

    if (action !== null) {
      pending.set(action[1], { token: action[3], asksToSignIn: action[2] !== undefined });
      continue;
    }

    const open = OPEN_LINE.exec(line);

    if (open !== null) {
      cards.set(open[1], pending);
      pending = new Map();
    }
  }

  return cards;
}

/**
 * Follow an answer link as a mail reader's browser would — through the UI's origin.
 *
 * @param token - The link's token.
 * @param method - `GET` shows the page and changes nothing; `POST` is the page's form.
 * @param session - A session token to present, or `undefined` for a browser that is signed out.
 * @returns The status and the page's HTML.
 */
export async function answerPage(
  token: string,
  method: "GET" | "POST",
  session?: string,
): Promise<{ readonly status: number; readonly html: string }> {
  const response = await fetch(`${UI_URL}/api/v1/inbox/answer/${token}`, {
    method,
    redirect: "manual",
    headers: {
      ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(session === undefined ? {} : { cookie: `${SESSION_COOKIE}=${session}` }),
    },
    // The form a non-note action posts is its button alone.
    body: method === "POST" ? "" : undefined,
  });

  return { status: response.status, html: await response.text() };
}

/* ------------------------------------------------------------------ rows the leg writes */

/** The claim the leg files a waiver card for, and the bench capability it says is missing. */
export const FILED_CLAIM = {
  claim: "Telemetry frames survive a brown-out on the bench supply",
  missingCapability: "programmable power supply",
} as const;

/** The card {@link fileClaimWaiver} filed. */
export interface FiledWaiver {
  readonly itemId: string;
  readonly criterionId: string;
}

/**
 * File a claim-waiver card on PR #504, the way `ClaimWaiverEmitter.unverifiable` files one.
 *
 * The seed's claim-waiver card cannot be answered (see {@link SEEDED_ITEMS}), and nothing in the
 * stack decides a claim is beyond the bench on its own — the verification plane's caller of the
 * emitter is a person's *mark unverifiable*, which has no route yet. So the leg writes the two rows
 * that path would: an **unverified** criterion on PR #504, and the card keyed by it
 * (`pr.criteria`, `pr:<pr>:criterion:<criterion>`), with the emitter's payload and refs — PR #504
 * and the loop that opened it. Filed five minutes old, so its age is a figure the snooze leg can
 * watch survive.
 *
 * Fresh ids every run, so a second run on a kept stack files a second card rather than colliding;
 * the leg is cold-only regardless (see the spec's header).
 *
 * @returns The item and the criterion.
 * @throws When either insert wrote nothing — the PR, its run or the kind is missing.
 */
export async function fileClaimWaiver(): Promise<FiledWaiver> {
  const itemId = randomUUID();
  const criterionId = randomUUID();
  const claim = FILED_CLAIM.claim.replace(/'/g, "''");
  const missing = FILED_CLAIM.missingCapability.replace(/'/g, "''");

  const inserted = await psql(
    `with criterion as (
       insert into ouroboros.pr_criteria (id, pr_id, claim, source, status, sort_order, created_by)
       select '${criterionId}'::uuid, pr.id, '${claim}', 'manual', 'unverified', 4, ken."id"
         from ouroboros.pull_requests pr
         left join ouroboros."user" ken on ken.email = 'ken@acme-robotics.dev'
        where pr.id = '${SEEDED_PR_ID}'
       returning id, pr_id
     )
     insert into ouroboros.decision_items
       (id, organization_id, kind_id, kind_version, payload, refs, emitted_by, source_ref, created_at)
     select '${itemId}'::uuid, pr.organization_id, 'claim_waiver', kind.version,
            jsonb_build_object('claim', '${claim}', 'missing_capability', '${missing}'),
            jsonb_build_array(
              jsonb_build_object('type', 'pr', 'id', pr.id::text, 'label', 'PR #' || pr.external_number),
              jsonb_build_object('type', 'run', 'id', run.id::text, 'label', 'loop #' || run.loop_seq)),
            'pr.criteria', 'pr:' || pr.id || ':criterion:' || criterion.id,
            now() - interval '5 minutes'
       from criterion
       join ouroboros.pull_requests pr on pr.id = criterion.pr_id
       join ouroboros.runs run on run.id = pr.run_id
       join ouroboros.decision_kinds_current kind on kind.kind_id = 'claim_waiver'
     returning id`,
  );

  if (!inserted.includes(itemId)) {
    throw new Error(
      `filing the claim-waiver card wrote nothing — PR #504, its run or the claim_waiver kind is missing: ${inserted}`,
    );
  }

  return { itemId, criterionId };
}

/**
 * How many guardrail exceptions an item has granted — the allow-once chain's own record, read
 * beneath the service, so a race that granted twice is seen even if both answers were refused.
 *
 * @param itemId - The decision item an exception was granted through.
 * @returns The count.
 */
export async function exceptionsGrantedVia(itemId: string): Promise<number> {
  return Number(
    (
      await psql(
        `select count(*) from ouroboros.guardrail_exceptions where granted_via = '${itemId}'::uuid`,
      )
    ).trim(),
  );
}

/**
 * Remember the seeded GitHub source's sealed credential, and hand back how to put it back.
 *
 * The chain must connect the source (`support/knowledge.ts`'s `connectSeededSource`) — the seed's
 * placeholder cannot be opened, so the merge and the annotation would both be refused
 * `host_refused`. But a source that works is a source the intake mirror and PR sync start reading
 * the sandbox through, and the legs that sort after this one (issues, insights) were written
 * against the placeholder. There is no route that removes a credential, so the column is put back
 * as it was found, beneath the service — the one write in this file that is a restore rather than
 * a fixture.
 *
 * @param sourceId - The source.
 * @returns The undo.
 */
export async function holdSourceCredential(sourceId: string): Promise<() => Promise<void>> {
  const before = (
    await psql(
      `select json_build_object('sealed', credentials_encrypted, 'status', status,
                                'reason', status_reason)
         from ouroboros.ticket_sources where id = '${sourceId}'::uuid`,
    )
  ).trim();

  return async () => {
    const row = JSON.parse(before === "" ? "{}" : before) as {
      sealed?: string | null;
      status?: string;
      reason?: string | null;
    };
    const literal = (value: string | null | undefined): string =>
      value === null || value === undefined ? "null" : `'${value.replace(/'/g, "''")}'`;

    if (row.status === undefined) return;

    await psql(
      `update ouroboros.ticket_sources
          set credentials_encrypted = ${literal(row.sealed)}, status = ${literal(row.status)},
              status_reason = ${literal(row.reason)}
        where id = '${sourceId}'::uuid`,
    );
  };
}
