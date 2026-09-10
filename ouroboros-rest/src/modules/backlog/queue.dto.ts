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
 */

import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
} from "class-validator";

import { WORKFLOW_TAGS } from "../estimation/estimation.context";

/**
 * The most issues one press may queue.
 *
 * The backlog table's own page is at most a hundred rows (the #31 convention's `limit`
 * maximum), so a hundred is every row a person can have selected at once — and the bound is
 * `import.dto.ts`' kind rather than a product rule: the whole batch is one transaction, and a
 * transaction whose size a client chooses is a lock somebody else waits behind.
 */
export const MAX_QUEUED_ISSUES = 100;

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
   * One of {@link WORKFLOW_TAGS} — decision **K5**'s fixed set, which is the list the
   * estimator classifies into and the list mockup 03's *Assign workflow ▾* offers. Held to it
   * here rather than left opaque because a tag this installation has no workflow for is a
   * queue row nothing will ever pick up, and `queue_items.workflow_tag` is deliberately
   * unconstrained text (decision **F8**) so that a renamed workflow still renders — which
   * means the database will not catch it.
   *
   * Absent is not the same as `standard-fix`: it means **Queue 3 selected** rather than
   * **Queue → standard-fix**, and each issue is queued under the workflow its own estimate
   * suggested. `queue.service.ts` holds that rule.
   */
  @IsOptional()
  @IsIn([...WORKFLOW_TAGS])
  workflow?: string;
}
