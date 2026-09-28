import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { clientAnswering, stubClient } from "../helpers/api";
import {
  PR_514_ID,
  REV_2_ID,
  prPage,
  returned,
  review,
  summary,
} from "../helpers/pull-requests";
import { SEEDED_RUN_ID } from "../helpers/runs";

// The facade sits on the server-side client — see `server.test.ts`.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { RUN_PRS_LIMIT, isPullRequestId, newestByRun, pullRequests } = await import(
  "@/app/api/pull-requests"
);

/**
 * The PR verification page's share of AX.5's contract (#361, consumed by #363): the page read,
 * the by-run lookup over the listing's `runId` filter, and the two head actions.
 */

/**
 * A page of the listing.
 *
 * @param items Its rows.
 * @returns The page.
 */
function listing(items: readonly unknown[]) {
  return { items, total: items.length, limit: RUN_PRS_LIMIT, offset: 0 };
}

describe("isPullRequestId", () => {
  it("accepts a uuid and nothing else", () => {
    expect(isPullRequestId(PR_514_ID)).toBe(true);
    expect(isPullRequestId(PR_514_ID.toUpperCase())).toBe(true);

    for (const value of ["514", "..", `${PR_514_ID}/../x`, "", null, undefined, 514]) {
      expect(isPullRequestId(value)).toBe(false);
    }
  });
});

