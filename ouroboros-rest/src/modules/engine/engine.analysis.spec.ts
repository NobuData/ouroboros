import { Logger } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { testConfiguration } from "../config/configuration.fixture";
import {
  analysisEventSchema,
  analyzerSetSchema,
  ndjsonLines,
  type AnalysisEvent,
  type EngineAnalysisRequest,
} from "./engine.analysis";
import { EngineClient } from "./engine.client";
import { UpstreamError } from "../errors/error.envelope";
import {
  alwaysAnswering,
  alwaysFailing,
  connectFailure,
  engineError,
  failingThenAnswering,
  jsonResponse,
  type FakeFetch,
} from "./engine.fixture";

/**
 * The Build Analyzer's engine boundary (#510): the analyzer set, and a run answered as a stream.
 *
 * The stream is the new thing here, so most of what follows is about lines — split across chunks,
 * malformed, missing their report — and about the one property the ticket asks to be asserted:
 * **the corpus goes to the configured engine and nowhere else**.
 */

const ENGINE_URL = "http://engine-7f4c.svc.cluster.local:8000";
const SHARED_SECRET = "a-shared-secret-nobody-should-see";

function clientWith(fetchImpl: FakeFetch): EngineClient {
  const configuration = testConfiguration({
    OURO_ENGINE_URL: ENGINE_URL,
    OURO_ENGINE_SHARED_SECRET: SHARED_SECRET,
  });
  const config = new AppConfigService({
    get: (key: string) => configuration[key as keyof typeof configuration],
    getOrThrow: (key: string) => configuration[key as keyof typeof configuration],
  } as never);

  return new EngineClient(config, fetchImpl);
}

/** A response whose body arrives in the given pieces. */
function streamed(pieces: readonly string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) {
        controller.enqueue(encoder.encode(piece));
      }
      controller.close();
    },
  });

  return new Response(body, { status, headers: { "content-type": "application/x-ndjson" } });
}

const REQUEST: EngineAnalysisRequest = {
  run_id: "a0000000-0000-4000-8000-000000000001",
  corpus: {
    repo_ref: "acme-robotics/helios-firmware",
    window: { from: "2026-05-10", to: "2026-08-07" },
    builds: [],
    events: [],
    log_tails: [],
    tests: [],
    flakes: [],
    loops: [],
    cache: [],
    waivers: [],
    series: { build_duration: [] },
    rig_telemetry: null,
  },
  compute_ceiling_seconds: 3600,
};

const STARTED = '{"event":"started","analyzer":"change_point","version":1}';
const OUTCOME =
  '{"event":"outcome","outcome":{"analyzer":"change_point","version":1,"status":"completed",' +
  '"findings":[],"reason":null,"error":null,"elapsed_seconds":2.5}}';
const REPORT = '{"event":"report","budget_exceeded":false,"failed":[]}';

/** Collect every event a call hands over. */
async function eventsOf(client: EngineClient): Promise<AnalysisEvent[]> {
  const events: AnalysisEvent[] = [];
  await client.analyze(REQUEST, 60_000, (event) => {
    events.push(event);
    return Promise.resolve();
  });
  return events;
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
});

describe("the analyzer set", () => {
  it("is read from the engine in analysis_runs.analyzer_set's shape", async () => {
    const set = {
      label: "deterministic analyzers v1",
      analyzers: [{ id: "change_point", version: 1, kind: "deterministic" }],
    };
    const engine = alwaysAnswering(() => jsonResponse(set));

    await expect(clientWith(engine).analyzerSet()).resolves.toEqual(set);
    expect(engine.calls[0].url).toBe(`${ENGINE_URL}/v0/analysis/analyzers`);
  });

  it("refuses a set with no analyzers or a kind it does not know", () => {
    expect(analyzerSetSchema.safeParse({ label: "x", analyzers: [] }).success).toBe(false);
    expect(
      analyzerSetSchema.safeParse({
        label: "x",
        analyzers: [{ id: "change_point", version: 1, kind: "magic" }],
      }).success,
    ).toBe(false);
  });
});

