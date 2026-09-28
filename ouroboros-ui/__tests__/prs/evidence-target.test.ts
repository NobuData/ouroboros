import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import type { PullRequestPage } from "@/app/api/pull-requests";
import type { TestRunPage } from "@/app/api/test-results";
import { testsPath } from "@/app/paths";

import {
  ATTEMPT_3_ID,
  ATTEMPT_4_ID,
  CITED_CASE_ID,
  CITED_MEASUREMENT_ID,
  PR_514_ID,
  evidenceId,
  matrixPage,
} from "../helpers/pull-requests";
import { SEEDED_RUN_ID } from "../helpers/runs";
import {
  attempt,
  measurement,
  page as attemptPage,
  physicalCase,
  suite,
  testCase,
  timeline,
} from "../helpers/test-results";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { MAX_ATTEMPTS_READ, evidenceTargetPath, selectionIn } = await import(
  "@/app/prs/evidence-target"
);

/**
 * Where a citation of a test or a measurement leads (#366): the attempt that holds the cited row,
 * with the row selected — resolved when the link is followed.
 */

/** Build 4: the cited case in `telemetry integration`, and the cited measurement on the rig. */
const BUILD_4 = attemptPage({
  suites: [
    suite(),
    suite({
      name: "telemetry integration",
      cases: [testCase({ id: CITED_CASE_ID, name: "test_frame_order_under_load" })],
    }),
  ],
  physical: [
    physicalCase({
      name: "Motor overshoot on e-stop release",
      measurements: [measurement({ id: CITED_MEASUREMENT_ID, value: 1.7 })],
    }),
  ],
});

/** Build 3, which holds neither. */
const BUILD_3 = attemptPage();

/**
 * Readers over a PR page and two attempts.
 *
 * @param page The PR page.
 * @param pages Each attempt's page, by id.
 * @returns The readers, and the attempt reader as a spy.
 */
function readers(
  page: PullRequestPage = matrixPage(),
  pages: Readonly<Record<string, TestRunPage>> = {
    [ATTEMPT_3_ID]: BUILD_3,
    [ATTEMPT_4_ID]: BUILD_4,
  },
) {
  const readAttempt = vi.fn((id: string) => Promise.resolve(pages[id] ?? attemptPage()));

  return {
    readAttempt,
    readers: {
      page: () => Promise.resolve(page),
      timeline: () =>
        Promise.resolve(
          timeline({
            attempts: [attempt(3, { id: ATTEMPT_3_ID }), attempt(4, { id: ATTEMPT_4_ID })],
          }),
        ),
      attempt: readAttempt,
    },
  };
}

describe("selectionIn", () => {
  const [test, hunk, measured] = matrixPage()
    .criteria.criteria.flatMap((each) => each.evidence)
    .slice(0, 3);

  it("selects the suite that holds a cited case", () => {
    expect(selectionIn(test!, BUILD_4)).toEqual({ suite: "telemetry integration" });
  });

  it("selects the measured case that holds a cited measurement", () => {
    expect(selectionIn(measured!, BUILD_4)).toEqual({
      case: "Motor overshoot on e-stop release",
    });
  });

  it("selects nothing in an attempt that does not hold the row, or for another kind", () => {
    expect(selectionIn(test!, BUILD_3)).toBeNull();
    expect(selectionIn(measured!, BUILD_3)).toBeNull();
    expect(selectionIn(hunk!, BUILD_4)).toBeNull();
  });
});

