import { Test } from "@nestjs/testing";

import { AuditService } from "../audit/audit.service";
import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DatabaseService } from "../db/db.service";
import { NotImplementedError } from "../errors/error.envelope";
import { OCTOKIT_FACTORY, type OctokitFactory } from "../github/github.client.factory";
import { GithubRateLimiter } from "../github/github.rate-limit";
import { GithubTicketSourceProvider } from "./providers/github.provider";
import { SourcesController } from "./sources.controller";
import { SourcesRepository } from "./sources.repository";
import { SourcesService } from "./sources.service";
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
 * ([#140](https://github.com/NobuData/ouroboros/issues/140)) put the first entry in it and Q.5
 * ([#142](https://github.com/NobuData/ouroboros/issues/142)) adds another — and
 * {@link TICKET_INTAKE} is the estimation seam the cut-over will re-point. Asserting both is
 * what makes *"which trackers does this build have, and where do their tickets go"* a visible
 * answer rather than something a reader has to infer.
 *
 * Built with a stand-in `DatabaseService`, because constructing the real one opens a pool —
 * which is precisely what a suite that starts nothing must not do — and a stand-in
 * `AuditService`, which arrives with `GithubModule` since Q.3 imported it for the Octokit seam.
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
      .overrideProvider(AuditService)
      .useValue({ record: jest.fn() })
      .compile();
  }

  it("provides the loop, its statements, its registry and its timer", async () => {
    const module = await build();

    expect(module.get(TicketSourcesService)).toBeInstanceOf(TicketSourcesService);
    expect(module.get(TicketSourcesRepository)).toBeInstanceOf(TicketSourcesRepository);
    expect(module.get(TicketSourcesScheduler)).toBeInstanceOf(TicketSourcesScheduler);
    expect(module.get(TicketSourceRegistry)).toBeInstanceOf(TicketSourceRegistry);
  });

  it("declares the one controller Q.4 added — the source management API, and nothing else", async () => {
    // Q.2 shipped this module with no routes and named the property it wanted kept: nothing an
    // HTTP request does can reach inside a cycle. The routes keep it by reaching the loop
    // through `syncSource` and three read-only accessors — see `sources.service.ts` — so the
    // controller list is one entry, and a second one would want the same argument made again.
    const module = await build();

    expect(Reflect.getMetadata("controllers", TicketSourcesModule)).toStrictEqual([
      SourcesController,
    ]);
    expect(module.get(SourcesService)).toBeInstanceOf(SourcesService);
    expect(module.get(SourcesRepository)).toBeInstanceOf(SourcesRepository);
  });

  it("registers the GitHub provider, and only it", async () => {
    // V030 accepts five kinds and this build can reach one of them, so the registry answers an
    // honest `501` for the other four. The list is the whole catalog: T.2–T.4 add a line each.
    const module = await build();

    expect(module.get<unknown[]>(TICKET_SOURCE_PROVIDERS)).toHaveLength(1);
    expect(module.get(TicketSourceRegistry).kinds()).toStrictEqual(["github"]);
  });

  it("resolves that provider through the registry, by the kind a row carries", async () => {
    // The dispatch the sync loop makes, made once here: nothing in core names the class.
    const module = await build();

    expect(module.get(TicketSourceRegistry).get("github")).toBeInstanceOf(
      GithubTicketSourceProvider,
    );
  });

  it("still answers 501 for a kind this build has no provider for", async () => {
    const module = await build();

    expect(() => module.get(TicketSourceRegistry).get("jira")).toThrow(NotImplementedError);
  });

  it("takes the Octokit seam from GithubModule rather than binding the library twice", async () => {
    // Q.3's third acceptance criterion, as wiring: `no-octokit-outside-the-seam` stays down to
    // one file because this module imports the binding instead of making a second one.
    const module = await build();
    const octokit = module.get<OctokitFactory>(OCTOKIT_FACTORY)(
      "ghp_qwertyuiopasdfghjklzxcvbnm0123456789",
    );

    expect(typeof octokit.request).toBe("function");
    expect(typeof octokit.paginate.iterator).toBe("function");
  });

  it("gives the provider a rate guard of its own, not the one the backlog poller spends", async () => {
    // Two guards for two tokens. Sharing them would let a ticket source's exhausted budget make
    // the backlog page say `rate_limited` about a token that is fine.
    const module = await build();
    const provider = module.get(GithubTicketSourceProvider);

    expect(Reflect.get(provider, "budget")).not.toBe(module.get(GithubRateLimiter));
  });

  it("binds the token as a list, so a catalog stays something a reader can count", async () => {
    // `TicketSourceRegistry` injects the token; a token nothing provides would fail
    // construction rather than produce a registry at all.
    await expect(build()).resolves.toBeDefined();
  });

  it("binds the estimation seam to the placeholder that says nothing was queued", async () => {
    // The cut-over's position, as wiring. `ticket.intake.ts` carries the argument: the
    // pipeline is keyed on `github_issues.id`, so handing it a `tickets.id` would be a log
    // full of misses rather than work. Q.3 did not move it — re-pointing `issue_estimates` is a
    // migration, and #140's *Affected systems* names `ouroboros-rest` alone.
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