describe("pullRequests.page", () => {
  it("reads the PR the id names and hands back the payload as served", async () => {
    const { client, requests } = clientAnswering(prPage());

    expect(await pullRequests.page(PR_514_ID, client)).toEqual(prPage());
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe(`http://rest.test:4000/api/v1/pull-requests/${PR_514_ID}`);
  });

  it("rejects with the service's envelope for a PR this workspace cannot see", async () => {
    const { client } = clientAnswering(
      { code: "pull_request_not_found", message: "No such pull request.", details: {} },
      404,
    );

    await expect(pullRequests.page(PR_514_ID, client)).rejects.toMatchObject({
      status: 404,
      code: "pull_request_not_found",
    });
    await expect(pullRequests.page(PR_514_ID, client)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("pullRequests.forRuns", () => {
  /** A second run, which opened no PR. */
  const OTHER_RUN = "5eed0009-0000-4000-8000-000000000474";

  it("asks the listing once for every run named, and answers each run's PR by run id", async () => {
    const { client, requests } = clientAnswering(listing([summary()]));

    const found = await pullRequests.forRuns([SEEDED_RUN_ID, OTHER_RUN, SEEDED_RUN_ID], client);

    expect([...found.keys()]).toEqual([SEEDED_RUN_ID]);
    expect(found.get(SEEDED_RUN_ID)?.id).toBe(PR_514_ID);
    expect(found.has(OTHER_RUN)).toBe(false);

    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe("/api/v1/pull-requests");
    expect(url.searchParams.getAll("runId").flatMap((value) => value.split(","))).toEqual([
      SEEDED_RUN_ID,
      OTHER_RUN,
    ]);
    expect(url.searchParams.get("limit")).toBe(String(RUN_PRS_LIMIT));
  });

  it("makes no request when no run is named", async () => {
    const { client, requests } = clientAnswering(listing([]));

    expect((await pullRequests.forRuns([], client)).size).toBe(0);
    expect(requests).toHaveLength(0);
  });

  it("names no more runs than the listing accepts", async () => {
    const { client, requests } = clientAnswering(listing([]));
    const many = Array.from(
      { length: RUN_PRS_LIMIT + 5 },
      (_, n) => `5eed0009-0000-4000-8000-${String(n).padStart(12, "0")}`,
    );

    await pullRequests.forRuns(many, client);

    const asked = new URL(requests[0]!.url).searchParams
      .getAll("runId")
      .flatMap((value) => value.split(","));
    expect(asked).toHaveLength(RUN_PRS_LIMIT);
  });

  it("answers the newest when a loop opened more than one, whatever order they arrive in", () => {
    const older = summary({ id: "5eed003a-0000-4000-8000-000000000510", number: 510 });
    const newer = summary({
      id: "5eed003a-0000-4000-8000-000000000520",
      number: 520,
      createdAt: "2026-09-27T15:00:00.000Z",
    });

    expect(newestByRun([older, newer]).get(SEEDED_RUN_ID)?.number).toBe(520);
    expect(newestByRun([newer, older]).get(SEEDED_RUN_ID)?.number).toBe(520);
    expect(newestByRun([]).size).toBe(0);
  });

  it("leaves out a PR no run opened", () => {
    expect(newestByRun([summary({ run: null })]).size).toBe(0);
  });

  it("rejects with the service's refusal", async () => {
    const { client } = clientAnswering(
      { code: "validation_failed", message: "runId must be a UUID.", details: {} },
      422,
    );

    await expect(pullRequests.forRuns(["482"], client)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("pullRequests.requestReview", () => {
  it("posts to the PR's request-review route and answers the slot", async () => {
    const outcome = { review: review(), created: true, humanApproval: null, aggregate: null };
    const { client, requests } = clientAnswering(outcome);

    expect(await pullRequests.requestReview(PR_514_ID, client)).toEqual(outcome);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(
      `http://rest.test:4000/api/v1/pull-requests/${PR_514_ID}/request-review`,
    );
    expect(await requests[0]?.json()).toEqual({});
  });

  it("rejects with a viewer's 403", async () => {
    const { client } = clientAnswering({ code: "forbidden", message: "No.", details: {} }, 403);

    await expect(pullRequests.requestReview(PR_514_ID, client)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("pullRequests.decideApproval (#365)", () => {
  it("posts the decision and its note to the PR's approvals route and answers the slot", async () => {
    const outcome = {
      review: review({ state: "declined", note: "Overshoot is still 2.4%." }),
      created: false,
      humanApproval: null,
      aggregate: null,
    };
    const { client, requests } = clientAnswering(outcome);

    expect(
      await pullRequests.decideApproval(
        PR_514_ID,
        { decision: "decline", note: "Overshoot is still 2.4%." },
        client,
      ),
    ).toEqual(outcome);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(
      `http://rest.test:4000/api/v1/pull-requests/${PR_514_ID}/approvals`,
    );
    expect(await requests[0]?.json()).toEqual({
      decision: "decline",
      note: "Overshoot is still 2.4%.",
    });
  });

  it("rejects with the service's refusal of a decline without a note", async () => {
    const { client } = clientAnswering(
      { code: "pr_decline_note_required", message: "A decline needs a note.", details: {} },
      422,
    );

    await expect(
      pullRequests.decideApproval(PR_514_ID, { decision: "decline" }, client),
    ).rejects.toMatchObject({ status: 422, code: "pr_decline_note_required" });
  });
});

describe("pullRequests.returnToLoop", () => {
  it("posts the gates, the revision and the replay key, and answers the control", async () => {
    const { client, requests } = stubClient(() => ({ body: returned() }));

    const answer = await pullRequests.returnToLoop(
      PR_514_ID,
      { gates: ["test_suite", "physical_hil"], revisionId: REV_2_ID, idempotencyKey: "press-1" },
      client,
    );

    expect(answer).toEqual(returned());
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(
      `http://rest.test:4000/api/v1/pull-requests/${PR_514_ID}/return-to-loop`,
    );
    expect(await requests[0]?.json()).toEqual({
      gates: ["test_suite", "physical_hil"],
      revisionId: REV_2_ID,
      idempotencyKey: "press-1",
    });
  });

  it("rejects with the service's refusal of a gate that is not red", async () => {
    const { client } = clientAnswering(
      { code: "pr_gate_not_red", message: "Build is not red.", details: {} },
      422,
    );

    await expect(
      pullRequests.returnToLoop(PR_514_ID, { gates: ["build"] }, client),
    ).rejects.toMatchObject({ status: 422, code: "pr_gate_not_red" });
  });
});
