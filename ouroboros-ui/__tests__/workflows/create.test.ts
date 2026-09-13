import { describe, expect, it } from "vitest";

import {
  CREATE_FAILED,
  CREATE_INVALID,
  CREATE_READ_ONLY,
  MAX_NAME_LENGTH,
  MAX_SLUG_LENGTH,
  NAME_LONG,
  NEEDS_NAME,
  NEEDS_SLUG,
  NOTHING_CREATED,
  SLUG_SHAPE,
  SLUG_TAKEN,
  createBody,
  createFailure,
  deriveSlug,
  nameError,
  nameProblem,
  slugError,
  slugProblem,
  submitReason,
} from "@/app/workflows/create";

import { seededRail } from "../helpers/workflows";

/**
 * The **+ New workflow** dialog's decisions (#147): how a slug follows a name, what is wrong
 * with either as it is typed, what is sent, and what a refusal says.
 */

/** Every slug the seeded workspace has. */
const TAKEN = seededRail().map((entry) => entry.slug);

describe("deriving a slug from a name", () => {
  it("lower-cases and collapses every run of characters the format does not admit", () => {
    // The service's own rule, restated so the slug box can follow the name box.
    expect(deriveSlug("Standard Fix")).toBe("standard-fix");
    expect(deriveSlug("  Hotfix!!  P0 ")).toBe("hotfix-p0");
    expect(deriveSlug("Deps refresh (weekly)")).toBe("deps-refresh-weekly");
    expect(deriveSlug("Déjà vu")).toBe("d-j-vu");
  });

  it("yields nothing for a name holding no ASCII letter or digit", () => {
    // The service's `workflow_slug_required`, met before the request is made.
    expect(deriveSlug("—")).toBe("");
    expect(deriveSlug("   ")).toBe("");
    expect(deriveSlug("")).toBe("");
  });

  it("is a fixed point on a slug that is already well-formed", () => {
    for (const slug of TAKEN) expect(deriveSlug(slug)).toBe(slug);
  });
});

describe("the name, as it is typed", () => {
  it("is empty until something has been typed", () => {
    expect(nameProblem("")).toBe("empty");
    expect(nameProblem("   ")).toBe("empty");
  });

  it("is refused past the column's ceiling, and accepted at it", () => {
    expect(nameProblem("x".repeat(MAX_NAME_LENGTH))).toBeNull();
    expect(nameProblem("x".repeat(MAX_NAME_LENGTH + 1))).toBe("long");
  });

  it("says nothing for an empty box, and the ceiling for a long one", () => {
    expect(nameError("empty")).toBeUndefined();
    expect(nameError(null)).toBeUndefined();
    expect(nameError("long")).toBe(NAME_LONG);
  });
});

describe("the slug, as it is typed", () => {
  it("is empty until something has been typed", () => {
    expect(slugProblem("", TAKEN)).toBe("empty");
  });

  it("refuses a shape that is not lower-case kebab", () => {
    for (const bad of ["Standard Fix", "-standard", "standard-", "a--b", "Fix", "a_b"]) {
      expect(slugProblem(bad, TAKEN), bad).toBe("shape");
    }
  });

  it("refuses a slug past the column's ceiling, and accepts one at it", () => {
    expect(slugProblem("a".repeat(MAX_SLUG_LENGTH), TAKEN)).toBeNull();
    expect(slugProblem("a".repeat(MAX_SLUG_LENGTH + 1), TAKEN)).toBe("shape");
  });

  it("catches a slug the rail already holds, with no round trip", () => {
    expect(slugProblem("standard-fix", TAKEN)).toBe("taken");
    expect(slugProblem(" hotfix-p0 ", TAKEN)).toBe("taken");
  });

  it("judges shape before uniqueness, because a malformed slug is not taken by anybody", () => {
    expect(slugProblem("Standard-Fix", TAKEN)).toBe("shape");
  });

  it("accepts a free, well-formed slug", () => {
    expect(slugProblem("hotfix-p1", TAKEN)).toBeNull();
  });

  it("has a sentence for each refusal and none for the two silent states", () => {
    expect(slugError("empty")).toBeUndefined();
    expect(slugError(null)).toBeUndefined();
    expect(slugError("shape")).toBe(SLUG_SHAPE);
    expect(slugError("taken")).toBe(SLUG_TAKEN);
  });
});

describe("what gets sent", () => {
  it("is the name and the slug, trimmed, and nothing else", () => {
    // The slug is always sent: the reader was shown it, and a body that left it out would let
    // the service derive a different one. No definition — the blank canvas is the contract's.
    expect(createBody({ name: "  Hotfix P1 ", slug: " hotfix-p1 " })).toEqual({
      name: "Hotfix P1",
      slug: "hotfix-p1",
    });
  });
});

describe("why the submit is inert", () => {
  it("asks for the name first, then the slug, then nothing", () => {
    expect(submitReason("empty", "empty")).toBe(NEEDS_NAME);
    expect(submitReason("long", null)).toBe(NEEDS_NAME);
    expect(submitReason(null, "taken")).toBe(NEEDS_SLUG);
    expect(submitReason(null, "shape")).toBe(NEEDS_SLUG);
    expect(submitReason(null, null)).toBeUndefined();
  });
});

describe("what a refusal says", () => {
  it("puts a taken slug under the slug box, and says nothing was created", () => {
    const failure = createFailure({
      code: "workflow_slug_taken",
      message: "taken",
      details: { slug: "standard-fix" },
    });

    expect(failure.slug).toBe(SLUG_TAKEN);
    expect(failure.message).toBe(`${SLUG_TAKEN} ${NOTHING_CREATED}`);
    expect(failure.name).toBeUndefined();
  });

  it("puts a slug the service could not derive under the slug box", () => {
    const failure = createFailure({ code: "workflow_slug_required", message: "no", details: {} });

    expect(failure.slug).toBe(SLUG_SHAPE);
    expect(failure.message).toContain(NOTHING_CREATED);
  });

  it("puts each field's own sentences under its box for a shape refusal", () => {
    const failure = createFailure({
      code: "validation_failed",
      message: "invalid",
      details: { name: ["name must not be blank"], slug: "slug must be lower-case kebab" },
    });

    expect(failure.message).toBe(CREATE_INVALID);
    expect(failure.name).toBe("name must not be blank");
    expect(failure.slug).toBe("slug must be lower-case kebab");
  });

  it("marks no field for a shape refusal that named none", () => {
    const failure = createFailure({ code: "validation_failed", message: "invalid", details: {} });

    expect(failure.name).toBeUndefined();
    expect(failure.slug).toBeUndefined();
  });

  it("says a member's refusal in words, with nothing in the form to correct", () => {
    expect(createFailure({ code: "forbidden", message: "no", details: {} })).toEqual({
      message: CREATE_READ_ONLY,
    });
  });

  it("keeps the service's own sentence for a code it has none for, after the product's", () => {
    const failure = createFailure({
      code: "internal_error",
      message: "The service failed.",
      details: {},
    });

    expect(failure.message).toBe(`${CREATE_FAILED} The service failed.`);
    expect(failure.message).toContain(NOTHING_CREATED);
  });
});
