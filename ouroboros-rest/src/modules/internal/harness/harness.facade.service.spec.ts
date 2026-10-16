import type { NewTokenUsage } from "../../db/schema";
import type { PricingService } from "../../pricing/pricing.service";
import type { ConnectionOpener } from "../../provider-connections/connection.opener";
import { AnthropicAdapter } from "../../providers/adapters/anthropic.adapter";
import { ANTHROPIC_INVOCATION_STREAM } from "../../providers/adapters/anthropic.recordings.fixture";
import {
  recordResponses,
  streamedResponse,
} from "../../providers/adapters/http.recordings.fixture";
import { OpenAiCompatibleAdapter } from "../../providers/adapters/openai-compatible.adapter";
import type { InvokePlan, PlanRefusal, PlannedHop } from "../invoke/invoke.plan";
import type { InvokeRepository } from "../invoke/invoke.repository";
import type { InvokeService, PreparedInvocation } from "../invoke/invoke.service";
import type { HarnessBudgetGuard } from "./harness.budget";
import type { AttemptBudgetBreach } from "./harness.errors";
import {
  HarnessFacadeService,
  SKIPPED_HOPS_HEADER,
  type RelaySink,
} from "./harness.facade.service";
import type { CredentialBinding } from "./harness.repository";

/**
 * The facade's walk, against the issue's acceptance list — on the real Anthropic adapter, with
 * `fetch` recorded, so what reaches the harness is exactly what would leave the process.
 */

/** The provider key, planted so a test can prove it never reaches the harness. */
const CANARY = "sk-ant-api03-CANARY-0000000000000000000000000000001303";

const ANTHROPIC_A = "c0000000-0000-4000-8000-00000000000a";
const ANTHROPIC_B = "c0000000-0000-4000-8000-00000000000b";
const VLLM = "c0000000-0000-4000-8000-00000000000c";

const BINDING: CredentialBinding = {
  id: "d0000000-0000-4000-8000-000000001303",
  organizationId: "acme",
  runId: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
  stage: "implement",
  alias: "coder-max",
  attempt: 2,
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  revokedAt: null,
  runStatus: "building",
};

/** A hop. */
function hop(
  index: number,
  connectionId: string,
  kind: PlannedHop["kind"],
  modelId: string,
): PlannedHop {
  return {
    index,
    position: index + 1,
    alias: `alias-${index.toString()}`,
    modelId,
    params: {},
    connectionId,
    kind,
  };
}

const PRIMARY = hop(0, ANTHROPIC_A, "anthropic", "claude-sonnet-4-5");
const FALLBACK = hop(1, ANTHROPIC_B, "anthropic", "claude-opus-4-5");
const LOCAL = hop(1, VLLM, "openai_compatible", "qwen");

/** A plan over the given hops. */
function plan(hops: PlannedHop[], cap: InvokePlan["cap"] = null): InvokePlan {
  return { hops, chained: true, floorPosition: null, floorReason: null, cap };
}

/** A sink that records everything written to it, and when. */
function recorder(): RelaySink & {
  status: number;
  headers: Record<string, string>;
  chunks: Buffer[];
  ended: boolean;
  text(): string;
  json(): Record<string, unknown>;
} {
  const sink = {
    status: 0,
    headers: {} as Record<string, string>,
    chunks: [] as Buffer[],
    ended: false,
    head(status: number, headers: Readonly<Record<string, string>>) {
      sink.status = status;
      sink.headers = { ...headers };
    },
    write(chunk: Uint8Array) {
      sink.chunks.push(Buffer.from(chunk));
    },
    end() {
      sink.ended = true;
    },
    text: () => Buffer.concat(sink.chunks).toString("utf8"),
    json: () => JSON.parse(Buffer.concat(sink.chunks).toString("utf8")) as Record<string, unknown>,
  };

  return sink;
}

