import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ModelPullProgress } from "./provider.adapter";
import { ProviderAdapterError } from "./provider.errors";
import {
  MAX_ACTIVE_PULLS_PER_CONNECTION,
  MAX_PULL_RECORDS_PER_CONNECTION,
  ModelPullTracker,
  PULL_FAILED_DETAIL,
  PULL_INTERRUPTED_DETAIL,
  PULL_QUEUED_STATUS,
  PULL_RETENTION_MS,
  PULL_STARTING_STATUS,
  PULL_UNFINISHED_DETAIL,
  isTerminalPullState,
  pullPercent,
} from "./provider.pulls";

/**
 * Server-side pull tracking — AC.4's ([#219](https://github.com/NobuData/ouroboros/issues/219))
 * third and fourth acceptance criteria, which are the two that cannot be proved by looking at an
 * adapter.
 *
 * ```
 * progress is server-tracked   →  a read mid-pull answers the current percentage
 * a second request queues      →  and the daemon has not been asked for it yet
 * ```
 *
 * *"Reloading the page mid-pull shows the pull still running at its current percentage"* is
 * tested here as what it actually is: **a read that is not the reader who started the pull**. A
 * browser reload is a new request against the same process, and the property that makes it work
 * is that the record outlives whoever asked for it — which is a thing a test can check by simply
 * asking again.
 *
 * The pull sources below are scripted generators rather than the Ollama adapter: this class has
 * no idea which provider it is watching, and a suite that drove it through a recorded daemon
 * would be testing the adapter twice. `adapters/ollama.adapter.spec.ts` is where the stream
 * itself is proved.
 */

/** A pull whose events the test releases one at a time. */
interface GatedPull {
  /** What {@link ModelPullTracker.request} is given. */
  readonly open: () => AsyncIterable<ModelPullProgress>;
  /** Whether the tracker has started reading. */
  started: () => boolean;
  /** Release one event and let the tracker apply it. */
  emit: (event: ModelPullProgress) => Promise<void>;
  /** End the stream without another event. */
  end: () => Promise<void>;
  /** Fail the stream. */
  fail: (error: unknown) => Promise<void>;
}

/**
 * Let every pending microtask and I/O callback run.
 *
 * The tracker's drain is a detached task, so a test that asserted straight after `emit` would be
 * asserting against a record the loop has not reached yet. `setImmediate` is the shortest wait
 * that is definitely after one.
 *
 * @returns A promise for the next tick of the event loop.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * A pull the test drives.
 *
 * @returns The gate.
 */
function gatedPull(): GatedPull {
  type Step =
    | { readonly kind: "event"; readonly event: ModelPullProgress }
    | { readonly kind: "end" }
    | { readonly kind: "fail"; readonly error: unknown };

  const steps: Step[] = [];
  let wake: (() => void) | null = null;
  let started = false;

  async function* open(): AsyncIterable<ModelPullProgress> {
    started = true;

    for (;;) {
      while (steps.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }

      const step = steps.shift() as Step;

      if (step.kind === "end") {
        return;
      }

      if (step.kind === "fail") {
        throw step.error;
      }

      yield step.event;
    }
  }

  const push = async (step: Step): Promise<void> => {
    steps.push(step);
    wake?.();
    wake = null;

    await flush();
  };

  return {
    open,
    started: () => started,
    emit: (event) => push({ kind: "event", event }),
    end: () => push({ kind: "end" }),
    fail: (error) => push({ kind: "fail", error }),
  };
}

/**
 * A pull that reports exactly these events and stops.
 *
 * @param events - What to report.
 * @returns A thunk fit for {@link ModelPullTracker.request}.
 */
function scriptedPull(
  events: readonly ModelPullProgress[],
): () => AsyncIterable<ModelPullProgress> {
  // eslint-disable-next-line @typescript-eslint/require-await
  return async function* stream(): AsyncIterable<ModelPullProgress> {
    for (const event of events) {
      yield event;
    }
  };
}

