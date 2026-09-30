/**
 * Repository detection — the newest scan's rows and the protected paths, through `ouroboros-rest`
 * (BB.1, [#384](https://github.com/NobuData/ouroboros/issues/384); BA.1,
 * [#380](https://github.com/NobuData/ouroboros/issues/380)). Read here by the knowledge page's
 * Repo Profile card (BG.4, [#420](https://github.com/NobuData/ouroboros/issues/420)), which
 * **composes** this truth rather than scanning again — decision **K7**: one detection, rendered in
 * two places.
 *
 * ### Never a 404
 *
 * A repository that was never scanned answers `scan: null` and no rows, which the card draws as
 * *not scanned yet*. A row the scan could not determine is present with `determined: false` and
 * says why, never omitted.
 *
 * ### The workspace is the session's
 *
 * No workspace in the path and no `X-Ouro-Tenant` sent (`app/api/server.ts` says why). Any member
 * reads.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** The newest scan, its rows, the protected-path policies and the progress. */
export type RepoDetection = components["schemas"]["RepoDetection"];

/** One card row — its key, verdict, the line the card prints, and its label. */
export type RepoDetectionRow = components["schemas"]["RepoDetectionRow"];

/** One protected-path policy — the glob, and whether a scan suggested it or a person wrote it. */
export type ProtectedPath = RepoDetection["protectedPaths"][number];

/** Repository detection, as `ouroboros-rest` serves it. */
export const detection = {
  /**
   * The newest scan of a repository.
   *
   * @param repo The repository, `owner/name`.
   * @param client The client to call through. Defaults to the server-side one; tests pass one
   *   over a stub `fetch`.
   * @returns The detection — `scan: null` and no rows for a repository never scanned.
   * @throws {ApiError} `422 validation_failed` for a malformed repository.
   */
  async read(repo: string, client: ApiClient = api()): Promise<RepoDetection> {
    return unwrap(await client.GET("/api/v1/onboarding/detection", { params: { query: { repo } } }));
  },
};
