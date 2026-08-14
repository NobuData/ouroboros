/**
 * What a runs request may contain — the listing's query string and the detail's path
 * parameter, as `class-validator` classes ([#71](https://github.com/NobuData/ouroboros/issues/71)).
 *
 * One file, per `tenancy.dto.ts`'s argument: the patterns below restate facts the schema
 * declares — a run id is a `gen_random_uuid()` (V008), a repo id likewise (V003) — and the
 * pairing has to be readable in one look. A malformed id is a `422` naming the field, from
 * the pipe, before a connection is taken from the pool; a well-formed id that names nothing
 * *this caller may see* is the repository's `404`, and the difference is the difference
 * between "you asked wrongly" and "there is no such thing for you".
 */

import { IsIn, IsOptional, IsUUID } from "class-validator";

import { PageQuery } from "../tenancy/pagination";

/**
 * The two families a listing is asked for — the card links' destinations, not the six
 * statuses.
 *
 * `active` is the *Open run console →* view: runs still moving, in lifecycle order.
 * `terminal` is the *All issues →* view: runs that have stopped, newest first. The two have
 * different natural orders, which is why the parameter is **required** rather than defaulted:
 * a mixed listing would need an ordering that interleaves "where is it in the pipeline" with
 * "when did it stop", and no screen asks that question. A client that wants both asks twice,
 * which is what the two cards already do.
 */
export const RUN_STATUS_FAMILIES = ["active", "terminal"] as const;

/** One of the two — see {@link RUN_STATUS_FAMILIES}. */
export type RunStatusFamily = (typeof RUN_STATUS_FAMILIES)[number];

/**
 * The query string of `GET /api/v1/runs`.
 *
 * Extends {@link PageQuery} rather than repeating it — the #31 convention's own instruction —
 * so `limit` and `offset` keep one definition and one set of messages when they are wrong.
 */
export class ListRunsQuery extends PageQuery {
  /** Which family — required, for the ordering reason {@link RUN_STATUS_FAMILIES} gives. */
  @IsIn(RUN_STATUS_FAMILIES)
  status!: RunStatusFamily;

  /**
   * Narrow to one repository — `github_repos.id`, which is what the #77 focus-repo
   * preference holds.
   *
   * The **id**, not the name, because a repository name is unique within its GitHub
   * organisation and a workspace may enable two organisations that both own a `tools`. A
   * repo belonging to another workspace narrows to nothing rather than erroring: the filter
   * is a predicate under the org scope, and an empty page is the honest answer to "your
   * runs, in a repository that is not yours".
   */
  @IsOptional()
  @IsUUID()
  repo?: string;
}

/** The path of `GET /api/v1/runs/{id}`. */
export class RunParams {
  /** The run — `runs.id`, a uuid (V008). Anything else is a `422`, not a probe's `404`. */
  @IsUUID()
  id!: string;
}