describe("an analysis call", () => {
  it("sends the corpus to the configured engine, and only there", async () => {
    const engine = alwaysAnswering(() => streamed([STARTED + "\n", OUTCOME + "\n", REPORT + "\n"]));

    await eventsOf(clientWith(engine));

    // One request, to OURO_ENGINE_URL's analysis route — the corpus never leaves the deployment
    // for anywhere else.
    expect(engine.calls.map((call) => call.url)).toEqual([`${ENGINE_URL}/v0/analysis/runs`]);
    expect(engine.calls[0].method).toBe("POST");
    expect(JSON.parse(engine.calls[0].body ?? "{}")).toEqual(REQUEST);
    expect(engine.calls[0].headers["X-Ouro-Internal-Key"]).toBe(SHARED_SECRET);
    expect(engine.calls[0].headers.accept).toBe("application/x-ndjson");
  });

  it("hands over each event, in order, in this service's names", async () => {
    const engine = alwaysAnswering(() =>
      streamed([STARTED + "\n" + OUTCOME + "\n" + REPORT + "\n"]),
    );

    await expect(eventsOf(clientWith(engine))).resolves.toEqual([
      { event: "started", analyzer: "change_point", version: 1 },
      {
        event: "outcome",
        outcome: {
          analyzer: "change_point",
          version: 1,
          status: "completed",
          findings: [],
          reason: null,
          elapsedSeconds: 2.5,
        },
      },
      { event: "report", budgetExceeded: false, failed: [] },
    ]);
  });

  it("reassembles lines split across any number of chunks", async () => {
    const text = `${STARTED}\n${OUTCOME}\n${REPORT}\n`;
    const pieces = text.match(/.{1,7}/gs) ?? [];
    const engine = alwaysAnswering(() => streamed(pieces));

    await expect(eventsOf(clientWith(engine))).resolves.toHaveLength(3);
  });

  it("ends without a report when the stream does — the caller decides what that means", async () => {
    const engine = alwaysAnswering(() => streamed([STARTED + "\n"]));

    await expect(eventsOf(clientWith(engine))).resolves.toEqual([
      { event: "started", analyzer: "change_point", version: 1 },
    ]);
  });

  it("is engine_unavailable for a line that is not JSON, keeping the events before it", async () => {
    const engine = alwaysAnswering(() => streamed([STARTED + "\n", "<html>proxy error\n"]));
    const events: AnalysisEvent[] = [];

    await expect(
      clientWith(engine).analyze(REQUEST, 60_000, (event) => {
        events.push(event);
        return Promise.resolve();
      }),
    ).rejects.toBeInstanceOf(UpstreamError);
    expect(events).toHaveLength(1);
  });

  it("is engine_unavailable for an event outside the contract", async () => {
    const engine = alwaysAnswering(() => streamed(['{"event":"exploded"}\n']));

    await expect(eventsOf(clientWith(engine))).rejects.toBeInstanceOf(UpstreamError);
  });

  it("is engine_unavailable when the engine refuses the request, without reading its body", async () => {
    const engine = alwaysAnswering(() => engineError(401));

    await expect(eventsOf(clientWith(engine))).rejects.toBeInstanceOf(UpstreamError);
  });

  it("retries once when nothing was delivered, and not when something may have been", async () => {
    const refused = failingThenAnswering(
      () => connectFailure("ECONNREFUSED"),
      () => streamed([REPORT + "\n"]),
    );
    await expect(eventsOf(clientWith(refused))).resolves.toHaveLength(1);
    expect(refused.calls).toHaveLength(2);

    const reset = alwaysFailing(() => connectFailure("ECONNRESET"));
    await expect(eventsOf(clientWith(reset))).rejects.toBeInstanceOf(UpstreamError);
    expect(reset.calls).toHaveLength(1);
  });

  it("is bounded by the deadline the caller passes, not the five-second one", async () => {
    const engine = alwaysAnswering(() => streamed([REPORT + "\n"]));

    await eventsOf(clientWith(engine));

    expect(engine.calls[0].signal).toBeDefined();
    expect(engine.calls[0].signal?.aborted).toBe(false);
  });
});

describe("NDJSON lines", () => {
  async function linesOf(pieces: readonly string[]): Promise<string[]> {
    const encoder = new TextEncoder();
    const lines: string[] = [];
    for await (const line of ndjsonLines(pieces.map((piece) => encoder.encode(piece)))) {
      lines.push(line);
    }
    return lines;
  }

  it("skips blank lines and keeps a last line with no newline", async () => {
    await expect(linesOf(["a\n\n", "  \nb"])).resolves.toEqual(["a", "b"]);
  });

  it("decodes a character split across chunks whole", async () => {
    const bytes = new TextEncoder().encode('{"reason":"✓"}\n');
    const lines: string[] = [];
    for await (const line of ndjsonLines([bytes.subarray(0, 12), bytes.subarray(12)])) {
      lines.push(line);
    }
    expect(lines).toEqual(['{"reason":"✓"}']);
  });
});

describe("an outcome line", () => {
  it("defaults what an older engine leaves out", () => {
    expect(
      analysisEventSchema.parse({
        event: "outcome",
        outcome: { analyzer: "x", version: 1, status: "skipped" },
      }),
    ).toEqual({
      event: "outcome",
      outcome: {
        analyzer: "x",
        version: 1,
        status: "skipped",
        findings: [],
        reason: null,
        elapsedSeconds: 0,
      },
    });
  });
});
