/**
 * `ContextAssemblyService` over an in-memory world
 * ([#414](https://github.com/NobuData/ouroboros/issues/414)) — the scope it reads, the refusals
 * it names, the injection records it writes, and the usage numbers those records reproduce.
 */

import { usedBy, type InjectedRun } from "../skills/skills.usage";
import {
  HELIOS,
  OTHER_WORKSPACE,
  STANDARD_FIX,
  STANDARD_FIX_ID,
  WORKSPACE,
  fact,
  repoSkill,
  skill,
  uuid,
  workflowSkill,
} from "./context-assembly.fixture";
import { CONTEXT_ASSEMBLY_ERRORS } from "./context-assembly.errors";
import { ContextAssemblyService, fitsConsumer, injectionOf } from "./context-assembly.service";
import type { ContextConsumer } from "./context-assembly.resources";
import { AssemblyWorld } from "./context-assembly.store.fixture";

/** A service over a fresh world, and the world. */
function build() {
  const world = new AssemblyWorld();

  return { world, service: new ContextAssemblyService(world.store()) };
}

/**
 * The error code a rejected call produced, read off the envelope.
 *
 * @param promise - The call.
 * @returns The envelope's code.
 */
async function refusal(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return (error as { getResponse?: () => unknown }).getResponse?.();
  }
  return undefined;
}

describe("assembling", () => {
  it("reads the scope's workflow within the workspace", async () => {
    const { world, service } = build();
    world.workspace(WORKSPACE).workflows.set(STANDARD_FIX, STANDARD_FIX_ID);
    world.workspace(WORKSPACE).skills.push(workflowSkill({ slug: "wf-only" }));

    const manifest = await service.assemble(
      WORKSPACE,
      { repo: HELIOS, workflow: STANDARD_FIX },
      "run_stage",
    );

    expect(manifest.skillVersions.map((entry) => entry.slug)).toEqual(["wf-only"]);
    expect(manifest.scope).toEqual({ repo: HELIOS, workflow: STANDARD_FIX });
  });

  it("answers 404 for a workflow this workspace does not have — another's included", async () => {
    const { world, service } = build();
    world.workspace(OTHER_WORKSPACE).workflows.set(STANDARD_FIX, STANDARD_FIX_ID);

    expect(
      await refusal(service.assemble(WORKSPACE, { workflow: STANDARD_FIX }, "run_stage")),
    ).toMatchObject({ code: CONTEXT_ASSEMBLY_ERRORS.workflowNotFound });
  });

  it("answers 422 when a skill is both enabled and disabled", async () => {
    const { service } = build();
    const id = uuid(1);

    expect(
      await refusal(
        service.assemble(WORKSPACE, {}, "run_stage", {
          overrides: { enable: [id], disable: [id] },
        }),
      ),
    ).toMatchObject({ code: CONTEXT_ASSEMBLY_ERRORS.overridesOverlap });
  });

  it("grants a lower budget and never a higher one", async () => {
    const { service } = build();

    expect(
      (await service.assemble(WORKSPACE, {}, "run_stage", { budgetTokens: 500 })).budgetTokens,
    ).toBe(500);
    expect(
      (await service.assemble(WORKSPACE, {}, "estimator", { budgetTokens: 99_999 })).budgetTokens,
    ).toBe(8_000);
  });

  it("never reads a draft skill or an unconfirmed fact, even when the store holds them", async () => {
    const { world, service } = build();
    world.workspace(WORKSPACE).skills.push(skill({ slug: "draft", draft: true }));
    world
      .workspace(WORKSPACE)
      .facts.push(fact({ status: "proposed" }), fact({ status: "expired" }));

    const manifest = await service.assemble(WORKSPACE, { repo: HELIOS }, "run_stage");

    expect(manifest.skillVersions).toEqual([]);
    expect(manifest.facts).toEqual([]);
  });
});

