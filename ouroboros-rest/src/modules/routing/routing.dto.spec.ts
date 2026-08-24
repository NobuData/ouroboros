import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { fieldMessages } from "../errors/validation";
import {
  CreateRuleDto,
  MAX_CHAIN_LENGTH,
  MAX_COST_CENTS_PER_RUN,
  MAX_HOP_NOTE_LENGTH,
  MAX_ROUTES_PER_SAVE,
  RoutePolicyDto,
  RuleParams,
  SaveRoutesDto,
  TaskKindParams,
  UpdateRuleDto,
} from "./routing.dto";

/**
 * What a management request may contain.
 *
 * The pipe is configured once in `errors/validation.ts` and its behaviour is that file's to
 * prove; this asserts the decorators, which is what the pipe reads. Three of them are the
 * ticket's own criteria rather than housekeeping:
 *
 *   * **an empty chain is a `422` naming the field**, and it is here rather than in the
 *     service because it is a fact about the body: V016's `route_chain_intact()` refuses a
 *     route with no hops, so an empty array could never be stored by anything;
 *   * **`null` on a `PUT` means *off*, and omitting a policy field is not the same request.**
 *     A verb with no *leave this alone* case must not let a client clear a floor by forgetting
 *     to send it; and
 *   * **a body carrying `display` is refused**, which is decision **M5**'s *"hand-written
 *     display text is rejected on write"* arriving before the database has to say it.
 */

/** The complaints about one body, keyed the way a `422`'s `details` keys them. */
function complaints<T extends object>(
  Dto: new () => T,
  body: Record<string, unknown>,
): Record<string, string[]> {
  return fieldMessages(
    validateSync(plainToInstance(Dto, body), { whitelist: true, forbidNonWhitelisted: true }),
  );
}

/** A well-formed single-route body. */
function policy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hops: [{ alias: "coder-max", note: "Primary" }, { alias: "local-docs" }],
    allowLocalFallback: true,
    floorHopIndex: null,
    maxCostCentsPerRun: 250,
    ...overrides,
  };
}

