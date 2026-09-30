/**
 * Skills — what mockup 14 reads and writes of the registry through `ouroboros-rest`
 * (BF.1, [#410](https://github.com/NobuData/ouroboros/issues/410)).
 *
 * BG.1 ([#417](https://github.com/NobuData/ouroboros/issues/417)) needs two of the registry's
 * operations: the list, which the **+ New skill** dialog checks a slug against before anything is
 * sent, and the create, which is what the dialog does. The rest of the registry — drafts, publish,
 * enable and disable, scope moves, the code-view document — is drawn by BG.2
 * ([#418](https://github.com/NobuData/ouroboros/issues/418)) and X.2
 * ([#181](https://github.com/NobuData/ouroboros/issues/181)), so it is not here yet.
 *
 * ### A skill is created from its document
 *
 * There is no `name` field on the create: the body is the whole markdown document, frontmatter
 * included, and the service reads the name, the description and the scope out of it. The slug is
 * optional — the service derives one from the name — and the dialog sends it anyway, because it
 * has shown the reader the slug it is about to take and a derived one could differ.
 *
 * ### The workspace is the session's
 *
 * There is no workspace in these paths and this client sends no `X-Ouro-Tenant`
 * (`app/api/server.ts` says why). Every member may list skills; creating one is `owner` or `admin`,
 * and the service is what enforces it (`403 forbidden`). A slug already in use is
 * `409 skill_slug_taken`.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** Where a skill applies — the whole workspace, one repository, or one workflow. */
export type SkillScope = components["schemas"]["SkillScope"];

/** One skill as the registry lists it — its flags, its scope and its version in force. */
export type SkillSummary = components["schemas"]["SkillSummary"];

/** Every skill of the workspace, and how many are active. */
export type SkillList = components["schemas"]["SkillList"];

/** A skill with its version in force and its draft, as a create or a read answers. */
export type SkillDetail = components["schemas"]["SkillDetail"];

/** What a create sends: the document, and optionally the slug, the scope and its referent. */
export type CreateSkillBody = components["schemas"]["CreateSkillBody"];

/** Skills, as `ouroboros-rest` serves them. */
export const skills = {
  /**
   * Every skill of the workspace, by slug.
   *
   * @param client The client to call through. Defaults to the server-side one; tests pass one
   *   over a stub `fetch`.
   * @returns The list. A workspace with no skills answers an empty list — not a failure.
   * @throws {ApiError} What the service answered. A `401` redirects to login before this rejects.
   */
  async list(client: ApiClient = api()): Promise<SkillList> {
    return unwrap(await client.GET("/api/v1/skills", {}));
  },

  /**
   * Create one skill from its document. It has no version yet: the first publish makes `v1`.
   *
   * @param body The document and its slug and scope, as the caller composed them — forwarded as
   *   they are.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The stored skill, with its empty draft slot.
   * @throws {ApiError} `403 forbidden` for a member, `409 skill_slug_taken` for a slug in use,
   *   `422 skill_document_invalid` for a document that does not read, `422 skill_scope_invalid`
   *   for a referent missing or not this workspace's.
   */
  async create(body: CreateSkillBody, client: ApiClient = api()): Promise<SkillDetail> {
    return unwrap(await client.POST("/api/v1/skills", { body }));
  },
};
