import { describe, expect, it } from "vitest";

import type { CopilotWarning } from "@/app/api/workflow-copilot";
import type { WorkflowDefinition } from "@/app/api/workflows";
import { STAGE_GLYPHS } from "@/app/workflows/canvas/view";
import type { OperationShape } from "@/app/workflows/copilot/conversation";
import { type CopilotLive, EMPTY_LIVE, type LiveOperation } from "@/app/workflows/copilot/copilot-live";
import { GUARD_ENFORCEMENT_WORDS } from "@/app/workflows/copilot/copilot-view";
import {
  NOT_RUNNABLE,
  PROVENANCE_PILLS,
  RUNNABLE_ONCE_PROMOTED,
  type StageDraft,
  type StageRow,
  advanceStageDraft,
  applyOperation,
  draftLabel,
  editName,
  footerParts,
  openStageDraft,
  parseDraftLabel,
  revTag,
  rowNumber,
  stageCount,
  stageOrder,
  stageRows,
  stageTags,
  stagesTitle,
  supersedes,
  warningButtonName,
  warningExplanation,
} from "@/app/workflows/copilot/stages";

import {
  ADVISORY_DB_WARNING,
  EXPLOIT_VERIFY_WARNING,
  NEVER_AUTO_MERGE,
  SEEDED_NODE_IDS,
  SPEND_GUARD,
  copilotPromotion,
  seededAliases,
  seededDraftDefinition,
  seededProvenance,
  seededStageDraft,
} from "../../helpers/workflow-copilot";

/**
 * The stage list's decisions (CE.3, #567), as values: the order rows are listed in, which stages
 * fold, every tag rule and their order, which tag an unresolved reference marks and what its note
 * says, the footer in each state, the head — and the working draft, which folds the stream's
 * operations into the document and lets the newer of a read, a poll and a finished reply win.
 */

/** A document from short node and edge lists. */
function doc(
  nodes: readonly (readonly [id: string, type: string, extra?: Record<string, unknown>])[],
  edges: readonly (readonly [from: string, to: string, kind?: string])[] = [],
  trigger?: unknown,
): WorkflowDefinition {
  return {
    ...(trigger === undefined ? {} : { trigger }),
    nodes: nodes.map(([id, type, extra]) => ({ id, type, title: id, config: {}, ...extra })),
    edges: edges.map(([from, to, kind]) => ({ from, to, kind: kind ?? "default" })),
  } as unknown as WorkflowDefinition;
}

/** The ids of an order. */
function ids(definition: WorkflowDefinition | null): string[] {
  return stageOrder(definition).map((stage) => stage.id);
}

/** The seeded rows. */
function seededRows(): readonly StageRow[] {
  return stageRows({
    definition: seededDraftDefinition(),
    provenance: seededProvenance(),
    warnings: [ADVISORY_DB_WARNING, EXPLOIT_VERIFY_WARNING],
    aliases: seededAliases(),
  });
}

/** One stage's tag texts. */
function tagsOf(
  kind: "trigger" | "llm" | "infra" | "flow" | "term",
  config: Record<string, unknown>,
  facts: { trigger?: unknown; description?: string | null; warnings?: readonly CopilotWarning[] } = {},
): string[] {
  return stageTags(
    { id: "s", kind, config },
    {
      trigger: facts.trigger,
      description: facts.description ?? null,
      aliases: seededAliases(),
      warnings: facts.warnings ?? [],
    },
  ).map((tag) => tag.text);
}

describe("the order", () => {
  it("is the document's for a line already in order", () => {
    expect(ids(doc([["t", "trigger"], ["a", "llm"], ["b", "infra"]], [["t", "a"], ["a", "b"]]))).toEqual(["t", "a", "b"]);
  });

  it("is the graph's, not the document's: a stage written last is listed where the edges put it", () => {
    expect(ids(seededDraftDefinition())).toEqual([
      "trigger",
      "analyze",
      "plan",
      "implement",
      "build",
      "test",
      "exploit-verify",
      "review-primary",
      "review-second",
      "open-pr",
    ]);
  });

  it("puts the trigger first wherever the document holds it", () => {
    expect(ids(doc([["a", "llm"], ["t", "trigger"]], [["t", "a"]]))).toEqual(["t", "a"]);
  });

  it("lists both arms of a branch before the stage they join, ties in document order", () => {
    const branch = doc(
      [["t", "trigger"], ["join", "term"], ["right", "llm"], ["left", "llm"], ["fork", "flow"]],
      [["t", "fork"], ["fork", "left"], ["fork", "right"], ["left", "join"], ["right", "join"]],
    );

    expect(ids(branch)).toEqual(["t", "fork", "right", "left", "join"]);
  });

  it("lists a stage nothing leads to from the trigger last, and still lists it", () => {
    const stray = doc([["orphan", "llm"], ["t", "trigger"], ["a", "llm"]], [["t", "a"]]);

    expect(ids(stray)).toEqual(["t", "a", "orphan"]);
  });

  it("orders the unreachable among themselves too", () => {
    const strays = doc([["t", "trigger"], ["y", "llm"], ["x", "llm"]], [["x", "y"]]);

    expect(ids(strays)).toEqual(["t", "x", "y"]);
  });

  it("does not let a loop edge order anything", () => {
    const looped = doc(
      [["t", "trigger"], ["implement", "llm"], ["gate", "flow"]],
      [["t", "implement"], ["implement", "gate"], ["gate", "implement", "loop"]],
    );

    expect(ids(looped)).toEqual(["t", "implement", "gate"]);
  });

  it("lists every stage of a cycle once, and ends", () => {
    const cycle = doc([["t", "trigger"], ["a", "llm"], ["b", "llm"]], [["t", "a"], ["a", "b"], ["b", "a"], ["a", "a"]]);

    expect(ids(cycle)).toEqual(["t", "a", "b"]);
  });

  it("starts from the stages nothing leads into when there is no trigger", () => {
    expect(ids(doc([["b", "llm"], ["a", "llm"]], [["a", "b"]]))).toEqual(["a", "b"]);
  });

  it("is empty for no document, a blank one, and one whose nodes are not a list", () => {
    expect(ids(null)).toEqual([]);
    expect(ids({})).toEqual([]);
    expect(ids({ nodes: "none" } as unknown as WorkflowDefinition)).toEqual([]);
  });
});

