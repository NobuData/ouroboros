import { describe, expect, it } from "vitest";

import { type Connection, readConnections, readStages } from "@/app/workflows/canvas/graph";
import { RULE_REASONS } from "@/app/workflows/canvas/view";
import {
  EDGE_LABEL_MAX,
  conditionSchema,
  edgeDraft,
  edgeErrors,
  edgeFields,
  isEdgeDirty,
} from "@/app/workflows/inspector/edge";
import { PREDICATE_REQUIRED, VALUES_REQUIRED, tooLong } from "@/app/workflows/inspector/inspector";

import { stageCatalog, standardFixDefinition } from "../../helpers/workflows";

/**
 * The edge panel's decisions (#151): the draft an edge opens with, what a draft writes, where the
 * condition's grammar is read from, and every rule that keeps **Apply** inert — each asserted over the
 * seeded `standard-fix` and the seeded catalog.
 */

/** The seeded document. */
const SEEDED = standardFixDefinition();

/**
 * One seeded edge, as the canvas reads it.
 *
 * @param from Its source.
 * @param to Its target.
 * @returns The connection.
 */
function seeded(from: string, to: string): Connection {
  const found = readConnections(SEEDED, readStages(SEEDED)).find((edge) => edge.from === from && edge.to === to);
  if (found === undefined) throw new Error(`no seeded edge ${from}→${to}`);
  return found;
}

/** The gate's *fail ↺* loop. */
const LOOP = seeded("checks-green", "implement");

/** A plain seeded edge. */
const PLAIN = seeded("plan", "implement");

/** The predicate grammar, as the seeded catalog serves it. */
const CONDITION = conditionSchema(stageCatalog());

describe("an edge's draft", () => {
  it("opens with the edge's kind, label and condition", () => {
    expect(edgeDraft(LOOP)).toEqual({ kind: "loop", label: "fail ↺", condition: { kind: "checks", op: "any_failed" } });
    expect(edgeDraft(PLAIN)).toEqual({ kind: "default", label: "", condition: undefined });
  });

  it("writes a trimmed label, none for an empty one, and a condition only on a branch or a loop", () => {
    expect(edgeFields({ kind: "branch", label: "  pass → ", condition: { kind: "always" } })).toEqual({
      kind: "branch",
      label: "pass →",
      condition: { kind: "always" },
    });
    expect(edgeFields({ kind: "default", label: "   ", condition: { kind: "always" } })).toEqual({
      kind: "default",
      label: null,
    });
    expect(edgeFields({ kind: "loop", label: "", condition: undefined })).toEqual({ kind: "loop", label: null });
  });

  it("is dirty when applying would write something different, and not when a default edge keeps a condition it will not write", () => {
    expect(isEdgeDirty(edgeDraft(LOOP), LOOP)).toBe(false);
    expect(isEdgeDirty({ ...edgeDraft(LOOP), label: "retry" }, LOOP)).toBe(true);
    expect(isEdgeDirty({ ...edgeDraft(PLAIN), condition: { kind: "always" } }, PLAIN)).toBe(false);
    expect(isEdgeDirty({ ...edgeDraft(PLAIN), kind: "loop" }, PLAIN)).toBe(true);
  });
});

describe("the condition's grammar", () => {
  it("is the flow node's predicate schema, as the catalog serves it", () => {
    expect(CONDITION?.schema.properties).toHaveProperty("kind");
    expect(CONDITION?.root).toHaveProperty("$defs");
  });

  it("is absent without a catalog, or with a catalog that serves no flow node", () => {
    expect(conditionSchema(null)).toBeNull();
    expect(conditionSchema(stageCatalog({ nodeTypes: [] }))).toBeNull();
  });
});

describe("what stops Apply", () => {
  it("is nothing for the seeded loop as it stands", () => {
    expect(edgeErrors(SEEDED, LOOP, edgeDraft(LOOP), CONDITION)).toEqual({});
  });

  it("is a loop that does not return upstream, said under Kind", () => {
    const forward = seeded("analyze", "effort-recheck");

    expect(edgeErrors(SEEDED, forward, { ...edgeDraft(forward), kind: "loop" }, CONDITION)).toEqual({
      kind: RULE_REASONS["edge.loop_not_upstream"],
    });
  });

  it("is a branch with no condition, said under the condition", () => {
    expect(edgeErrors(SEEDED, PLAIN, { ...edgeDraft(PLAIN), kind: "branch" }, CONDITION)).toEqual({
      "condition.kind": RULE_REASONS["edge.branch_without_condition"],
    });
  });

  it("is a condition that tests nothing, or needs values and has none", () => {
    expect(edgeErrors(SEEDED, PLAIN, { kind: "branch", label: "", condition: {} }, CONDITION)).toEqual({
      "condition.kind": PREDICATE_REQUIRED,
    });
    expect(
      edgeErrors(SEEDED, PLAIN, { kind: "branch", label: "", condition: { kind: "labels", op: "any", values: [] } }, CONDITION),
    ).toEqual({ "condition.values": VALUES_REQUIRED });
  });

  it("is a label longer than an edge may print", () => {
    expect(edgeErrors(SEEDED, PLAIN, { ...edgeDraft(PLAIN), label: "x".repeat(EDGE_LABEL_MAX + 1) }, CONDITION)).toEqual({
      label: tooLong(EDGE_LABEL_MAX),
    });
    expect(EDGE_LABEL_MAX).toBe(40);
  });

  it("is not a loop with no condition, which the DSL allows", () => {
    expect(edgeErrors(SEEDED, LOOP, { ...edgeDraft(LOOP), condition: undefined }, CONDITION)).toEqual({});
  });

  it("does not judge a condition's fields when the grammar could not be read", () => {
    expect(edgeErrors(SEEDED, PLAIN, { kind: "branch", label: "", condition: {} }, null)).toEqual({});
  });
});
