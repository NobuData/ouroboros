import type { CalibrationStore } from "./calibration.repository";
import { CalibrationService } from "./calibration.service";

/**
 * The service: a merge is recorded through the store, and the report reads a window ending at the
 * clock's now and composes it with the rules.
 */

const ORG = "org-calibration";
const NOW = Date.parse("2026-10-01T12:00:00.000Z");

describe("CalibrationService", () => {
  let store: jest.Mocked<CalibrationStore>;
  let service: CalibrationService;

  beforeEach(() => {
    store = {
      record: jest.fn().mockResolvedValue(undefined),
      sums: jest.fn().mockResolvedValue([
        {
          effort: "s",
          merged: 9,
          withinBand: 8,
          over: 1,
          under: 0,
          deviationMs: 0,
          midpointMs: 1,
        },
        {
          effort: null,
          merged: 1,
          withinBand: 0,
          over: 0,
          under: 0,
          deviationMs: 0,
          midpointMs: 0,
        },
      ]),
    };
    service = new CalibrationService(store, () => NOW);
  });

  it("records a reported merge — a PR that is not a loop's is no error", async () => {
    await expect(service.mergeObserved(ORG, "pr-1")).resolves.toBeUndefined();
    expect(store.record).toHaveBeenCalledWith(ORG, "pr-1");
  });

  it("lets a failed fill reject, for the caller to log", async () => {
    store.record.mockRejectedValue(new Error("db down"));

    await expect(service.mergeObserved(ORG, "pr-1")).rejects.toThrow("db down");
  });

  it("reads the window ending now and reports it", async () => {
    const report = await service.report(ORG, "7d");

    expect(store.sums).toHaveBeenCalledWith(ORG, {
      from: new Date("2026-09-24T12:00:00.000Z"),
      to: new Date(NOW),
    });
    expect(report).toMatchObject({
      window: "7d",
      merged: 10,
      estimated: 9,
      unestimated: 1,
      withinBandPct: 88.9,
    });
  });

  it("reads Date.now when no clock is bound", async () => {
    const before = Date.now();
    const report = await new CalibrationService(store).report(ORG, "30d");

    expect(Date.parse(report.to)).toBeGreaterThanOrEqual(before);
  });
});