describe("the seeded rows", () => {
  it("are mockup 20's nine, from ten nodes, numbered in two digits", () => {
    const rows = seededRows();

    expect(rows.map((row) => `${row.number} ${row.name}`)).toEqual([
      "01 trigger",
      "02 analyze",
      "03 plan",
      "04 implement",
      "05 build",
      "06 test",
      "07 exploit-verify",
      "08 review ×2",
      "09 open PR",
    ]);
    expect(rows.flatMap((row) => row.nodeIds).sort()).toEqual([...SEEDED_NODE_IDS].sort());
  });

  it("carry the tags the configuration composes", () => {
    expect(seededRows().map((row) => row.tags.map((tag) => tag.text))).toEqual([
      ["label:security"],
      ["skill:advisory-db", "claude-sonnet-5"],
      ["claude-fable-5"],
      ["routed by task"],
      ["pool-a"],
      // The seed names the pool and the suite on `test`, so the row prints both (the mockup prints one).
      ["pool-a", "twister full"],
      ["task:exploit-verify", "reruns CVE PoC", "sandboxed"],
      // `second-opinion` is bound to `composer-2` in the seed; the mockup prints `cursor/composer-2`.
      ["claude-fable-5", "composer-2"],
      ["never auto-merge"],
    ]);
  });

  it("put `added by copilot` on exploit-verify and nowhere else", () => {
    expect(seededRows().map((row) => row.pill)).toEqual([null, null, null, null, null, null, "added by copilot", null, null]);
  });

  it("warn on the two references that resolve to nothing, and on nothing else", () => {
    const warned = seededRows().flatMap((row) =>
      row.tags.filter((tag) => tag.warning !== null).map((tag) => `${row.number} ${tag.text} — ${tag.warning?.summary}`),
    );

    expect(warned).toEqual([
      "02 skill:advisory-db — skill does not exist",
      "07 task:exploit-verify — kind not in catalog",
    ]);
  });

  it("draw each kind's glyph as the canvas draws it", () => {
    expect(seededRows().map((row) => row.glyph)).toEqual([
      STAGE_GLYPHS.trigger,
      STAGE_GLYPHS.llm,
      STAGE_GLYPHS.llm,
      STAGE_GLYPHS.llm,
      STAGE_GLYPHS.infra,
      STAGE_GLYPHS.infra,
      STAGE_GLYPHS.llm,
      STAGE_GLYPHS.llm,
      STAGE_GLYPHS.term,
    ]);
    expect(seededRows()[0].kindWord).toBe("Trigger");
  });
});

