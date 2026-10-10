import type { EngineClient } from "../../engine/engine.client";
import { NotFoundError } from "../../errors/error.envelope";
import type { ResolutionService } from "../../routing/resolution.service";
import { ROUTING_ERRORS } from "../../routing/routing.errors";
import { PIPELINE_ERRORS } from "./pipeline.errors";
import { ORG, roadmapRun, rs124Roadmap } from "./pipeline.fixture";
import type { PipelineSkillRegistry } from "./pipeline.skill-registry";
import { PipelineSkillRunner, RESEARCH_TASK_KIND } from "./pipeline.skill-runner";

const SKILL = {
  slug: "create-roadmap" as const,
  version: 4,
  body: "# create-roadmap\nThe workspace's own.",
};
const REQUEST = {
  slug: "create-roadmap" as const,
  output: "roadmap" as const,
  input: { brief: "# RS-124" },
  run: "doc-1",
};

function resolved() {
  return {
    outcome: "resolved",
    resolutionVersion: "r7",
    chain: [
      { alias: "dropped-first", decision: "dropped" },
      { alias: "researcher-long-ctx", decision: "kept" },
    ],
  };
}

function bench() {
  const resolveSkill = jest.fn().mockResolvedValue(SKILL);
  const resolve = jest.fn().mockResolvedValue(resolved());
  const runSkill = jest.fn().mockResolvedValue({ ok: true, data: roadmapRun(rs124Roadmap()) });
  const runner = new PipelineSkillRunner(
    { resolve: resolveSkill } as unknown as PipelineSkillRegistry,
    { resolve } as unknown as ResolutionService,
    { runSkill } as unknown as EngineClient,
  );

  return { runner, resolveSkill, resolve, runSkill };
}

describe("running a pipeline skill", () => {
  it("sends the workspace's version of the skill under the alias research is routed to", async () => {
    const { runner, resolve, runSkill } = bench();
    const run = await runner.run(ORG, REQUEST);

    expect(resolve).toHaveBeenCalledWith(ORG, RESEARCH_TASK_KIND, {});
    expect(runSkill).toHaveBeenCalledWith({
      run: "doc-1",
      skill: { slug: "create-roadmap", version: 4, body: SKILL.body },
      output: "roadmap",
      input: { brief: "# RS-124" },
      alias: "researcher-long-ctx",
      resolutionVersion: "r7",
      costCapCents: null,
    });
    expect(run.skill).toEqual(SKILL);
    expect(run.result.roadmap?.title).toBe("Helios — Q4 Improvement Roadmap");
  });

  it("answers the version a workspace would run now", async () => {
    const { runner, resolveSkill } = bench();

    expect(await runner.current(ORG, "create-roadmap")).toEqual(SKILL);
    expect(resolveSkill).toHaveBeenCalledWith(ORG, "create-roadmap");
  });

  it.each([
    [
      "no route for research",
      () => Promise.reject(new NotFoundError(ROUTING_ERRORS.routeNotFound, "none")),
    ],
    ["a resolution that refuses to run", () => Promise.resolve({ outcome: "fail_run", chain: [] })],
    [
      "a resolution that keeps no hop",
      () => Promise.resolve({ outcome: "resolved", chain: [{ alias: "x", decision: "dropped" }] }),
    ],
  ])("refuses to run with %s, calling no engine", async (_name, answer) => {
    const { runner, resolve, runSkill } = bench();

    resolve.mockImplementation(answer);

    await expect(runner.run(ORG, REQUEST)).rejects.toMatchObject({
      code: PIPELINE_ERRORS.noResearcher,
    });
    expect(runSkill).not.toHaveBeenCalled();
  });

  it("does not hide a routing failure that is not a missing route", async () => {
    const { runner, resolve } = bench();

    resolve.mockRejectedValue(new Error("the database went away"));

    await expect(runner.run(ORG, REQUEST)).rejects.toThrow("the database went away");
  });

  it.each([
    [
      "the gateway's reason",
      {
        code: "skill_model_failed",
        message: "The gateway is not available.",
        reason: "gateway_unavailable",
      },
      "gateway_unavailable",
    ],
    [
      "the refusal's own code when no reason was given",
      { code: "skill_output_invalid", message: "No.", reason: null },
      "skill_output_invalid",
    ],
  ])("turns an engine refusal into this plane's, carrying %s", async (_name, refusal, reason) => {
    const { runner, runSkill } = bench();

    runSkill.mockResolvedValue({ ok: false, refusal });

    await expect(runner.run(ORG, REQUEST)).rejects.toMatchObject({
      code: PIPELINE_ERRORS.skillFailed,
      details: { slug: "create-roadmap", reason },
    });
  });

  it("lets an unreachable engine through as it is", async () => {
    const { runner, runSkill } = bench();
    const unavailable = Object.assign(new Error("engine"), { code: "engine_unavailable" });

    runSkill.mockRejectedValue(unavailable);

    await expect(runner.run(ORG, REQUEST)).rejects.toBe(unavailable);
  });
});
