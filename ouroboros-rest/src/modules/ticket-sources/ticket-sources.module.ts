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
 * ```
 *
 * **It declares no controller, and that is deliberate.** The source-management API — add,
 * configure, pause, test, sync, status — is Q.4's
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)), and it will live with the
 * settings surface it serves. What this module owns is the cycle those routes will call, which
 * is `BacklogSyncModule`'s division of labour exactly: a module with a loop and no routes, and
 * a module with routes and no loop. Keeping them apart is what preserves this module's one
 * property — nothing an HTTP request does can reach inside a cycle.
 *
 * **{@link TICKET_SOURCE_PROVIDERS} is bound to an empty list, and this is the file that
 * changes when that stops being true.** Q.3 ([#140](https://github.com/NobuData/ouroboros/issues/140))
 * adds `GithubTicketSourceProvider`, Q.5 ([#142](https://github.com/NobuData/ouroboros/issues/142))
 * adds the in-memory fake, and T.2–T.4 add Jira, Linear and GitLab — one line each, here, and
 * nowhere else. `.dependency-cruiser.cjs`'s `ticket-source-core-imports-the-spi-only` names
 * this file as the single exemption for exactly that reason: registration has to happen
 * somewhere, and *somewhere* should be one place a reader can find.
 *
 * `useValue: []` rather than no binding at all: `TicketSourceRegistry` injects the token, and a
 * token nothing provides is a boot failure rather than an empty catalog. An empty catalog is
 * the honest state of this build — see `ticket-source.registry.ts`.
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
 * `ticket.intake.ts` carries the argument for why the pipeline cannot simply be wired up yet
 * and what Q.3 changes to wire it.
 *
 * `ScheduleModule.forRoot()` is imported for `SchedulerRegistry`, as `BacklogSyncModule` and
 * `ProviderHealthModule` do; the call is idempotent, so three modules asking for it is one
 * registry.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { DbModule } from "../db/db.module";
import { VaultModule } from "../vault/vault.module";
import { TICKET_SOURCE_PROVIDERS, TicketSourceRegistry } from "./ticket-source.registry";
import { TicketSourcesRepository } from "./ticket-sources.repository";
import { TicketSourcesScheduler } from "./ticket-sources.scheduler";
import { TicketSourcesService } from "./ticket-sources.service";
import { LoggingTicketIntake, TICKET_INTAKE } from "./ticket.intake";

@Module({
  imports: [DbModule, VaultModule, ScheduleModule.forRoot()],
  providers: [
    TicketSourcesService,
    TicketSourcesRepository,
    TicketSourcesScheduler,
    TicketSourceRegistry,
    {
      provide: TICKET_SOURCE_PROVIDERS,
      // The registration point. See this module's header.
      useValue: [],
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