describe("folding", () => {
  it("folds two stages of one type and title fed by the same stage, under the first one's id", () => {
    const review = seededRows()[7];

    expect(review).toMatchObject({ id: "review-primary", nodeIds: ["review-primary", "review-second"], name: "review ×2" });
  });

  it("does not fold stages fed by different stages", () => {
    const rows = stageRows({
      definition: doc(
        [["t", "trigger"], ["a", "llm", { title: "review" }], ["b", "llm", { title: "review" }]],
        [["t", "a"], ["a", "b"]],
      ),
      provenance: [],
      warnings: [],
      aliases: [],
    });

    expect(rows.map((row) => row.name)).toEqual(["t", "review", "review"]);
  });

  it("does not fold stages of different types, or stages nothing feeds", () => {
    const rows = stageRows({
      definition: doc(
        [
          ["t", "trigger"],
          ["a", "llm", { title: "check" }],
          ["b", "infra", { title: "check" }],
          ["x", "llm", { title: "loose" }],
          ["y", "llm", { title: "loose" }],
        ],
        [["t", "a"], ["t", "b"]],
      ),
      provenance: [],
      warnings: [],
      aliases: [],
    });

    expect(rows.map((row) => row.name)).toEqual(["t", "check", "check", "loose", "loose"]);
  });

  it("unions the twins' tags in node order, once each", () => {
    const rows = stageRows({
      definition: doc(
        [
          ["t", "trigger"],
          ["a", "llm", { title: "review", config: { routing: { pinned_model: { alias: "coder-max" } } } }],
          ["b", "llm", { title: "review", config: { routing: { pinned_model: { alias: "coder-max" } } } }],
          ["c", "llm", { title: "review", config: { routing: { pinned_model: { alias: "coder-std" } } } }],
        ],
        [["t", "a"], ["t", "b"], ["t", "c"]],
      ),
      provenance: [],
      warnings: [],
      aliases: seededAliases(),
    });

    expect(rows[1].name).toBe("review ×3");
    expect(rows[1].tags.map((tag) => tag.text)).toEqual(["claude-fable-5", "claude-sonnet-5"]);
    expect(new Set(rows[1].tags.map((tag) => tag.key)).size).toBe(2);
  });

  it("shows the pill on a folded row only when every stage it stands for has it", () => {
    const twins = doc([["t", "trigger"], ["a", "llm", { title: "r" }], ["b", "llm", { title: "r" }]], [["t", "a"], ["t", "b"]]);
    const by = (a: "copilot" | "human", b: "copilot" | "human" | "suggestion") =>
      stageRows({
        definition: twins,
        provenance: [
          { nodeId: "a", provenance: a, addedRev: 1 },
          { nodeId: "b", provenance: b, addedRev: 1 },
        ],
        warnings: [],
        aliases: [],
      })[1].pill;

    expect(by("copilot", "copilot")).toBe("added by copilot");
    expect(by("copilot", "human")).toBeNull();
    expect(by("human", "copilot")).toBeNull();
    expect(by("copilot", "suggestion")).toBeNull();
  });
});

describe("the pill", () => {
  it("is said for the copilot and for a suggestion, and not for a person or a published stage", () => {
    expect(PROVENANCE_PILLS).toEqual({
      copilot: "added by copilot",
      suggestion: "added by suggestion",
      human: null,
      published: null,
    });
  });

  it("is absent for a stage the provenance does not mention", () => {
    const rows = stageRows({ definition: doc([["t", "trigger"]]), provenance: [], warnings: [], aliases: [] });

    expect(rows[0].pill).toBeNull();
  });
});

describe("the tags", () => {
  it("print one tag per trigger condition value: labels, then effort, then source", () => {
    const trigger = { event: "ticket_queued", conditions: { labels: ["security", "cve"], effort_lte: "m", source: "github" } };

    expect(tagsOf("trigger", {}, { trigger })).toEqual(["label:security", "label:cve", "effort ≤ M", "source:github"]);
  });

  it("print nothing for a trigger with no conditions, or none at all", () => {
    expect(tagsOf("trigger", {}, { trigger: { event: "ticket_queued", conditions: {} } })).toEqual([]);
    expect(tagsOf("trigger", {})).toEqual([]);
  });

  it("read the trigger for the trigger stage alone", () => {
    const trigger = { event: "ticket_queued", conditions: { labels: ["security"] } };

    expect(tagsOf("llm", {}, { trigger })).toEqual([]);
  });

  it("print the skill only in skill mode", () => {
    expect(tagsOf("llm", { mode: "skill", skill: "triage" })).toEqual(["skill:triage"]);
    expect(tagsOf("llm", { mode: "prompt", skill: "triage" })).toEqual([]);
  });

  it("resolve a pinned alias to its model id, and print the alias itself when the registry lacks it", () => {
    expect(tagsOf("llm", { routing: { pinned_model: { alias: "coder-std" } } })).toEqual(["claude-sonnet-5"]);
    expect(tagsOf("llm", { routing: { pinned_model: { alias: "nobody" } } })).toEqual(["nobody"]);
  });

  it("print `routed by task` for an inherited route that resolves, and let a pin win over it", () => {
    expect(tagsOf("llm", { routing: { inherit_task: "implement" } })).toEqual(["routed by task"]);
    expect(tagsOf("llm", { routing: { inherit_task: "implement", pinned_model: { alias: "coder-max" } } })).toEqual([
      "claude-fable-5",
    ]);
  });

  it("print the runner pool, a flow node's predicate, and a terminal's policy", () => {
    expect(tagsOf("infra", { runner_pool: "pool-a", command: "make" })).toEqual(["pool-a"]);
    expect(tagsOf("flow", { kind: "decision", predicate: { kind: "effort", op: "lte", value: "m" } })).toEqual(["effort ≤ M"]);
    expect(tagsOf("term", { action: "needs_review" })).toEqual(["never auto-merge"]);
    expect(tagsOf("term", { action: "open_pr_automerge" })).toEqual(["auto-merge"]);
    expect(tagsOf("term", { action: "back_to_queue" })).toEqual(["back to queue"]);
    expect(tagsOf("term", { action: "something_else" })).toEqual([]);
  });

  it("split a description on ` · ` into one tag each", () => {
    expect(tagsOf("llm", {}, { description: "reruns CVE PoC · sandboxed" })).toEqual(["reruns CVE PoC", "sandboxed"]);
    expect(tagsOf("llm", {}, { description: " ·  · " })).toEqual([]);
  });

  it("keep the order: skill, model, pool, description, policy", () => {
    expect(
      tagsOf(
        "llm",
        { mode: "skill", skill: "triage", routing: { pinned_model: { alias: "coder-max" } }, runner_pool: "pool-b" },
        { description: "careful" },
      ),
    ).toEqual(["skill:triage", "claude-fable-5", "pool-b", "careful"]);
    expect(tagsOf("term", { action: "needs_review" }, { description: "to a human" })).toEqual(["to a human", "never auto-merge"]);
  });

  it("say a thing once, whatever its case", () => {
    expect(tagsOf("term", { action: "needs_review" }, { description: "Never Auto-Merge" })).toEqual(["Never Auto-Merge"]);
    expect(tagsOf("infra", { runner_pool: "pool-a" }, { description: "pool-a · POOL-A · fast" })).toEqual(["pool-a", "fast"]);
  });

  it("read a config that is not what the DSL says as fewer tags, never a throw", () => {
    expect(tagsOf("llm", { mode: "skill", skill: 7, routing: "fast" })).toEqual([]);
    expect(tagsOf("infra", { runner_pool: "" })).toEqual([]);
  });
});

