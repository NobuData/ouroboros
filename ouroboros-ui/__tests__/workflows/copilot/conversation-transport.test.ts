import { describe, expect, it, vi } from "vitest";

import type { CopilotStreamEvent } from "@/app/api/workflow-copilot";
import {
  UNREACHABLE,
  UNREACHABLE_CODE,
  UNREADABLE_REFUSAL,
  answersUrl,
  createTransport,
  messagesUrl,
  readRefusal,
  sessionsUrl,
  streamEvents,
} from "@/app/workflows/copilot/conversation-transport";

import { SECURITY_PATCH_ID, SESSION_ID, copilotSession, exchangeScript, operationEvent } from "../../helpers/workflow-copilot";

/**
 * The card's half of the wire (CE.2, #566): which of this origin's routes each write goes to and
 * with what, a reply's bytes read as events wherever the network cuts them, and every refusal
 * handed back as a value with the service's sentence.
 */

const MESSAGE_ID = "5eed0c0c-0000-4000-8000-000000000002";

const SCRIPT = exchangeScript("add a stage", [
  { kind: "delta", text: "Drafted — é 🚀" },
  operationEvent("add_stage", { node: { id: "exploit-verify" } }),
]);

/** The script as the service frames it, in bytes. */
const BYTES = new TextEncoder().encode(
  SCRIPT.map((event) => `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
);

/** A body delivering the bytes in pieces of a given size. */
function body(size: number, bytes: Uint8Array = BYTES): ReadableStream<Uint8Array> {
  let at = 0;

  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

/** Read a stream to its end. */
async function collect(events: AsyncIterable<CopilotStreamEvent>): Promise<CopilotStreamEvent[]> {
  const all: CopilotStreamEvent[] = [];
  for await (const event of events) all.push(event);

  return all;
}

/** A streamed answer. */
function streamed(): Response {
  return new Response(body(64), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** A refusal in the service's envelope. */
function refused(status: number, code: string, message: string): Response {
  return Response.json({ code, message, details: {} }, { status });
}

describe("the routes", () => {
  it("are this origin's pass-throughs, every id encoded", () => {
    expect(sessionsUrl(SECURITY_PATCH_ID)).toBe(`/api/workflows/${SECURITY_PATCH_ID}/copilot/sessions`);
    expect(messagesUrl(SECURITY_PATCH_ID, SESSION_ID)).toBe(
      `/api/workflows/${SECURITY_PATCH_ID}/copilot/sessions/${SESSION_ID}/messages`,
    );
    expect(answersUrl(SECURITY_PATCH_ID, SESSION_ID, MESSAGE_ID)).toBe(
      `/api/workflows/${SECURITY_PATCH_ID}/copilot/sessions/${SESSION_ID}/messages/${MESSAGE_ID}/answers`,
    );
    expect(sessionsUrl("a/../b")).toBe("/api/workflows/a%2F..%2Fb/copilot/sessions");
    expect(messagesUrl("w", "s?x=1")).toBe("/api/workflows/w/copilot/sessions/s%3Fx%3D1/messages");
  });
});

describe("streamEvents", () => {
  it.each([1, 2, 3, 7, 64, 100_000])("reads the same events from pieces of %i bytes — a multi-byte character split included", async (size) => {
    await expect(collect(streamEvents(body(size)))).resolves.toEqual(SCRIPT);
  });

  it("skips a frame that is not an event, and reads a last frame the server never terminated", async () => {
    const bytes = new TextEncoder().encode(': ping\n\nevent: x\ndata: nonsense\n\nevent: delta\ndata: {"kind":"delta","text":"end"}');

    await expect(collect(streamEvents(body(5, bytes)))).resolves.toEqual([{ kind: "delta", text: "end" }]);
  });

  it("lets the connection go when the reader stops early", async () => {
    const cancel = vi.fn();
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"kind":"delta","text":"x"}\n\n'));
      },
      cancel,
    });

    for await (const event of streamEvents(endless)) {
      expect(event.kind).toBe("delta");
      break;
    }

    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("readRefusal", () => {
  it("reads the service's code and sentence with the status", async () => {
    await expect(readRefusal(refused(409, "copilot_session_closed", "That conversation is closed."))).resolves.toEqual({
      status: 409,
      code: "copilot_session_closed",
      message: "That conversation is closed.",
    });
  });

  it.each([
    ["a body that is not JSON", new Response("<html>502</html>", { status: 502 })],
    ["a JSON body that is not the envelope", Response.json(["no"], { status: 500 })],
    ["an empty sentence", Response.json({ code: 7, message: "" }, { status: 500 })],
  ])("has its own words for %s", async (_what, response) => {
    await expect(readRefusal(response)).resolves.toEqual({
      status: response.status,
      code: "copilot_refused",
      message: UNREADABLE_REFUSAL,
    });
  });
});

describe("the transport", () => {
  it("starts a conversation with a POST and hands back the session", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(copilotSession(), { status: 201 })));

    await expect(createTransport(fetcher).startSession(SECURITY_PATCH_ID)).resolves.toEqual({
      ok: true,
      value: copilotSession(),
    });

    const [url, init] = fetcher.mock.calls[0]!;

    expect(url).toBe(sessionsUrl(SECURITY_PATCH_ID));
    expect(init).toMatchObject({ method: "POST", body: "{}", credentials: "same-origin", cache: "no-store" });
  });

  it("sends a message as { text } and streams the reply", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(streamed()));
    const signal = new AbortController().signal;
    const opened = await createTransport(fetcher).send(SECURITY_PATCH_ID, SESSION_ID, "add a stage", signal);

    expect(opened.ok).toBe(true);
    await expect(collect((opened as { events: AsyncIterable<CopilotStreamEvent> }).events)).resolves.toEqual(SCRIPT);

    const [url, init] = fetcher.mock.calls[0]!;

    expect(url).toBe(messagesUrl(SECURITY_PATCH_ID, SESSION_ID));
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ text: "add a stage" }), signal });
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("answers a question as { question, selected } on the reply that asked", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(streamed()));

    await createTransport(fetcher).answer(SECURITY_PATCH_ID, SESSION_ID, MESSAGE_ID, { question: 1, selected: "Yes" });

    const [url, init] = fetcher.mock.calls[0]!;

    expect(url).toBe(answersUrl(SECURITY_PATCH_ID, SESSION_ID, MESSAGE_ID));
    expect(init?.body).toBe(JSON.stringify({ question: 1, selected: "Yes" }));
  });

  it.each([
    [409, "copilot_session_closed"],
    [403, "forbidden"],
    [422, "copilot_answer_invalid"],
  ])("hands a %i back as a refusal with the service's words, on every call", async (status, code) => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(refused(status, code, "The service's sentence.")));
    const transport = createTransport(fetcher);
    const refusal = { ok: false, refusal: { status, code, message: "The service's sentence." } };

    await expect(transport.startSession(SECURITY_PATCH_ID)).resolves.toEqual(refusal);
    await expect(transport.send(SECURITY_PATCH_ID, SESSION_ID, "x")).resolves.toEqual(refusal);
    await expect(transport.answer(SECURITY_PATCH_ID, SESSION_ID, MESSAGE_ID, { question: 0, selected: "a" })).resolves.toEqual(refusal);
  });

  it("hands a request that never got an answer back as a refusal — never a throw", async () => {
    const transport = createTransport(vi.fn<typeof fetch>(() => Promise.reject(new TypeError("Failed to fetch"))));
    const refusal = { ok: false, refusal: { status: 0, code: UNREACHABLE_CODE, message: UNREACHABLE } };

    await expect(transport.startSession(SECURITY_PATCH_ID)).resolves.toEqual(refusal);
    await expect(transport.send(SECURITY_PATCH_ID, SESSION_ID, "x")).resolves.toEqual(refusal);
  });

  it("refuses an ok answer with no body to read, and a session that is not JSON", async () => {
    const empty = createTransport(vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 200 }))));

    await expect(empty.send(SECURITY_PATCH_ID, SESSION_ID, "x")).resolves.toMatchObject({
      ok: false,
      refusal: { code: UNREACHABLE_CODE },
    });
    await expect(empty.startSession(SECURITY_PATCH_ID)).resolves.toMatchObject({
      ok: false,
      refusal: { code: UNREACHABLE_CODE },
    });
  });
});
