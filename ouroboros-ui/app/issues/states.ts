/**
 * The intake screen's guidance states — every state the mockup does not show, decided and
 * worded ([#120](https://github.com/NobuData/ouroboros/issues/120)).
 *
 * Mockup 03 draws a full backlog. Reality starts with no GitHub token, or a token pointed at
 * no enabled repository, or a first sync still running, or a repository with nothing open,
 * or a filter that matches nothing — and each is a different problem with a different fix,
 * which a blank table tells the reader none of. This module decides **which** of them a page
 * with no rows is in ({@link guidanceKind}), what sits over the rows when the sync is not
 * running ({@link syncBanner}), and what each says. `app/issues/guidance.tsx` and
 * `app/issues/sync-banner.tsx` draw; `app/issues/backlog-table.tsx` seats both.
 *
 * ### The reason is M.4's, never guessed
 *
 * `GET /api/v1/backlog/sync-status` ([#113](https://github.com/NobuData/ouroboros/issues/113))
 * derives every field from state that is actually true — `not_configured` is whether a token
 * exists, `no_repositories` how many repositories are enabled, `rate_limited` what the
 * GitHub client's own guard says — and splits `state` from `pause` so a client can say
 * *paused* without knowing every reason the service can give. The banner's headline is this
 * module's word for the reason and the sentence under it is the service's own, so a
 * rate-limited source explains itself in the service's words whatever provider it is; the
 * amendment filed with the Workflow Studio roadmap asks for exactly that.
 *
 * ### Said once
 *
 * DASH-I.7's rule ([#86](https://github.com/NobuData/ouroboros/issues/86)): a surface says
 * what could not be read, and one banner says why, once, with the way out. When the empty
 * state *is* the guidance for the pause — no token, no repository — the banner stays away,
 * because the same reason twice on one card reads as two problems.
 *
 * Framework-free and deliberately not `server-only`, the way `app/issues/table.ts` is: the
 * table is a Client Component and the suite holds the copy.
 */

import type { BacklogListing, SyncStatus } from "@/app/api/backlog";
import type { Reading } from "@/app/api/reading";
import { WORKSPACE_PARAM } from "@/app/login/view";
import { LOGIN_PATH } from "@/app/paths";

import { emptyKind } from "./table";

/** Why the sync is not running — the contract's enum, without its `null`. */
export type SyncPause = NonNullable<SyncStatus["pause"]>;

/* ------------------------------------------------------------------ which empty state */

/** What the card draws instead of rows, once the page has none. */
export type GuidanceKind =
  /** The filter emptied a backlog that has open issues: send the reader to the bar. */
  | "matches"
  /** No GitHub token: nothing can be synced until one is connected. */
  | "no-token"
  /** A token pointed at nothing: no repository is enabled. */
  | "no-repos"
  /** The first sync is still running: rows are on their way. */
  | "first-sync"
  /** Synced, and there is nothing open — the good kind of empty. */
  | "clear"
  /** Nothing mirrored, for a reason the banner carries or nobody can name yet. */
  | "mirrored";

/**
 * Which guidance a page with no rows shows.
 *
 * The filter's doing comes first — a narrowed view of a backlog that has open issues is the
 * bar's problem whatever the sync is doing. Then the two states a reader can fix, in the
 * order M.4 ranks them (no token first, since nothing else can be true in a useful way
 * without one); then a first sync that has not yet delivered; then *clear*, which is only
 * honest over a loop that is running and has synced at least once. Everything else — a
 * pause of another kind, a loop that has never run, a status that could not be read — is the
 * plain *no issues yet*, with the banner saying why when it can.
 *
 * @param listing The page's listing.
 * @param filtered Whether anything differs from the default view.
 * @param sync M.4's status, or why it could not be read.
 * @returns The kind.
 */
export function guidanceKind(
  listing: Pick<BacklogListing, "meta" | "total">,
  filtered: boolean,
  sync: Reading<SyncStatus>,
): GuidanceKind {
  if (emptyKind(listing, filtered) === "matches") return "matches";
  if (!sync.ok) return "mirrored";

  const status = sync.value;

  if (status.pause === "not_configured") return "no-token";
  if (status.pause === "no_repositories") return "no-repos";
  if (status.running && status.syncedAt === null) return "first-sync";
  if (status.state === "ok" && status.syncedAt !== null) return "clear";
  return "mirrored";
}

