/**
 * The Workspace card's operations — mockup 17's `c-5` card
 * ([#483](https://github.com/NobuData/ouroboros/issues/483) and
 * [#482](https://github.com/NobuData/ouroboros/issues/482) built them, BS.2
 * [#492](https://github.com/NobuData/ouroboros/issues/492) draws them).
 *
 * The card is two resources:
 *
 * - `/api/v1/settings/workspace` — the name, the tenant domain, and the two rows that describe
 *   this deployment rather than a setting of it (region, training data). Every field carries
 *   whether this caller can change it and, when not, why.
 * - `/api/v1/settings/retention` — the four retention tiers, their bounds, and when each class's
 *   next sweep will apply a change.
 *
 * Both `PATCH`es are all-or-nothing on their own and refuse with `422 validation_failed` (or
 * `409 domain_taken`, or `422 retention_out_of_bounds`) carrying `details.fields`, which is what
 * lets the card route a refusal back to the input that caused it.
 *
 * Server-side only, by way of `app/api/server.ts`.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/**
 * The workspace card as the service draws it — typed as the client returns it rather than as
 * `components["schemas"]["WorkspaceSettings"]`, because the fetch client's response type drops the
 * changeable training variant's `reason: null` key and the two would not be assignable.
 */
export type WorkspaceSettings = Awaited<ReturnType<(typeof settingsWorkspace)["read"]>>;
/** What `PATCH /api/v1/settings/workspace` takes — the two editable fields, either or both. */
export type WorkspaceSettingsPatch = components["schemas"]["WorkspaceSettingsPatch"];
/** The training-data row's three variants, as the client returns them. */
export type WorkspaceTrainingData = WorkspaceSettings["trainingData"];
/** The data region, as the deployment declares it. */
export type WorkspaceRegion = components["schemas"]["WorkspaceRegion"];
/** Why a control on the card cannot be used. */
export type WorkspaceControlReason = components["schemas"]["WorkspaceControlReason"];

/** The retention tiers, their bounds and their sweeps. */
export type RetentionSettings = components["schemas"]["RetentionSettings"];
/** One class's tier. */
export type RetentionTier = components["schemas"]["RetentionTier"];
/** What `PATCH /api/v1/settings/retention` takes — `loopDays` or `classes`, never both. */
export type RetentionPatch = components["schemas"]["RetentionPatch"];

/** The card's reads and writes. */
export const settingsWorkspace = {
  /**
   * The workspace card.
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The card. Any member may read it.
   * @throws {ApiError} What the service answered.
   */
  async read(client: ApiClient = api()) {
    return unwrap(await client.GET("/api/v1/settings/workspace", {}));
  },

  /**
   * Rename the workspace, change its tenant domain, or both.
   *
   * @param patch What changed. A body carrying nothing writes nothing.
   * @param client The client to call through.
   * @returns The card as it now stands.
   * @throws {ApiError} `422 validation_failed` or `409 domain_taken`, each with
   *   `details.fields`; `403` for a reader who is not an owner or an admin.
   */
  async update(patch: WorkspaceSettingsPatch, client: ApiClient = api()) {
    return unwrap(await client.PATCH("/api/v1/settings/workspace", { body: patch }));
  },

  /**
   * The retention tiers.
   *
   * @param client The client to call through.
   * @returns The tiers. Any member may read them.
   * @throws {ApiError} What the service answered.
   */
  async retention(client: ApiClient = api()): Promise<RetentionSettings> {
    return unwrap(await client.GET("/api/v1/settings/retention", {}));
  },

  /**
   * Change retention tiers — the simple select or the advanced editor.
   *
   * @param patch `{loopDays}` or `{classes}`.
   * @param client The client to call through.
   * @returns The tiers as they now stand.
   * @throws {ApiError} `422 retention_out_of_bounds` or `422 validation_failed`, each with
   *   `details.fields`; `403` for a reader who is not an owner or an admin.
   */
  async updateRetention(patch: RetentionPatch, client: ApiClient = api()): Promise<RetentionSettings> {
    return unwrap(await client.PATCH("/api/v1/settings/retention", { body: patch }));
  },
};
