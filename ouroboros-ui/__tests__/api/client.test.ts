import { describe, expect, it, vi } from "vitest";

import {
  type ApiResult,
  SESSION_COOKIE,
  createApiClient,
  unwrap,
} from "@/app/api/client";
import { ApiError, isApiError } from "@/app/api/errors";
import { TENANT_HEADER } from "@/app/api/tenant";

/**
 * The wrapper: the base URL, the session, the workspace header, and the error envelope.
 *
 * Everything here runs against a stub `fetch`, which is the whole reason
 * `app/api/client.ts` is a factory that reads no environment — a suite can watch exactly
 * what would go on the wire, and answer with exactly what the contract says can come
 * back, with no server and no framework in between.
 */

/** The base URL every case below builds against. */
const BASE_URL = "http://rest.test:4000";

/** A recorded exchange: what the client sent, and what it was answered with. */
interface Exchange {
  /** Every request the client made, in order. */
  requests: Request[];
  /** The client under test. */
  client: ReturnType<typeof createApiClient>;
}

/** Build a JSON response the way `ouroboros-rest` answers. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The contract's error envelope, as a response. */
function errorResponse(status: number, code: string, message: string, details = {}): Response {
  return jsonResponse(status, { code, message, details });
}

/** One page of tenants, as `listTenants` answers. */
const TENANT_PAGE = {
  items: [
    {
      id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
      slug: "acme",
      displayName: "Acme, Inc.",
      status: "active",
      createdAt: "2026-08-11T10:20:23.114Z",
      updatedAt: "2026-08-11T10:20:23.114Z",
    },
  ],
  total: 1,
  limit: 25,
  offset: 0,
};

/**
 * A client over a stub `fetch` that records what it is asked for.
 *
 * @param responses What to answer with, in order. The last is repeated once exhausted,
 *   so a case that makes one call need only supply one.
 * @param options Anything to add to the client's options — a resolver, a handler.
 * @returns The client and the list its requests land in.
 */
function clientOver(
  responses: Response[],
  options: Partial<Parameters<typeof createApiClient>[0]> = {},
): Exchange {
  const requests: Request[] = [];
  let index = 0;

  const client = createApiClient({
    baseUrl: BASE_URL,
    ...options,
    fetch: (request) => {
      requests.push(request);
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return Promise.resolve(response ?? jsonResponse(200, {}));
    },
  });

  return { requests, client };
}

