/**
 * Every decision the runner's `⋯` menu makes, and every word it and its confirmations say
 * (AI.5, [#260](https://github.com/NobuData/ouroboros/issues/260)).
 *
 * Draining is the operation that separates a build farm from a list of servers: the runner
 * finishes what it is doing and accepts nothing new, so a machine can be patched without
 * killing a firmware build at minute eleven. Removing is its destructive counterpart, and it is
 * **guarded to machines that are offline or drained** — removing one mid-build orphans the job
 * and loses the log.
 *
 * **Framework-free and pure**, as `app/farm/runners.ts` is. The drawing is
 * `app/farm/runner-menu.tsx`'s and `app/farm/lifecycle-dialog.tsx`'s; the writes are
 * `app/farm/lifecycle-actions.ts`'s, which imports its outcome type and its sentences from here
 * because a `"use server"` module may export nothing but async functions.
 *
 * ### Intent and observation are two columns, and the menu reads both
 *
 * A drain writes `desiredState`; the pill is `status`, which is the agent's own heartbeat and
 * follows on the next one (`ouroboros-rest`: *the pill does not change in this response*) —
 * `runners.ts`'s `intentNote` is what the row says in between. So
 * **which of Drain and Undrain is offered is decided on the intent** — a runner somebody has
 * already drained offers Undrain at once, not a second Drain — while **whether Remove is
 * permitted is decided on the observation**, because that is what the service's guard reads.
 *
 * ### The guard here is a courtesy, and the service's is the guard
 *
 * A page is up to ten seconds old. A runner the page shows as drained may have been returned to
 * service since, so the removal is attempted and it is the service's `409` — naming the state
 * the machine is *now* in — that refuses it ({@link lifecycleRefusal}).
 *
 * ### A member sees no action at all
 *
 * The issue is explicit that the lifecycle items are **absent rather than disabled** for a
 * member — a departure from this page's usual *inert, with the reason* — so {@link runnerMenu}
 * leaves them out. **View details** stays: it is a read, and every member may read the farm.
 * That is presentation. The gate that enforces is the service's, `owner` or `admin`.
 */

import { RUNNER_PILLS, type RunnerIntent, type RunnerStatus } from "./runners";

/* ------------------------------------------------------------------ the menu */

/** The three writes the menu can ask for. */
export type LifecycleAction = "drain" | "undrain" | "remove";

/** Everything the menu can ask for: a write, or the details sheet. */
export type RunnerMenuAction = LifecycleAction | "details";

/** One row of the menu. */
export interface RunnerMenuItem {
  /** What pressing it asks for. */
  readonly action: RunnerMenuAction;
  /** The word on it. */
  readonly label: string;
  /**
   * Why it cannot act, or `null` when it can. A blocked item is **drawn, inert, with this
   * sentence visible inside it** — *blocked, with an explanation* is the acceptance criterion,
   * and a tooltip is an explanation a keyboard never reaches.
   */
  readonly reason: string | null;
  /** Whether it is the destructive one, and drawn as such. */
  readonly danger: boolean;
}

export const DRAIN = "Drain";
export const UNDRAIN = "Undrain";
export const REMOVE = "Remove";
export const VIEW_DETAILS = "View details";

/**
 * Whether the service's guard would let a runner be removed, going by what the page last saw.
 *
 * @param status What the fleet last observed.
 * @returns `true` for `offline` and `draining` — the service's `REMOVABLE_STATUSES`.
 */
export function isRemovable(status: RunnerStatus): boolean {
  return status === "offline" || status === "draining";
}

/**
 * Why a connected runner cannot be removed.
 *
 * @param status What the fleet last observed — `online` or `building`.
 * @returns The sentence: the state in the pill's own word, the consequence, and the way through.
 */
export function removeBlocked(status: RunnerStatus): string {
  return (
    `Blocked while ${RUNNER_PILLS[status].label}: removing a connected machine orphans what it ` +
    "is building and loses the log. Drain it first."
  );
}