/** A progress event, with the fields a case does not care about filled in. */
function progress(partial: Partial<ModelPullProgress> = {}): ModelPullProgress {
  return {
    status: "downloading",
    completedBytes: null,
    totalBytes: null,
    done: false,
    ...partial,
  };
}

/** The terminal event every successful pull ends with. */
const SUCCESS = progress({ status: "success", done: true });

const CONNECTION = "00000000-0000-4000-8000-000000000219";
const OTHER_CONNECTION = "00000000-0000-4000-8000-00000000021a";

describe("requesting a pull", () => {
  it("starts the first one immediately, without waiting for it", () => {
    // The record is answered synchronously and says `running`: an HTTP handler over this answers
    // `202`, rather than holding a connection open for twenty minutes.
    const tracker = new ModelPullTracker();

    const record = tracker.request({
      connectionId: CONNECTION,
      modelId: "phi4:14b",
      open: scriptedPull([SUCCESS]),
    });

    expect(record).toMatchObject({
      connectionId: CONNECTION,
      modelId: "phi4:14b",
      state: "running",
      status: PULL_STARTING_STATUS,
      percent: null,
    });
    expect(record.startedAt).toBeInstanceOf(Date);
    expect(record.finishedAt).toBeNull();
  });

  it("queues a second one on the same connection, and does not open it", async () => {
    // AC.4's fourth acceptance criterion. `started()` is the half that matters: a *queued* state
    // that had already asked the daemon for the model would be two concurrent transfers with one
    // of them mislabelled.
    const tracker = new ModelPullTracker();
    const first = gatedPull();
    const second = gatedPull();

    tracker.request({ connectionId: CONNECTION, modelId: "phi4:14b", open: first.open });
    const queued = tracker.request({
      connectionId: CONNECTION,
      modelId: "llama4:scout",
      open: second.open,
    });
    await flush();

    expect(queued).toMatchObject({ state: "queued", status: PULL_QUEUED_STATUS });
    expect(queued.startedAt).toBeNull();
    expect(first.started()).toBe(true);
    expect(second.started()).toBe(false);
    expect(MAX_ACTIVE_PULLS_PER_CONNECTION).toBe(1);
  });

  it("runs the queued one when the first finishes", async () => {
    const tracker = new ModelPullTracker();
    const first = gatedPull();
    const second = gatedPull();

    tracker.request({ connectionId: CONNECTION, modelId: "phi4:14b", open: first.open });
    tracker.request({ connectionId: CONNECTION, modelId: "llama4:scout", open: second.open });
    await flush();

    await first.emit(SUCCESS);
    await first.end();

    expect(tracker.find(CONNECTION, "phi4:14b")).toMatchObject({ state: "succeeded" });
    expect(tracker.find(CONNECTION, "llama4:scout")).toMatchObject({ state: "running" });
    expect(second.started()).toBe(true);
  });

  it("runs the queued one even when the first fails", async () => {
    // A lane that stalled on a failure would be a card whose second row said *queued* forever.
    const tracker = new ModelPullTracker();
    const first = gatedPull();
    const second = gatedPull();

    tracker.request({ connectionId: CONNECTION, modelId: "phi4:14b", open: first.open });
    tracker.request({ connectionId: CONNECTION, modelId: "llama4:scout", open: second.open });
    await flush();
    await first.fail(new ProviderAdapterError("upstream", "the host reported the pull failed"));

    expect(tracker.find(CONNECTION, "llama4:scout")).toMatchObject({ state: "running" });
  });

  it("runs pulls on different connections at the same time", async () => {
    // The bound is per connection, because the resource it protects is one box's disk and network
    // link. Two hosts are two boxes.
    const tracker = new ModelPullTracker();
    const here = gatedPull();
    const there = gatedPull();

    tracker.request({ connectionId: CONNECTION, modelId: "phi4:14b", open: here.open });
    const other = tracker.request({
      connectionId: OTHER_CONNECTION,
      modelId: "phi4:14b",
      open: there.open,
    });
    await flush();

    expect(other.state).toBe("running");
    expect(here.started() && there.started()).toBe(true);
  });

  it("answers the existing record when the same model is asked for twice", async () => {
    // Somebody clicking **Pull latest** twice because the first click did not appear to do
    // anything is the commonest interaction there is.
    const tracker = new ModelPullTracker();
    const first = gatedPull();
    const again = gatedPull();

    const started = tracker.request({
      connectionId: CONNECTION,
      modelId: "phi4:14b",
      open: first.open,
    });
    await flush();
    const second = tracker.request({
      connectionId: CONNECTION,
      modelId: "phi4:14b",
      open: again.open,
    });

    expect(second.queuedAt).toEqual(started.queuedAt);
    expect(second.state).toBe("running");
    expect(again.started()).toBe(false);
    expect(tracker.list(CONNECTION)).toHaveLength(1);
  });

  it("answers the existing record when the same model is already queued", async () => {
    const tracker = new ModelPullTracker();
    const running = gatedPull();

    tracker.request({ connectionId: CONNECTION, modelId: "phi4:14b", open: running.open });
    tracker.request({
      connectionId: CONNECTION,
      modelId: "llama4:scout",
      open: scriptedPull([SUCCESS]),
    });
    await flush();
    const again = tracker.request({
      connectionId: CONNECTION,
      modelId: "llama4:scout",
      open: scriptedPull([SUCCESS]),
    });

    expect(again.state).toBe("queued");
    expect(tracker.list(CONNECTION)).toHaveLength(2);
  });

  it("pulls a finished model again, because Pull latest is a real instruction", async () => {
    // A succeeded record is a notification, not a lock: the whole point of the button is that a
    // model already on the host has a newer version.
    const tracker = new ModelPullTracker();

    tracker.request({
      connectionId: CONNECTION,
      modelId: "phi4:14b",
      open: scriptedPull([SUCCESS]),
    });
    await tracker.whenSettled(CONNECTION, "phi4:14b");

    const again = tracker.request({
      connectionId: CONNECTION,
      modelId: "phi4:14b",
      open: scriptedPull([SUCCESS]),
    });

    expect(again.state).toBe("running");
    expect(again.finishedAt).toBeNull();
  });
});

