/**
 * The wizard's right column, read for one repository
 * ([#388](https://github.com/NobuData/ouroboros/issues/388), BB.5, decisions **O6**, **O9**).
 *
 * Gathers four facts and hands them to `defaults.resources.ts`, which does the selecting:
 *
 * ```
 * capability flags   deployment configuration — both absent unless declared   AppConfigService
 * nightly estimator  the job's schedule and real last run (AL.5, #281)        BacklogHealthRepository
 * dry-run policy     what the draft-only claim is true because of (BA.3)      OrgPolicyService
 * the wizard         the covering source (App or token) and the picked issue  OnboardingService
 * ```
 *
 * Nothing here writes, and nothing here decides copy.
 */

import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { BacklogHealthRepository } from "../planning/health.repository";
import { reestimationStatus } from "../planning/health.service";
import { OrgPolicyService } from "../policies/org-policy.service";
import {
  smartDefaultsResource,
  type ConnectionFact,
  type SmartDefaultsFacts,
  type SmartDefaultsResource,
} from "./defaults.resources";
import { LaunchRepository } from "./launch.repository";
import type { SourceFact } from "./onboarding.derivation";
import { OnboardingService, type OnboardingSnapshot } from "./onboarding.service";

/** The dry-run policy, as this service reads it. */
export type DefaultsPolicies = Pick<OrgPolicyService, "read">;

@Injectable()
export class SmartDefaultsService {
  /**
   * @param wizard - The wizard's snapshot: the covering source and the picked issue.
   * @param launch - The picked issue's estimate, from the mirrored backlog.
   * @param health - The nightly job's latest run.
   * @param config - The capability flags, the trial credit and the nightly job's schedule.
   * @param policies - The dry-run policy.
   */
  constructor(
    private readonly wizard: OnboardingService,
    private readonly launch: LaunchRepository,
    private readonly health: BacklogHealthRepository,
    private readonly config: AppConfigService,
    @Inject(OrgPolicyService) private readonly policies: DefaultsPolicies,
  ) {}

  /**
   * The Smart Defaults rows, the reassure claims and the projected timeline for one repository.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`; compared case-insensitively.
   * @returns The payload — rows selected by the deployment's declared capabilities, claims
   *   limited to mechanisms the workspace has.
   */
  async read(organizationId: string, repo: string): Promise<SmartDefaultsResource> {
    const snapshot = await this.wizard.snapshot(organizationId, repo);
    const [lastRun, policy, pick] = await Promise.all([
      this.health.lastRun(organizationId),
      this.policies.read(organizationId),
      this.pick(organizationId, snapshot),
    ]);
    const managedKeyPool = this.config.managedKeyPool;

    return smartDefaultsResource({
      repo: snapshot.resource.repo,
      capabilities: { managedKeyPool, hostedRunnerPool: this.config.hostedRunnerPool },
      trialCents: managedKeyPool ? this.config.managedKeyTrialCents : undefined,
      estimator: reestimationStatus(this.config, lastRun),
      connection: connectionOf(snapshot.source),
      dryRun: { active: policy.dryRun, explicit: policy.explicit },
      pick,
    });
  }

  /**
   * The picked issue as the timeline names it, with its estimate's cycle range.
   *
   * @param organizationId - The workspace.
   * @param snapshot - The wizard.
   * @returns The pick, or null when nothing is picked or the pick is not this repository's issue.
   */
  private async pick(
    organizationId: string,
    snapshot: OnboardingSnapshot,
  ): Promise<SmartDefaultsFacts["pick"]> {
    const { repository, issueNumber } = snapshot;

    if (repository === undefined || issueNumber === undefined) {
      return null;
    }

    const issue = await this.launch.mirroredPick(organizationId, repository.id, issueNumber);
    const cycle =
      issue === undefined || issue.cycleMin === null || issue.cycleMax === null
        ? null
        : { min: issue.cycleMin, max: issue.cycleMax };

    return { issueKey: `#${String(issueNumber)}`, cycle };
  }
}

/**
 * How the repository reaches GitHub, from the source covering it.
 *
 * @param source - The covering source, or null.
 * @returns App when the account records an installation, token otherwise, null with no source.
 */
export function connectionOf(source: SourceFact | null): ConnectionFact {
  return source === null
    ? null
    : { kind: source.appInstalled ? "app" : "token", login: source.login };
}
