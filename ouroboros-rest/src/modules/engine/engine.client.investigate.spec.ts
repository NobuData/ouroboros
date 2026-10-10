/**
 * `EngineClient.investigate()` — the investigation loop's submit (#620): the request in the
 * engine's spelling, the `202` parsed into this service's names, everything else
 * `engine_unavailable`.
 */

import { Logger } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { testConfiguration } from "../config/configuration.fixture";
import { EngineClient } from "./engine.client";
import { ENGINE_ERRORS } from "./engine.errors";
import { alwaysAnswering, type FakeFetch } from "./engine.fixture";
import type { EngineInvestigateRequest } from "./engine.investigate";

const ENGINE_URL = "http://engine-7f4c.svc.cluster.local:8000";
const INVESTIGATION = "5eed0091-0000-4000-8000-000000000127";

const REQUEST: EngineInvestigateRequest = {
  investigation: INVESTIGATION,
  kind: {
    slug: "gap_analysis",
    playbook: {
      version: 1,
      default_tools: ["web", "code"],
      synthesis_template: "gap_analysis@1",
      deliverables: ["brief", "matrix"],
    },
  },
  question: "Why do rivals dock reliably in wind and we do not?",
  tools: [{ slug: "web", operations: ["search", "fetch"], description: "Web search & reader" }],
  depth: "deep_dive",
  budget: { operations: 40, sources: 60, spendCents: 1031 },
  alias: "researcher-long-ctx",
  planAlias: null,
  resolutionVersion: "r1",
};

const ACCEPTED = {
  investigation: INVESTIGATION,
  task: `investigate:${INVESTIGATION}`,
  state: "accepted",
  loop_version: "loop-v1",
};

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

describe("the engine client's investigate call", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  it("posts the investigation in the engine's spelling and reads the 202", async () => {
    const engine = alwaysAnswering(() => json(202, ACCEPTED));

    const accepted = await clientWith(engine).investigate(REQUEST);

    expect(accepted).toEqual({
      investigation: INVESTIGATION,
      task: `investigate:${INVESTIGATION}`,
      state: "accepted",
      loopVersion: "loop-v1",
    });
    expect(engine.calls[0]?.url).toBe(`${ENGINE_URL}/v0/investigate`);
    expect(engine.calls[0]?.method).toBe("POST");
    expect(JSON.parse(engine.calls[0]?.body ?? "{}")).toEqual({
      investigation: INVESTIGATION,
      kind: REQUEST.kind,
      question: REQUEST.question,
      tools: REQUEST.tools,
      depth: "deep_dive",
      budget: { operations: 40, sources: 60, spend_cents: 1031 },
      alias: "researcher-long-ctx",
      plan_alias: null,
      resolution_version: "r1",
    });
  });

  it("reads a repeated submit as already running", async () => {
    const engine = alwaysAnswering(() => json(202, { ...ACCEPTED, state: "already_running" }));
    expect((await clientWith(engine).investigate(REQUEST)).state).toBe("already_running");
  });

  it.each([
    [
      "a busy engine",
      () => json(503, { code: "investigation_capacity", message: "busy", details: {} }),
    ],
    [
      "a refused playbook",
      () => json(422, { code: "investigation_playbook_unsupported", message: "no", details: {} }),
    ],
    ["an answer outside the contract", () => json(202, { ...ACCEPTED, state: "queued" })],
    ["an answer with no task", () => json(202, { ...ACCEPTED, task: "" })],
  ])("answers engine_unavailable for %s", async (_name, respond) => {
    await expect(clientWith(alwaysAnswering(respond)).investigate(REQUEST)).rejects.toMatchObject({
      code: ENGINE_ERRORS.unavailable,
    });
  });
});
