import { describe, expect, it, vi } from "vitest";

import { CACHE_CONTROL } from "@/app/api/poll-response";
import { isArtifactId } from "@/app/api/test-results";

import { JUNIT_ARTIFACT_ID } from "../helpers/test-results";

/**
 * An artifact's file, passed through to the browser (#341): the artifacts card's open ↗. The body
 * streams straight through, the session goes with the request, a refusal keeps the service's
 * status and words — and every answer is made safe to serve from this origin, whatever the
 * service sent.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const {
  ARTIFACT_ID_INVALID,
  ARTIFACT_ID_INVALID_CODE,
  ARTIFACT_UNAVAILABLE_CODE,
  PASSED_HEADERS,
  SAFETY_HEADERS,
  UNREACHABLE_ARTIFACT,
  artifactPath,
  readArtifactFile,
} = await import("@/app/api/artifact-file");

/** The service's address in these cases. */
const BASE = "http://rest.test";

/** A JUnit report. */
const FILE = '<?xml version="1.0"?>\n<testsuite name="unit" tests="1"/>\n';

/**
 * A fetch answering one response.
 *
 * @param response What to answer.
 * @returns The stub.
 */
function answering(response: Response) {
  return vi.fn<typeof fetch>(() => Promise.resolve(response));
}

/**
 * Assert the headers that make runner bytes safe on this origin.
 *
 * @param response The answer.
 */
function expectSafe(response: Response): void {
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Content-Security-Policy")).toBe("sandbox; default-src 'none'");
  expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
}

describe("isArtifactId", () => {
  it("accepts a uuid and nothing else", () => {
    expect(isArtifactId(JUNIT_ARTIFACT_ID)).toBe(true);
    expect(isArtifactId(JUNIT_ARTIFACT_ID.toUpperCase())).toBe(true);
    for (const value of ["", "..", "x", `${JUNIT_ARTIFACT_ID}/..`, ` ${JUNIT_ARTIFACT_ID}`, null, undefined, 7]) {
      expect(isArtifactId(value)).toBe(false);
    }
  });
});

describe("artifactPath", () => {
  it("is the service's download route, the id encoded", () => {
    expect(artifactPath(JUNIT_ARTIFACT_ID)).toBe(`/api/v1/artifacts/${JUNIT_ARTIFACT_ID}`);
    expect(artifactPath("a/b")).toBe("/api/v1/artifacts/a%2Fb");
  });
});

