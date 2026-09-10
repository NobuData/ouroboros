/**
 * The one thing `GET /api/v1/backlog/{id}` takes from its caller
 * (M.2, [#111](https://github.com/NobuData/ouroboros/issues/111)).
 *
 * **`{id}` is `github_issues.id`, not GitHub's issue number**, for the reason
 * `estimation.dto.ts` gives about the path beside this one: `github_issues` is unique on
 * `(github_repo_id, number)`, so a workspace watching two repositories has two issue `#485`s and
 * a numeric path would name neither. It is the same value `BacklogRow.id` carries, so a client
 * opening the panel sends back the id the row it clicked was published with.
 *
 * There is no query string. The panel is one shape — the ticket's own answer to *"the list
 * endpoint deliberately returns only what the table's cells need"* is that this endpoint returns
 * the panel, whole — and a `?fields=` that let a caller ask for less would be a contract with a
 * different shape per request.
 */

import { IsUUID } from "class-validator";

/** The path of `GET /api/v1/backlog/{id}`. */
export class IssueDetailParams {
  /**
   * `github_issues.id`.
   *
   * A uuid check rather than a bare string, so a path that could not name a row is a `422`
   * before a statement is issued — and so a caller cannot use this path to send arbitrary text
   * into a `where` clause's parameter, which costs a round trip to answer `404`.
   */
  @IsUUID()
  id!: string;
}
