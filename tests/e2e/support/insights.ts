/**
 * What the insights leg (specs/insights.spec.ts, [#447](https://github.com/NobuData/ouroboros/issues/447))
 * reads and writes besides the browser: the page's own payload through `ouroboros-rest`, the
 * digest's schedule and subscription, mailpit's inbox, and — for the rollup-lag banner — one
 * row of rollup bookkeeping, moved and put back.
 *
 * Every value here is either the product's own words (copied from `ouroboros-ui/app/insights`,
 * where the unit suites hold them) or a fact of the stack (`docker-compose.yml`'s mailpit port).
 */
import type { BrowserContext } from "@playwright/test";

import { composeOutcome } from "./compose";
import { requestAs } from "./rest";

/** The page's route. */
export const INSIGHTS_PATH = "/insights";

/**
 * mailpit's inbox and API, as `docker-compose.yml` publishes it — loopback, port 8025. An
 * override exists for a stack run on other ports.
 */
export const MAILPIT_URL = process.env.OURO_E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";

/**
 * Every visual on the page below its head, by the start of its region's name — which names
 * the range where the card does, so a pattern rather than a string.
 */
export const VISUALS = [
  { slug: "throughput", name: /^Merged PRs per day/ },
  { slug: "interventions", name: /^Where loops still need humans/ },
  { slug: "stages", name: /^Cycle time by stage/ },
  { slug: "scoreboard", name: /^Model scoreboard/ },
  { slug: "flaky", name: /^Flaky tests/ },
  { slug: "performance", name: /^Build & test performance/ },
  { slug: "builds", name: /^Builds per day/ },
  { slug: "suites", name: /^Test failures by suite/ },
  { slug: "effort", name: /^Time to completion by effort/ },
  { slug: "tokens", name: /^Tokens by stage/ },
  { slug: "cost", name: /^Daily cost/ },
  { slug: "dora", name: /^Delivery health/ },
] as const;

/** The five KPI cards, by their captions — each card's region name. */
export const KPI_LABELS = [
  "Autonomous merge rate",
  "Merged w/o human edits",
  "Median cycle",
  "Cost per merged PR",
  "Human interventions",
] as const;

/** The page's own sentences the leg looks for. */
export const COPY = {
  doraCaption: "Computed from your GitHub + build farm events, not self-reported.",
  proxy: "proxy",
  coldTitle: "Not enough data to measure yet",
  lagHeadline: "These figures are behind.",
  digestTitle: "Email weekly digest",
  digestToggle: "Send me the weekly digest",
  previewFrame: "Weekly digest preview",
  apply: "Apply in Models →",
  recategorize: "Re-categorize…",
  panel: {
    bar: "Bar",
    event: "Intervention",
    target: "Move it to",
    reason: "Why",
    submit: "Re-categorize",
  },
} as const;

/** One DORA cell's methodology, as the payload carries it. */
export interface Methodology {
  readonly metricId: string;
  readonly formula: string;
  readonly caveats: string;
  readonly proxy: boolean;
}

/** The parts of `GET /api/v1/insights` the leg compares the page with. */
export interface InsightsPayload {
  readonly range: string;
  readonly window: { readonly from: string; readonly to: string };
  readonly head: { readonly mergedPrs: number; readonly interventions: number };
  readonly scoreboard: Readonly<Record<string, unknown>>;
  readonly series: { readonly cost: Readonly<Record<string, unknown>> };
  readonly dora: readonly {
    readonly key: string;
    readonly proxy: boolean;
    readonly methodology: Methodology;
  }[];
  readonly freshness: { readonly behind: boolean; readonly lastFilledAt: string | null };
}

/**
 * The page's payload, read as the signed-in person.
 *
 * @param context The browser context whose session reads it.
 * @param range The window.
 * @returns The payload.
 */
export async function insightsPayload(
  context: BrowserContext,
  range: string,
): Promise<InsightsPayload> {
  const page = await requestAs<InsightsPayload>(
    context,
    "GET",
    `/api/v1/insights?range=${range}`,
    null,
    "insights",
  );

  if (page === null) throw new Error("GET /api/v1/insights answered no body");
  return page;
}

/** The digest's schedule, as `GET /api/v1/insights/digest` answers it. */
export interface DigestSchedule {
  readonly weeklyDay: number;
  readonly weeklyTime: string;
}

/**
 * The workspace's digest slot.
 *
 * @param context An administrator's browser context.
 * @returns The slot.
 */
