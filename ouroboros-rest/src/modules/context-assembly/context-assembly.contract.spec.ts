/**
 * The OpenAPI document and what the context routes send
 * ([#414](https://github.com/NobuData/ouroboros/issues/414)). `openapi.spec.ts` sees these routes
 * only unauthenticated, so real service answers — an empty manifest, a full and trimmed one, a
 * record — are held to the documented schemas here, all of them closed.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
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
import { ContextAssemblyService, injectionOf } from "./context-assembly.service";
import { AssemblyWorld } from "./context-assembly.store.fixture";

/**
 * A validator for one documented schema.
 *
 * @param name - The schema's name under `components/schemas`.
 * @returns A function answering Ajv's complaint, or undefined when the value validates.
 */
function validatorFor(name: string): (value: unknown) => string | undefined {
  const id = "https://ouroboros.invalid/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });

  const validate = ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
  return (value) => (validate(value) ? undefined : ajv.errorsText(validate.errors));
}

/** A value as the client receives it. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** A service over a world holding every kind of row a manifest can mention. */
function build() {
  const world = new AssemblyWorld();
  const rows = world.workspace(WORKSPACE);
  rows.workflows.set(STANDARD_FIX, STANDARD_FIX_ID);
  const hil = repoSkill({ slug: "hil-safety", name: "HIL safety", required: true });
  rows.skills.push(
    hil,
    repoSkill({ slug: "zephyr", frontmatter: { load: "on_trigger", triggers: ["ISR"] } }),
    skill({ slug: "big", body: "x".repeat(40_000) }),
    skill({ slug: "off", enabled: false }),
    workflowSkill({ slug: "hil-off", name: "hil safety", enabled: false }),
  );
  rows.facts.push(fact({ repoRef: HELIOS }), fact());

  return { world, hil, service: new ContextAssemblyService(world.store()) };
}

describe("the context routes and the document", () => {
  it("sends what ContextManifest describes — empty, full, trimmed, overridden", async () => {
    const { service, hil } = build();
    const empty = await new ContextAssemblyService(new AssemblyWorld().store()).assemble(
      WORKSPACE,
      {},
      "estimator",
    );
    const full = await service.assemble(
      WORKSPACE,
      { repo: HELIOS, workflow: STANDARD_FIX },
      "run_stage",
      { overrides: { enable: [], disable: [hil.id] }, budgetTokens: 5_000 },
    );

    expect(full.trimmed).not.toEqual([]);
    expect(full.excluded).not.toEqual([]);
    expect(full.refusedOverrides).not.toEqual([]);
    expect(validatorFor("ContextManifest")(wire(empty))).toBeUndefined();
    expect(validatorFor("ContextManifest")(wire(full))).toBeUndefined();
  });

  it("sends what ContextInjection describes", async () => {
    const { world, service } = build();
    const estimateId = "5eed0026-0000-4000-8000-000000000001";
    world.workspace(WORKSPACE).estimates.add(estimateId);
    const manifest = await service.assemble(WORKSPACE, { repo: HELIOS }, "estimator");

    const stored = await service.record(WORKSPACE, {
      consumer: "estimator",
      estimateId,
      ...injectionOf(manifest),
    });

    expect(validatorFor("ContextInjection")(wire(stored))).toBeUndefined();
  });

  it("refuses an undocumented field — the schemas are closed", async () => {
    const manifest = wire(
      await build().service.assemble(WORKSPACE, { repo: HELIOS }, "run_stage"),
    ) as {
      skillVersions: object[];
    };

    expect(validatorFor("ContextManifest")({ ...manifest, surprise: 1 })).toMatch(/additional/);
    expect(
      validatorFor("ContextManifest")({
        ...manifest,
        skillVersions: [{ ...manifest.skillVersions[0], extra: true }],
      }),
    ).toMatch(/additional/);
  });
});
