import type { DisconnectPreview, WorkspaceLifecycle } from "@/app/api/settings-lifecycle";

/**
 * The workspace lifecycle's fixtures (BS.6, #496) — the three states `GET /settings/lifecycle`
 * answers, with the banner the service composes for each, and the disconnect preview.
 */

/** When the fixture workspace was paused, or its deletion requested. */
export const CHANGED_AT = "2026-10-05T10:00:00.000Z";

/** Thirty days after {@link CHANGED_AT}: when the fixture's recovery window closes. */
export const PURGE_AFTER = "2026-11-04T10:00:00.000Z";

/** The service's paused sentence. */
export const PAUSED_SENTENCE =
  "All loops are paused. Running loops finish their stage; queued issues stay queued.";

/**
 * An active workspace's lifecycle.
 *
 * @param overrides Fields to replace.
 * @returns The lifecycle.
 */
export function lifecycle(overrides: Partial<WorkspaceLifecycle> = {}): WorkspaceLifecycle {
  return {
    state: "active",
    changedAt: null,
    changedBy: null,
    purgeAfter: null,
    recoveryWindowDays: 30,
    banner: null,
    ...overrides,
  };
}

/**
 * A paused workspace's lifecycle, with the banner the shell renders.
 *
 * @param overrides Fields to replace.
 * @returns The lifecycle.
 */
export function pausedLifecycle(overrides: Partial<WorkspaceLifecycle> = {}): WorkspaceLifecycle {
  return lifecycle({
    state: "paused",
    changedAt: CHANGED_AT,
    changedBy: "user-ken",
    banner: {
      kind: "paused",
      message: PAUSED_SENTENCE,
      since: CHANGED_AT,
      actionLabel: "Resume",
      actionPath: "/settings#danger",
    },
    ...overrides,
  });
}

/**
 * A workspace pending deletion, as an owner reads it: the window closes thirty days after the
 * request.
 *
 * @param overrides Fields to replace.
 * @returns The lifecycle.
 */
export function pendingDeleteLifecycle(
  overrides: Partial<WorkspaceLifecycle> = {},
): WorkspaceLifecycle {
  return lifecycle({
    state: "pending_delete",
    changedAt: CHANGED_AT,
    changedBy: "user-ken",
    purgeAfter: PURGE_AFTER,
    banner: {
      kind: "pending_delete",
      message:
        "This workspace is scheduled for deletion on 2026-11-04. An owner can restore it until then.",
      since: CHANGED_AT,
      actionLabel: "Restore",
      actionPath: "/settings#danger",
    },
    ...overrides,
  });
}

/**
 * What disconnecting GitHub would do to the fixture workspace.
 *
 * @param overrides Fields to replace.
 * @returns The preview.
 */
export function disconnectPreview(overrides: Partial<DisconnectPreview> = {}): DisconnectPreview {
  return {
    openPullRequests: 4,
    activeRuns: 2,
    syncingSources: 1,
    enabledRepositories: 3,
    tokenStored: true,
    consequences: [
      "4 open pull requests remain on GitHub, untouched.",
      "2 runs finish their current stage, then hold.",
      "1 GitHub source is paused; 3 enabled repositories stop syncing.",
      "The stored GitHub token is deleted.",
    ],
    ...overrides,
  };
}
