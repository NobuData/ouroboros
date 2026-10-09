import { HttpStatus } from "@nestjs/common";

import {
  COPILOT_ERRORS,
  answerInvalid,
  exchangeBusy,
  messageNotFound,
  sessionActive,
  sessionClosed,
  sessionNotFound,
} from "./copilot.errors";

describe("the copilot errors", () => {
  it("answers a missing session as a 404 naming the workflow", () => {
    const error = sessionNotFound("wf-1");
    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.code).toBe(COPILOT_ERRORS.sessionNotFound);
    expect(error.details).toEqual({ workflowId: "wf-1" });
  });

  it("answers an already-active session as a 409 the client can resume", () => {
    const error = sessionActive("s-1");
    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.details).toEqual({ sessionId: "s-1" });
  });

  it("answers a closed session and a busy one as 409s", () => {
    expect(sessionClosed("s-1", "promoted").message).toBe(
      "This copilot session was promoted and takes no new messages.",
    );
    expect(exchangeBusy("s-1").code).toBe(COPILOT_ERRORS.exchangeBusy);
    expect(exchangeBusy("s-1").getStatus()).toBe(HttpStatus.CONFLICT);
  });

  it("answers a missing message as a 404 and a bad answer as a 422", () => {
    expect(messageNotFound("m-1").getStatus()).toBe(HttpStatus.NOT_FOUND);
    const invalid = answerInvalid("That question was already answered.");
    expect(invalid.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(invalid.message).toBe("That question was already answered.");
  });

  it("documents every code once", () => {
    const codes = Object.values(COPILOT_ERRORS);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^copilot_[a-z_]+$/);
  });
});
