import {
  ALIAS_COLUMNS,
  aliasDiff,
  bindingChanged,
  copyName,
  COPY_SUFFIX,
  requiredDiff,
  revisionAction,
  sameDocument,
  stateOf,
  type AliasState,
} from "./aliases.changes";
import type { AliasRow } from "./aliases.rows";

/**
 * The pure half of the lifecycle, branch by branch.
 *
 * Every assertion here is a literal in and a literal out, which is the reason these questions
 * were pulled out of the service: the service's own suite can then be about *when* they are
 * asked rather than about what they answer.
 */
const CONNECTION = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const OTHER_CONNECTION = "6f1d2c3b-4a59-4e87-9c10-2d3e4f5a6b70";

const ROW: AliasRow = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  organization_id: "org-acme",
  alias: "coder-max",
  provider_connection_id: CONNECTION,
  model_id: "claude-fable-5",
  enabled: true,
  params: { thinking: "max", token_budget: 400_000 },
  restrictions: {},
  notes: null,
  updated_by: null,
  created_at: new Date("2026-08-01T00:00:00.000Z"),
  updated_at: new Date("2026-08-02T00:00:00.000Z"),
  connection_kind: "anthropic",
  connection_display_name: "Anthropic Claude",
};

const STATE: AliasState = {
  alias: "coder-max",
  connectionId: CONNECTION,
  modelId: "claude-fable-5",
  enabled: true,
  params: { thinking: "max", token_budget: 400_000 },
  restrictions: {},
  notes: null,
};

describe("stateOf", () => {
  it("reads the seven editable columns and nothing else", () => {
    expect(stateOf(ROW)).toEqual(STATE);
  });

  it("maps every field to the column V025's diff keys it by", () => {
    // The diff is read by people and by CJ.2's promotion, both of which know the schema's
    // spellings; a field this map does not name would be one the diff could not record.
    expect(Object.keys(ALIAS_COLUMNS).sort()).toEqual(Object.keys(STATE).sort());
    expect(ALIAS_COLUMNS.connectionId).toBe("provider_connection_id");
    expect(ALIAS_COLUMNS.modelId).toBe("model_id");
  });
});

