/**
 * The Danger zone card's copy and rules, as values
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)).
 *
 * Mockup 17's `c-12` card holds the only controls on the settings page whose mistakes are not
 * undone by pressing the button again. What makes each of them deliberate is **information, not
 * a click**: the pause confirmation says what pausing means and how many runs are in flight, the
 * disconnect dialog lists what will happen to *this* workspace as of now, and both destructive
 * confirmations ask for the workspace's name — which makes the reader look at which workspace
 * they are about to change. This module is every one of those sentences and the one rule they
 * share ({@link nameMatches}); the components draw them.
 *
 * Nothing here enforces anything. The gates are the service's: `owner` or `admin` to pause,
 * resume and disconnect, `owner` alone to delete, the name compared byte for byte and the
 * step-up verified there.
 *
 * Framework-free and pure.
 */

import type { DisconnectPreview, WorkspaceLifecycle } from "@/app/api/settings-lifecycle";

/* ------------------------------------------------------------------ the three rows */

/** The first row's name — mockup 17's, verbatim. */
export const PAUSE_TITLE = "Pause all loops";

/** What pausing means — mockup 17's line, verbatim, and the sentence the confirmation states. */
export const PAUSE_WHY = "queued issues stay queued; running loops finish their stage";

/** The second row's name — mockup 17's, verbatim. */
export const DISCONNECT_TITLE = "Disconnect GitHub App";

/** What disconnecting means — mockup 17's line, verbatim. */
export const DISCONNECT_WHY = "open PRs remain, loops stop";

/** The second row's button — the ellipsis says a dialog follows. */
export const DISCONNECT_BUTTON = "Disconnect…";

/** The third row's name — mockup 17's, verbatim. */
export const DELETE_TITLE = "Delete workspace";

/**
 * What deleting takes and leaves — mockup 17's line, with the window the service reports.
 *
 * @param days How long the recovery window is.
 * @returns `type the workspace name to confirm · 30-day recovery window`.
 */
export function deleteWhy(days: number): string {
  return `type the workspace name to confirm · ${String(days)}-day recovery window`;
}

/**
 * The third row's button — mockup 17's `Delete acme-robotics…`.
 *
 * @param workspaceName The workspace's name.
 * @returns The label.
 */
export function deleteButton(workspaceName: string): string {
  return `Delete ${workspaceName}…`;
}

/* ------------------------------------------------------------------ who may act */

/** What a reader who may not pause is told in the pause row. */
export const PAUSE_ROLE_NOTE = "An owner or an admin can pause and resume.";

/** What a reader who may not disconnect is told in the disconnect row. */
export const DISCONNECT_ROLE_NOTE = "An owner or an admin can disconnect.";

/** What anybody but an owner is told in the delete row. */
export const DELETE_OWNER_ONLY = "Only an owner can delete the workspace.";

/* ------------------------------------------------------------------ the pause row */

/** The states a pause row can be read in, as words. */
export const RUNNING_STATE = "Running";

/**
 * An instant as `2026-10-05 14:02 UTC`.
 *
 * UTC and labelled, as the audit card's stamps are: the card is read by people in several zones
 * about one workspace's one moment.
 *
 * @param iso An ISO-8601 instant.
 * @returns The stamp, or the input when it is not an instant.
 */
export function utcStamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;

  return `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)} UTC`;
}

/**
 * Where the pause switch stands, in words — what a reader who gets no switch reads, and what
 * says the same beside the switch for a reader who does not get its colour.
 *
 * @param lifecycle Where the workspace stands.
 * @returns `Running`, `Paused since 2026-10-05 14:02 UTC`, or that it is pending deletion.
 */
export function pauseState(lifecycle: WorkspaceLifecycle): string {
  if (lifecycle.state === "active") return RUNNING_STATE;
  if (lifecycle.state === "pending_delete") return "Stopped — the workspace is pending deletion";

  return lifecycle.changedAt === null ? "Paused" : `Paused since ${utcStamp(lifecycle.changedAt)}`;
}

/**
 * The pause switch's accessible name: what pressing it would do.
 *
 * @param paused Whether the workspace is paused now.
 * @returns `Pause all loops` or `Resume all loops`.
 */
export function pauseSwitchLabel(paused: boolean): string {
  return paused ? "Resume all loops" : PAUSE_TITLE;
}

/** The pause confirmation's title. */
export const PAUSE_DIALOG_TITLE = "Pause all loops?";

/** The pause confirmation's statement of what pausing means — {@link PAUSE_WHY}, as a sentence. */
export const PAUSE_SEMANTICS = `Pausing is a hold, not a stop: ${PAUSE_WHY}.`;

