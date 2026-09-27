import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { AttachEvidenceDto, CreateCriterionDto, WaiveCriterionDto } from "./criteria.dto";

/**
 * The shapes the criteria routes accept (#359) — each kind's required reference, and the bounds
 * that restate V055/V057, checked the way the global pipe checks them.
 */

/**
 * The properties a body fails on.
 *
 * @param type - The DTO.
 * @param body - The body.
 * @returns The failing property names, sorted.
 */
async function failing<T extends object>(type: new () => T, body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(type, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return errors.map((error) => error.property).sort();
}

describe("AttachEvidenceDto", () => {
  it("requires exactly each kind's reference", async () => {
    expect(await failing(AttachEvidenceDto, { kind: "test_case" })).toEqual(["caseKey"]);
    expect(await failing(AttachEvidenceDto, { kind: "hil_measurement" })).toEqual([
      "hilMeasurementId",
    ]);
    expect(await failing(AttachEvidenceDto, { kind: "build_artifact" })).toEqual([
      "testArtifactId",
    ]);
    expect(await failing(AttachEvidenceDto, { kind: "hunk" })).toEqual([
      "lineEnd",
      "lineStart",
      "path",
    ]);
    expect(await failing(AttachEvidenceDto, { kind: "analysis_note" })).toEqual(["note"]);
  });

  it("accepts the mockup's citations", async () => {
    for (const body of [
      { kind: "test_case", caseKey: "c".repeat(64), note: "10⁶ frames, 0 reordered" },
      { kind: "hunk", path: "drivers/can/telemetry_buf.c", lineStart: 41, lineEnd: 66 },
      { kind: "analysis_note", note: "static K_MSGQ_DEFINE · stack analysis clean" },
      { kind: "hil_measurement", hilMeasurementId: "5eed0034-0000-4000-8000-000048240501" },
    ]) {
      expect(await failing(AttachEvidenceDto, body)).toEqual([]);
    }
  });

  it("refuses an unknown kind, a malformed key, a zero line and a padded note", async () => {
    expect(await failing(AttachEvidenceDto, { kind: "free_text" })).toEqual(["kind"]);
    expect(await failing(AttachEvidenceDto, { kind: "test_case", caseKey: "ABC" })).toEqual([
      "caseKey",
    ]);
    expect(
      await failing(AttachEvidenceDto, { kind: "hunk", path: "a.c", lineStart: 0, lineEnd: 1 }),
    ).toEqual(["lineStart"]);
    expect(await failing(AttachEvidenceDto, { kind: "analysis_note", note: " clean " })).toEqual([
      "note",
    ]);
  });
});

describe("CreateCriterionDto and WaiveCriterionDto", () => {
  it("require a claim and a reason that are neither blank nor too long", async () => {
    expect(await failing(CreateCriterionDto, { claim: "   " })).toEqual(["claim"]);
    expect(await failing(CreateCriterionDto, { claim: "x".repeat(1025) })).toEqual(["claim"]);
    expect(await failing(CreateCriterionDto, { claim: "A claim", source: "guessed" })).toEqual([
      "source",
    ]);
    expect(await failing(WaiveCriterionDto, {})).toEqual(["reason"]);
    expect(await failing(WaiveCriterionDto, { reason: "x".repeat(4097) })).toEqual(["reason"]);
  });
});
