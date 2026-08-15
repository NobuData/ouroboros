import { Injectable, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";

import { ConfigurationModule } from "./config.module";
import { AppConfigService } from "./config.service";
import { ALL_INTERFACES_HOST, LOOPBACK_HOST, type Configuration } from "./configuration";
import { testConfiguration } from "./configuration.fixture";
import { REDACTED } from "./redaction";

/**
 * Build a module tree with configuration registered, as `AppModule.forRoot` does.
 *
 * @param configuration - What to register. Defaults to the development values.
 * @returns The compiled testing module.
 */
async function moduleWith(configuration: Configuration = testConfiguration()) {
  return Test.createTestingModule({
    imports: [ConfigurationModule.forRoot(configuration)],
  }).compile();
}

describe("AppConfigService", () => {
  let app: TestingModule;
  let config: AppConfigService;

  beforeEach(async () => {
    app = await moduleWith();
    config = app.get(AppConfigService);
  });

  afterEach(async () => {
    await app.close();
  });

  it("hands out every value the schema produced, typed", () => {
    expect(config.port).toBe(4000);
    expect(config.nodeEnv).toBe("development");
    expect(config.databaseUrl).toBe("postgresql://ouroboros:ouroboros@localhost:5432/ouroboros");
    expect(config.restUrl).toBe("http://localhost:4000");
    expect(config.uiUrl).toBe("http://localhost:3000");
    expect(config.engineUrl).toBe("http://localhost:8000");
    expect(config.engineSharedSecret).toBe("dev-engine-shared-secret-change-me");
    expect(config.betterAuthSecret).toBe("dev-better-auth-secret-change-me");
    expect(config.betterAuthUrl).toBe("http://localhost:4000");
    expect(config.githubClientId).toBe("dev-github-client-id");
    expect(config.githubClientSecret).toBe("dev-github-client-secret");
    expect(config.vaultMasterKey).toBe("b3Vyb2Jvcm9zLWRldi12YXVsdC1tYXN0ZXIta2V5ISE=");
    expect(config.corsOrigins).toEqual(["http://localhost:3000"]);
    expect(config.dashboardPollSeconds).toBe(15);
  });

  it("reassembles the whole configuration it was registered with", () => {
    expect(config.all).toEqual(testConfiguration());
  });

  it("redacts the secrets when asked to describe itself", () => {
    const described = config.describe();

    expect(described).toContain(`BETTER_AUTH_SECRET=${REDACTED}`);
    expect(described).not.toContain("dev-better-auth-secret-change-me");

    // #222's redaction criterion at the boot log, which is the one log sink that prints
    // configuration by design. The KEK is the value here whose exposure is not undone by
    // rotating it: a copy of this line beside a copy of `tenant_keys` is every credential
    // the product holds.
    expect(described).toContain(`OURO_VAULT_MASTER_KEY=${REDACTED}`);
    expect(described).not.toContain("b3Vyb2Jvcm9zLWRldi12YXVsdC1tYXN0ZXIta2V5ISE=");
  });

  describe("the derived answers", () => {
    it("says this is not production, and binds loopback", () => {
      expect(config.isProduction).toBe(false);
      expect(config.listenHost).toBe(LOOPBACK_HOST);
    });

    it("says this is production, and binds every interface", async () => {
      const production = await moduleWith(testConfiguration({ NODE_ENV: "production" }));
      const productionConfig = production.get(AppConfigService);

      expect(productionConfig.isProduction).toBe(true);
      expect(productionConfig.listenHost).toBe(ALL_INTERFACES_HOST);

      await production.close();
    });
  });
});

describe("the registered store", () => {
  it("serves the validated values and nothing else", async () => {
    // The service under test is what a consumer uses; this is the guarantee underneath
    // it. skipProcessEnv is what stops a key the configuration does not carry from
    // falling through to an unvalidated environment variable.
    process.env.OURO_CONFIG_MODULE_PROBE = "leaked";

    const app = await moduleWith();
    const store = app.get<ConfigService<Configuration, true>>(ConfigService);

    try {
      expect(store.get("port", { infer: true })).toBe(4000);
      expect(store.get("OURO_CONFIG_MODULE_PROBE" as never)).toBeUndefined();
    } finally {
      delete process.env.OURO_CONFIG_MODULE_PROBE;
      await app.close();
    }
  });
});

describe("the module", () => {
  /** A provider in an unrelated module, injecting configuration without importing it. */
  @Injectable()
  class Consumer {
    constructor(readonly config: AppConfigService) {}
  }

  @Module({ providers: [Consumer] })
  class ConsumerModule {}

  it("is global, so a feature module reads configuration without importing it", async () => {
    const app = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), ConsumerModule],
    }).compile();

    expect(app.get(Consumer).config.port).toBe(4000);

    await app.close();
  });
});