export async function digestSchedule(context: BrowserContext): Promise<DigestSchedule> {
  const digest = await requestAs<{ schedule: DigestSchedule }>(
    context,
    "GET",
    "/api/v1/insights/digest",
    null,
    "digest",
  );

  if (digest === null) throw new Error("GET /api/v1/insights/digest answered no body");
  return { weeklyDay: digest.schedule.weeklyDay, weeklyTime: digest.schedule.weeklyTime };
}

/**
 * Move the workspace's digest slot — an administrator's write.
 *
 * @param context An administrator's browser context.
 * @param schedule The slot.
 */
export async function moveDigestSlot(
  context: BrowserContext,
  schedule: DigestSchedule,
): Promise<void> {
  await requestAs(
    context,
    "PATCH",
    "/api/v1/insights/digest/schedule",
    { ...schedule },
    "digest schedule",
  );
}

/**
 * The slot that is due now: today's ISO weekday, at the current UTC minute.
 *
 * @param now The instant.
 * @returns The slot.
 */
export function slotAt(now: Date): DigestSchedule {
  const pad = (value: number): string => String(value).padStart(2, "0");

  return {
    weeklyDay: ((now.getUTCDay() + 6) % 7) + 1,
    weeklyTime: `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`,
  };
}

/** One message in mailpit's listing. */
export interface MailSummary {
  readonly ID: string;
  readonly Subject: string;
  readonly To: readonly { readonly Address: string }[];
}

/** Empty mailpit's inbox, so the leg's message is the only one. */
export async function clearInbox(): Promise<void> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });

  if (!response.ok) throw new Error(`mailpit refused the clear: ${response.status}`);
}

/**
 * The messages mailpit holds for one address.
 *
 * @param address The recipient.
 * @returns Their summaries, newest first.
 */
export async function inboxOf(address: string): Promise<MailSummary[]> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages`);

  if (!response.ok) throw new Error(`mailpit refused the listing: ${response.status}`);

  const { messages } = (await response.json()) as { messages: MailSummary[] };

  return messages.filter((message) => message.To.some((to) => to.Address === address));
}

/**
 * One message's plain-text part.
 *
 * @param id The message's mailpit id.
 * @returns The text.
 */
export async function messageText(id: string): Promise<string> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);

  if (!response.ok) throw new Error(`mailpit refused message ${id}: ${response.status}`);
  return ((await response.json()) as { Text: string }).Text;
}

/**
 * Run one statement against the stack's database, as the migration owner.
 *
 * Exported since the inbox leg ([#470](https://github.com/NobuData/ouroboros/issues/470)), which
 * files a claim-waiver card and puts a source's credential back the same way — one copy of the
 * `compose exec` line rather than two.
 *
 * @param statement The SQL.
 * @returns What psql printed.
 */
export async function psql(statement: string): Promise<string> {
  const outcome = await composeOutcome(
    "exec",
    "-T",
    "db",
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    process.env.OURO_DB_USER ?? "ouroboros",
    "-d",
    process.env.OURO_DB_NAME ?? "ouroboros",
    "-At",
    "-c",
    statement,
  );

  if (outcome.status !== 0) throw new Error(`psql failed: ${outcome.output}`);
  return outcome.stdout;
}

/**
 * Hold one workspace's rollups back by some days, as a job that has been failing would — and
 * hand back how to undo it. Only the bookkeeping moves: `metric_daily` is untouched, so the
 * figures on the page are the seed's and only their *freshness* changes.
 *
 * @param slug The workspace.
 * @param days How many days behind.
 * @returns The undo.
 */
export async function holdRollupsBack(slug: string, days: number): Promise<() => Promise<void>> {
  const scope = `organization_id = (select id from ouroboros.organization where slug = '${slug}')`;
  const before = await psql(
    `select coalesce(json_agg(json_build_object('family', family, 'day', last_filled_day, 'at', last_run_at,
       'status', last_run_status)), '[]') from ouroboros.metric_rollup_state where ${scope}`,
  );

  await psql(
    `update ouroboros.metric_rollup_state
        set last_filled_day = current_date - ${days + 1}, last_run_status = 'succeeded',
            last_run_at = now() - interval '${days} days', last_error = null
      where ${scope}`,
  );

  return async () => {
    const rows = JSON.parse(before.trim() || "[]") as {
      family: string;
      day: string | null;
      at: string | null;
      status: string | null;
    }[];

    for (const row of rows) {
      const literal = (value: string | null): string => (value === null ? "null" : `'${value}'`);

      await psql(
        `update ouroboros.metric_rollup_state
            set last_filled_day = ${literal(row.day)}::date, last_run_at = ${literal(row.at)}::timestamptz,
                last_run_status = ${literal(row.status)}
          where ${scope} and family = '${row.family}'`,
      );
    }
  };
}