/** The facade over fakes, with the plan and spend the case names. */
function facade(options: {
  planned: InvokePlan | PlanRefusal;
  spent?: number;
  monthSpent?: number;
  caps?: Record<string, number>;
  /** The stage attempt's token budget breach the guard reports, if any (#315). */
  attemptBreach?: AttemptBudgetBreach;
}) {
  const prepared: PreparedInvocation = {
    subject: { organizationId: "acme", kind: "run", id: BINDING.runId },
    plan: options.planned,
    payload: {},
    runCtx: { run: BINDING.runId, stage: BINDING.stage },
    taskKind: "implement",
    snapshotId: Promise.resolve("snap-1"),
  };
  const invocations = { prepare: jest.fn().mockResolvedValue(prepared) };
  const rows: NewTokenUsage[] = [];
  const repository = {
    subjectSpent: jest.fn().mockResolvedValue(options.spent ?? 0),
    providerMonthSpent: jest.fn().mockResolvedValue(options.monthSpent ?? 0),
    insertUsage: jest.fn((row: NewTokenUsage) => {
      rows.push(row);

      return Promise.resolve();
    }),
  };
  const touched: string[] = [];
  const connections = {
    open: jest.fn((_org: string, connectionId: string) =>
      Promise.resolve({
        adapter: connectionId === VLLM ? new OpenAiCompatibleAdapter() : new AnthropicAdapter(),
        context: { connectionId, config: {}, secret: CANARY },
        monthlyCapCents: options.caps?.[connectionId] ?? null,
      }),
    ),
    touch: jest.fn((_org: string, connectionId: string) => {
      touched.push(connectionId);

      return Promise.resolve();
    }),
  };
  const pricing = {
    resolve: jest.fn().mockResolvedValue({
      billingMode: "token",
      inputCentsPer1m: "300",
      outputCentsPer1m: "1500",
    }),
  };

  const budgets = {
    attemptBudgetBreach: jest.fn().mockResolvedValue(options.attemptBreach),
    breached: jest.fn().mockResolvedValue(true),
  };

  return {
    rows,
    touched,
    connections,
    budgets,
    subject: new HarnessFacadeService(
      invocations as unknown as InvokeService,
      repository as unknown as InvokeRepository,
      connections as unknown as ConnectionOpener,
      pricing as unknown as PricingService,
      budgets as unknown as HarnessBudgetGuard,
    ),
  };
}

/** One harness call. */
function call(
  overrides: {
    body?: Record<string, unknown>;
    path?: "/v1/messages" | "/v1/messages/count_tokens";
  } = {},
) {
  return {
    path: overrides.path ?? ("/v1/messages" as const),
    binding: BINDING,
    body: overrides.body ?? { model: "coder-max", stream: true, max_tokens: 64, messages: [] },
    headers: {
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "claude-code-20250219",
      // The harness's own credential header — asserted below never to reach the provider.
      // eslint-disable-next-line ouroboros/no-secret-in-internal-response
      "x-api-key": "ouro_hrn_x",
    },
    signal: new AbortController().signal,
  };
}

