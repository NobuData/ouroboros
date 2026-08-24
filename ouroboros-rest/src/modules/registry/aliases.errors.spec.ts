import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";
import {
  ALIAS_ERRORS,
  ALIAS_NAME_CONSTRAINT,
  aliasIdNotFound,
  aliasNameTaken,
  aliasReferenced,
  aliasRenameBlocked,
  aliasUnbound,
  copyNameTooLong,
  isAliasNameTaken,
  PROVIDERS_FIX_PATH,
  UNIQUE_VIOLATION,
  type ReferrerDetail,
} from "./aliases.errors";
import { REGISTRY_ERRORS } from "./registry.errors";

/**
 * The designed refusals, mostly about their messages and their `details` — a refusal that
 * does not say what is in the way is one the user can only be annoyed by, which is the
 * ticket's problem statement in one line.
 */
const ALIAS_ID = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

const ROUTE: ReferrerDetail = {
  kind: "route",
  refId: "5eed0012-0000-4000-8000-000000000007",
  label: "implement-primary",
  blocking: true,
};

const RULE: ReferrerDetail = {
  kind: "escalation",
  refId: "5eed0013-0000-4000-8000-000000000001",
  label: "escalation:effort≥L",
  blocking: true,
};

describe("aliasIdNotFound", () => {
  it("is a 404 under the code the resolution read already uses", () => {
    const error = aliasIdNotFound(ALIAS_ID);

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.getStatus()).toBe(404);
    expect(error.code).toBe(REGISTRY_ERRORS.aliasNotFound);
    expect(error.details).toEqual({ aliasId: ALIAS_ID });
  });
});

describe("aliasNameTaken", () => {
  it("is a 422 — the name is a field, and the fix is a different one", () => {
    const error = aliasNameTaken("coder-max");

    expect(error).toBeInstanceOf(InvalidRequestError);
    expect(error.getStatus()).toBe(422);
    expect(error.code).toBe(ALIAS_ERRORS.nameTaken);
    expect(error.details).toEqual({ alias: "coder-max" });
    expect(error.envelope().message).toContain("unique per workspace");
  });
});

describe("aliasReferenced", () => {
  it("is a 409 carrying every referrer with its kind", () => {
    const error = aliasReferenced("coder-max", [ROUTE, RULE]);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe(ALIAS_ERRORS.referenced);
    expect(error.details).toEqual({ alias: "coder-max", references: [ROUTE, RULE] });
  });

  it("counts by kind when the referrers are all one kind", () => {
    expect(
      aliasReferenced("coder-max", [ROUTE, { ...ROUTE, label: "plan-primary" }]).envelope().message,
    ).toContain("2 routes reference it");
    expect(aliasReferenced("second-opinion", [RULE]).envelope().message).toContain(
      "1 escalation rule references it",
    );
  });

  it("counts references when the kinds are mixed", () => {
    expect(aliasReferenced("coder-max", [ROUTE, RULE]).envelope().message).toContain(
      "2 references reference it",
    );
  });

  it("copies the list rather than lending the caller's array to the response", () => {
    const references = [ROUTE];
    const error = aliasReferenced("coder-max", references);

    references.push(RULE);

    expect((error.details as { references: unknown[] }).references).toHaveLength(1);
  });

  it("refuses to be built with nothing to name", () => {
    expect(() => aliasReferenced("coder-max", [])).toThrow(RangeError);
  });
});

describe("aliasRenameBlocked", () => {
  it("is a 422 with the same list, because the refused thing is a field", () => {
    const error = aliasRenameBlocked("coder-max", [ROUTE]);

    expect(error).toBeInstanceOf(InvalidRequestError);
    expect(error.getStatus()).toBe(422);
    expect(error.code).toBe(ALIAS_ERRORS.renameBlocked);
    expect(error.details).toEqual({ alias: "coder-max", references: [ROUTE] });
    expect(error.envelope().message).toContain("cannot be renamed");
  });

  it("refuses to be built with nothing to name", () => {
    expect(() => aliasRenameBlocked("coder-max", [])).toThrow(RangeError);
  });
});

describe("aliasUnbound", () => {
  it("is a 422 pointing at Providers & keys", () => {
    const error = aliasUnbound("gpt5-experiments");

    expect(error).toBeInstanceOf(InvalidRequestError);
    expect(error.code).toBe(ALIAS_ERRORS.unbound);
    expect(error.details).toEqual({ alias: "gpt5-experiments", fix: PROVIDERS_FIX_PATH });
    expect(error.envelope().message).toContain("Providers & keys");
  });

  it("points at the route Providers & keys is mounted on", () => {
    expect(PROVIDERS_FIX_PATH).toBe("/models/providers");
  });
});

describe("copyNameTooLong", () => {
  it("is a 422 naming the name that would not fit", () => {
    const error = copyNameTooLong("a".repeat(60), `${"a".repeat(60)}-copy`, 64);

    expect(error).toBeInstanceOf(InvalidRequestError);
    expect(error.code).toBe(ALIAS_ERRORS.copyNameTooLong);
    expect(error.details).toEqual({
      alias: "a".repeat(60),
      proposed: `${"a".repeat(60)}-copy`,
      maxLength: 64,
    });
  });
});

describe("isAliasNameTaken", () => {
  it("recognises the unique violation on V015's key, and only that", () => {
    expect(isAliasNameTaken({ code: UNIQUE_VIOLATION, constraint: ALIAS_NAME_CONSTRAINT })).toBe(
      true,
    );
    expect(isAliasNameTaken({ code: UNIQUE_VIOLATION, constraint: "something_else_key" })).toBe(
      false,
    );
    expect(isAliasNameTaken({ code: "23503", constraint: ALIAS_NAME_CONSTRAINT })).toBe(false);
  });

  it("answers false for anything that is not a driver error", () => {
    expect(isAliasNameTaken(null)).toBe(false);
    expect(isAliasNameTaken(new Error("boom"))).toBe(false);
    expect(isAliasNameTaken("23505")).toBe(false);
  });
});
