import { HttpStatus } from "@nestjs/common";

import {
  TICKET_SOURCE_ERROR_CLASSES,
  TicketSourceError,
} from "../ticket-sources/ticket-source.errors";
import { PUSH_DISABLED_REASONS } from "../ticket-sources/ticket-source.write";
import {
  BLOCKER_NOT_PUSHED,
  MAX_NAMED_BLOCKERS,
  PUSH_ERRORS,
  PUSH_STEP_PHRASES,
  asTrackerFailure,
  batchNotFound,
  blockerNotPushedError,
  dependencyCycle,
  draftPushError,
  nothingSelected,
  nothingToResume,
  notPushable,
  pushInProgress,
  targetReadOnly,
  type PushStep,
} from "./push.errors";

/**
 * The push's failure vocabulary (AL.3, [#279](https://github.com/NobuData/ouroboros/issues/279)):
 * every row a draft can record fits V034's `ticket_draft_push_error_valid`, carries no provider
 * detail, and every envelope answer has the status and code a route will publish.
 */

/** V034's rule, restated: the shape `push_error` accepts. */
function fitsPushErrorColumn(error: { code: string; message: string; detail?: unknown }): boolean {
  return (
    /^[a-z][a-z0-9_]*$/.test(error.code) &&
    error.code.length <= 64 &&
    error.message.trim() !== "" &&
    error.message.length <= 1024 &&
    (error.detail === undefined ||
      (typeof error.detail === "object" && error.detail !== null && !Array.isArray(error.detail)))
  );
}

describe("draftPushError", () => {
  const steps = Object.keys(PUSH_STEP_PHRASES) as PushStep[];

  it.each(
    TICKET_SOURCE_ERROR_CLASSES.flatMap((errorClass) => steps.map((step) => [errorClass, step])),
  )("records a %s failure at %s in a shape the column accepts", (errorClass, step) => {
    const error = new TicketSourceError(
      errorClass as TicketSourceError["errorClass"],
      "ghp_secretsecretsecretsecretsecretsecret echoed by a tracker",
      new Date("2026-09-16T14:20:00.000Z"),
      503,
    );
    const row = draftPushError(error, step as PushStep);

    expect(fitsPushErrorColumn(row)).toBe(true);
    expect(row.code).toBe(errorClass);
    expect(JSON.stringify(row)).not.toContain("ghp_");
  });

  it("carries the step, retryability, status and resume time a UI acts on", () => {
    expect(
      draftPushError(
        new TicketSourceError("rate_limit", "x", new Date("2026-09-16T14:20:00.000Z"), 403),
        "link",
      ),
    ).toStrictEqual({
      code: "rate_limit",
      message: "linking a dependency failed — rate limited until 14:20 UTC",
      detail: {
        step: "link",
        retryable: true,
        httpStatus: 403,
        retryAt: "2026-09-16T14:20:00.000Z",
      },
    });
    expect(draftPushError(new TicketSourceError("auth", "x"), "credentials")).toStrictEqual({
      code: "auth",
      message: "opening the source's credential failed — credentials rejected",
      detail: { step: "credentials", retryable: false },
    });
  });
});

describe("blockerNotPushedError", () => {
  it("names one blocker in the singular", () => {
    expect(blockerNotPushedError(["OTA-1"])).toStrictEqual({
      code: BLOCKER_NOT_PUSHED,
      message: "waiting on OTA-1, which has not been pushed",
      detail: { blockers: ["OTA-1"] },
    });
  });

  it("names a handful and counts the rest, staying inside the column's bound", () => {
    const keys = Array.from(
      { length: 40 },
      (_unused, index) => `K${"x".repeat(60)}${String(index)}`,
    );
    const row = blockerNotPushedError(keys);

    expect(row.message).toContain(`and ${String(40 - MAX_NAMED_BLOCKERS)} more, which have`);
    expect(fitsPushErrorColumn(row)).toBe(true);
    expect(row.detail).toStrictEqual({ blockers: keys });
  });
});

describe("asTrackerFailure", () => {
  it("passes a classified failure through and reads anything else as upstream", () => {
    const refused = new TicketSourceError("permission", "no scope");

    expect(asTrackerFailure(refused)).toBe(refused);
    expect(asTrackerFailure(new TypeError("undefined is not a function"))).toMatchObject({
      errorClass: "upstream",
    });
  });
});

describe("the envelope answers", () => {
  it.each([
    [batchNotFound("b"), HttpStatus.NOT_FOUND, PUSH_ERRORS.batchNotFound],
    [pushInProgress("b"), HttpStatus.CONFLICT, PUSH_ERRORS.inProgress],
    [notPushable("b", "pushed"), HttpStatus.CONFLICT, PUSH_ERRORS.notPushable],
    [nothingSelected("b"), HttpStatus.CONFLICT, PUSH_ERRORS.nothingSelected],
    [nothingToResume("b"), HttpStatus.CONFLICT, PUSH_ERRORS.nothingToResume],
    [targetReadOnly("b"), HttpStatus.CONFLICT, PUSH_ERRORS.readOnly],
    [dependencyCycle("b", ["A", "B", "A"]), HttpStatus.UNPROCESSABLE_ENTITY, PUSH_ERRORS.cycle],
  ])("answers %#: its status and code", (error, status, code) => {
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code, details: { batchId: "b" } });
  });

  it("says why a batch is not pushable, and reuses the catalog's read-only sentence", () => {
    expect(notPushable("b", "pushed").message).toBe(
      "Every ticket in this batch has already been pushed.",
    );
    expect(targetReadOnly("b").message).toBe(PUSH_DISABLED_REASONS.readOnly);
    expect(dependencyCycle("b", ["OTA-1", "OTA-3", "OTA-1"]).getResponse()).toMatchObject({
      message:
        "This batch's dependencies form a cycle (OTA-1 → OTA-3 → OTA-1), so no ticket of it can go first.",
      details: { cycle: ["OTA-1", "OTA-3", "OTA-1"] },
    });
  });
});
