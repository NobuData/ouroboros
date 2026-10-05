/**
 * The settings hub, for the leg that certifies it
 * ([#496](https://github.com/NobuData/ouroboros/issues/496), BS.6 — the Settings MVP gate).
 *
 * `support/settings.ts` is two person-and-workspace rows other legs set and put back — the font
 * scale and the auto-merge switch — and stays that. This is the *page*: mockup 17's hub and the
 * surfaces behind it, as `specs/settings.spec.ts` needs them. Four kinds of thing live here, and
 * the file is in that order.
 *
 * 1. **What the page says** — the copy the leg looks for, restated rather than imported, because
 *    nothing in this suite may import service source (`eslint.config.mjs`). Every constant names
 *    the file it restates.
 * 2. **The reads and writes beneath the browser** — the service's own routes, called with a
 *    context's session. The leg presses the page and then asks *the plane that owns the effect*
 *    whether it happened: the policy document, a member's capability, the retention tiers, the
 *    webhook endpoints, the audit log, the lifecycle.
 * 3. **The rows no route gives it** — a session aged past the step-up window, a second member of
 *    the fixture workspace, the stored tier a sweep reads. Through psql, as `support/inbox.ts`
 *    files its claim: each is a row its owning plane would have written, and the comment on each
 *    says which.
 * 4. **The breakages** — {@link BREAKS}. A green leg cannot say whether the system works or the
 *    leg asserts nothing, so `scripts/verify-settings.sh` breaks each layer once, beneath the
 *    service, and requires the matching test to go red naming it.
 *
 * ## What every restore here is for
 *
 * The hub is `acme-robotics`'s, and so is every other leg's page. Five of the leg's tests write
 * to that workspace — a policy version, a capability, the retention tiers, a webhook endpoint, a
 * pause — and each puts back what it changed, through the service, in a `finally`. What cannot be
 * put back is in `specs/settings.spec.ts`'s header: a published version stays published (the
 * document is restored as a *newer* version), and an audit event stays recorded.
 */

import { randomUUID } from "node:crypto";

import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { psql } from "./insights";
import { quietly } from "./rest";
import { SEED_OWNER, ephemeralSlug } from "./seed";
import { AUTH_BASE_PATH, SESSION_COOKIE, sessionTokenOf, signIn } from "./session";
import { REST_URL } from "./stack";
import { selectWorkspace } from "./workspace";

/* ------------------------------------------------------------------ 1. what the page says */

/** The hub's route (`ouroboros-ui/app/paths.ts`'s `SETTINGS_PATH`). */
export const SETTINGS_PATH = "/settings";

// ASSUMED(#496-ui): the route — read from the UI fork's `app/paths.ts` while it was being written.
/** The recovery screen's route (`app/paths.ts`'s `RECOVERY_PATH`). */
export const RECOVERY_PATH = "/workspace-recovery";

/** The hub's head — `app/settings/view.ts`, mockup 17's verbatim. */
export const HUB = {
  title: "Workspace settings",
  subline: "Who can do what, what merges on its own, and where the record lives.",
  save: "Save changes",
  saved: "Settings saved.",
} as const;

/**
 * The eight seats, by the id each carries — `app/settings/view.ts`'s `SETTINGS_SECTIONS`, in the
 * order the grid draws them.
 */
export const SEATS = [
  "workspace",
  "members",
  "appearance",
  "policies",
  "audit",
  "integrations",
  "notifications",
  "danger",
] as const;

/** One of {@link SEATS}. */
export type Seat = (typeof SEATS)[number];

/** What a reader who may not edit is told (`app/settings/access.ts`). */
export const READ_ONLY = {
  /**
   * The note's head for a role.
   *
   * @param role - The reader's strongest role.
   * @returns *Viewing workspace settings as a member.*
   */
  head: (role: string): string => `Viewing workspace settings as a ${role}.`,
  body: "Every setting on this page can be read. Changing one takes an owner or an admin.",
  /** `app/audit-log/view.ts`'s `AUDIT_ADMINS_ONLY`. */
  audit: "The audit log is read by owners and admins. Ask one of them for what you need from it.",
} as const;

/** The Autonomy policies card (`app/policies/card-view.ts`, `document.ts`). */
export const POLICY = {
  protectedPaths: "Protected paths need allow-once",
  /**
   * A rule's switch.
   *
   * @param rule - The rule's name.
   * @param enabled - Where it stands now.
   * @returns The switch's accessible name — what pressing it would do.
   */
  switchName: (rule: string, enabled: boolean): string =>
    `${enabled ? "Turn off" : "Turn on"} ${rule}`,
  /**
   * The confirmation's title, and its confirming button.
   *
   * @param next - The version a publish would make.
   * @returns The two labels.
   */
  confirm: (next: number): { readonly title: string; readonly publish: string } => ({
    title: `Publish policy v${String(next)}?`,
    publish: `Publish policy v${String(next)}`,
  }),
  /**
   * The toast a publish leaves.
   *
   * @param version - The version published.
   * @returns *Policy v8 published.*
   */
  published: (version: number): string => `Policy v${String(version)} published.`,
  /**
   * The version tag's accessible name.
   *
   * @param version - The version in force.
   * @returns *policy v8 — open the policy history*.
   */
  tag: (version: number): string => `policy v${String(version)} — open the policy history`,
} as const;

