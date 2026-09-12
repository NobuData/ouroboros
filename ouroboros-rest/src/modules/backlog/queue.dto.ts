/**
 * What `POST /api/v1/backlog/queue` takes from its caller
 * (M.3, [#112](https://github.com/NobuData/ouroboros/issues/112)).
 *
 * Mockup 03 presses this button three ways — **Queue 3 selected ⟳** in the page head,
 * **Queue → standard-fix** on the selection action bar, and **Queue for loop** in the detail
 * panel — and all three are the same request: a set of issues, and optionally the workflow to
 * run them all under. The single-issue button is a selection of one rather than a route of its
 * own, because a queue write is a queue write and two paths would be two sets of rules.
 *
 * **`issueIds` are `github_issues.id`, not GitHub's numbers**, for `detail.dto.ts`' reason:
 * `github_issues` is unique on `(github_repo_id, number)`, so a workspace watching two
 * repositories has two issue `#485`s and a numeric body would name neither. They are the ids
 * `BacklogRow.id` publishes, so a client sends back exactly what the rows it selected carried.
 *
 * **Everything this file refuses is a `422 validation_failed` from the pipe**, before a
 * connection is taken from the pool — a body that could not name rows costs no statement. The
 * `422`s `queue.errors.ts` defines are the other kind: a request that is *shaped* correctly and
 * names issues this workspace may not queue.
 *
 * **`workflow` moved from the first kind to the second with P.4**
 * ([#135](https://github.com/NobuData/ouroboros/issues/135)). It was an `@IsIn` over decision
 * **K5**'s four tags — a closed enumeration this file could hold, because workflow entities did
 * not exist — and the amendment absorbed from
 * [#124](https://github.com/NobuData/ouroboros/issues/124) makes the vocabulary *this
 * workspace's own workflows*, which is a fact only a query knows. So what stays here is the
 * **shape** — a slug, because `workflows.slug` and `queue_items.workflow_tag` both hold exactly
 * that — and whether the workspace has one by that name is `queue.service.ts`' question,
 * answered `422 queue_workflow_unknown`.
 *
 * That is a deliberate trade of a compile-time guarantee for a true one. A generated client no
 * longer gets four string literals to choose from; it gets a string, because the real answer is
 * per workspace and a specification that enumerated four would be publishing a list that is
 * wrong for every installation that has its own. Nothing already stored stops working — every
 * tag V029 could hold is a slug this pattern accepts, which is the compatibility guarantee
 * decision **F8** was keeping.
 */

import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
} from "class-validator";

/**
 * The most issues one press may queue.
 *
 * The backlog table's own page is at most a hundred rows (the #31 convention's `limit`
 * maximum), so a hundred is every row a person can have selected at once — and the bound is
 * `import.dto.ts`' kind rather than a product rule: the whole batch is one transaction, and a
 * transaction whose size a client chooses is a lock somebody else waits behind.
 */
export const MAX_QUEUED_ISSUES = 100;

/**
 * What a workflow slug looks like — `workflows_slug_format`, mirrored.
 *
 * Lower-case kebab: alphanumeric groups joined by single hyphens, no leading, trailing or
 * doubled hyphen. The same expression V029 CHECKs `workflows.slug` with, so a value this
 * accepts is a value a workflow could be named, and a value it refuses could never match a row.
 *
 * Checking the shape rather than nothing at all is what keeps a malformed value off the
 * statement: `'; drop'` is not a slug, and answering it from the pipe costs no connection.
 */
export const WORKFLOW_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The longest slug `workflows.slug` and `queue_items.workflow_tag` will both hold. */
export const MAX_WORKFLOW_SLUG_LENGTH = 64;

/** The body of `POST /api/v1/backlog/queue`. */
export class QueueSelectionBody {
  /**
   * The issues to queue, in the order they should be appended.
   *
   * **The order is the caller's and it is kept** — positions are handed out down this list, so
   * the queue reads in the order the person selected rather than in whatever order a statement
   * happened to return. See `queue.repository.ts`.
   *
   * At least one, for `import.dto.ts`' reason: queueing nothing is a request nobody meant to
   * send, and answering it `201 {items: []}` would let a broken client believe it had done
   * something.
   *
   * Unique, and that is a refusal rather than a silent de-duplication: an id sent twice is a
   * selection model that has counted a row twice, and the combined estimate it renders is
   * already wrong by the time this request is made. `queue_items_organization_issue_key` would
   * refuse the second insert anyway — this answers the same fact where a client can see which
   * field caused it.
   */
  @IsUUID(undefined, { each: true })
  @ArrayUnique()
  @ArrayMaxSize(MAX_QUEUED_ISSUES)
  @ArrayMinSize(1)
  @IsArray()
  issueIds!: string[];

  /**
   * The workflow every queued issue runs under, or absent for *each issue's own*.
   *
   * **A slug, checked for shape here and for existence by the service.** It must name one of
   * this workspace's active workflows — mockup 03's *Assign workflow ▾* lists exactly those
   * (P.4's registry), and a tag the workspace has no workflow for is a queue row nothing will
   * ever pick up. That check needs a query, so it is `queue.service.ts`':
   * `422 queue_workflow_unknown`, carrying the vocabulary it was held to.
   *
   * `queue_items.workflow_tag` is deliberately unconstrained text (decision **F8**) so that a
   * renamed workflow still renders, which is exactly why the database will not catch a wrong
   * one and something here must.
   *
   * Absent is not the same as `standard-fix`: it means **Queue 3 selected** rather than
   * **Queue → standard-fix**, and each issue is queued under the workflow its own estimate
   * suggested. `queue.service.ts` holds that rule.
   */
  @IsOptional()
  @MaxLength(MAX_WORKFLOW_SLUG_LENGTH)
  @Matches(WORKFLOW_SLUG_PATTERN)
  workflow?: string;
}
