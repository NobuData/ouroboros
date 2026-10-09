import { DslWarningCode } from "../workflows/dsl.errors";
import {
  introducedReferences,
  mentionsAll,
  unresolvedReferences,
  unresolvedSentence,
} from "./copilot.references";

const CATALOGUE = {
  skills: ["pr-etiquette"],
  tasks: ["review", "implement"],
  aliases: ["coder-max"],
};

function llm(id: string, config: Record<string, unknown>) {
  return { id, type: "llm", title: id, position: { x: 0, y: 0 }, config };
}

describe("W7's unresolved references", () => {
  it("names the skill, task and alias the catalogue does not list, with P7's codes", () => {
    const document = {
      nodes: [
        llm("exploit-verify", {
          mode: "skill",
          skill: "advisory-db",
          routing: { inherit_task: "exploit-verify" },
        }),
        llm("review-second", { routing: { pinned_model: { alias: "second-opinion" } } }),
        llm("review-primary", { skill: "pr-etiquette", routing: { inherit_task: "review" } }),
        { id: "test", type: "infra", config: { skill: "ignored-on-infra" } },
      ],
    };

    expect(unresolvedReferences(document, CATALOGUE)).toEqual([
      {
        code: DslWarningCode.REFERENCE_UNKNOWN_SKILL,
        node: "exploit-verify",
        name: "advisory-db",
        path: "/nodes/0/config/skill",
        message: "No skill named `advisory-db` is defined in this workspace yet.",
      },
      {
        code: DslWarningCode.REFERENCE_UNKNOWN_TASK,
        node: "exploit-verify",
        name: "exploit-verify",
        path: "/nodes/0/config/routing/inherit_task",
        message: "No task route named `exploit-verify` exists in this workspace yet.",
      },
      {
        code: DslWarningCode.REFERENCE_UNKNOWN_ALIAS,
        node: "review-second",
        name: "second-opinion",
        path: "/nodes/1/config/routing/pinned_model/alias",
        message: "No alias named `second-opinion` exists in this workspace's registry yet.",
      },
    ]);
  });

  it("checks only what the catalogue supplies, and nothing without one", () => {
    const document = { nodes: [llm("a", { skill: "x", routing: { inherit_task: "y" } })] };

    expect(unresolvedReferences(document, { skills: ["x"] })).toEqual([]);
    expect(unresolvedReferences(document, { tasks: [] })).toHaveLength(1);
    expect(unresolvedReferences(document, undefined)).toEqual([]);
    expect(unresolvedReferences(null, CATALOGUE)).toEqual([]);
  });

  it("reports what an operation introduced, not what was already there", () => {
    const before = unresolvedReferences({ nodes: [llm("a", { skill: "x" })] }, CATALOGUE);
    const after = unresolvedReferences(
      { nodes: [llm("a", { skill: "x" }), llm("b", { routing: { inherit_task: "z" } })] },
      CATALOGUE,
    );

    expect(introducedReferences(before, after).map((reference) => reference.name)).toEqual(["z"]);
  });

  it("writes the sentence the reply says, and knows when the reply already said it", () => {
    const references = unresolvedReferences(
      {
        nodes: [
          llm("exploit-verify", {
            skill: "advisory-db",
            routing: { inherit_task: "exploit-verify" },
          }),
        ],
      },
      CATALOGUE,
    );

    expect(unresolvedSentence(references)).toBe(
      "Note: skill `advisory-db` and task route `exploit-verify` do not exist in this workspace yet, " +
        "so the draft carries unresolved-reference warnings and cannot run until they exist.",
    );
    expect(unresolvedSentence(references.slice(0, 1))).toBe(
      "Note: skill `advisory-db` does not exist in this workspace yet, so the draft carries an " +
        "unresolved-reference warning and cannot run until it exists.",
    );
    expect(unresolvedSentence([])).toBe("");
    expect(mentionsAll("I added exploit-verify, which reads advisory-db.", references)).toBe(true);
    expect(mentionsAll("I added a verification stage.", references)).toBe(false);
  });
});