describe("cross-tenant isolation", () => {
  it("includes no other workspace's knowledge, however alike it is", async () => {
    const { world, service } = build();
    const theirs = repoSkill({ slug: "zephyr-conventions", name: "Zephyr", required: true });
    world.workspace(OTHER_WORKSPACE).skills.push(theirs, skill({ slug: "commit-style" }));
    world.workspace(OTHER_WORKSPACE).facts.push(fact({ repoRef: HELIOS }), fact());
    world.workspace(WORKSPACE).skills.push(repoSkill({ slug: "ours", name: "Zephyr" }));

    const manifest = await service.assemble(WORKSPACE, { repo: HELIOS }, "run_stage", {
      overrides: { enable: [theirs.id], disable: [] },
    });

    expect(manifest.skillVersions.map((entry) => entry.slug)).toEqual(["ours"]);
    expect(manifest.facts).toEqual([]);
    expect(manifest.refusedOverrides).toEqual([
      { skillId: theirs.id, action: "enable", reason: "not_resolved" },
    ]);
  });

  it("refuses to record another workspace's facts, skill versions or estimate", async () => {
    const { world, service } = build();
    const theirFact = fact();
    const theirSkill = skill({ slug: "theirs" });
    const theirEstimate = uuid(7, "5eed0026");
    world.workspace(OTHER_WORKSPACE).facts.push(theirFact);
    world.workspace(OTHER_WORKSPACE).skills.push(theirSkill);
    world.workspace(OTHER_WORKSPACE).estimates.add(theirEstimate);
    const ours = uuid(8, "5eed0026");
    world.workspace(WORKSPACE).estimates.add(ours);
    const hash = "b".repeat(64);

    for (const injection of [
      { estimateId: ours, factIds: [theirFact.id], skillVersionIds: [] },
      { estimateId: ours, factIds: [], skillVersionIds: [theirSkill.versionId ?? ""] },
      { estimateId: theirEstimate, factIds: [], skillVersionIds: [] },
    ]) {
      expect(
        await refusal(
          service.record(WORKSPACE, { consumer: "estimator", manifestHash: hash, ...injection }),
        ),
      ).toMatchObject({ code: CONTEXT_ASSEMBLY_ERRORS.unresolved });
    }
    expect(world.injections).toEqual([]);
  });
});

describe("recording an injection", () => {
  const ESTIMATE = uuid(1, "5eed0026");
  const RUN = uuid(1, "5eed0010");
  const STAGE = uuid(1, "5eed0011");

  /** The references one record may carry. */
  interface Refs {
    estimateId?: string;
    runStageId?: string;
    runId?: string;
  }

  it.each<[ContextConsumer, Refs, boolean]>([
    ["estimator", { estimateId: ESTIMATE }, true],
    ["estimator", { estimateId: ESTIMATE, runId: RUN }, false],
    ["estimator", {}, false],
    ["run_stage", { runStageId: STAGE, runId: RUN }, true],
    ["run_stage", { runStageId: STAGE }, false],
    ["run_stage", { runStageId: STAGE, runId: RUN, estimateId: ESTIMATE }, false],
    ["playbook", { runId: RUN }, true],
    ["playbook", { runId: RUN, runStageId: STAGE }, false],
    ["playbook", {}, false],
  ])("%s with %j fits: %s", (consumer, refs, fits) => {
    expect(
      fitsConsumer(consumer, refs.estimateId ?? null, refs.runStageId ?? null, refs.runId ?? null),
    ).toBe(fits);
  });

  it("answers 422 naming the consumer when the references do not fit", async () => {
    const { service } = build();

    expect(
      await refusal(
        service.record(WORKSPACE, {
          consumer: "run_stage",
          runStageId: STAGE,
          skillVersionIds: [],
          factIds: [],
          manifestHash: "c".repeat(64),
        }),
      ),
    ).toMatchObject({
      code: CONTEXT_ASSEMBLY_ERRORS.consumerReference,
      details: { consumer: "run_stage" },
    });
  });

  it("stores exactly what a run stage injected — the manifest's ids and hash", async () => {
    const { world, service } = build();
    const rows = world.workspace(WORKSPACE);
    rows.runs.add(RUN);
    rows.stages.set(STAGE, RUN);
    rows.skills.push(repoSkill({ slug: "zephyr" }), skill({ slug: "commit-style" }));
    rows.facts.push(fact());

    const manifest = await service.assemble(WORKSPACE, { repo: HELIOS }, "run_stage");
    const stored = await service.record(WORKSPACE, {
      consumer: "run_stage",
      runStageId: STAGE,
      runId: RUN,
      ...injectionOf(manifest),
    });

    expect(stored).toMatchObject({
      consumer: "run_stage",
      runStageId: STAGE,
      runId: RUN,
      estimateId: null,
      skillVersionIds: manifest.skillVersions.map((entry) => entry.versionId),
      factIds: manifest.facts.map((entry) => entry.id),
      manifestHash: manifest.manifestHash,
    });
  });

  it("passes on a failure that is not V071's refusal", async () => {
    const world = new AssemblyWorld();
    const store = world.store();
    store.record = async () => Promise.reject(new Error("connection reset"));

    await expect(
      new ContextAssemblyService(store).record(WORKSPACE, {
        consumer: "playbook",
        runId: RUN,
        skillVersionIds: [],
        factIds: [],
        manifestHash: "d".repeat(64),
      }),
    ).rejects.toThrow("connection reset");
  });
});

