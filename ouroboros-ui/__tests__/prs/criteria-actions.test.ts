import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import type { AttachEvidenceRequest } from "@/app/api/pull-requests";
import { MAX_QUALIFIER_LENGTH, NO_ATTEMPT_TO_CITE, NO_RUN_TO_CITE } from "@/app/prs/evidence-options";
import {
  ACTION_INVALID,
  ACTION_INVALID_CODE,
  ACTION_UNREACHABLE,
  ACTION_UNREACHABLE_CODE,
  MAX_CLAIM_LENGTH,
  MAX_WAIVE_REASON_LENGTH,
} from "@/app/prs/outcomes";

import {
  ATTEMPT_3_ID,
  ATTEMPT_4_ID,
  PR_514_ID,
  REV_2_ID,
  TELEMETRY_PATH,
  criterion,
  criterionId,
  matrixPage,
  waiver,
} from "../helpers/pull-requests";
import { SEEDED_RUN_ID } from "../helpers/runs";
import { attempt, page as attemptPage, suite, testCase, timeline } from "../helpers/test-results";

/**
 * The criteria matrix's server hop (#366). The role gate, whether a reference resolves and
 * whether a claim has evidence are the service's: this sends only what the page could have built,
 * and hands a refusal back as a value the page can draw.
 */

const create = vi.fn();
const importCriteria = vi.fn();
const attach = vi.fn();
const verify = vi.fn();
const waive = vi.fn();
const readPage = vi.fn();
const readTimeline = vi.fn();
const readAttempt = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/pull-requests", async (original) => ({
  ...(await original<typeof import("@/app/api/pull-requests")>()),
  pullRequests: {
    page: (id: string) => readPage(id),
    createCriterion: (id: string, claim: string) => create(id, claim),
    importCriteria: (id: string) => importCriteria(id),
    attachEvidence: (id: string, criterion: string, request: AttachEvidenceRequest) =>
      attach(id, criterion, request),
    verifyCriterion: (id: string, criterion: string) => verify(id, criterion),
    waiveCriterion: (id: string, criterion: string, reason: string) =>
      waive(id, criterion, reason),
  },
}));
vi.mock("@/app/api/test-results", async (original) => ({
  ...(await original<typeof import("@/app/api/test-results")>()),
  testResults: {
    timeline: (runId: string) => readTimeline(runId),
    page: (testRunId: string) => readAttempt(testRunId),
  },
}));

const { addClaim, attachEvidence, importFromPlan, readEvidenceOptions, verifyClaim, waiveClaim } =
  await import("@/app/prs/criteria-actions");

/** The refusal made before calling out. */
const REFUSED = { ok: false, status: 422, code: ACTION_INVALID_CODE, reason: ACTION_INVALID };

const CLAIM = criterionId(1);
const KEY = "a".repeat(64);

beforeEach(() => {
  for (const mock of [
    create,
    importCriteria,
    attach,
    verify,
    waive,
    readPage,
    readTimeline,
    readAttempt,
  ]) {
    mock.mockReset();
  }
});

