import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";

import type { Principal } from "../../auth/principal";
import { HUMAN_ONLY } from "../../auth/service.scopes";
import { ConfigurationModule } from "../../config/config.module";
import { testConfiguration } from "../../config/configuration.fixture";
import type { Organization } from "../../db/schema";
import type { DecisionSourceWatcher } from "../../decisions/decision.watchers";
import { INTERNAL_ONLY } from "../../internal/internal.decorators";
import { REQUIRED_ROLES } from "../../tenancy/roles.guard";
import { RegressionWatchChain } from "./watch.chain";
import { RegressionWatchController } from "./watch.controller";
import { HOVER, REPO, callArg } from "./watch.fixture";
import { RegressionWatchInternalController } from "./watch.internal.controller";
import { RegressionWatchModule } from "./watch.module";
import { WatchRepository } from "./watch.repository";
import { RegressionWatchScheduler } from "./watch.scheduler";
import type { RegressionWatchService } from "./watch.service";
import { RegressionWatchService as Service } from "./watch.service";

/**
 * The watch's routes and wiring (CM.4, #623): what each route is, who may call it, and what it
 * hands the service.
 */

const TENANT = { id: "org-acme" } as Organization;
const PRINCIPAL = { user: { id: "user-ken" } } as Principal;
const ITEM = "17e00000-0000-4000-8000-000000000001";

const handler = (type: { prototype: object }, name: string): object =>
  Object.getOwnPropertyDescriptor(type.prototype, name)!.value as object;
const meta = (key: string, type: { prototype: object }, name: string): unknown =>
  Reflect.getMetadata(key, handler(type, name));

function service() {
  return {
    card: jest.fn().mockResolvedValue("card"),
    settings: jest.fn().mockResolvedValue("settings"),
    saveSettings: jest.fn().mockResolvedValue("saved"),
    capture: jest.fn().mockResolvedValue("captured"),
    compare: jest.fn().mockResolvedValue("compared"),
    dismiss: jest.fn().mockResolvedValue("dismissed"),
    released: jest.fn().mockResolvedValue({ workspaces: 2, captured: 3 }),
  };
}

const ROUTES = ["card", "settings", "saveSettings", "capture", "compare", "dismiss"];

describe("the regression watch controller", () => {
  const controller = (watch: ReturnType<typeof service>) =>
    new RegressionWatchController(watch as unknown as RegressionWatchService);

  it("serves six routes under /research/regression-watch", () => {
    expect(Reflect.getMetadata(PATH_METADATA, RegressionWatchController)).toBe(
      "research/regression-watch",
    );
    expect(
      ROUTES.map((name) => [
        meta(METHOD_METADATA, RegressionWatchController, name),
        meta(PATH_METADATA, RegressionWatchController, name),
      ]),
    ).toEqual([
      [RequestMethod.GET, "/"],
      [RequestMethod.GET, "settings"],
      [RequestMethod.PUT, "settings"],
      [RequestMethod.POST, "baselines"],
      [RequestMethod.POST, "comparisons"],
      [RequestMethod.POST, "items/:itemId/dismiss"],
    ]);
  });

  it("lets every member read, and only an owner or admin — a person — change anything", () => {
    for (const name of ["card", "settings"]) {
      expect(meta(REQUIRED_ROLES, RegressionWatchController, name)).toBeUndefined();
      expect(meta(HUMAN_ONLY, RegressionWatchController, name)).toBeUndefined();
    }
    for (const name of ["saveSettings", "capture", "compare", "dismiss"]) {
      expect(meta(REQUIRED_ROLES, RegressionWatchController, name)).toEqual(["owner", "admin"]);
      expect(meta(HUMAN_ONLY, RegressionWatchController, name)).toBe(true);
    }
  });

  it("answers a capture 201 and a comparison or a dismissal 200", () => {
    expect(meta(HTTP_CODE_METADATA, RegressionWatchController, "capture")).toBeUndefined();
    expect(meta(HTTP_CODE_METADATA, RegressionWatchController, "compare")).toBe(HttpStatus.OK);
    expect(meta(HTTP_CODE_METADATA, RegressionWatchController, "dismiss")).toBe(HttpStatus.OK);
  });

  it("hands each route's request to the service, in the session's workspace", async () => {
    const watch = service();
    const routes = controller(watch);

    expect(await routes.card(TENANT)).toBe("card");
    expect(await routes.settings(TENANT)).toBe("settings");
    expect(await routes.saveSettings(TENANT, PRINCIPAL, { autoFile: true })).toBe("saved");
    expect(
      await routes.capture(TENANT, PRINCIPAL, { repository: REPO, releaseTag: "v2.0.4" }),
    ).toBe("captured");
    expect(await routes.compare(TENANT)).toBe("compared");
    expect(await routes.dismiss(TENANT, PRINCIPAL, { itemId: ITEM }, { reason: "No." })).toBe(
      "dismissed",
    );

    expect(watch.card).toHaveBeenCalledWith("org-acme");
    expect(watch.settings).toHaveBeenCalledWith("org-acme");
    expect(watch.saveSettings).toHaveBeenCalledWith("org-acme", "user-ken", { autoFile: true });
    expect(watch.capture).toHaveBeenCalledWith("org-acme", {
      repository: REPO,
      releaseTag: "v2.0.4",
      via: "manual",
      userId: "user-ken",
    });
    expect(watch.compare).toHaveBeenCalledWith("org-acme");
    expect(watch.dismiss).toHaveBeenCalledWith("org-acme", "user-ken", ITEM, "No.");
  });

  it("stores a saved metric in the database's own shape", async () => {
    const watch = service();

    await controller(watch).saveSettings(TENANT, PRINCIPAL, {
      metrics: [{ repository: REPO, source: "case_metric", key: HOVER, class: "accuracy" }],
    });

    expect(callArg(watch.saveSettings, 0, 2)).toEqual({
      metrics: [
        {
          repo: REPO,
          source: "case_metric",
          key: HOVER,
          class: "accuracy",
          window_days: 7,
          replay: null,
          nightly_ref: "HEAD",
        },
      ],
    });
  });
});

