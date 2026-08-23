import { Logger, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { AppConfigService } from "../config/config.service";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import { INTERNAL_ERRORS } from "./internal.errors";
import { InternalKeyGuard, INTERNAL_KEY_HEADER_LOWERCASE } from "./internal.guard";

/**
 * The boundary, and the four properties `ouroboros-engine`'s own middleware is written for.
 *
 * This is that middleware in Nest's vocabulary — the same header, the same variable, the same
 * terse rejection — so it is asserted against the same claims:
 *
 *   * **A missing key and a wrong key are one answer.** Anything else is a way to learn
 *     whether a header name was right by reading a status code.
 *   * **Only `@InternalOnly()` routes are checked.** A guard that refused everything would be
 *     a global outage, and one that checked nothing would be worse.
 *   * **The refusal says nothing**, and carries no details.
 *   * **The log line names the path and never the value offered.**
 *
 * Constant-time comparison is the one claim a unit test cannot make honestly — timing an
 * `expect` proves nothing — so what stands in for it is the code: `timingSafeEqual` over
 * fixed-length digests, with no length branch in front of it. The assertion below that a
 * one-character key and a nearly-correct one are refused identically is the observable part.
 */

const SECRET = "dev-engine-shared-secret-change-me";

/**
 * What the guard wrote down, for the run of one test.
 *
 * Collected for every case rather than only for the block that asserts on it, because the
 * alternative is a suite that prints a warning per refusal — and a file whose subject is
 * refusals prints a lot of them.
 */
let warnings: string[] = [];

beforeEach(() => {
  warnings = [];
  jest.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => {
    warnings.push(String(message));
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** A guard over a configuration holding {@link SECRET}. */
function guard(): InternalKeyGuard {
  return new InternalKeyGuard(
    new Reflector(),
    new AppConfigService({ getOrThrow: () => SECRET, get: () => SECRET } as never),
  );
}

/** An execution context for a route, with whatever headers a caller sent. */
function contextFor(
  internal: boolean,
  headers: Record<string, unknown> = {},
  url = "/internal/credentials/lease",
): ExecutionContext {
  class Surface {
    handle(): void {}
  }

  if (internal) {
    Reflect.defineMetadata("ouroboros:internal:only", true, Surface);
  }

  return {
    getHandler: () => Surface.prototype.handle,
    getClass: () => Surface,
    switchToHttp: () => ({ getRequest: () => ({ headers, url, method: "POST" }) }),
  } as unknown as ExecutionContext;
}

describe("a route that is not internal", () => {
  it("is admitted without the header being looked at", () => {
    // The global guard runs on every request in the application. A browser route must be
    // untouched by it: its own guards are the session and the tenant, and adding a third
    // opinion here would be a way for this module to break routes it has nothing to do with.
    expect(guard().canActivate(contextFor(false))).toBe(true);
  });
});

describe("a caller holding the key", () => {
  it("is admitted", () => {
    expect(guard().canActivate(contextFor(true, { [INTERNAL_KEY_HEADER_LOWERCASE]: SECRET }))).toBe(
      true,
    );
  });

  it("is admitted whatever case the header name arrived in", () => {
    // Node lower-cases incoming header names, and the constant is written in the casing both
    // sides *send*. Folding it here rather than keeping a second constant is what stops the
    // two spellings from drifting apart.
    expect(INTERNAL_KEY_HEADER_LOWERCASE).toBe(INTERNAL_KEY_HEADER.toLowerCase());
  });
});

describe("a caller without it", () => {
  it.each([
    ["no header at all", {}],
    ["an empty header", { [INTERNAL_KEY_HEADER_LOWERCASE]: "" }],
    ["a wrong value", { [INTERNAL_KEY_HEADER_LOWERCASE]: "not-the-secret" }],
    ["a one-character value", { [INTERNAL_KEY_HEADER_LOWERCASE]: "d" }],
    ["a nearly-correct value", { [INTERNAL_KEY_HEADER_LOWERCASE]: `${SECRET}x` }],
    ["a prefix of the value", { [INTERNAL_KEY_HEADER_LOWERCASE]: SECRET.slice(0, -1) }],
    ["the header sent twice", { [INTERNAL_KEY_HEADER_LOWERCASE]: [SECRET, SECRET] }],
  ])("is refused with the same answer: %s", (_description, headers) => {
    // One answer for every way of not having the key, including a caller who sent it twice:
    // two keys is not one right one, and picking one of them would be choosing which of
    // somebody's guesses to grade.
    expect(() => guard().canActivate(contextFor(true, headers))).toThrow(
      expect.objectContaining({ code: INTERNAL_ERRORS.unauthenticated }) as Error,
    );
  });

  it("is refused with a 401 carrying no details", () => {
    try {
      guard().canActivate(contextFor(true));
      throw new Error("the guard was expected to refuse this request");
    } catch (error) {
      const refusal = error as { getStatus?: () => number; envelope?: () => unknown };

      expect(refusal.getStatus?.()).toBe(401);
      expect(refusal.envelope?.()).toMatchObject({ details: {} });
    }
  });

  it("is not a session's 401 — a worker cannot act on advice to sign in", () => {
    try {
      guard().canActivate(contextFor(true));
      throw new Error("the guard was expected to refuse this request");
    } catch (error) {
      expect((error as { envelope: () => { message: string } }).envelope().message).toBe(
        "Unauthorized.",
      );
    }
  });
});

describe("what a refusal is written down as", () => {
  it("names the path and the method an operator has to go and find", () => {
    expect(() => guard().canActivate(contextFor(true, {}, "/internal/llm/invoke"))).toThrow();

    expect(warnings[0]).toContain("/internal/llm/invoke");
    expect(warnings[0]).toContain("POST");
  });

  it("names the variable both sides read, because a mismatch is the usual cause", () => {
    expect(() =>
      guard().canActivate(contextFor(true, { [INTERNAL_KEY_HEADER_LOWERCASE]: "wrong" })),
    ).toThrow();

    expect(warnings[0]).toContain("OURO_ENGINE_SHARED_SECRET");
  });

  it("distinguishes a caller that sent nothing from one that sent the wrong thing", () => {
    // The two mistakes an operator makes, and they have different fixes: a worker that never
    // sends the header is misconfigured code, and two sides holding different values is a
    // deployment. Neither is diagnosable from the `401`, which says nothing on purpose.
    expect(() => guard().canActivate(contextFor(true))).toThrow();
    expect(() =>
      guard().canActivate(contextFor(true, { [INTERNAL_KEY_HEADER_LOWERCASE]: "wrong" })),
    ).toThrow();

    expect(warnings[0]).toContain("no");
    expect(warnings[1]).toContain("invalid");
  });

  it("never writes the value that was offered", () => {
    // Right or wrong, it is a credential — and a wrong one is frequently the *right* one for
    // some other environment, pasted into the wrong stack.
    expect(() =>
      guard().canActivate(contextFor(true, { [INTERNAL_KEY_HEADER_LOWERCASE]: "sk-live-oops" })),
    ).toThrow();

    expect(warnings[0]).not.toContain("sk-live-oops");
    expect(warnings[0]).not.toContain(SECRET);
  });
});
