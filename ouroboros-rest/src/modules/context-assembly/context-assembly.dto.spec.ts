import { plainToInstance } from "class-transformer";
import { validate, type ValidationError } from "class-validator";

import { PreviewContextBody, RecordInjectionBody } from "./context-assembly.dto";

/**
 * The context-assembly routes' request shapes
 * ([#414](https://github.com/NobuData/ouroboros/issues/414)), validated the way the pipe validates
 * them.
 */

/**
 * @param type - The DTO.
 * @param value - The plain value.
 * @returns The dotted paths of the failing properties.
 */
async function violations<T extends object>(
  type: new () => T,
  value: Record<string, unknown>,
): Promise<string[]> {
  const flatten = (failures: ValidationError[], prefix = ""): string[] =>
    failures.flatMap((failure) =>
      failure.children !== undefined && failure.children.length > 0
        ? flatten(failure.children, `${prefix}${failure.property}.`)
        : [`${prefix}${failure.property}`],
    );

  return flatten(await validate(plainToInstance(type, value)));
}

const ID = "5eed0069-0000-4000-8000-000000000001";
const OTHER = "5eed0069-0000-4000-8000-000000000002";

describe("the preview body", () => {
  it("admits a consumer alone — a workspace-wide manifest", async () => {
    expect(await violations(PreviewContextBody, { consumer: "estimator" })).toEqual([]);
  });

  it("admits a full scope, overrides and a budget", async () => {
    expect(
      await violations(PreviewContextBody, {
        consumer: "run_stage",
        repo: "acme-robotics/helios-firmware",
        workflow: "standard-fix",
        overrides: { enable: [ID], disable: [OTHER] },
        budgetTokens: 4_000,
      }),
    ).toEqual([]);
  });

  it.each([
    [{ consumer: "planner" }, ["consumer"]],
    [{ consumer: "estimator", repo: "helios-firmware" }, ["repo"]],
    [{ consumer: "estimator", repo: "acme/.." }, ["repo"]],
    [{ consumer: "estimator", workflow: "Standard Fix" }, ["workflow"]],
    [{ consumer: "estimator", budgetTokens: 0 }, ["budgetTokens"]],
    [{ consumer: "estimator", budgetTokens: 200_001 }, ["budgetTokens"]],
    [{ consumer: "estimator", budgetTokens: 1.5 }, ["budgetTokens"]],
    [{ consumer: "estimator", overrides: { enable: ["hil-safety"] } }, ["overrides.enable"]],
    [{ consumer: "estimator", overrides: { disable: [ID, ID] } }, ["overrides.disable"]],
    [
      { consumer: "estimator", overrides: { enable: Array.from({ length: 65 }, () => ID) } },
      ["overrides.enable"],
    ],
  ])("refuses %j", async (value, fields) => {
    expect(await violations(PreviewContextBody, value)).toEqual(fields);
  });
});

describe("the injection body", () => {
  const valid = {
    consumer: "estimator",
    estimateId: ID,
    skillVersionIds: [],
    factIds: [OTHER],
    manifestHash: "0f".repeat(32),
  };

  it("admits a well-formed record", async () => {
    expect(await violations(RecordInjectionBody, valid)).toEqual([]);
  });

  it.each([
    [{ manifestHash: "0F".repeat(32) }, ["manifestHash"]],
    [{ manifestHash: "0".repeat(63) }, ["manifestHash"]],
    [{ factIds: [OTHER, OTHER] }, ["factIds"]],
    [{ factIds: ["west"] }, ["factIds"]],
    [{ skillVersionIds: undefined }, ["skillVersionIds"]],
    [{ estimateId: "485" }, ["estimateId"]],
    [{ consumer: "anyone" }, ["consumer"]],
  ])("refuses %j", async (change, fields) => {
    expect(await violations(RecordInjectionBody, { ...valid, ...change })).toEqual(fields);
  });
});