/** The Members & Roles card (`app/members/view.ts`). */
export const MEMBERS = {
  /**
   * A member's capability box.
   *
   * @param name - The member's name.
   * @returns The box's accessible name.
   */
  capability: (name: string): string => `Can approve loops: ${name}`,
  /**
   * What the card's toast says once the capability moved.
   *
   * @param name - The member's name.
   * @param granted - Which way.
   * @returns The sentence.
   */
  changed: (name: string, granted: boolean): string =>
    granted
      ? `${name} can now approve and merge loops.`
      : `${name} can no longer approve or merge loops.`,
} as const;

/** The Workspace card (`app/settings/workspace.ts`). */
export const WORKSPACE = {
  retention: "Data retention",
  /**
   * A tier, as the select's option.
   *
   * @param days - The tier.
   * @returns *14 days*.
   */
  days: (days: number): string => `${String(days)} days`,
} as const;

/** The Audit card and its export dialog (`app/audit-log/view.ts`). */
export const AUDIT = {
  filters: /^filters/,
  form: "Filter the audit log",
  from: "From (UTC day)",
  to: "To (UTC day, inclusive)",
  plane: "Plane or action",
  apply: "Apply",
  exportButton: "Export CSV",
  exportTitle: "Export the audit log as CSV",
  download: "Download CSV",
  close: "Close",
  logged: "This export is itself recorded in the audit log, with its range and filters.",
  /**
   * The line a filtered log ends with.
   *
   * @param count - How many events it holds.
   * @returns *End of log · 3 events*.
   */
  end: (count: number): string => `End of log · ${String(count)} event${count === 1 ? "" : "s"}`,
} as const;

/** The webhook sheet (`app/webhooks/view.ts`) and the tile that opens it. */
export const WEBHOOKS = {
  /** The Webhooks tile's action — `"<deepLink.label> Webhooks"`; *Manage* while any is active. */
  manage: /^(Manage|Add endpoint) Webhooks$/,
  sheet: "Webhook endpoints",
  add: "+ Add endpoint",
  name: "Name",
  url: "URL",
  create: "Create endpoint",
  secretTitle: "Signing secret",
  secretDone: "I have copied it",
  /**
   * A row's action.
   *
   * @param action - *Test ping*, *Deliveries*, *Delete*.
   * @param name - The endpoint's name.
   * @returns The button's accessible name.
   */
  action: (action: string, name: string): string => `${action} ${name}`,
  ping: "Test ping",
  deliveries: "Deliveries",
} as const;

// ASSUMED(#496-ui): every string in DANGER, BANNER and RECOVERY below — the switch's two names,
// the dialogs' titles and confirming buttons, the in-flight sentence, the typed-name label, the
// step-up field's label (`app/providers/keys.ts`'s `STEP_UP_PASSWORD`), the banner's region name,
// headline and two actions, and the recovery screen's title, timer name, countdown shape and
// notes. Copied from `app/lifecycle/{danger,banner,recovery}.ts` as the UI fork had them.
/** The Danger zone card and its dialogs (`app/lifecycle/danger.ts`). */
export const DANGER = {
  pause: "Pause all loops",
  resume: "Resume all loops",
  pauseWhy: "queued issues stay queued; running loops finish their stage",
  pauseDialog: "Pause all loops?",
  running: "Running",
  /**
   * The pause confirmation's count of runs in flight.
   *
   * @param count - How many runs are not finished.
   * @returns The sentence the dialog prints.
   */
  inFlight: (count: number): string =>
    count <= 0
      ? "No runs are in flight — nothing is interrupted, and nothing new starts."
      : count === 1
        ? "1 run is in flight — it finishes its current stage, then holds."
        : `${String(count)} runs are in flight — each finishes its current stage, then holds.`,
  /**
   * The delete row's button.
   *
   * @param workspace - The workspace's name.
   * @returns *Delete Acme Robotics…*
   */
  deleteButton: (workspace: string): string => `Delete ${workspace}…`,
  /**
   * The delete dialog's title, and its typed-name field.
   *
   * @param workspace - The workspace's name.
   * @returns The two labels.
   */
  deleteDialog: (workspace: string): { readonly title: string; readonly typeName: string } => ({
    title: `Delete ${workspace}?`,
    typeName: `Type ${workspace} to confirm`,
  }),
  deleteConfirm: "Delete workspace",
  password: "Your password",
  ownerOnly: "Only an owner can delete the workspace.",
  pauseRole: "An owner or an admin can pause and resume.",
} as const;

/** The shell's paused banner (`app/lifecycle/banner.ts`). */
export const BANNER = {
  label: "All loops paused",
  headline: "all loops paused — stages finishing",
  resume: "Resume",
  whoCanResume: "Who can resume?",
} as const;

