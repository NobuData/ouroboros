import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";

import { RUNS_ERRORS, runNotFound } from "./runs.errors";

/**
 * The one code, held to the two places it must agree with itself: the constant the answer
 * is built from, and the specification a client reads — `tenancy.errors.spec.ts`'s
 * contract, at this module's size.
 */

/** The authoritative specification, read once. */
const SPECIFICATION = readFileSync(join(__dirname, "..", "..", "..", "openapi.yaml"), "utf8");

describe("the codes", () => {
  it.each(Object.values(RUNS_ERRORS))("names %s machine-readably", (code) => {
    expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it.each(Object.values(RUNS_ERRORS))("documents %s in openapi.yaml", (code) => {
    // The document is the registry a client reads; a code it does not describe is an answer
    // nobody was told they could receive.
    expect(SPECIFICATION).toContain(code);
  });
});

describe("run_not_found", () => {
  it("is a 404 that echoes the id the caller sent, and nothing else", () => {
    const error = runNotFound("4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94");

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.envelope()).toEqual({
      code: "run_not_found",
      message: "No such run.",
      details: { runId: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94" },
    });
  });

  it("says the same thing for absent and for somebody else's, by having one message", () => {
    // The no-existence-leak criterion at the message level: nothing about the sentence
    // varies with why the run was not found.
    expect(runNotFound("a").envelope().message).toBe(runNotFound("b").envelope().message);
  });
});
