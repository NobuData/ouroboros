/**
 * *Run my first loop* — the guarded launch
 * ([#388](https://github.com/NobuData/ouroboros/issues/388), BB.5, decision **O7**).
 *
 * It does everything it says and nothing it cannot:
 *
 * ```
 * guards      steps 1–3 done in reality, and a pick that is this repository's issue
 *             → 409 with the stated reason the action bar renders
 * queue       M.3's write (#112), naming the instantiated workflow — so R.1 (#143) pins its
 *             version in force, reason `explicit`
 * completion  the wizard's own guarded step 4: stamps completed, dry-run defaulted ON if unset
 * dry-run     read back from the database after completion — the receipt says what it is
 * receipt     the queue item, the pin, dry-run, links, the projected timeline, the wizard
 * ```
 *
 *   * **It launches what exists.** The issue is queued; no loop is started here, because
 *     autonomous execution (AR.1, #315) does not exist. The receipt's `run` is null until a run
 *     of the issue does.
 *   * **A repeat is not a second launch.** An issue the queue already holds, or that already has
 *     a run, is never written again — the receipt reports `already_queued` or `already_started`
 *     and the wizard is completed all the same, so a double press or a retry is safe.
 *   * **The queue's refusals pass through.** An unsized pick, an archived workflow or a number
 *     another repository queued first is refused by the queue write with its own code and
 *     sentence, and nothing is completed.
 */

import { Inject, Injectable } from "@nestjs/common";

import { BacklogQueueService } from "../backlog/queue.service";
import { queueItemSummary, type QueueItemSummary } from "../dashboard/resources";
import { ConflictError } from "../errors/error.envelope";
import { OrgPolicyService } from "../policies/org-policy.service";
import { LaunchRepository, type MirroredPickRow } from "./launch.repository";
import {
  launchReceipt,
  type LaunchOutcome,
  type LaunchReceiptParts,
  type LaunchReceiptResource,
} from "./launch.resources";
import { blockingStep } from "./onboarding.derivation";
import { pickRequired, stepIncomplete } from "./onboarding.errors";
import { OnboardingService, type OnboardingSnapshot } from "./onboarding.service";

/** The queue write, as the launcher composes it (M.3, #112). */
export type LaunchQueue = Pick<BacklogQueueService, "queueSelection">;

/** The dry-run policy, as the launcher confirms it (BA.3, #382). */
export type LaunchPolicies = Pick<OrgPolicyService, "read">;

/** The last step the launch guard requires done — step 4 is what the launch itself does. */
const LAST_PREREQUISITE_STEP = 3;

/** What the launch found or wrote for the picked issue. */
type Queued = Pick<LaunchReceiptParts, "outcome" | "queue" | "workflow" | "runId">;

@Injectable()
export class FirstRunLauncherService {
  /**
   * @param wizard - The wizard: the snapshot the guards read, and the guarded completion.
   * @param launches - The picked issue in the mirrored backlog, and what already speaks for it.
   * @param queue - M.3's queue write.
   * @param policies - The dry-run policy.
   */
  constructor(
    private readonly wizard: OnboardingService,
    private readonly launches: LaunchRepository,
    @Inject(BacklogQueueService) private readonly queue: LaunchQueue,
    @Inject(OrgPolicyService) private readonly policies: LaunchPolicies,
  ) {}

  /**
   * Launch the first loop for one repository: queue the picked issue under the instantiated
   * workflow, complete the wizard, and answer the receipt.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`; compared case-insensitively.
   * @returns The receipt — what was queued, where, pinned to what, and dry-run's state.
   * @throws {ConflictError} `onboarding_step_incomplete` — a step 1–3 is not done, with its
   *   stated reason; `onboarding_pick_required` — no issue of this repository is picked, or its
   *   backlog does not hold the pick; `queue_issues_conflict` — the queue write's own refusal.
   * @throws {InvalidRequestError} `queue_issues_not_queueable` or `queue_workflow_unknown` — the
   *   queue write's own refusals.
   */
  async launch(organizationId: string, repo: string): Promise<LaunchReceiptResource> {
    const snapshot = await this.wizard.snapshot(organizationId, repo);
    const blocking = blockingStep(snapshot.resource, LAST_PREREQUISITE_STEP);

    if (blocking !== undefined) {
      throw stepIncomplete(4, blocking);
    }

    const { repository, workflow } = snapshot;

    if (repository === undefined || workflow === undefined) {
      // Steps 2 and 3 are derived from these two rows, so a rail that passed the guard has both.
      // Checked rather than asserted: a change to the derivation must not launch without them.
      throw new Error("The onboarding rail reports steps 2 and 3 done without their rows.");
    }

    const pick = await this.pick(organizationId, snapshot, repository.id);
    const queued = await this.enqueue(organizationId, repository.id, pick, workflow.slug);
    const onboarding = await this.wizard.completeStep(organizationId, repo, 4);
    const policy = await this.policies.read(organizationId);

    return launchReceipt({
      ...queued,
      issue: { id: pick.id, number: pick.number, title: pick.title },
      policy: { dryRun: policy.dryRun, reason: policy.reason },
      cycle:
        pick.cycleMin === null || pick.cycleMax === null
          ? null
          : { min: pick.cycleMin, max: pick.cycleMax },
      onboarding,
    });
  }

