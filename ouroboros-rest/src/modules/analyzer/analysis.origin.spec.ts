import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { DurationChartQuery } from "./duration/duration.dto";
import { LatestAnalysisQuery, StartAnalysisBody } from "./analysis.dto";
import { analysisOrigin, DEFAULT_ANALYSIS_ORIGIN } from "./analysis.origin";

/**
 * Which data origin an analysis reads (#2022): one, `live` unless asked, and never `all`.
 */

const REPO = "acme-robotics/helios-firmware";

/**
 * Validate a body or query the way the pipe would.
 *
 * @param target - The DTO class.
 * @param input - What a client sent.
 * @returns The refused properties, sorted.
 */
async function refusalsOf(target: new () => object, input: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(target, input));

  return errors.map((error) => error.property).sort();
}

describe("the origin an analysis reads", () => {
  it("is live when nothing is asked for", () => {
    expect(DEFAULT_ANALYSIS_ORIGIN).toBe("live");
    expect(analysisOrigin(undefined)).toBe("live");
  });

  it("is what was asked for otherwise", () => {
    expect(analysisOrigin("seeded")).toBe("seeded");
    expect(analysisOrigin("simulated")).toBe("simulated");
  });
});

describe.each([
  ["POST /runs's body", StartAnalysisBody],
  ["GET /runs/latest's query", LatestAnalysisQuery],
  ["a read's query", DurationChartQuery],
] as const)("%s", (_name, target) => {
  it("accepts no origin", async () => {
    await expect(refusalsOf(target, { repo: REPO })).resolves.toEqual([]);
  });

  it.each(["live", "simulated", "seeded"])("accepts %s", async (origin) => {
    await expect(refusalsOf(target, { repo: REPO, origin })).resolves.toEqual([]);
  });

  it("refuses all — an analysis does not mix origins", async () => {
    await expect(refusalsOf(target, { repo: REPO, origin: "all" })).resolves.toEqual(["origin"]);
  });

  it("refuses an origin it does not know", async () => {
    await expect(refusalsOf(target, { repo: REPO, origin: "demo" })).resolves.toEqual(["origin"]);
  });
});
