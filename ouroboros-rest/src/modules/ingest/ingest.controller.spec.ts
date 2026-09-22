import { Reflector } from "@nestjs/core";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { isAnonymous } from "../auth/anonymous";
import { isInternalOnly } from "../internal/internal.decorators";
import { isInternalPath } from "../internal/internal.paths";
import { IngestController } from "./ingest.controller";
import type { IngestService } from "./ingest.service";

/**
 * The six routes, and the four decorators that classify them.
 *
 * The handlers are one line each, so what is worth asserting is not that they delegate — it
 * is the **classification**, because getting it wrong produces an internal endpoint a
 * stranger can reach and every other suite stays green. Three of the four decorators are
 * read here through the same predicates the guards read them through, so this cannot pass by
 * agreeing with a copy of the rule.
 *
 * The fourth — `@CallingPrincipal()` — is asserted by its effect instead: opening a run is
 * the one operation whose answer depends on who asked, and the service is handed a boolean
 * the request never carried.
 */

/** A service that records what it was handed. */
function stubService() {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return Promise.resolve({ recorded: method });
    };

  return {
    calls,
    service: {
      openRun: record("openRun"),
      transitionStage: record("transitionStage"),
      appendEvents: record("appendEvents"),
      reportFiles: record("reportFiles"),
      reportCommits: record("reportCommits"),
      reportResources: record("reportResources"),
    } as unknown as IngestService,
  };
}

/** An execution context whose handler and class are the ones being asked about. */
function contextFor(handler: (...args: never[]) => unknown) {
  return {
    getHandler: () => handler,
    getClass: () => IngestController,
  } as never;
}

describe("the classification", () => {
  const reflector = new Reflector();

  it("is internal, which is how the guard and the route table both find it", () => {
    // `@InternalOnly()` is on the controller, so a route added beside an existing one
    // inherits it rather than having to remember.
    expect(isInternalOnly(reflector, contextFor(IngestController.prototype.openRun))).toBe(true);
  });

  it("is anonymous, which is *no session* and not *no authentication*", () => {
    // The caller is a worker holding no cookie. Without this the global session guard would
    // refuse before the internal guard ever ran, and the answer would be "sign in to
    // continue" — advice a worker cannot take.
    expect(isAnonymous(reflector, contextFor(IngestController.prototype.appendEvents))).toBe(true);
    expect(AllowAnonymous).toBeDefined();
  });

  it("answers at the origin root, outside the versioned surface", () => {
    const base = Reflect.getMetadata("path", IngestController) as string;

    expect(base).toBe("internal/runs");
    expect(isInternalPath(base)).toBe(true);
  });
});

describe("the handlers", () => {
  it("hands the service the run from the path and the body from the request", async () => {
    const { calls, service } = stubService();
    const controller = new IngestController(service);
    const run = "5eed0009-0000-4000-8000-000000000482";

    await controller.transitionStage({ id: run }, { idempotencyKey: "k" } as never);
    await controller.appendEvents({ id: run }, { idempotencyKey: "k" } as never);
    await controller.reportFiles({ id: run }, { idempotencyKey: "k" } as never);
    await controller.reportCommits({ id: run }, { idempotencyKey: "k" } as never);
    await controller.reportResources({ id: run }, { idempotencyKey: "k" });

    expect(calls.map((call) => call.method)).toEqual([
      "transitionStage",
      "appendEvents",
      "reportFiles",
      "reportCommits",
      "reportResources",
    ]);

    for (const call of calls) {
      expect(call.args[0]).toBe(run);
    }
  });

  it("turns the principal into the watermark, and passes nothing else about the caller", async () => {
    // Decision R4, at the one point where it is decided. The service is handed a boolean the
    // request never carried, and the request shape has nowhere to carry one.
    const { calls, service } = stubService();
    const controller = new IngestController(service);
    const body = { idempotencyKey: "k" } as never;

    await controller.openRun("simulator", body);
    await controller.openRun("executor", body);

    expect(calls[0].args).toEqual([body, true]);
    expect(calls[1].args).toEqual([body, false]);
  });
});
