import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DatabaseService } from "../db/db.service";
import { TICKET_SOURCE_PROVIDERS, TicketSourceRegistry } from "./ticket-source.registry";
import { TicketSourcesModule } from "./ticket-sources.module";
import { TicketSourcesRepository } from "./ticket-sources.repository";
import { TicketSourcesScheduler } from "./ticket-sources.scheduler";
import { TicketSourcesService } from "./ticket-sources.service";
import { LoggingTicketIntake, TICKET_INTAKE, type TicketIntake } from "./ticket.intake";

/**
 * The wiring, which is where this module's two replaceable decisions live
 * ([#139](https://github.com/NobuData/ouroboros/issues/139)).
 *
 * {@link TICKET_SOURCE_PROVIDERS} is the registration point — Q.3
 * ([#140](https://github.com/NobuData/ouroboros/issues/140)) adds one line to it and Q.5
 * ([#142](https://github.com/NobuData/ouroboros/issues/142)) adds another — and
 * {@link TICKET_INTAKE} is the estimation seam Q.3 re-points. Asserting both is what makes
 * *"this build carries the interface and not the implementations"* a visible answer rather
 * than something a reader has to infer from an absence.
 *
 * Built with a stand-in `DatabaseService`, because constructing the real one opens a pool —
 * which is precisely what a suite that starts nothing must not do.
 */

describe("the ticket sources module", () => {
  /**
   * Build the module over a validated configuration and a database that never connects.
   *
   * @returns The compiled testing module.
   */
  async function build() {
    return Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), TicketSourcesModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .compile();
  }

  it("provides the loop, its statements, its registry and its timer", async () => {
    const module = await build();

    expect(module.get(TicketSourcesService)).toBeInstanceOf(TicketSourcesService);
    expect(module.get(TicketSourcesRepository)).toBeInstanceOf(TicketSourcesRepository);
    expect(module.get(TicketSourcesScheduler)).toBeInstanceOf(TicketSourcesScheduler);
    expect(module.get(TicketSourceRegistry)).toBeInstanceOf(TicketSourceRegistry);
  });

  it("declares no controller — the source management API is Q.4's", async () => {
    // Keeping the routes out is what preserves this module's one property: nothing an HTTP
    // request does can reach inside a cycle. Asserted over the decorator's metadata, which is
    // what Nest itself reads.
    await build();

    expect(Reflect.getMetadata("controllers", TicketSourcesModule)).toBeUndefined();
  });

  it("registers no provider, which is the honest state of this build", async () => {
    // Not an omission: V030 accepts five kinds and this build can reach none of them, so the
    // registry answers an honest `501` for every one. Q.3 changes this binding and nothing
    // else in the module.
    const module = await build();

    expect(module.get(TICKET_SOURCE_PROVIDERS)).toStrictEqual([]);
    expect(module.get(TicketSourceRegistry).kinds()).toStrictEqual([]);
  });

  it("binds the token anyway, so an empty catalog is a catalog and not a boot failure", async () => {
    // `TicketSourceRegistry` injects the token; a token nothing provides would fail
    // construction rather than produce an empty registry.
    await expect(build()).resolves.toBeDefined();
  });

  it("binds the estimation seam to the placeholder that says nothing was queued", async () => {
    // The cut-over's position, as wiring. `ticket.intake.ts` carries the argument: the
    // pipeline is keyed on `github_issues.id`, so handing it a `tickets.id` would be a log
    // full of misses rather than work. Q.3 changes this `provide`.
    const module = await build();

    expect(module.get<TicketIntake>(TICKET_INTAKE)).toBeInstanceOf(LoggingTicketIntake);
  });

  it("imports the vault, which is the only thing that opens a source's credential", async () => {
    // Q.2 asks for a *"credential encryption helper shared (AES-GCM, key from config)"*, and
    // AD.1 (#222) built exactly that. What this asserts is the reuse: the loop can decrypt,
    // and it can only do so through the one service that also seals.
    const module = await build();
    const service = module.get(TicketSourcesService);

    expect(Reflect.get(service, "vault")).toBeDefined();
  });
});