/** The recovery screen (`app/lifecycle/recovery.ts`). */
export const RECOVERY = {
  /**
   * The screen's title.
   *
   * @param workspace - The workspace's name.
   * @returns *Acme Robotics is scheduled for deletion*.
   */
  title: (workspace: string): string => `${workspace} is scheduled for deletion`,
  countdownLabel: "Time left to recover",
  /** `29d 23h to recover` — the first day of a thirty-day window. */
  countdown: /^\d{1,2}d \d{1,2}h to recover$/,
  restore: "Restore workspace",
  nonOwner:
    "Only an owner of this workspace can restore it. If it should not be deleted, ask an owner " +
    "to restore it before the recovery window closes.",
} as const;

/**
 * One section's seat.
 *
 * @param page - The page, on the hub.
 * @param id - The section.
 * @returns The grid cell carrying that id — the anchor the section nav lands on.
 */
export function seat(page: Page, id: Seat): Locator {
  return page.locator(`.settings__grid > #${id}`);
}

/**
 * Sign a seeded person into a workspace and open the hub.
 *
 * @param context - The browser context.
 * @param page - The page.
 * @param userId - Whose session.
 * @param slug - Which workspace.
 * @returns When the page itself — not its loading skeleton — has rendered.
 */
export async function openSettings(
  context: BrowserContext,
  page: Page,
  userId: string,
  slug: string,
): Promise<void> {
  await signIn(context, userId);
  await selectWorkspace(context, slug);
  await page.goto(SETTINGS_PATH);
  // The loading skeleton draws the same head, and the page streams in behind it: wait for the
  // skeleton to have been replaced, so nothing below can match the page while it is half-swapped.
  await expect(page.locator('main[aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator(".settings__grid")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(HUB.title);
}

/**
 * The stylesheet {@link steadyHub} adds for the length of a photograph — what a picture of the
 * hub must not depend on.
 *
 * The hub is the one page that draws **every other plane's present state**, so more of it is
 * live than of any other parity pair in this suite: the ages (*Last active*, *invited 2h ago*,
 * the next-sweep note), the policy version tag (this leg publishes), the audit card's rows and
 * its SIEM row (every leg writes audit events, and the seeded SIEM endpoint answers nobody), and
 * the two tiles composed from moving planes — GitHub and the build farm — with the count that
 * follows them. Everything else — the eight seats, their headings, every control, the routes and
 * their locks, the danger zone — is photographed.
 *
 * A mask paints over a region; it cannot stop the region **changing size**, and three of the
 * hub's live regions do: a tile gains a *reason* line when its plane needs attention (and every
 * row under it moves), the policy tag is as wide as its version number, and the SIEM row's
 * sentence is as long as its state. So the regions whose size is a fact about the suite's past
 * are taken out of the layout or out of sight, and the masks cover what is left of them.
 *
 * The header's pills count live loops and waiting decisions — other legs' work — and are hidden
 * for the same reason.
 */
const STEADY_HUB_CSS = `
  .integrations__tile--ok .integrations__reason,
  .integrations__tile--attention .integrations__reason { display: none !important; }
  .integrations__tile--ok,
  .integrations__tile--attention,
  .shell-pills,
  #policies .ou-card__head button,
  #integrations .ou-card__head .ou-tag,
  #audit .audit-log__rows,
  #audit .audit-log__more,
  #audit .audit-log__foot,
  #members .ou-table__cell--mono,
  #members .members__muted,
  #members .members__service-meta,
  #workspace .settings-workspace__note,
  .shell-nav [class*="badge"] { visibility: hidden !important; }
`;

/**
 * Hold the hub's live regions still for a photograph — see {@link STEADY_HUB_CSS}.
 *
 * Idempotent in effect: the sheet is the same each time, and it leaves with the next navigation.
 *
 * @param page - The page, on the hub.
 * @returns When the sheet is in the document.
 */
export async function steadyHub(page: Page): Promise<void> {
  await page.addStyleTag({ content: STEADY_HUB_CSS });
}

/* ------------------------------------------------------------------ 2. beneath the browser */

/** What one call to the service answered. */
export interface Answer<Body = unknown> {
  readonly status: number;
  readonly body: Body;
}

/**
 * Call `ouroboros-rest` with a context's session, and hand back whatever it answered.
 *
 * `support/rest.ts`'s `requestAs` throws on a refusal, which is right for a write a leg depends
 * on. Half of what this leg asserts **is** a refusal — a capability withheld, a surface frozen,
 * a step-up demanded — so this one returns the status and the body and lets the caller say what
 * it expected.
 *
 * @param context - A signed-in context.
 * @param method - The HTTP method.
 * @param path - The path under the service's origin.
 * @param body - A JSON body, or `null` for none.
 * @returns The status and the parsed body (`null` for an empty one).
 */
export async function callAs<Body = unknown>(
  context: BrowserContext,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body: Readonly<Record<string, unknown>> | null = null,
): Promise<Answer<Body>> {
  const token = await sessionTokenOf(context, `${method} ${path}`);
  const response = await fetch(`${REST_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: body === null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();

  return { status: response.status, body: (text === "" ? null : JSON.parse(text)) as Body };
}

/**
 * A read the leg depends on: the body, or a failure that names the route.
 *
 * @param context - A signed-in context.
 * @param path - The path.
 * @returns The body.
 * @throws {Error} When the service did not answer `200`.
 */
async function read<Body>(context: BrowserContext, path: string): Promise<Body> {
  const { status, body } = await callAs<Body>(context, "GET", path);

  if (status !== 200) throw new Error(`GET ${path} answered ${status}: ${JSON.stringify(body)}`);
  return body;
}

/** A service refusal's envelope. */
export interface Refusal {
  readonly code?: string;
  readonly message?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/* ---- the policy document */

/** One rule of the org policy document. */
export interface PolicyRule {
  readonly enabled: boolean;
  readonly conditions: Readonly<Record<string, unknown>>;
}

/** The org policy in force. */
export interface OrgPolicy {
  readonly version: number | null;
  readonly document: Readonly<Record<string, PolicyRule>> | null;
}

/**
 * The org policy in force.
 *
 * @param context - A signed-in context.
 * @returns The version and its document.
 */
export function policyOf(context: BrowserContext): Promise<OrgPolicy> {
  return read<OrgPolicy>(context, "/api/v1/policies");
}

/**
 * Put a policy document back in force, as the next version.
 *
 * A published version cannot be unpublished — that is what *versioned* means — so the restore is
 * a publish of the document the leg found, over whatever is in force now. A document already in
 * force is left alone (`422 policy_unchanged` is the service agreeing).
 *
 * @param context - The owner's context: a restore may loosen, and loosening is an owner's.
 * @param document - The document to put back.
 * @returns When it is in force. Never throws: see `support/rest.ts`'s `quietly`.
 */
export function restorePolicy(
  context: BrowserContext,
  document: OrgPolicy["document"],
): Promise<void> {
  return quietly(async () => {
    if (document === null) return;

    const now = await policyOf(context);
    if (JSON.stringify(now.document) === JSON.stringify(document)) return;

    const { status, body } = await callAs<Refusal>(context, "POST", "/api/v1/policies", {
      document,
      baseVersion: now.version,
      changeNote: "e2e (#496): the settings leg puts the document back",
    });

    if (status !== 200 && status !== 201 && body.code !== "policy_unchanged") {
      throw new Error(`publishing the restore answered ${status}: ${JSON.stringify(body)}`);
    }
  }, "the org policy was not put back — `boot/**` may be unprotected for every later leg and " + "the next run, which is the inbox leg's allow-once premise.");
}

/* ---- members */

/** One member, as the Members card's read lists them. */
export interface Member {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly canApproveLoops: boolean;
}

/**
 * One member of the active workspace, by address.
 *
 * @param context - A signed-in context.
 * @param email - The member's address.
 * @returns The member.
 * @throws {Error} When the workspace has no such member.
 */
export async function memberByEmail(context: BrowserContext, email: string): Promise<Member> {
  const page = await read<{ members: readonly Member[] }>(context, "/api/v1/settings/members");
  const member = page.members.find((one) => one.email === email);

  if (member === undefined) throw new Error(`the workspace has no member ${email}`);
  return member;
}

/**
 * Set a member's capability through the service, saying nothing if it cannot.
 *
 * @param context - An administrator's context.
 * @param memberId - The membership.
 * @param granted - Whether they may approve loops.
 * @returns When it is set. Never throws.
 */
export function restoreCapability(
  context: BrowserContext,
  memberId: string,
  granted: boolean,
): Promise<void> {
  return quietly(
    async () => {
      const { status, body } = await callAs(
        context,
        "PATCH",
        `/api/v1/settings/members/${encodeURIComponent(memberId)}`,
        { canApproveLoops: granted },
      );

      if (status !== 200) throw new Error(`answered ${status}: ${JSON.stringify(body)}`);
    },
    `a member's approval capability was not put back to ${String(granted)} — the next run's ` +
      "capability test starts from the wrong position.",
  );
}

/* ---- retention */

/** One class's tier. */
export interface RetentionTier {
  readonly dataClass: string;
  readonly days: number;
  readonly source: "policy" | "default";
  readonly nextSweepAt: string | null;
  readonly lastSweep: { readonly at: string; readonly removed: number } | null;
}

/** The retention tiers. */
export interface Retention {
  readonly loopDays: number | null;
  readonly classes: readonly RetentionTier[];
}

/** The three classes the card's select governs. */
export const LOOP_CLASSES = ["transcripts", "build_logs", "artifacts"] as const;

/**
 * The retention tiers.
 *
 * @param context - A signed-in context.
 * @returns The tiers, their bounds and their sweeps.
 */
export function retentionOf(context: BrowserContext): Promise<Retention> {
  return read<Retention>(context, "/api/v1/settings/retention");
}

/**
 * Put the loop classes' tier back.
 *
 * @param context - An administrator's context.
 * @param days - The tier the leg found.
 * @returns When it is stored. Never throws.
 */
export function restoreLoopDays(context: BrowserContext, days: number): Promise<void> {
  return quietly(
    async () => {
      const { status, body } = await callAs(context, "PATCH", "/api/v1/settings/retention", {
        loopDays: days,
      });

      if (status !== 200) throw new Error(`answered ${status}: ${JSON.stringify(body)}`);
    },
    `the loop classes' retention was not put back to ${String(days)} days — the Workspace card ` +
      "and the readability matrix's pictures of it will show the leftover tier.",
  );
}

/* ---- webhooks */

/** One webhook endpoint. */
export interface WebhookEndpoint {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

/**
 * The workspace's webhook endpoints.
 *
 * @param context - An administrator's context.
 * @returns The endpoints and the counted `activeCount`.
 */
export function webhooksOf(
  context: BrowserContext,
): Promise<{ readonly items: readonly WebhookEndpoint[]; readonly activeCount: number }> {
  return read(context, "/api/v1/settings/webhooks");
}

/**
 * Delete every endpoint this leg made — any whose name carries the leg's mark.
 *
 * @param context - An administrator's context.
 * @param mark - The prefix the leg names its endpoints with.
 * @returns When they are gone. Never throws.
 */
export function removeWebhooks(context: BrowserContext, mark: string): Promise<void> {
  return quietly(async () => {
    for (const endpoint of (await webhooksOf(context)).items) {
      if (!endpoint.name.startsWith(mark)) continue;

      const { status, body } = await callAs(
        context,
        "DELETE",
        `/api/v1/settings/webhooks/${encodeURIComponent(endpoint.id)}`,
      );

      if (status !== 200 && status !== 204) {
        throw new Error(`deleting ${endpoint.name} answered ${status}: ${JSON.stringify(body)}`);
      }
    }
  }, "a webhook endpoint the settings leg made was not deleted — the Integrations tile will " + "read `3 active` where the seed and the mockup read 2.");
}

/* ---- the audit log */

/** One event of the audit log. */
export interface AuditEvent {
  readonly id: string;
  readonly occurredAt: string;
  readonly action: string;
  readonly actor: string;
  readonly event: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

/**
 * Every event the log holds for a filter, newest first — every keyset page of it.
 *
 * @param context - An administrator's context.
 * @param filter - The query's filters, as the route spells them.
 * @returns The events.
 */
export async function auditLog(
  context: BrowserContext,
  filter: Readonly<Record<string, string>>,
): Promise<readonly AuditEvent[]> {
  const events: AuditEvent[] = [];
  let cursor: string | null = null;

  do {
    const query = new URLSearchParams({ ...filter, limit: "200" });
    if (cursor !== null) query.set("cursor", cursor);

    const page: { items: readonly AuditEvent[]; nextCursor: string | null } = await read(
      context,
      `/api/v1/settings/audit?${query.toString()}`,
    );

    events.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);

  return events;
}

/**
 * A log row's stamp, as the card prints it (`app/audit-log/view.ts`'s `stampOf`).
 *
 * @param occurredAt - The event's instant.
 * @returns `2026-10-05 14:31`, in UTC.
 */
export function stampOf(occurredAt: string): string {
  return new Date(occurredAt).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Today, as the day the audit card's filters and its export take — UTC.
 *
 * @param now - The instant.
 * @returns `2026-10-05`.
 */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Parse RFC 4180 CSV — what `GET /settings/audit/export.csv` streams.
 *
 * Quoted cells, doubled quotes, commas and line ends inside quotes, CRLF between records. Small
 * on purpose: the export's `detail` column is JSON, which is exactly the cell a split on commas
 * would shred, and a dependency for forty lines is `provider-stub`'s argument in reverse.
 *
 * @param text - The file.
 * @returns Its records, header first, each a list of cells.
 */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      record.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell !== "" || record.length > 0) {
    record.push(cell);
    records.push(record);
  }

  return records;
}

/* ---- the lifecycle */

/** Where a workspace stands. */
export interface Lifecycle {
  readonly state: "active" | "paused" | "pending_delete";
  readonly purgeAfter: string | null;
  readonly banner: { readonly kind: string; readonly message: string } | null;
}

/**
 * Where the active workspace stands.
 *
 * @param context - A signed-in context.
 * @returns The lifecycle.
 */
export function lifecycleOf(context: BrowserContext): Promise<Lifecycle> {
  return read<Lifecycle>(context, "/api/v1/settings/lifecycle");
}

/**
 * How many runs are in flight — the figure the pause confirmation prints.
 *
 * The dialog reads it from the disconnect preview's `activeRuns` (*runs not yet finished*); so
 * does this, by the same route, so the two are one number asked for twice.
 *
 * @param context - An administrator's context.
 * @returns The count.
 */
export async function runsInFlight(context: BrowserContext): Promise<number> {
  const preview = await read<{ activeRuns: number }>(
    context,
    "/api/v1/settings/lifecycle/disconnect-preview",
  );

  return preview.activeRuns;
}

/**
 * Resume the workspace if anything left it paused.
 *
 * The pause leg's `finally`, and its `afterAll`'s: a workspace left paused holds every later
 * leg's simulated run at its first stage, which would fail four legs for a reason none of them
 * names.
 *
 * @param context - An administrator's context.
 * @returns When the workspace is `active`, or was already. Never throws.
 */
export function resumeIfPaused(context: BrowserContext): Promise<void> {
  return quietly(async () => {
    if ((await lifecycleOf(context)).state !== "paused") return;

    const { status, body } = await callAs(context, "POST", "/api/v1/settings/lifecycle/resume");
    if (status !== 200) throw new Error(`answered ${status}: ${JSON.stringify(body)}`);
  }, "the workspace was left PAUSED — every later leg's simulated run will hold at its first " + "stage. Resume it on /settings#danger before running anything else.");
}

/**
 * Restore the active workspace if anything left it pending deletion.
 *
 * @param context - An owner's context, acting in that workspace.
 * @returns When the workspace is restored, or was not pending. Never throws.
 */
export function restoreIfPending(context: BrowserContext): Promise<void> {
  return quietly(async () => {
    const { status, body } = await callAs<Lifecycle>(context, "GET", "/api/v1/settings/lifecycle");
    if (status !== 200 || body.state !== "pending_delete") return;

    const restored = await callAs(context, "POST", "/api/v1/settings/lifecycle/restore");
    if (restored.status !== 200) {
      throw new Error(`answered ${restored.status}: ${JSON.stringify(restored.body)}`);
    }
  }, "the fixture workspace was left pending deletion; its purge is thirty days away and it " + "holds nothing another leg reads.");
}

/**
 * Submit a `resume` to a run's control queue — what the run console's **Resume** sends.
 *
 * The policy leg uses it without an allow-once: the loop is holding on a protected path, the
 * policy that protected it has just been republished without the rule, and a plain resume makes
 * the driver report the same change-set again — to a gate that must now pass it.
 *
 * @param context - An administrator's context.
 * @param runId - The run.
 * @returns When the control is queued.
 * @throws {Error} When the service refused it.
 */
export async function resumeRun(context: BrowserContext, runId: string): Promise<void> {
  const { status, body } = await callAs(
    context,
    "POST",
    `/api/v1/runs/${encodeURIComponent(runId)}/controls`,
    { kind: "resume" },
  );

  if (status !== 200 && status !== 201 && status !== 202) {
    throw new Error(`resuming run ${runId} answered ${status}: ${JSON.stringify(body)}`);
  }
}

/** A run's stages, in the order its pinned workflow walks them. */
export interface RunStages {
  readonly timeline: {
    readonly stages: readonly { readonly stageKey: string; readonly status: string }[];
  };
}

/**
 * A run's stages and where each stands.
 *
 * @param context - A signed-in context.
 * @param runId - The run.
 * @returns Each stage's key and latest status, in timeline order.
 */
export async function stagesOf(
  context: BrowserContext,
  runId: string,
): Promise<readonly { readonly stageKey: string; readonly status: string }[]> {
  const run = await read<RunStages>(context, `/api/v1/runs/${encodeURIComponent(runId)}`);

  return run.timeline.stages;
}

/* ------------------------------------------------------------------ 3. rows no route gives */

/** A workspace the leg made for itself. */
export interface FixtureWorkspace {
  /** Its slug — `e2e-settings-…`, unique to the run. */
  readonly slug: string;
  /** Its name — what the delete dialog asks to be typed, exactly. */
  readonly name: string;
}

/**
 * What every fixture workspace is called.
 *
 * One name for all of them — a workspace's name need not be unique, only its slug — because the
 * recovery screen's title carries it and that screen is photographed: a name with the run's
 * noise in it would be a baseline no second run could match.
 */
export const FIXTURE_WORKSPACE_NAME = "E2E Settings Rehearsal";

/**
 * Make a workspace of the leg's own, owned by the seeded owner, and act in it.
 *
 * The delete rehearsal needs a workspace it may genuinely delete: `acme-robotics` is every other
 * leg's page, and a deletion revokes every non-owner session acting in it. The organization
 * plugin's own create route is how a person makes one (`support/farm.ts` does the same), so the
 * workspace is real — a lifecycle row, a membership, nothing seeded.
 *
 * @param context - The owner's context. Signed in here.
 * @param label - A short label for the slug.
 * @returns The workspace.
 */
export async function enterFixtureWorkspace(
  context: BrowserContext,
  label: string,
): Promise<FixtureWorkspace> {
  await signIn(context, SEED_OWNER.id);

  const slug = ephemeralSlug(`settings-${label}`);
  const name = FIXTURE_WORKSPACE_NAME;
  const { status, body } = await callAs<{ slug?: string }>(
    context,
    "POST",
    `${AUTH_BASE_PATH}/organization/create`,
    { name, slug },
  );

  if (status !== 200 || body.slug !== slug) {
    throw new Error(
      `creating the fixture workspace ${slug} answered ${status}: ${JSON.stringify(body)}`,
    );
  }

  await selectWorkspace(context, slug);

  return { slug, name };
}

/**
 * A SQL string literal.
 *
 * @param value - The text.
 * @returns It, quoted, with quotes doubled.
 */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Add a seeded person to a workspace as a plain member — the row the organization plugin writes
 * when an invitation is accepted.
 *
 * The recovery screen's second audience is *a member who is not an owner*, and the fixture
 * workspace has only its owner. An invitation would need a mail read and a second browser to
 * accept it, which is the invite flow's own coverage (`ouroboros-rest`'s members specs); what
 * this leg needs is the membership, so it writes the row the acceptance would.
 *
 * @param slug - The workspace.
 * @param email - The person.
 * @returns When the membership exists.
 * @throws {Error} When nothing was written — no such workspace or person.
 */
export async function addMemberBeneath(slug: string, email: string): Promise<void> {
  const id = `e2e-${randomUUID()}`;
  const written = await psql(
    `insert into ouroboros.member ("id", "organizationId", "userId", "role", "createdAt")
     select ${literal(id)}, org."id", person."id", 'member', now()
       from ouroboros.organization org, ouroboros."user" person
      where org."slug" = ${literal(slug)} and person."email" = ${literal(email)}
     returning "id"`,
  );

  if (!written.includes(id)) {
    throw new Error(`adding ${email} to ${slug} wrote nothing: ${written}`);
  }
}

/**
 * Make a context's session old enough that it is no longer a re-authentication in itself.
 *
 * The delete asks for a **step-up**: a session created within five minutes, or the password
 * (`provider-connections/step-up.ts`). Every session this suite mints is seconds old, so a
 * delete pressed with one sails through on freshness and the password path is never reached —
 * the providers leg (leg 10) says the same of its reveal and leaves it there, because reaching
 * it would cost a five-minute wait. Here it is the leg's subject, so the session's `createdAt`
 * is moved back ten minutes beneath the service: the row a session that had simply been open a
 * while would be.
 *
 * @param context - The signed-in context whose session to age.
 * @returns When the row is aged.
 * @throws {Error} When no session row carries the context's token.
 */
export async function ageSession(context: BrowserContext): Promise<void> {
  // The cookie is `<token>.<signature>`; the row is keyed by the token.
  const token = (await sessionTokenOf(context, "ageing the session")).split(".")[0];

  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("the session token is not the shape this helper may put into a statement");
  }

  const aged = await psql(
    `update ouroboros.session set "createdAt" = now() - interval '10 minutes'
      where "token" = ${literal(token)} returning 'aged'`,
  );

  if (!aged.includes("aged")) {
    throw new Error("no session row carries this context's token — nothing was aged");
  }
}

/**
 * The tier a class's next sweep will read — the stored row, beneath the service.
 *
 * `RetentionPolicyService.cutoffs()` is what a sweep asks once per run, and it computes
 * `now − days` from exactly this row. Reading it here is as close to the sweep as anything
 * outside the process gets: see `specs/settings.spec.ts`'s header on why the sweep's own run is
 * not waited for.
 *
 * @param slug - The workspace.
 * @param dataClass - The class.
 * @returns Its stored days, or `null` when the workspace stores no tier for it.
 */
export async function storedTier(slug: string, dataClass: string): Promise<number | null> {
  const days = (
    await psql(
      `select policy.days from ouroboros.retention_policies policy
         join ouroboros.organization org on org."id" = policy.organization_id
        where org."slug" = ${literal(slug)} and policy.data_class = ${literal(dataClass)}`,
    )
  ).trim();

  return days === "" ? null : Number(days);
}

/**
 * How many guardrail exceptions a run has been granted — the allow-once plane's own record.
 *
 * @param runId - The run.
 * @returns The count.
 */
export async function exceptionsGrantedTo(runId: string): Promise<number> {
  if (!/^[0-9a-f-]{36}$/.test(runId)) throw new Error(`${runId} is not a run id`);

  return Number(
    (
      await psql(
        `select count(*) from ouroboros.guardrail_exceptions where run_id = '${runId}'::uuid`,
      )
    ).trim(),
  );
}

/* ------------------------------------------------------------------ 4. the breakages */

/** The variable `scripts/verify-settings.sh` names a breakage with. */
export const BREAK_VARIABLE = "OURO_E2E_SETTINGS_BREAK";

/**
 * The layers the leg can be asked to break, one per test that writes.
 *
 * | break | what is broken, beneath the service | the test that must go red | naming |
 * |---|---|---|---|
 * | `policy-gate` | the repository keeps `boot/**` protected in its own rows, so publishing the org rule off changes nothing the gate reads | *policy* | *the gate must flip* |
 * | `capability` | the capability row is granted again right after the box is unticked | *capability* | *must be refused* |
 * | `retention` | the stored tiers are put back right after the card saved them | *retention* | *the tier the next sweep reads* |
 * | `webhook` | the receiver answers every delivery `503` | *webhook* | *Ping succeeded* |
 * | `audit-export` | an event the filtered view never showed is written into the log before the export | *audit* | *matches the filtered view* |
 * | `pause` | the workspace's state row is set back to `active` right after the pause | *pause* | *must hold* |
 * | `step-up` | the session is left fresh, so a delete needs no step-up | *delete* | *must demand a step-up* |
 *
 * The other two of the issue's nine legs are about CSS, and are broken with `support/plants.ts`'s
 * own plants (`OURO_E2E_PLANT`): `pane-overflow` against the shell test, and `chrome-overlap`
 * against the parity pair.
 */
export const BREAKS = [
  "policy-gate",
  "capability",
  "retention",
  "webhook",
  "audit-export",
  "pause",
  "step-up",
] as const;

/** One of {@link BREAKS}. */
export type Break = (typeof BREAKS)[number];

/**
 * Whether a breakage was asked for.
 *
 * @param name - The breakage a test knows how to make.
 * @returns `true` when {@link BREAK_VARIABLE} names it.
 * @throws {Error} When the variable names no known breakage — a typo must not read as a clean run.
 */
export function broken(name: Break): boolean {
  const asked = process.env[BREAK_VARIABLE];
  if (asked === undefined || asked === "") return false;

  if (!BREAKS.includes(asked as Break)) {
    throw new Error(
      `${BREAK_VARIABLE}=${asked} names no known breakage; expected one of: ${BREAKS.join(", ")}`,
    );
  }

  return asked === name;
}

/**
 * Keep a glob protected in every repository's own rows — and hand back how to undo it.
 *
 * AP.3 checks the **union** of the org policy's globs and each repository's rows, so with these
 * rows in place the org rule can be switched off and published and the gate reads the same set.
 *
 * @param slug - The workspace.
 * @param glob - The glob to keep protected.
 * @returns The undo.
 */
export async function keepProtectedBeneath(
  slug: string,
  glob: string,
): Promise<() => Promise<void>> {
  const written = (
    await psql(
      `insert into ouroboros.protected_path_policies (organization_id, repo_ref, path_glob, source)
       select host.organization_id, (host.login || '/' || repo.name)::ouroboros.repo_ref,
              ${literal(glob)}, 'edited'
         from ouroboros.github_repos repo
         join ouroboros.github_orgs host on host.id = repo.org_id
         join ouroboros.organization org on org."id" = host.organization_id
        where org."slug" = ${literal(slug)}
       on conflict do nothing
       returning id`,
    )
  )
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[0-9a-f-]{36}$/.test(line));

  return async () => {
    if (written.length === 0) return;

    await psql(
      `delete from ouroboros.protected_path_policies
        where id in (${written.map((id) => `'${id}'::uuid`).join(", ")})`,
    );
  };
}

/**
 * Grant a member's capability again, beneath the service.
 *
 * @param slug - The workspace.
 * @param email - The member.
 * @returns When the row says they may approve.
 */
export async function grantCapabilityBeneath(slug: string, email: string): Promise<void> {
  await psql(
    `update ouroboros.member_capabilities capability set can_approve_loops = true
       from ouroboros.member membership
       join ouroboros.organization org on org."id" = membership."organizationId"
       join ouroboros."user" person on person."id" = membership."userId"
      where capability.member_id = membership."id"
        and org."slug" = ${literal(slug)} and person."email" = ${literal(email)}`,
  );
}

/**
 * Put the loop classes' stored tiers back, beneath the service.
 *
 * @param slug - The workspace.
 * @param days - The tier to store.
 * @returns When the rows hold it.
 */
export async function storeLoopDaysBeneath(slug: string, days: number): Promise<void> {
  await psql(
    `update ouroboros.retention_policies policy set days = ${String(Math.trunc(days))}
       from ouroboros.organization org
      where org."id" = policy.organization_id and org."slug" = ${literal(slug)}
        and policy.data_class in (${LOOP_CLASSES.map(literal).join(", ")})`,
  );
}

/**
 * Write one more policy-plane event into a workspace's audit log, beneath the service — an
 * event the filtered view was read without, so an export made afterwards is no longer that view.
 *
 * A download cannot be rewritten on its way to the browser (a browser's download does not pass
 * through Playwright's request routing), so the export is broken where its rows come from.
 *
 * @param slug - The workspace.
 * @returns When the row is in the log.
 */
export async function appendPolicyEventBeneath(slug: string): Promise<void> {
  await psql(
    `insert into ouroboros.audit_events (organization_id, action, subject_type, actor_kind)
     select org."id", 'policy.e2e_probe', 'org_policy', 'system'
       from ouroboros.organization org where org."slug" = ${literal(slug)}`,
  );
}

/**
 * Set a workspace's lifecycle row back to `active`, beneath the service.
 *
 * @param slug - The workspace.
 * @returns When the row says so.
 */
export async function forceActiveBeneath(slug: string): Promise<void> {
  await psql(
    `update ouroboros.workspace_lifecycle lifecycle set state = 'active', purge_after = null
       from ouroboros.organization org
      where org."id" = lifecycle.organization_id and org."slug" = ${literal(slug)}`,
  );
}