/**
 * The menu for one runner.
 *
 * @param status What the fleet last observed — decides whether Remove is permitted.
 * @param intent What an operator last intended — decides between Drain and Undrain.
 * @param mayAdminister Whether this reader may act on the fleet.
 * @returns The items, in the issue's order. **View details alone** for a member, and for a
 *   machine that has been retired.
 */
export function runnerMenu(
  status: RunnerStatus,
  intent: RunnerIntent,
  mayAdminister: boolean,
): readonly RunnerMenuItem[] {
  const details: RunnerMenuItem = {
    action: "details",
    label: VIEW_DETAILS,
    reason: null,
    danger: false,
  };

  if (!mayAdminister || status === "removed" || intent === "removed") return [details];

  // The intent alone. A machine still reporting `draining` after it was returned to service is
  // on its way back, and offering it Undrain again would be offering what was already asked.
  const drained = intent === "draining";

  return [
    drained
      ? { action: "undrain", label: UNDRAIN, reason: null, danger: false }
      : { action: "drain", label: DRAIN, reason: null, danger: false },
    {
      action: "remove",
      label: REMOVE,
      reason: isRemovable(status) ? null : removeBlocked(status),
      danger: true,
    },
    details,
  ];
}

/* ------------------------------------------------------------------ the confirmations */

/** What the dialog needs to know about the runner it is asking about. */
export interface LifecycleSubject {
  /** `forge-01`. */
  readonly name: string;
  /** `#479 zephyr build`, or `null` when it is running nothing. */
  readonly job: string | null;
}

/** The safe answer, on every confirmation. */
export const KEEP = "Cancel";

/** What the dialog's dismissal says once a write has been refused. */
export const CLOSE = "Close";

/**
 * The dialog's heading — and what the dialog answers to.
 *
 * @param action Which write.
 * @param name The runner.
 * @returns `Drain forge-01?`
 */
export function lifecycleTitle(action: LifecycleAction, name: string): string {
  switch (action) {
    case "drain":
      return `Drain ${name}?`;
    case "undrain":
      return `Return ${name} to service?`;
    case "remove":
      return `Remove ${name} from the fleet?`;
  }
}

/**
 * What a drain or an undrain will do, in a sentence.
 *
 * **The current job continues** is the promise a drain makes, so the sentence names the job.
 *
 * @param action `drain` or `undrain`.
 * @param subject The runner, and what it is running.
 * @returns The sentence.
 */
export function lifecycleNote(
  action: Exclude<LifecycleAction, "remove">,
  subject: LifecycleSubject,
): string {
  if (action === "undrain") return `${subject.name} accepts new builds again.`;

  return subject.job === null
    ? `${subject.name} accepts no new builds until it is returned to service. There is no deadline.`
    : `${subject.name} finishes ${subject.job} and accepts nothing new until it is returned ` +
        "to service. The build is not interrupted, and there is no deadline.";
}

/**
 * What removing a runner does — **what will happen, not *are you sure***.
 *
 * Each line is something the service does (`ouroboros-rest`'s `runners.service.ts`), in the
 * order a fleet owner would ask about them.
 */
export const REMOVE_CONSEQUENCES: readonly string[] = [
  "It leaves the fleet: this table, and every count on this page.",
  "Its certificate is revoked, so the machine cannot reconnect. Bringing it back means " +
    "enrolling it again.",
  "The builds it ran keep their history and their logs.",
  "The removal is recorded in the audit trail, with your name.",
];

/** What introduces {@link REMOVE_CONSEQUENCES}. */
export const REMOVE_LEAD = "Removing a runner cannot be undone. When you confirm:";

/**
 * The confirming button's words.
 *
 * @param action Which write.
 * @param name The runner.
 * @param working Whether the write is in flight.
 * @returns `Drain forge-01`, or `Draining…`.
 */
