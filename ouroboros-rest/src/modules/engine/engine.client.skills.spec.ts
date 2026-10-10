/**
 * `EngineClient.runSkill()` — skill execution (#624): the run in the engine's spelling, the
 * validated result in this service's names, the two refusals answered, everything else
 * `engine_unavailable`.
 */

import { Logger } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { testConfiguration } from "../config/configuration.fixture";
import { EngineClient } from "./engine.client";
import { ENGINE_ERRORS } from "./engine.errors";
import { alwaysAnswering, type FakeFetch } from "./engine.fixture";
import { skillRunRequestBody, type EngineSkillRunRequest } from "./engine.skills";

const ENGINE_URL = "http://engine-7f4c.svc.cluster.local:8000";
const DOC = "5eed0097-0000-4000-8000-000000000124";

const REQUEST: EngineSkillRunRequest = {
  run: DOC,
  skill: { slug: "create-roadmap", version: 3, body: "Turn the brief into a roadmap." },
  output: "roadmap",
  input: { brief: "# RS-124", suggestions: [] },
  alias: "research",
  resolutionVersion: "r1",
  costCapCents: 400,
};

const RESULT = {
  skill: "create-roadmap",
  version: 3,
  output: "roadmap",
  roadmap: {
    title: "Helios — Q4 Improvement Roadmap",
    milestones: [
      {
        key: "m1",
        name: "Docking parity",
        target_date: "2026-10-15",
        items: [{ key: "dock-mpc", title: "Wind-feedforward MPC", mvp: true, effort: "l" }],
      },
    ],
  },
  issues: null,
  attempts: 1,
  usage: [
    {
      hop: 0,
      connection: "anthropic-main",
      model: "claude-fable-5",
      input_tokens: 1200,
      output_tokens: 300,
      cost_cents: 1.5,
    },
  ],
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

describe("the engine client's skill run", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  it("posts the run in the engine's spelling and reads the roadmap in this service's", async () => {
    const engine = alwaysAnswering(() => json(200, RESULT));

    const answer = await clientWith(engine).runSkill(REQUEST);

    expect(answer).toEqual({
      ok: true,
      data: {
        skill: "create-roadmap",
        version: 3,
        output: "roadmap",
        roadmap: {
          title: "Helios — Q4 Improvement Roadmap",
          milestones: [
            {
              key: "m1",
              name: "Docking parity",
              targetDate: "2026-10-15",
              items: [{ key: "dock-mpc", title: "Wind-feedforward MPC", mvp: true, effort: "l" }],
            },
          ],
        },
        issues: null,
        attempts: 1,
        usage: [
          {
            hop: 0,
            connection: "anthropic-main",
            model: "claude-fable-5",
            inputTokens: 1200,
            outputTokens: 300,
            costCents: 1.5,
          },
        ],
      },
    });
    expect(engine.calls[0]?.url).toBe(`${ENGINE_URL}/v0/skills/run`);
    expect(engine.calls[0]?.method).toBe("POST");
    expect(JSON.parse(engine.calls[0]?.body ?? "{}")).toEqual({
      run: DOC,
      skill: REQUEST.skill,
      output: "roadmap",
      input: REQUEST.input,
      alias: "research",
      resolution_version: "r1",
      cost_cap_cents: 400,
    });
  });

  it("reads issue bodies", async () => {
    const engine = alwaysAnswering(() =>
      json(200, {
        ...RESULT,
        skill: "create-issues",
        output: "issue_bodies",
        roadmap: null,
        issues: [{ key: "dock-mpc", body: "## Problem" }],
      }),
    );

    const answer = await clientWith(engine).runSkill({ ...REQUEST, output: "issue_bodies" });

    expect(answer.ok && answer.data.issues).toEqual([{ key: "dock-mpc", body: "## Problem" }]);
  });

  it("answers a failed model call with the gateway's reason", async () => {
    const engine = alwaysAnswering(() =>
      json(502, {
        code: "skill_model_failed",
        message: "The invocation gateway is not available.",
        details: { reason: "gateway_unavailable" },
      }),
    );

    await expect(clientWith(engine).runSkill(REQUEST)).resolves.toEqual({
      ok: false,
      refusal: {
        code: "skill_model_failed",
        message: "The invocation gateway is not available.",
        reason: "gateway_unavailable",
      },
    });
  });

  it("answers an answer outside the contract with what was wrong", async () => {
    const engine = alwaysAnswering(() =>
      json(422, {
        code: "skill_output_invalid",
        message: "The model did not answer in the shape the skill's output requires.",
        details: { problem: "the answer holds no JSON object" },
      }),
    );

    const answer = await clientWith(engine).runSkill(REQUEST);

    expect(answer).toMatchObject({
      ok: false,
      refusal: { code: "skill_output_invalid", reason: "the answer holds no JSON object" },
    });
  });

  it("answers a refusal without details with a null reason", async () => {
    const engine = alwaysAnswering(() => json(502, { code: "skill_model_failed", message: "No." }));

    const answer = await clientWith(engine).runSkill(REQUEST);

    expect(answer).toEqual({
      ok: false,
      refusal: { code: "skill_model_failed", message: "No.", reason: null },
    });
  });

  it.each([
    ["a refused key", () => json(401, { code: "unauthorized", message: "no", details: {} })],
    [
      "a refusal that is not a skill's",
      () => json(422, { code: "validation_failed", message: "x" }),
    ],
    ["a server error with no envelope", () => new Response("oops", { status: 500 })],
    ["a result outside the contract", () => json(200, { ...RESULT, attempts: "one" })],
    ["a body that is not JSON", () => new Response("<html>", { status: 200 })],
  ])("answers engine_unavailable for %s", async (_name, respond) => {
    await expect(clientWith(alwaysAnswering(respond)).runSkill(REQUEST)).rejects.toMatchObject({
      code: ENGINE_ERRORS.unavailable,
    });
  });

  it("spells an absent resolution and cap as nulls", () => {
    expect(
      skillRunRequestBody({ ...REQUEST, resolutionVersion: null, costCapCents: null }),
    ).toMatchObject({ resolution_version: null, cost_cap_cents: null });
  });
});
