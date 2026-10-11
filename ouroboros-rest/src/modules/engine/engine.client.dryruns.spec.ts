import { Logger } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { testConfiguration } from "../config/configuration.fixture";
import { EngineClient } from "./engine.client";
import type { EngineDryRunEvent, EngineDryRunRequest } from "./engine.dryruns";
import { ENGINE_DRY_RUN_WIRE } from "./engine.dryruns.fixture";
import { ENGINE_ERRORS } from "./engine.errors";
import {
  alwaysAnswering,
  engineError,
  fakeFetch,
  jsonResponse,
  type FakeFetch,
} from "./engine.fixture";

const ENGINE_URL = "http://engine-7f4c.svc.cluster.local:8000";
const SHARED_SECRET = "a-shared-secret-nobody-should-see";

function clientWith(fetchImpl: FakeFetch | typeof fetch): EngineClient {
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
function streamed(pieces: readonly string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
}

const REQUEST: EngineDryRunRequest = {
  dryRun: "5eed008b-0000-4000-8000-000000000001",
  definition: { dsl_version: "1.0" },
  ticket: {
    externalKey: "#489",
    source: "github",
    labels: [],
    estimate: null,
    title: "t",
    body: "",
  },
  repository: {
    slug: "acme-robotics/helios-firmware",
    pinnedSha: "b7e4c2a19f0d3e5b6a7c8d9e0f1a2b3c4d5e6f70",
    token: "ghp_read_only",
  },
  stages: {},
  budget: { runCostCents: 500, stageCostCents: null, runTokens: null, stageTokens: null },
};

const WIRE = ENGINE_DRY_RUN_WIRE.events.map((event) => `${JSON.stringify(event)}\n`);

async function collect(client: EngineClient, signal?: AbortSignal) {
  const events: EngineDryRunEvent[] = [];
  for await (const event of client.dryRun(REQUEST, signal)) events.push(event);
  return events;
}

describe("the engine client's dry run", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  it("posts the dry run in the engine's spelling, accepting NDJSON, and yields each event in order", async () => {
    // Split mid-line, the way a socket does.
    const whole = WIRE.join("");
    const engine = alwaysAnswering(() => streamed([whole.slice(0, 700), whole.slice(700)]));

    const events = await collect(clientWith(engine));

    expect(engine.calls[0].url).toBe(`${ENGINE_URL}/v0/dry-runs`);
    expect(engine.calls[0].method).toBe("POST");
    expect(engine.calls[0].headers.accept).toBe("application/x-ndjson");
    expect(engine.calls[0].headers["X-Ouro-Internal-Key"]).toBe(SHARED_SECRET);
    expect(JSON.parse(engine.calls[0].body ?? "")).toMatchObject({
      dry_run: REQUEST.dryRun,
      repository: { pinned_sha: REQUEST.repository.pinnedSha },
      budget: { run_cost_cents: 500 },
    });
    expect(events).toHaveLength(WIRE.length);
    expect(events.map((event) => event.kind).at(-1)).toBe("done");
  });

  it("is engine_unavailable for a refusal, a line that is not JSON, and a line outside the contract", async () => {
    for (const answer of [
      () => engineError(500, "internal_error"),
      () => streamed(["not json\n"]),
      () => streamed(['{"kind":"surprise"}\n']),
    ]) {
      await expect(collect(clientWith(alwaysAnswering(answer)))).rejects.toMatchObject({
        code: ENGINE_ERRORS.unavailable,
      });
    }
  });

  it("hands over the events before the line that broke the stream", async () => {
    const client = clientWith(alwaysAnswering(() => streamed([WIRE[0] ?? "", "broken\n"])));
    const seen: EngineDryRunEvent[] = [];

    await expect(
      (async () => {
        for await (const event of client.dryRun(REQUEST)) seen.push(event);
      })(),
    ).rejects.toMatchObject({ code: ENGINE_ERRORS.unavailable });

    expect(seen.map((event) => event.kind)).toEqual(["stage_started"]);
  });

  it("joins the caller's abort to the deadline, so a cancel closes the stream", async () => {
    const cancel = new AbortController();
    let seen: AbortSignal | null | undefined;
    const client = clientWith(((_url: string, init?: RequestInit) => {
      seen = init?.signal;
      // A body that stays open until the request is aborted, as a running harness does.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(WIRE[0]));
          init?.signal?.addEventListener("abort", () => {
            controller.error(new DOMException("aborted", "AbortError"));
          });
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as unknown as typeof fetch);
    const events: EngineDryRunEvent[] = [];

    const running = (async () => {
      for await (const event of client.dryRun(REQUEST, cancel.signal)) {
        events.push(event);
        cancel.abort();
      }
    })();

    await expect(running).rejects.toMatchObject({ code: ENGINE_ERRORS.unavailable });
    expect(events).toHaveLength(1);
    expect(seen?.aborted).toBe(true);
  });

  it("does not send a dry run whose caller has already gone", async () => {
    const cancel = new AbortController();
    cancel.abort();
    const engine = fakeFetch(() => Promise.reject(new DOMException("aborted", "AbortError")));

    await expect(collect(clientWith(engine), cancel.signal)).rejects.toMatchObject({
      code: ENGINE_ERRORS.unavailable,
    });
    expect(engine.calls).toHaveLength(1);
  });
});

describe("the engine client's harness description", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  it("reads the harness in this service's names", async () => {
    const engine = alwaysAnswering(() => jsonResponse(ENGINE_DRY_RUN_WIRE.harness));

    const harness = await clientWith(engine).dryRunHarness();

    expect(engine.calls[0].url).toBe(`${ENGINE_URL}/v0/dry-runs/harness`);
    expect(engine.calls[0].method).toBe("GET");
    expect(harness.guards.map((guard) => guard.name)).toEqual(["allow_list", "workspace_boundary"]);
    expect(harness.replayEstimatesPath).toBe("/internal/dry-runs/{id}/replay-estimates");
  });

  it("is engine_unavailable for an answer outside the contract", async () => {
    await expect(
      clientWith(alwaysAnswering(() => jsonResponse({ harness: "dry-run-v1" }))).dryRunHarness(),
    ).rejects.toMatchObject({ code: ENGINE_ERRORS.unavailable });
  });
});
