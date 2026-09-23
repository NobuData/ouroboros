import { describe, expect, it, vi } from "vitest";

import { CACHE_CONTROL } from "@/app/api/poll-response";

import { SEEDED_RUN_ID } from "../helpers/runs";

/**
 * A run's transcript, passed through to the browser (#310): the take-over dialog's JSONL link.
 * The body streams straight through, the session goes with the request, and a refusal keeps
 * the service's status and words.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { PASSED_HEADERS, RUN_TRANSCRIPT_UNAVAILABLE_CODE, UNREACHABLE_TRANSCRIPT, readRunTranscript, transcriptPath } =
  await import("@/app/api/run-transcript");

/** The service's address in these cases. */
const BASE = "http://rest.test";

/** Two lines of JSONL. */
const FILE = '{"seq":1,"kind":"model"}\n{"seq":2,"kind":"tool"}\n';

/**
 * A fetch answering one response.
 *
 * @param response What to answer.
 * @returns The stub.
 */
function answering(response: Response) {
  return vi.fn<typeof fetch>(() => Promise.resolve(response));
}

describe("transcriptPath", () => {
  it("is the service's export, the id encoded", () => {
    expect(transcriptPath(SEEDED_RUN_ID)).toBe(`/api/v1/runs/${SEEDED_RUN_ID}/transcript.jsonl`);
    expect(transcriptPath("a/b")).toBe("/api/v1/runs/a%2Fb/transcript.jsonl");
  });
});

describe("readRunTranscript", () => {
  it("asks the service with the session and streams the file back with its type and name", async () => {
    const fetcher = answering(
      new Response(FILE, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson",
          "Content-Disposition": 'inline; filename="loop-1847.jsonl"',
          "Set-Cookie": "leak=1",
        },
      }),
    );

    const response = await readRunTranscript(SEEDED_RUN_ID, {
      fetcher,
      baseUrl: BASE,
      cookie: () => Promise.resolve("better-auth.session_token=abc"),
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${BASE}${transcriptPath(SEEDED_RUN_ID)}`);
    expect(init?.headers).toEqual({ Cookie: "better-auth.session_token=abc" });
    expect(init?.cache).toBe("no-store");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");
    expect(response.headers.get("Content-Disposition")).toBe('inline; filename="loop-1847.jsonl"');
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    // Only the headers the file needs travel back.
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(PASSED_HEADERS).toEqual(["Content-Type", "Content-Disposition"]);
    expect(await response.text()).toBe(FILE);
  });

  it("hands the body over as a stream rather than reading it whole", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(FILE));
        controller.close();
      },
    });
    const response = await readRunTranscript(SEEDED_RUN_ID, {
      fetcher: answering(new Response(body, { status: 200 })),
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
    });

    expect(response.body).toBe(body);
  });

  it("sends no cookie header when there is no session", async () => {
    const fetcher = answering(new Response("", { status: 401 }));

    await readRunTranscript(SEEDED_RUN_ID, { fetcher, baseUrl: BASE, cookie: () => Promise.resolve(undefined) });

    expect(fetcher.mock.calls[0]![1]?.headers).toEqual({});
  });

  it("passes a refusal through with the service's status and words", async () => {
    const refusal = JSON.stringify({ code: "run_not_found", message: "No such run." });
    const response = await readRunTranscript(SEEDED_RUN_ID, {
      fetcher: answering(new Response(refusal, { status: 404, headers: { "Content-Type": "application/json" } })),
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "run_not_found", message: "No such run." });
  });

  it("refuses an id that is not a uuid before sending anything — `..` would be another route", async () => {
    for (const id of ["..", ".", "x", "../../auth/get-session", `${SEEDED_RUN_ID}/..`, ""]) {
      const fetcher = vi.fn();
      const response = await readRunTranscript(id, { fetcher, baseUrl: BASE, cookie: () => Promise.resolve("c=1") });

      expect(fetcher).not.toHaveBeenCalled();
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ code: "validation_failed", message: "That is not a run id." });
    }
  });

  it("answers a 502 in its own words when the service could not be reached", async () => {
    const response = await readRunTranscript(SEEDED_RUN_ID, {
      fetcher: vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
      baseUrl: BASE,
      cookie: () => Promise.resolve(undefined),
    });

    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(await response.json()).toEqual({ code: RUN_TRANSCRIPT_UNAVAILABLE_CODE, message: UNREACHABLE_TRANSCRIPT });
  });
});
