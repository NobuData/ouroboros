import { BUILT_IN_GATE_KEYS } from "../../db/schema";
import { readPinnedPolicy } from "../../guardrails/guardrails.policy";
import { readFixture } from "../../workflows/dsl.golden.fixture";
import {
  DEFAULT_SOURCE,
  GATE_LABELS,
  ORG_CONFIG_SOURCE,
  REVIEW_REQUESTED_SOURCE,
  materializeDefinitions,
  type DefinitionInput,
} from "./gate.definitions";
import { DEFAULT_ORG_GATE_CONFIG } from "./gate.policy";

/**
 * Definition materialization (AX.2, [#358](https://github.com/NobuData/ouroboros/issues/358)) —
 * the pinned policy, the vote rules, the run's intents and org config, into the gate set, each
 * definition carrying the pin that produced it.
 */

/** The committed `standard-fix` document — the one mockup 12's run pins at v14. */
const STANDARD_FIX = readPinnedPolicy(readFixture("valid/standard-fix.json"));

/** PR #514's inputs. */
const PR_514: DefinitionInput = {
  pin: { tag: "standard-fix", version: 14 },
  policy: STANDARD_FIX,
  voteRules: 1,
  blockUntilGreen: false,
  org: DEFAULT_ORG_GATE_CONFIG,
};

/**
 * @param input - The inputs.
 * @returns Each gate's `required` and source, by key.
 */
function byKey(input: DefinitionInput) {
  return Object.fromEntries(materializeDefinitions(input).map((spec) => [spec.gateKey, spec]));
}

describe("materializeDefinitions", () => {
  it("materializes mockup 12's seven rows, all required, with the pin as provenance", () => {
    const specs = materializeDefinitions(PR_514);

    expect(specs.map((spec) => spec.gateKey)).toEqual([...BUILT_IN_GATE_KEYS]);
    expect(specs.map((spec) => spec.label)).toEqual(
      BUILT_IN_GATE_KEYS.map((key) => GATE_LABELS[key]),
    );
    expect(specs.map((spec) => spec.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(specs.every((spec) => spec.required)).toBe(true);
    expect(new Set(specs.map((spec) => spec.source))).toEqual(new Set(["standard-fix@v14 pin"]));
    expect(specs.some((spec) => spec.disabled)).toBe(false);
  });

  it("makes model_review required only when a vote rule matches the ticket", () => {
    expect(byKey({ ...PR_514, voteRules: 0 }).model_review.required).toBe(false);
    expect(byKey({ ...PR_514, voteRules: 2 }).model_review.required).toBe(true);
  });

  it("leaves the evidence gates advisory when the pin holds on no checks", () => {
    const gates = byKey({
      ...PR_514,
      policy: STANDARD_FIX && { ...STANDARD_FIX, holdsOnChecks: false },
    });

    for (const key of ["build", "test_suite", "physical_hil", "diff_vs_plan", "secrets_license"]) {
      expect(gates[key].required).toBe(false);
    }
    expect(gates.human_approval.required).toBe(true);
  });

  it("lets block-until-green make the test gate required, and says so", () => {
    const gates = byKey({
      ...PR_514,
      policy: STANDARD_FIX && { ...STANDARD_FIX, holdsOnChecks: false },
      blockUntilGreen: true,
    });

    expect(gates.test_suite).toMatchObject({
      required: true,
      source: "standard-fix@v14 pin + block-until-green intent",
    });
    expect(gates.build.required).toBe(false);
  });

  it("requires everything under the default provenance when there is no readable policy", () => {
    for (const input of [
      { ...PR_514, pin: null, policy: undefined },
      { ...PR_514, policy: undefined },
    ]) {
      const specs = materializeDefinitions(input);

      expect(
        specs.filter((spec) => spec.gateKey !== "model_review").every((spec) => spec.required),
      ).toBe(true);
      expect(new Set(specs.map((spec) => spec.source))).toEqual(new Set([DEFAULT_SOURCE]));
    }
  });

  it("applies org overrides last and records them as org config", () => {
    const gates = byKey({
      ...PR_514,
      org: {
        ...DEFAULT_ORG_GATE_CONFIG,
        overrides: {
          physical_hil: { disabled: true },
          human_approval: { required: false },
          build: { required: true },
        },
      },
    });

    expect(gates.physical_hil).toMatchObject({
      required: false,
      disabled: true,
      source: ORG_CONFIG_SOURCE,
    });
    expect(gates.human_approval).toMatchObject({
      required: false,
      disabled: false,
      source: ORG_CONFIG_SOURCE,
    });
    // An override that agrees with the pin changes nothing, so the pin stays the provenance.
    expect(gates.build).toMatchObject({ required: true, source: "standard-fix@v14 pin" });
  });

  it("makes human approval required once a review is requested, over org config (AX.5)", () => {
    const org = {
      ...DEFAULT_ORG_GATE_CONFIG,
      overrides: { human_approval: { disabled: true } },
    };

    expect(byKey({ ...PR_514, org }).human_approval).toMatchObject({
      required: false,
      disabled: true,
    });
    expect(byKey({ ...PR_514, org, reviewRequested: true }).human_approval).toMatchObject({
      required: true,
      disabled: false,
      source: `standard-fix@v14 pin + ${REVIEW_REQUESTED_SOURCE}`,
    });
    // The request touches no other gate.
    expect(byKey({ ...PR_514, reviewRequested: true }).build).toEqual(byKey(PR_514).build);
  });

  it("is a pure function of its inputs", () => {
    expect(materializeDefinitions(PR_514)).toEqual(materializeDefinitions(PR_514));
  });
});