/** What the pause confirmation adds: where the reader will see it, and how it ends. */
export const PAUSE_BANNER_NOTE =
  "Every page says the workspace is paused until somebody resumes it — here, or from that banner.";

/** The pause confirmation's confirming button. */
export const PAUSE_CONFIRM = "Pause all loops";

/** That button while the pause is being sent. */
export const PAUSING = "Pausing…";

/** What the confirmations say while the live state is being read. */
export const PREVIEW_LOADING = "Reading what is running now…";

/**
 * How many runs are in flight, as the pause confirmation says it.
 *
 * @param count Runs not yet finished.
 * @returns The sentence — worded for none, one and several.
 */
export function inFlightSentence(count: number): string {
  if (count <= 0) return "No runs are in flight — nothing is interrupted, and nothing new starts.";
  if (count === 1) return "1 run is in flight — it finishes its current stage, then holds.";

  return `${String(count)} runs are in flight — each finishes its current stage, then holds.`;
}

/**
 * What the pause confirmation says when the count could not be read. The pause is still the
 * reader's to confirm: the count informs the decision, it does not gate it.
 *
 * @param reason Why the read failed, as the service said it.
 * @returns The sentence.
 */
export function inFlightUnavailable(reason: string): string {
  return `The number of runs in flight is unavailable: ${reason} Any that are running finish their current stage, then hold.`;
}

/* ------------------------------------------------------------------ the typed confirmation */

/**
 * Whether what the reader typed is the workspace's name — **exactly**.
 *
 * Byte for byte, as the service compares it: nothing is trimmed and no case is folded. The
 * point of typing the name is to make the reader look at it; a comparison that forgave a
 * near-miss would accept the name of a neighbouring workspace's near-twin.
 *
 * @param typed The field's value.
 * @param workspaceName The workspace's name.
 * @returns `true` only for the identical string — and never for an empty name.
 */
export function nameMatches(typed: string, workspaceName: string): boolean {
  return workspaceName !== "" && typed === workspaceName;
}

/**
 * The typed confirmation's label.
 *
 * @param workspaceName The workspace's name.
 * @returns `Type acme-robotics to confirm`.
 */
export function typeNameLabel(workspaceName: string): string {
  return `Type ${workspaceName} to confirm`;
}

/**
 * Why a confirming button cannot be pressed yet.
 *
 * @param workspaceName The workspace's name.
 * @returns The reason.
 */
export function typeNameReason(workspaceName: string): string {
  return `Type the workspace's name — ${workspaceName} — exactly as it is written to continue.`;
}

/** Closes a dialog without doing anything. */
export const CANCEL = "Cancel";

/** Closes a dialog whose work is done. */
export const DONE = "Done";

/* ------------------------------------------------------------------ disconnect */

/** The disconnect dialog's title. */
export const DISCONNECT_DIALOG_TITLE = "Disconnect GitHub?";

/** What the disconnect dialog says above the preview. */
export const DISCONNECT_LEAD = "As of now, disconnecting GitHub from this workspace means:";

/** The disconnect dialog's confirming button. */
export const DISCONNECT_CONFIRM = "Disconnect GitHub";

/** That button while the disconnect is being sent. */
export const DISCONNECTING = "Disconnecting…";

/** Why the disconnect cannot be confirmed while its preview has not been read. */
export const DISCONNECT_NEEDS_PREVIEW =
  "What disconnecting would do has not been read yet, so there is nothing to confirm.";

/**
 * What the disconnect dialog says when its preview could not be read. Unlike the pause, a
 * disconnect is not confirmable blind — the preview is the confirmation's content.
 *
 * @param reason Why the read failed, as the service said it.
 * @returns The sentence.
 */
export function previewUnavailable(reason: string): string {
  return `What disconnecting would do could not be read: ${reason}`;
}

/** The result summary's title. */
export const DISCONNECTED_TITLE = "GitHub disconnected";

/** What the result summary says above its counts. */
export const DISCONNECTED_LEAD = "As things stood when the disconnect ran:";

/**
 * A count and its noun — `1 run`, `4 runs`.
 *
 * @param count How many.
 * @param singular The noun for one.
 * @param plural The noun for any other number. Defaults to the singular with an `s`.
 * @returns The phrase.
 */
