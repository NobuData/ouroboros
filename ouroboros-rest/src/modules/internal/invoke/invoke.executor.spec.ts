import type { ProviderConnectionKind } from "../../db/schema";
import type {
  InvocationCall,
  InvocationChunk,
  InvocationUsage,
  ProviderConnectionContext,
} from "../../providers/provider.adapter";
import { ProviderAdapterError } from "../../providers/provider.errors";
import { resolve } from "../../routing/resolve";
import {
  ALIASES,
  CONNECTIONS,
  IMPLEMENT_HOPS,
  aliasNamed,
  resolutionInput,
  routedWith,
} from "../../routing/routing.fixture";
import type { AliasSpec } from "../../routing/inputs";
import type { Resolution } from "../../routing/resolution";
import type { InvokeEvent } from "../invoke.contract";
import {
  CHARS_PER_TOKEN,
  codeOf,
  costOf,
  estimate,
  execute,
  type ExecutorPorts,
  type HopUsage,
  type TokenRates,
} from "./invoke.executor";
import {
  chainPlan,
  isRefusal,
  singleHopPlan,
  type InvokePlan,
  type PlannedHop,
} from "./invoke.plan";

/**
 * The walk, against the requirements doc's acceptance list
 * (`docs/INVOCATION_GATEWAY_REQUIREMENTS.md` § Acceptance) and AF.2's own criteria.
 *
 * The chains are real resolutions — `resolve()` over the routing fixture — so the explanation
 * a test asserts against is the sentence the inspector prints.
 */

/** The credential every opened context carries — it must appear in no event. */
const SECRET = "sk-test-secret-235";

/** $3 / $15 per million — a hosted model's rates. */
const RATES: TokenRates = { inputCentsPer1m: 300, outputCentsPer1m: 1500 };

/** One scripted step: a chunk, a failure to throw, or silence until the signal aborts. */
type Step = InvocationChunk | Error | "hang";

