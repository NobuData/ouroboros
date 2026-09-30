/**
 * The repo-map generator — the one write mockup 14's `auto-generated nightly` tag offers
 * (BF.6, [#415](https://github.com/NobuData/ouroboros/issues/415); drawn by BG.2,
 * [#418](https://github.com/NobuData/ouroboros/issues/418)).
 *
 * `repo-map` is a skill a job owns: a nightly run reads each enabled repository's tree and
 * publishes a new `generated` version when the map changed. The skills table's **regenerate**
 * action runs that job now, for one repository, and gets the same report the audit records —
 * `published` with the new version, `unchanged` with nothing written, or `skipped` with why.
 *
 * ### The workspace is the session's
 *
 * No workspace in the path and no `X-Ouro-Tenant` sent (`app/api/server.ts` says why). Running
 * the generator is `owner` or `admin`; the service enforces it (`403 forbidden`), and it refuses a
 * second run within a minute of the last (`409 repo_map_regenerate_too_soon`, with
 * `details.retryAfterSeconds`).
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** One generation, as the regenerate answers and the audit records it. */
export type RepoMapReport = components["schemas"]["RepoMapReport"];

/** What a regenerate names: the repository, as `owner/name`. */
export type RegenerateRepoMapBody = components["schemas"]["RegenerateRepoMapBody"];

/** The repo-map generator, as `ouroboros-rest` serves it. */
export const repoMap = {
  /**
   * Regenerate one repository's `repo-map` now.
   *
   * @param body The repository, `owner/name` — the generated skill's `repoRef`.
   * @param client The client to call through. Defaults to the server-side one; tests pass one
   *   over a stub `fetch`.
   * @returns The report: what happened, the version now in force, and when it ran.
   * @throws {ApiError} `403 forbidden` for a member, `409 repo_map_regenerate_too_soon` within a
   *   minute of the last run, `422 validation_failed` for a malformed repository.
   */
  async regenerate(body: RegenerateRepoMapBody, client: ApiClient = api()): Promise<RepoMapReport> {
    return unwrap(await client.POST("/api/v1/knowledge/repo-map/regenerate", { body }));
  },
};