describe("a harness call that is relayed", () => {
  it("streams the provider's bytes through unchanged, ping included, and records one usage row", async () => {
    const spy = recordResponses(streamedResponse(ANTHROPIC_INVOCATION_STREAM, { split: true }));
    const { subject, rows, touched } = facade({ planned: plan([PRIMARY]) });
    const sink = recorder();

    await subject.relay(call(), sink);

    expect(sink.status).toBe(200);
    expect(sink.headers["content-type"]).toBe("text/event-stream");
    expect(sink.text()).toBe(ANTHROPIC_INVOCATION_STREAM);
    expect(sink.ended).toBe(true);
    // The model sent upstream is the hop's, not the alias.
    expect(JSON.parse(spy.mock.calls[0][1]?.body as string)).toMatchObject({
      model: "claude-sonnet-4-5",
    });
    // Usage reconciles with what the provider reported, attributed to run, stage, attempt and credential.
    expect(rows).toEqual([
      expect.objectContaining({
        run_id: BINDING.runId,
        stage: "implement",
        attempt: 2,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        tokens_in: 25,
        tokens_out: 15,
        cache_read_tokens: 12,
        cache_write_tokens: 4,
        harness_credential_id: BINDING.id,
        resolution_snapshot_id: "snap-1",
      }),
    ]);
    expect(touched).toEqual([ANTHROPIC_A]);
  });

  it("relays event by event, without buffering, on a slow provider", async () => {
    const encoder = new TextEncoder();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode('event: ping\ndata: {"type":"ping"}\n\n'));
        await gate;
        controller.enqueue(
          encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
        );
        controller.close();
      },
    });

    recordResponses(new Response(body, { headers: { "content-type": "text/event-stream" } }));
    const { subject } = facade({ planned: plan([PRIMARY]) });
    const sink = recorder();
    const relaying = subject.relay(call(), sink);

    // The first event is relayed while the provider is still holding the second.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sink.text()).toContain("ping");
    expect(sink.ended).toBe(false);

    release();
    await relaying;
    expect(sink.text()).toContain("message_stop");
  });

  it("forwards anthropic-version and anthropic-beta unchanged, and never the harness's credential", async () => {
    const spy = recordResponses(streamedResponse(ANTHROPIC_INVOCATION_STREAM));
    const { subject } = facade({ planned: plan([PRIMARY]) });

    await subject.relay(call(), recorder());

    const headers = spy.mock.calls[0][1]?.headers as Record<string, string>;

    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["anthropic-beta"]).toBe("claude-code-20250219");
    expect(headers["x-api-key"]).toBe(CANARY);
    expect(JSON.stringify(headers)).not.toContain("ouro_hrn_");
  });

  it("never lets the provider key reach the harness, on a success or a failure", async () => {
    recordResponses(
      streamedResponse(ANTHROPIC_INVOCATION_STREAM),
      new Response('{"type":"error","error":{"type":"invalid_request_error","message":"bad"}}', {
        status: 400,
      }),
    );

    for (const _ of [0, 1]) {
      const { subject } = facade({ planned: plan([PRIMARY]) });
      const sink = recorder();

      await subject.relay(call(), sink);
      expect(JSON.stringify({ headers: sink.headers, body: sink.text() })).not.toContain(CANARY);
    }
  });

  it("relays count_tokens without metering or capping it", async () => {
    recordResponses(
      new Response('{"input_tokens":12}', { headers: { "content-type": "application/json" } }),
    );
    const { subject, rows } = facade({
      planned: plan([PRIMARY], { source: "route", limitCents: 1 }),
      spent: 5,
    });
    const sink = recorder();

    await subject.relay(
      call({ path: "/v1/messages/count_tokens", body: { model: "coder-max" } }),
      sink,
    );

    expect(sink.json()).toEqual({ input_tokens: 12 });
    expect(rows).toEqual([]);
  });
});