describe("readArtifactFile", () => {
  it("asks the service with the session and streams the file back with its type and name", async () => {
    const fetcher = answering(
      new Response(FILE, {
        status: 200,
        headers: {
          "Content-Type": "application/xml",
          "Content-Disposition": "inline; filename=\"junit-build3.xml\"; filename*=UTF-8''junit-build3.xml",
          "Set-Cookie": "leak=1",
          "X-Amz-Request-Id": "EXAMPLE",
          "X-Ouro-Storage-Key": "org/482/3/junit-build3.xml",
          ETag: '"s3-etag"',
          Server: "MinIO",
        },
      }),
    );

    const response = await readArtifactFile(JUNIT_ARTIFACT_ID, {
      fetcher,
      baseUrl: BASE,
      cookie: () => Promise.resolve("better-auth.session_token=abc"),
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${BASE}${artifactPath(JUNIT_ARTIFACT_ID)}`);
    expect(init?.headers).toEqual({ Cookie: "better-auth.session_token=abc" });
    expect(init?.cache).toBe("no-store");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/xml");
    expect(response.headers.get("Content-Disposition")).toBe(
      "inline; filename=\"junit-build3.xml\"; filename*=UTF-8''junit-build3.xml",
    );
    expectSafe(response);
    expect(await response.text()).toBe(FILE);
  });

  it("passes on the file's type and disposition and nothing else the service or its store said", async () => {
    const response = await readArtifactFile(JUNIT_ARTIFACT_ID, {
      fetcher: answering(
        new Response(FILE, {
          headers: {
            "Content-Type": "application/xml",
            "Set-Cookie": "leak=1",
            "X-Amz-Request-Id": "EXAMPLE",
            "X-Ouro-Storage-Key": "org/482/3/junit-build3.xml",
            ETag: '"s3-etag"',
            Server: "MinIO",
          },
        }),
      ),
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
    });

    expect(PASSED_HEADERS).toEqual(["Content-Type", "Content-Disposition"]);
    expect([...response.headers.keys()].sort()).toEqual(
      ["cache-control", "content-security-policy", "content-type", "x-content-type-options"].sort(),
    );
  });

  it("sets the safety headers itself, over whatever the service answered", async () => {
    const response = await readArtifactFile(JUNIT_ARTIFACT_ID, {
      fetcher: answering(
        new Response("<html><script>alert(1)</script></html>", {
          headers: {
            "Content-Type": "text/html",
            "Content-Security-Policy": "default-src *",
            "X-Content-Type-Options": "sniff",
            "Cache-Control": "public, max-age=31536000",
          },
        }),
      ),
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
    });

    expectSafe(response);
    expect(Object.keys(SAFETY_HEADERS).sort()).toEqual(
      ["Cache-Control", "Content-Security-Policy", "X-Content-Type-Options"].sort(),
    );
  });

  it("hands the body over as a stream rather than reading it whole", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(FILE));
        controller.close();
      },
    });
    const response = await readArtifactFile(JUNIT_ARTIFACT_ID, {
      fetcher: answering(new Response(body, { status: 200 })),
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
    });

    expect(response.body).toBe(body);
  });

  it("sends no cookie header when there is no session", async () => {
    const fetcher = answering(new Response("", { status: 401 }));

    await readArtifactFile(JUNIT_ARTIFACT_ID, { fetcher, baseUrl: BASE, cookie: () => Promise.resolve(undefined) });

    expect(fetcher.mock.calls[0]![1]?.headers).toEqual({});
  });

  it("passes an expired artifact's 410 through with the service's words", async () => {
    const refusal = { code: "artifact_expired", message: "That artifact has expired." };
    const response = await readArtifactFile(JUNIT_ARTIFACT_ID, {
      fetcher: answering(Response.json(refusal, { status: 410 })),
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
    });

    expect(response.status).toBe(410);
    expectSafe(response);
    expect(await response.json()).toEqual(refusal);
  });

  it("passes another workspace's 404 through", async () => {
    const refusal = { code: "artifact_not_found", message: "No such artifact." };
    const response = await readArtifactFile(JUNIT_ARTIFACT_ID, {
      fetcher: answering(Response.json(refusal, { status: 404 })),
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(refusal);
  });

  it("refuses an id that is not a uuid before sending anything — `..` would be another route", async () => {
    for (const id of ["..", ".", "x", "../../auth/get-session", `${JUNIT_ARTIFACT_ID}/..`, ""]) {
      const fetcher = vi.fn();
      const response = await readArtifactFile(id, { fetcher, baseUrl: BASE, cookie: () => Promise.resolve("c=1") });

      expect(fetcher).not.toHaveBeenCalled();
      expect(response.status).toBe(422);
      expectSafe(response);
      expect(await response.json()).toEqual({ code: ARTIFACT_ID_INVALID_CODE, message: ARTIFACT_ID_INVALID });
    }
  });

  it("answers a 502 in its own words when the service could not be reached", async () => {
    const response = await readArtifactFile(JUNIT_ARTIFACT_ID, {
      fetcher: vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
    });

    expect(response.status).toBe(502);
    expectSafe(response);
    expect(await response.json()).toEqual({ code: ARTIFACT_UNAVAILABLE_CODE, message: UNREACHABLE_ARTIFACT });
  });

  it("gives up on a service that never answers, and says so", async () => {
    const fetcher = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );

    const response = await readArtifactFile(JUNIT_ARTIFACT_ID, {
      fetcher,
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
      timeoutMs: 5,
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: ARTIFACT_UNAVAILABLE_CODE, message: UNREACHABLE_ARTIFACT });
  });

  it("times the first byte only: a body still arriving after the deadline is not cut", async () => {
    let signal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      signal = init?.signal;

      return Promise.resolve(new Response(FILE));
    });

    const response = await readArtifactFile(JUNIT_ARTIFACT_ID, {
      fetcher,
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
      timeoutMs: 5,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(signal?.aborted).toBe(false);
    expect(await response.text()).toBe(FILE);
  });
});
