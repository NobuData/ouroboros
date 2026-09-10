/**
 * The one thing `POST /api/v1/backlog/{id}/estimate` takes from its caller.
 *
 * L.4 ([#108](https://github.com/NobuData/ouroboros/issues/108)). Neither endpoint has a body:
 * *re-estimate this* and *re-estimate everything* carry no options, and a body with nothing
 * required in it would be a shape a client has to guess at.
 *
 * **`{id}` is `github_issues.id`, not GitHub's issue number**, and the ticket's own diagram is
 * where the confusion would come from: it writes `POST /backlog/485/estimate`, where `485` is
 * the issue the mockup draws rather than a path segment this service would accept. A number
 * cannot address an issue here — `github_issues` is unique on `(github_repo_id, number)`, so a
 * workspace watching two repositories has two issue `#485`s and the path would name neither.
 * Every other addressable row in this API is addressed by its uuid, and this is that.
 */

import { IsUUID } from "class-validator";

/** The path of `POST /api/v1/backlog/{id}/estimate`. */
export class EstimateParams {
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