describe("what a reader sees while a pull is running", () => {
  it("answers the current percentage to somebody who did not start it", async () => {
    // AC.4's third acceptance criterion. A page reload is a new request against the same process,
    // and this is what it finds: the same record, at the point the transfer has reached.
    const tracker = new ModelPullTracker();
    const pull = gatedPull();

    tracker.request({ connectionId: CONNECTION, modelId: "llama4:scout", open: pull.open });
    await pull.emit(progress({ status: "pulling manifest" }));

    expect(tracker.find(CONNECTION, "llama4:scout")).toMatchObject({
      state: "running",
      status: "pulling manifest",
      // Null, not zero: the daemon has not said how big it is, and `0%` would be a claim about a
      // transfer nothing has measured.
      percent: null,
    });

    await pull.emit(
      progress({
        status: "pulling c6a2f1e3287b",
        completedBytes: 38_412_152_474,
        totalBytes: 62_970_741_760,
      }),
    );

    expect(tracker.find(CONNECTION, "llama4:scout")).toMatchObject({
      state: "running",
      status: "pulling c6a2f1e3287b",
      completedBytes: 38_412_152_474,
      totalBytes: 62_970_741_760,
      percent: 61,
    });
  });

  it("names the running pull on a connection", async () => {
    const tracker = new ModelPullTracker();
    const pull = gatedPull();

    expect(tracker.active(CONNECTION)).toBeUndefined();

    tracker.request({ connectionId: CONNECTION, modelId: "llama4:scout", open: pull.open });
    tracker.request({
      connectionId: CONNECTION,
      modelId: "phi4:14b",
      open: scriptedPull([SUCCESS]),
    });
    await flush();

    expect(tracker.active(CONNECTION)).toMatchObject({ modelId: "llama4:scout" });
  });

  it("lists a connection's pulls in the order they were asked for", async () => {
    const tracker = new ModelPullTracker();
    const pull = gatedPull();

    tracker.request({ connectionId: CONNECTION, modelId: "llama4:scout", open: pull.open });
    tracker.request({
      connectionId: CONNECTION,
      modelId: "phi4:14b",
      open: scriptedPull([SUCCESS]),
    });
    tracker.request({
      connectionId: CONNECTION,
      modelId: "qwen3-coder:32b",
      open: scriptedPull([SUCCESS]),
    });
    await flush();

    expect(tracker.list(CONNECTION).map((record) => record.modelId)).toEqual([
      "llama4:scout",
      "phi4:14b",
      "qwen3-coder:32b",
    ]);
  });

  it("knows nothing about a connection nobody has pulled on", () => {
    expect(new ModelPullTracker().list(CONNECTION)).toEqual([]);
    expect(new ModelPullTracker().find(CONNECTION, "phi4:14b")).toBeUndefined();
    expect(new ModelPullTracker().active(CONNECTION)).toBeUndefined();
    expect(new ModelPullTracker().whenSettled(CONNECTION, "phi4:14b")).toBeUndefined();
  });

  it("hands out a frozen snapshot rather than a live view", async () => {
    // A caller holds one of these while rendering a response. Watching it change halfway through
    // would put two different percentages in one payload.
    const tracker = new ModelPullTracker();
    const pull = gatedPull();

    tracker.request({ connectionId: CONNECTION, modelId: "llama4:scout", open: pull.open });
    const before = tracker.find(CONNECTION, "llama4:scout");

    await pull.emit(progress({ completedBytes: 5, totalBytes: 10 }));

    expect(Object.isFrozen(before)).toBe(true);
    expect(before?.percent).toBeNull();
    expect(tracker.find(CONNECTION, "llama4:scout")?.percent).toBe(50);
  });
});

