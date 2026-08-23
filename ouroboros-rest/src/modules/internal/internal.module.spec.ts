import { Test } from "@nestjs/testing";
import { APP_GUARD, DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { routeTable } from "../auth/route.table.fixture";
import { createApplication } from "../../application";
import { CredentialsController } from "./credentials.controller";
import { InternalKeyGuard } from "./internal.guard";
import { InternalModule } from "./internal.module";
import { InternalRepository } from "./internal.repository";
import { LeaseService } from "./lease";
import { LeaseAudit } from "./lease.audit";
import { LlmController } from "./llm.controller";
import { LocalProviders } from "./local.providers";

/**
 * The wiring, and the one property the guard's design depends on.
 *
 * `pricing.module.spec.ts` carries the argument for asserting wiring at all: it is the thing
 * about a Nest module that can be wrong at run time and right at compile time. Nothing here
 * connects — `pg` connects lazily and no query is issued.
 *
 * The assertion that matters is the last one. `InternalKeyGuard` is global and keyed on
 * `@InternalOnly()`, which closes *forgot to add the guard* — and opens *forgot to add the
 * decorator*. A controller added under `/internal` without it would be a path that looks
 * internal, is documented as internal, and is guarded by nothing at all. So the complement is
 * checked against the running application's whole route table: every route whose **path** is
 * under `/internal` carries the metadata.
 */

describe("the internal module", () => {
  it("compiles, and resolves every layer", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), InternalModule],
    }).compile();

    expect(moduleRef.get(CredentialsController)).toBeInstanceOf(CredentialsController);
    expect(moduleRef.get(LlmController)).toBeInstanceOf(LlmController);
    expect(moduleRef.get(LeaseService)).toBeInstanceOf(LeaseService);
    expect(moduleRef.get(LocalProviders)).toBeInstanceOf(LocalProviders);
    expect(moduleRef.get(InternalRepository)).toBeInstanceOf(InternalRepository);
    expect(moduleRef.get(LeaseAudit)).toBeInstanceOf(LeaseAudit);

    await moduleRef.close();
  });

  it("registers the key guard globally rather than on a controller", () => {
    // A controller-scoped `@UseGuards()` protects the routes somebody remembered to
    // decorate, and the failure mode of forgetting is an unauthenticated internal endpoint.
    const providers = Reflect.getMetadata("providers", InternalModule) as {
      provide?: unknown;
      useClass?: unknown;
    }[];

    expect(providers).toContainEqual({ provide: APP_GUARD, useClass: InternalKeyGuard });
  });

  it("exports nothing", () => {
    // Nothing in this service should call the lease surface: it exists for a caller outside
    // the process, and a second in-process consumer would mean the policy had grown a second
    // implementation. AF.2 adds the executor *here*, beside the route it answers.
    const exports = Reflect.getMetadata("exports", InternalModule) as unknown[] | undefined;

    expect(exports ?? []).toEqual([]);
  });

  it("declares exactly the two controllers the ticket specifies", () => {
    const controllers = Reflect.getMetadata("controllers", InternalModule) as unknown[];

    expect(controllers).toEqual([CredentialsController, LlmController]);
  });
});

describe("the surface, as the running application sees it", () => {
  it("marks every route under /internal as internal", async () => {
    // The complement of the global guard's metadata check, and the reason it is safe to key
    // a guard on a decorator. Run against the whole application rather than this module, so
    // a controller declared under `/internal` from anywhere at all is caught.
    const app = await createApplication(testConfiguration(), { logger: false });
    await app.init();

    try {
      const unguarded = routeTable(app)
        .filter((route) => route.path.startsWith("/internal") && !route.internal)
        .map((route) => route.signature);

      expect(unguarded).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("puts no internal route inside the versioned browser surface", async () => {
    // The other direction: a controller marked `@InternalOnly()` but left under `/api/v1`
    // would be an engine-facing route published in the client `ouroboros-ui` generates.
    const app = await createApplication(testConfiguration(), { logger: false });
    await app.init();

    try {
      for (const route of routeTable(app).filter((each) => each.internal)) {
        expect(route.path.startsWith("/internal/")).toBe(true);
      }
    } finally {
      await app.close();
    }
  });

  it("finds both surfaces through Nest's own discovery, not a list", async () => {
    const app = await createApplication(testConfiguration(), { logger: false });
    await app.init();

    try {
      const found = app
        .get(DiscoveryService)
        .getControllers()
        .map((wrapper) => wrapper.metatype as unknown);

      expect(found).toContain(CredentialsController);
      expect(found).toContain(LlmController);
      expect(app.get(MetadataScanner)).toBeInstanceOf(MetadataScanner);
      expect(app.get(Reflector)).toBeInstanceOf(Reflector);
    } finally {
      await app.close();
    }
  });
});
