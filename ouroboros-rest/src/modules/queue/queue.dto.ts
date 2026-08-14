/**
 * What a queue request may contain — the listing's query string, as a `class-validator`
 * class ([#73](https://github.com/NobuData/ouroboros/issues/73)).
 *
 * One class, because the surface is one route: the queue has no detail endpoint — a queued
 * issue is addressed by reordering or removing it, and both of those are the issues
 * screen's (mockup 03), not this API's. A malformed filter is a `422` naming the field,
 * from the pipe, before a connection is taken from the pool.
 */

import { IsOptional, IsUUID } from "class-validator";

import { PageQuery } from "../tenancy/pagination";

/**
 * The query string of `GET /api/v1/queue`.
 *
 * Extends {@link PageQuery} rather than repeating it — the #31 convention's own instruction —
 * so `limit` and `offset` keep one definition and one set of messages when they are wrong.
 * Nothing else is required: unlike the runs listing there is no family to choose, because
 * the queue has exactly one order and it is `position`.
 */
export class ListQueueQuery extends PageQuery {
  /**
   * Narrow to one repository — `github_repos.id`, which is what the #77 focus-repo
   * preference holds.
   *
   * The **id**, not the name, because a repository name is unique within its GitHub
   * organisation and a workspace may enable two organisations that both own a `tools`. A
   * repo belonging to another workspace narrows to nothing rather than erroring: the filter
   * is a predicate under the org scope, and an empty page is the honest answer to "your
   * queue, in a repository that is not yours".
   */
  @IsOptional()
  @IsUUID()
  repo?: string;
}
