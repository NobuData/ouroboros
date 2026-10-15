/**
 * `EngineClient.executeRun()` and `claimWork()` — the run supervisor's two calls (#160): the
 * routes and bodies in the engine's spelling, the answers parsed into this service's names, a
 * decline read as an answer rather than a failure, and everything else `engine_unavailable`.
 */

import { Logger } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { testConfiguration } from "../config/configuration.fixture";
import { EngineClient } from "./engine.client";
import { ENGINE_ERRORS } from "./engine.errors";
import { alwaysAnswering, type FakeFetch } from "./engine.fixture";

const ENGINE_URL = "http://engine-7f4c.svc.cluster.local:8000";
const RUN = "5eed0009-0000-4000-8000-000000000482";
const WORKSPACE = "acme-robotics-id";

function clientWith(fetchImpl: FakeFetch): EngineClient {
  const configuration = testConfiguration({
    OURO_ENGINE_URL: ENGINE_URL,
    OURO_ENGINE_SHARED_SECRET: "a-shared-secret-nobody-should-see",
  });
  const config = new AppConfigService({
    get: (key: string) => configuration[key as keyof typeof configuration],
    getOrThrow: (key: string) => configuration[key as keyof typeof configuration],
  } as never);
  return new EngineClient(config, fetchImpl);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("the engine client's execution calls (#160)", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("executeRun", () => {
    it("posts an empty body to the run's execute route and reads the 202", async () => {
      const engine = alwaysAnswering(() => json(202, { accepted: true, reason: null }));

      await expect(clientWith(engine).executeRun(RUN)).resolves.toEqual({
        accepted: true,
        reason: null,
      });
      expect(engine.calls[0]?.url).toBe(`${ENGINE_URL}/v0/runs/${RUN}/execute`);
      expect(engine.calls[0]?.method).toBe("POST");
      expect(engine.calls[0]?.body ?? "").toBe("");
    });

    it("reads a decline as an answer", async () => {
      const engine = alwaysAnswering(() => json(202, { accepted: false, reason: "no_executor" }));

      await expect(clientWith(engine).executeRun(RUN)).resolves.toEqual({
        accepted: false,
        reason: "no_executor",
      });
    });

    it.each([
      ["a refusal", () => json(500, { code: "boom", message: "no", details: {} })],
      ["an answer outside the contract", () => json(202, { accepted: "yes" })],
    ])("answers engine_unavailable for %s", async (_name, respond) => {
      await expect(clientWith(alwaysAnswering(respond)).executeRun(RUN)).rejects.toMatchObject({
        code: ENGINE_ERRORS.unavailable,
      });
    });
  });

  describe("claimWork", () => {
    it("posts the workspace and reads the run it opened", async () => {
      const engine = alwaysAnswering(() => json(200, { claimed: true, run_id: RUN, reason: null }));

      await expect(clientWith(engine).claimWork(WORKSPACE)).resolves.toEqual({
        claimed: true,
        runId: RUN,
        reason: null,
      });
      expect(engine.calls[0]?.url).toBe(`${ENGINE_URL}/v0/execution/claims`);
      expect(engine.calls[0]?.method).toBe("POST");
      expect(JSON.parse(engine.calls[0]?.body ?? "{}")).toEqual({ workspace: WORKSPACE });
    });

    it("reads nothing claimed as an answer", async () => {
      const engine = alwaysAnswering(() =>
        json(200, { claimed: false, run_id: null, reason: "nothing_queued" }),
      );

      await expect(clientWith(engine).claimWork(WORKSPACE)).resolves.toEqual({
        claimed: false,
        runId: null,
        reason: "nothing_queued",
      });
    });

    it.each([
      ["a refusal", () => json(503, { code: "busy", message: "no", details: {} })],
      ["an answer outside the contract", () => json(200, { claimed: true })],
    ])("answers engine_unavailable for %s", async (_name, respond) => {
      await expect(clientWith(alwaysAnswering(respond)).claimWork(WORKSPACE)).rejects.toMatchObject(
        { code: ENGINE_ERRORS.unavailable },
      );
    });
  });
});
