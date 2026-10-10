import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  CaptureBaselinesDto,
  DismissItemDto,
  SaveWatchSettingsDto,
  WatchItemParams,
} from "./watch.dto";
import {
  WATCH_ERRORS,
  itemClosed,
  itemNotFound,
  nothingWatched,
  settingsInvalid,
} from "./watch.errors";
import {
  BISECT_RESULT,
  FakeTelemetry,
  HOVER,
  ORG,
  REPO,
  baseline,
  fakeReading,
  hoverMetric,
  item,
  stats,
} from "./watch.fixture";
import {
  bisectCompleteEmission,
  driftDetectedEmission,
  metricLabel,
  watchItemOf,
  watchMovedOnDetector,
} from "./watch.inbox";
import { WatchReadings, windowOf } from "./watch.readings";
import { DEFAULT_SETTINGS } from "./watch.repository";
import {
  THRESHOLD_DEFAULTS,
  cardResource,
  detailOf,
  settingsResource,
  storedThresholds,
  watchItemResource,
} from "./watch.resources";
import { RegressionWatchScheduler, runPass } from "./watch.scheduler";
import { DEFAULT_NIGHTLY_REF, patchOf } from "./watch.settings";

/**
 * The watch's smaller parts (CM.4, #623): what a row says, what the inbox is told, how a
 * reading becomes a window, what the settings accept, and the scheduler's pass.
 */

