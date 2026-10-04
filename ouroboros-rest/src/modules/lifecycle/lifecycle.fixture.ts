/**
 * Test doubles for the lifecycle state (BR.5, [#489](https://github.com/NobuData/ouroboros/issues/489)).
 */

import type { WorkspaceLifecycle, WorkspaceLifecycleState } from "../db/schema";
import type { DisconnectCounts, LifecycleRepository, StateWrite } from "./lifecycle.repository";
import {
  ACTIVE_STANDING,
  type WorkspaceStanding,
  type WorkspaceStateReader,
} from "./lifecycle.state";

/**
 * A state reader answering from a map — workspaces not in it are `active`.
 *
 * @param states - Each workspace's state, by id. Mutable, so a test can pause mid-scenario.
 * @param purgeAfter - The `purgeAfter` a `pending_delete` standing reports.
 * @returns A reader the services accept in place of the real one.
 */
export function statesOf(
  states: Map<string, WorkspaceLifecycleState> = new Map(),
  purgeAfter: Date = new Date("2026-11-02T00:00:00Z"),
): WorkspaceStateReader {
  const standing = (organizationId: string): WorkspaceStanding => {
    const state = states.get(organizationId);

    if (state === undefined || state === "active") {
      return ACTIVE_STANDING;
    }

    return {
      state,
      purgeAfter: state === "pending_delete" ? purgeAfter : null,
      changedAt: new Date("2026-10-03T00:00:00Z"),
      changedBy: "user-owner",
    };
  };

  return {
    standing: (organizationId: string) => Promise.resolve(standing(organizationId)),
    stateOf: (organizationId: string) => Promise.resolve(standing(organizationId).state),
  } as unknown as WorkspaceStateReader;
}

/** A reader under which every workspace is `active`. */
export const ACTIVE_STATES: WorkspaceStateReader = statesOf();

/** The workspace the lifecycle specs act in. */
export const LIFECYCLE_WORKSPACE = "org-acme";

/** Its name — what the typed confirmation must match. */
export const LIFECYCLE_WORKSPACE_NAME = "acme-robotics";

/** One queued outbox event, as the fake records it. */
export interface RecordedOutboxEvent {
  readonly organizationId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
}

/**
 * An in-memory {@link LifecycleRepository}: one lifecycle row per workspace, the outbox, and the
 * counts a disconnect previews. `states()` reads the same rows, so a service and its read route
 * agree the way they do against the database.
 */
export class FakeLifecycleStore {
  /** Each workspace's row. Absent is `active`. */
  readonly rows = new Map<string, WorkspaceLifecycle>();
  /** Every outbox event, in order. */
  readonly outbox: RecordedOutboxEvent[] = [];
  /** GitHub sources paused by disconnects. */
  sourcesPaused = 0;
  /** What `disconnectCounts` answers. */
  counts: DisconnectCounts = {
    openPullRequests: 3,
    activeRuns: 2,
    syncingSources: 1,
    enabledRepositories: 4,
    tokenStored: true,
  };

  /**
   * Put a workspace in a state directly.
   *
   * @param organizationId - The workspace.
   * @param state - Where it stands.
   * @param purgeAfter - Its window's close, for `pending_delete`.
   */
  seed(
    organizationId: string,
    state: WorkspaceLifecycleState,
    purgeAfter: Date | null = null,
  ): void {
    this.rows.set(organizationId, {
      organization_id: organizationId,
      state,
      changed_by: "user-owner",
      changed_at: new Date("2026-10-01T00:00:00Z"),
      purge_after: purgeAfter,
    });
  }

  /** @returns The fake, typed as the repository the service takes. */
  repository(): LifecycleRepository {
    return {
      transaction: <T>(work: (trx: never) => Promise<T>) => work({} as never),
      lock: (_trx: unknown, organizationId: string) => {
        if (!this.rows.has(organizationId)) this.seed(organizationId, "active");
        return Promise.resolve({ ...(this.rows.get(organizationId) as WorkspaceLifecycle) });
      },
      write: (_trx: unknown, write: StateWrite) => {
        const row: WorkspaceLifecycle = {
          organization_id: write.organizationId,
          state: write.state,
          changed_by: write.changedBy,
          changed_at: write.at,
          purge_after: write.purgeAfter,
        };
        this.rows.set(write.organizationId, row);
        return Promise.resolve(row);
      },
      enqueue: (
        _executor: unknown,
        organizationId: string,
        types: readonly string[],
        payload: Record<string, unknown>,
      ) => {
        for (const eventType of types) this.outbox.push({ organizationId, eventType, payload });
        return Promise.resolve();
      },
      disconnectCounts: () => Promise.resolve(this.counts),
      pauseGithubSources: () => {
        this.sourcesPaused += this.counts.syncingSources;
        return Promise.resolve(this.counts.syncingSources);
      },
      identity: (organizationId: string) =>
        Promise.resolve(
          organizationId === LIFECYCLE_WORKSPACE
            ? { name: LIFECYCLE_WORKSPACE_NAME, slug: LIFECYCLE_WORKSPACE_NAME }
            : undefined,
        ),
      ownerIds: () => Promise.resolve(["user-owner"]),
    } as unknown as LifecycleRepository;
  }

  /** @returns A state reader over the same rows. */
  states(): WorkspaceStateReader {
    const standing = (organizationId: string): WorkspaceStanding => {
      const row = this.rows.get(organizationId);

      return row === undefined
        ? ACTIVE_STANDING
        : {
            state: row.state,
            purgeAfter: row.purge_after,
            changedAt: row.changed_at,
            changedBy: row.changed_by,
          };
    };

    return {
      standing: (organizationId: string) => Promise.resolve(standing(organizationId)),
      stateOf: (organizationId: string) => Promise.resolve(standing(organizationId).state),
    } as unknown as WorkspaceStateReader;
  }
}
