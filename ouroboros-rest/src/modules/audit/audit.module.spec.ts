import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DatabaseService } from "../db/db.service";
import { DbModule } from "../db/db.module";
import { AuditController } from "./audit.controller";
import { AuditModule } from "./audit.module";
import { AuditRepository } from "./audit.repository";
import { AuditService } from "./audit.service";

/**
 * How the module is wired, and the one export that matters.
 *
 * {@link AuditService} is the module's whole outward surface: two other modules write through
 * it — `provider-connections/` for the credential lifecycle, `internal/` for AD.3's lease
 * grants — and neither may reach the repository, because a writer that constructed its own
 * row could supply its own client address, and *the address comes from the request* is the
 * property the `ip` column exists for.
 */

/** A container with the module's real graph, and only its one edge to the world stubbed. */
async function container() {
  return (
    Test.createTestingModule({
      // The configuration module is global in the running application; a testing container
      // has to be given it, exactly as `provider-connections.module.spec.ts` does.
      imports: [ConfigurationModule.forRoot(testConfiguration()), AuditModule],
    })
      // Constructing the real `DatabaseService` opens a pool, which is precisely what a suite
      // that starts nothing must not do. Everything else is the module's own graph.
      .overrideProvider(DatabaseService)
      .useValue({})
      .compile()
  );
}

describe("the audit module", () => {
  it("imports the database module rather than assuming it", () => {
    // #30 left `DbModule` deliberately non-global so *who can reach the tenancy schema* has
    // an answer.
    const imports = Reflect.getMetadata("imports", AuditModule) as unknown[];

    expect(imports).toEqual([DbModule]);
  });

  it("serves the trail from one controller", () => {
    expect(Reflect.getMetadata("controllers", AuditModule)).toEqual([AuditController]);
  });

  it("exports the service and nothing else", () => {
    // The repository is deliberately not exported: see this file's header.
    expect(Reflect.getMetadata("exports", AuditModule)).toEqual([AuditService]);
  });

  it("builds the whole graph the trail needs", async () => {
    const app = await container();

    expect(app.get(AuditController)).toBeInstanceOf(AuditController);
    expect(app.get(AuditService)).toBeInstanceOf(AuditService);
    expect(app.get(AuditRepository)).toBeInstanceOf(AuditRepository);
  });

  it("applies its middleware to every route, public ones included", () => {
    // A store nothing reads costs one object per request and means *where did this come
    // from* is always a legitimate question with an honest answer — rather than one that
    // returns nothing on the routes somebody forgot to list, which in a trail would read as
    // *this happened from nowhere*.
    const consumer = { apply: jest.fn().mockReturnThis(), forRoutes: jest.fn() };

    new AuditModule().configure(consumer);

    expect(consumer.apply).toHaveBeenCalledTimes(1);
    expect(consumer.forRoutes).toHaveBeenCalledWith(expect.objectContaining({ path: "*path" }));
  });
});
