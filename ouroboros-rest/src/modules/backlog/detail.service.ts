/**
 * The rules of `GET /api/v1/backlog/{id}`
 * (M.2, [#111](https://github.com/NobuData/ouroboros/issues/111)), which are two:
 *
 *   * **The two reads are concurrent, and the issue read is the authority.** They go out
 *     together — `listing.service.ts`' four do the same, on `dashboard.repository.ts`' argument
 *     that a round trip costs more than the statement it carries — and the estimates are
 *     discarded if the issue was not this workspace's. Nothing is disclosed by the race: both
 *     statements carry the workspace predicate, so the discarded read had already answered
 *     *nothing* for an id that is not yours.
 *
 *   * **An issue that is not this workspace's is `404`, not `403`.** The ticket's own criterion,
 *     and it is met by a `where` rather than by a comparison: `detail.repository.ts` finds no
 *     row, and *no row* is what becomes `issue_not_found`. A `403` would answer *the id you
 *     guessed is real, and it is somebody else's*, which is exactly what cross-tenant probing is
 *     looking for.
 *
 * **The refusal is `estimation.errors.ts`' rather than a second one of this module's.** That
 * file already defines `issue_not_found` for the path directly beside this one —
 * `POST /api/v1/backlog/{id}/estimate` — with the same meaning, the same status, the same
 * `details.issueId` and the same argument about `403`. Two definitions of one code would be two
 * messages a client renders for one condition, and they would drift on the day one of them is
 * reworded. `provider-connections.service.ts` reaches across a module boundary for a refusal on
 * the same reasoning; the imported thing is a pure function over a string, so nothing is wired
 * and nothing is shared but the definition.
 */

import { Inject, Injectable } from "@nestjs/common";

import { AdmissionService } from "../admission/admission.service";
import { issueNotFound } from "../estimation/estimation.errors";
import { BacklogDetailRepository, type IssueDetailRow } from "./detail.repository";
import { issueDetail, NOT_QUEUED, type DetailQueue, type IssueDetail } from "./detail.resources";

@Injectable()
export class BacklogDetailService {
  /**
   * @param detail - The statements.
   * @param admission - Why a queued issue is waiting (DI.4, #1312).
   */
  constructor(
    private readonly detail: BacklogDetailRepository,
    @Inject(AdmissionService) private readonly admission: Pick<AdmissionService, "waiting">,
  ) {}

  /**
   * One issue of this workspace, as the side panel reads it.
   *
   * @param organizationId - The workspace, established by the tenant guard.
   * @param issueId - `github_issues.id`, already validated as a uuid.
   * @returns The issue, the estimate in force or `null`, and the version list. An issue that has
   *   never been sized answers the issue-only shape — `estimate: null` and `history: []` — which
   *   is N.5 ([#119](https://github.com/NobuData/ouroboros/issues/119))'s no-estimate state and
   *   not a failure.
   * @throws {NotFoundError} `issue_not_found` — no such issue in this workspace, including an
   *   issue that exists in another one.
   */
  async detailOf(organizationId: string, issueId: string): Promise<IssueDetail> {
    const [issue, estimates] = await Promise.all([
      this.detail.issue(organizationId, issueId),
      this.detail.estimates(organizationId, issueId),
    ]);

    if (issue === undefined) {
      throw issueNotFound(issueId);
    }

    return issueDetail(issue, estimates, await this.queueOf(organizationId, issue));
  }

  /**
   * The issue's queue item and why it is waiting — read only for a queued issue.
   *
   * @param organizationId - The workspace.
   * @param issue - The issue.
   * @returns The item id and reason, or {@link NOT_QUEUED}.
   */
  private async queueOf(organizationId: string, issue: IssueDetailRow): Promise<DetailQueue> {
    if (!issue.queued) {
      return NOT_QUEUED;
    }

    const item = await this.detail.queueItem(organizationId, issue.githubRepoId, issue.number);
    if (item === undefined) {
      return NOT_QUEUED;
    }

    const waiting = await this.admission.waiting(organizationId, [item]);

    return { itemId: item.id, waiting: waiting.get(item.id) ?? null };
  }
}