/* ------------------------------------------------------------------ the banner */

/** What sits over the rows, if anything. */
export type SyncBannerState =
  /** Nothing to say: the loop is running, or the empty state already says it. */
  | { readonly kind: "none" }
  /** The status could not be read — the reason, and the way to ask again. */
  | { readonly kind: "unread"; readonly reason: string }
  /** The loop is paused — the headline names the kind, the reason is the service's. */
  | {
      readonly kind: "paused";
      readonly pause: SyncPause;
      readonly headline: string;
      readonly reason: string;
      /** Seconds until a rate limit resets, or `null` when the wait is not known. */
      readonly retryAfterSeconds: number | null;
    }
  /** The first sync is running over rows already drawn — progress, not a problem. */
  | { readonly kind: "first-sync"; readonly message: string };

/**
 * What the banner draws.
 *
 * @param sync M.4's status, or why it could not be read.
 * @param guidance The empty state the card is drawing, or `null` when it is drawing rows.
 * @param openCount The listing's `meta.openCount` — what the first sync has delivered so far.
 * @returns The state. Nothing when the loop is running normally, and nothing when the empty
 *   state already carries the same reason (the module note on saying it once).
 */
export function syncBanner(
  sync: Reading<SyncStatus>,
  guidance: GuidanceKind | null,
  openCount: number,
): SyncBannerState {
  if (!sync.ok) return { kind: "unread", reason: sync.reason };

  const status = sync.value;

  if (status.state === "paused" && status.pause !== null) {
    if (guidance === "no-token" || guidance === "no-repos") return { kind: "none" };

    return {
      kind: "paused",
      pause: status.pause,
      headline: PAUSE_HEADLINE[status.pause],
      reason: status.message ?? UNEXPLAINED_PAUSE,
      retryAfterSeconds: status.pause === "rate_limited" ? status.retryAfterSeconds : null,
    };
  }

  if (status.running && status.syncedAt === null && guidance !== "first-sync") {
    return { kind: "first-sync", message: firstSyncProgress(openCount) };
  }

  return { kind: "none" };
}

/**
 * The banner's headline for each pause — this screen's word for the kind, in front of the
 * service's own sentence. Every one names the reason in words rather than by hue alone
 * (design system § 3.4), and none is *something went wrong*.
 */
export const PAUSE_HEADLINE: Record<SyncPause, string> = {
  not_configured: "Sync paused — no GitHub token is connected.",
  unauthorized: "Sync paused — GitHub rejected the token.",
  not_found: "Sync paused — a repository could not be found.",
  rate_limited: "Sync paused — GitHub's rate limit is reached.",
  upstream_error: "Sync paused — GitHub is not answering.",
  no_repositories: "Sync paused — no repository is enabled.",
};

/**
 * What the banner says under a pause the service gave no sentence for. The contract carries a
 * message beside every pause, so this is the guard rather than the expected case — the
 * dashboard's banner keeps the same one.
 */
export const UNEXPLAINED_PAUSE = "The service gave no reason.";

/** What the banner says when the status itself could not be read. The reason follows. */
export const SYNC_UNREAD_HEADLINE = "The sync status could not be read.";

/** The banner's one control: ask the poll now. */
export const CHECK_AGAIN_LABEL = "Check again";

/** The control while an ask is in flight. */
export const CHECKING_LABEL = "Checking…";

/**
 * How long until a rate limit resets, as a sentence.
 *
 * Relative rather than a clock time — the ticket's diagram writes *Resumes 14:20* — because
 * the banner is rendered on the server for the first paint and in the browser for every poll
 * after, and a clock time formatted in two time zones is a hydration mismatch. A wait is the
 * same number on both sides.
 *
 * @param seconds Seconds left. Anything at or below zero reads as *any moment now*, which is
 *   what a wait that has elapsed on the client's clock means.
 * @returns *Resumes in about 20 minutes.* — or *in 40 seconds* under a minute, or *any moment
 *   now*.
 */
