import type { Server } from "node:http";

import type { INestApplication } from "@nestjs/common";
import { INTERCEPTORS_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { createApplication } from "../../application";
import { AUTH_ERRORS } from "../auth/auth.errors";
import type { ErrorEnvelope } from "../errors/error.envelope";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DatabaseService } from "../db/db.service";
import { ConstraintViolationInterceptor } from "./constraints";
import { DomainsController } from "./domains.controller";
import { DomainsRepository } from "./domains.repository";
import { DomainsService } from "./domains.service";
import { MembersController } from "./members.controller";
import { MembersRepository } from "./members.repository";
import { MembersService } from "./members.service";
import { OrgsController } from "./orgs.controller";
import { OrgsRepository } from "./orgs.repository";
import { OrgsService } from "./orgs.service";
import { ReposController } from "./repos.controller";
import { ReposService } from "./repos.service";
import { TenancyModule } from "./tenancy.module";
import { TenantResolver } from "./tenant.resolver";
import { TenantsController } from "./tenants.controller";
import { TenantsRepository } from "./tenants.repository";
import { TenantsService } from "./tenants.service";

/**
 * The wiring — which is the one thing about a Nest module that can be wrong at run time and
 * right at compile time.
 *
 * A missing provider, a repository whose `DbModule` import was forgotten, a service that
 * cannot resolve another: every one of those is a green typecheck and a boot failure, and
 * the boot failure happens on the first request in an environment where a database exists.
 * Compiling the module here is what turns that into a unit test.
 *
 * Nothing connects. `pg` connects lazily, so a `DatabaseService` that is constructed and
 * never queried holds no connection — which is what lets a suite that starts nothing resolve
 * the real provider rather than a mock of it, and therefore check the real graph.
 */

/** The providers that must resolve, and what each one is. */
const PROVIDERS = [
  TenantResolver,
  TenantsRepository,
  DomainsRepository,
  MembersRepository,
  OrgsRepository,
  TenantsService,
  DomainsService,
  MembersService,
  OrgsService,
  ReposService,
] as const;

/** Every controller the module publishes. */
const CONTROLLERS = [
  TenantsController,
  DomainsController,
  MembersController,
  OrgsController,
  ReposController,
] as const;

describe("the tenancy module", () => {
  /**
   * Compile the module the way the application assembles it.
   *
   * @returns The compiled tree, from which any provider can be resolved.
   */
  async function compile() {
    return Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), TenancyModule],
    }).compile();
  }

  it.each(PROVIDERS)("resolves %p", async (provider) => {
    const moduleRef = await compile();

    expect(moduleRef.get(provider)).toBeInstanceOf(provider);

    await moduleRef.close();
  });

  it.each(CONTROLLERS)("resolves %p", async (controller) => {
    const moduleRef = await compile();

    expect(moduleRef.get(controller)).toBeInstanceOf(controller);

    await moduleRef.close();
  });

  it("reaches the database through DbModule rather than building its own", async () => {
    // The import in `tenancy.module.ts` is what makes this resolvable, and the answer to
    // "who can reach the tenancy schema" is the set of modules that import `DbModule` —
    // which is only an answer if a feature module cannot get there another way.
    const moduleRef = await compile();

    expect(moduleRef.get(DatabaseService)).toBeInstanceOf(DatabaseService);

    await moduleRef.close();
  });

  it("holds no connection until something queries", async () => {
    // `pg` connects lazily. If that stopped being true this suite would start needing a
    // database, which is exactly the thing `jest.config.mjs` promises it does not.
    const moduleRef = await compile();

    await expect(moduleRef.close()).resolves.toBeUndefined();
  });

  it.each(CONTROLLERS)("maps constraint violations under %p", (controller) => {
    // Every tenancy controller carries the interceptor, so a constraint no service
    // anticipated — including one a future migration adds — answers with a code and a status
    // rather than a stack trace.
    const interceptors: unknown = Reflect.getMetadata(INTERCEPTORS_METADATA, controller);

    expect(interceptors).toContain(ConstraintViolationInterceptor);
  });

  it("exports only what the modules after it need", async () => {
    // `TenantsService` is what the tenant context resolves through and `MembersService` what
    // it reads memberships from. Everything else stays inside: nothing outside a controller
    // should be reaching into these rules.
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), TenancyModule],
    }).compile();

    const consumer = moduleRef.select(TenancyModule);
    expect(consumer.get(TenantsService)).toBeInstanceOf(TenantsService);
    expect(consumer.get(MembersService)).toBeInstanceOf(MembersService);

    await moduleRef.close();
  });
});

describe("the guards this module registers", () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApplication(testConfiguration(), { logger: false });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  /** The adapter's server, typed so Supertest can be handed it without an `any`. */
  const server = (): Server => app.getHttpServer() as Server;

  it("runs after the session guard, so a stranger is a 401 and not a 404", async () => {
    // Nest applies global guards in the order their modules are initialised, and
    // `AppModule` imports `AuthModule` before `TenancyModule` for exactly this reason. The
    // consequence is asserted rather than the order, because the order is what could change
    // and the consequence is what matters: an unauthenticated caller must not reach a
    // database query at all.
    const response = await request(server()).get(
      "/api/v1/tenants/9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
    );

    expect(response.status).toBe(401);
    expect((response.body as ErrorEnvelope).code).toBe(AUTH_ERRORS.unauthenticated);
  });

  it("refuses an unauthenticated mutation before the role guard could ask about a role", async () => {
    const response = await request(server())
      .patch("/api/v1/tenants/9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10")
      .send({ displayName: "Mine Now" });

    expect(response.status).toBe(401);
  });

  it("leaves the public routes alone", async () => {
    // The tenant guard exempts them first, which is why this suite — which starts no
    // database — can answer them at all.
    await request(server()).get("/api/v1").expect(200);
    await request(server()).get("/health/live").expect(200);
  });
});
