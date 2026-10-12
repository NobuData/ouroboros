import type { CopilotSession, CopilotStreamEvent } from "@/app/api/workflow-copilot";

import { createSseParser, readStreamEvent } from "./conversation";

/**
 * How the conversation card reaches the service from the browser (CE.2,
 * [#566](https://github.com/NobuData/ouroboros/issues/566)) — the client's half of this origin's
 * three pass-through routes (`app/api/workflows/[id]/copilot/sessions/…`), which exist because the
 * browser cannot reach `ouroboros-rest`.
 *
 * A reply is a `POST` that answers with server-sent events, and `EventSource` only makes `GET`s —
 * so the stream is read with `fetch` and a reader, and framed by `conversation.ts`'
 * `createSseParser`. Each call answers one of two things: **the stream opened**, as an async
 * sequence of the exchange's events; or **the service refused before it opened**, with its
 * status and its sentence — a closed conversation, a reply still arriving, a role that may not
 * write. A refusal is a value and never a throw, so the card can put the text back and say why.
 *
 * The card takes a {@link CopilotTransport} as a prop and defaults to {@link browserTransport};
 * a test hands in one that yields the events the service would.
 */

/** A refusal before the stream opened. */
export interface TransportRefusal {
  /** The HTTP status, or `0` when the request never got an answer. */
  readonly status: number;
  /** The service's code. */
  readonly code: string;
  /** The service's sentence. */
  readonly message: string;
}

/** A call that answers with a value. */
export type TransportOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: TransportRefusal };

/** A call that answers with a reply's stream. */
export type TransportStream =
  | { readonly ok: true; readonly events: AsyncIterable<CopilotStreamEvent> }
  | { readonly ok: false; readonly refusal: TransportRefusal };

/** The three writes the card makes. */
export interface CopilotTransport {
  /** Start the workflow's conversation. */
  startSession(workflowId: string, signal?: AbortSignal): Promise<TransportOutcome<CopilotSession>>;
  /** Send a message and stream the reply. */
  send(workflowId: string, sessionId: string, text: string, signal?: AbortSignal): Promise<TransportStream>;
  /** Answer one of a reply's questions and stream the continuation. */
  answer(
    workflowId: string,
    sessionId: string,
    messageId: string,
    answer: { readonly question: number; readonly selected: string },
    signal?: AbortSignal,
  ): Promise<TransportStream>;
}

/** The code of a request that never got an answer. */
export const UNREACHABLE_CODE = "copilot_unreachable";

/** What a request that never got an answer says. */
export const UNREACHABLE = "The copilot could not be reached. Check your connection and try again.";

/** What a refusal with no readable envelope says. */
export const UNREADABLE_REFUSAL = "The service refused this and did not say why.";

/**
 * This origin's route for starting a workflow's conversation.
 *
 * @param workflowId The workflow.
 * @returns `/api/workflows/{id}/copilot/sessions`, the id encoded.
 */
export function sessionsUrl(workflowId: string): string {
  return `/api/workflows/${encodeURIComponent(workflowId)}/copilot/sessions`;
}

/**
 * This origin's route for sending a message.
 *
 * @param workflowId The workflow.
 * @param sessionId The conversation.
 * @returns `…/sessions/{sessionId}/messages`.
 */
export function messagesUrl(workflowId: string, sessionId: string): string {
  return `${sessionsUrl(workflowId)}/${encodeURIComponent(sessionId)}/messages`;
}

/**
 * This origin's route for answering a question.
 *
 * @param workflowId The workflow.
 * @param sessionId The conversation.
 * @param messageId The reply that asked.
 * @returns `…/messages/{messageId}/answers`.
 */
export function answersUrl(workflowId: string, sessionId: string, messageId: string): string {
  return `${messagesUrl(workflowId, sessionId)}/${encodeURIComponent(messageId)}/answers`;
}

/**
 * Read a refusal's envelope.
 *
 * @param response The response, not ok.
 * @returns Its status with the service's code and sentence — or this module's words for a body
 *   that is not the envelope.
 */
export async function readRefusal(response: Response): Promise<TransportRefusal> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: the fallback below is all there is to say.
  }

  const envelope = (typeof body === "object" && body !== null ? body : {}) as { code?: unknown; message?: unknown };

  return {
    status: response.status,
    code: typeof envelope.code === "string" ? envelope.code : "copilot_refused",
    message: typeof envelope.message === "string" && envelope.message !== "" ? envelope.message : UNREADABLE_REFUSAL,
  };
}

/**
 * Read a response's body as the exchange's events.
 *
 * @param body The stream of bytes.
 * @yields Each event as its frame completes; a frame that is not one is skipped.
 */
export async function* streamEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<CopilotStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      const frames = done ? parser.flush() : parser.push(decoder.decode(value, { stream: true }));

      for (const frame of frames) {
        const event = readStreamEvent(frame);
        if (event !== null) yield event;
      }
      if (done) return;
    }
  } finally {
    // The consumer stopped early, or the read threw: either way the connection is let go.
    reader.cancel().catch(() => {});
  }
}

/**
 * `POST` JSON to one of this origin's routes.
 *
 * @param fetcher How to fetch.
 * @param url The route.
 * @param body The body.
 * @param signal What ends the request.
 * @returns The response, or the refusal for a request that never got one.
 */
async function post(
  fetcher: typeof fetch,
  url: string,
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<{ ok: true; response: Response } | { ok: false; refusal: TransportRefusal }> {
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });

    return { ok: true, response };
  } catch {
    return { ok: false, refusal: { status: 0, code: UNREACHABLE_CODE, message: UNREACHABLE } };
  }
}

/**
 * Open a reply's stream.
 *
 * @param fetcher How to fetch.
 * @param url The route.
 * @param body The body.
 * @param signal What ends the request.
 * @returns The events, or the refusal.
 */
async function open(
  fetcher: typeof fetch,
  url: string,
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<TransportStream> {
  const sent = await post(fetcher, url, body, signal);
  if (!sent.ok) return sent;
  if (!sent.response.ok) return { ok: false, refusal: await readRefusal(sent.response) };
  if (sent.response.body === null) {
    return { ok: false, refusal: { status: sent.response.status, code: UNREACHABLE_CODE, message: UNREACHABLE } };
  }

  return { ok: true, events: streamEvents(sent.response.body) };
}

/**
 * Make a transport over a `fetch`.
 *
 * @param fetcher How to fetch. Defaults to the global, looked up at each call.
 * @returns The transport.
 */
export function createTransport(fetcher: typeof fetch = (input, init) => fetch(input, init)): CopilotTransport {
  return {
    async startSession(workflowId, signal) {
      // An empty object: the draft tag defaults to the workflow's slug, which is what it matches.
      const sent = await post(fetcher, sessionsUrl(workflowId), {}, signal);
      if (!sent.ok) return sent;
      if (!sent.response.ok) return { ok: false, refusal: await readRefusal(sent.response) };

      try {
        return { ok: true, value: (await sent.response.json()) as CopilotSession };
      } catch {
        return {
          ok: false,
          refusal: { status: sent.response.status, code: UNREACHABLE_CODE, message: UNREACHABLE },
        };
      }
    },

    send(workflowId, sessionId, text, signal) {
      return open(fetcher, messagesUrl(workflowId, sessionId), { text }, signal);
    },

    answer(workflowId, sessionId, messageId, answer, signal) {
      return open(fetcher, answersUrl(workflowId, sessionId, messageId), answer, signal);
    },
  };
}

/** The transport the card uses in a browser. */
export const browserTransport: CopilotTransport = createTransport();
