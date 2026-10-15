import { BASE_URL_FIELD } from "../provider.config";
import type { InvocationCapableAdapter, ProviderConnectionContext } from "../provider.adapter";
import { AnthropicAdapter } from "./anthropic.adapter";
import { ANTHROPIC_INVOCATION_STREAM, ANTHROPIC_SECRET } from "./anthropic.recordings.fixture";
import { recordResponses, recordedRequest, streamedResponse } from "./http.recordings.fixture";
import { OllamaAdapter } from "./ollama.adapter";
import { OLLAMA_HOST, OLLAMA_INVOCATION_STREAM } from "./ollama.recordings.fixture";
import { OpenAiCompatibleAdapter } from "./openai-compatible.adapter";
import { OPENAI_INVOCATION_STREAM } from "./openai-compatible.recordings.fixture";

/**
 * What each cleared adapter's `invoke` sends — the half of AF.2 a conformance recording does
 * not see.
 */

/** Read a call to the end. */
async function run(
  adapter: InvocationCapableAdapter,
  context: ProviderConnectionContext,
): Promise<void> {
  for await (const chunk of adapter.invoke(context, {
    modelId: "the-model",
    payload: { messages: [{ role: "user", content: "hi" }] },
    signal: new AbortController().signal,
  })) {
    void chunk;
  }
}

describe("AnthropicAdapter.invoke", () => {
  it("posts a streaming Messages request with the key in x-api-key", async () => {
    const spy = recordResponses(streamedResponse(ANTHROPIC_INVOCATION_STREAM));

    await run(new AnthropicAdapter(), { connectionId: "c", config: {}, secret: ANTHROPIC_SECRET });

    const { url, init } = recordedRequest(spy);
    const headers = init.headers as Record<string, string>;

    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(headers["x-api-key"]).toBe(ANTHROPIC_SECRET);
    expect(headers["anthropic-version"]).toBeDefined();
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "the-model", stream: true });
  });

  it("refuses a connection with no key as config, before any socket", async () => {
    const spy = recordResponses(streamedResponse(""));

    await expect(
      run(new AnthropicAdapter(), { connectionId: "c", config: {}, secret: null }),
    ).rejects.toMatchObject({
      errorClass: "config",
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("OpenAiCompatibleAdapter.invoke", () => {
  it.each([
    ["http://10.0.4.20:8000/v1", "http://10.0.4.20:8000/v1/chat/completions"],
    ["http://10.0.4.20:8000", "http://10.0.4.20:8000/v1/chat/completions"],
  ])("posts to chat completions under %s", async (baseUrl, expected) => {
    const spy = recordResponses(streamedResponse(OPENAI_INVOCATION_STREAM));

    await run(new OpenAiCompatibleAdapter(), {
      connectionId: "c",
      config: { [BASE_URL_FIELD]: baseUrl },
      secret: null,
    });

    const { url, init } = recordedRequest(spy);

    expect(url).toBe(expected);
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("sends a bearer only when there is a key", async () => {
    const spy = recordResponses(streamedResponse(OPENAI_INVOCATION_STREAM));

    await run(new OpenAiCompatibleAdapter(), {
      connectionId: "c",
      config: { [BASE_URL_FIELD]: "https://api.example.test/v1" },
      secret: "sk-x",
    });

    expect((recordedRequest(spy).init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk-x",
    );
  });
});

describe("OllamaAdapter.invoke", () => {
  it("posts to /api/chat on the daemon with no credential", async () => {
    const spy = recordResponses(
      streamedResponse(OLLAMA_INVOCATION_STREAM, { contentType: "application/x-ndjson" }),
    );

    await run(new OllamaAdapter(), {
      connectionId: "c",
      config: { [BASE_URL_FIELD]: OLLAMA_HOST },
      secret: null,
    });

    const { url, init } = recordedRequest(spy);

    expect(url).toBe(`${OLLAMA_HOST}/api/chat`);
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "the-model", stream: true });
  });

  it("refuses a connection with no host as config", async () => {
    await expect(
      run(new OllamaAdapter(), { connectionId: "c", config: {}, secret: null }),
    ).rejects.toMatchObject({
      errorClass: "config",
    });
  });
});