export function lifecycleConfirm(action: LifecycleAction, name: string, working: boolean): string {
  switch (action) {
    case "drain":
      return working ? "Draining…" : `Drain ${name}`;
    case "undrain":
      return working ? "Returning…" : `Return ${name} to service`;
    case "remove":
      return working ? "Removing…" : `Remove ${name}`;
  }
}

/* ------------------------------------------------------------------ outcomes and refusals */

/** What a lifecycle write answers. */
export type LifecycleOutcome =
  | {
      readonly ok: true;
      /**
       * Whether the frame reached the agent's session, or `null` for a removal, which sends
       * none. `false` is not a failure — see {@link lifecycleDone}.
       */
      readonly pushed: boolean | null;
    }
  | { readonly ok: false; readonly reason: string };

/** The parts of a refusal the mapper reads — `ApiError`'s, without importing the class. */
export interface LifecycleRefusal {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export const FORBIDDEN_CODE = "forbidden";
export const RUNNER_NOT_FOUND_CODE = "farm_runner_not_found";
export const RUNNER_REMOVED_CODE = "farm_runner_removed";
export const RUNNER_NOT_REMOVABLE_CODE = "farm_runner_not_removable";

/** Every refused write ends on this: the runner is as it was. */
const NOTHING_CHANGED = "Nothing was changed.";

export const LIFECYCLE_FORBIDDEN = `Runner actions need an owner or an admin. ${NOTHING_CHANGED}`;
export const RUNNER_GONE = "That runner is no longer in this workspace.";
export const RUNNER_ALREADY_REMOVED = "That runner has already been removed.";

/** The statuses a refusal's `details.status` may carry. */
const STATUSES: readonly RunnerStatus[] = ["online", "building", "draining", "offline", "removed"];

/** Each write, as the word that follows *could not be*. */
const PAST: Readonly<Record<LifecycleAction, string>> = {
  drain: "drained",
  undrain: "returned to service",
  remove: "removed",
};

/**
 * What a refused write says.
 *
 * @param action Which write was refused.
 * @param refusal The service's refusal.
 * @returns The sentence. **A refusal means nothing was changed.** For the removal guard it says
 *   the state the machine is *now* in — the page that offered the removal was up to ten seconds
 *   old, and the service's answer is the newer one.
 */
export function lifecycleRefusal(action: LifecycleAction, refusal: LifecycleRefusal): string {
  switch (refusal.code) {
    case FORBIDDEN_CODE:
      return LIFECYCLE_FORBIDDEN;
    case RUNNER_NOT_FOUND_CODE:
      return RUNNER_GONE;
    case RUNNER_REMOVED_CODE:
      return RUNNER_ALREADY_REMOVED;
    case RUNNER_NOT_REMOVABLE_CODE: {
      const status = STATUSES.find((candidate) => candidate === refusal.details.status);
      const now = status === undefined ? "connected" : RUNNER_PILLS[status].label;

      return (
        `It is ${now} now, so it was not removed — removing a connected machine orphans what ` +
        "it is building. Drain it, and remove it once it has finished."
      );
    }
    default:
      return `The runner could not be ${PAST[action]}. ${NOTHING_CHANGED} Try again.`;
  }
}

/**
 * What is said out loud once a write has taken.
 *
 * **Asked, rather than done, while `pushed` is false** — the service's own advice. The intent
 * is in the database either way; what differs is whether the agent already knows.
 *
 * @param action Which write.
 * @param name The runner.
 * @param pushed Whether the frame reached the agent, or `null` for a removal.
 * @returns The sentence.
 */
export function lifecycleDone(
  action: LifecycleAction,
  name: string,
  pushed: boolean | null,
): string {
  if (action === "remove") return `${name} was removed from the fleet.`;

  const asked = action === "drain" ? "Drain requested" : "Return to service requested";
  if (pushed !== true) return `${asked} — ${name} is told at its next heartbeat.`;

  return action === "drain"
    ? `${name} is draining: it finishes what it is running and accepts nothing new.`
    : `${name} is back in service.`;
}