describe("the usage numbers are counted from the records", () => {
  it("reproduces `used 48×` and `61% of runs` from recorded injections", async () => {
    const { world, service } = build();
    const rows = world.workspace(WORKSPACE);
    const zephyr = repoSkill({ slug: "zephyr-conventions", name: "Zephyr conventions" });
    const west = fact({ text: "CI needs `west update` before first build of the day" });
    rows.skills.push(zephyr);
    rows.facts.push(west);

    // Eighteen helios-firmware runs: eleven did Kconfig, devicetree or ISR work and carried the
    // skill; every one carried the `west update` fact.
    const runs: InjectedRun[] = Array.from({ length: 18 }, (_, n) => ({
      runId: uuid(n + 1, "5eed0010"),
      repoRef: HELIOS,
      workflowSlug: STANDARD_FIX,
      openedPr: false,
      physical: false,
    }));
    const full = await service.assemble(WORKSPACE, { repo: HELIOS }, "run_stage");
    const fullIds = injectionOf(full);

    for (const [n, run] of runs.entries()) {
      rows.runs.add(run.runId);
      const carriesSkill = n < 11;
      await service.record(WORKSPACE, {
        consumer: "playbook",
        runId: run.runId,
        skillVersionIds: carriesSkill ? fullIds.skillVersionIds : [],
        factIds: fullIds.factIds,
        manifestHash: fullIds.manifestHash,
      });
    }

    // Thirty estimates carried the fact too.
    for (let n = 0; n < 30; n += 1) {
      const estimateId = uuid(n + 1, "5eed0026");
      rows.estimates.add(estimateId);
      const estimator = await service.assemble(WORKSPACE, { repo: HELIOS }, "estimator");
      await service.record(WORKSPACE, {
        consumer: "estimator",
        estimateId,
        ...injectionOf(estimator),
      });
    }

    // facts.repository.ts: count(*) of rows whose fact_ids contain the fact.
    const used = world.injections.filter((row) => row.factIds.includes(west.id)).length;
    // skills.repository.ts: the runs whose rows carry a version of the skill.
    const carried = new Set(
      world.injections
        .filter((row) => row.runId !== null && row.skillVersionIds.includes(zephyr.versionId ?? ""))
        .map((row) => row.runId ?? ""),
    );

    expect(used).toBe(48);
    expect(
      usedBy({ scope: "repo", repoRef: HELIOS, workflowSlug: null, draft: false }, runs, carried)
        .label,
    ).toBe("61% of runs");
  });
});