describe("the chain", () => {
  it("skips a hop that is not Anthropic-format, and says so", async () => {
    recordResponses(streamedResponse(ANTHROPIC_INVOCATION_STREAM));
    const { subject } = facade({
      planned: plan([
        { ...LOCAL, index: 0 },
        { ...FALLBACK, index: 1 },
      ]),
    });
    const sink = recorder();

    await subject.relay(call(), sink);

    expect(sink.status).toBe(200);
    expect(sink.headers[SKIPPED_HOPS_HEADER]).toContain(
      "hop 1 (alias-1, openai_compatible) skipped",
    );
  });

  it("fails a chain with no Anthropic-format hop with a reason that says so", async () => {
    const { subject } = facade({ planned: plan([{ ...LOCAL, index: 0 }]) });
    const sink = recorder();

    await subject.relay(call(), sink);

    expect(sink.status).toBe(400);
    expect(sink.json()).toMatchObject({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: expect.stringContaining("no Anthropic-format hop") as string,
      },
      ouroboros: {
        code: "no_anthropic_hop",
        skipped: [expect.stringContaining("openai_compatible") as string],
      },
    });
  });

  it("fails over a 5xx before any byte is relayed", async () => {
    const spy = recordResponses(
      new Response('{"type":"error","error":{"type":"overloaded_error"}}', { status: 529 }),
      streamedResponse(ANTHROPIC_INVOCATION_STREAM),
    );
    const { subject, rows } = facade({ planned: plan([PRIMARY, FALLBACK]) });
    const sink = recorder();

    await subject.relay(call(), sink);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(sink.status).toBe(200);
    expect(sink.headers[SKIPPED_HOPS_HEADER]).toContain("failed over");
    expect(rows.map((row) => row.model)).toEqual(["claude-opus-4-5"]);
  });

  it("returns a request refusal unmodified, without trying the next hop", async () => {
    const body =
      '{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: required"}}';
    const spy = recordResponses(
      new Response(body, { status: 400, headers: { "content-type": "application/json" } }),
    );
    const { subject } = facade({ planned: plan([PRIMARY, FALLBACK]) });
    const sink = recorder();

    await subject.relay(call(), sink);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(sink.status).toBe(400);
    expect(sink.text()).toBe(body);
  });

  it("returns the last provider's error unmodified when every hop fails", async () => {
    const last = '{"type":"error","error":{"type":"api_error","message":"second"}}';

    recordResponses(
      new Response('{"type":"error","error":{"type":"api_error","message":"first"}}', {
        status: 503,
      }),
      new Response(last, { status: 503 }),
    );
    const { subject } = facade({ planned: plan([PRIMARY, FALLBACK]) });
    const sink = recorder();

    await subject.relay(call(), sink);

    expect(sink.status).toBe(503);
    expect(sink.text()).toBe(last);
  });

  it("advances past a model-specific refusal (G8)", async () => {
    recordResponses(
      new Response(
        '{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long"}}',
        {
          status: 400,
        },
      ),
      streamedResponse(ANTHROPIC_INVOCATION_STREAM),
    );
    const { subject } = facade({ planned: plan([PRIMARY, FALLBACK]) });
    const sink = recorder();

    await subject.relay(call(), sink);

    expect(sink.status).toBe(200);
  });
});

