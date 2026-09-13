/**
 * The pluggable intake layer — the `TicketSourceProvider` SPI, the registry the sync loop
 * resolves through, and the loop itself (Q.2,
 * [#139](https://github.com/NobuData/ouroboros/issues/139)).
 *
 * ```
 * cadence.ts                     how many sources at once, and how soon a page resumes
 * ticket-source.errors.ts        the four words a provider may fail in, and the sentence each becomes
 * ticket-source.provider.ts      the SPI — the one interface the loop knows about
 * ticket-source.registry.ts      providers by kind; two misuses refused at boot
 * ticket.intake.ts               the estimation handoff, as a port
 * sync.report.ts                 what a cycle did, and the one word for a source it did not poll
 * ticket-sources.repository.ts   the cross-workspace read, the one credential statement, the one transaction
 * ticket-sources.service.ts      the loop: full or incremental, upsert, status, handoff
 * ticket-sources.scheduler.ts    what makes it periodic
 * providers/github.*             the GitHub provider — the first conforming plugin
 * ```
 *
 * **It declares one controller since Q.4** ([#141](https://github.com/NobuData/ouroboros/issues/141)):
 * `sources.controller.ts`, the source-management API — add, configure, pause, credentials,
 * test, sync, status. Q.2 shipped this module with no routes and named the division of labour
 * it wanted kept — *nothing an HTTP request does can reach inside a cycle* — and the routes keep
 * it: `SourcesService` reaches the loop through two public members, `syncSource` for one source
 * on demand and the three read-only accessors a status report is composed from, and the
 * cycle's own machinery stays private. The request's statements are `sources.repository.ts`,
 * workspace-scoped; the loop's stay in `ticket-sources.repository.ts`, unscoped, and the one
 * statement that reads a sealed credential is still that file's.
 *
 * **{@link TICKET_SOURCE_PROVIDERS} is the registration point, and this is the file that
 * changes when a build gains a tracker.** Q.3
 * ([#140](https://github.com/NobuData/ouroboros/issues/140)) made it one entry long by adding
 * `GithubTicketSourceProvider`; Q.5 ([#142](https://github.com/NobuData/ouroboros/issues/142))
 * adds the in-memory fake, and T.2–T.4 add Jira, Linear and GitLab — one line each, here, and
 * nowhere else. `.dependency-cruiser.cjs`'s `ticket-source-core-imports-the-spi-only` names
 * this file as the single exemption for exactly that reason: registration has to happen
 * somewhere, and *somewhere* should be one place a reader can find.
 *
 * It stays a `useFactory` over a list rather than becoming a class the registry imports: the
 * list is what makes *"how many trackers does this build have"* a question with a visible
 * answer, and an empty one — the state before Q.3 — was an honest catalog rather than a boot
 * failure.
 *
 * **`GithubModule` is imported for one binding: `OCTOKIT_FACTORY`.** The provider needs a
 * client for a *source's* credential, which `GithubClientFactory` cannot build because it reads
 * the workspace's settings token instead. Taking K.3's
 * ([#101](https://github.com/NobuData/ouroboros/issues/101)) seam rather than binding
 * `createOctokit` a second time is what keeps `no-octokit-outside-the-seam` down to one file —
 * the boundary Q.3's third acceptance criterion asks CI to enforce.
 *
 * **`VaultModule` is imported, and what it contributes is the only way a credential is
 * opened.** `VaultService.decryptText` is AD.1's ([#222](https://github.com/NobuData/ouroboros/issues/222)),
 * and it is what makes Q.2's *"credential encryption helper shared (AES-GCM, key from config)"*
 * a reuse rather than a second implementation: the issue asks for a shared AES-GCM helper keyed
 * from typed config, AD.1 built exactly that — envelope encryption with per-tenant DEKs, the
 * master key from `OURO_VAULT_MASTER_KEY` through `AppConfigService` — and V030's
 * `ticket_sources_credentials_sealed` already refuses any value that is not one of its
 * envelopes. A helper written here would have been a second thing to rotate.
 *
 * **The estimation intake is bound by token**, and today the binding is
 * {@link LoggingTicketIntake}. That is the cut-over's position stated in one line;
 * `ticket.intake.ts` carries the argument for why the pipeline cannot simply be wired up yet.
 * Q.3 did **not** move it: re-pointing `issue_estimates` at `tickets.id` is a migration in
 * `ouroboros-db`, and #140's *Affected systems* names `ouroboros-rest` alone. What Q.3
 * delivered is the provider that fills `tickets`; what still reads `github_issues` still does.
 *
 * `ScheduleModule.forRoot()` is imported for `SchedulerRegistry`, as `BacklogSyncModule` and
 * `ProviderHealthModule` do; the call is idempotent, so three modules asking for it is one
 * registry.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { DbModule } from "../db/db.module";
import { GithubModule } from "../github/github.module";
import { VaultModule } from "../vault/vault.module";
import {
  GITHUB_SOURCE_BUDGET_PROVIDER,
  GithubTicketSourceProvider,
} from "./providers/github.provider";
import { SourcesController } from "./sources.controller";
import { SourcesRepository } from "./sources.repository";
import { SourcesService } from "./sources.service";
import { TICKET_SOURCE_PROVIDERS, TicketSourceRegistry } from "./ticket-source.registry";
import { TicketSourcesRepository } from "./ticket-sources.repository";
import { TicketSourcesScheduler } from "./ticket-sources.scheduler";
import type { TicketSourceProvider } from "./ticket-source.provider";
import { TicketSourcesService } from "./ticket-sources.service";
import { LoggingTicketIntake, TICKET_INTAKE } from "./ticket.intake";

@Module({
  imports: [DbModule, VaultModule, GithubModule, ScheduleModule.forRoot()],
  controllers: [SourcesController],
  providers: [
    TicketSourcesService,
    TicketSourcesRepository,
    TicketSourcesScheduler,
    TicketSourceRegistry,
    SourcesService,
    SourcesRepository,
    GithubTicketSourceProvider,
    GITHUB_SOURCE_BUDGET_PROVIDER,
    {
      provide: TICKET_SOURCE_PROVIDERS,
      // The registration point. See this module's header.
      useFactory: (github: GithubTicketSourceProvider): TicketSourceProvider[] => [github],
      inject: [GithubTicketSourceProvider],
    },
    {
      provide: TICKET_INTAKE,
      useClass: LoggingTicketIntake,
    },
  ],
  exports: [
    TicketSourcesService,
    TicketSourcesRepository,
    TicketSourcesScheduler,
    TicketSourceRegistry,
  ],
})
export class TicketSourcesModule {}
