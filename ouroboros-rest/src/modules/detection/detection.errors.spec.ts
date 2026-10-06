/** The detection API's refusals ([#384](https://github.com/NobuData/ouroboros/issues/384)). */

import { HttpStatus } from "@nestjs/common";

import {
  DETECTION_ERRORS,
  globInvalid,
  rescanTooSoon,
  scanNotFound,
  sourceMissing,
} from "./detection.errors";

describe("the detection refusals", () => {
  it("say which repository nothing can probe, as a 409", () => {
    const error = sourceMissing("acme/helios");

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.getResponse()).toMatchObject({
      code: DETECTION_ERRORS.sourceMissing,
      details: { repo: "acme/helios" },
    });
  });

  it("say how long to wait before a re-scan, as a 409", () => {
    const error = rescanTooSoon(12);

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.getResponse()).toMatchObject({
      code: DETECTION_ERRORS.rescanTooSoon,
      details: { retryAfterSeconds: 12 },
    });
  });

  it("name the scan that does not exist, as a 404", () => {
    const error = scanNotFound("acme/helios", 3);

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.getResponse()).toMatchObject({
      code: DETECTION_ERRORS.scanNotFound,
      message: "acme/helios has no scan 3.",
      details: { repo: "acme/helios", scanSeq: 3 },
    });
  });

  it("name the one glob the guardrails cannot enforce, as a 422", () => {
    const error = globInvalid(["/etc/**"]);

    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(error.getResponse()).toMatchObject({
      code: DETECTION_ERRORS.globInvalid,
      message:
        '"/etc/**" is not a path pattern the guardrails can enforce — use a relative glob like boot/**.',
      details: { invalid: ["/etc/**"] },
    });
  });

  it("count several refused globs, and list every one", () => {
    const error = globInvalid(["/etc/**", "../x"]);

    expect((error.getResponse() as { message: string }).message).toMatch(/^2 patterns are not/);
    expect(error.getResponse()).toMatchObject({ details: { invalid: ["/etc/**", "../x"] } });
  });
});