describe("refusals", () => {
  it("refuses a model that is not the credential's alias", async () => {
    const { subject, connections } = facade({ planned: plan([PRIMARY]) });
    const sink = recorder();

    await subject.relay(call({ body: { model: "claude-opus-4-5", messages: [] } }), sink);

    expect(sink.status).toBe(403);
    expect(sink.json()).toMatchObject({
      error: { type: "permission_error" },
      ouroboros: { code: "alias_mismatch" },
    });
    expect(connections.open).not.toHaveBeenCalled();
  });

  it("stops the next call once the run's cap is spent, naming the cap", async () => {
    const spy = recordResponses(streamedResponse(ANTHROPIC_INVOCATION_STREAM));
    const { subject, budgets } = facade({
      planned: plan([PRIMARY], { source: "route", limitCents: 250 }),
      spent: 250,
    });
    const sink = recorder();

    await subject.relay(call(), sink);

    expect(spy).not.toHaveBeenCalled();
    expect(sink.status).toBe(400);
    expect(sink.json()).toMatchObject({
      ouroboros: {
        code: "cost_cap_exceeded",
        cap: { source: "route", limitCents: 250, spentCents: 250 },
      },
      error: { message: expect.stringContaining("$2.50") as string },
    });
    // AR.1 (#315): the run is stopped too — a system abort and the audit row, through the guard.
    expect(budgets.breached).toHaveBeenCalledWith(BINDING, {
      limit: "cost_cap",
      spent: 250,
      cap: 250,
    });
  });

  it("lets a call under the cap through without filing anything", async () => {
    recordResponses(streamedResponse(ANTHROPIC_INVOCATION_STREAM));
    const { subject, budgets } = facade({
      planned: plan([PRIMARY], { source: "spend_guard", limitCents: 250 }),
      spent: 249,
    });
    const sink = recorder();

    await subject.relay(call(), sink);

    expect(sink.status).toBe(200);
    expect(budgets.attemptBudgetBreach).toHaveBeenCalledWith(BINDING);
    expect(budgets.breached).not.toHaveBeenCalled();
  });

  it("refuses the call once the stage attempt's token budget is spent, and stops the run (#315)", async () => {
    const spy = recordResponses(streamedResponse(ANTHROPIC_INVOCATION_STREAM));
    const attemptBreach: AttemptBudgetBreach = {
      limitTokens: 400_000,
      spentTokens: 400_512,
      stage: BINDING.stage,
      attempt: BINDING.attempt,
    };
    const { subject, budgets, rows } = facade({ planned: plan([PRIMARY]), attemptBreach });
    const sink = recorder();

    await subject.relay(call(), sink);

    expect(spy).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
    expect(sink.status).toBe(400);
    expect(sink.headers["content-type"]).toBe("application/json");
    expect(sink.json()).toEqual({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: expect.stringContaining("400000-token budget") as string,
      },
      ouroboros: { code: "token_budget_exceeded", attemptBudget: attemptBreach },
    });
    expect(budgets.breached).toHaveBeenCalledWith(BINDING, {
      limit: "token_budget",
      spent: 400_512,
      cap: 400_000,
    });
  });

  it("checks the cost cap before the token budget, and files one breach for the call", async () => {
    recordResponses(streamedResponse(ANTHROPIC_INVOCATION_STREAM));
    const { subject, budgets } = facade({
      planned: plan([PRIMARY], { source: "route", limitCents: 250 }),
      spent: 300,
      attemptBreach: { limitTokens: 1, spentTokens: 2, stage: "implement", attempt: 2 },
    });
    const sink = recorder();

    await subject.relay(call(), sink);

    expect(sink.json()).toMatchObject({ ouroboros: { code: "cost_cap_exceeded" } });
    expect(budgets.attemptBudgetBreach).not.toHaveBeenCalled();
    expect(budgets.breached).toHaveBeenCalledTimes(1);
  });

  it("neither budgets nor aborts a count_tokens call", async () => {
    recordResponses(streamedResponse(ANTHROPIC_INVOCATION_STREAM));
    const { subject, budgets } = facade({
      planned: plan([PRIMARY], { source: "route", limitCents: 250 }),
      spent: 300,
      attemptBreach: { limitTokens: 1, spentTokens: 2, stage: "implement", attempt: 2 },
    });

    await subject.relay(call({ path: "/v1/messages/count_tokens" }), recorder());

    expect(budgets.attemptBudgetBreach).not.toHaveBeenCalled();
    expect(budgets.breached).not.toHaveBeenCalled();
  });

  it("skips a hop whose provider is at its monthly cap, and names that cap when none is left", async () => {
    const spy = recordResponses(streamedResponse(ANTHROPIC_INVOCATION_STREAM));
    const { subject, budgets } = facade({
      planned: plan([PRIMARY]),
      caps: { [ANTHROPIC_A]: 60_000 },
      monthSpent: 60_000,
    });
    const sink = recorder();

    await subject.relay(call(), sink);

    expect(spy).not.toHaveBeenCalled();
    expect(sink.json()).toMatchObject({
      ouroboros: { code: "cost_cap_exceeded", cap: { source: "provider" } },
    });
    // A provider's month is not the run's budget: nothing is aborted.
    expect(budgets.breached).not.toHaveBeenCalled();
  });

  it("reports a refused resolution and a vote as their own rules", async () => {
    const refused = facade({
      planned: {
        refused: true,
        code: "resolution_failed",
        message: "Routing says no.",
        reason: "floor_breached",
      },
    });
    const voted = facade({
      planned: { refused: true, code: "vote_execution_unavailable", message: "A vote." },
    });
    const one = recorder();
    const two = recorder();

    await refused.subject.relay(call(), one);
    await voted.subject.relay(call(), two);

    expect(one.json()).toMatchObject({
      ouroboros: { code: "resolution_failed", reason: "floor_breached" },
    });
    expect(two.json()).toMatchObject({ ouroboros: { code: "vote_execution_unavailable" } });
  });
});
