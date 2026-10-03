import type { EngineSeriesPoint } from "../../engine/engine.analysis";
import type { CorpusRepository } from "../corpus/corpus.repository";
import type { Confound } from "./measurement.math";
import type {
  ClosedCell,
  Closing,
  MeasurementRepository,
  OpenMeasurement,
} from "./measurement.repository";
import { MeasurementService } from "./measurement.service";

/**
 * The measurement job's decisions (BV.6, #515) over stand-ins: when a measurement stays pending,
 * what interferes, how the measured value is read, and what a close writes. The database's own
 * arithmetic — verdict and calibration — is the integration suite's.
 */

/** The ccache warm-up, applied Jul 9, predicted −110 s on stage_duration. */
function measurement(overrides: Partial<OpenMeasurement> = {}): OpenMeasurement {
  return {
    id: "m-2",
    suggestion_id: "s-2",
    organization_id: "org",
    repo_ref: "acme-robotics/helios-firmware",
    applied_on: "2026-07-09",
    window_ends_on: "2026-07-23",
    window_days: 14,
    target_metric: "build_duration",
    baseline: { value: 380, statistic: "median" },
    predicted: {
      delta: -110,
      unit: "seconds",
      calibration: { analyzer: "cache_window", impact_class: "duration_delta", factor: 1 },
    },
    verdict_under_below: 0.8,
    verdict_over_above: 1.2,
    confounds: [],
    metric_unit: "duration_ms",
    metric_aggregation: "median",
    filled_through: "2026-07-23",
    ...overrides,
  };
}

/** How the stand-ins answer. */
interface World {
  applications?: Confound[];
  changePoints?: { id: string; date: string; series: string }[];
  series?: EngineSeriesPoint[];
  cell?: ClosedCell;
}

/**
 * The service over stand-ins.
 *
 * @param world - What they answer.
 * @returns The service and what they recorded.
 */
function build(world: World = {}) {
  const closings: Closing[] = [];
  const notes: (string | null)[] = [];
  const recorded: Confound[][] = [];
  const repository = {
    open: jest.fn(() => Promise.resolve([measurement()])),
    applications: jest.fn(() => Promise.resolve(world.applications ?? [])),
    changePoints: jest.fn(() => Promise.resolve(world.changePoints ?? [])),
    recordConfounds: jest.fn((_id: string, confounds: Confound[]) => {
      recorded.push(confounds);
      return Promise.resolve();
    }),
    close: jest.fn(
      (closing: Closing, _cell: unknown, compose: (cell: ClosedCell) => string | null) => {
        closings.push(closing);
        const cell = world.cell ?? { fromFactor: 1, toFactor: 0.6545 };
        notes.push(compose(cell));
        return Promise.resolve(cell);
      },
    ),
  } as unknown as MeasurementRepository;
  const corpus = {
    series: jest.fn(() =>
      Promise.resolve(
        world.series ?? [
          { day: "2026-07-12", dimension: "zephyr build", value: 0, samples: [300_000, 316_000] },
        ],
      ),
    ),
  } as unknown as CorpusRepository;

  return { service: new MeasurementService(repository, corpus), closings, notes, recorded, corpus };
}

const AFTER = new Date("2026-07-24T03:00:00Z");

describe("closing a window", () => {
  it("measures day 1…N with the baseline's statistic, in seconds, and closes under with the note", async () => {
    const world = build();

    const closed = await world.service.measure(measurement(), AFTER);

    expect(world.corpus.series).toHaveBeenCalledWith(
      { organizationId: "org", repoRef: "acme-robotics/helios-firmware" },
      { from: "2026-07-10", to: "2026-07-23" },
      "build_duration",
    );
    expect(world.closings[0]).toMatchObject({
      measured: { value: 308, delta: -72 },
      verdict: "under",
      confounds: [],
    });
    expect(closed).toEqual({
      verdict: "under",
      note: "under-delivered — analyzer revised its cache model",
    });
  });

  it("closes confounded — never clean — when another application on the same metric landed inside", async () => {
    const second = { kind: "application" as const, id: "s-9", date: "2026-07-15" };
    const world = build({ applications: [second], cell: { fromFactor: 1, toFactor: 1 } });

    const closed = await world.service.measure(measurement(), AFTER);

    expect(world.closings[0]).toMatchObject({ verdict: "confounded", confounds: [second] });
    expect(closed?.note).toContain("confounded — 1 interfering event");
  });

  it("counts a change-point only on the measurement's own metric", async () => {
    const world = build({
      changePoints: [
        { id: "f-1", date: "2026-07-12", series: "build.duration_median" },
        { id: "f-2", date: "2026-07-13", series: "queue_wait" },
      ],
    });

    await world.service.measure(measurement(), AFTER);

    expect(world.closings[0].confounds).toEqual([
      { kind: "change_point", id: "f-1", date: "2026-07-12" },
    ]);
  });

  it("reads only the moved-to pool when the baseline was a pool's", async () => {
    const world = build({
      series: [
        { day: "2026-07-12", dimension: "pool-a", value: 0, samples: [100_000] },
        { day: "2026-07-12", dimension: "pool-b", value: 0, samples: [900_000] },
      ],
    });

    await world.service.measure(
      measurement({
        target_metric: "queue_wait",
        baseline: { value: 200, statistic: "p95", dimension: "pool-a" },
      }),
      AFTER,
    );

    expect(world.closings[0].measured.value).toBe(100);
  });
});

describe("staying pending", () => {
  it.each([
    ["inside its window", measurement(), new Date("2026-07-20T12:00:00Z")],
    ["on its last day", measurement(), new Date("2026-07-23T23:00:00Z")],
    [
      "before the rollup has filled its last day",
      measurement({ filled_through: "2026-07-22" }),
      AFTER,
    ],
    ["with no rollup at all", measurement({ filled_through: null }), AFTER],
  ])("stays pending %s", async (_name, open, at) => {
    const world = build();

    expect(await world.service.measure(open, at)).toBeUndefined();
    expect(world.closings).toEqual([]);
  });

  it("stays pending with no data in its window rather than judging nothing", async () => {
    const world = build({ series: [] });

    expect(await world.service.measure(measurement(), AFTER)).toBeUndefined();
    expect(world.closings).toEqual([]);
  });

  it("records interference early, so the card flags a muddied window before it closes", async () => {
    const second = { kind: "application" as const, id: "s-9", date: "2026-07-15" };
    const world = build({ applications: [second] });

    await world.service.measure(measurement(), new Date("2026-07-16T12:00:00Z"));

    expect(world.recorded).toEqual([[second]]);
  });
});

describe("a pass", () => {
  it("judges each measurement on its own and counts what stays pending", async () => {
    const world = build();

    const result = await world.service.pass(AFTER);

    expect(result).toEqual({
      closed: [
        { id: "m-2", verdict: "under", note: "under-delivered — analyzer revised its cache model" },
      ],
      pending: 0,
      failed: [],
    });
  });
});
