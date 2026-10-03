/**
 * What the lifecycle routes answer (BR.5, [#489](https://github.com/NobuData/ouroboros/issues/489)) —
 * the contract's `WorkspaceLifecycle` and `DisconnectPreview` schemas.
 *
 * The banner is part of the state resource so the shell renders it from the one read it already
 * needs: a paused workspace says so on every page, and silence that looks like a malfunction is
 * the failure this exists to prevent.
 */

import type { WorkspaceLifecycleState } from "../db/schema";
import type { DisconnectCounts } from "./lifecycle.repository";
import type { WorkspaceStanding } from "./lifecycle.state";
import { RECOVERY_WINDOW_DAYS } from "./lifecycle.states";

/** Where the banner's action lands — the settings page's Danger zone card. */
export const DANGER_ZONE_PATH = "/settings#danger";

/** The app-wide banner the shell renders while a workspace is not `active`. */
export interface LifecycleBannerResource {
  /** Which banner — the state that raised it. */
  readonly kind: Exclude<WorkspaceLifecycleState, "active">;
  /** What the banner says. */
  readonly message: string;
  /** When the state began, ISO 8601. */
  readonly since: string | null;
  /** The action's label — *Resume* or *Restore*. */
  readonly actionLabel: string;
  /** Where the action lives. */
  readonly actionPath: string;
}

/** The workspace's lifecycle, as `GET /settings/lifecycle` answers it. */
export interface LifecycleResource {
  readonly state: WorkspaceLifecycleState;
  /** When the state last changed, or null if it never has. */
  readonly changedAt: string | null;
  /** Who changed it, or null. */
  readonly changedBy: string | null;
  /** When the recovery window closes; non-null exactly while `pending_delete`. */
  readonly purgeAfter: string | null;
  /** The window's length, in days — the card's *"30-day recovery window"*. */
  readonly recoveryWindowDays: number;
  /** The banner to render app-wide, or null while `active`. */
  readonly banner: LifecycleBannerResource | null;
}

/** What a disconnect would do, computed from live state. */
export interface DisconnectPreviewResource extends DisconnectCounts {
  /** The consequences in words, one per line — what the confirm dialog lists. */
  readonly consequences: readonly string[];
}

/**
 * The banner for a standing.
 *
 * @param standing - Where the workspace stands.
 * @returns The banner, or null while `active`.
 */
export function bannerFor(standing: WorkspaceStanding): LifecycleBannerResource | null {
  const since = standing.changedAt?.toISOString() ?? null;

  switch (standing.state) {
    case "active":
      return null;
    case "paused":
      return {
        kind: "paused",
        message:
          "All loops are paused. Running loops finish their stage; queued issues stay queued.",
        since,
        actionLabel: "Resume",
        actionPath: DANGER_ZONE_PATH,
      };
    case "pending_delete":
      return {
        kind: "pending_delete",
        message: `This workspace is scheduled for deletion on ${
          standing.purgeAfter?.toISOString().slice(0, 10) ?? "the end of its recovery window"
        }. An owner can restore it until then.`,
        since,
        actionLabel: "Restore",
        actionPath: DANGER_ZONE_PATH,
      };
  }
}

/**
 * The state resource.
 *
 * @param standing - Where the workspace stands.
 * @returns The resource.
 */
export function lifecycleResource(standing: WorkspaceStanding): LifecycleResource {
  return {
    state: standing.state,
    changedAt: standing.changedAt?.toISOString() ?? null,
    changedBy: standing.changedBy,
    purgeAfter: standing.purgeAfter?.toISOString() ?? null,
    recoveryWindowDays: RECOVERY_WINDOW_DAYS,
    banner: bannerFor(standing),
  };
}

/**
 * Pluralise a count with its noun.
 *
 * @param count - How many.
 * @param singular - The noun for one.
 * @param plural - The noun for any other number; the singular plus `s` by default.
 * @returns e.g. `1 open pull request`, `3 open pull requests`.
 */
function counted(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

/**
 * The preview resource — the counts, and the sentences the confirm dialog lists.
 *
 * @param counts - The live counts.
 * @returns The resource.
 */
export function disconnectPreview(counts: DisconnectCounts): DisconnectPreviewResource {
  return {
    ...counts,
    consequences: [
      `${counted(counts.openPullRequests, "open pull request")} ${
        counts.openPullRequests === 1 ? "remains" : "remain"
      } on GitHub, untouched.`,
      `${counted(counts.activeRuns, "running loop")} ${
        counts.activeRuns === 1 ? "finishes its" : "finish their"
      } current stage, then ${counts.activeRuns === 1 ? "stops" : "stop"}.`,
      `${counted(counts.syncingSources, "GitHub source")} and ${counted(
        counts.enabledRepositories,
        "repository",
        "repositories",
      )} stop syncing.`,
      counts.tokenStored
        ? "The stored GitHub token is deleted."
        : "No GitHub token is stored; nothing to delete.",
      "All loops are paused until you resume them.",
    ],
  };
}
