import { plainToInstance, type ClassConstructor } from "class-transformer";
import { validate, type ValidationError } from "class-validator";

import {
  AckControlDto,
  ControlAckParams,
  MAX_ACK_DETAIL_LENGTH,
  MAX_STEER_LENGTH,
  RunControlsParams,
  SubmitControlDto,
} from "./controls.dto";

/**
 * The request shapes (#306), validated the way the global pipe validates them, with
 * `whitelist` and `forbidNonWhitelisted` on so a field nobody declared is a `422`.
 */

/** Validate as the global pipe does, returning the failing property names. */
async function violations(
  type: ClassConstructor<object>,
  body: Record<string, unknown>,
): Promise<string[]> {
  const failures = await validate(plainToInstance(type, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return failures.map((failure: ValidationError) => failure.property);
}

const RUN = "5eed0009-0000-4000-8000-000000000482";
const CONTROL = "c0000000-0000-4000-8000-000000000001";

describe("the paths", () => {
  it("take uuids", async () => {
    expect(await violations(RunControlsParams, { id: RUN })).toEqual([]);
    expect(await violations(ControlAckParams, { id: RUN, controlId: CONTROL })).toEqual([]);
  });

  it("refuse anything else", async () => {
    expect(await violations(RunControlsParams, { id: "482" })).toEqual(["id"]);
    expect(await violations(ControlAckParams, { id: RUN, controlId: "x" })).toEqual(["controlId"]);
  });
});

describe("a submission", () => {
  it.each([
    ["a pause", { kind: "pause" }],
    ["an abort with its confirmation", { kind: "abort", confirmation: "1847" }],
    ["a steer", { kind: "steer", payload: "prefer a fix inside the ISR" }],
    ["a remembered steer", { kind: "steer", payload: "always use k_msgq", remember: true }],
    ["a keyed resume", { kind: "resume", idempotencyKey: "resume-482-1" }],
  ])("accepts %s", async (_description, body) => {
    expect(await violations(SubmitControlDto, body)).toEqual([]);
  });

  it.each([
    ["an unknown kind", { kind: "nudge" }, "kind"],
    ["no kind", {}, "kind"],
    [
      "a steer longer than the column",
      { kind: "steer", payload: "x".repeat(MAX_STEER_LENGTH + 1) },
      "payload",
    ],
    ["a flag that is not a boolean", { kind: "steer", payload: "x", remember: "yes" }, "remember"],
    ["a padded key", { kind: "pause", idempotencyKey: " k " }, "idempotencyKey"],
    ["an empty key", { kind: "pause", idempotencyKey: "" }, "idempotencyKey"],
    ["a key past 128", { kind: "pause", idempotencyKey: "k".repeat(129) }, "idempotencyKey"],
    ["a confirmation that is a number", { kind: "abort", confirmation: 1847 }, "confirmation"],
    ["a field nobody declared", { kind: "pause", requestedBy: "somebody-else" }, "requestedBy"],
  ])("refuses %s", async (_description, body, field) => {
    expect(await violations(SubmitControlDto, body)).toEqual([field]);
  });
});

describe("an acknowledgment", () => {
  it.each([
    ["nothing at all", {}],
    ["an effect", { effect: "paused at the top of the loop" }],
    ["an attempt", { attempt: 2 }],
    ["a multi-line effect", { effect: "paused\nbetween tool calls" }],
  ])("accepts %s", async (_description, body) => {
    expect(await violations(AckControlDto, body)).toEqual([]);
  });

  it.each([
    ["a padded effect", { effect: " paused " }, "effect"],
    ["an effect past the column", { effect: "x".repeat(MAX_ACK_DETAIL_LENGTH + 1) }, "effect"],
    ["attempt zero", { attempt: 0 }, "attempt"],
    ["a fractional attempt", { attempt: 1.5 }, "attempt"],
    ["a state the executor may not choose", { state: "rejected" }, "state"],
  ])("refuses %s", async (_description, body, field) => {
    expect(await violations(AckControlDto, body)).toEqual([field]);
  });
});