async function failures(type: new () => object, value: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(type, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe("a card row", () => {
  const ticket = { kind: "ticket" as const, id: "t", key: "#512" };

  it.each([
    [item(), "detected", "detected", "warn"],
    [
      item({ note: "needs repro: no replayable test" }),
      "needs repro: no replayable test",
      "detected",
      "warn",
    ],
    [item({ status: "bisecting" }), "bisecting on the build farm", "bisecting", "run"],
    [
      item({ status: "bisected", bisectResult: BISECT_RESULT }),
      "bisected → a41f2c9",
      "bisected",
      "warn",
    ],
    [
      item({
        status: "investigation_open",
        bisectResult: BISECT_RESULT,
        investigationId: "i",
        investigationDisplayId: "RS-131",
      }),
      "bisected → a41f2c9 · forensics RS-131",
      "investigating",
      "run",
    ],
    [
      item({
        status: "fix_drafted",
        bisectResult: BISECT_RESULT,
        fixTicketRef: { kind: "draft", id: "d", key: "FIX-1" },
      }),
      "bisected → a41f2c9 · fix ticket drafted · FIX-1",
      "queued",
      "warn",
    ],
    [
      item({
        status: "fix_drafted",
        bisectResult: BISECT_RESULT,
        fixTicketRef: { ...ticket, key: "#517" },
      }),
      "bisected → a41f2c9 · fix ticket drafted · #517",
      "queued",
      "warn",
    ],
    [
      item({ status: "fix_running", bisectResult: BISECT_RESULT, fixTicketRef: ticket }),
      "bisected → a41f2c9 · fix loop running · #512",
      "fixing",
      "run",
    ],
    [
      item({
        status: "fixed_merged",
        bisectResult: BISECT_RESULT,
        fixTicketRef: ticket,
        prRef: { pull_request_id: "p", key: "#641" },
      }),
      "root-caused, fixed & merged · PR #641",
      "✓ merged",
      "ok",
    ],
    [item({ status: "dismissed" }), "dismissed", "dismissed", "idle"],
  ])(
    "reads mockup 22's second line and pill from the item's state (%#)",
    (row, detail, label, tone) => {
      expect(detailOf(row)).toBe(detail);
      expect(watchItemResource(row).pill).toEqual({ label, tone });
    },
  );

  it("publishes the drift, both windows, and what each step left behind", () => {
    const row = watchItemResource(
      item({
        status: "fixed_merged",
        bisectId: "b",
        bisectResult: BISECT_RESULT,
        investigationId: "i",
        investigationDisplayId: "RS-131",
        fixTicketRef: { kind: "ticket", id: "t", key: "#512" },
        prRef: { pull_request_id: "p", key: "#641" },
      }),
    );

    expect(row).toMatchObject({
      repository: REPO,
      metric: HOVER,
      metricLabel: "hover_drift_cm",
      releaseTag: "v2.0.4",
      drift: "+14%",
      driftValue: 14,
      driftUnit: "%",
      baseline: { n: 30, median: 5, spreadKind: "iqr", unit: "cm" },
      current: { n: 12, median: 5.7 },
      bisect: { id: "b", culprit: "a41f2c9", steps: 2, farmJobIds: BISECT_RESULT.farm_job_ids },
      investigation: { id: "i", displayId: "RS-131" },
      fixTicket: { kind: "ticket", key: "#512" },
      pullRequest: { id: "p", key: "#641" },
      detectedAt: "2026-10-10T02:00:00.000Z",
    });
    expect(watchItemResource(item())).toMatchObject({
      bisect: null,
      investigation: null,
      fixTicket: null,
      pullRequest: null,
    });
  });
});

describe("the card", () => {
  it("names the one release, counts what is open, and has no headline before a baseline", () => {
    const rows = [
      item(),
      item({ id: "2", severity: "warn" }),
      item({ id: "3", status: "fixed_merged" }),
      item({ id: "4", status: "dismissed" }),
    ];

    expect(cardResource(rows, [baseline()], DEFAULT_SETTINGS)).toMatchObject({
      headline: "nightly vs. v2.0.4 baseline",
      releases: ["v2.0.4"],
      counts: { open: 2, err: 1, warn: 1 },
      baselines: 1,
      lastComparedAt: null,
    });
    expect(cardResource([], [], DEFAULT_SETTINGS)).toMatchObject({
      headline: null,
      releases: [],
      counts: { open: 0, err: 0, warn: 0 },
    });
  });

  it("says so when repositories are on different releases, newest capture first", () => {
    const card = cardResource(
      [],
      [
        baseline(),
        baseline({
          id: "b2",
          repo: "acme/console",
          releaseTag: "v3.1.0",
          capturedAt: new Date("2026-10-01T00:00:00Z"),
        }),
      ],
      { ...DEFAULT_SETTINGS, lastComparedAt: new Date("2026-10-10T02:00:00Z") },
    );

    expect(card).toMatchObject({
      headline: "nightly vs. 2 release baselines",
      releases: ["v3.1.0", "v2.0.4"],
      lastComparedAt: "2026-10-10T02:00:00.000Z",
    });
  });
});

describe("the settings, published and stored", () => {
  it("mirrors the database's threshold defaults", () => {
    expect(THRESHOLD_DEFAULTS).toEqual({
      timing: {
        direction: "higher_is_worse",
        warn_pct: 5,
        err_pct: 15,
        min_spread_multiple: 2,
        min_samples: 5,
      },
      accuracy: {
        direction: "higher_is_worse",
        warn_pct: 5,
        err_pct: 10,
        min_spread_multiple: 2,
        min_samples: 10,
      },
      resource: {
        direction: "higher_is_worse",
        warn_pct: 10,
        err_pct: 25,
        min_spread_multiple: 2,
        min_samples: 5,
      },
      rate: {
        direction: "lower_is_worse",
        warn_pct: 2,
        err_pct: 5,
        min_spread_multiple: 2,
        min_samples: 10,
      },
    });
  });

  it("shows overrides beside the defaults they sit over", () => {
    const published = settingsResource({
      ...DEFAULT_SETTINGS,
      metrics: [hoverMetric()],
      thresholds: {
        classes: { timing: { warn_pct: 3, err_pct: 9 } },
        metrics: { [HOVER]: { min_samples: 4, direction: "either" } },
      },
      autoFile: true,
    });

    expect(published).toMatchObject({
      metrics: [
        {
          repository: REPO,
          source: "case_metric",
          key: HOVER,
          class: "accuracy",
          windowDays: 7,
          nightlyRef: "nightly",
          replay: { pool: "hil-rig" },
        },
      ],
      autoBisect: true,
      autoFile: true,
      thresholds: {
        classes: { timing: { warnPct: 3, errPct: 9 } },
        metrics: { [HOVER]: { minSamples: 4, direction: "either" } },
      },
    });
    expect(published.thresholds.defaults.rate).toEqual({
      direction: "lower_is_worse",
      warnPct: 2,
      errPct: 5,
      minSpreadMultiple: 2,
      minSamples: 10,
    });
  });

  it("stores overrides snake-cased and drops an empty one", () => {
    expect(
      storedThresholds(
        { timing: { warnPct: 3, errPct: 9 }, rate: {} },
        { [HOVER]: { minSpreadMultiple: 0 } },
      ),
    ).toEqual({
      classes: { timing: { warn_pct: 3, err_pct: 9 } },
      metrics: { [HOVER]: { min_spread_multiple: 0 } },
    });
  });

  it("turns a request into a patch of only what it carried, with defaults filled in", () => {
    const body = plainToInstance(SaveWatchSettingsDto, {
      metrics: [
        {
          repository: REPO,
          source: "case_metric",
          key: HOVER,
          class: "accuracy",
          replay: { pool: "hil-rig" },
        },
      ],
      autoFile: true,
    });

    expect(patchOf(body)).toEqual({
      metrics: [
        {
          repo: REPO,
          source: "case_metric",
          key: HOVER,
          class: "accuracy",
          window_days: 7,
          replay: { pool: "hil-rig", command: null },
          nightly_ref: DEFAULT_NIGHTLY_REF,
        },
      ],
      autoFile: true,
    });
    expect(patchOf(plainToInstance(SaveWatchSettingsDto, {}))).toEqual({});
    expect(
      patchOf(
        plainToInstance(SaveWatchSettingsDto, {
          fixSourceId: null,
          autoBisect: false,
          thresholds: {},
        }),
      ),
    ).toEqual({
      fixSourceId: null,
      autoBisect: false,
      thresholds: { classes: {}, metrics: {} },
    });
  });

  it.each([
    [
      {
        metrics: [
          { repository: REPO, source: "case_metric", key: HOVER, class: "accuracy" },
          { repository: REPO.toUpperCase(), source: "case_metric", key: HOVER, class: "timing" },
        ],
      },
      "listed twice",
    ],
    [
      { metrics: [{ repository: REPO, source: "bi_metric", key: HOVER, class: "accuracy" }] },
      "does not match its source",
    ],
    [
      { metrics: [{ repository: REPO, source: "case_metric", key: "merge_rate", class: "rate" }] },
      "does not match its source",
    ],
    [{ thresholds: { classes: { speed: {} } } }, "not a class"],
    [{ thresholds: { metrics: { "Not A Key": {} } } }, "not a metric"],
    [{ thresholds: { classes: { timing: [] } } }, "must be an object"],
    [{ thresholds: { classes: { timing: { warn: 1 } } } }, "unknown field"],
    [{ thresholds: { classes: { timing: { direction: "sideways" } } } }, "unknown direction"],
    [{ thresholds: { classes: { timing: { warnPct: 5 } } } }, "warnPct and errPct together"],
    [{ thresholds: { classes: { timing: { warnPct: 9, errPct: 2 } } } }, "0 < warnPct ≤ errPct"],
    [{ thresholds: { classes: { timing: { warnPct: 0, errPct: 2 } } } }, "0 < warnPct ≤ errPct"],
    [{ thresholds: { classes: { timing: { minSpreadMultiple: -1 } } } }, "minSpreadMultiple ≥ 0"],
    [{ thresholds: { classes: { timing: { minSamples: 2.5 } } } }, "whole minSamples"],
    [{ thresholds: { classes: { timing: { minSamples: 0 } } } }, "whole minSamples"],
  ])("refuses settings it cannot store (%#)", (body, message) => {
    expect(() => patchOf(plainToInstance(SaveWatchSettingsDto, body))).toThrow(message);
  });

  it("accepts a whole override", () => {
    const patch = patchOf(
      plainToInstance(SaveWatchSettingsDto, {
        thresholds: {
          metrics: {
            merge_rate: {
              direction: "either",
              warnPct: 1,
              errPct: 1,
              minSpreadMultiple: 0,
              minSamples: 1,
            },
          },
        },
      }),
    );

    expect(patch.thresholds?.metrics.merge_rate).toEqual({
      direction: "either",
      warn_pct: 1,
      err_pct: 1,
      min_spread_multiple: 0,
      min_samples: 1,
    });
  });
});

describe("the request bodies", () => {
  const metric = { repository: REPO, source: "case_metric", key: HOVER, class: "accuracy" };

  it("accepts a full settings body and an empty one", async () => {
    expect(await failures(SaveWatchSettingsDto, {})).toEqual([]);
    expect(
      await failures(SaveWatchSettingsDto, {
        metrics: [
          {
            ...metric,
            windowDays: 90,
            replay: { pool: "p", command: ["a", "b"] },
            nightlyRef: "main",
          },
          { ...metric, key: "merge_rate", source: "bi_metric", replay: null },
        ],
        thresholds: { classes: {}, metrics: {} },
        autoBisect: false,
        autoFile: true,
        fixSourceId: "50000000-0000-4000-8000-000000000001",
      }),
    ).toEqual([]);
    expect(await failures(SaveWatchSettingsDto, { fixSourceId: null })).toEqual([]);
  });

  it.each([
    { metrics: "all" },
    { metrics: Array.from({ length: 65 }, () => metric) },
    { metrics: [{ ...metric, repository: "helios" }] },
    { metrics: [{ ...metric, source: "guess" }] },
    { metrics: [{ ...metric, key: "Hover Drift" }] },
    { metrics: [{ ...metric, class: "speed" }] },
    { metrics: [{ ...metric, windowDays: 0 }] },
    { metrics: [{ ...metric, windowDays: 91 }] },
    { metrics: [{ ...metric, windowDays: 1.5 }] },
    { metrics: [{ ...metric, replay: { pool: "  " } }] },
    { metrics: [{ ...metric, replay: { pool: "p", command: [] } }] },
    { metrics: [{ ...metric, replay: { pool: "p", command: ["ok", " "] } }] },
    { metrics: [{ ...metric, nightlyRef: "two words" }] },
    { metrics: [{ ...metric, extra: true }] },
  ])("refuses a bad metric list (%#)", async (body) => {
    expect(await failures(SaveWatchSettingsDto, body)).toEqual(["metrics"]);
  });

  it.each([
    ["autoBisect", { autoBisect: "yes" }],
    ["autoFile", { autoFile: 1 }],
    ["fixSourceId", { fixSourceId: "not-a-uuid" }],
    ["thresholds", { thresholds: { classes: "none" } }],
    ["status", { status: "fixed_merged" }],
  ])("refuses a bad %s", async (property, body) => {
    expect(await failures(SaveWatchSettingsDto, body)).toEqual([property]);
  });

  it("validates a capture, a dismissal and an item id", async () => {
    expect(await failures(CaptureBaselinesDto, { repository: REPO, releaseTag: "v2.0.4" })).toEqual(
      [],
    );
    expect(
      await failures(CaptureBaselinesDto, { repository: "helios", releaseTag: "v 2" }),
    ).toEqual(["repository", "releaseTag"]);
    expect(await failures(CaptureBaselinesDto, {})).toEqual(["repository", "releaseTag"]);
    expect(await failures(DismissItemDto, { reason: " A sensor swap. " })).toEqual([]);
    expect(plainToInstance(DismissItemDto, { reason: " A sensor swap. " }).reason).toBe(
      "A sensor swap.",
    );
    expect(await failures(DismissItemDto, { reason: "   " })).toEqual(["reason"]);
    expect(await failures(DismissItemDto, { reason: "x".repeat(1001) })).toEqual(["reason"]);
    expect(
      await failures(WatchItemParams, { itemId: "17e00000-0000-4000-8000-000000000001" }),
    ).toEqual([]);
    expect(await failures(WatchItemParams, { itemId: "RS-1" })).toEqual(["itemId"]);
  });
});

describe("the refusals", () => {
  it("carry stable codes, statuses and details", () => {
    expect([
      itemNotFound("i").getStatus(),
      itemClosed("i", "dismissed").getStatus(),
      nothingWatched(REPO).getStatus(),
      settingsInvalid("no").getStatus(),
    ]).toEqual([404, 409, 422, 422]);
    expect(WATCH_ERRORS).toEqual({
      itemNotFound: "regression_watch_item_not_found",
      itemClosed: "regression_watch_item_closed",
      nothingWatched: "regression_watch_nothing_watched",
      settingsInvalid: "regression_watch_settings_invalid",
    });
    expect(itemClosed("i", "dismissed").details).toEqual({ itemId: "i", status: "dismissed" });
    expect(settingsInvalid("no", { field: "x" }).details).toEqual({ field: "x" });
    expect(nothingWatched(REPO).details).toEqual({ repository: REPO });
  });
});

describe("the inbox cards", () => {
  it("names a case metric by its measurement and an insights metric by its id", () => {
    expect(metricLabel(HOVER)).toBe("hover_drift_cm");
    expect(metricLabel("merge_rate")).toBe("merge_rate");
  });

  it("keys a card by its item and stage, so each is filed once", () => {
    const detected = driftDetectedEmission(item(), "The watch is bisecting it.");
    const bisected = bisectCompleteEmission(
      item({ bisectResult: BISECT_RESULT }),
      "Opening forensics.",
    );

    expect(detected.key).toEqual({
      plane: "research.watch",
      sourceRef: "item:17e00000-0000-4000-8000-000000000001:detected",
    });
    expect(bisected?.key.sourceRef).toBe("item:17e00000-0000-4000-8000-000000000001:bisected");
    expect(detected.severity).toBe("err");
    expect(driftDetectedEmission(item({ severity: "warn" }), "x").severity).toBe("warn");
    expect(bisected?.payload).toEqual({
      metric: "hover_drift_cm",
      culprit: "a41f2c9",
      repository: REPO,
      release: "v2.0.4",
      steps: 2,
      next_step: "Opening forensics.",
    });
    expect(bisectCompleteEmission(item(), "x")).toBeNull();
  });

  it("reads the item back out of a card's source ref", () => {
    expect(watchItemOf("item:17e00000-0000-4000-8000-000000000001:detected")).toBe(
      "17e00000-0000-4000-8000-000000000001",
    );
    expect(watchItemOf("batch:17e00000-0000-4000-8000-000000000001")).toBeUndefined();
    expect(watchItemOf("item:nope:detected")).toBeUndefined();
  });

  it("declares which kinds its detector settles", () => {
    expect(watchMovedOnDetector()).toMatchObject({
      name: "watch-moved-on",
      kinds: ["regression_drift_detected", "bisect_complete"],
    });
  });
});

describe("a reading as a window", () => {
  it("keeps a sample reading's statistics and normalises its bounds", () => {
    expect(windowOf(fakeReading(5.7, 12) as never)).toEqual({
      status: "ok",
      sources: [],
      window: stats(5.7, { n: 12 }),
    });
  });

  it("has no window for no data, no samples, no bounds or an unstorable unit", () => {
    expect(windowOf(undefined)).toMatchObject({ status: "no_data" });
    expect(
      windowOf({ status: "no_data", window: "7d", from: null, to: null, reason: "empty" }),
    ).toEqual({ status: "no_data", reason: "empty" });
    expect(windowOf({ ...fakeReading(5), n: 0 } as never)).toMatchObject({ status: "no_data" });
    expect(windowOf({ ...fakeReading(5), from: null } as never)).toMatchObject({
      status: "no_data",
    });
    expect(windowOf({ ...fakeReading(5), unit: "furlongs per fortnight" } as never)).toMatchObject({
      status: "no_data",
      reason: expect.stringContaining("unit") as string,
    });
  });

  it("records an unknown spread kind as iqr", () => {
    const read = windowOf({ ...fakeReading(5), spreadKind: "range" } as never);

    expect(read.status === "ok" && read.window.spread_kind).toBe("iqr");
  });

  it("carries the tool's citation with a usable reading only", async () => {
    const telemetry = new FakeTelemetry();
    const readings = new WatchReadings(telemetry.registry() as never);

    const ok = await readings.compare(ORG, HOVER, REPO, "v2.0.4", "7d");
    expect(ok.status === "ok" && ok.sources).toHaveLength(1);
    telemetry.current = { status: "no_data", window: "7d", from: null, to: null, reason: "empty" };
    expect(await readings.compare(ORG, HOVER, REPO, "v2.0.4", "7d")).toEqual({
      status: "no_data",
      reason: "empty",
    });
    telemetry.installed = false;
    expect(await readings.compare(ORG, HOVER, REPO, "v2.0.4", "7d")).toMatchObject({
      reason: "the telemetry tool is not installed",
    });
  });
});

describe("the scheduler's pass", () => {
  const NOW = new Date("2026-10-10T02:00:00Z");
  const logger = { error: jest.fn() };

  beforeEach(() => logger.error.mockClear());

  function world() {
    const store = {
      workspacesDue: jest.fn().mockResolvedValue(["org-a", "org-b"]),
      openItems: jest
        .fn()
        .mockResolvedValue([item({ id: "1" }), item({ id: "2" }), item({ id: "3" })]),
    };
    const watch = { compare: jest.fn().mockResolvedValue({}) };
    const chain = {
      advance: jest
        .fn()
        .mockResolvedValueOnce({ moved: "bisecting" })
        .mockResolvedValueOnce({ waiting: "x" })
        .mockResolvedValueOnce({ rested: "y" })
        .mockResolvedValue({ waiting: "nothing to do" }),
    };
    return { store, watch, chain };
  }

  it("compares each workspace due since the start of the UTC day, then steps every open item", async () => {
    const { store, watch, chain } = world();

    expect(await runPass(store, watch, chain, NOW, logger)).toEqual({
      compared: 2,
      items: 3,
      moved: 1,
    });
    expect(store.workspacesDue).toHaveBeenCalledWith(new Date("2026-10-10T00:00:00Z"));
    expect(watch.compare.mock.calls).toEqual([
      ["org-a", NOW],
      ["org-b", NOW],
    ]);
    expect(chain.advance).toHaveBeenCalledTimes(3);
  });

  it("does not let one workspace or one item stop the rest", async () => {
    const { store, watch, chain } = world();
    watch.compare.mockRejectedValueOnce(new Error("telemetry down"));
    chain.advance
      .mockReset()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ moved: "bisected" });

    expect(await runPass(store, watch, chain, NOW, logger)).toEqual({
      compared: 1,
      items: 3,
      moved: 2,
    });
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it("answers zeros when the pass cannot start, and shares a pass already running", async () => {
    const { store, watch, chain } = world();
    const scheduler = new RegressionWatchScheduler(store, watch, chain, 0);
    jest
      .spyOn((scheduler as unknown as { logger: { error: () => void } }).logger, "error")
      .mockImplementation(() => undefined);

    const [first, second] = await Promise.all([scheduler.tick(NOW), scheduler.tick(NOW)]);
    expect(first).toBe(second);
    expect(store.workspacesDue).toHaveBeenCalledTimes(1);

    store.workspacesDue.mockRejectedValue(new Error("no database"));
    expect(await scheduler.tick(NOW)).toEqual({ compared: 0, items: 0, moved: 0 });
  });

  it("books passes on its tick, never when off, and stops at shutdown", async () => {
    jest.useFakeTimers();
    try {
      const { store, watch, chain } = world();
      const off = new RegressionWatchScheduler(store, watch, chain, 0);
      off.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(600_000);
      expect(store.workspacesDue).not.toHaveBeenCalled();

      const on = new RegressionWatchScheduler(store, watch, chain, 60_000, () => 0.5);
      on.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(61_000);
      expect(store.workspacesDue).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(61_000);
      expect(store.workspacesDue).toHaveBeenCalledTimes(2);
      on.onApplicationShutdown();
      await jest.advanceTimersByTimeAsync(600_000);
      expect(store.workspacesDue).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
