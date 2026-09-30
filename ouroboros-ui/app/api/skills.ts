/**
 * Skills — what mockup 14 reads and writes of the registry through `ouroboros-rest`
 * (BF.1, [#410](https://github.com/NobuData/ouroboros/issues/410)).
 *
 * BG.1 ([#417](https://github.com/NobuData/ouroboros/issues/417)) needs two of the registry's
 * operations: the list, which the **+ New skill** dialog checks a slug against before anything is
 * sent, and the create, which is what the dialog does. BG.2
 * ([#418](https://github.com/NobuData/ouroboros/issues/418)) adds the two the skills table draws
 * from: the **stats** behind the Used-by column, and the **update** behind every switch — which
 * is where the required lock is enforced (`403 skill_required_locked`), so the table's locked
 * switch reflects a refusal rather than an opinion. The rest of the registry — drafts, publish,
 * scope moves, the code-view document — is X.2's
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

/** What an update sends: any subset of the switch, the lock and the draft flag. */
export type UpdateSkillBody = components["schemas"]["UpdateSkillBody"];

/** The Used-by column: every skill's figures, counted over a stated window. */
export type SkillStats = components["schemas"]["SkillStats"];

/** One skill's line of the stats — its label, and the two figures behind it. */
export type SkillStat = SkillStats["skills"][number];

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

  /**
   * The Used-by column — every skill's share of the runs in its scope, over the service's default
   * window of thirty days.
   *
   * Counted from injection records, never stored, so a skill nobody has used answers `—` with
   * both figures at zero, and a draft answers `—` with `active: false` whatever was recorded. The
   * window's bounds come back with the figures, which is what lets the column state them.
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The window and the figures. Every member may read it.
   * @throws {ApiError} What the service answered.
   */
  async stats(client: ApiClient = api()): Promise<SkillStats> {
    return unwrap(await client.GET("/api/v1/skills/stats", {}));
  },

  /**
   * The switch, the lock and the draft flag — any subset of the three.
   *
   * **The required lock is enforced here**, for every role: switching off a required skill is
   * `403 skill_required_locked` with `details.reason: required_by_policy`, and the table's locked
   * switch is that refusal made visible rather than a `disabled` attribute standing in for it.
   *
   * @param slug The skill's slug.
   * @param body What to change, forwarded as it is.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The skill after the change.
   * @throws {ApiError} `403 skill_required_locked` for switching off a required skill,
   *   `403 skill_required_owner_only` for a non-owner changing `required`, `403 forbidden` for a
   *   member, `404 skill_not_found`, `409 skill_unpublished` for promoting a draft with no
   *   version, `422 skill_required_draft` for requiring a draft.
   */
  async update(slug: string, body: UpdateSkillBody, client: ApiClient = api()): Promise<SkillSummary> {
    return unwrap(await client.PATCH("/api/v1/skills/{slug}", { params: { path: { slug } }, body }));
  },
};
