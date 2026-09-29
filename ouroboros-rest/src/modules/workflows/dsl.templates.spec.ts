/**
 * The shipped onboarding workflow templates, held to this validator
 * ([#381](https://github.com/NobuData/ouroboros/issues/381), BA.2).
 *
 * `ouroboros-db/migrations/V068__workflow_templates.sql` ships mockup 13's four tiles as
 * `workflow_templates` rows whose `definition` is a WF-P.2 document. ci/db validates the stored
 * rows against the JSON Schema with ajv; this suite runs the service's full validator over the
 * same documents, so the structural rules the schema cannot state — one trigger, somewhere to
 * end, every stage reachable — hold for them too.
 *
 * It also pins the two tile captions that are claims about behaviour: feature-builder *asks
 * before merging* (its only terminal is the `needs_review` human gate), and docs-chores runs *on
 * your cheapest model* (every model stage inherits the `docs` task kind's route).
 *
 * No catalogue is supplied, for `dsl.seed.spec.ts`' reason (decision P7) — but every task kind a
 * template routes through is one the development workspace's routing matrix defines, so a
 * workspace set up like it resolves every stage.
 */

import { TEMPLATE_DOCUMENT_TAGS, seededTaskKinds, templateDocuments } from "./dsl.seed.fixture";
import { validateWorkflowDocument } from "./dsl.validator";

/** The slice of a DSL node these assertions read. */
interface NodeShape {
  type: string;
  config: { action?: string; routing?: { inherit_task?: string } };
}

/**
 * The nodes of the single document written under a template's tag.
 *
 * @param tag - The dollar-quoted tag, without its dollar signs.
 * @returns The document's `nodes` array.
 */
function nodesOf(tag: string): NodeShape[] {
  return (templateDocuments(tag)[0] as { nodes: NodeShape[] }).nodes;
}

describe("the shipped workflow templates", () => {
  describe.each(TEMPLATE_DOCUMENT_TAGS)("%s — %s", (tag) => {
    it("is written in the migration exactly once", () => {
      expect(templateDocuments(tag)).toHaveLength(1);
    });

    it("is a document this service accepts — schema and structure both", () => {
      const verdict = validateWorkflowDocument(templateDocuments(tag)[0]);

      expect(verdict.errors).toStrictEqual([]);
      expect(verdict.warnings).toStrictEqual([]);
      expect(verdict.valid).toBe(true);
    });

    it("routes only through task kinds the routing matrix defines", () => {
      const kinds = seededTaskKinds();
      const routed = nodesOf(tag)
        .map((node) => node.config.routing?.inherit_task)
        .filter((task): task is string => task !== undefined);

      expect(routed.length).toBeGreaterThan(0);
      for (const task of routed) expect(kinds).toContain(task);
    });
  });

  it("feature-builder asks before merging: its only terminal is the needs_review human gate", () => {
    const terminals = nodesOf("feature_builder_v1").filter((node) => node.type === "term");

    expect(terminals.map((node) => node.config.action)).toStrictEqual(["needs_review"]);
  });

  it("docs-chores runs on the cheap lane: every model stage inherits the docs route", () => {
    const models = nodesOf("docs_chores_v1").filter((node) => node.type === "llm");

    expect(models.length).toBeGreaterThan(0);
    for (const node of models) expect(node.config.routing).toStrictEqual({ inherit_task: "docs" });
  });

  it("quick-fixes is fully hands-off: it merges itself once checks are green", () => {
    const terminals = nodesOf("quick_fixes_v1").filter((node) => node.type === "term");

    expect(terminals.map((node) => node.config.action)).toStrictEqual(["open_pr_automerge"]);
  });
});