describe("the request the client sends", () => {
  it("joins the path onto the configured base URL", async () => {
    const { client, requests } = clientOver([jsonResponse(200, TENANT_PAGE)]);

    await client.GET("/api/v1/tenants");

    expect(requests[0]?.url).toBe(`${BASE_URL}/api/v1/tenants`);
  });

  it("serialises path and query parameters from the contract", async () => {
    const { client, requests } = clientOver([jsonResponse(200, TENANT_PAGE)]);

    await client.GET("/api/v1/tenants/{tenantId}/domains", {
      params: {
        path: { tenantId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10" },
        query: { limit: 10, offset: 20 },
      },
    });

    expect(requests[0]?.url).toBe(
      `${BASE_URL}/api/v1/tenants/9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10/domains?limit=10&offset=20`,
    );
  });

  it("asks for credentials, which is what makes the cookie travel cross-origin", async () => {
    const { client, requests } = clientOver([jsonResponse(200, TENANT_PAGE)]);

    await client.GET("/api/v1/tenants");

    expect(requests[0]?.credentials).toBe("include");
  });
});

describe("the active workspace", () => {
  it("sends the resolver's answer as the tenant header", async () => {
    const { client, requests } = clientOver([jsonResponse(200, TENANT_PAGE)], {
      tenant: () => "acme",
    });

    await client.GET("/api/v1/tenants");

    expect(requests[0]?.headers.get(TENANT_HEADER)).toBe("acme");
  });

  it("awaits a resolver that reads the choice asynchronously, as cookies() does", async () => {
    const { client, requests } = clientOver([jsonResponse(200, TENANT_PAGE)], {
      tenant: () => Promise.resolve("9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10"),
    });

    await client.GET("/api/v1/tenants");

    expect(requests[0]?.headers.get(TENANT_HEADER)).toBe("9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10");
  });

  it("re-reads the workspace per call, so a switch takes effect on the next one", async () => {
    let chosen = "acme";
    const { client, requests } = clientOver(
      [jsonResponse(200, TENANT_PAGE), jsonResponse(200, TENANT_PAGE)],
      { tenant: () => chosen },
    );

    await client.GET("/api/v1/tenants");
    chosen = "globex";
    await client.GET("/api/v1/tenants");

    expect(requests.map((request) => request.headers.get(TENANT_HEADER))).toEqual([
      "acme",
      "globex",
    ]);
  });

  it("sends no header when there is no choice", async () => {
    const { client, requests } = clientOver([jsonResponse(200, TENANT_PAGE)], {
      tenant: () => undefined,
    });

    await client.GET("/api/v1/tenants");

    expect(requests[0]?.headers.has(TENANT_HEADER)).toBe(false);
  });

  it("sends no header when nothing resolves one at all", async () => {
    const { client, requests } = clientOver([jsonResponse(200, TENANT_PAGE)]);

    await client.GET("/api/v1/tenants");

    expect(requests[0]?.headers.has(TENANT_HEADER)).toBe(false);
  });

  it("refuses a reference carrying a newline rather than composing the header", async () => {
    // Header injection, the thing the validation in app/api/tenant.ts exists for: this
    // value would be two headers if it were written into one.
    const { client, requests } = clientOver([jsonResponse(200, TENANT_PAGE)], {
      tenant: () => "acme\r\nX-Ouro-Internal-Key: stolen",
    });

    await expect(client.GET("/api/v1/tenants")).rejects.toThrow(TENANT_HEADER);
    expect(requests).toHaveLength(0);
  });
});

describe("the session", () => {
  it("forwards the session as the cookie the contract names", async () => {
    const { client, requests } = clientOver([jsonResponse(200, TENANT_PAGE)], {
      session: () => "signed.value",
    });

    await client.GET("/api/v1/tenants");

    expect(requests[0]?.headers.get("Cookie")).toBe(`${SESSION_COOKIE}=signed.value`);
  });

  it("forwards nothing when the request carries no session", async () => {
    const { client, requests } = clientOver([jsonResponse(200, TENANT_PAGE)], {
      session: () => undefined,
    });

    await client.GET("/api/v1/tenants");

    expect(requests[0]?.headers.has("Cookie")).toBe(false);
  });

  it("sends only the session, never the browser's other cookies", async () => {
    // The theme and the active workspace are this UI's business. The assertion is that
    // what goes out is composed from the one value, not copied from a cookie header.
    const { client, requests } = clientOver([jsonResponse(200, TENANT_PAGE)], {
      session: () => "signed.value",
      tenant: () => "acme",
    });

    await client.GET("/api/v1/tenants");

    expect(requests[0]?.headers.get("Cookie")).toBe(`${SESSION_COOKIE}=signed.value`);
  });

  it("refuses a session value carrying CRLF, which would be a second header", async () => {
    const { client, requests } = clientOver([jsonResponse(200, TENANT_PAGE)], {
      session: () => "signed\r\nX-Ouro-Internal-Key: stolen",
    });

    await expect(client.GET("/api/v1/tenants")).rejects.toThrow(/RFC 6265/);
    expect(requests).toHaveLength(0);
  });

  it("refuses a session value a cookie may not carry, and names no credential", async () => {
    const { client, requests } = clientOver([jsonResponse(200, TENANT_PAGE)], {
      session: () => "signed;value",
    });

    await expect(client.GET("/api/v1/tenants")).rejects.toThrow(/RFC 6265/);
    await expect(client.GET("/api/v1/tenants")).rejects.not.toThrow(/signed;value/);
    expect(requests).toHaveLength(0);
  });
});

describe("what a call resolves with", () => {
  it("returns the body the contract describes", async () => {
    const { client } = clientOver([jsonResponse(200, TENANT_PAGE)]);

    const result = await client.GET("/api/v1/tenants");

    expect(result.data).toEqual(TENANT_PAGE);
    expect(result.error).toBeUndefined();
  });
});

describe("what a call rejects with", () => {
  it("throws the envelope as an ApiError rather than returning it", async () => {
    const { client } = clientOver([
      errorResponse(409, "domain_taken", "That domain belongs to another tenant.", {
        domain: "acme.example.com",
      }),
    ]);

    const caught: unknown = await client.GET("/api/v1/tenants").catch((error: unknown) => error);

    expect(isApiError(caught)).toBe(true);
    const error = caught as ApiError;
    expect(error.status).toBe(409);
    expect(error.code).toBe("domain_taken");
    expect(error.details).toEqual({ domain: "acme.example.com" });
  });

  it("throws for every failing status, including one with no envelope", async () => {
    const { client } = clientOver([new Response("gateway said no", { status: 502 })]);

    await expect(client.GET("/api/v1/tenants")).rejects.toBeInstanceOf(ApiError);
  });

  it("leaves a fetch that never arrived as the runtime's own error", async () => {
    // "The request failed" and "the service refused the request" are different facts,
    // and only the second has an envelope.
    const client = createApiClient({
      baseUrl: BASE_URL,
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });

    const caught: unknown = await client.GET("/api/v1/tenants").catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(TypeError);
    expect(isApiError(caught)).toBe(false);
  });
});

describe("a 401", () => {
  it("is handed to the handler before it is thrown", async () => {
    const onUnauthenticated = vi.fn();
    const { client } = clientOver(
      [errorResponse(401, "unauthenticated", "Sign in to continue.")],
      { onUnauthenticated },
    );

    await expect(client.GET("/api/v1/tenants")).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    const [error] = onUnauthenticated.mock.calls[0] as [ApiError];
    expect(error.isUnauthenticated).toBe(true);
    expect(error.code).toBe("unauthenticated");
  });

  it("lets a handler that navigates away win over the throw", async () => {
    // This is what `redirect()` does in a Server Component: it signals by throwing, and
    // that throw is the one that must reach Next.js — the page is going to the login
    // screen, not rendering a message about a session it no longer has.
    class RedirectSignal extends Error {}
    const { client } = clientOver([errorResponse(401, "unauthenticated", "Sign in.")], {
      onUnauthenticated: () => {
        throw new RedirectSignal("NEXT_REDIRECT");
      },
    });

    await expect(client.GET("/api/v1/tenants")).rejects.toBeInstanceOf(RedirectSignal);
  });

  it("waits for a handler that answers asynchronously", async () => {
    const order: string[] = [];
    const { client } = clientOver([errorResponse(401, "unauthenticated", "Sign in.")], {
      onUnauthenticated: async () => {
        await Promise.resolve();
        order.push("handled");
      },
    });

    await client.GET("/api/v1/tenants").catch(() => order.push("thrown"));

    expect(order).toEqual(["handled", "thrown"]);
  });

  it("is not raised for any other failure", async () => {
    const onUnauthenticated = vi.fn();
    const { client } = clientOver([errorResponse(403, "forbidden", "Not your workspace.")], {
      onUnauthenticated,
    });

    await expect(client.GET("/api/v1/tenants")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });
});

describe("unwrap", () => {
  it("returns the body of a call that answered with one", async () => {
    const { client } = clientOver([jsonResponse(200, TENANT_PAGE)]);

    const page = unwrap(await client.GET("/api/v1/tenants"));

    // Typed end to end: `page.items[0].slug` is a compile error the moment the contract
    // stops carrying that field and `yarn api:sync` is run.
    expect(page.items[0]?.slug).toBe("acme");
    expect(page.total).toBe(1);
  });

  it("throws rather than returning undefined when the response carried no body", () => {
    const result: ApiResult<string> = {
      data: undefined as unknown as string,
      response: new Response(null, { status: 204 }),
    };

    expect(() => unwrap(result)).toThrow(ApiError);
    expect(() => unwrap(result)).toThrow(/no body/);
  });

  it("mints a code that is visibly this client's own for that case", () => {
    const result: ApiResult<string> = {
      data: undefined as unknown as string,
      response: new Response(null, { status: 204 }),
    };

    try {
      unwrap(result);
      expect.unreachable("unwrap must throw for an empty body");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      expect((error as ApiError).code).toBe("client_empty_response");
    }
  });
});
