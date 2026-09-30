/**
 * The OpenAPI document and what the proposers' routes send (#412). `openapi.spec.ts` sees these
 * routes only unauthenticated, so real service answers — the registry, a backfill with every
 * outcome, a suppression — are held to the documented schemas here, all of them closed.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import { backfillResource, registryResource } from "./proposers.resources";
import {
  CLASSIFICATION_ID,
  ORDINARY_STEER_ID,
  PROPOSER_ORG,
  ProposerWorld,
  REMEMBERED_STEER_ID,
  RUN_ID,
} from "./proposers.store.fixture";

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

describe("the proposers' routes and the document", () => {
  it("sends what FactProposerRegistry describes", () => {
    expect(validatorFor("FactProposerRegistry")(wire(registryResource()))).toBeUndefined();
  });

  it("sends what FactProposerBackfill describes, for every outcome", async () => {
    const world = new ProposerWorld();
    world.facts.seed(PROPOSER_ORG, "rejected", { text: "Rig 2's chamber is out for calibration" });
    world
      .withCorrectionNote()
      .withWaiver("Rig 2's chamber is out for calibration.")
      .withSteer(REMEMBERED_STEER_ID, "Always run `west update` first.", true)
      .withSteer(ORDINARY_STEER_ID, "Just this once.", false);
    world.runSourceList.push({ kind: "steer", id: ORDINARY_STEER_ID, at: new Date() });
    const service = world.service();
    await service.proposeFrom(PROPOSER_ORG, { kind: "correction_note", id: CLASSIFICATION_ID });

    const outcomes = await service.backfillRun(PROPOSER_ORG, RUN_ID);

    expect(new Set(outcomes.map((outcome) => outcome.outcome))).toEqual(
      new Set(["already_proposed", "suppressed", "proposed", "skipped"]),
    );
    expect(
      validatorFor("FactProposerBackfill")(wire(backfillResource(RUN_ID, outcomes))),
    ).toBeUndefined();
    expect(
      validatorFor("FactSuppressionList")(
        wire({ items: await service.suppressions(PROPOSER_ORG, 10) }),
      ),
    ).toBeUndefined();
  });

  it("refuses an undocumented field — the schemas are closed", () => {
    expect(
      validatorFor("FactProposerRegistry")({ ...(wire(registryResource()) as object), x: 1 }),
    ).toMatch(/additional/);
    expect(
      validatorFor("FactCandidate")({
        text: "x",
        repoRef: null,
        proposer: "steer",
        proposerVersion: 1,
        category: "instruction",
        confidence: null,
        provenance: { line: "l", refs: [] },
        source: { kind: "steer", id: "s" },
        status: "confirmed",
      }),
    ).toMatch(/additional/);
  });
});
