/**
 * The workspace's org policy document — what the Autonomy policies card reads and publishes
 * (BQ.2 [#481](https://github.com/NobuData/ouroboros/issues/481) built the routes, BS.4
 * [#494](https://github.com/NobuData/ouroboros/issues/494) draws them).
 *
 * - `GET /api/v1/policies` — the version in force, for any member.
 * - `GET /api/v1/policies/versions` — the published versions, newest first, each with its note,
 *   its publisher, its document and what it changed from the one before. Any member.
 * - `POST /api/v1/policies/preview` — what publishing a draft would do: each changed rule's
 *   class (tightening, loosening, neutral) and whether this caller may publish it. Writes nothing.
 * - `POST /api/v1/policies` — publish the next version, against the version the edit began from.
 * - `POST /api/v1/policies/path-preview` — what a list of globs matches in each enabled
 *   repository's tree, by the guardrails' own matcher. Writes nothing.
 *
 * The role gates are the service's: preview, publish and path-preview are `owner`/`admin`, and a
 * loosening is the owner's alone (`403 policy_loosening_requires_owner`).
 *
 * Server-side only, by way of `app/api/server.ts`.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** The version in force — all null while nothing is published. */
export type OrgPolicy = components["schemas"]["OrgPolicy"];
/** The whole document. */
export type OrgPolicyDocument = components["schemas"]["OrgPolicyDocument"];

/** The org policy's reads and writes. */
export const orgPolicy = {
  /**
   * The version in force.
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The document verbatim, or `version: null` when nothing is published.
   * @throws {ApiError} What the service answered.
   */
  async read(client: ApiClient = api()): Promise<OrgPolicy> {
    return unwrap(await client.GET("/api/v1/policies", {}));
  },

  /**
   * The published versions, newest first.
   *
   * @param before Read versions older than this one — the previous page's `nextBefore`.
   * @param client The client to call through.
   * @returns A page of versions.
   * @throws {ApiError} What the service answered.
   */
  async versions(before?: number, client: ApiClient = api()) {
    return unwrap(
      await client.GET("/api/v1/policies/versions", {
        params: { query: before === undefined ? {} : { before } },
      }),
    );
  },

  /**
   * What publishing a draft would do.
   *
   * @param document The draft.
   * @param client The client to call through.
   * @returns Each changed rule's class, and whether this caller may publish it.
   * @throws {ApiError} `422 policy_document_invalid`; `403` below admin.
   */
  async preview(document: OrgPolicyDocument, client: ApiClient = api()) {
    return unwrap(await client.POST("/api/v1/policies/preview", { body: { document } }));
  },

  /**
   * Publish the next version.
   *
   * @param body The document, the version the edit began from, and why.
   * @param client The client to call through.
   * @returns The version published and what it changed.
   * @throws {ApiError} `409 policy_version_conflict`, `422 policy_unchanged`,
   *   `422 policy_document_invalid`, `403 policy_loosening_requires_owner`; `403` below admin.
   */
  async publish(body: components["schemas"]["OrgPolicyPublish"], client: ApiClient = api()) {
    return unwrap(await client.POST("/api/v1/policies", { body }));
  },

  /**
   * What a list of globs matches in each enabled repository.
   *
   * @param globs The globs, each valid by the document's grammar.
   * @param client The client to call through.
   * @returns Per repository, each glob's match count and sample paths.
   * @throws {ApiError} `422` naming a glob the grammar refuses; `403` below admin.
   */
  async pathPreview(globs: readonly string[], client: ApiClient = api()) {
    return unwrap(await client.POST("/api/v1/policies/path-preview", { body: { globs: [...globs] } }));
  },
};