export function resumesIn(seconds: number): string {
  const left = Math.ceil(seconds);

  if (left <= 0) return "Resumes any moment now.";
  if (left < 60) return `Resumes in ${left} ${left === 1 ? "second" : "seconds"}.`;

  const minutes = Math.ceil(left / 60);
  return `Resumes in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

/** Whole numbers, grouped the way a person reads a count: `1,204`. */
const WHOLE = new Intl.NumberFormat("en-US");

/**
 * The first sync's progress, as the ticket words it.
 *
 * @param openCount The listing's `meta.openCount` — open issues mirrored so far, in the scope
 *   the bar selected.
 * @returns *First sync running — 120 open issues so far…*
 */
export function firstSyncProgress(openCount: number): string {
  return `First sync running — ${WHOLE.format(openCount)} open ${openCount === 1 ? "issue" : "issues"} so far…`;
}

/* ------------------------------------------------------------------ the guidance copy */

/** What the card says over a workspace with no GitHub token. */
export const NO_TOKEN_TITLE = "Connect GitHub to watch your backlog";

/** …and what connecting one gives it. */
export const NO_TOKEN_NOTE =
  "This workspace has no GitHub token, so there is no backlog to watch yet. Once one is " +
  "connected, every enabled repository's issues are mirrored here and sized as they arrive.";

/** The admin's control. */
export const OPEN_SETTINGS_LABEL = "Open settings";

/**
 * Why the control cannot act yet — its tooltip, and the whole of its honesty.
 *
 * The ticket's amendment points the control at the ticket-source settings surface of
 * [#141](https://github.com/NobuData/ouroboros/issues/141), which is not built; the sidebar's
 * **Settings** entry is still a *soon* row for the same reason. A control drawn inert with the
 * issue that unblocks it is what the dashboard does for the same situation, and what #49's
 * *no dead nav links* asks for: labelled rather than absent, and never a link to a `404`.
 */
export const OPEN_SETTINGS_SOON =
  "The settings screen for ticket sources is not built yet — it arrives with #141. Until " +
  "then a GitHub token is set through the service's settings endpoint.";

/**
 * What a reader who may not connect one is told instead of the control.
 *
 * An explanation rather than an inert control, for the reason the providers page gives: the
 * empty state is the first thing a new member sees, and a disabled button with a tooltip is
 * a worse first sentence than one that says who can act.
 */
export const NO_TOKEN_MEMBER_NOTE =
  "Connecting GitHub is for workspace owners and admins. Ask one of them to add a token — " +
  "the backlog appears here the moment the first sync runs.";

/** What the card says over a token pointed at nothing. */
export const NO_REPOS_TITLE = "Enable an org and repos to begin";

/** …and where that is done. */
export const NO_REPOS_NOTE =
  "A GitHub token is connected, but no repository is enabled for this workspace, so there " +
  "is nothing to watch. Step 2 of sign-in is where organisations and their repositories " +
  "are switched on.";

/** The admin's control: a link to sign-in's step 2, opened on this workspace. */
export const CHOOSE_REPOS_LABEL = "Choose repos";

/** What a reader who may not enable one is told instead of the link. */
export const NO_REPOS_MEMBER_NOTE =
  "Enabling repositories is for workspace owners and admins. Ask one of them to switch a " +
  "repository on — its issues appear here after the first sync.";

/** What the card says while the first sync has delivered nothing yet. */
export const FIRST_SYNC_TITLE = "First sync running";

/** …and what to expect. */
export const FIRST_SYNC_NOTE =
  "Ouroboros is reading every enabled repository from GitHub for the first time. Issues " +
  "appear here as they arrive, and each one is sized as soon as it does.";

/** What the card says over a synced scope with nothing open — a celebration, not an error. */
export const CLEAR_TITLE = "Backlog clear";

/** …and that it will notice the next one. */
export const CLEAR_NOTE =
  "Every enabled repository is synced and nothing is open. The next issue GitHub opens " +
  "appears here within a poll, already being sized.";

/** The mark beside the clear state's title — decoration, hidden from a screen reader. */
export const CLEAR_MARK = "✓";

/** The *no issues match* state's control, which does what the bar's **Clear all** does. */
export const CLEAR_FILTERS_LABEL = "Clear filters";

/**
 * Where **Choose repos** goes: sign-in's step 2, opened on this workspace's row.
 *
 * `?workspace=<slug>` is the marker `app/login/view.ts` reads as *being here on purpose* —
 * without it a settled browser is sent straight back to the dashboard.
 *
 * @param slug The workspace's slug.
 * @returns `/login?workspace=<slug>`.
 */
export function chooseReposHref(slug: string): string {
  return `${LOGIN_PATH}?${WORKSPACE_PARAM}=${encodeURIComponent(slug)}`;
}