function counted(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

/**
 * What a disconnect did, from the counts the service answered with — the result summary.
 *
 * Past tense and from the answer, not from the preview the dialog showed: a run can finish
 * between the preview and the press, and the summary says what was true when it ran.
 *
 * @param result The disconnect's answer.
 * @returns One sentence per fact: pull requests, runs, sources and repositories, the token, and
 *   that the workspace is now paused.
 */
export function disconnectSummary(result: DisconnectPreview): readonly string[] {
  return [
    result.openPullRequests === 0
      ? "No pull requests were open."
      : `${counted(result.openPullRequests, "open pull request")} ${
          result.openPullRequests === 1 ? "was" : "were"
        } left on GitHub, untouched.`,
    result.activeRuns === 0
      ? "No runs were in flight."
      : `${counted(result.activeRuns, "run")} in flight ${
          result.activeRuns === 1 ? "finishes its" : "finish their"
        } current stage, then ${result.activeRuns === 1 ? "stops" : "stop"}.`,
    `${counted(result.syncingSources, "GitHub source")} ${
      result.syncingSources === 1 ? "was" : "were"
    } paused; ${counted(result.enabledRepositories, "enabled repository", "enabled repositories")} no longer ${
      result.enabledRepositories === 1 ? "syncs" : "sync"
    }.`,
    result.tokenStored ? "The stored GitHub token was deleted." : "No GitHub token was stored.",
    "All loops are paused. Reconnect GitHub in Sources, then resume here.",
  ];
}

/* ------------------------------------------------------------------ delete */

/**
 * The delete dialog's title.
 *
 * @param workspaceName The workspace's name.
 * @returns `Delete acme-robotics?`.
 */
export function deleteDialogTitle(workspaceName: string): string {
  return `Delete ${workspaceName}?`;
}

/** What the delete dialog says above its consequences. */
export const DELETE_LEAD = "Deleting this workspace:";

/**
 * What deleting the workspace does — the dialog's explicit list.
 *
 * @param days How long the recovery window is.
 * @returns The consequences, in the order they happen.
 */
export function deleteConsequences(days: number): readonly string[] {
  const window = `${String(days)} days`;

  return [
    "Freezes every page of it behind a recovery screen, at once.",
    "Signs out everyone in it who is not an owner.",
    "Stops all dispatch: no run starts, no stage advances, no build is offered.",
    `Can be undone by an owner for ${window} — Restore on the recovery screen.`,
    `After ${window}, destroys the workspace's encryption key, then deletes its data. That cannot be undone.`,
  ];
}

/** The delete dialog's confirming button. */
export const DELETE_CONFIRM = "Delete workspace";

/** That button while the delete is being sent. */
export const DELETING = "Deleting…";

/**
 * The `code` the service answers when the typed name is not exactly the workspace's.
 *
 * Written here rather than imported: `app/api/settings-lifecycle.ts` is server-only, and the
 * dialog that branches on this is a Client Component. A test holds the two equal.
 */
export const NAME_MISMATCH = "workspace_name_mismatch";

/** What the delete dialog says when the service asks for the step-up. */
export const STEP_UP_NOTE =
  "Deleting a workspace needs a recent sign-in. Confirm your password to continue — or, on an account without one, sign out and in again and delete within five minutes.";

/* ------------------------------------------------------------------ pending deletion */

/** What the card says in place of its controls once the workspace is pending deletion. */
export const PENDING_DELETE_NOTE =
  "This workspace is pending deletion. Nothing here can be changed until an owner restores it.";

/** The link to the recovery screen from that note. */
export const RECOVERY_LINK = "Open the recovery screen";

/* ------------------------------------------------------------------ unread */

/**
 * What the Danger zone's seat says when the workspace's lifecycle could not be read.
 *
 * @param reason What the service said.
 * @returns The sentence. It says no control is drawn, because a pause switch in a guessed
 *   position would be the one wrong control this page cannot afford.
 */
export function lifecycleUnread(reason: string): string {
  return `Whether this workspace is running or paused could not be read, so no control is drawn: ${reason}`;
}

/* ------------------------------------------------------------------ the live preview's state */

/**
 * The live-state read behind both confirmations: the pause's in-flight count and the
 * disconnect's consequences are one read (`GET /settings/lifecycle/disconnect-preview`), made
 * when a dialog opens and never kept between opens.
 */
export type PreviewState =
  /** The read has not answered yet. */
  | { readonly status: "loading" }
  /** What the service answered. */
  | { readonly status: "ready"; readonly preview: DisconnectPreview }
  /** The service refused, with its sentence. */
  | { readonly status: "failed"; readonly reason: string };

/** A preview that has been asked for and not answered. */
export const PREVIEW_PENDING: PreviewState = { status: "loading" };