describe("how a pull ends", () => {
  it("succeeds on the stream's own terminal event", async () => {
    const tracker = new ModelPullTracker();

    tracker.request({
      connectionId: CONNECTION,
      modelId: "phi4:14b",
      open: scriptedPull([progress({ status: "pulling manifest" }), SUCCESS]),
    });
    const settled = await tracker.whenSettled(CONNECTION, "phi4:14b");

    expect(settled).toMatchObject({
      state: "succeeded",
      // The daemon's last word, kept — `state` is what says it worked.
      status: "success",
      errorClass: null,
      detail: null,
    });
    expect(settled?.finishedAt).toBeInstanceOf(Date);
    expect(isTerminalPullState(settled?.state ?? "queued")).toBe(true);
  });

  it("carries an adapter failure's class and sentence through", async () => {
    // The five-word taxonomy, so a card renders the same pill for a failed pull that it renders
    // for a failed test connection.
    const tracker = new ModelPullTracker();
    const pull = gatedPull();

    tracker.request({ connectionId: CONNECTION, modelId: "phi4:14b", open: pull.open });
    await pull.emit(progress({ status: "pulling manifest" }));
    await pull.fail(new ProviderAdapterError("upstream", "the host reported the pull failed"));

    expect(await tracker.whenSettled(CONNECTION, "phi4:14b")).toMatchObject({
      state: "failed",
      errorClass: "upstream",
      detail: "the host reported the pull failed",
      // What it was doing when it stopped, left alone: the useful half of a failure.
      status: "pulling manifest",
    });
  });

  it("keeps an unexpected failure's message inside the process", async () => {
    // An error this service produced is not a statement about what a provider did, and a stack
    // trace is not a sentence written for a client.
    const tracker = new ModelPullTracker();
    const pull = gatedPull();

    tracker.request({ connectionId: CONNECTION, modelId: "phi4:14b", open: pull.open });
    await pull.fail(new TypeError("cannot read properties of undefined (reading 'root')"));

    const settled = await tracker.whenSettled(CONNECTION, "phi4:14b");

    expect(settled).toMatchObject({
      state: "failed",
      errorClass: null,
      detail: PULL_FAILED_DETAIL,
    });
    expect(settled?.detail).not.toContain("undefined");
  });

  it("refuses to call a stream that just stopped a success", async () => {
    // Completion is a statement the stream makes. Inferring it from the iterator finishing would
    // report a model as present that is not there.
    const tracker = new ModelPullTracker();

    tracker.request({
      connectionId: CONNECTION,
      modelId: "phi4:14b",
      open: scriptedPull([progress({ status: "pulling manifest" })]),
    });

    expect(await tracker.whenSettled(CONNECTION, "phi4:14b")).toMatchObject({
      state: "failed",
      errorClass: "upstream",
      detail: PULL_UNFINISHED_DETAIL,
    });
  });

  it("resolves whenSettled immediately for a pull that already finished", async () => {
    const tracker = new ModelPullTracker();

    tracker.request({
      connectionId: CONNECTION,
      modelId: "phi4:14b",
      open: scriptedPull([SUCCESS]),
    });
    await tracker.whenSettled(CONNECTION, "phi4:14b");

    await expect(tracker.whenSettled(CONNECTION, "phi4:14b")).resolves.toMatchObject({
      state: "succeeded",
    });
  });
});

