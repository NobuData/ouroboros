import type { AuditService } from "../../audit/audit.service";
import type { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import type { CodeBisectService } from "../code/code-bisect.service";
import type { ResearchToolRegistry } from "../tools/research-tool.registry";
import {
  FakeTelemetry,
  HOVER,
  MemoryWatchStore,
  ORG,
  REPO,
  baseline,
  fakeReading,
  hoverMetric,
  item,
  callArg,
} from "./watch.fixture";
import type { WatchRepository } from "./watch.repository";
import { RegressionWatchService, nextStepOf, startOfUtcDay, watchedMetric } from "./watch.service";

/**
 * Baselines, the nightly comparison, the card, the settings and dismissal (CM.4, #623), over an
 * in-memory store and a telemetry tool that answers what a test sets.
 */

const NOW = new Date("2026-10-10T02:00:00Z");
const USER = "user-ken";

function harness() {
  const store = new MemoryWatchStore();
  const telemetry = new FakeTelemetry();
  const emit = jest.fn().mockResolvedValue({ status: "filed", itemId: "d1" });
  const cancel = jest.fn().mockResolvedValue(undefined);
  const record = jest.fn().mockResolvedValue(undefined);
  const service = new RegressionWatchService(
    store as unknown as WatchRepository,
    telemetry.registry() as unknown as ResearchToolRegistry,
    { emit } as unknown as DecisionKindRegistry,
    { cancel } as unknown as CodeBisectService,
    { record } as unknown as AuditService,
  );
  store.stored.set(ORG, {
    thresholds: { classes: {}, metrics: {} },
    metrics: [hoverMetric()],
    autoBisect: true,
    autoFile: false,
    fixSourceId: null,
    lastComparedAt: null,
  });
  return { store, telemetry, service, emit, cancel, record };
}

const capture = (service: RegressionWatchService, via: "release" | "manual" = "release") =>
  service.capture(ORG, {
    repository: REPO,
    releaseTag: "v2.0.4",
    via,
    userId: via === "manual" ? USER : null,
  });

describe("capturing baselines", () => {
  it("snapshots each watched metric's window through the telemetry tool", async () => {
    const { service, store, telemetry } = harness();

    const result = await capture(service);

    expect(telemetry.asked).toEqual([
      { op: "metric_window", metric: HOVER, window: "7d", repo: REPO },
    ]);
    expect(result).toMatchObject({ repository: REPO, releaseTag: "v2.0.4", skipped: [] });
    expect(result.captured[0]).toMatchObject({
      metric: HOVER,
      metricLabel: "hover_drift_cm",
      class: "accuracy",
      capturedVia: "release",
      window: { n: 30, median: 5, spread: 0.1, spreadKind: "iqr", unit: "cm" },
    });
    expect(store.baselines).toHaveLength(1);
  });

  it("records a rate, which has no median, as its figure with no spread", async () => {
    const { service, telemetry } = harness();
    telemetry.baseline = {
      ...fakeReading(92),
      unit: "%",
      n: 25,
      basis: "denominator",
      median: null,
      spread: null,
      spreadKind: null,
      from: "2026-10-03",
      to: "2026-10-09",
    };

    const result = await capture(service);

    expect(result.captured[0].window).toEqual({
      n: 25,
      median: 92,
      spread: 0,
      spreadKind: "iqr",
      unit: "%",
      from: "2026-10-03T00:00:00Z",
      to: "2026-10-09T00:00:00Z",
    });
  });

  it("captures nothing from an empty window, and says why", async () => {
    const { service, store, telemetry } = harness();
    telemetry.baseline = {
      status: "no_data",
      window: "7d",
      from: null,
      to: null,
      reason: "nothing was measured",
    };

    expect(await capture(service)).toMatchObject({
      captured: [],
      skipped: [{ metric: HOVER, reason: "nothing was measured" }],
    });
    expect(store.baselines).toEqual([]);
  });

  it("never re-measures a release's baseline", async () => {
    const { service, store } = harness();
    await capture(service);

    const again = await capture(service);

    expect(again.captured).toEqual([]);
    expect(again.skipped[0].reason).toContain("already has this metric's baseline");
    expect(store.baselines).toHaveLength(1);
  });

  it("refuses a by-hand capture of an unwatched repository, and lets a release pass quietly", async () => {
    const { service } = harness();
    const ask = (via: "release" | "manual") =>
      service.capture(ORG, { repository: "acme/other", releaseTag: "v1", via, userId: null });

    await expect(ask("manual")).rejects.toMatchObject({
      status: 422,
      code: "regression_watch_nothing_watched",
    });
    expect(await ask("release")).toMatchObject({ captured: [], skipped: [] });
  });

  it("matches the repository whatever its case", async () => {
    const { service } = harness();

    const result = await service.capture(ORG, {
      repository: "Acme/Helios-Firmware",
      releaseTag: "v2.0.4",
      via: "manual",
      userId: USER,
    });

    expect(result.captured).toHaveLength(1);
  });

  it("says so when this build has no telemetry tool", async () => {
    const { service, telemetry } = harness();
    telemetry.installed = false;

    expect((await capture(service)).skipped[0].reason).toBe("the telemetry tool is not installed");
  });

  it("captures an announced release for every workspace that watches the repository", async () => {
    const { service, store } = harness();
    store.stored.set("org-two", { ...store.stored.get(ORG)!, metrics: [hoverMetric()] });
    store.stored.set("org-three", {
      ...store.stored.get(ORG)!,
      metrics: [hoverMetric({ repo: "acme/other" })],
    });

    expect(await service.released(REPO, "v2.0.4")).toEqual({ workspaces: 2, captured: 2 });
    expect(await service.released("acme/nobody", "v1")).toEqual({ workspaces: 0, captured: 0 });
  });

  it("does not lose a release for the others when one workspace fails", async () => {
    const { service, store } = harness();
    store.stored.set("org-two", store.stored.get(ORG)!);
    const insert = store.insertBaseline.bind(store);
    jest
      .spyOn(store, "insertBaseline")
      .mockImplementation((row) =>
        row.organizationId === ORG ? Promise.reject(new Error("deadlock")) : insert(row),
      );
    jest
      .spyOn((service as unknown as { logger: { error: () => void } }).logger, "error")
      .mockImplementation(() => undefined);

    expect(await service.released(REPO, "v2.0.4")).toEqual({ workspaces: 2, captured: 1 });
  });
});

describe("the nightly comparison", () => {
  async function compared() {
    const bench = harness();
    await capture(bench.service);
    bench.telemetry.asked = [];
    return bench;
  }

  it("compares through the tool's compare, baseline against the metric's window", async () => {
    const { service, telemetry } = await compared();

    await service.compare(ORG, NOW);

    expect(telemetry.asked).toEqual([
      { op: "compare", metric: HOVER, windowA: "baseline:v2.0.4", windowB: "7d", repo: REPO },
    ]);
  });

  it("opens one item for a drift, with its signed drift and severity, and files one card", async () => {
    const { service, store, emit } = await compared();

    const result = await service.compare(ORG, NOW);

    expect(result.comparedAt).toBe(NOW.toISOString());
    expect(result.results).toEqual([
      {
        repository: REPO,
        metric: HOVER,
        outcome: "opened",
        reason: null,
        itemId: store.rows[0].id,
      },
    ]);
    expect(store.rows[0]).toMatchObject({
      status: "detected",
      severity: "err",
      driftValue: 14,
      driftUnit: "%",
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(callArg(emit, 0, 0)).toMatchObject({
      kindId: "regression_drift_detected",
      severity: "err",
      key: { plane: "research.watch", sourceRef: `item:${store.rows[0].id}:detected` },
      payload: {
        metric: "hover_drift_cm",
        drift: "+14%",
        release: "v2.0.4",
        repository: REPO,
        baseline: "median 5 cm (n = 30)",
        current: "median 5.7 cm (n = 12)",
        next_step: "The watch is bisecting it to a commit on the build farm.",
      },
    });
    expect(store.stored.get(ORG)?.lastComparedAt).toEqual(NOW);
  });

  it("refreshes the open item on a second night and files no second card", async () => {
    const { service, store, telemetry, emit } = await compared();
    await service.compare(ORG, NOW);
    telemetry.current = fakeReading(5.4, 12);

    const second = await service.compare(ORG, NOW);

    expect(second.results[0]).toMatchObject({ outcome: "refreshed", itemId: store.rows[0].id });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ driftValue: 8, severity: "warn" });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("opens nothing within thresholds, and nothing without data", async () => {
    const { service, store, telemetry, emit } = await compared();
    telemetry.current = fakeReading(5.01, 12);

    expect((await service.compare(ORG, NOW)).results[0]).toMatchObject({
      outcome: "within",
      itemId: null,
      reason: "a move of 0.01 cm is inside 2× the baseline's own spread (0.2 cm)",
    });
    telemetry.current = {
      status: "no_data",
      window: "7d",
      from: null,
      to: null,
      reason: "no nightly ran",
    };
    expect((await service.compare(ORG, NOW)).results[0]).toMatchObject({
      outcome: "no_data",
      reason: "no nightly ran",
    });
    expect(store.rows).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it("clears an open item's severity when the drift is gone, and leaves its journey", async () => {
    const { service, store, telemetry } = await compared();
    await service.compare(ORG, NOW);
    store.patch(ORG, store.rows[0].id, { status: "investigation_open" });
    telemetry.current = fakeReading(5.01, 12);

    expect((await service.compare(ORG, NOW)).results[0].outcome).toBe("cleared");
    expect(store.rows[0]).toMatchObject({
      severity: "ok",
      status: "investigation_open",
      driftValue: 0.01,
      driftUnit: "cm",
    });
  });

  it("leaves an open item alone on a night with too few samples", async () => {
    const { service, store, telemetry } = await compared();
    await service.compare(ORG, NOW);
    telemetry.current = fakeReading(9, 2);

    expect((await service.compare(ORG, NOW)).results[0].outcome).toBe("within");
    expect(store.rows[0]).toMatchObject({ severity: "err", driftValue: 14 });
  });

  it("follows the workspace's thresholds", async () => {
    const { service, store, telemetry } = await compared();
    telemetry.current = fakeReading(5.3, 12);
    expect((await service.compare(ORG, NOW)).results[0].outcome).toBe("opened");
    expect(store.rows[0].severity).toBe("warn");

    store.rows = [];
    store.stored.set(ORG, {
      ...store.stored.get(ORG)!,
      thresholds: { classes: {}, metrics: { [HOVER]: { warn_pct: 20, err_pct: 40 } } },
    });
    expect((await service.compare(ORG, NOW)).results[0]).toMatchObject({
      outcome: "within",
      reason: "a move of 6% is under the 20% warning threshold",
    });
  });

  it("uses the newest baseline of a metric, and seven days for one no longer watched", async () => {
    const { service, store, telemetry } = await compared();
    store.baselines.push(
      baseline({
        id: "ba5e0000-0000-4000-8000-00000000000f",
        releaseTag: "v2.1.0",
        capturedAt: new Date("2026-10-09T00:00:00Z"),
      }),
    );
    store.stored.set(ORG, { ...store.stored.get(ORG)!, metrics: [] });

    await service.compare(ORG, NOW);

    expect(telemetry.asked).toEqual([
      { op: "compare", metric: HOVER, windowA: "baseline:v2.1.0", windowB: "7d", repo: REPO },
    ]);
  });

  it("opens the item even when the card cannot be filed", async () => {
    const { service, store, emit } = await compared();
    emit.mockRejectedValue(new Error("inbox down"));
    jest
      .spyOn((service as unknown as { logger: { error: () => void } }).logger, "error")
      .mockImplementation(() => undefined);

    expect((await service.compare(ORG, NOW)).results[0].outcome).toBe("opened");
    expect(store.rows).toHaveLength(1);
  });
});

describe("nextStepOf", () => {
  it("says what happens after detection", () => {
    expect(nextStepOf(true, hoverMetric())).toBe(
      "The watch is bisecting it to a commit on the build farm.",
    );
    expect(nextStepOf(false, hoverMetric())).toContain("Automatic bisects are off");
    expect(nextStepOf(true, hoverMetric({ replay: null }))).toContain("needs a repro");
    expect(nextStepOf(true, undefined)).toContain("needs a repro");
  });
});

describe("the card and the settings", () => {
  it("lists items under the release's headline", async () => {
    const { service, store } = harness();
    store.baselines = [baseline()];
    store.rows = [
      item(),
      item({ id: "17e00000-0000-4000-8000-000000000002", status: "dismissed", severity: "warn" }),
    ];

    expect(await service.card(ORG)).toMatchObject({
      headline: "nightly vs. v2.0.4 baseline",
      releases: ["v2.0.4"],
      counts: { open: 1, err: 1, warn: 0 },
      baselines: 1,
      lastComparedAt: null,
    });
    expect(await service.card("org-other")).toMatchObject({
      headline: null,
      items: [],
      baselines: 0,
    });
  });

  it("reads the defaults for a workspace that stored nothing", async () => {
    const { service } = harness();

    expect(await service.settings("org-new")).toMatchObject({
      metrics: [],
      autoBisect: true,
      autoFile: false,
      fixSourceId: null,
      thresholds: { classes: {}, metrics: {} },
    });
  });

  it("saves a change and audits a policy change — and only a policy change", async () => {
    const { service, record } = harness();

    await service.saveSettings(ORG, USER, { metrics: [hoverMetric({ window_days: 14 })] });
    expect(record).not.toHaveBeenCalled();

    const saved = await service.saveSettings(ORG, USER, { autoFile: true });
    expect(saved).toMatchObject({
      autoFile: true,
      autoBisect: true,
      metrics: [{ windowDays: 14 }],
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(callArg(record, 0, 0)).toMatchObject({
      organizationId: ORG,
      actorId: USER,
      action: "regression_watch.policy_updated",
      subjectType: "regression_watch_settings",
      subjectId: ORG,
      detail: {
        previousAutoBisect: true,
        autoBisect: true,
        previousAutoFile: false,
        autoFile: true,
      },
    });

    await service.saveSettings(ORG, USER, { autoFile: true });
    expect(record).toHaveBeenCalledTimes(1);
    await service.saveSettings(ORG, USER, { autoBisect: false });
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("refuses a ticket source or an insights metric that does not exist", async () => {
    const { service, store } = harness();

    await expect(
      service.saveSettings(ORG, USER, { fixSourceId: "50000000-0000-4000-8000-00000000dead" }),
    ).rejects.toMatchObject({ status: 422, code: "regression_watch_settings_invalid" });
    await expect(
      service.saveSettings(ORG, USER, {
        metrics: [hoverMetric({ source: "bi_metric", key: "no_such_metric" })],
      }),
    ).rejects.toMatchObject({
      code: "regression_watch_settings_invalid",
      details: { metrics: ["no_such_metric"] },
    });
    expect(
      await service.saveSettings(ORG, USER, {
        fixSourceId: store.sources[0],
        metrics: [hoverMetric({ source: "bi_metric", key: "merge_rate", class: "rate" })],
      }),
    ).toMatchObject({ fixSourceId: store.sources[0] });
    expect(await service.saveSettings(ORG, USER, { fixSourceId: null })).toMatchObject({
      fixSourceId: null,
    });
  });

  it("names the constraint when the database refuses the shape, and lets other failures through", async () => {
    const { service, store } = harness();
    const refuse = jest.spyOn(store, "saveSettings");

    refuse.mockRejectedValueOnce(
      Object.assign(new Error("check"), { constraint: "regression_watch_settings_metrics_shape" }),
    );
    await expect(service.saveSettings(ORG, USER, { autoBisect: false })).rejects.toMatchObject({
      code: "regression_watch_settings_invalid",
      details: { constraint: "regression_watch_settings_metrics_shape" },
    });
    refuse.mockRejectedValueOnce(new Error("the pool is gone"));
    await expect(service.saveSettings(ORG, USER, { autoBisect: false })).rejects.toThrow(
      "the pool is gone",
    );
  });
});

describe("dismissing", () => {
  it("dismisses an open item", async () => {
    const { service, store, cancel } = harness();
    store.rows = [item()];

    expect(await service.dismiss(ORG, USER, store.rows[0].id, "Sensor swap.")).toMatchObject({
      status: "dismissed",
      pill: { label: "dismissed", tone: "idle" },
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels the bisect a dismissed item was waiting on, and dismisses even if that fails", async () => {
    const { service, store, cancel } = harness();
    store.rows = [item({ status: "bisecting", bisectId: "b1" })];
    cancel.mockRejectedValue(new Error("gone"));
    jest
      .spyOn((service as unknown as { logger: { warn: () => void } }).logger, "warn")
      .mockImplementation(() => undefined);

    expect((await service.dismiss(ORG, USER, store.rows[0].id, "No.")).status).toBe("dismissed");
    expect(cancel).toHaveBeenCalledWith(ORG, "b1");
  });

  it("answers not-found for an unknown item and another workspace's", async () => {
    const { service, store } = harness();
    store.rows = [item()];

    await expect(
      service.dismiss(ORG, USER, "17e00000-0000-4000-8000-00000000dead", "x"),
    ).rejects.toMatchObject({
      status: 404,
      code: "regression_watch_item_not_found",
    });
    await expect(service.dismiss("org-other", USER, store.rows[0].id, "x")).rejects.toMatchObject({
      code: "regression_watch_item_not_found",
    });
    expect(store.rows[0].status).toBe("detected");
  });

  it.each(["fixed_merged", "dismissed"] as const)(
    "refuses an item that is already %s",
    async (status) => {
      const { service, store } = harness();
      store.rows = [item({ status })];

      await expect(service.dismiss(ORG, USER, store.rows[0].id, "x")).rejects.toMatchObject({
        status: 409,
        code: "regression_watch_item_closed",
        details: { status },
      });
    },
  );

  it("answers closed when the item ended between the read and the write", async () => {
    const { service, store } = harness();
    store.rows = [item()];
    jest.spyOn(store, "dismiss").mockImplementation(() => {
      store.patch(ORG, store.rows[0].id, { status: "fixed_merged" });
      return Promise.resolve(false);
    });

    await expect(service.dismiss(ORG, USER, store.rows[0].id, "x")).rejects.toMatchObject({
      code: "regression_watch_item_closed",
      details: { status: "fixed_merged" },
    });
  });
});

describe("helpers", () => {
  it("finds the first instant of a UTC day", () => {
    expect(startOfUtcDay(new Date("2026-10-10T23:59:59Z")).toISOString()).toBe(
      "2026-10-10T00:00:00.000Z",
    );
  });

  it("matches a baseline to its watched metric by repository and key", () => {
    const metrics = [
      hoverMetric({ repo: "Acme/Helios-Firmware" }),
      hoverMetric({ repo: "acme/other" }),
    ];

    expect(watchedMetric(metrics, baseline())?.repo).toBe("Acme/Helios-Firmware");
    expect(watchedMetric(metrics, baseline({ metricKey: "merge_rate" }))).toBeUndefined();
  });
});
