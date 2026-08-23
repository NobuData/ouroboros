import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";

import { PRICING_ERRORS, overrideNotFound } from "./pricing.errors";

/**
 * The codes, and the promise that the document is the registry.
 *
 * The same pair of checks `tenancy.errors.spec.ts` makes, for the same reason: a code is only
 * useful if it is stable and if a client can discover what it means. `openapi.yaml` is where
 * they discover it, and this is what makes *documented* something CI checks rather than
 * something a reviewer notices.
 *
 * There is a second thing worth asserting here, and it is about restraint. This module defines
 * exactly one code, because everything else it can refuse already has a word somewhere else —
 * a session in no workspace is `organization_required`, a role too low is `forbidden`, a body
 * that breaks V012's amount rules is `validation_failed`. A second vocabulary for any of those
 * would be drift dressed as precision.
 */

/** The module root, where the authoritative specification is committed. */
const MODULE_ROOT = join(__dirname, "..", "..", "..");

/** The authoritative specification, read once. */
const SPECIFICATION = readFileSync(join(MODULE_ROOT, "openapi.yaml"), "utf8");

describe("the codes", () => {
  it.each(Object.entries(PRICING_ERRORS))(
    "names %s as a stable, machine-readable %s",
    (_key, code) => {
      // Lower-case and underscore-separated, because it is compared as a literal in a client's
      // `switch` and read out loud in a bug report.
      expect(code).toMatch(/^[a-z][a-z_]*[a-z]$/);
    },
  );

  it.each(Object.values(PRICING_ERRORS))("documents %s in openapi.yaml", (code) => {
    expect(SPECIFICATION).toContain(code);
  });

  it("defines exactly one, and borrows the rest", () => {
    // Restraint, asserted. A code added here should have to justify itself against the four
    // this module deliberately does not define.
    expect(Object.keys(PRICING_ERRORS)).toHaveLength(1);
  });

  it.each([["organization_required"], ["forbidden"], ["validation_failed"], ["tenant_not_found"]])(
    "does not redefine %s",
    (code) => {
      expect(Object.values(PRICING_ERRORS)).not.toContain(code);
    },
  );
});

describe("the missing override", () => {
  it("answers 404", () => {
    expect(overrideNotFound("anthropic", "claude-fable-5").getStatus()).toBe(HttpStatus.NOT_FOUND);
  });

  it("echoes the pair that was addressed, folded as it was looked up", () => {
    // The caller sent both values, so returning them leaks nothing — and a client that spelled
    // the kind differently needs to see which spelling was searched for.
    expect(overrideNotFound("anthropic", "claude-fable-5").envelope()).toEqual({
      code: PRICING_ERRORS.overrideNotFound,
      message: "This workspace has no price override for that model.",
      details: { connectionKind: "anthropic", modelId: "claude-fable-5" },
    });
  });

  it("says nothing about whether the catalog prices the model", () => {
    // A `404` here means only that *this workspace* never overrode it. The bundled row, if
    // there is one, is not this operation's to remove.
    const { message } = overrideNotFound("anthropic", "claude-fable-5").envelope();

    expect(message).not.toContain("catalog");
    expect(message).toContain("This workspace");
  });
});