  /**
   * The issue to queue: the picked ticket, found in the repository's mirrored backlog.
   *
   * @param organizationId - The workspace.
   * @param snapshot - The wizard.
   * @param repositoryId - `github_repos.id`.
   * @returns The mirrored issue.
   * @throws {ConflictError} `onboarding_pick_required`, with the stated reason.
   */
  private async pick(
    organizationId: string,
    snapshot: OnboardingSnapshot,
    repositoryId: string,
  ): Promise<MirroredPickRow> {
    const { resource, ticket, issueNumber } = snapshot;

    if (ticket === undefined) {
      throw pickRequired("No first issue has been picked yet.");
    }

    if (issueNumber === undefined) {
      throw pickRequired(
        `${ticket.external_key} is not an issue of ${resource.repo}, so it cannot be its first run.`,
      );
    }

    const issue = await this.launches.mirroredPick(organizationId, repositoryId, issueNumber);

    if (issue === undefined) {
      throw pickRequired(
        `${ticket.external_key} is not in ${resource.repo}'s synced backlog yet, so it cannot be queued.`,
      );
    }

    return issue;
  }

  /**
   * Queue the issue under the instantiated workflow — unless the queue or a run already speaks
   * for it, in which case nothing is written and the existing state is reported.
   *
   * @param organizationId - The workspace.
   * @param repositoryId - `github_repos.id`.
   * @param pick - The mirrored issue.
   * @param workflow - The instantiated workflow's slug — the explicit workflow R.1 pins.
   * @returns What was found or written.
   */
  private async enqueue(
    organizationId: string,
    repositoryId: string,
    pick: MirroredPickRow,
    workflow: string,
  ): Promise<Queued> {
    const held = await this.launches.queueItem(organizationId, repositoryId, pick.number);

    if (held !== undefined) {
      return queuedAs("already_queued", queueItemSummary(held));
    }

    const run = await this.launches.latestRun(organizationId, repositoryId, pick.number);

    if (run !== undefined) {
      return {
        outcome: "already_started",
        queue: null,
        workflow: { slug: run.workflowTag, version: null, pinReason: null },
        runId: run.id,
      };
    }

    try {
      const { items } = await this.queue.queueSelection(organizationId, {
        issueIds: [pick.id],
        workflow,
      });

      return queuedAs("queued", items[0]);
    } catch (error) {
      // Two presses at once: the other one's row is in the queue now, and that is this launch's
      // answer too. Any other conflict — another repository holding the number — stays refused.
      const raced =
        error instanceof ConflictError
          ? await this.launches.queueItem(organizationId, repositoryId, pick.number)
          : undefined;

      if (raced === undefined) {
        throw error;
      }

      return queuedAs("already_queued", queueItemSummary(raced));
    }
  }
}

/**
 * A queue item as the receipt's queue and workflow parts.
 *
 * @param outcome - Whether this launch wrote it or found it.
 * @param item - The queue item.
 * @returns The parts — the workflow reference is the item's own pin, so the receipt names what
 *   the queue actually holds.
 */
function queuedAs(outcome: LaunchOutcome, item: QueueItemSummary): Queued {
  return {
    outcome,
    queue: item,
    workflow: {
      slug: item.workflowTag,
      version: item.workflowVersion,
      pinReason: item.workflowPinReason,
    },
    runId: null,
  };
}
