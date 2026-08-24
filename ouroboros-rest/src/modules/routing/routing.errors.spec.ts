import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";

import {
  CHECK_VIOLATION,
  ROUTING_ERRORS,
  RULE_SORT_ORDER_CONSTRAINT,
  RULE_TARGETS_CONSTRAINT,
  UNIQUE_VIOLATION,
  escalationRuleInvalid,
  escalationRuleNotFound,
  escalationRuleSortOrderTaken,
  isRuleSortOrderTaken,
  isRuleTargetMissing,
  routeNotFound,
  routeSaveInvalid,
} from "./routing.errors";

/**
 * The codes, and the promise that the document is the registry.
 *
 * The same pair of checks `pricing.errors.spec.ts` makes, for the same reason: a code is only
 * useful if it is stable and if a client can discover what it means, and `openapi.yaml` is
 * where they discover it.
 *
 * **`route_not_found` is the one exception, and it is a deliberate one.** Z.1 published no
 * endpoint, so the code exists ahead of anything that answers with it; the route that will is
 * Z.4's `/routing/simulate` ([#197](https://github.com/NobuData/ouroboros/issues/197)), and
 * that ticket documents it. Z.2's four are answered by routes this ticket ships, so they are
 * held to the document like every other module's.
 *
 * The restraint test is still the interesting one. Almost everything that can go wrong with a
 * *resolution* is an answer — `fail_run` with an explanation — and turning any of it into an
 * error would throw away the explanations Z.1 is mostly about. What Z.2 added are refusals of
 * a **write**, which is a different question: *the floor you set is deeper than the chain you
 * sent* has no reading under which the save happened.
 */

/** The module root, where the authoritative specification is committed. */
const MODULE_ROOT = join(__dirname, "..", "..", "..");

/** The authoritative specification, read once. */
const SPECIFICATION = readFileSync(join(MODULE_ROOT, "openapi.yaml"), "utf8");

/** The code Z.1 defined ahead of the endpoint that will answer with it. */
const UNPUBLISHED = ROUTING_ERRORS.routeNotFound;

describe("the codes", () => {
  it.each(Object.entries(ROUTING_ERRORS))(
    "names %s as a stable, machine-readable %s",
    (_key, code) => {
      expect(code).toMatch(/^[a-z][a-z_]*[a-z]$/);
    },
  );

  it.each(Object.values(ROUTING_ERRORS).filter((code) => code !== UNPUBLISHED))(
    "documents %s in openapi.yaml",
    (code) => {
      expect(SPECIFICATION).toContain(code);
    },
  );

  it("defines five, and every one of them is a refusal rather than an answer", () => {
    // A code added here should have to justify itself against `fail_run`. Every provider down,
    // the floor breached at resolution time, a chain filtered to nothing — those are
    // resolutions carrying a reason, not errors, and a client that received a 500 for one of
    // them would have lost the sentence that told an operator what to change.
    expect(Object.keys(ROUTING_ERRORS)).toEqual([
      "routeNotFound",
      "routeSaveInvalid",
      "escalationRuleInvalid",
      "escalationRuleNotFound",
      "escalationRuleSortOrderTaken",
    ]);
  });

  it.each([["organization_required"], ["forbidden"], ["validation_failed"], ["tenant_not_found"]])(
    "does not redefine %s",
    (code) => {
      // The words for *no workspace*, *role too low* and *malformed body* already exist. A
      // second vocabulary for any of them would be drift dressed as precision.
      expect(Object.values(ROUTING_ERRORS)).not.toContain(code);
    },
  );
});

describe("no route for a task kind", () => {
  it("is a 404 rather than a 422, because nothing about the request is malformed", () => {
    const error = routeNotFound("implement");

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.getResponse()).toEqual({
      code: "route_not_found",
      message: "This workspace has no route for that task kind.",
      details: { taskKind: "implement" },
    });
  });

  it("echoes the kind, so a client resolving several knows which one failed", () => {
    expect(routeNotFound("commit-msg").getResponse()).toMatchObject({
      details: { taskKind: "commit-msg" },
    });
  });
});

