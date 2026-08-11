import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";

import { ENGINE_ERRORS, ENGINE_UNAVAILABLE_MESSAGE, engineUnavailable } from "./engine.errors";

/**
 * The one code this gateway answers with, and the two promises made about it.
 *
 * The first is `auth.errors.spec.ts`'s: every code is in `openapi.yaml`, because the
 * document is the registry a client reads and a code that is not in it is a `switch` case
 * nobody knew to write. The second is this gateway's own — **the message says nothing about
 * the inside of the network**, which is a security property rather than a style rule and is
 * asserted as one.
 */

/** The module root, where the authoritative specification is committed. */
const MODULE_ROOT = join(__dirname, "..", "..", "..");

describe("the codes", () => {
  it.each(Object.entries(ENGINE_ERRORS))(
    "names %s as %s, lower-case and underscored",
    (_key, code) => {
      expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
    },
  );

  it.each(Object.values(ENGINE_ERRORS))("documents %s in openapi.yaml", (code) => {
    const specification = readFileSync(join(MODULE_ROOT, "openapi.yaml"), "utf8");

    expect(specification).toContain(code);
  });

  it("are all distinct", () => {
    const codes = Object.values(ENGINE_ERRORS);

    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("an engine that could not serve the request", () => {
  it("is a 502 carrying the envelope", () => {
    const error = engineUnavailable();

    expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(error.envelope()).toEqual({
      code: ENGINE_ERRORS.unavailable,
      message: ENGINE_UNAVAILABLE_MESSAGE,
      details: {},
    });
  });

  it("is not a 500, because nothing in this service is broken", () => {
    // The distinction a client acts on: a `502` says retrying is reasonable, and a `500`
    // says this service has a bug. An unreachable dependency is the first.
    expect(engineUnavailable().getStatus()).not.toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it("is not a 401, whatever the engine answered", () => {
    // The acceptance criterion. A shared-secret mismatch is this deployment's mistake, and
    // telling a browser to sign in again for it would be telling it about a boundary it
    // cannot reach at all.
    expect(engineUnavailable().getStatus()).not.toBe(HttpStatus.UNAUTHORIZED);
  });

  it("carries empty details, because everything specific is in the log", () => {
    expect(engineUnavailable().envelope().details).toEqual({});
  });

  it.each([
    ["a URL", /https?:\/\//],
    ["a host or a port", /:\d{2,5}\b/],
    ["an errno code", /E[A-Z]{4,}/],
    ["a status code", /\b[45]\d\d\b/],
  ])("names no %s", (_description, pattern) => {
    // `OURO_ENGINE_URL` is internal topology and the status the engine answered is a fact
    // about the inside of the network. A caller learns that the system cannot serve the
    // request, and nothing it could use to probe further.
    expect(ENGINE_UNAVAILABLE_MESSAGE).not.toMatch(pattern);
  });

  it("tells a person what to do rather than what went wrong", () => {
    expect(ENGINE_UNAVAILABLE_MESSAGE).toContain("Try again");
  });

  it("is a fresh error each time, so nothing accumulates on a shared instance", () => {
    expect(engineUnavailable()).not.toBe(engineUnavailable());
  });
});
