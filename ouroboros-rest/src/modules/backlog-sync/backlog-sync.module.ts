/**
 * The backlog sync — what fills `github_issues`, and what mockup 03's *"synced 40s ago"* tag
 * counts from (K.4, [#102](https://github.com/NobuData/ouroboros/issues/102)).
 *
 * ```
 * cadence.ts                   how much one poll holds, and how soon a capped one resumes
 * sync.report.ts               what a poll did, and the closed set of words for why it did not
 * issue.mapping.ts             GitHub's JSON read — and the one place a pull request is dropped
 * estimation.intake.ts         the seam L.3 (#107) plugs into; a logging placeholder until then
 * backlog-sync.repository.ts   the cross-workspace read, and the one transaction per poll
 * backlog-sync.service.ts      the cycle: initial import, incremental `since`, pauses
 * backlog-sync.scheduler.ts    what makes it periodic
 * ```
 *
 * **It has no controller, and that is deliberate.** The manual re-sync trigger and the sync
 * status endpoint are M.4's ([#113](https://github.com/NobuData/ouroboros/issues/113)); this
 * ticket owns the cycle those routes will call. {@link BacklogSyncService} and
 * {@link BacklogSyncScheduler} are exported for exactly that — the service so a status endpoint
 * can read the last cycle's pause reasons beside the stored cursors, and the scheduler so a
 * trigger can drive one cycle without reaching into the private timer.
 *
 * **`GithubModule` is imported, and what it contributes is a client and a question.**
 * `GithubClientFactory` opens the workspace's token per call and never caches it, which is what
 * makes a rotation take effect on the next poll; `GithubCredentialsService` answers *which
 * workspaces have a token*, which is the only way a workspace with no token can be told apart
 * from a workspace with no enabled repository. No credential is read here, and this module
 * cannot reach one: `github.credentials.service.ts` is the only thing that opens an envelope.
 *
 * **The estimation intake is bound by token**, and the binding is the seam. L.3 replaces this
 * one line with its orchestrator and changes nothing else in this module — see
 * `estimation.intake.ts` for why the placeholder logs rather than pretends.
 *
 * `ScheduleModule.forRoot()` is imported for `SchedulerRegistry`, as `ProviderHealthModule`
 * does; the call is idempotent, so two modules asking for it is one registry.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { DbModule } from "../db/db.module";
import { GithubModule } from "../github/github.module";
import { BacklogSyncRepository } from "./backlog-sync.repository";
import { BacklogSyncScheduler } from "./backlog-sync.scheduler";
import { BacklogSyncService } from "./backlog-sync.service";
import { ESTIMATION_INTAKE, LoggingEstimationIntake } from "./estimation.intake";

@Module({
  imports: [DbModule, GithubModule, ScheduleModule.forRoot()],
  providers: [
    BacklogSyncService,
    BacklogSyncRepository,
    BacklogSyncScheduler,
    {
      provide: ESTIMATION_INTAKE,
      // `useClass` rather than `useValue`: the placeholder is a `@Injectable()` with a logger of
      // its own, and L.3's replacement will want its own dependencies injected the same way.
      useClass: LoggingEstimationIntake,
    },
  ],
  exports: [BacklogSyncService, BacklogSyncScheduler],
})
export class BacklogSyncModule {}