describe("a batch that cannot be saved", () => {
  it("is a 422 keyed by task kind, so a client marks exactly the rows that failed", () => {
    const error = routeSaveInvalid({
      implement: { floorHopIndex: ["too deep"] },
      docs: { "hops.0.alias": ["no such alias"] },
    });

    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(error.envelope().code).toBe("route_save_invalid");
    expect(error.envelope().message).toContain("details.routes");
    expect(error.envelope().details).toEqual({
      routes: {
        implement: { floorHopIndex: ["too deep"] },
        docs: { "hops.0.alias": ["no such alias"] },
      },
    });
  });

  it("says nothing was saved, because nothing was", () => {
    // The atomicity criterion, in the one place a client reads it: every refusal is decided
    // before the transaction opens, so a `422` here means the whole batch can be corrected and
    // re-sent rather than reconciled.
    expect(routeSaveInvalid({ docs: { taskKind: ["…"] } }).envelope().message).toContain(
      "Nothing was saved",
    );
  });

  it("refuses to describe a refusal that did not happen", () => {
    expect(() => routeSaveInvalid({})).toThrow(RangeError);
  });
});

describe("a rule the domain will not store", () => {
  it("is a 422 whose details name which half is wrong", () => {
    const error = escalationRuleInvalid({ then: ["not one of the three shapes"] });

    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(error.envelope()).toEqual({
      code: "escalation_rule_invalid",
      message: "This escalation rule is not valid. See `details.fields`.",
      details: { fields: { then: ["not one of the three shapes"] } },
    });
  });

  it("is not validation_failed, because the body was well formed and the domain refused it", () => {
    expect(escalationRuleInvalid({ when: ["…"] }).envelope().code).not.toBe("validation_failed");
  });

  it("refuses to describe a refusal that did not happen", () => {
    expect(() => escalationRuleInvalid({})).toThrow(RangeError);
  });
});

describe("a rule this workspace does not have", () => {
  it("is a 404 that echoes the id", () => {
    const error = escalationRuleNotFound("11111111-1111-4111-8111-111111111111");

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.envelope()).toEqual({
      code: "escalation_rule_not_found",
      message: "This workspace has no escalation rule by that id.",
      details: { id: "11111111-1111-4111-8111-111111111111" },
    });
  });
});

describe("a position another rule already holds", () => {
  it("is a 409, because the request is fine and the state is not", () => {
    const error = escalationRuleSortOrderTaken(2);

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.envelope().code).toBe("escalation_rule_sort_order_taken");
    expect(error.envelope().details).toEqual({ sortOrder: 2 });
  });

  it("says what to do instead", () => {
    expect(escalationRuleSortOrderTaken(3).envelope().message).toContain("sortOrder");
  });
});

describe("recognising what PostgreSQL refused", () => {
  it("knows V018's order key", () => {
    expect(
      isRuleSortOrderTaken({ code: UNIQUE_VIOLATION, constraint: RULE_SORT_ORDER_CONSTRAINT }),
    ).toBe(true);
  });

  it("knows V018's deferred target trigger", () => {
    expect(
      isRuleTargetMissing({ code: CHECK_VIOLATION, constraint: RULE_TARGETS_CONSTRAINT }),
    ).toBe(true);
  });

  it.each([
    ["a different constraint of the same class", { code: UNIQUE_VIOLATION, constraint: "other" }],
    [
      "the same constraint of a different class",
      { code: "23503", constraint: RULE_SORT_ORDER_CONSTRAINT },
    ],
    ["something that is not a driver error at all", new Error("boom")],
    ["null", null],
    ["a string", "23505"],
  ])("does not mistake %s for one", (_what, error) => {
    // Both fields are checked, so *some* constraint was violated is never mistaken for *this*
    // one — the rule `registry.errors.ts` states and the reason a bare exit code is not enough.
    expect(isRuleSortOrderTaken(error)).toBe(false);
    expect(isRuleTargetMissing(error)).toBe(false);
  });
});
