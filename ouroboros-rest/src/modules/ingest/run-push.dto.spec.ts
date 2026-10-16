import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { ReportPushResultDto, RequestPushDto } from "./run-push.dto";

/** The push contract's request shapes (DI.2, #1310). */

const SHA = "b".repeat(40);

/** The properties a body is refused on. */
function refusedOn<T extends object>(cls: new () => T, body: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((error) => error.property);
}

describe("a push request", () => {
  const ASK = {
    idempotency_key: "push-1",
    epoch: 1,
    branch: "ouro/run-1-1",
    head_sha: SHA,
    change_set_seq: 1,
  };

  it("accepts the documented body, with and without force named", () => {
    expect(refusedOn(RequestPushDto, ASK)).toEqual([]);
    expect(refusedOn(RequestPushDto, { ...ASK, force: false })).toEqual([]);
    // Force is accepted on the wire so the service can refuse it by name.
    expect(refusedOn(RequestPushDto, { ...ASK, force: true })).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["a short head sha", { head_sha: "abc123" }, "head_sha"],
    ["no change-set", { change_set_seq: 0 }, "change_set_seq"],
    ["an empty branch", { branch: "" }, "branch"],
    ["a padded key", { idempotency_key: " k" }, "idempotency_key"],
    ["a force that is not a boolean", { force: "yes" }, "force"],
  ])("refuses %s", (_name, override, property) => {
    expect(refusedOn(RequestPushDto, { ...ASK, ...override })).toContain(property);
  });

  it("has no refspec field: the control plane builds it", () => {
    expect(
      refusedOn(RequestPushDto, { ...ASK, refspec: "+refs/heads/main:refs/heads/main" }),
    ).toContain("refspec");
  });
});

describe("a push result", () => {
  it("needs the pushed commit when the push landed", () => {
    expect(
      refusedOn(ReportPushResultDto, {
        idempotency_key: "r",
        branch: "ouro/run-1-1",
        outcome: "pushed",
        pushed_sha: SHA,
      }),
    ).toEqual([]);
    expect(
      refusedOn(ReportPushResultDto, {
        idempotency_key: "r",
        branch: "ouro/run-1-1",
        outcome: "pushed",
      }),
    ).toContain("pushed_sha");
  });

  it("needs the host's reason when the push failed", () => {
    expect(
      refusedOn(ReportPushResultDto, {
        idempotency_key: "r",
        branch: "ouro/run-1-1",
        outcome: "failed",
        reason: "protected branch hook declined",
      }),
    ).toEqual([]);
    expect(
      refusedOn(ReportPushResultDto, {
        idempotency_key: "r",
        branch: "ouro/run-1-1",
        outcome: "failed",
      }),
    ).toContain("reason");
  });

  it("refuses an outcome outside pushed and failed", () => {
    expect(
      refusedOn(ReportPushResultDto, { idempotency_key: "r", branch: "b", outcome: "forced" }),
    ).toContain("outcome");
  });
});
