import {
  COPILOT_TURN_TIMEOUT_MS,
  ENGINE_COPILOT_ROUTE,
  copilotTurnRequestBody,
  engineCopilotEventSchema,
  type EngineCopilotTurnRequest,
} from "./engine.copilot";

const REQUEST: EngineCopilotTurnRequest = {
  alias: "coder-max",
  session: "5eed008a-0000-4000-8000-000000000001",
  resolutionVersion: "z1-v1",
  costCapCents: 500,
  context: {
    draft: null,
    draftLabel: "v0.0",
    catalog: [{ type: "llm", label: "Model stage", summary: "" }],
    skills: ["pr-etiquette"],
    tasks: ["review"],
    guards: [{ name: "spend_guard", description: "cap" }],
  },
  transcript: [
    { role: "user", text: "do it" },
    {
      role: "copilot",
      text: "ok",
      toolCalls: [{ id: "call-1", tool: "read_draft", arguments: {} }],
    },
    { role: "tool", callId: "call-1", ok: true, content: "{}" },
  ],
};

describe("the copilot turn contract", () => {
  it("names the route and a deadline longer than an ordinary call's", () => {
    expect(ENGINE_COPILOT_ROUTE).toBe("v0/copilot-workflow");
    expect(COPILOT_TURN_TIMEOUT_MS).toBeGreaterThan(5_000);
  });

  it("writes the request in the engine's spelling", () => {
    expect(copilotTurnRequestBody(REQUEST)).toEqual({
      alias: "coder-max",
      session: "5eed008a-0000-4000-8000-000000000001",
      resolution_version: "z1-v1",
      cost_cap_cents: 500,
      context: {
        draft: null,
        draft_label: "v0.0",
        catalog: [{ type: "llm", label: "Model stage", summary: "" }],
        skills: ["pr-etiquette"],
        tasks: ["review"],
        guards: [{ name: "spend_guard", description: "cap" }],
      },
      transcript: [
        { role: "user", text: "do it" },
        {
          role: "copilot",
          text: "ok",
          tool_calls: [{ id: "call-1", tool: "read_draft", arguments: {} }],
        },
        { role: "tool", call_id: "call-1", ok: true, content: "{}" },
      ],
    });
  });

  it("parses every event kind into this service's names", () => {
    expect(engineCopilotEventSchema.parse({ kind: "delta", text: "hi" })).toEqual({
      kind: "delta",
      text: "hi",
    });
    expect(
      engineCopilotEventSchema.parse({
        kind: "tool_call",
        id: "call-1",
        tool: "add_stage",
        arguments: { node: {} },
        error: null,
      }),
    ).toEqual({
      kind: "tool_call",
      id: "call-1",
      tool: "add_stage",
      arguments: { node: {} },
      error: null,
    });
    expect(
      engineCopilotEventSchema.parse({
        kind: "tool_call",
        id: "call-2",
        tool: "publish",
        error: "no tool",
      }),
    ).toEqual({
      kind: "tool_call",
      id: "call-2",
      tool: "publish",
      arguments: null,
      error: "no tool",
    });
    expect(
      engineCopilotEventSchema.parse({
        kind: "usage",
        input_tokens: 10,
        output_tokens: 4,
        cost_cents: null,
        model: "m",
        connection: "c",
      }),
    ).toEqual({
      kind: "usage",
      inputTokens: 10,
      outputTokens: 4,
      costCents: null,
      model: "m",
      connection: "c",
    });
    expect(
      engineCopilotEventSchema.parse({
        kind: "error",
        code: "gateway_unavailable",
        message: "not yet",
      }),
    ).toEqual({
      kind: "error",
      code: "gateway_unavailable",
      message: "not yet",
    });
    expect(engineCopilotEventSchema.parse({ kind: "done", finish_reason: "stop" })).toEqual({
      kind: "done",
      finishReason: "stop",
    });
  });

  it("refuses a line outside the contract", () => {
    expect(engineCopilotEventSchema.safeParse({ kind: "surprise" }).success).toBe(false);
    expect(
      engineCopilotEventSchema.safeParse({
        kind: "usage",
        input_tokens: -1,
        output_tokens: 0,
        model: "m",
        connection: "c",
      }).success,
    ).toBe(false);
  });
});