describe("evidenceTargetPath", () => {
  it("leads a test to the attempt that ran it, its suite selected", async () => {
    expect(
      await evidenceTargetPath(PR_514_ID, evidenceId(1), "dashboard", readers().readers),
    ).toBe(
      testsPath(SEEDED_RUN_ID, {
        from: "dashboard",
        attempt: 4,
        suite: "telemetry integration",
      }),
    );
  });

  it("leads a measurement to the attempt that recorded it, its case selected", async () => {
    expect(
      await evidenceTargetPath(PR_514_ID, evidenceId(3), "build-farm", readers().readers),
    ).toBe(
      testsPath(SEEDED_RUN_ID, {
        from: "build-farm",
        attempt: 4,
        case: "Motor overshoot on e-stop release",
      }),
    );
  });

  it("reads the newest attempt first, and an older one only when it must", async () => {
    const newest = readers();
    await evidenceTargetPath(PR_514_ID, evidenceId(1), undefined, newest.readers);

    expect(newest.readAttempt.mock.calls).toEqual([[ATTEMPT_4_ID]]);

    const older = readers(matrixPage(), { [ATTEMPT_3_ID]: BUILD_4, [ATTEMPT_4_ID]: BUILD_3 });

    expect(await evidenceTargetPath(PR_514_ID, evidenceId(1), undefined, older.readers)).toBe(
      testsPath(SEEDED_RUN_ID, { attempt: 3, suite: "telemetry integration" }),
    );
    expect(older.readAttempt.mock.calls).toEqual([[ATTEMPT_4_ID], [ATTEMPT_3_ID]]);
  });

  it("reads at most the bound's worth of attempts", async () => {
    const many = Array.from({ length: MAX_ATTEMPTS_READ + 5 }, (_, index) =>
      attempt(index + 1, { id: `5eed0031-0000-4000-8000-0000000000${String(index + 10)}` }),
    );
    const readAttempt = vi.fn(() => Promise.resolve(BUILD_3));

    expect(
      await evidenceTargetPath(PR_514_ID, evidenceId(1), undefined, {
        page: () => Promise.resolve(matrixPage()),
        timeline: () => Promise.resolve(timeline({ attempts: many })),
        attempt: readAttempt,
      }),
    ).toBeNull();
    expect(readAttempt).toHaveBeenCalledTimes(MAX_ATTEMPTS_READ);
  });

  it("leads nowhere when no attempt holds the row", async () => {
    const none = readers(matrixPage(), {});

    expect(await evidenceTargetPath(PR_514_ID, evidenceId(1), undefined, none.readers)).toBeNull();
  });

  it("leads nowhere for a citation the matrix does not hold, or one of another kind", async () => {
    const { readers: given, readAttempt } = readers();

    expect(await evidenceTargetPath(PR_514_ID, evidenceId(9), undefined, given)).toBeNull();
    expect(await evidenceTargetPath(PR_514_ID, evidenceId(2), undefined, given)).toBeNull();
    expect(await evidenceTargetPath(PR_514_ID, evidenceId(4), undefined, given)).toBeNull();
    expect(readAttempt).not.toHaveBeenCalled();
  });

  it("leads nowhere on a PR no loop opened", async () => {
    const { readers: given } = readers(matrixPage({ pullRequest: { run: null } }));

    expect(await evidenceTargetPath(PR_514_ID, evidenceId(1), undefined, given)).toBeNull();
  });

  it("reads nothing for an id that is not a uuid", async () => {
    const page = vi.fn();
    const given = { ...readers().readers, page };

    expect(await evidenceTargetPath("514", evidenceId(1), undefined, given)).toBeNull();
    expect(await evidenceTargetPath(PR_514_ID, "1", undefined, given)).toBeNull();
    expect(page).not.toHaveBeenCalled();
  });

  it("leads nowhere when the service refuses, and rethrows what is not its refusal", async () => {
    const refused = {
      ...readers().readers,
      page: () => Promise.reject(new ApiError(404, "pull_request_not_found", "No such PR.")),
    };
    const broken = { ...readers().readers, page: () => Promise.reject(new Error("bug")) };

    expect(await evidenceTargetPath(PR_514_ID, evidenceId(1), undefined, refused)).toBeNull();
    await expect(
      evidenceTargetPath(PR_514_ID, evidenceId(1), undefined, broken),
    ).rejects.toThrow("bug");
  });
});
