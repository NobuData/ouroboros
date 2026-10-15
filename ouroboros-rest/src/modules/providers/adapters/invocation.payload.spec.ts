import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  anthropicBody,
  ollamaBody,
  openAiBody,
} from "./invocation.payload";

const COMMON = {
  system: "Be brief.",
  messages: [{ role: "user", content: "hi" }],
  max_output_tokens: 256,
  temperature: 0.3,
  model: "ignored",
  stream: false,
};

describe("anthropicBody", () => {
  it("keeps system on its own, maps the output ceiling, and owns model and stream", () => {
    expect(anthropicBody("claude-sonnet-4-5", COMMON)).toEqual({
      system: "Be brief.",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 256,
      temperature: 0.3,
      model: "claude-sonnet-4-5",
      stream: true,
    });
  });

  it("supplies the max_tokens Anthropic requires when the caller sent none", () => {
    expect(anthropicBody("m", { messages: [] }).max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
  });
});

describe("openAiBody", () => {
  it("puts the system prompt first and asks for streamed usage", () => {
    expect(openAiBody("qwen", COMMON)).toEqual({
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "hi" },
      ],
      max_tokens: 256,
      temperature: 0.3,
      model: "qwen",
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("keeps the caller's stream options and forces usage on", () => {
    expect(
      openAiBody("m", { messages: [], stream_options: { include_usage: false, x: 1 } })
        .stream_options,
    ).toEqual({
      include_usage: true,
      x: 1,
    });
  });
});

describe("ollamaBody", () => {
  it("moves sampling and the ceiling under options", () => {
    expect(
      ollamaBody("qwen3:8b", { ...COMMON, options: { num_ctx: 8192 }, keep_alive: "5m" }),
    ).toEqual({
      keep_alive: "5m",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "hi" },
      ],
      options: { num_ctx: 8192, temperature: 0.3, num_predict: 256 },
      model: "qwen3:8b",
      stream: true,
    });
  });
});
