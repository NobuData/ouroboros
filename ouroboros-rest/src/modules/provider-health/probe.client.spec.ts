import { PROVIDER_CHECKS, checkFor, type ProviderCheck } from "./checks";
import { ProviderProbe, countModels, describeProbeFailure, describeRefusal } from "./probe.client";

/**
 * The one place this module talks to a provider — and therefore the one place the ticket's
 * explicit non-goal can be broken.
 *
 * **"No completion request is issued by this service, verified by test"** is the acceptance
 * criterion, and it is verified here twice over: once as a property of the policy table
 * (`checks.spec.ts`, which asserts no entry names a generation route) and once as a property
 * of the client, below, which asserts that every entry in that table produces a `GET` with no
 * body. Two halves, because either alone leaves a hole — a table of listing routes reached by
 * a client that could POST, or a GET-only client pointed at `/v1/messages`.
 *
 * The `fetch` stand-in is the global one, spied on. The alternative — injecting a fetch —
 * would make the assertion "the probe called the function it was given", which is true of a
 * probe that also calls the real one.
 */

const OLLAMA = checkFor("ollama")!;
const ANTHROPIC = checkFor("anthropic")!;

/** What the spy answered with, as the request the provider would have received. */
function lastRequest(): RequestInit {
  const spy = globalThis.fetch as jest.MockedFunction<typeof fetch>;
  const [, init] = spy.mock.calls[spy.mock.calls.length - 1];

  return init ?? {};
}

/** Answer the next `fetch` with this response. */
function answer(response: Response): void {
  jest.spyOn(globalThis, "fetch").mockResolvedValue(response);
}

/** Answer the next `fetch` by failing the way the runtime fails. */
function fails(error: unknown): void {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(error);
}

describe("the probe's request", () => {
  let probe: ProviderProbe;

  beforeEach(() => {
    probe = new ProviderProbe();
    answer(Response.json({ models: [] }));
  });

  it.each(Object.entries(PROVIDER_CHECKS))(
    "sends %s's check as a GET with no body",
    async (_kind, check) => {
      if (check === null) {
        return;
      }

      await probe.run("http://provider.test/path", check, "sk-test");

      const request = lastRequest();
      expect(request.method).toBe("GET");
      expect(request.body).toBeUndefined();
    },
  );

  it("asks for JSON", async () => {
    await probe.run("http://workstation:11434/api/tags", OLLAMA);

    expect((lastRequest().headers as Record<string, string>).accept).toBe("application/json");
  });

  it("carries a deadline, so a sweep cannot be held open by one slow provider", async () => {
    await probe.run("http://workstation:11434/api/tags", OLLAMA);

    expect(lastRequest().signal).toBeInstanceOf(AbortSignal);
  });

  it("goes exactly where it was told, appending nothing", async () => {
    await probe.run("http://workstation:11434/api/tags", OLLAMA);

    const spy = globalThis.fetch as jest.MockedFunction<typeof fetch>;
    expect(spy.mock.calls[0][0]).toBe("http://workstation:11434/api/tags");
  });

  describe("credentials", () => {
    it("presents one for a key-validation check", async () => {
      answer(new Response(null, { status: 200 }));

      await probe.run("https://api.anthropic.com/v1/models?limit=1", ANTHROPIC, "sk-ant-test");

      expect(lastRequest().headers).toMatchObject({ "x-api-key": "sk-ant-test" });
    });

    it("sends none on a reachability check, even when one is handed to it", async () => {
      // A local daemon needs no key, and a probe that attached one anyway would be sending a
      // workspace's Anthropic credential to whatever address a row happened to name.
      await probe.run("http://workstation:11434/api/tags", OLLAMA, "sk-ant-test");

      expect(JSON.stringify(lastRequest().headers)).not.toContain("sk-ant-test");
    });

    it("sends none on a key-validation check with nothing to send", async () => {
      answer(new Response(null, { status: 200 }));

      await probe.run("https://api.anthropic.com/v1/models?limit=1", ANTHROPIC);

      expect(lastRequest().headers).not.toMatchObject({ "x-api-key": expect.anything() as string });
    });
  });
});