describe("sameDocument", () => {
  it("ignores key order at every depth, as jsonb does", () => {
    expect(sameDocument({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
  });

  it("keeps array order, which is part of a jsonb array's identity", () => {
    expect(sameDocument([1, 2], [2, 1])).toBe(false);
  });

  it("tells a value from its absence", () => {
    expect(sameDocument({ a: null }, {})).toBe(false);
    expect(sameDocument(null, undefined)).toBe(false);
  });
});

describe("aliasDiff", () => {
  it("answers null when nothing changed, so a no-op write records nothing", () => {
    expect(aliasDiff(STATE, { ...STATE })).toBeNull();
  });

  it("answers null across a re-ordered params document, which is the same document", () => {
    expect(
      aliasDiff(STATE, { ...STATE, params: { token_budget: 400_000, thinking: "max" } }),
    ).toBeNull();
  });

  it("names only the columns that moved, by column name", () => {
    expect(aliasDiff(STATE, { ...STATE, connectionId: OTHER_CONNECTION, notes: "moved" })).toEqual({
      provider_connection_id: { from: CONNECTION, to: OTHER_CONNECTION },
      notes: { from: null, to: "moved" },
    });
  });

  it("records every column for a create, from null", () => {
    expect(aliasDiff(null, STATE)).toEqual({
      alias: { from: null, to: "coder-max" },
      provider_connection_id: { from: null, to: CONNECTION },
      model_id: { from: null, to: "claude-fable-5" },
      enabled: { from: null, to: true },
      params: { from: null, to: STATE.params },
      restrictions: { from: null, to: {} },
      notes: { from: null, to: null },
    });
  });

  it("records every column for a delete, to null", () => {
    const diff = aliasDiff(STATE, null);

    expect(diff).not.toBeNull();
    expect(Object.keys(diff ?? {})).toEqual(Object.values(ALIAS_COLUMNS));
    expect(diff?.alias).toEqual({ from: "coder-max", to: null });
  });

  it("refuses two nulls — there is no such write", () => {
    expect(() => aliasDiff(null, null)).toThrow(RangeError);
  });
});

describe("requiredDiff", () => {
  // Shared by every path that writes a `created` revision — CH.1's create and duplicate, and
  // CH.4's import (#587) — so an imported alias's revision is shaped by the same function a
  // typed one's is.
  it("moves every column on a create", () => {
    const diff = requiredDiff(null, stateOf(ROW));

    expect(Object.keys(diff).sort()).toEqual(Object.values(ALIAS_COLUMNS).sort());
    expect(diff.alias).toEqual({ from: null, to: "coder-max" });
  });

  it("moves every column on a delete", () => {
    expect(requiredDiff(stateOf(ROW), null).enabled).toEqual({ from: true, to: null });
  });

  it("raises rather than answering a null V025 would refuse", () => {
    // Unreachable for a one-sided diff, which is why it is an Error and not a designed
    // refusal: reaching it means a caller passed two identical states to a create's diff.
    expect(() => requiredDiff(stateOf(ROW), stateOf(ROW))).toThrow(
      "a create or a delete always moves every column",
    );
  });
});

describe("bindingChanged", () => {
  it("is a connection move", () => {
    expect(bindingChanged(STATE, { ...STATE, connectionId: OTHER_CONNECTION })).toBe(true);
  });

  it("is a model move", () => {
    expect(bindingChanged(STATE, { ...STATE, modelId: "claude-sonnet-5" })).toBe(true);
  });

  it("is unbinding", () => {
    expect(bindingChanged(STATE, { ...STATE, connectionId: null })).toBe(true);
  });

  it("is not an edit of anything else", () => {
    expect(bindingChanged(STATE, { ...STATE, enabled: false, notes: "x" })).toBe(false);
  });
});

describe("revisionAction", () => {
  it("calls a rename a rename, whatever else moved", () => {
    expect(
      revisionAction(STATE, {
        ...STATE,
        alias: "coder-primary",
        connectionId: OTHER_CONNECTION,
        enabled: false,
      }),
    ).toBe("renamed");
  });

  it("ranks a rebind above the switch", () => {
    expect(revisionAction(STATE, { ...STATE, modelId: "claude-sonnet-5", enabled: false })).toBe(
      "rebound",
    );
  });

  it("tells enabling from disabling", () => {
    expect(revisionAction({ ...STATE, enabled: false }, STATE)).toBe("enabled");
    expect(revisionAction(STATE, { ...STATE, enabled: false })).toBe("disabled");
  });

  it("calls everything else an edit", () => {
    expect(revisionAction(STATE, { ...STATE, params: {}, notes: "n" })).toBe("edited");
  });
});

describe("copyName", () => {
  it("is the alias with the suffix when that is free", () => {
    expect(copyName("coder-max", new Set())).toBe(`coder-max${COPY_SUFFIX}`);
  });

  it("numbers from 2, because the plain copy is the first", () => {
    expect(copyName("coder-max", new Set(["coder-max-copy"]))).toBe("coder-max-copy-2");
  });

  it("takes the first free number rather than one past the highest", () => {
    // `-copy-2` was deleted: it is free again, and reusing it is what "uniqueness-suffixed"
    // means. A counter would skip it for no reason a user could see.
    expect(copyName("coder-max", new Set(["coder-max-copy", "coder-max-copy-3"]))).toBe(
      "coder-max-copy-2",
    );
  });

  it("does not treat a longer name that shares the prefix as a collision", () => {
    expect(copyName("coder", new Set(["coder-copy-of-something"]))).toBe("coder-copy");
  });
});