describe("shutting down", () => {
  it("marks what was running and what was queued as interrupted", async () => {
    // Synchronous on purpose: Nest awaits an `onModuleDestroy` that returns a promise, and waiting
    // for a 63 GB transfer to notice would turn every deployment into a shutdown that hangs.
    const tracker = new ModelPullTracker();
    const pull = gatedPull();

    tracker.request({ connectionId: CONNECTION, modelId: "llama4:scout", open: pull.open });
    tracker.request({
      connectionId: CONNECTION,
      modelId: "phi4:14b",
      open: scriptedPull([SUCCESS]),
    });
    await flush();

    tracker.onModuleDestroy();

    for (const modelId of ["llama4:scout", "phi4:14b"]) {
      expect(tracker.find(CONNECTION, modelId)).toMatchObject({
        state: "failed",
        // No error class: an interrupted pull is not the daemon's fault, and the taxonomy
        // describes what a provider did.
        errorClass: null,
        detail: PULL_INTERRUPTED_DETAIL,
      });
    }
  });

  it("stops reading the stream, which is what closes the socket", async () => {
    const tracker = new ModelPullTracker();
    let cancelled = false;

    async function* stream(): AsyncIterable<ModelPullProgress> {
      try {
        for (;;) {
          yield progress({ completedBytes: 1, totalBytes: 10 });
          await flush();
        }
      } finally {
        // What the adapter's own `finally` does: abort the request, cancel the body.
        cancelled = true;
      }
    }

    tracker.request({ connectionId: CONNECTION, modelId: "llama4:scout", open: stream });
    await flush();

    tracker.onModuleDestroy();
    await flush();

    expect(cancelled).toBe(true);
  });

  it("does not overwrite a pull that had already succeeded", async () => {
    // A shutdown that reported a model which really did arrive as one that did not would be worse
    // than saying nothing.
    const tracker = new ModelPullTracker();

    tracker.request({
      connectionId: CONNECTION,
      modelId: "phi4:14b",
      open: scriptedPull([SUCCESS]),
    });
    await tracker.whenSettled(CONNECTION, "phi4:14b");

    tracker.onModuleDestroy();

    expect(tracker.find(CONNECTION, "phi4:14b")).toMatchObject({ state: "succeeded" });
  });

  it("starts nothing new afterwards", () => {
    const tracker = new ModelPullTracker();
    const pull = gatedPull();

    tracker.onModuleDestroy();
    const record = tracker.request({
      connectionId: CONNECTION,
      modelId: "phi4:14b",
      open: pull.open,
    });

    expect(record.state).toBe("queued");
    expect(pull.started()).toBe(false);
  });
});