describe("addClaim", () => {
  it("writes the claim and returns it", async () => {
    create.mockResolvedValue(criterion());

    expect(await addClaim(PR_514_ID, "Frames in ISR order")).toEqual({
      ok: true,
      answer: criterion(),
    });
    expect(create).toHaveBeenCalledWith(PR_514_ID, "Frames in ISR order");
  });

  it.each([
    ["an id that is not a uuid", "514", "A claim"],
    ["an empty claim", PR_514_ID, ""],
    ["a padded claim", PR_514_ID, " A claim "],
    ["an over-long claim", PR_514_ID, "x".repeat(MAX_CLAIM_LENGTH + 1)],
    ["a claim that is not text", PR_514_ID, 7 as unknown as string],
  ])("refuses %s before calling out", async (_name, prId, claim) => {
    expect(await addClaim(prId, claim)).toEqual(REFUSED);
    expect(create).not.toHaveBeenCalled();
  });

  it("hands a viewer's 403 back as a refusal", async () => {
    create.mockRejectedValue(new ApiError(403, "forbidden", "Only a member may do this."));

    expect(await addClaim(PR_514_ID, "A claim")).toEqual({
      ok: false,
      status: 403,
      code: "forbidden",
      reason: "Only a member may do this.",
    });
  });

  it("says the service did not answer on a dropped connection", async () => {
    create.mockRejectedValue(new TypeError("fetch failed"));

    expect(await addClaim(PR_514_ID, "A claim")).toEqual({
      ok: false,
      status: 502,
      code: ACTION_UNREACHABLE_CODE,
      reason: ACTION_UNREACHABLE,
    });
  });

  it("rethrows what is neither — the redirect of an ended session above all", async () => {
    create.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(addClaim(PR_514_ID, "A claim")).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("importFromPlan", () => {
  it("imports and returns what was written", async () => {
    const answer = { draftId: "d", imported: [criterion({ source: "plan" })], alreadyPresent: [], tooLong: [] };
    importCriteria.mockResolvedValue(answer);

    expect(await importFromPlan(PR_514_ID)).toEqual({ ok: true, answer });
  });

  it("hands back the service's refusal of a PR with no plan", async () => {
    importCriteria.mockRejectedValue(
      new ApiError(409, "plan_context_missing", "No plan draft was pushed as this PR's ticket."),
    );

    expect(await importFromPlan(PR_514_ID)).toMatchObject({
      ok: false,
      status: 409,
      code: "plan_context_missing",
    });
  });

  it("refuses an id that is not a uuid before calling out", async () => {
    expect(await importFromPlan("514")).toEqual(REFUSED);
    expect(importCriteria).not.toHaveBeenCalled();
  });
});

describe("readEvidenceOptions", () => {
  it("offers the rows of the attempt the latest revision was judged on", async () => {
    readPage.mockResolvedValue(matrixPage());
    readTimeline.mockResolvedValue(
      timeline({ attempts: [attempt(3, { id: ATTEMPT_3_ID }), attempt(4, { id: ATTEMPT_4_ID })] }),
    );
    readAttempt.mockResolvedValue(
      attemptPage({
        suites: [suite({ name: "telemetry", cases: [testCase({ id: "case-1", caseKey: KEY })] })],
      }),
    );

    const outcome = await readEvidenceOptions(PR_514_ID);

    expect(readTimeline).toHaveBeenCalledWith(SEEDED_RUN_ID);
    expect(readAttempt).toHaveBeenCalledWith(ATTEMPT_4_ID);
    expect(outcome).toMatchObject({
      ok: true,
      answer: {
        attempt: { id: ATTEMPT_4_ID, seq: 4 },
        tests: [{ id: "case-1", caseKey: KEY }],
        measurements: [],
        reason: null,
      },
    });
  });

  it("offers nothing, and says why, for a PR no loop opened", async () => {
    readPage.mockResolvedValue(matrixPage({ pullRequest: { run: null } }));

    expect(await readEvidenceOptions(PR_514_ID)).toMatchObject({
      ok: true,
      answer: { tests: [], measurements: [], reason: NO_RUN_TO_CITE },
    });
    expect(readTimeline).not.toHaveBeenCalled();
  });

  it("offers nothing, and says why, for a run never tested", async () => {
    readPage.mockResolvedValue(matrixPage());
    readTimeline.mockResolvedValue(timeline({ attempts: [] }));

    expect(await readEvidenceOptions(PR_514_ID)).toMatchObject({
      ok: true,
      answer: { reason: NO_ATTEMPT_TO_CITE },
    });
    expect(readAttempt).not.toHaveBeenCalled();
  });

  it("hands a failed read back as a refusal", async () => {
    readPage.mockRejectedValue(new ApiError(404, "pull_request_not_found", "No such PR."));

    expect(await readEvidenceOptions(PR_514_ID)).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses an id that is not a uuid before calling out", async () => {
    expect(await readEvidenceOptions("514")).toEqual(REFUSED);
    expect(readPage).not.toHaveBeenCalled();
  });
});

describe("attachEvidence", () => {
  const TEST: AttachEvidenceRequest = { kind: "test_case", caseKey: KEY, testRunId: ATTEMPT_4_ID };

  it("sends a test reference and returns the claim", async () => {
    attach.mockResolvedValue(criterion());

    expect(await attachEvidence(PR_514_ID, CLAIM, { ...TEST, note: "10⁶ frames" })).toEqual({
      ok: true,
      answer: criterion(),
    });
    expect(attach).toHaveBeenCalledWith(PR_514_ID, CLAIM, { ...TEST, note: "10⁶ frames" });
  });

  it("sends a measurement reference", async () => {
    attach.mockResolvedValue(criterion());
    await attachEvidence(PR_514_ID, CLAIM, {
      kind: "hil_measurement",
      hilMeasurementId: ATTEMPT_3_ID,
    });

    expect(attach).toHaveBeenCalledWith(PR_514_ID, CLAIM, {
      kind: "hil_measurement",
      hilMeasurementId: ATTEMPT_3_ID,
    });
  });

  it("sends a hunk reference, pinned to its revision", async () => {
    attach.mockResolvedValue(criterion());
    await attachEvidence(PR_514_ID, CLAIM, {
      kind: "hunk",
      path: TELEMETRY_PATH,
      lineStart: 41,
      lineEnd: 66,
      revisionId: REV_2_ID,
    });

    expect(attach).toHaveBeenCalledWith(PR_514_ID, CLAIM, {
      kind: "hunk",
      path: TELEMETRY_PATH,
      lineStart: 41,
      lineEnd: 66,
      revisionId: REV_2_ID,
    });
  });

  it("sends only the fields of the reference's kind", async () => {
    attach.mockResolvedValue(criterion());
    await attachEvidence(PR_514_ID, CLAIM, {
      ...TEST,
      hilMeasurementId: ATTEMPT_3_ID,
      path: "smuggled.c",
      lineStart: 1,
      lineEnd: 2,
    });

    expect(attach).toHaveBeenCalledWith(PR_514_ID, CLAIM, TEST);
  });

  it.each<[string, unknown]>([
    ["a kind the picker does not cite", { kind: "analysis_note", note: "free text" }],
    ["an artifact", { kind: "build_artifact", testArtifactId: ATTEMPT_3_ID }],
    ["a case key that is not one", { ...TEST, caseKey: "frame_order" }],
    ["a test with no attempt", { kind: "test_case", caseKey: KEY }],
    ["a measurement id that is not a uuid", { kind: "hil_measurement", hilMeasurementId: "m-1" }],
    ["a backwards hunk", { kind: "hunk", path: "a.c", lineStart: 9, lineEnd: 3 }],
    ["a hunk with no path", { kind: "hunk", lineStart: 1, lineEnd: 3 }],
    ["a hunk on a revision that is not a uuid", { kind: "hunk", path: "a.c", lineStart: 1, lineEnd: 3, revisionId: "2" }],
    ["a padded qualifier", { ...TEST, note: " padded " }],
    ["an empty qualifier", { ...TEST, note: "" }],
    ["an over-long qualifier", { ...TEST, note: "x".repeat(MAX_QUALIFIER_LENGTH + 1) }],
    ["nothing", null],
  ])("refuses %s before calling out", async (_name, request) => {
    expect(await attachEvidence(PR_514_ID, CLAIM, request as AttachEvidenceRequest)).toEqual(
      REFUSED,
    );
    expect(attach).not.toHaveBeenCalled();
  });

  it("refuses ids that are not uuids before calling out", async () => {
    expect(await attachEvidence("514", CLAIM, TEST)).toEqual(REFUSED);
    expect(await attachEvidence(PR_514_ID, "1", TEST)).toEqual(REFUSED);
    expect(attach).not.toHaveBeenCalled();
  });

  it("hands back the service's refusal of a reference that does not resolve", async () => {
    attach.mockRejectedValue(
      new ApiError(422, "evidence_unresolved", "test_case a… does not resolve."),
    );

    expect(await attachEvidence(PR_514_ID, CLAIM, TEST)).toMatchObject({
      ok: false,
      status: 422,
      code: "evidence_unresolved",
    });
  });
});

describe("verifyClaim", () => {
  it("verifies and returns the claim", async () => {
    verify.mockResolvedValue(criterion({ status: "verified" }));

    expect(await verifyClaim(PR_514_ID, CLAIM)).toEqual({
      ok: true,
      answer: criterion({ status: "verified" }),
    });
    expect(verify).toHaveBeenCalledWith(PR_514_ID, CLAIM);
  });

  it("hands back the service's refusal of a claim with no evidence", async () => {
    verify.mockRejectedValue(
      new ApiError(409, "criterion_evidence_required", "A claim is verified by its evidence."),
    );

    expect(await verifyClaim(PR_514_ID, CLAIM)).toMatchObject({
      ok: false,
      status: 409,
      code: "criterion_evidence_required",
    });
  });

  it("refuses ids that are not uuids before calling out", async () => {
    expect(await verifyClaim("514", CLAIM)).toEqual(REFUSED);
    expect(await verifyClaim(PR_514_ID, "1")).toEqual(REFUSED);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("waiveClaim", () => {
  const answer = {
    criterion: criterion({ status: "waived", waiver: waiver() }),
    annotation: { state: "annotated", mode: "created", error: null },
  };

  it("waives with the reason and returns the claim and the annotation", async () => {
    waive.mockResolvedValue(answer);

    expect(await waiveClaim(PR_514_ID, CLAIM, "rig runs at 22°C only")).toEqual({
      ok: true,
      answer,
    });
    expect(waive).toHaveBeenCalledWith(PR_514_ID, CLAIM, "rig runs at 22°C only");
  });

  it("returns a host that refused the annotation as an answer, not a refusal", async () => {
    const failed = {
      ...answer,
      annotation: { state: "failed", mode: null, error: { code: "host_auth", message: "no" } },
    };
    waive.mockResolvedValue(failed);

    expect(await waiveClaim(PR_514_ID, CLAIM, "why")).toEqual({ ok: true, answer: failed });
  });

  it.each([
    ["an empty reason", ""],
    ["a padded reason", " why "],
    ["an over-long reason", "x".repeat(MAX_WAIVE_REASON_LENGTH + 1)],
  ])("refuses %s before calling out", async (_name, reason) => {
    expect(await waiveClaim(PR_514_ID, CLAIM, reason)).toEqual(REFUSED);
    expect(waive).not.toHaveBeenCalled();
  });

  it("hands a member's 403 back as a refusal", async () => {
    waive.mockRejectedValue(new ApiError(403, "forbidden", "Only an owner or admin may waive."));

    expect(await waiveClaim(PR_514_ID, CLAIM, "why")).toMatchObject({ ok: false, status: 403 });
  });
});