describe("a route save", () => {
  it("accepts the inspector's own state", () => {
    expect(complaints(RoutePolicyDto, policy())).toEqual({});
  });

  it("accepts a floor and a cap", () => {
    expect(
      complaints(RoutePolicyDto, policy({ floorHopIndex: 2, maxCostCentsPerRun: 250 })),
    ).toEqual({});
  });

  it("refuses an empty chain, naming the field", () => {
    expect(Object.keys(complaints(RoutePolicyDto, policy({ hops: [] })))).toEqual(["hops"]);
  });

  it("refuses a chain longer than the API's bound", () => {
    const long = Array.from({ length: MAX_CHAIN_LENGTH + 1 }, () => ({ alias: "coder-max" }));

    expect(Object.keys(complaints(RoutePolicyDto, policy({ hops: long })))).toEqual(["hops"]);
  });

  it("refuses a hop with no alias, addressed at the hop", () => {
    expect(Object.keys(complaints(RoutePolicyDto, policy({ hops: [{ note: "x" }] })))).toEqual([
      "hops.0.alias",
    ]);
  });

  it.each([["Coder-Max"], ["coder max"], ["coder--max"], ["-coder"], ["coder-"]])(
    "refuses %s, which is not a shape an alias column could hold",
    (alias) => {
      // V015 constrains `model_aliases.alias` to lower-case kebab, so a name outside this shape
      // names something the table could never hold. Refusing it here is a `422` instead of a
      // round trip that ends in a `404`.
      expect(Object.keys(complaints(RoutePolicyDto, policy({ hops: [{ alias }] })))).toEqual([
        "hops.0.alias",
      ]);
    },
  );

  it("accepts a hop with no note, and one with an explicit null", () => {
    expect(complaints(RoutePolicyDto, policy({ hops: [{ alias: "coder-max" }] }))).toEqual({});
    expect(
      complaints(RoutePolicyDto, policy({ hops: [{ alias: "coder-max", note: null }] })),
    ).toEqual({});
  });

  it.each([[" padded"], ["padded "], [""], ["   "]])(
    "refuses the note %p, restating V016's own CHECK",
    (note) => {
      expect(
        Object.keys(complaints(RoutePolicyDto, policy({ hops: [{ alias: "coder-max", note }] }))),
      ).toEqual(["hops.0.note"]);
    },
  );

  it("refuses a note past the column's length", () => {
    const note = "x".repeat(MAX_HOP_NOTE_LENGTH + 1);

    expect(
      Object.keys(complaints(RoutePolicyDto, policy({ hops: [{ alias: "coder-max", note }] }))),
    ).toEqual(["hops.0.note"]);
  });

  it.each([["allowLocalFallback"], ["floorHopIndex"], ["maxCostCentsPerRun"]])(
    "requires %s, because a PUT has no leave-this-alone case",
    (field) => {
      const body = policy();
      delete body[field];

      expect(Object.keys(complaints(RoutePolicyDto, body))).toContain(field);
    },
  );

  it("takes null as off for the floor and as no cap for the cost", () => {
    expect(
      complaints(RoutePolicyDto, policy({ floorHopIndex: null, maxCostCentsPerRun: null })),
    ).toEqual({});
  });

  it("refuses a floor below the first hop", () => {
    // V016's `routes_floor_hop_index_positive`: the chain starts at hop 1, so a floor below it
    // is not a floor.
    expect(Object.keys(complaints(RoutePolicyDto, policy({ floorHopIndex: 0 })))).toEqual([
      "floorHopIndex",
    ]);
  });

  it("refuses a cap of zero, which is a route that can never run", () => {
    // V016's `routes_max_cost_positive`. `null` is how *no cap* is said.
    expect(Object.keys(complaints(RoutePolicyDto, policy({ maxCostCentsPerRun: 0 })))).toEqual([
      "maxCostCentsPerRun",
    ]);
  });

  it("refuses a cap past what the integer column can hold", () => {
    // Bounded here so an out-of-range integer is a named field rather than a `22003` from the
    // driver surfacing as `internal_error`.
    expect(
      Object.keys(
        complaints(RoutePolicyDto, policy({ maxCostCentsPerRun: MAX_COST_CENTS_PER_RUN + 1 })),
      ),
    ).toEqual(["maxCostCentsPerRun"]);
  });

  it("refuses a taskKind in the single-route body, so a client cannot address two routes", () => {
    expect(Object.keys(complaints(RoutePolicyDto, policy({ taskKind: "docs" })))).toEqual([
      "taskKind",
    ]);
  });
});

describe("a batch", () => {
  it("accepts one press of Save routes", () => {
    expect(complaints(SaveRoutesDto, { routes: [{ ...policy(), taskKind: "implement" }] })).toEqual(
      {},
    );
  });

  it("refuses an empty batch, which asks for nothing", () => {
    expect(Object.keys(complaints(SaveRoutesDto, { routes: [] }))).toEqual(["routes"]);
  });

  it("refuses a batch past the API's bound", () => {
    const many = Array.from({ length: MAX_ROUTES_PER_SAVE + 1 }, (_unused, index) => ({
      ...policy(),
      taskKind: `kind-${index.toString()}`,
    }));

    expect(Object.keys(complaints(SaveRoutesDto, { routes: many }))).toEqual(["routes"]);
  });

  it("addresses a bad entry by its index", () => {
    const routes = [
      { ...policy(), taskKind: "implement" },
      { ...policy({ hops: [] }), taskKind: "docs" },
    ];

    expect(Object.keys(complaints(SaveRoutesDto, { routes }))).toEqual(["routes.1.hops"]);
  });

  it("requires a task kind on every entry", () => {
    expect(Object.keys(complaints(SaveRoutesDto, { routes: [policy()] }))).toEqual([
      "routes.0.taskKind",
    ]);
  });
});