describe("what a successful check reports", () => {
  let probe: ProviderProbe;

  beforeEach(() => {
    probe = new ProviderProbe();
  });

  it("counts an Ollama daemon's models — the mockup's `3 models`", async () => {
    answer(Response.json({ models: [{ name: "a" }, { name: "b" }, { name: "c" }] }));

    const outcome = await probe.run("http://workstation:11434/api/tags", OLLAMA);

    expect(outcome).toMatchObject({ ok: true, models: 3 });
  });

  it("counts an OpenAI-compatible server's served models", async () => {
    answer(Response.json({ data: [{ id: "qwen3-coder:32b" }] }));

    const outcome = await probe.run("http://vllm:8000/v1/models", checkFor("openai_compatible")!);

    expect(outcome).toMatchObject({ ok: true, models: 1 });
  });

  it("measures a latency, and never a negative one", async () => {
    answer(Response.json({ models: [] }));

    const outcome = await probe.run("http://workstation:11434/api/tags", OLLAMA);

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports no count for a check that does not enumerate models", async () => {
    answer(new Response(null, { status: 200 }));

    const outcome = await probe.run("https://api.anthropic.com/v1/models?limit=1", ANTHROPIC, "k");

    expect(outcome).toMatchObject({ ok: true, models: null });
  });

  it("stays a success when the body is not something it understands", async () => {
    // A reachable daemon serving an unexpected shape is reachable. Reporting zero models would
    // be inventing a fact; reporting a failure would be blaming the provider for our parser.
    answer(new Response("not json", { status: 200 }));

    const outcome = await probe.run("http://workstation:11434/api/tags", OLLAMA);

    expect(outcome).toMatchObject({ ok: true, models: null });
  });

  it("gives the socket back on a check that reads no body", async () => {
    const response = Response.json({ data: [] });
    const cancel = jest.spyOn(response.body!, "cancel");
    answer(response);

    await probe.run("https://api.anthropic.com/v1/models?limit=1", ANTHROPIC, "k");

    expect(cancel).toHaveBeenCalled();
  });
});

describe("what a failed check reports", () => {
  let probe: ProviderProbe;

  beforeEach(() => {
    probe = new ProviderProbe();
  });

  it("calls a refused credential what it is", async () => {
    answer(new Response(null, { status: 401 }));

    const outcome = await probe.run("https://api.anthropic.com/v1/models?limit=1", ANTHROPIC, "k");

    expect(outcome).toEqual({ ok: false, detail: "key rejected (401)" });
  });

  it("does not call a local server's 401 a rejected key, because no key was sent", async () => {
    answer(new Response(null, { status: 401 }));

    const outcome = await probe.run("http://vllm:8000/v1/models", checkFor("openai_compatible")!);

    expect(outcome).toEqual({ ok: false, detail: "responded 401" });
  });

  it("reports any other refusal by its status", async () => {
    answer(new Response(null, { status: 503 }));

    const outcome = await probe.run("http://workstation:11434/api/tags", OLLAMA);

    expect(outcome).toEqual({ ok: false, detail: "responded 503" });
  });

  it("reports a stopped daemon as unreachable, with the code an operator can act on", async () => {
    // The compose-verified criterion, at unit scale: the Ollama stub is stopped, the socket is
    // refused, and the chip changes on the next cycle.
    fails(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }));

    const outcome = await probe.run("http://workstation:11434/api/tags", OLLAMA);

    expect(outcome).toEqual({ ok: false, detail: "unreachable (ECONNREFUSED)" });
  });

  it("reports a deadline as a deadline", async () => {
    // The abort arrives as a `DOMException`, which is not an `instanceof Error` in Node — a
    // check written against `Error` reports every timed-out probe as a plain failure.
    fails(new DOMException("The operation was aborted due to timeout", "TimeoutError"));

    const outcome = await probe.run("http://workstation:11434/api/tags", OLLAMA);

    expect(outcome).toEqual({ ok: false, detail: "timed out after 5000 ms" });
  });

  it("carries no latency, because a timeout's latency is the deadline", async () => {
    fails(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }));

    const outcome = await probe.run("http://workstation:11434/api/tags", OLLAMA);

    expect(outcome).not.toHaveProperty("latencyMs");
  });

  it("never rejects, so a sweep's control flow is not where a chip's colour is decided", async () => {
    fails(new Error("something nobody anticipated"));

    await expect(probe.run("http://workstation:11434/api/tags", OLLAMA)).resolves.toEqual({
      ok: false,
      detail: "unreachable",
    });
  });
});

describe("the phrases a chip is allowed to carry", () => {
  it("publishes a short symbolic code and nothing longer", () => {
    // The strip is a page in a browser. A driver's own message carries the host, the port and
    // sometimes the request headers; a code is what a reader can act on and cannot leak.
    expect(describeProbeFailure({ cause: { code: "connect ECONNREFUSED 127.0.0.1:11434" } })).toBe(
      "unreachable",
    );
  });

  it("says only `unreachable` when there is no code at all", () => {
    expect(describeProbeFailure(new Error("boom"))).toBe("unreachable");
  });

  it("distinguishes the two refusals by what was being asked", () => {
    const reachability: ProviderCheck = OLLAMA;

    expect(describeRefusal(ANTHROPIC, 403)).toBe("key rejected (403)");
    expect(describeRefusal(reachability, 403)).toBe("responded 403");
  });
});

describe("counting a listing", () => {
  it("counts the named array", () => {
    expect(countModels({ models: [1, 2] }, "models")).toBe(2);
  });

  it("counts nothing when the field is not an array", () => {
    expect(countModels({ models: 3 }, "models")).toBeNull();
  });

  it("counts nothing when the body is not an object", () => {
    expect(countModels("ok", "models")).toBeNull();
    expect(countModels(null, "models")).toBeNull();
  });
});