describe("warnings", () => {
  const skill: CopilotWarning = { ...ADVISORY_DB_WARNING, node: "s" };
  const task: CopilotWarning = { ...EXPLOIT_VERIFY_WARNING, node: "s" };
  const alias: CopilotWarning = {
    code: "reference.unknown_alias",
    node: "s",
    name: "fast-triage",
    path: "/nodes/0/config/routing/pinned_model/alias",
    message: "No alias named `fast-triage` exists in this workspace's registry yet.",
  };

  /** The warned tags of one stage. */
  function warned(config: Record<string, unknown>, warnings: readonly CopilotWarning[], id = "s") {
    return stageTags({ id, kind: "llm", config }, { trigger: undefined, description: null, aliases: seededAliases(), warnings })
      .filter((tag) => tag.warning !== null)
      .map((tag) => [tag.text, tag.warning?.code]);
  }

  it("marks the skill tag for an unknown skill", () => {
    expect(warned({ mode: "skill", skill: "advisory-db" }, [skill])).toEqual([["skill:advisory-db", "reference.unknown_skill"]]);
  });

  it("names the task kind, in warning, in place of `routed by task`", () => {
    expect(warned({ routing: { inherit_task: "exploit-verify" } }, [task])).toEqual([
      ["task:exploit-verify", "reference.unknown_task"],
    ]);
  });

  it("marks the model tag for an unknown alias, which is printed as the alias", () => {
    expect(warned({ routing: { pinned_model: { alias: "fast-triage" } } }, [alias])).toEqual([
      ["fast-triage", "reference.unknown_alias"],
    ]);
  });

  it("matches by stage and by name: another stage's warning, and another name's, mark nothing", () => {
    expect(warned({ mode: "skill", skill: "advisory-db" }, [skill], "other")).toEqual([]);
    expect(warned({ mode: "skill", skill: "triage" }, [{ ...skill, name: "advisory-db-2" }])).toEqual([
      ["advisory-db-2", "reference.unknown_skill"],
    ]);
  });

  it("still draws a warning no tag names, as a tag of its own — nothing unresolved is silent", () => {
    expect(warned({}, [skill])).toEqual([["advisory-db", "reference.unknown_skill"]]);
  });

  it("carries the service's sentence beside its own", () => {
    const [tag] = stageTags(
      { id: "s", kind: "llm", config: { mode: "skill", skill: "advisory-db" } },
      { trigger: undefined, description: null, aliases: [], warnings: [skill] },
    );

    expect(tag.warning).toEqual({
      code: "reference.unknown_skill",
      name: "advisory-db",
      summary: "skill does not exist",
      explanation: warningExplanation(skill),
      message: ADVISORY_DB_WARNING.message,
    });
  });

  it("says what is missing and where it will come from — an issue, never a date", () => {
    expect(warningExplanation(EXPLOIT_VERIFY_WARNING)).toBe(
      "This stage's task kind, exploit-verify, isn't in the catalog yet — the draft can't run on real issues until it exists. " +
        "The exploit-verify stage kind, with its sandboxed proof-of-concept runner, arrives with #570.",
    );
    expect(warningExplanation(ADVISORY_DB_WARNING)).toBe(
      "No skill named advisory-db exists in this workspace yet — the stage has nothing to load, and the draft can't run on real issues until it does. " +
        "The advisory-db skill arrives with #571.",
    );
    for (const warning of [EXPLOIT_VERIFY_WARNING, ADVISORY_DB_WARNING, alias]) {
      expect(warningExplanation(warning)).not.toMatch(/\b(20\d\d|soon|next (week|month|quarter)|Q[1-4])\b/i);
    }
  });

  it("promises no issue for a name no issue is known to deliver", () => {
    expect(warningExplanation({ code: "reference.unknown_task", name: "fuzz" })).toMatch(
      /fuzz, isn't in the catalog yet .* It resolves once a task kind with that name exists/,
    );
    expect(warningExplanation({ code: "reference.unknown_skill", name: "house-style" })).toMatch(
      /No skill named house-style .* It resolves once a skill with that name is created/,
    );
    expect(warningExplanation(alias)).toMatch(/No model alias named fast-triage .* added to the model registry/);
    expect(warningExplanation({ code: "reference.unknown_task", name: "fuzz" })).not.toMatch(/#\d/);
  });

  it("names the info button for its tag", () => {
    expect(warningButtonName("skill:advisory-db")).toBe("What is missing: skill:advisory-db");
  });
});

describe("the footer", () => {
  const promotion = { ok: true as const, value: copilotPromotion() };

  it("is the count, each guard as the service labels it, and the runnable line", () => {
    expect(footerParts({ rows: 9, warnings: [ADVISORY_DB_WARNING], promotion }).map((part) => part.text)).toEqual([
      "9 stages",
      "never auto-merge",
      "spend cap $5.00/run (not enforced on real runs yet)",
      NOT_RUNNABLE,
    ]);
  });

  it("never draws a dry-run-only guard as protection: it says so, on the warning tone", () => {
    const parts = footerParts({ rows: 9, warnings: [], promotion });

    expect(parts.find((part) => part.key === "guard:spend_guard")).toEqual({
      key: "guard:spend_guard",
      text: `${SPEND_GUARD.label} (${GUARD_ENFORCEMENT_WORDS.dry_run_only.toLowerCase()})`,
      tone: "warn",
    });
    expect(parts.find((part) => part.key === "guard:never_auto_merge")).toEqual({
      key: "guard:never_auto_merge",
      text: NEVER_AUTO_MERGE.label,
      tone: "plain",
    });
  });

  it("says the draft is not yet runnable while any reference is unresolved, and runnable once promoted when none is", () => {
    const line = (warnings: readonly CopilotWarning[]) => footerParts({ rows: 2, warnings, promotion: null }).at(-1);

    expect(line([EXPLOIT_VERIFY_WARNING])).toEqual({ key: "runnable", text: NOT_RUNNABLE, tone: "warn" });
    expect(line([])).toEqual({ key: "runnable", text: RUNNABLE_ONCE_PROMOTED, tone: "plain" });
  });

  it("claims nothing where there is no draft", () => {
    expect(footerParts({ rows: 0, warnings: [], promotion })).toEqual([]);
  });

  it("lists no guard when the summary carries none, or could not be read", () => {
    const none = { ok: true as const, value: copilotPromotion({ guards: [] }) };

    expect(footerParts({ rows: 1, warnings: [], promotion: none }).map((part) => part.text)).toEqual([
      "1 stage",
      RUNNABLE_ONCE_PROMOTED,
    ]);
    expect(footerParts({ rows: 3, warnings: [], promotion: { ok: false, reason: "No." } }).map((part) => part.key)).toEqual([
      "count",
      "runnable",
    ]);
  });

  it("counts rows in words", () => {
    expect(stageCount(1)).toBe("1 stage");
    expect(stageCount(9)).toBe("9 stages");
    expect(rowNumber(0)).toBe("01");
    expect(rowNumber(11)).toBe("12");
  });
});

describe("the head", () => {
  it("says unpublished only for a workflow with no version in force", () => {
    expect(stagesTitle("security-patch", null)).toBe("Draft — security-patch · unpublished");
    expect(stagesTitle("standard-fix", 4)).toBe("Draft — standard-fix");
  });

  it("tags the revision, and names each edit link for its row", () => {
    expect(revTag("v0.3")).toBe("draft v0.3");
    expect(editName("review ×2")).toBe("Edit review ×2 on the canvas");
  });

  it("reads and composes a draft label the way the service does", () => {
    expect(parseDraftLabel("v0.3")).toEqual({ published: 0, rev: 3 });
    expect(parseDraftLabel("v12.40")).toEqual({ published: 12, rev: 40 });
    expect(parseDraftLabel("draft")).toBeNull();
    expect(parseDraftLabel("")).toBeNull();
    expect(draftLabel({ published: 2, rev: 7 })).toBe("v2.7");
  });
});

describe("one operation", () => {
  const base = doc([["t", "trigger"], ["a", "llm"], ["b", "infra"]], [["t", "a"], ["a", "b"]]);
  const node = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "llm", title: id, config: {}, ...extra });
  const nodeIds = (definition: WorkflowDefinition | null) => stageOrder(definition).map((stage) => stage.id);
  const edgePairs = (definition: WorkflowDefinition | null) =>
    ((definition?.edges ?? []) as { from: string; to: string }[]).map((edge) => `${edge.from}>${edge.to}`);

  it("add_stage appends the node — to a draft with no document, too", () => {
    expect(nodeIds(applyOperation(base, { kind: "add_stage", params: { node: node("c") } }))).toEqual(["t", "a", "b", "c"]);
    expect(applyOperation(null, { kind: "add_stage", params: { node: node("c") } })).toEqual({ nodes: [node("c")] });
  });

  it("add_stage of an id already there replaces it in place — a duplicate changes no order", () => {
    const again = applyOperation(base, { kind: "add_stage", params: { node: node("a", { title: "again" }) } });

    expect(nodeIds(again)).toEqual(["t", "a", "b"]);
    expect(stageOrder(again)[1].title).toBe("again");
  });

  it("set_stage replaces the node in place, and does nothing for an id that is not there", () => {
    const set = applyOperation(base, { kind: "set_stage", params: { node: node("a", { title: "renamed" }) } });

    expect(stageOrder(set).map((stage) => stage.title)).toEqual(["t", "renamed", "b"]);
    expect(applyOperation(base, { kind: "set_stage", params: { node: node("zz") } })).toBe(base);
  });

  it("remove_stage removes the node and every edge touching it", () => {
    const removed = applyOperation(base, { kind: "remove_stage", params: { id: "a" } });

    expect(nodeIds(removed)).toEqual(["t", "b"]);
    expect(edgePairs(removed)).toEqual([]);
    expect(applyOperation(base, { kind: "remove_stage", params: { id: "zz" } })).toBe(base);
  });

  it("add_edge appends the edge as given, in either spelling, and not twice", () => {
    const edge = { from: "t", to: "b", kind: "branch", label: "skip" };
    const added = applyOperation(base, { kind: "add_edge", params: { edge } });

    expect(added?.edges).toContainEqual(edge);
    expect(edgePairs(applyOperation(base, { kind: "add_edge", params: { from: "t", to: "b" } }))).toEqual(["t>a", "a>b", "t>b"]);
    expect(applyOperation(base, { kind: "add_edge", params: { edge: { from: "t", to: "a" } } })).toBe(base);
  });

  it("remove_edge removes the ordered pair, in either spelling, and only that pair", () => {
    expect(edgePairs(applyOperation(base, { kind: "remove_edge", params: { from: "t", to: "a" } }))).toEqual(["a>b"]);
    expect(edgePairs(applyOperation(base, { kind: "remove_edge", params: { edge: { from: "a", to: "b" } } }))).toEqual(["t>a"]);
    expect(applyOperation(base, { kind: "remove_edge", params: { from: "a", to: "t" } })).toBe(base);
  });

  it("set_trigger replaces the document's trigger", () => {
    const trigger = { event: "ticket_queued", conditions: { labels: ["security"] } };

    expect(applyOperation(base, { kind: "set_trigger", params: { trigger } })?.trigger).toEqual(trigger);
  });

  it("returns the document itself for what changes nothing or cannot be read", () => {
    const unreadable: OperationShape[] = [
      { kind: "set_guard", params: { guard: "spend_guard", params: { per_run_cap_cents: 500 } } },
      { kind: "add_stage", params: { id: "exploit-verify" } },
      { kind: "add_stage", params: { node: { title: "no id" } } },
      { kind: "add_stage" },
      { kind: "add_edge", params: { edge: { from: "t" } } },
      { kind: "remove_edge", params: {} },
      { kind: "remove_stage", params: {} },
      { kind: "set_trigger", params: { conditions: { labels: ["security"] } } },
      { kind: "something_new", params: { node: node("q") } },
    ];

    for (const op of unreadable) expect(applyOperation(base, op)).toBe(base);
  });

  it("never changes the document it was given", () => {
    const before = JSON.stringify(base);

    applyOperation(base, { kind: "remove_stage", params: { id: "a" } });
    applyOperation(base, { kind: "add_stage", params: { node: node("c") } });

    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("the working draft", () => {
  /** A live operation. */
  function applied(ordinal: number, op: OperationShape, draftRev: number | null, extra: Partial<LiveOperation> = {}): LiveOperation {
    return { ordinal, op, outcome: "applied", draftRev, warnings: [], ...extra };
  }

  /** The store's entry. */
  function live(overrides: Partial<CopilotLive> = {}): CopilotLive {
    return { ...EMPTY_LIVE, ...overrides };
  }

  const fuzz = { id: "fuzz", type: "infra", title: "fuzz", config: { runner_pool: "pool-b" } };
  const addFuzz: OperationShape = { kind: "add_stage", params: { node: fuzz } };
  const wireFuzz: OperationShape = { kind: "add_edge", params: { edge: { from: "trigger", to: "fuzz", kind: "default" } } };

  /** The stage ids a state draws. */
  const stagesOf = (state: { definition: WorkflowDefinition | null }) => stageOrder(state.definition).map((stage) => stage.id);

  it("opens on the route's read", () => {
    const server = seededStageDraft();
    const state = openStageDraft(server, EMPTY_LIVE);

    expect(state).toMatchObject({ definition: server.definition, label: "v0.3", warnings: server.warnings, fresh: {} });
    expect(state.provenance).toEqual(seededProvenance());
  });

  it("opens empty on a read that failed", () => {
    expect(openStageDraft(null, EMPTY_LIVE)).toMatchObject({ definition: null, provenance: [], warnings: [], label: "" });
  });

  it("returns the same state when nothing new arrived", () => {
    const server = seededStageDraft();
    const state = openStageDraft(server, EMPTY_LIVE);

    expect(advanceStageDraft(state, { server, polled: null, live: EMPTY_LIVE })).toBe(state);
  });

  it("folds applied operations into the document in the order they arrived, moving the revision with each", () => {
    const server = seededStageDraft();
    const opened = openStageDraft(server, live({ streaming: true }));

    const one = advanceStageDraft(opened, { server, polled: null, live: live({ streaming: true, operations: [applied(1, addFuzz, 4)] }) });
    expect(stagesOf(one)).toContain("fuzz");
    expect(stagesOf(one).at(-1)).toBe("fuzz");
    expect(one.label).toBe("v0.4");

    // Wired in ahead of analyze, the row moves up to where the graph now puts it.
    const before: OperationShape = { kind: "add_edge", params: { edge: { from: "fuzz", to: "analyze", kind: "default" } } };
    const operations = [applied(1, addFuzz, 4), applied(2, wireFuzz, 5), applied(3, before, 5)];
    const two = advanceStageDraft(one, { server, polled: null, live: live({ streaming: true, operations }) });
    expect(stagesOf(two).slice(0, 3)).toEqual(["trigger", "fuzz", "analyze"]);
    expect(two.label).toBe("v0.5");
  });

  it("gives a stage the copilot adds its pill at once, and its warnings with it", () => {
    const server = seededStageDraft();
    const warning: CopilotWarning = { ...EXPLOIT_VERIFY_WARNING, node: "fuzz", name: "fuzz" };
    const state = advanceStageDraft(openStageDraft(server, EMPTY_LIVE), {
      server,
      polled: null,
      live: live({ streaming: true, operations: [applied(1, addFuzz, 4, { warnings: [warning] })] }),
    });

    expect(state.provenance.at(-1)).toEqual({ nodeId: "fuzz", provenance: "copilot", addedRev: 4 });
    expect(state.warnings).toContainEqual(warning);
    expect(state.fresh).toEqual({ fuzz: 1 });
  });

  it("drops a removed stage's provenance and warnings", () => {
    const server = seededStageDraft();
    const state = advanceStageDraft(openStageDraft(server, EMPTY_LIVE), {
      server,
      polled: null,
      live: live({ operations: [applied(1, { kind: "remove_stage", params: { id: "exploit-verify" } }, 4)] }),
    });

    expect(stagesOf(state)).not.toContain("exploit-verify");
    expect(state.provenance.map((entry) => entry.nodeId)).not.toContain("exploit-verify");
    expect(state.warnings).toEqual([ADVISORY_DB_WARNING]);
  });

  it("ignores a proposed operation, and one with no revision", () => {
    const server = seededStageDraft();
    const opened = openStageDraft(server, EMPTY_LIVE);
    const state = advanceStageDraft(opened, {
      server,
      polled: null,
      live: live({
        operations: [applied(1, addFuzz, null, { outcome: "proposed" }), applied(2, addFuzz, null)],
      }),
    });

    expect(stagesOf(state)).not.toContain("fuzz");
    expect(state.label).toBe("v0.3");
  });

  it("applies each operation once: a duplicate delivery and a re-render change nothing", () => {
    const server = seededStageDraft();
    const operations = [applied(1, addFuzz, 4), applied(1, addFuzz, 4)];
    const once = advanceStageDraft(openStageDraft(server, EMPTY_LIVE), { server, polled: null, live: live({ operations }) });

    expect(stagesOf(once).filter((id) => id === "fuzz")).toHaveLength(1);
    expect(once.fresh).toEqual({ fuzz: 1 });
    expect(advanceStageDraft(once, { server, polled: null, live: live({ operations }) })).toBe(once);
  });

  it("skips an operation at or behind the working revision — it is already in the draft", () => {
    const server = seededStageDraft();
    const stale = applied(1, { kind: "remove_stage", params: { id: "plan" } }, 3);
    const state = advanceStageDraft(openStageDraft(server, EMPTY_LIVE), { server, polled: null, live: live({ operations: [stale] }) });

    expect(stagesOf(state)).toContain("plan");
  });

  it("does not replay what the conversation did before the card mounted", () => {
    const server = seededStageDraft({ label: "v0.3" });
    const earlier = live({ operations: [applied(1, addFuzz, 9)], draft: seededStageDraft({ label: "v0.9", definition: null }) });
    const state = openStageDraft(server, earlier);

    expect(stagesOf(state)).not.toContain("fuzz");
    expect(state.label).toBe("v0.3");
    expect(advanceStageDraft(state, { server, polled: null, live: earlier })).toBe(state);
  });

  it("does fold in a reply still arriving when the card mounts", () => {
    const server = seededStageDraft();
    const state = openStageDraft(server, live({ streaming: true, operations: [applied(1, addFuzz, 4)] }));

    expect(stagesOf(state)).toContain("fuzz");
  });

  it("starts counting again when the conversation is started again", () => {
    const server = seededStageDraft();
    const opened = advanceStageDraft(openStageDraft(server, EMPTY_LIVE), {
      server,
      polled: null,
      live: live({ operations: [applied(1, addFuzz, 4), applied(2, wireFuzz, 5)] }),
    });
    const reset = advanceStageDraft(opened, { server, polled: null, live: EMPTY_LIVE });
    const again = advanceStageDraft(reset, {
      server,
      polled: null,
      live: live({ operations: [applied(1, { kind: "remove_stage", params: { id: "fuzz" } }, 6)] }),
    });

    expect(stagesOf(again)).not.toContain("fuzz");
    expect(again.label).toBe("v0.6");
  });

  it("lets a finished reply's draft replace what the stream built", () => {
    const server = seededStageDraft();
    const streamed = advanceStageDraft(openStageDraft(server, EMPTY_LIVE), {
      server,
      polled: null,
      live: live({ streaming: true, operations: [applied(1, addFuzz, 4)] }),
    });
    const done = seededStageDraft({ label: "v0.4", etag: "etag-draft-4", nodeProvenance: [] });
    const state = advanceStageDraft(streamed, { server, polled: null, live: live({ operations: [applied(1, addFuzz, 4)], draft: done }) });

    expect(state.definition).toBe(done.definition);
    expect(state.provenance).toEqual([]);
    expect(state.label).toBe("v0.4");
    // The highlight outlives the replacement: the row has only just been drawn.
    expect(state.fresh).toEqual({ fuzz: 1 });
  });

  it("lets a newer poll answer win, and the pill go with it", () => {
    const server = seededStageDraft();
    const cleared = seededStageDraft({
      etag: "etag-draft-3b",
      nodeProvenance: seededProvenance().map((entry) => ({ ...entry, provenance: "human" as const })),
    });
    const state = advanceStageDraft(openStageDraft(server, EMPTY_LIVE), { server, polled: cleared, live: EMPTY_LIVE });

    expect(state.provenance.every((entry) => entry.provenance === "human")).toBe(true);
  });

  it("never lets an older read overwrite what the stream has built", () => {
    const server = seededStageDraft();
    const streaming = live({ streaming: true, operations: [applied(1, addFuzz, 4), applied(2, wireFuzz, 5)] });
    const streamed = advanceStageDraft(openStageDraft(server, EMPTY_LIVE), { server, polled: null, live: streaming });

    const overtaken = seededStageDraft({ label: "v0.4", etag: "etag-draft-4" });
    const state = advanceStageDraft(streamed, { server, polled: overtaken, live: streaming });

    expect(stagesOf(state)).toContain("fuzz");
    expect(state.label).toBe("v0.5");

    const refreshed = advanceStageDraft(state, { server: seededStageDraft(), polled: overtaken, live: streaming });
    expect(stagesOf(refreshed)).toContain("fuzz");
  });

  it("takes a read at the same revision — a canvas save that moved no revision still shows", () => {
    const server = seededStageDraft();
    const edited = seededStageDraft({ etag: "etag-other", definition: doc([["t", "trigger"]]) });
    const state = advanceStageDraft(openStageDraft(server, EMPTY_LIVE), { server, polled: edited, live: EMPTY_LIVE });

    expect(stagesOf(state)).toEqual(["t"]);
  });

  it("decides newer by the label: a later revision, another published version, or a discard", () => {
    const held = { label: "v0.5" };
    const at = (label: string, definition: WorkflowDefinition | null = {}) => seededStageDraft({ label, definition });

    expect(supersedes(at("v0.6"), held, false)).toBe(true);
    expect(supersedes(at("v0.5"), held, false)).toBe(true);
    expect(supersedes(at("v0.4"), held, false)).toBe(false);
    // A promote: the draft restarts under the next published version.
    expect(supersedes(at("v1.0"), held, false)).toBe(true);
    // A discard answers no document at a revision that went back.
    expect(supersedes(at("v0.0", null), held, false)).toBe(true);
    // …but while a reply is arriving, that can only be a read from before it.
    expect(supersedes(at("v0.0", null), held, true)).toBe(false);
    // A label that is not one cannot be compared, and is taken.
    expect(supersedes(at("draft"), held, false)).toBe(true);
    expect(supersedes(at("v0.1"), { label: "" }, false)).toBe(true);
  });

  it("empties the list when a discard is read, and does not bring the stream's old operations back", () => {
    const server = seededStageDraft();
    const operations = [applied(1, addFuzz, 4)];
    const streamed = advanceStageDraft(openStageDraft(server, EMPTY_LIVE), { server, polled: null, live: live({ operations }) });

    const discarded = seededStageDraft({ label: "v0.0", etag: "none", definition: null, warnings: [], nodeProvenance: [] });
    const state = advanceStageDraft(streamed, { server: discarded, polled: null, live: live({ operations }) });

    expect(state.definition).toBeNull();
    expect(advanceStageDraft(state, { server: discarded, polled: null, live: live({ operations }) })).toBe(state);
  });

  it("marks a stage changed twice as changed twice, and the trigger stage for a new trigger", () => {
    const server = seededStageDraft();
    const rename: OperationShape = { kind: "set_stage", params: { node: { ...fuzz, title: "fuzz harder" } } };
    const trigger: OperationShape = { kind: "set_trigger", params: { trigger: { event: "ticket_queued", conditions: {} } } };
    const state = advanceStageDraft(openStageDraft(server, EMPTY_LIVE), {
      server,
      polled: null,
      live: live({ operations: [applied(1, addFuzz, 4), applied(2, rename, 5), applied(3, trigger, 6)] }),
    });

    expect(state.fresh).toEqual({ fuzz: 2, trigger: 1 });
  });

  it("keeps a draft's own type narrow enough to read without provenance", () => {
    const bare = { ...seededStageDraft(), nodeProvenance: undefined } as unknown as StageDraft;

    expect(openStageDraft(bare, EMPTY_LIVE).provenance).toEqual([]);
  });
});