describe("what a tracker forgets", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("drops a finished record once its retention window has passed", async () => {
    // A finished record is a notification. `provider_models` is where the durable answer lives —
    // the model is either on the host at the next discovery or it is not.
    const tracker = new ModelPullTracker();

    tracker.request({
      connectionId: CONNECTION,
      modelId: "phi4:14b",
      open: scriptedPull([SUCCESS]),
    });
    await tracker.whenSettled(CONNECTION, "phi4:14b");

    expect(tracker.find(CONNECTION, "phi4:14b")).toMatchObject({ state: "succeeded" });

    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + PULL_RETENTION_MS + 1_000);

    expect(tracker.find(CONNECTION, "phi4:14b")).toBeUndefined();
    expect(tracker.list(CONNECTION)).toEqual([]);
  });

  it("keeps a finished record inside the window", async () => {
    const tracker = new ModelPullTracker();

    tracker.request({
      connectionId: CONNECTION,
      modelId: "phi4:14b",
      open: scriptedPull([SUCCESS]),
    });
    await tracker.whenSettled(CONNECTION, "phi4:14b");

    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + PULL_RETENTION_MS - 1_000);

    expect(tracker.find(CONNECTION, "phi4:14b")).toMatchObject({ state: "succeeded" });
  });

  it("caps how many finished records one connection keeps, oldest first", async () => {
    // The interesting leak is not slow: it is something looping over a catalog and requesting
    // thirty pulls inside the retention window.
    const tracker = new ModelPullTracker();
    const wanted = MAX_PULL_RECORDS_PER_CONNECTION + 4;

    for (let index = 0; index < wanted; index++) {
      tracker.request({
        connectionId: CONNECTION,
        modelId: `model:${index.toString()}`,
        open: scriptedPull([SUCCESS]),
      });
      await tracker.whenSettled(CONNECTION, `model:${index.toString()}`);
    }

    const kept = tracker.list(CONNECTION).map((record) => record.modelId);

    expect(kept.length).toBeLessThanOrEqual(MAX_PULL_RECORDS_PER_CONNECTION);
    expect(kept).not.toContain("model:0");
    expect(kept).toContain(`model:${(wanted - 1).toString()}`);
  });

  it("never drops something that is still queued or running", async () => {
    const tracker = new ModelPullTracker();
    const pull = gatedPull();

    tracker.request({ connectionId: CONNECTION, modelId: "llama4:scout", open: pull.open });
    await flush();

    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + PULL_RETENTION_MS * 4);

    expect(tracker.find(CONNECTION, "llama4:scout")).toMatchObject({ state: "running" });
  });
});

describe("pullPercent", () => {
  it.each([
    [0, 10, 0],
    [5, 10, 50],
    [38_412_152_474, 62_970_741_760, 61],
    [10, 10, 100],
    // Floored rather than rounded: a bar must never read 100% while bytes are still moving.
    [999, 1000, 99],
  ])("reads %p of %p as %p%%", (completed, total, expected) => {
    expect(pullPercent(completed, total)).toBe(expected);
  });

  it.each([
    ["no total", 5, null],
    ["no completed", null, 10],
    ["neither", null, null],
    // A daemon reporting a zero-byte total is reporting something wrong; the answer is *unknown*
    // rather than a division that produces Infinity or NaN.
    ["a zero total", 5, 0],
  ])("answers null for %s", (_case, completed, total) => {
    expect(pullPercent(completed, total)).toBeNull();
  });

  it("clamps rather than reporting more than a whole", () => {
    expect(pullPercent(12, 10)).toBe(100);
  });
});

describe("the tracker's credential discipline", () => {
  /** This module's own source, with its prose stripped. */
  const code = readFileSync(join(__dirname, "provider.pulls.ts"), "utf8").replaceAll(
    /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
    "",
  );

  it("never mentions a credential, because it is handed a thunk instead of a connection", () => {
    // A pull is the one operation in this service that lives for minutes. A tracker that held a
    // `ProviderConnectionContext` would be one where an opened credential's lifetime was the
    // length of a 63 GB download rather than the length of a request.
    expect(code).not.toContain("secret");
    expect(code).not.toContain("ProviderConnectionContext");
  });

  it("never imports an adapter, so it cannot become a second door to pullModel", () => {
    // `ModelProviderRegistry.pullCapable` is the only one. `.dependency-cruiser.cjs` enforces the
    // same thing from the outside; this is the assertion that the intent is also readable here.
    expect(code).not.toContain("adapters/");
    expect(code).not.toContain("pullCapable(");
  });

  it("has no logger at all", () => {
    expect(code).not.toContain("Logger");
    expect(code).not.toContain("console.");
  });
});
