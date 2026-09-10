import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";

import {
  ESTIMATION_ERRORS,
  alreadyEstimating,
  backlogAlreadyEstimating,
  estimationRateLimited,
  issueNotFound,
} from "./estimation.errors";

/**
 * The codes, and the promise that the document is the registry — `tenancy.errors.spec.ts`'s
 * shape, for its reason: a code is only useful if it is stable and if a client can discover
 * what it means, and `openapi.yaml` is where the second half lives.
 *
 * The statuses get cases of their own because L.4's three refusals are three *different*
 * statuses on purpose, and picking the wrong one is the kind of mistake that reads fine and
 * makes a client branch wrongly for years.
 */

/** The module root, where the authoritative specification is committed. */
const MODULE_ROOT = join(__dirname, "..", "..", "..");

/** The authoritative specification, read once. */
const SPECIFICATION = readFileSync(join(MODULE_ROOT, "openapi.yaml"), "utf8");

describe("the codes", () => {
  it.each(Object.values(ESTIMATION_ERRORS))(
    "names %s as a stable, machine-readable code",
    (code) => {
      expect(code).toMatch(/^[a-z][a-z_]*[a-z]$/);
    },
  );

  it.each(Object.values(ESTIMATION_ERRORS))("documents %s in openapi.yaml", (code) => {
    expect(SPECIFICATION).toContain(code);
  });

  it("keeps the two conflicts apart, because they are about different things", () => {
    // One issue is busy; the whole backlog is busy. A client renders a pill for the first and
    // a dialog for the second, and one code would leave it unable to tell which it got.
    expect(ESTIMATION_ERRORS.alreadyEstimating).not.toBe(ESTIMATION_ERRORS.backlogEstimating);
  });
});

describe("an issue this workspace does not have", () => {
  it("is a 404, whether it is missing or somebody else's", () => {
    // The ticket's *cross-org id → 404*. A `403` would confirm that the id names a real issue
    // somewhere, which is the whole of what an enumerator is trying to learn.
    const error = issueNotFound("5eed0018-0000-4000-8000-000000000485");

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.envelope().code).toBe(ESTIMATION_ERRORS.issueNotFound);
  });

  it("echoes back only what the caller sent", () => {
    const error = issueNotFound("5eed0018-0000-4000-8000-000000000485");

    expect(error.envelope().details).toEqual({
      issueId: "5eed0018-0000-4000-8000-000000000485",
    });
    expect(error.envelope().message).not.toContain("5eed0018");
  });
});

describe("an issue already being estimated", () => {
  it("is a 409 carrying the status the diagram names", () => {
    // `409 {status: "estimating"}` is the ticket's own diagram, and the panel renders its pill
    // from that field rather than assuming what the refusal must have meant.
    const error = alreadyEstimating("estimating");

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.envelope().code).toBe(ESTIMATION_ERRORS.alreadyEstimating);
    expect(error.envelope().details).toEqual({ status: "estimating" });
  });

  it("says the work will finish, rather than that something went wrong", () => {
    expect(alreadyEstimating("estimating").envelope().message).toContain("will finish");
  });
});

describe("a backlog already being estimated", () => {
  it("is a 409 naming how many are in flight", () => {
    const error = backlogAlreadyEstimating(9);

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.envelope().code).toBe(ESTIMATION_ERRORS.backlogEstimating);
    expect(error.envelope().details).toEqual({ estimating: 9 });
  });
});

describe("a workspace asking too often", () => {
  it("is a 429, not a 409 — this one is about how often, and waiting fixes it", () => {
    // The deliberate contrast with M.4's re-sync guard (#113), which is a `409`: that one
    // protects a shared background loop the caller does not own and refuses somebody who has
    // clicked nothing. This one counts what *this workspace* asked for.
    const error = estimationRateLimited(24);

    expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(error.envelope().code).toBe(ESTIMATION_ERRORS.rateLimited);
  });

  it("carries the wait, in the envelope rather than a header", () => {
    // This service's contract is the envelope: a client that already branches on `details`
    // should not need a second reader for the one fact that makes a refusal actionable.
    expect(estimationRateLimited(24).envelope().details).toEqual({ retryAfterSeconds: 24 });
  });

  it("names nothing about the service's internals", () => {
    const message = estimationRateLimited(24).envelope().message;

    expect(message).not.toMatch(/github_|table|queue|engine/i);
  });
});
