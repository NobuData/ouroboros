import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";

import { AUTH_ERRORS } from "../auth/auth.errors";
import {
  INTERNAL_ERRORS,
  UNAUTHORIZED_MESSAGE,
  internalUnauthenticated,
  invocationNotImplemented,
  localProviderNotConfigured,
  providerNotLeasable,
  runNotFound,
} from "./internal.errors";

/**
 * The codes, the statuses, and the promise that the internal document is their registry.
 *
 * The same pair of checks `pricing.errors.spec.ts` makes, pointed at `openapi.internal.yaml`
 * instead: a code is only useful if it is stable and if a caller can discover what it means,
 * and this is what makes *documented* something CI checks.
 *
 * The status assertions are the interesting half here, because the two `404`s and the `403`
 * are the policy. A `403` that became a `404` would tell a worker that a cloud provider
 * *might* exist under a different configuration, and a `404` that became a `403` would tell
 * an operator to go looking for a permission that does not exist.
 */

/** The module root, where the internal specification is committed. */
const MODULE_ROOT = join(__dirname, "..", "..", "..");

/** The authoritative internal specification, read once. */
const SPECIFICATION = readFileSync(join(MODULE_ROOT, "openapi.internal.yaml"), "utf8");

describe("the codes", () => {
  it.each(Object.entries(INTERNAL_ERRORS))(
    "names %s as a stable, machine-readable %s",
    (_key, code) => {
      expect(code).toMatch(/^[a-z][a-z_]*[a-z]$/);
    },
  );

  it.each(Object.values(INTERNAL_ERRORS))("documents %s in openapi.internal.yaml", (code) => {
    expect(SPECIFICATION).toContain(code);
  });

  it("borrows the browser boundary's word for a rejected caller", () => {
    // One vocabulary for *you are not who you would have to be*, so a client's
    // `switch (error.code)` does not have to learn a second word for the same thing. What
    // differs is the message, because "sign in to continue" is advice a worker cannot take.
    expect(INTERNAL_ERRORS.unauthenticated).toBe(AUTH_ERRORS.unauthenticated);
    expect(internalUnauthenticated().envelope().message).not.toBe("Sign in to continue.");
  });
});

describe("the rejection at the boundary", () => {
  it("answers 401", () => {
    expect(internalUnauthenticated().getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it("says one constant sentence and nothing else", () => {
    // Written the way `ouroboros_engine.core.security` writes its own: no path, no header
    // name, no hint about what the key should look like. What an operator needs is in the
    // guard's log line, which stays inside the cluster.
    const envelope = internalUnauthenticated().envelope();

    expect(envelope.message).toBe(UNAUTHORIZED_MESSAGE);
    expect(envelope.details).toEqual({});
    expect(envelope.message).not.toMatch(/key|header|secret|internal/i);
  });
});

describe("the policy refusal", () => {
  it("answers 403 — the caller is authenticated and may not have this", () => {
    expect(providerNotLeasable("anthropic").getStatus()).toBe(HttpStatus.FORBIDDEN);
  });

  it("names the provider that was refused, and points at the proxy", () => {
    const envelope = providerNotLeasable("copilot").envelope();

    expect(envelope.details).toEqual({ provider: "copilot" });
    expect(envelope.message).toContain("/internal/llm/invoke");
  });
});

describe("the two absences", () => {
  it("answers 404 for a provider this deployment has not declared, naming the variable", () => {
    // A `404` rather than a `403`, and the difference is what an operator does next: this
    // one is fixed by configuration, and the message says which.
    const error = localProviderNotConfigured("ollama");

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.envelope().message).toContain("OURO_LOCAL_PROVIDER_URLS");
    expect(error.envelope().details).toEqual({ provider: "ollama" });
  });

  it("answers 404 for a run that does not exist", () => {
    const error = runNotFound("4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94");

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.envelope().details).toEqual({ run: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94" });
  });
});

describe("the proxy that is not built yet", () => {
  it("answers 501, not 404", () => {
    // The distinction the route exists for: `404` is what a caller with the wrong path gets,
    // and an executor being written against this contract has to be able to rule that out.
    expect(invocationNotImplemented().getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
  });

  it("names the issue that makes it answer", () => {
    // A pointer rather than a dead end: whoever calls this needs to know where the other
    // half is, and a `501` with a generic message would send them to read the router.
    expect(invocationNotImplemented().envelope().message).toContain("#235");
  });

  it("keeps its message, unlike every other 5xx", () => {
    // `error.filter.ts` replaces the message of any 5xx that is not a `DomainError` with
    // INTERNAL_ERROR_MESSAGE, because a status somebody chose and a message somebody wrote
    // for a client are different things. This one is a `DomainError`, so the sentence above
    // is what a caller actually reads — which is the whole reason `NotImplementedError`
    // exists as a subclass.
    expect(invocationNotImplemented().envelope().message).not.toContain("has been logged");
  });
});
