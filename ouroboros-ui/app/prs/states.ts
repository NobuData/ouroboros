/**
 * The PR verification page's states besides *mid-verification*
 * ([#370](https://github.com/NobuData/ouroboros/issues/370)) — decided here, drawn by the screen.
 *
 * Mockup 12 draws one state: a PR being verified at `5 of 7`. The states a reader meets after
 * something has finished, or gone wrong, are the ones in which a verification page either stays
 * trustworthy or stops:
 *
 * | state | what the page becomes |
 * | ----- | --------------------- |
 * | **merged** | a record: the receipt — which sha, as whom, which actions ran — and nothing to arm |
 * | **closed** | a record of a PR its host closed without merging |
 * | **disarmed** | a re-check refused the merge, and the banner names **which** one |
 * | **sync lag** | the host has not been heard from, so the page says when it last was |
 *
 * *Blocked*, *member* and *loading* are decided where their regions are: `view.ts` promotes
 * *Return to loop* and draws a finished PR no action, `gates.ts` emphasises the red gates, says
 * a finished PR's verdicts are final and withholds the approval from a member, `criteria.ts`
 * offers a finished PR no authoring, and `pr-loading.tsx` draws the skeleton.
 *
 * **Nothing here is composed from a guess.** The receipt is the plan's own record
 * (`merge-receipt.ts`), the refusal is the service's code and sentence (`merge-terms.ts`), and the
 * sync stamp is the payload's `syncedAt` — a column the sync writes, never the page's clock.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { PullRequestHead, PullRequestPage } from "@/app/api/pull-requests";
import { clockOf } from "@/app/test-results/timeline";

import { MERGE_PLAN_ID, MERGE_PLAN_TITLE, planStanding } from "./merge-plan";
import { type MergeAnswer, type SkippedAction, honestIdentity, receipt } from "./merge-receipt";
import { refusalView } from "./merge-terms";
import { httpUrl, isFinished, prLabel } from "./view";

// --- the state banner ----------------------------------------------------------------------

/** The banner's accessible name. */
export const STATE_BANNER_LABEL = "Pull request state";

/** What a finished PR's page is, said once — there is nothing left on it to decide. */
export const NOW_A_RECORD =
  "This page is now the record: the gates stand at their final verdicts, and nothing here can " +
  "be armed, waived or approved.";

/** What a merge this plan did not make recorded. */
export const NOT_THIS_PLAN =
  "It was not merged by this plan, so no sha, identity or action was recorded here.";

/** A closed PR's headline. */
export const CLOSED_HEADLINE = "Closed without merging";

/** What is said after a refusal, before what to do about it. */
export const NOTHING_MERGED = "Nothing was merged.";

/** Which state the banner states. */
export type StateBannerKind =
  /** The plan recorded a merge. */
  | "merged"
  /** The PR merged on its host, and the plan recorded nothing. */
  | "merged_elsewhere"
  /** The PR is closed on its host, unmerged. */
  | "closed"
  /** A re-check disarmed the plan. */
  | "disarmed";

/** The hue a banner takes — never the only signal: the headline says the state in words. */
export type StateBannerTone = "ok" | "err" | "neutral";

/** A link the banner carries. */
export interface BannerLink {
  /** `PR #514 on its host`. */
  readonly label: string;
  readonly href: string;
  /** Whether it leaves the application. */
  readonly external: boolean;
}

/** A moment the banner prints. */
export interface BannerMoment {
  /** The moment, as recorded — the `<time>`'s `dateTime`. */
  readonly at: string;
  /** `14:45:02`. */
  readonly text: string;
}

/** The banner, ready to draw. */
export interface StateBannerView {
  readonly kind: StateBannerKind;
  readonly tone: StateBannerTone;
  /** The state, in words — `Merged — b7e41d0, as ken-s`. */
  readonly headline: string;
  /** When it happened, or `null` when nothing recorded it. */
  readonly moment: BannerMoment | null;
  /** What is said beneath the headline, a sentence each. */
  readonly lines: readonly string[];
  /** What the plan had switched on and the merge did not run. Empty unless merged. */
  readonly skipped: readonly SkippedAction[];
  /** Where the record continues — the host's pages, or the Merge plan card. */
  readonly links: readonly BannerLink[];
}

/**
 * A moment, for the banner.
 *
 * @param at The moment, as the payload states it, or `null`.
 * @returns It with its time of day, or `null` for none and for a value that is not a date.
 */