describe("the release announcement", () => {
  it("is an internal-only POST that names no workspace", async () => {
    expect(Reflect.getMetadata(PATH_METADATA, RegressionWatchInternalController)).toBe(
      "internal/research/regression-watch",
    );
    expect(Reflect.getMetadata(INTERNAL_ONLY, RegressionWatchInternalController)).toBe(true);
    expect(meta(METHOD_METADATA, RegressionWatchInternalController, "released")).toBe(
      RequestMethod.POST,
    );
    expect(meta(PATH_METADATA, RegressionWatchInternalController, "released")).toBe("releases");
    expect(meta(HTTP_CODE_METADATA, RegressionWatchInternalController, "released")).toBe(
      HttpStatus.OK,
    );

    const watch = service();
    const answered = await new RegressionWatchInternalController(
      watch as unknown as RegressionWatchService,
    ).released({
      repository: REPO,
      releaseTag: "v2.0.4",
    });

    expect(watch.released).toHaveBeenCalledWith(REPO, "v2.0.4");
    expect(answered).toEqual({
      repository: REPO,
      releaseTag: "v2.0.4",
      workspaces: 2,
      captured: 3,
    });
  });
});

describe("the regression watch module", () => {
  it("compiles and resolves every layer", async () => {
    // Nothing connects: `pg` connects lazily, and the module is never initialised here.
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), RegressionWatchModule],
    }).compile();

    expect(moduleRef.get(RegressionWatchController)).toBeInstanceOf(RegressionWatchController);
    expect(moduleRef.get(RegressionWatchInternalController)).toBeInstanceOf(
      RegressionWatchInternalController,
    );
    expect(moduleRef.get(Service)).toBeInstanceOf(Service);
    expect(moduleRef.get(RegressionWatchChain)).toBeInstanceOf(RegressionWatchChain);
    expect(moduleRef.get(WatchRepository)).toBeInstanceOf(WatchRepository);
    expect(moduleRef.get(RegressionWatchScheduler)).toBeInstanceOf(RegressionWatchScheduler);

    await moduleRef.close();
  });

  it("registers its inbox detector while it lives, and unregisters it after", () => {
    const stop = jest.fn();
    const register = jest.fn().mockReturnValue(stop);
    const module = new RegressionWatchModule({ register } as unknown as DecisionSourceWatcher);

    module.onModuleInit();
    expect(register).toHaveBeenCalledTimes(1);
    expect(callArg(register, 0, 0)).toMatchObject({ name: "watch-moved-on" });

    module.onModuleDestroy();
    module.onModuleDestroy();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("exports the service the inbox's Dismiss drift action calls", () => {
    expect(Reflect.getMetadata("exports", RegressionWatchModule)).toEqual([Service]);
  });
});