/** Usage the scripts report. */
function usage(inputTokens: number, outputTokens: number): InvocationChunk {
  return {
    kind: "usage",
    usage: { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

/** A complete answer. */
function answer(text: string, inputTokens = 20, outputTokens = 5): Step[] {
  return [
    { kind: "delta", text },
    usage(inputTokens, outputTokens),
    { kind: "done", finishReason: "stop" },
  ];
}

/** A provider refusal of one class. */
function refused(
  errorClass: ProviderAdapterError["errorClass"],
  status: number | null = null,
  refusal: ProviderAdapterError["refusal"] = null,
): Error {
  return new ProviderAdapterError(errorClass, "refused", status, refusal);
}

/**
 * An adapter that plays scripts, one per attempt, per connection.
 */
class ScriptedAdapter {
  readonly kind: ProviderConnectionKind = "openai_compatible";
  readonly calls: { connection: string; call: InvocationCall }[] = [];
  private readonly attempts = new Map<string, number>();

  constructor(private readonly scripts: Readonly<Record<string, readonly Step[][]>>) {}

  capabilities() {
    return { discovery: true, pull: false, entitlements: false, invocation: true } as const;
  }

  async *invoke(
    context: ProviderConnectionContext,
    call: InvocationCall,
  ): AsyncGenerator<InvocationChunk> {
    this.calls.push({ connection: context.connectionId, call });

    const attempt = this.attempts.get(context.connectionId) ?? 0;
    const scripts = this.scripts[context.connectionId] ?? [[refused("network")]];
    const script = scripts[Math.min(attempt, scripts.length - 1)];

    this.attempts.set(context.connectionId, attempt + 1);

    for (const step of script) {
      if (step === "hang") {
        await new Promise((_, reject) => {
          if (call.signal.aborted) {
            reject(new Error("aborted"));
          }

          call.signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        });
      } else if (step instanceof Error) {
        throw step;
      } else {
        await Promise.resolve();

        if (call.signal.aborted) {
          throw new Error("aborted");
        }

        yield step;
      }
    }
  }
}

/** The fake world the walk runs in, and what it recorded. */
function world(
  adapter: ScriptedAdapter,
  overrides: Partial<ExecutorPorts> = {},
  capOf: (connection: string) => number | null = () => null,
): {
  ports: ExecutorPorts;
  opened: string[];
  records: HopUsage[];
  touched: string[];
  sleeps: number[];
} {
  const opened: string[] = [];
  const records: HopUsage[] = [];
  const touched: string[] = [];
  const sleeps: number[] = [];
  let clock = 0;

  return {
    opened,
    records,
    touched,
    sleeps,
    ports: {
      open: (hop) => {
        opened.push(hop.connectionId);

        return Promise.resolve({
          adapter: adapter as never,
          // An opened ProviderConnectionContext, handed to the adapter and never emitted —
          // which is what the last suite below asserts.
          // eslint-disable-next-line ouroboros/no-secret-in-internal-response
          context: { connectionId: hop.connectionId, config: {}, secret: SECRET },
          monthlyCapCents: capOf(hop.connectionId),
        });
      },
      rates: () => Promise.resolve(RATES),
      spent: () => Promise.resolve(0),
      providerMonthSpent: () => Promise.resolve(0),
      record: (settled) => {
        records.push(settled);

        return Promise.resolve();
      },
      touch: (hop) => {
        touched.push(hop.connectionId);

        return Promise.resolve();
      },
      now: () => (clock += 5),
      clock: () => new Date("2026-10-14T09:00:00.000Z"),
      sleep: (ms) => {
        sleeps.push(ms);

        return Promise.resolve();
      },
      ...overrides,
    },
  };
}

/** Run a walk to the end. */
async function walk(
  plan: InvokePlan,
  ports: ExecutorPorts,
  signal: AbortSignal = new AbortController().signal,
  stallMs = 60_000,
): Promise<InvokeEvent[]> {
  const events: InvokeEvent[] = [];

  await execute(
    plan,
    { messages: [] },
    ports,
    signal,
    (event) => {
      events.push(event);
    },
    { rateLimitAttempts: 3, backoffMs: [1_000, 2_000], stallMs },
  );

  return events;
}

/** The fixture's aliases, with `coder-fallback` moved off Copilot onto the vLLM connection. */
const INVOCABLE_ALIASES: readonly AliasSpec[] = ALIASES.map((alias) =>
  alias.alias === "coder-fallback"
    ? {
        ...alias,
        modelId: "qwen2.5-coder-32b",
        binding: {
          connectionId: CONNECTIONS.vllm,
          kind: "openai_compatible",
          displayName: "vLLM",
          baseUrl: "http://10.0.4.20:8000/v1",
        },
      }
    : alias,
);

/** `implement-primary`'s hops, bound to {@link INVOCABLE_ALIASES}. */
const INVOCABLE_HOPS = IMPLEMENT_HOPS.map((hop) => ({
  ...hop,
  target: INVOCABLE_ALIASES.find((alias) => alias.alias === hop.target.alias) ?? hop.target,
}));

/** The routing input with every `implement-primary` hop invocable. */
const INVOCABLE = { aliases: INVOCABLE_ALIASES, hops: INVOCABLE_HOPS };

/** `implement-primary`, every hop invocable, as routing resolves it. */
function implementChain(): Resolution {
  return resolve(resolutionInput(INVOCABLE));
}

/** A chain plan from a resolution, starting at its primary. */
function planOf(resolution: Resolution): InvokePlan {
  const plan = chainPlan(resolution, aliasNamed("coder-max").alias, { run: "r" });

  if (plan === null || isRefusal(plan)) {
    throw new Error("the fixture resolution was expected to plan");
  }

  return plan;
}

/** Events of one kind. */
function ofKind<K extends InvokeEvent["kind"]>(
  events: readonly InvokeEvent[],
  kind: K,
): Extract<InvokeEvent, { kind: K }>[] {
  return events.filter((event): event is Extract<InvokeEvent, { kind: K }> => event.kind === kind);
}

describe("a dead primary", () => {
  it("fails over exactly as the resolution's explanation predicted", async () => {
    const resolution = implementChain();
    const fallback = resolution.chain[1];

    // What the inspector told the person: hop 2 is the fallback, and it catches 5xx and timeouts.
    expect(fallback.explanation).toMatch(/^Fallback 1 · /);
    expect(fallback.note).toBe("Fallback on 5xx / timeouts");
    expect(fallback.decision).toBe("kept");

    const adapter = new ScriptedAdapter({
      [CONNECTIONS.anthropic]: [[refused("upstream", 503)]],
      [CONNECTIONS.vllm]: [answer("served by the fallback", 31, 9)],
    });
    const { ports, records } = world(adapter);
    const events = await walk(planOf(resolution), ports);

    expect(ofKind(events, "hop").map((hop) => [hop.hop, hop.outcome, hop.code])).toEqual([
      [0, "failed_over", "provider_unavailable"],
      [1, "ok", undefined],
    ]);
    expect(ofKind(events, "delta")).toEqual([
      { kind: "delta", hop: 1, text: "served by the fallback" },
    ]);
    expect(ofKind(events, "usage")).toEqual([
      expect.objectContaining({
        hop: 1,
        connection: CONNECTIONS.vllm,
        model: "qwen2.5-coder-32b",
        inputTokens: 31,
        outputTokens: 9,
      }),
    ]);
    expect(records.map((row) => row.hop.connectionId)).toEqual([CONNECTIONS.vllm]);
    expect(events.at(-1)).toEqual({ kind: "done", hop: 1, finishReason: "stop" });
  });

  it("fails over on a timeout the same way", async () => {
    const adapter = new ScriptedAdapter({
      [CONNECTIONS.anthropic]: [[refused("network")]],
      [CONNECTIONS.vllm]: [answer("ok")],
    });
    const events = await walk(planOf(implementChain()), world(adapter).ports);

    expect(ofKind(events, "hop")[0]).toMatchObject({
      outcome: "failed_over",
      code: "provider_unavailable",
    });
    expect(events.at(-1)).toMatchObject({ kind: "done", hop: 1 });
  });

  it("treats a hop that goes silent as timed out, and moves on", async () => {
    const adapter = new ScriptedAdapter({
      [CONNECTIONS.anthropic]: [["hang"]],
      [CONNECTIONS.vllm]: [answer("ok")],
    });
    const events = await walk(planOf(implementChain()), world(adapter).ports, undefined, 10);

    expect(ofKind(events, "hop")[0]).toMatchObject({
      outcome: "failed_over",
      code: "provider_unavailable",
    });
    expect(events.at(-1)).toMatchObject({ kind: "done", hop: 1 });
  });
});

describe("the taxonomy", () => {
  it("aborts a 400 with request_invalid and never calls hop 2", async () => {
    const adapter = new ScriptedAdapter({
      [CONNECTIONS.anthropic]: [[refused("config", 400)]],
      [CONNECTIONS.vllm]: [answer("never")],
    });
    const { ports, opened } = world(adapter);
    const events = await walk(planOf(implementChain()), ports);

    expect(opened).toEqual([CONNECTIONS.anthropic]);
    expect(events.at(-1)).toMatchObject({ kind: "error", hop: 0, code: "request_invalid" });
    expect(ofKind(events, "hop")[0]).toMatchObject({ outcome: "aborted" });
  });

  it("advances past an auth failure without retrying it (G3)", async () => {
    const adapter = new ScriptedAdapter({
      [CONNECTIONS.anthropic]: [[refused("auth", 401)]],
      [CONNECTIONS.vllm]: [answer("ok")],
    });
    const { ports, opened } = world(adapter);
    const events = await walk(planOf(implementChain()), ports);

    expect(opened).toEqual([CONNECTIONS.anthropic, CONNECTIONS.vllm]);
    expect(ofKind(events, "hop")[0]).toMatchObject({
      outcome: "failed_over",
      code: "provider_auth_failed",
    });
  });

  it.each([
    ["context_window_exceeded", "context_window_exceeded"],
    ["model_not_found", "model_not_found"],
  ] as const)("advances past a %s refusal (G8)", async (refusal, code) => {
    const adapter = new ScriptedAdapter({
      [CONNECTIONS.anthropic]: [[refused("config", 400, refusal)]],
      [CONNECTIONS.vllm]: [answer("ok")],
    });
    const events = await walk(planOf(implementChain()), world(adapter).ports);

    expect(ofKind(events, "hop")[0]).toMatchObject({ outcome: "failed_over", code });
    expect(events.at(-1)).toMatchObject({ kind: "done", hop: 1 });
  });

  it("backs off on a 429 and retries the same hop, within its bound", async () => {
    const adapter = new ScriptedAdapter({
      [CONNECTIONS.anthropic]: [
        [refused("rate_limit", 429)],
        [refused("rate_limit", 429)],
        answer("third time"),
      ],
    });
    const { ports, sleeps } = world(adapter);
    const events = await walk(planOf(implementChain()), ports);

    expect(sleeps).toEqual([1_000, 2_000]);
    expect(ofKind(events, "hop")).toEqual([expect.objectContaining({ hop: 0, outcome: "ok" })]);
  });

  it("advances once the back-off is spent", async () => {
    const adapter = new ScriptedAdapter({
      [CONNECTIONS.anthropic]: [[refused("rate_limit", 429)]],
      [CONNECTIONS.vllm]: [answer("ok")],
    });
    const { ports, sleeps } = world(adapter);
    const events = await walk(planOf(implementChain()), ports);

    expect(sleeps).toHaveLength(2);
    expect(ofKind(events, "hop")[0]).toMatchObject({
      outcome: "failed_over",
      code: "provider_rate_limited",
    });
  });

  it("never hands over a hop that has already streamed text", async () => {
    const adapter = new ScriptedAdapter({
      [CONNECTIONS.anthropic]: [[{ kind: "delta", text: "half an ans" }, refused("upstream")]],
      [CONNECTIONS.vllm]: [answer("never")],
    });
    const { ports, opened } = world(adapter);
    const events = await walk(planOf(implementChain()), ports);

    expect(opened).toEqual([CONNECTIONS.anthropic]);
    expect(events.at(-1)).toMatchObject({ kind: "error", hop: 0, code: "provider_unavailable" });
  });

  it("maps every adapter class to the contract's code", () => {
    expect(codeOf(refused("upstream"))).toBe("provider_unavailable");
    expect(codeOf(refused("network"))).toBe("provider_unavailable");
    expect(codeOf(refused("rate_limit"))).toBe("provider_rate_limited");
    expect(codeOf(refused("auth"))).toBe("provider_auth_failed");
    expect(codeOf(refused("config"))).toBe("request_invalid");
    expect(codeOf(new Error("anything else"))).toBe("provider_unavailable");
  });
});

describe("the floor", () => {
  it("fails floor_exhausted with the floor's reason, and never uses a hop below it", async () => {
    const resolution = resolve(routedWith({ floorHopIndex: 2 }, INVOCABLE));
    const adapter = new ScriptedAdapter({
      [CONNECTIONS.anthropic]: [[refused("upstream")]],
      [CONNECTIONS.vllm]: [[refused("upstream")]],
      [CONNECTIONS.ollama]: [answer("below the floor")],
    });
    const { ports, opened } = world(adapter);
    const events = await walk(planOf(resolution), ports);

    expect(opened).not.toContain(CONNECTIONS.ollama);
    expect(events.at(-1)).toEqual({
      kind: "error",
      code: "floor_exhausted",
      message: expect.stringContaining(resolution.floor.explanation) as string,
    });
  });

  it("fails chain_exhausted when no floor is set", async () => {
    const adapter = new ScriptedAdapter({});
    const events = await walk(planOf(implementChain()), world(adapter).ports);

    expect(ofKind(events, "hop")).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ kind: "error", code: "chain_exhausted" });
  });

  it("cannot be crossed by a worker's floor, only tightened", () => {
    const plan = chainPlan(implementChain(), "coder-max", { run: "r", floorHopIndex: 1 });

    expect(plan !== null && !isRefusal(plan) ? plan.hops.map((hop) => hop.alias) : null).toEqual([
      "coder-max",
    ]);
  });
});

describe("the cap", () => {
  it("blocks pre-flight with an error naming the cap", async () => {
    const adapter = new ScriptedAdapter({});
    const { ports, opened } = world(adapter, { spent: () => Promise.resolve(250) });
    const events = await walk(planOf(implementChain()), ports);

    expect(opened).toEqual([]);
    expect(events).toEqual([
      {
        kind: "error",
        code: "cost_cap_exceeded",
        message: "The route's per-run cap of $2.50 was reached.",
        cap: { source: "route", limitCents: 250, spentCents: 250 },
      },
    ]);
  });

  it("stops a stream that crosses the cap while running", async () => {
    // $2.50 at $15/M output is ~166k tokens; a delta of 700k characters is ~175k.
    const huge = "x".repeat(700_000);
    const adapter = new ScriptedAdapter({
      [CONNECTIONS.anthropic]: [
        [
          usage(10, 1),
          { kind: "delta", text: huge },
          { kind: "delta", text: "never sent" },
          ...answer(""),
        ],
      ],
    });
    const { ports, records } = world(adapter);
    const events = await walk(planOf(implementChain()), ports);

    expect(ofKind(events, "delta").map((delta) => delta.text)).toEqual([huge]);
    expect(adapter.calls[0].call.signal.aborted).toBe(true);
    expect(events.at(-1)).toMatchObject({
      kind: "error",
      code: "cost_cap_exceeded",
      cap: { source: "route", limitCents: 250 },
    });
    // The row holds what the provider reported, not the estimate the cap was checked with.
    expect(records.map((row) => [row.usage.inputTokens, row.usage.outputTokens])).toEqual([
      [10, 1],
    ]);
  });

  it("fails a hop over its provider's monthly cap over to the next hop", async () => {
    const adapter = new ScriptedAdapter({ [CONNECTIONS.vllm]: [answer("ok")] });
    const { ports, opened } = world(
      adapter,
      {
        providerMonthSpent: (hop) =>
          Promise.resolve(hop.connectionId === CONNECTIONS.anthropic ? 60_000 : 0),
      },
      (connection) => (connection === CONNECTIONS.anthropic ? 60_000 : null),
    );
    const events = await walk(planOf(implementChain()), ports);

    // Opened to read its cap, never called.
    expect(opened).toEqual([CONNECTIONS.anthropic, CONNECTIONS.vllm]);
    expect(adapter.calls.map((call) => call.connection)).toEqual([CONNECTIONS.vllm]);
    expect(ofKind(events, "hop")[0]).toMatchObject({
      outcome: "failed_over",
      code: "cost_cap_exceeded",
      cap: { source: "provider", limitCents: 60_000, spentCents: 60_000 },
    });
    expect(events.at(-1)).toMatchObject({ kind: "done", hop: 1 });
  });

  it("lets unpriced usage pass uncounted, stores it null, and says so (G6)", async () => {
    const adapter = new ScriptedAdapter({ [CONNECTIONS.anthropic]: [answer("local", 26, 8)] });
    const { ports, records } = world(adapter, { rates: () => Promise.resolve(null) });
    const events = await walk(planOf(implementChain()), ports);

    expect(records[0].costCents).toBeNull();
    expect(ofKind(events, "usage")[0].costCents).toBeNull();
    expect(events.at(-1)).toEqual({
      kind: "done",
      hop: 0,
      finishReason: "stop",
      unpricedNotCounted: true,
    });
  });
});

describe("usage", () => {
  it("is stored per hop, including a hop that failed partway, each on its own connection", async () => {
    const adapter = new ScriptedAdapter({
      [CONNECTIONS.anthropic]: [[usage(25, 1), refused("upstream")]],
      [CONNECTIONS.vllm]: [answer("ok", 31, 9)],
    });
    const { ports, records } = world(adapter);
    const events = await walk(planOf(implementChain()), ports);

    expect(
      records.map((row) => [
        row.hop.index,
        row.hop.connectionId,
        row.usage.inputTokens,
        row.usage.outputTokens,
      ]),
    ).toEqual([
      [0, CONNECTIONS.anthropic, 25, 1],
      [1, CONNECTIONS.vllm, 31, 9],
    ]);
    expect(ofKind(events, "usage").map((event) => event.hop)).toEqual([0, 1]);
    expect(records[1].costCents).toBe(
      costOf(RATES, { inputTokens: 31, outputTokens: 9, cacheReadTokens: 0, cacheWriteTokens: 0 }),
    );
  });

  it("touches last_used_at only on the connection that served the answer", async () => {
    const adapter = new ScriptedAdapter({
      [CONNECTIONS.anthropic]: [[refused("upstream")]],
      [CONNECTIONS.vllm]: [answer("ok")],
    });
    const { ports, touched } = world(adapter);

    await walk(planOf(implementChain()), ports);

    expect(touched).toEqual([CONNECTIONS.vllm]);
  });

  it("is still stored when the caller leaves mid-stream, and no terminal event follows", async () => {
    const gone = new AbortController();
    const adapter = new ScriptedAdapter({
      [CONNECTIONS.anthropic]: [[usage(10, 2), { kind: "delta", text: "a" }, "hang"]],
    });
    const { ports, records } = world(adapter);
    const events: InvokeEvent[] = [];

    await execute(planOf(implementChain()), {}, ports, gone.signal, (event) => {
      events.push(event);

      if (event.kind === "delta") {
        gone.abort();
      }
    });

    expect(records).toHaveLength(1);
    expect(events.map((event) => event.kind)).toEqual(["delta", "usage"]);
  });
});

describe("telemetry and the credential", () => {
  it("emits a hop event per attempted hop with alias and timestamp (G7)", async () => {
    const adapter = new ScriptedAdapter({
      [CONNECTIONS.anthropic]: [[refused("upstream")]],
      [CONNECTIONS.vllm]: [answer("ok")],
    });
    const events = await walk(planOf(implementChain()), world(adapter).ports);

    expect(ofKind(events, "hop")).toEqual([
      expect.objectContaining({
        alias: "coder-max",
        connection: CONNECTIONS.anthropic,
        at: "2026-10-14T09:00:00.000Z",
      }),
      expect.objectContaining({
        alias: "coder-fallback",
        connection: CONNECTIONS.vllm,
        at: "2026-10-14T09:00:00.000Z",
      }),
    ]);
    expect(ofKind(events, "hop").every((hop) => hop.latencyMs >= 0)).toBe(true);
  });

  it("never puts the credential in anything it emits", async () => {
    const adapter = new ScriptedAdapter({
      [CONNECTIONS.anthropic]: [[refused("auth", 401)]],
      [CONNECTIONS.vllm]: [answer("ok")],
    });
    const events = await walk(planOf(implementChain()), world(adapter).ports);

    expect(JSON.stringify(events)).not.toContain(SECRET);
  });

  it("merges each hop's params over the worker's payload", async () => {
    const adapter = new ScriptedAdapter({ [CONNECTIONS.anthropic]: [answer("ok")] });
    const hop: PlannedHop = {
      index: 0,
      position: null,
      alias: "a",
      modelId: "m",
      params: { temperature: 0.2 },
      connectionId: CONNECTIONS.anthropic,
      kind: "anthropic",
    };
    const plan = singleHopPlan(hop, null);

    await execute(
      plan,
      { temperature: 1, system: "s" },
      world(adapter).ports,
      new AbortController().signal,
      () => undefined,
    );

    expect(adapter.calls[0].call.payload).toEqual({ temperature: 0.2, system: "s" });
  });
});

describe("a single-hop call", () => {
  it("fails with the hop's own code — a failure is a failure, not a hop", async () => {
    const adapter = new ScriptedAdapter({ [CONNECTIONS.anthropic]: [[refused("upstream")]] });
    const plan = singleHopPlan(
      {
        alias: null,
        modelId: "m",
        params: {},
        connectionId: CONNECTIONS.anthropic,
        kind: "anthropic",
      },
      null,
    );
    const events = await walk(plan, world(adapter).ports);

    expect(ofKind(events, "hop")[0]).toMatchObject({
      outcome: "aborted",
      code: "provider_unavailable",
    });
    expect(events.at(-1)).toMatchObject({ kind: "error", hop: 0, code: "provider_unavailable" });
  });
});

describe("the arithmetic", () => {
  const tokens = (input: number, output: number, read = 0, write = 0): InvocationUsage => ({
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: read,
    cacheWriteTokens: write,
  });

  it("prices cache tokens at the input rate and rounds to four places", () => {
    expect(costOf(RATES, tokens(1_000, 1_000, 500, 500))).toBe(2.1);
    expect(costOf(RATES, tokens(1, 1))).toBe(0.0018);
  });

  it("is null, never 0, for an unpriced model", () => {
    expect(costOf(null, tokens(100, 100))).toBeNull();
  });

  it("estimates in-flight output from streamed characters when that is higher", () => {
    expect(estimate(tokens(5, 1), 40).outputTokens).toBe(40 / CHARS_PER_TOKEN);
    expect(estimate(tokens(5, 50), 40).outputTokens).toBe(50);
  });
});