function moment(at: string | null): BannerMoment | null {
  if (at === null) return null;

  const text = clockOf(at);

  return text === null ? null : { at, text };
}

/**
 * The host's pages for a PR — the PR itself and the ticket it closes.
 *
 * @param head The PR's head.
 * @returns A link for each URL a link may carry (`httpUrl`); the ticket's only when there is one.
 */
export function hostLinks(head: PullRequestHead): readonly BannerLink[] {
  const links: BannerLink[] = [];
  const pr = httpUrl(head.url);
  const ticket = httpUrl(head.ticket?.url);

  if (pr !== null) {
    links.push({ label: `${prLabel(head.number)} on its host`, href: pr, external: true });
  }
  if (ticket !== null && head.ticket !== null) {
    links.push({ label: `issue ${head.ticket.key} on its tracker`, href: ticket, external: true });
  }

  return links;
}

/**
 * The banner for a PR this plan merged — the receipt.
 *
 * @param page The effective page.
 * @param answer What this page's merge answered, or `null` — for why an action did not run.
 * @returns The banner, or `null` when the plan recorded no merge.
 */
function mergedBanner(page: PullRequestPage, answer: MergeAnswer | null): StateBannerView | null {
  const record = receipt(page.plan, page.pullRequest.ticket?.key ?? null, answer);
  if (record === null) return null;

  return {
    kind: "merged",
    tone: "ok",
    headline: `Merged — ${record.sha}, as ${record.identity}`,
    moment: record.time === null ? null : { at: record.at, text: record.time },
    lines: [
      record.ran.length === 0
        ? "The merge ran no action afterwards."
        : `Ran: ${record.ran.join(" · ")}.`,
      NOW_A_RECORD,
    ],
    skipped: record.skipped,
    links: hostLinks(page.pullRequest),
  };
}

/**
 * The banner for a PR that merged on its host without this plan.
 *
 * @param head The PR's head.
 * @returns The banner, naming who the host says merged it when it says.
 */
function mergedElsewhereBanner(head: PullRequestHead): StateBannerView {
  const who = head.mergedBy === null ? "" : `, by ${honestIdentity(head.mergedBy)}`;

  return {
    kind: "merged_elsewhere",
    tone: "ok",
    headline: `Merged on its host${who}`,
    moment: moment(head.mergedAt),
    lines: [NOT_THIS_PLAN, NOW_A_RECORD],
    skipped: [],
    links: hostLinks(head),
  };
}

/**
 * The banner for a PR its host closed without merging.
 *
 * @param head The PR's head.
 * @returns The banner.
 */
function closedBanner(head: PullRequestHead): StateBannerView {
  return {
    kind: "closed",
    tone: "neutral",
    headline: CLOSED_HEADLINE,
    moment: null,
    lines: [`${prLabel(head.number)} was closed on its host, and nothing was merged.`, NOW_A_RECORD],
    skipped: [],
    links: hostLinks(head),
  };
}

/**
 * The banner for a plan a re-check disarmed — naming **which** re-check.
 *
 * @param page The effective page.
 * @returns The banner, or `null` for a plan that carries no reason.
 */
function disarmedBanner(page: PullRequestPage): StateBannerView | null {
  const reason = page.plan.disarmReason;
  if (reason === null) return null;

  const refusal = refusalView(reason.code, reason.message);

  return {
    kind: "disarmed",
    tone: "err",
    headline: `Disarmed — ${refusal.headline}`,
    moment: null,
    lines: [refusal.message, `${NOTHING_MERGED} ${refusal.next}`],
    skipped: [],
    links: [{ label: MERGE_PLAN_TITLE, href: `#${MERGE_PLAN_ID}`, external: false }],
  };
}

/**
 * The page's state banner.
 *
 * @param page The effective page — `merge-plan.ts`'s `effectivePage`, so the banner, the head and
 *   the card read one plan.
 * @param answer What this page's merge answered, or `null`.
 * @returns The banner for a merged, closed or disarmed PR; `null` for every other — a PR being
 *   verified, armed or blocked states itself in the head.
 */
export function stateBanner(
  page: PullRequestPage,
  answer: MergeAnswer | null,
): StateBannerView | null {
  switch (planStanding(page)) {
    case "merged":
      return mergedBanner(page, answer);
    case "merged_elsewhere":
      return mergedElsewhereBanner(page.pullRequest);
    case "closed":
      return closedBanner(page.pullRequest);
    case "disarmed":
      return disarmedBanner(page);
    default:
      return null;
  }
}

