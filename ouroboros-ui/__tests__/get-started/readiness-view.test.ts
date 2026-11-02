import { describe, expect, it } from "vitest";

import {
  READINESS_ENDPOINT,
  dryRunHolds,
  estimateLine,
  executionDisabled,
  firstBlockingReason,
  headLine,
  isLoopReadiness,
  passedLine,
  readinessEndpoint,
  readinessGroups,
} from "@/app/get-started/readiness-view";

import { DEPLOYMENT_OFF, NO_RUNNER, PUSH_UNCONFIRMED, READINESS_REPO, readiness } from "../helpers/readiness";

/** Step 4's readiness card, as words and groups (DK.2, #1319). */

describe("readinessEndpoint", () => {
  it("names the repository and the workflow, and the issue only when there is one", () => {
    expect(readinessEndpoint(READINESS_REPO, "quick-fixes", null)).toBe(
      `${READINESS_ENDPOINT}?repository=acme-robotics%2Fhelios-firmware&workflow=quick-fixes`,
    );
    expect(readinessEndpoint(READINESS_REPO, "quick-fixes", 488)).toBe(
      `${READINESS_ENDPOINT}?repository=acme-robotics%2Fhelios-firmware&workflow=quick-fixes&issue=488`,
    );
  });
});

describe("the groups", () => {
  it("collapses the passes and keeps the rest expanded, each in REST's order", () => {
    const groups = readinessGroups(readiness(PUSH_UNCONFIRMED, NO_RUNNER));

    expect(groups.passed).toHaveLength(10);
    expect(groups.blocking.map((check) => check.id)).toEqual(["runner", "push_credential"]);
  });

  it("captions the action with the first check that did not pass, and nothing once every one did", () => {
    expect(firstBlockingReason(readiness(PUSH_UNCONFIRMED, NO_RUNNER))).toBe(NO_RUNNER.reason);
    expect(firstBlockingReason(readiness())).toBeNull();
  });

  it("knows the execution-disabled design by the deployment check's code", () => {
    expect(executionDisabled(readiness(DEPLOYMENT_OFF))).toBe(true);
    expect(executionDisabled(readiness(NO_RUNNER))).toBe(false);
  });

  it("says the dry-run line only while dry-run holds", () => {
    expect(dryRunHolds(readiness())).toBe(true);
    expect(
      dryRunHolds(
        readiness({ id: "dry_run", state: "fail", code: "policy_not_dry_run", reason: "Not in dry-run.", fix: null }),
      ),
    ).toBe(false);
  });
});

describe("the words", () => {
  it("counts the passes in the singular and the plural", () => {
    expect(passedLine(5)).toBe("✓ 5 checks passed");
    expect(passedLine(1)).toBe("✓ 1 check passed");
  });

  it("heads the card with the repository, the issue and its size", () => {
    expect(headLine(readiness())).toBe(
      "acme-robotics/helios-firmware · #488 Typo sweep in operator manual + pairing guide · size S",
    );
    expect(headLine({ ...readiness(), estimate: { isEstimate: true, costCapCentsPerRun: null, issue: null } })).toBe(
      READINESS_REPO,
    );
  });

  it("labels only what the deployment knows in the estimate", () => {
    expect(estimateLine(readiness().estimate)).toBe("cap $2.00 per run · issue sized S (heuristic-v0)");
    expect(estimateLine({ isEstimate: true, costCapCentsPerRun: null, issue: null })).toBeNull();
    expect(
      estimateLine({
        isEstimate: true,
        costCapCentsPerRun: null,
        issue: { number: 1, title: "x", size: null, sizedBy: null },
      }),
    ).toBeNull();
  });
});

describe("isLoopReadiness", () => {
  it("accepts the preflight and refuses what is not", () => {
    expect(isLoopReadiness(readiness())).toBe(true);
    expect(isLoopReadiness(null)).toBe(false);
    expect(isLoopReadiness({ ...readiness(), checks: [{ id: "runner", state: "maybe", reason: "x", fix: null }] })).toBe(
      false,
    );
    expect(isLoopReadiness({ ...readiness(), ready: "yes" })).toBe(false);
  });
});
