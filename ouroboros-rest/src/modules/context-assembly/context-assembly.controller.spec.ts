/**
 * The two routes ([#414](https://github.com/NobuData/ouroboros/issues/414)): the preview is
 * `assemble`, byte for byte, and records nothing; recording is gated to contributors.
 */

import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import type { Organization } from "../db/schema";
import { ContextAssemblyController } from "./context-assembly.controller";
import {
  HELIOS,
  STANDARD_FIX,
  STANDARD_FIX_ID,
  WORKSPACE,
  fact,
  repoSkill,
  skill,
  workflowSkill,
} from "./context-assembly.fixture";
import { ContextAssemblyService } from "./context-assembly.service";
import { AssemblyWorld } from "./context-assembly.store.fixture";

const TENANT = { id: WORKSPACE } as Organization;

/** A controller and service over a seeded world. */
function build() {
  const world = new AssemblyWorld();
  const rows = world.workspace(WORKSPACE);
  rows.workflows.set(STANDARD_FIX, STANDARD_FIX_ID);
  const hil = repoSkill({ slug: "hil-safety", name: "HIL safety", required: true });
  rows.skills.push(
    hil,
    repoSkill({ slug: "zephyr-conventions" }),
    skill({ slug: "commit-style" }),
    workflowSkill({ slug: "hil-off", name: "hil safety", enabled: false }),
    skill({ slug: "draft", draft: true }),
  );
  rows.facts.push(fact({ repoRef: HELIOS }), fact(), fact({ status: "proposed" }));
  const service = new ContextAssemblyService(world.store());

  return { world, service, hil, controller: new ContextAssemblyController(service) };
}

describe("POST /knowledge/context/preview", () => {
  it.each(["estimator", "run_stage", "playbook"] as const)(
    "answers what assemble produces for %s, byte for byte",
    async (consumer) => {
      const { service, controller, hil } = build();
      const overrides = { enable: [], disable: [hil.id] };

      const preview = await controller.preview(TENANT, {
        consumer,
        repo: HELIOS,
        workflow: STANDARD_FIX,
        overrides,
        budgetTokens: 5_000,
      });
      const assembled = await service.assemble(
        WORKSPACE,
        { repo: HELIOS, workflow: STANDARD_FIX },
        consumer,
        { overrides, budgetTokens: 5_000 },
      );

      expect(JSON.stringify(preview)).toBe(JSON.stringify(assembled));
    },
  );

  it("records nothing", async () => {
    const { world, controller } = build();

    await controller.preview(TENANT, { consumer: "run_stage", repo: HELIOS });

    expect(world.injections).toEqual([]);
  });

  it("is open to every member — no role gate, it writes nothing", () => {
    expect(
      Reflect.getMetadata(REQUIRED_ROLES, ContextAssemblyController.prototype.preview),
    ).toBeUndefined();
  });
});

describe("POST /knowledge/context/injections", () => {
  it("is gated to contributors — a viewer cannot inflate a usage count", () => {
    expect(Reflect.getMetadata(REQUIRED_ROLES, ContextAssemblyController.prototype.record)).toEqual(
      ["owner", "admin", "member"],
    );
  });

  it("stores the record in the tenant's workspace", async () => {
    const { world, controller } = build();
    const estimateId = "5eed0026-0000-4000-8000-000000000001";
    world.workspace(WORKSPACE).estimates.add(estimateId);

    const stored = await controller.record(TENANT, {
      consumer: "estimator",
      estimateId,
      skillVersionIds: [],
      factIds: [],
      manifestHash: "e".repeat(64),
    });

    expect(stored.estimateId).toBe(estimateId);
    expect(world.injections.map((row) => row.organizationId)).toEqual([WORKSPACE]);
  });
});