// --- a sync that has gone quiet ------------------------------------------------------------

/**
 * How long an open PR may go unsynced before the page says so, in seconds.
 *
 * Ten minutes: twice the tracker sync's default cadence of five, so one slow poll is not named
 * as a stall and a second missed one is.
 */
export const PR_SYNC_LAG_AFTER_SECONDS = 600;

/** What the sync-lag banner's retry says — it reads the page again, now. */
export const SYNC_LAG_RETRY = "Check again";

/** What the sync-lag banner's retry says while that read is in flight. */
export const SYNC_LAG_RETRYING = "Checking…";

/**
 * Why a PR's sync may have gone quiet — the banner's reason. It names every cause it cannot rule
 * out, because it can rule out none of them.
 */
export const SYNC_LAG_REASON =
  "The host may be unreachable, the source's credential may have been refused, or sync may " +
  "have stalled. The title, branches, counts and files shown here may be out of date.";

/** Why a PR no sync has written may not be what its host holds. */
export const NEVER_SYNCED_REASON =
  "What is shown is what was recorded when the PR was mirrored, and may not be what the host " +
  "holds now.";

/** How a PR's sync stands, when it lags. */
export type SyncLag =
  /** No sync has written the PR. */
  | { readonly kind: "never" }
  /** The last sync is older than the threshold. */
  | { readonly kind: "stale"; readonly sinceMs: number };

/**
 * Whether a PR's sync lags, and since when.
 *
 * Only a PR its host can still change can lag: a merged or closed one is supposed to be quiet.
 *
 * @param head The PR's head.
 * @param nowMs Now, in epoch milliseconds.
 * @param afterSeconds How long counts as stale. Defaults to {@link PR_SYNC_LAG_AFTER_SECONDS}.
 * @returns `never` for a PR no sync has written, `stale` with the last sync when it is older than
 *   `afterSeconds`, else `null` — also for a finished PR, for a stamp that cannot be parsed, and
 *   for a payload that carries no stamp at all (a service one release behind): what is unknown is
 *   never reported as late.
 */
export function syncLag(
  head: PullRequestHead,
  nowMs: number,
  afterSeconds: number = PR_SYNC_LAG_AFTER_SECONDS,
): SyncLag | null {
  if (isFinished(head.state)) return null;

  const stamp: string | null | undefined = head.syncedAt;
  if (stamp === undefined) return null;
  if (stamp === null) return { kind: "never" };

  const last = Date.parse(stamp);
  if (Number.isNaN(last) || nowMs - last < afterSeconds * 1000) return null;

  return { kind: "stale", sinceMs: last };
}

/**
 * When a sync happened, said against now.
 *
 * @param sinceMs The sync, in epoch milliseconds.
 * @param nowMs Now, in epoch milliseconds.
 * @returns `at 14:02` for a sync of the same UTC day, otherwise `on 2026-09-27 at 14:02` — a time
 *   of day alone would read as today's. UTC, as every clock on this page is.
 */
export function syncedWhen(sinceMs: number, nowMs: number): string {
  const at = new Date(sinceMs).toISOString();
  const day = at.slice(0, 10);
  const time = clockOf(at, false) ?? at.slice(11, 16);

  return day === new Date(nowMs).toISOString().slice(0, 10) ? `at ${time}` : `on ${day} at ${time}`;
}

/**
 * The sync-lag banner's headline.
 *
 * @param lag How the sync stands.
 * @param number The host's number for the PR.
 * @param nowMs Now, in epoch milliseconds.
 * @returns `Last synced with its host at 14:02 — PR #514's sync has gone quiet.`, or that the PR
 *   has never been synced.
 */
export function syncLagHeadline(lag: SyncLag, number: number, nowMs: number): string {
  const pr = prLabel(number);

  return lag.kind === "never"
    ? `${pr} has never been synced with its host.`
    : `Last synced with its host ${syncedWhen(lag.sinceMs, nowMs)} — ${pr}'s sync has gone quiet.`;
}

/**
 * The sync-lag banner's reason.
 *
 * @param lag How the sync stands.
 * @returns {@link NEVER_SYNCED_REASON} or {@link SYNC_LAG_REASON}.
 */
export function syncLagReason(lag: SyncLag): string {
  return lag.kind === "never" ? NEVER_SYNCED_REASON : SYNC_LAG_REASON;
}
