import { createApiClient } from "@/app/api/client";

/**
 * A client for `ouroboros-rest` over a stub `fetch`, and the requests it made.
 *
 * Every suite covering a resource file needs the same two things: a client that answers
 * without a network, and the list of requests it was asked to make. `app/api/client.ts` is a
 * factory precisely so this is possible with no framework in the way — see its own doc
 * comment — and this is that one shape, written once.
 *
 * What it deliberately does **not** do is mock the three server-only modules the resource
 * files pull in (`server-only`, `next/headers`, `next/navigation`). `vi.mock` is hoisted per
 * file, so a call to it from here would run too late; each suite declares its own, which is
 * also why each suite imports the module under test dynamically.
 */

/** What the stub answers one request with. */
export interface StubAnswer {
  /** The body, serialised as JSON. */
  readonly body: unknown;
  /** The status. Defaults to `200`. */
  readonly status?: number;
}

/** A stub client, and the requests made through it in order. */
export interface StubClient {
  /** The client to pass as a resource method's last argument. */
  readonly client: ReturnType<typeof createApiClient>;
  /** Every request the client was asked to make, in order. */
  readonly requests: Request[];
}

/** The base URL every stub answers on. Absolute, so a request URL can be asserted whole. */
export const STUB_BASE_URL = "http://rest.test:4000";

/**
 * A client whose answer is decided per request.
 *
 * @param answer Called with each request; returns the body and status to answer with.
 * @returns The client and the requests it made.
 */
export function stubClient(answer: (request: Request) => StubAnswer): StubClient {
  const requests: Request[] = [];

  const client = createApiClient({
    baseUrl: STUB_BASE_URL,
    fetch: (request) => {
      requests.push(request);
      const { body, status = 200 } = answer(request);
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  });

  return { client, requests };
}

/**
 * A client answering every call with one body.
 *
 * @param body What the service answers with.
 * @param status The status to answer with. Defaults to `200`.
 * @returns The client and the requests it made.
 */
export function clientAnswering(body: unknown, status = 200): StubClient {
  return stubClient(() => ({ body, status }));
}
