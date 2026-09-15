import { describe, expect, it } from "vitest";

import {
  CHANGE_NOTE_MAX,
  ENGINE_UNAVAILABLE_MESSAGE,
  FINDINGS_MESSAGE,
  PUBLISH_CONFLICT_MESSAGE,
  changeNoteBody,
  changeNoteProblem,
  findingAnchor,
  findingTarget,
  publishFailure,
  publishedToast,
  readFindings,
} from "@/app/workflows/publish";

import { standardFixDefinition } from "../helpers/workflows";

/**
 * The publish dialog's decisions (#152). The criterion this suite holds most closely: **publishing an
 * invalid graph anchors each finding to a node** — by the node it names, the stage an edge leaves, or the
 * node a JSON Pointer points into — and a finding about the document as a whole anchors to nothing rather
 * than to a guess.
 */

describe("the change note", () => {
  it("is sent trimmed, and not at all when the box is blank — the contract refuses a blank note", () => {
    expect(changeNoteBody("  Added the review gate.  ")).toBe("Added the review gate.");
    expect(changeNoteBody("   ")).toBeUndefined();
    expect(changeNoteBody("")).toBeUndefined();
  });

  it("is refused past the service's bound, and admitted at it", () => {
    expect(changeNoteProblem("a".repeat(CHANGE_NOTE_MAX))).toBeUndefined();
    expect(changeNoteProblem("a".repeat(CHANGE_NOTE_MAX + 1))).toMatch(/500/);
  });
});

describe("reading findings", () => {
  it("reads every finding with its source, code, message and anchors", () => {
    expect(
      readFindings({
        findings: [
          { source: "engine", code: "unreachable_node", message: "Nothing reaches this node.", node: "review" },
          { source: "dsl", code: "edge.branch", message: "A branch needs a condition.", edge: { from: "plan", to: "implement" } },
          { source: "registry", code: "reference.unknown_alias", message: "Unknown alias.", path: "/nodes/3/config", suggestion: "coder-max" },
        ],
      }),
    ).toEqual([
      { source: "engine", code: "unreachable_node", message: "Nothing reaches this node.", node: "review" },
      { source: "dsl", code: "edge.branch", message: "A branch needs a condition.", edge: { from: "plan", to: "implement" } },
      { source: "registry", code: "reference.unknown_alias", message: "Unknown alias.", path: "/nodes/3/config" },
    ]);
  });

  it("drops what is not a finding rather than printing a blank line", () => {
    expect(readFindings({ findings: [null, { message: "no code" }, { code: "x" }, "text"] })).toEqual([]);
    expect(readFindings({})).toEqual([]);
    expect(readFindings(undefined)).toEqual([]);
  });
});

describe("anchoring a finding to a stage", () => {
  const definition = standardFixDefinition();
  const nodes = definition.nodes as { id: string }[];

  it("uses the node the finding names", () => {
    expect(findingAnchor({ source: "engine", code: "x", message: "m", node: "implement" }, definition)).toBe("implement");
  });

  it("uses the stage an edge leaves, when the finding is about an edge", () => {
    expect(
      findingAnchor({ source: "dsl", code: "x", message: "m", edge: { from: "effort-recheck", to: "plan" } }, definition),
    ).toBe("effort-recheck");
  });

  it("uses the node a pointer points into, at any depth", () => {
    expect(findingAnchor({ source: "dsl", code: "x", message: "m", path: "/nodes/3" }, definition)).toBe(nodes[3].id);
    expect(findingAnchor({ source: "dsl", code: "x", message: "m", path: "/nodes/4/config/routing" }, definition)).toBe(
      nodes[4].id,
    );
  });

  it("anchors to nothing for the document as a whole, a pointer past the list, or a node the draft does not hold", () => {
    expect(findingAnchor({ source: "dsl", code: "x", message: "m", path: "" }, definition)).toBeNull();
    expect(findingAnchor({ source: "dsl", code: "x", message: "m", path: "/nodes/99" }, definition)).toBeNull();
    expect(findingAnchor({ source: "dsl", code: "x", message: "m", path: "/edges/2" }, definition)).toBeNull();
    expect(findingAnchor({ source: "engine", code: "x", message: "m", node: "deleted-stage" }, definition)).toBeNull();
    expect(findingAnchor({ source: "dsl", code: "x", message: "m", path: "/nodes/0" }, {})).toBeNull();
  });

  it("says where an anchored finding goes", () => {
    expect(findingTarget("Code the change")).toBe("Select Code the change");
  });
});

describe("a refused publish", () => {
  it("carries the findings of a definition a validator refused", () => {
    const failure = publishFailure({
      code: "workflow_definition_invalid",
      message: "This definition cannot be published yet.",
      details: { findings: [{ source: "engine", code: "unreachable_node", message: "Nothing reaches this node.", node: "review" }] },
    });

    expect(failure.message).toBe(FINDINGS_MESSAGE);
    expect(failure.findings).toHaveLength(1);
  });

  it("says a moved draft and an unavailable engine in its own words", () => {
    expect(publishFailure({ code: "workflow_draft_conflict", message: "m", details: {} })).toEqual({
      message: PUBLISH_CONFLICT_MESSAGE,
      findings: [],
    });
    expect(publishFailure({ code: "engine_unavailable", message: "m", details: {} }).message).toBe(
      ENGINE_UNAVAILABLE_MESSAGE,
    );
  });

  it("prints any other refusal as the service wrote it", () => {
    expect(
      publishFailure({ code: "workflow_publish_conflict", message: "This workflow was published by someone else.", details: {} }),
    ).toEqual({ message: "This workflow was published by someone else.", findings: [] });
  });
});

describe("a publish that took", () => {
  it("names the version now in force", () => {
    expect(publishedToast(15)).toMatch(/^Published v15\./);
  });
});