describe("the path parameters", () => {
  it("takes a task kind shaped as the column is", () => {
    expect(complaints(TaskKindParams, { taskKind: "commit-msg" })).toEqual({});
    expect(Object.keys(complaints(TaskKindParams, { taskKind: "Implement" }))).toEqual([
      "taskKind",
    ]);
  });

  it("takes a rule id that is a uuid", () => {
    expect(complaints(RuleParams, { id: "f0000000-0000-4000-8000-000000000001" })).toEqual({});
    expect(Object.keys(complaints(RuleParams, { id: "not-a-uuid" }))).toEqual(["id"]);
  });
});

describe("a rule", () => {
  it("accepts the mockup's three, as structure", () => {
    for (const rule of [
      {
        when: { effort_gte: "l" },
        then: {
          use_alias: { task_kind: "implement", alias: "coder-max", params: { thinking: "max" } },
        },
      },
      {
        when: { label: "security" },
        then: { add_vote: { task_kind: "review", alias: "second-opinion" } },
      },
      { when: { diff_kind: "docs_only" }, then: { route_local: {} } },
    ]) {
      expect(complaints(CreateRuleDto, rule)).toEqual({});
    }
  });

  it("requires both halves", () => {
    expect(Object.keys(complaints(CreateRuleDto, {})).sort()).toEqual(["then", "when"]);
  });

  it.each([["a string"], [42], [null], [["an array"]]])(
    "refuses %p as a predicate, which is not an object at all",
    (when) => {
      expect(Object.keys(complaints(CreateRuleDto, { when, then: { route_local: {} } }))).toEqual([
        "when",
      ]);
    },
  );

  it("does not check the grammar itself, which is the database's", () => {
    // V018 exposes `escalation_rule_when_valid()` and `escalation_rule_then_valid()` so this
    // API validates a rule with that definition rather than a TypeScript copy of it. A DTO that
    // knew the vocabulary would be the copy — and would drift the first time it was widened.
    expect(
      complaints(CreateRuleDto, { when: { nonsense: true }, then: { also: "nonsense" } }),
    ).toEqual({});
  });

  it("refuses a hand-written sentence", () => {
    // Decision M5, one layer earlier than PostgreSQL's own refusal: the DTO declares no
    // `display`, and the pipe is `forbidNonWhitelisted`.
    expect(
      Object.keys(
        complaints(CreateRuleDto, {
          when: { effort_gte: "l" },
          then: { route_local: {} },
          display: "effort ≥ L → everything routes local",
        }),
      ),
    ).toEqual(["display"]);
  });

  it("takes an optional switch and position on create", () => {
    expect(
      complaints(CreateRuleDto, {
        enabled: false,
        sortOrder: 2,
        when: { effort_gte: "l" },
        then: { route_local: {} },
      }),
    ).toEqual({});
  });

  it("refuses a position below the first", () => {
    expect(
      Object.keys(
        complaints(CreateRuleDto, {
          sortOrder: 0,
          when: { effort_gte: "l" },
          then: { route_local: {} },
        }),
      ),
    ).toEqual(["sortOrder"]);
  });
});

describe("a rule PATCH", () => {
  it("accepts a body that only flips the switch", () => {
    expect(complaints(UpdateRuleDto, { enabled: false })).toEqual({});
  });

  it("accepts an empty body, which changes nothing", () => {
    expect(complaints(UpdateRuleDto, {})).toEqual({});
  });

  it("refuses a hand-written sentence here too", () => {
    expect(Object.keys(complaints(UpdateRuleDto, { display: "anything" }))).toEqual(["display"]);
  });

  it.each([["when"], ["then"]])(
    "refuses null for %s, because a rule has no clearable parts",
    (field) => {
      expect(Object.keys(complaints(UpdateRuleDto, { [field]: null }))).toEqual([field]);
    },
  );
});
