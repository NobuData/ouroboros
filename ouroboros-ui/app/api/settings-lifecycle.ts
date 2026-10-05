/**
 * The workspace's lifecycle — mockup 17's **Danger zone**
 * ([#489](https://github.com/NobuData/ouroboros/issues/489) built it, BS.6
 * [#496](https://github.com/NobuData/ouroboros/issues/496) draws it).
 *
 * One resource under `/api/v1/settings/lifecycle`: where the workspace stands (`active`,
 * `paused`, `pending_delete`) with **the banner the shell renders app-wide** while it is not
 * `active`, and the moves between those states —
 *
 * - **pause / resume** — a graceful hold: work in flight finishes its stage, nothing new starts.
 * - **disconnect** — pause, pause every GitHub source, delete the stored token; with a
 *   **preview computed from live state** to show before it is confirmed.
 * - **delete / restore** — owner only. Deleting takes the workspace's name typed exactly and a
 *   recent step-up; it starts a 30-day recovery window during which an owner may restore.
 *
 * ### While the workspace is pending deletion, everything else is frozen
 *
 * Every other route answers `403` {@link PENDING_DELETE_CODE}; `app/api/server.ts` turns that
 * answer into the recovery screen. An **owner** may still read the state and restore; a non-owner
 * is refused even those, with `details.restorable: false`.
 *
 * Server-side only, by way of `app/api/server.ts`.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import { WORKSPACE_FROZEN_CODE } from "@/app/api/errors";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** Where the workspace stands, and the app-wide banner. */
export type WorkspaceLifecycle = components["schemas"]["WorkspaceLifecycle"];
/** `active`, `paused` or `pending_delete`. */
export type WorkspaceLifecycleState = components["schemas"]["WorkspaceLifecycleState"];
/** The banner the shell renders on every page while the workspace is not `active`. */
export type LifecycleBanner = components["schemas"]["LifecycleBanner"];
/** What disconnecting GitHub does, computed from live state. */
export type DisconnectPreview = components["schemas"]["DisconnectPreview"];

/**
 * The `code` every frozen surface answers while the workspace is pending deletion — one value,
 * kept in `app/api/errors.ts` because `app/api/server.ts` reads it and cannot import this module.
 */
export const PENDING_DELETE_CODE = WORKSPACE_FROZEN_CODE;
/** The `code` a delete answers when the typed name is not exactly the workspace's. */
export const NAME_MISMATCH_CODE = "workspace_name_mismatch";
/** The `code` a move answers when the workspace is not in a state it can be made from. */
export const STATE_CONFLICT_CODE = "workspace_state_conflict";

/** The workspace's lifecycle, as `ouroboros-rest` keeps it. */
export const settingsLifecycle = {
  /**
   * Where the workspace stands.
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The state and its banner. Any member may read it while the workspace is not
   *   pending deletion; only an owner while it is.
   * @throws {ApiError} What the service answered.
   */
  async read(client: ApiClient = api()): Promise<WorkspaceLifecycle> {
    return unwrap(await client.GET("/api/v1/settings/lifecycle", {}));
  },

  /**
   * Pause all loops. The confirmation is this call: the dialog was the question.
   *
   * @param client The client to call through.
   * @returns The lifecycle, now `paused`.
   * @throws {ApiError} `403` below `admin`; `409` {@link STATE_CONFLICT_CODE} when not `active`.
   */
  async pause(client: ApiClient = api()): Promise<WorkspaceLifecycle> {
    return unwrap(
      await client.POST("/api/v1/settings/lifecycle/pause", { body: { confirm: true } }),
    );
  },

  /**
   * Resume all loops.
   *
   * @param client The client to call through.
   * @returns The lifecycle, now `active`.
   * @throws {ApiError} `403` below `admin`; `409` {@link STATE_CONFLICT_CODE} when not `paused`.
   */
  async resume(client: ApiClient = api()): Promise<WorkspaceLifecycle> {
    return unwrap(await client.POST("/api/v1/settings/lifecycle/resume", {}));
  },

  /**
   * What disconnecting GitHub would do, as of now.
   *
   * @param client The client to call through.
   * @returns The counts, and the same facts as sentences.
   * @throws {ApiError} `403` below `admin`.
   */
  async disconnectPreview(client: ApiClient = api()): Promise<DisconnectPreview> {
    return unwrap(await client.GET("/api/v1/settings/lifecycle/disconnect-preview", {}));
  },

  /**
   * Disconnect GitHub. The confirmation is this call.
   *
   * @param client The client to call through.
   * @returns The preview's counts as they stood when the disconnect ran.
   * @throws {ApiError} `403` below `admin`.
   */
  async disconnect(client: ApiClient = api()) {
    return unwrap(
      await client.POST("/api/v1/settings/lifecycle/disconnect", { body: { confirm: true } }),
    );
  },

  /**
   * Delete the workspace — the start of its recovery window.
   *
   * @param confirmName The workspace's name, as the reader typed it.
   * @param password The step-up, when the session is older than the service accepts.
   * @param client The client to call through.
   * @returns The lifecycle, now `pending_delete`, with `purgeAfter`.
   * @throws {ApiError} `403` for anybody but an owner; `422` {@link NAME_MISMATCH_CODE};
   *   `403 step_up_required` when the session is not recent and no valid password came with it.
   */
  async remove(
    confirmName: string,
    password?: string,
    client: ApiClient = api(),
  ): Promise<WorkspaceLifecycle> {
    return unwrap(
      await client.POST("/api/v1/settings/lifecycle/delete", {
        body: password === undefined ? { confirmName } : { confirmName, password },
      }),
    );
  },

  /**
   * Restore a workspace pending deletion.
   *
   * @param client The client to call through.
   * @returns The lifecycle, now `active`.
   * @throws {ApiError} `403` for anybody but an owner; `409` {@link STATE_CONFLICT_CODE} once the
   *   purge has begun.
   */
  async restore(client: ApiClient = api()): Promise<WorkspaceLifecycle> {
    return unwrap(await client.POST("/api/v1/settings/lifecycle/restore", {}));
  },
};
