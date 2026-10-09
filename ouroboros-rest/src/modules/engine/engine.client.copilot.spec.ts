import { Logger } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { testConfiguration } from "../config/configuration.fixture";
import { EngineClient } from "./engine.client";
import type { EngineCopilotEvent, EngineCopilotTurnRequest } from "./engine.copilot";
import { ENGINE_ERRORS } from "./engine.errors";
import { alwaysAnswering, engineError, type FakeFetch } from "./engine.fixture";

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
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "application/x-ndjson" } });
}

const REQUEST: EngineCopilotTurnRequest = {
  alias: "coder-max",
  session: "5eed008a-0000-4000-8000-000000000001",
  resolutionVersion: null,
  costCapCents: null,
  context: { draft: null, draftLabel: "v0.0", catalog: [], skills: [], tasks: [], guards: [] },
  transcript: [{ role: "user", text: "hi" }],
};

async function collect(client: EngineClient) {
  const events: EngineCopilotEvent[] = [];
  for await (const event of client.copilotTurn(REQUEST)) events.push(event);
  return events;
}

describe("the engine client's copilot turn", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  it("posts the turn in the engine's spelling, accepting NDJSON, and yields each line as it arrives", async () => {
    const engine = alwaysAnswering(() =>
      streamed([
        '{"kind":"delta","text":"Drafted."}\n{"kind":"tool_call","id":"call-1","tool":"read_draft",',
        '"arguments":{},"error":null}\n',
        '{"kind":"usage","input_tokens":10,"output_tokens":2,"cost_cents":null,"model":"m","connection":"c"}\n{"kind":"done","finish_reason":"stop"}\n',
      ]),
    );

    const events = await collect(clientWith(engine));

    expect(engine.calls[0].url).toBe(`${ENGINE_URL}/v0/copilot-workflow`);
    expect(engine.calls[0].method).toBe("POST");
    expect(engine.calls[0].headers.accept).toBe("application/x-ndjson");
    expect(engine.calls[0].headers["X-Ouro-Internal-Key"]).toBe(SHARED_SECRET);
    expect(JSON.parse(engine.calls[0].body ?? "")).toMatchObject({
      alias: "coder-max",
      context: { draft_label: "v0.0" },
      transcript: [{ role: "user", text: "hi" }],
    });
    expect(events).toEqual([
      { kind: "delta", text: "Drafted." },
      { kind: "tool_call", id: "call-1", tool: "read_draft", arguments: {}, error: null },
      {
        kind: "usage",
        inputTokens: 10,
        outputTokens: 2,
        costCents: null,
        model: "m",
        connection: "c",
      },
      { kind: "done", finishReason: "stop" },
    ]);
  });

  it("is engine_unavailable for a refusal, a line that is not JSON, and a line outside the contract", async () => {
    await expect(
      collect(clientWith(alwaysAnswering(() => engineError(500, "internal_error")))),
    ).rejects.toMatchObject({
      code: ENGINE_ERRORS.unavailable,
    });
    await expect(
      collect(clientWith(alwaysAnswering(() => streamed(["not json\n"])))),
    ).rejects.toMatchObject({
      code: ENGINE_ERRORS.unavailable,
    });
    await expect(
      collect(clientWith(alwaysAnswering(() => streamed(['{"kind":"surprise"}\n'])))),
    ).rejects.toMatchObject({
      code: ENGINE_ERRORS.unavailable,
    });
  });

  it("hands over the events before the line that broke the stream", async () => {
    const client = clientWith(
      alwaysAnswering(() => streamed(['{"kind":"delta","text":"a"}\n', "broken\n"])),
    );
    const seen: EngineCopilotEvent[] = [];

    await expect(
      (async () => {
        for await (const event of client.copilotTurn(REQUEST)) seen.push(event);
      })(),
    ).rejects.toMatchObject({ code: ENGINE_ERRORS.unavailable });

    expect(seen).toEqual([{ kind: "delta", text: "a" }]);
  });
});
