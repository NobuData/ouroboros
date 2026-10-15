import { reportedModels } from "./harness.dto";

describe("reportedModels", () => {
  it("accepts the SDK's modelUsage, extra fields and all", () => {
    const models = {
      "coder-max": { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 0, costUSD: 0.01 },
    };

    expect(reportedModels(models)).toBe(models);
  });

  it("names every bad count", () => {
    expect(() =>
      reportedModels({
        a: { inputTokens: -1 },
        b: { inputTokens: 1, outputTokens: 1.5, cacheCreationInputTokens: "2" },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "validation_failed",
      }) as Error,
    );

    try {
      reportedModels({ a: { inputTokens: -1 } });
    } catch (error) {
      expect((error as { envelope(): { details: unknown } }).envelope().details).toEqual({
        violations: [
          "models.a.inputTokens must be a non-negative integer",
          "models.a.outputTokens must be a non-negative integer",
        ],
      });
    }
  });
});
