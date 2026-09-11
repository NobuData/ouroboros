import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { clientAnswering } from "../helpers/api";
import { SELECTED_TRIO, backlogListing, fanout, queuedSelection, syncStatus } from "../helpers/issues";

// The resource file sits on the server-side client, so importing it pulls in the three
// server-only modules every server-side suite answers. Every case passes its own client.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const {
  BACKLOG_ALREADY_ESTIMATING_CODE,
  BACKLOG_SYNC_RUNNING_CODE,
  BACKLOG_SYNC_TOO_SOON_CODE,
  ESTIMATION_RATE_LIMITED_CODE,
  FORBIDDEN_CODE,
  backlog,
} = await import("@/app/api/backlog");

/**
 * The backlog resource file (#115, #117) — the four `backlog` operations the intake page calls.
 *
 * Held to what every resource file here is held to: the right path, the right verb, the body
 * returned rather than the envelope around it, and a refusal that arrives as an `ApiError`
 * carrying the service's own code and details. The codes the head's actions branch on are read
 * back out of `ouroboros-rest/openapi.yaml`, so a renamed code is a red suite here rather than a
 * refusal the head silently stops recognising.
 */

/** The contract the codes must appear in, read once. */
const CONTRACT = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "ouroboros-rest", "openapi.yaml"),
  "utf8",
);

describe("backlog.list", () => {
  it("GETs the listing with the query it was given, and returns the listing itself", async () => {
    const { client, requests } = clientAnswering(backlogListing());

    const listing = await backlog.list({ state: "all", limit: 1 }, client);

    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/backlog?state=all&limit=1");
    expect(listing).toEqual(backlogListing());
  });

  it("sends no query at all when asked for the service's defaults", async () => {
    const { client, requests } = clientAnswering(backlogListing());

    await backlog.list({}, client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/backlog");
  });

  it("hands the request the signal it was given, so a poll's deadline reaches the wire (#117)", async () => {
    const { client, requests } = clientAnswering(backlogListing());

    await backlog.list({}, client, AbortSignal.abort());

    expect(requests[0]?.signal.aborted).toBe(true);
  });

  it("rejects with the service's refusal rather than an empty listing", async () => {
    const { client } = clientAnswering(
      { code: "organization_required", message: "Choose a workspace.", details: {} },
      400,
    );

    await expect(backlog.list({}, client)).rejects.toMatchObject({
      status: 400,
      code: "organization_required",
      message: "Choose a workspace.",
    });
  });
});

describe("backlog.estimateAll", () => {
  it("POSTs to the fan-out with no body, and returns its three counts", async () => {
    const { client, requests } = clientAnswering(fanout({ enqueued: 7, skipped: 2 }), 202);

    const answer = await backlog.estimateAll(client);

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/backlog/estimate-all");
    expect(await requests[0]?.text()).toBe("");
    expect(answer).toEqual({ enqueued: 7, skipped: 2, total: 9 });
  });

  it("hands a busy backlog's refusal through, details and all", async () => {
    const { client } = clientAnswering(
      {
        code: BACKLOG_ALREADY_ESTIMATING_CODE,
        message: "Every issue in this backlog is already being estimated.",
        details: { estimating: 9 },
      },
      409,
    );

    await expect(backlog.estimateAll(client)).rejects.toMatchObject({
      status: 409,
      code: BACKLOG_ALREADY_ESTIMATING_CODE,
      details: { estimating: 9 },
    });
  });
});

describe("backlog.queue", () => {
  it("POSTs the selection exactly as it was given, and returns what was created", async () => {
    const { client, requests } = clientAnswering(queuedSelection(), 201);

    const answer = await backlog.queue({ issueIds: [...SELECTED_TRIO] }, client);

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/backlog/queue");
    // No workflow: *Queue N selected* queues each issue under the one its estimate suggested.
    expect(await requests[0]?.json()).toEqual({ issueIds: [...SELECTED_TRIO] });
    expect(answer).toEqual(queuedSelection());
  });

  it("carries a refusal's offenders through to the caller", async () => {
    const details = {
      issues: [{ issueId: SELECTED_TRIO[0], code: "issue_not_sized", issueNumber: 483 }],
    };
    const { client } = clientAnswering(
      {
        code: "queue_issues_not_queueable",
        message: "Some of those issues have not been sized yet. Only sized issues can be queued.",
        details,
      },
      422,
    );

    const refusal = await backlog
      .queue({ issueIds: [SELECTED_TRIO[0]!] }, client)
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ApiError);
    expect(refusal).toMatchObject({ status: 422, code: "queue_issues_not_queueable", details });
  });
});

describe("backlog.sync (#117)", () => {
  it("POSTs to the trigger with no body, and returns the status at that moment", async () => {
    const { client, requests } = clientAnswering(syncStatus(), 202);

    const answer = await backlog.sync(client);

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/backlog/sync");
    expect(await requests[0]?.text()).toBe("");
    expect(answer).toEqual(syncStatus());
  });

  it("hands a too-soon refusal through, with its wait", async () => {
    const { client } = clientAnswering(
      {
        code: BACKLOG_SYNC_TOO_SOON_CODE,
        message: "A cycle ran less than thirty seconds ago.",
        details: { retryAfterSeconds: 12 },
      },
      409,
    );

    await expect(backlog.sync(client)).rejects.toMatchObject({
      status: 409,
      code: BACKLOG_SYNC_TOO_SOON_CODE,
      details: { retryAfterSeconds: 12 },
    });
  });
});

describe("the codes the page's actions branch on", () => {
  it("are the contract's own spellings", () => {
    expect(FORBIDDEN_CODE).toBe("forbidden");
    expect(BACKLOG_ALREADY_ESTIMATING_CODE).toBe("backlog_already_estimating");
    expect(ESTIMATION_RATE_LIMITED_CODE).toBe("estimation_rate_limited");
    expect(BACKLOG_SYNC_RUNNING_CODE).toBe("backlog_sync_running");
    expect(BACKLOG_SYNC_TOO_SOON_CODE).toBe("backlog_sync_too_soon");
  });

  it("appear in ouroboros-rest/openapi.yaml, so a rename there is a failure here", () => {
    for (const code of [
      FORBIDDEN_CODE,
      BACKLOG_ALREADY_ESTIMATING_CODE,
      ESTIMATION_RATE_LIMITED_CODE,
      BACKLOG_SYNC_RUNNING_CODE,
      BACKLOG_SYNC_TOO_SOON_CODE,
    ]) {
      expect(CONTRACT, code).toContain(`\`${code}\` —`);
    }
  });
});
