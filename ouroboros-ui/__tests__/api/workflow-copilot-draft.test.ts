import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { CACHE_CONTROL } from "@/app/api/poll-response";
import { UNREACHABLE_DRAFT } from "@/app/workflows/copilot/stages";

import { SECURITY_PATCH_ID, seededStageDraft } from "../helpers/workflow-copilot";

/**
 * The stage list's poll, answered on this origin (CE.3, #567): another site's request is refused
 * before anything is read, the id is a uuid or nothing is asked, the draft travels as the service
 * served it and is never cached as current, and every way the read can fail is one of the poll's
 * answers rather than a throw.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { COPILOT_DRAFT_UNAVAILABLE_CODE, answerDraftPoll, readCopilotDraftForPoll } = await import(
  "@/app/api/workflow-copilot-draft"
);
const { COPILOT_ID_INVALID, COPILOT_REQUEST_INVALID_CODE, CROSS_ORIGIN, CROSS_ORIGIN_CODE } = await import(
  "@/app/api/workflow-copilot-stream"
);
const route = await import("@/app/api/workflows/[id]/copilot/draft/route");

/** The browser's poll, from this site unless told otherwise. */
function request(headers: Record<string, string> = {}): Request {
  return new Request(`http://ui.test/api/workflows/${SECURITY_PATCH_ID}/copilot/draft`, {
    headers: { Host: "ui.test", "Sec-Fetch-Site": "same-origin", ...headers },
  });
}

describe("reading for the poll", () => {
  it("answers the draft as fresh, read by the workflow's id under a deadline", async () => {
    const read = vi.fn(() => Promise.resolve(seededStageDraft()));

    await expect(readCopilotDraftForPoll(SECURITY_PATCH_ID, read)).resolves.toEqual({
      state: "fresh",
      payload: seededStageDraft(),
      etag: null,
      pollAfterSeconds: null,
    });
    expect(read).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, expect.any(AbortSignal));
  });

  it("says the session is gone for a 401, rather than following a redirect nobody would see", async () => {
    const read = () => Promise.reject(new ApiError(401, "unauthenticated", "Sign in."));

    await expect(readCopilotDraftForPoll(SECURITY_PATCH_ID, read)).resolves.toEqual({ state: "gone" });
  });

  it("carries the service's sentence for a refusal, and its own for a read that reached nothing", async () => {
    const refused = () => Promise.reject(new ApiError(404, "workflow_not_found", "No such workflow."));
    const dropped = () => Promise.reject(new TypeError("fetch failed"));

    await expect(readCopilotDraftForPoll(SECURITY_PATCH_ID, refused)).resolves.toMatchObject({
      state: "failed",
      reason: "No such workflow.",
    });
    await expect(readCopilotDraftForPoll(SECURITY_PATCH_ID, dropped)).resolves.toMatchObject({
      state: "failed",
      reason: UNREACHABLE_DRAFT,
    });
  });
});

describe("answering the browser", () => {
  it("hands the draft back as JSON that must be revalidated, never reused", async () => {
    const response = await answerDraftPoll(request(), SECURITY_PATCH_ID, () => Promise.resolve(seededStageDraft()));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    await expect(response.json()).resolves.toEqual(seededStageDraft());
  });

  it("refuses another site's request before anything is read", async () => {
    const read = vi.fn(() => Promise.resolve(seededStageDraft()));

    const others: Record<string, string>[] = [
      { "Sec-Fetch-Site": "cross-site" },
      { "Sec-Fetch-Site": "same-site" },
      { "Sec-Fetch-Site": "same-origin", Origin: "http://evil.test" },
    ];
    for (const headers of others) {
      const response = await answerDraftPoll(request(headers), SECURITY_PATCH_ID, read);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: CROSS_ORIGIN_CODE, message: CROSS_ORIGIN });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a uuid before anything is read", async () => {
    const read = vi.fn(() => Promise.resolve(seededStageDraft()));

    const response = await answerDraftPoll(request(), "../../registry", read);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: COPILOT_REQUEST_INVALID_CODE, message: COPILOT_ID_INVALID });
    expect(read).not.toHaveBeenCalled();
  });

  it("answers 401 when the session has ended, and 502 under its own code when the draft could not be read", async () => {
    const gone = await answerDraftPoll(request(), SECURITY_PATCH_ID, () =>
      Promise.reject(new ApiError(401, "unauthenticated", "Sign in.")),
    );
    const failed = await answerDraftPoll(request(), SECURITY_PATCH_ID, () =>
      Promise.reject(new ApiError(503, "service_unavailable", "The service could not answer.")),
    );

    expect(gone.status).toBe(401);
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toEqual({
      code: COPILOT_DRAFT_UNAVAILABLE_CODE,
      message: "The service could not answer.",
    });
  });
});

describe("the route", () => {
  it("is never static, and answers a GET only", () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(Object.keys(route).sort()).toEqual(["GET", "dynamic"]);
  });

  it("checks the caller and the id it was given before it asks the service", async () => {
    const crossSite = await route.GET(request({ "Sec-Fetch-Site": "cross-site" }), {
      params: Promise.resolve({ id: SECURITY_PATCH_ID }),
    });
    const badId = await route.GET(request(), { params: Promise.resolve({ id: "not-a-uuid" }) });

    expect(crossSite.status).toBe(403);
    expect(badId.status).toBe(422);
  });
});
