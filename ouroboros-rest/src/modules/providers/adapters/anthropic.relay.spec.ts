import { AnthropicAdapter } from "./anthropic.adapter";
import { ANTHROPIC_INVOCATION_STREAM, ANTHROPIC_SECRET } from "./anthropic.recordings.fixture";
import { AnthropicUsageTap, messageUsage, relayed } from "./anthropic.stream";
import {
  recordFailure,
  recordResponses,
  recordedRequest,
  streamedResponse,
} from "./http.recordings.fixture";

/**
 * The Anthropic adapter's relay — what the harness facade (DH.2, #1303) hands bytes through.
 */

/** Read a body to the end. */
async function bytesOf(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of body) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

const CONTEXT = { connectionId: "c", config: {}, secret: ANTHROPIC_SECRET };

describe("relayMessages", () => {
  it("posts the harness's body to /v1/messages with the connection's key, its betas forwarded", async () => {
    const spy = recordResponses(streamedResponse(ANTHROPIC_INVOCATION_STREAM));

    await new AnthropicAdapter().relayMessages(CONTEXT, {
      path: "/v1/messages",
      body: { model: "claude-sonnet-4-5", stream: true, max_tokens: 64, tools: [{ name: "Read" }] },
      headers: { "anthropic-version": "2023-06-01", "anthropic-beta": "claude-code-20250219" },
      signal: new AbortController().signal,
    });

    const { url, init } = recordedRequest(spy);
    const headers = init.headers as Record<string, string>;

    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(headers["x-api-key"]).toBe(ANTHROPIC_SECRET);
    expect(headers["anthropic-beta"]).toBe("claude-code-20250219");
    expect(headers.accept).toBe("text/event-stream");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "claude-sonnet-4-5",
      stream: true,
      max_tokens: 64,
      tools: [{ name: "Read" }],
    });
  });

  it("relays count_tokens to its own route", async () => {
    const spy = recordResponses(
      new Response('{"input_tokens":12}', { headers: { "content-type": "application/json" } }),
    );

    await new AnthropicAdapter().relayMessages(CONTEXT, {
      path: "/v1/messages/count_tokens",
      body: { model: "m" },
      headers: {},
      signal: new AbortController().signal,
    });

    expect(recordedRequest(spy).url).toBe("https://api.anthropic.com/v1/messages/count_tokens");
  });

  it("refuses a connection with no key before any socket, and reports a dead one as network", async () => {
    const spy = recordResponses(new Response(""));
    const request = {
      path: "/v1/messages" as const,
      body: {},
      headers: {},
      signal: new AbortController().signal,
    };

    await expect(
      new AnthropicAdapter().relayMessages({ ...CONTEXT, secret: null }, request),
    ).rejects.toMatchObject({
      errorClass: "config",
    });
    expect(spy).not.toHaveBeenCalled();

    recordFailure();
    await expect(new AnthropicAdapter().relayMessages(CONTEXT, request)).rejects.toMatchObject({
      errorClass: "network",
    });
  });
});

describe("relayed", () => {
  it("passes a stream's bytes through unchanged, ping frames included, and reads its usage", async () => {
    const answer = await relayed(streamedResponse(ANTHROPIC_INVOCATION_STREAM, { split: true }));

    expect(answer.failure).toBeNull();
    expect((await bytesOf(answer.body)).toString("utf8")).toBe(ANTHROPIC_INVOCATION_STREAM);
    expect(ANTHROPIC_INVOCATION_STREAM).toContain("event: ping");
    expect(answer.usage()).toEqual({
      inputTokens: 25,
      outputTokens: 15,
      cacheReadTokens: 12,
      cacheWriteTokens: 4,
    });
  });

  it("reads a non-streamed answer's usage from its body", async () => {
    const body = '{"type":"message","usage":{"input_tokens":30,"output_tokens":7}}';
    const answer = await relayed(
      new Response(body, { headers: { "content-type": "application/json" } }),
    );

    expect((await bytesOf(answer.body)).toString("utf8")).toBe(body);
    expect(answer.usage()).toMatchObject({ inputTokens: 30, outputTokens: 7 });
  });

  it("keeps a refusal's body byte for byte and classifies it, G8 included", async () => {
    const body =
      '{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 210000 tokens"}}';
    const answer = await relayed(
      new Response(body, {
        status: 400,
        headers: { "content-type": "application/json", "request-id": "req_1" },
      }),
    );

    expect(answer).toMatchObject({
      status: 400,
      requestId: "req_1",
      failure: { errorClass: "config", refusal: "context_window_exceeded" },
    });
    expect((await bytesOf(answer.body)).toString("utf8")).toBe(body);
    expect(answer.usage()).toBeNull();
  });

  it("classifies an overloaded provider as upstream", async () => {
    const answer = await relayed(new Response('{"type":"error"}', { status: 529 }));

    expect(answer.failure).toEqual({ errorClass: "upstream", refusal: null });
  });
});

describe("AnthropicUsageTap", () => {
  it("never throws on bytes it cannot read, and reports no usage for them", () => {
    const tap = new AnthropicUsageTap();

    tap.push(new TextEncoder().encode("data: {not json\n\nevent: error\ndata: {}\n\n"));
    tap.end();

    expect(tap.usage()).toBeNull();
    expect(tap.completed()).toBe(false);
  });

  it("knows a completed stream", () => {
    const tap = new AnthropicUsageTap();

    tap.push(new TextEncoder().encode(ANTHROPIC_INVOCATION_STREAM));
    tap.end();

    expect(tap.completed()).toBe(true);
  });

  it("reads no usage from a body without one", () => {
    expect(messageUsage({ type: "message" })).toBeNull();
  });
});
