import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SYNTHETIC_NODE_TYPE, withSyntheticNodeType } from "./catalog.fixture";
import { FALLBACK_GLYPH } from "./catalog.presentation";
import {
  stageCatalog,
  stageCatalogEntries,
  toDslCatalogue,
  type StageCatalog,
  type StageSuggestions,
} from "./catalog.resources";
import { nodeTypeSchemas, publishedSchemaId, readPublishedDslSchema } from "./catalog.schema";
import { DslWarningCode } from "./dsl.errors";
import { readFixture } from "./dsl.golden.fixture";
import { validateWorkflowDocument } from "./dsl.validator";

/**
 * The catalog's wire shapes, and the advisory half of the ticket — R.3
 * ([#145](https://github.com/NobuData/ouroboros/issues/145)).
 *
 * *"Suggestions are advisory: an unknown skill or model name produces a warning path, not a
 * 4xx."* The HTTP half — a draft and a publish naming unknown names both succeed — is the
 * integration suite's. The half asserted here is what the inspector gets when it asks: the
 * suggestions, turned into a P7 catalogue, make the validator answer `valid` with a warning.
 */

/** The committed schema, read once. */
const SCHEMA = readPublishedDslSchema();

/** The suggestions mockup 04's canvas was drawn against. */
const SUGGESTIONS: StageSuggestions = {
  skills: ["repo-map", "zephyr-conventions"],
  taskRoutes: ["analyze", "plan", "split", "implement", "review"],
};

/** Mockup 04's canvas, as P.2 committed it, cloned so a case can edit one field. */
function standardFix(): { nodes: { id: string; config: Record<string, unknown> }[] } {
  return structuredClone(readFixture("valid/standard-fix.json")) as {
    nodes: { id: string; config: Record<string, unknown> }[];
  };
}

describe("the catalog entries", () => {
  const entries = stageCatalogEntries(nodeTypeSchemas(SCHEMA));

  it("carry the presentation and the schema, and nothing else", () => {
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(
        ["class", "configSchema", "configSchemaRef", "defaults", "glyph", "label", "type"].sort(),
      );
    }
  });

  it("are frozen, config schemas included", () => {
    expect(Object.isFrozen(entries)).toBe(true);
    expect(Object.isFrozen(entries[1].configSchema)).toBe(true);
    expect(Object.isFrozen(entries[1].defaults.config)).toBe(true);
  });

  it("give a type nobody drew everything a menu item and a form need", () => {
    const sandbox = stageCatalogEntries(nodeTypeSchemas(withSyntheticNodeType(SCHEMA))).at(-1)!;

    expect(sandbox).toMatchObject({
      type: SYNTHETIC_NODE_TYPE,
      label: SYNTHETIC_NODE_TYPE,
      glyph: FALLBACK_GLYPH,
      class: SYNTHETIC_NODE_TYPE,
      defaults: { title: SYNTHETIC_NODE_TYPE, config: {} },
    });
    expect(sandbox.configSchema.required).toEqual(["image"]);
  });
});

describe("the catalog", () => {
  const entries = stageCatalogEntries(nodeTypeSchemas(SCHEMA));

  it("carries the schema id, the entries it was given, and the suggestions", () => {
    const catalog = stageCatalog("id", entries, SUGGESTIONS);

    expect(catalog).toEqual({ schemaId: "id", nodeTypes: entries, suggestions: SUGGESTIONS });
    expect(catalog.nodeTypes).toBe(entries);
  });

  it("copies the suggestion lists, so an answer aliases neither configuration nor rows", () => {
    const skills = ["repo-map"];
    const taskRoutes = ["implement"];
    const catalog = stageCatalog("id", entries, { skills, taskRoutes });

    skills.push("later");
    taskRoutes.push("later");

    expect(catalog.suggestions).toEqual({ skills: ["repo-map"], taskRoutes: ["implement"] });
  });
});

describe("the suggestions, as a P7 catalogue", () => {
  it("names skills and task routes, and never models", () => {
    expect(toDslCatalogue(SUGGESTIONS)).toEqual({
      skills: SUGGESTIONS.skills,
      tasks: SUGGESTIONS.taskRoutes,
    });
  });

  it("leaves out a list with nothing in it, which means nothing to suggest", () => {
    expect(toDslCatalogue({ skills: [], taskRoutes: ["implement"] })).toEqual({
      tasks: ["implement"],
    });
    expect(toDslCatalogue({ skills: [], taskRoutes: [] })).toEqual({});
  });

  it("finds nothing unknown in mockup 04's canvas", () => {
    const verdict = validateWorkflowDocument(standardFix(), {
      catalogue: toDslCatalogue(SUGGESTIONS),
    });

    expect(verdict.valid).toBe(true);
    expect(verdict.warnings).toEqual([]);
  });

  it("makes an unknown skill a warning, and the document still valid", () => {
    const document = standardFix();
    document.nodes.find((node) => node.id === "implement")!.config.skill = "no-such-skill";

    const verdict = validateWorkflowDocument(document, { catalogue: toDslCatalogue(SUGGESTIONS) });

    expect(verdict.valid).toBe(true);
    expect(verdict.errors).toEqual([]);
    expect(verdict.warnings.map((warning) => [warning.code, warning.node])).toEqual([
      [DslWarningCode.REFERENCE_UNKNOWN_SKILL, "implement"],
    ]);
  });

  it("makes an unknown task route a warning, and the document still valid", () => {
    const document = standardFix();
    document.nodes.find((node) => node.id === "implement")!.config.routing = {
      inherit_task: "no-such-task",
    };

    const verdict = validateWorkflowDocument(document, { catalogue: toDslCatalogue(SUGGESTIONS) });

    expect(verdict.valid).toBe(true);
    expect(verdict.warnings.map((warning) => warning.code)).toEqual([
      DslWarningCode.REFERENCE_UNKNOWN_TASK,
    ]);
  });

  it("leaves an unknown model a warning too, once a model list is known", () => {
    // The catalog suggests no models, so its catalogue has no opinion about them; the warning
    // path for a model is the same one, reached when the model registry supplies the list.
    const document = standardFix();
    document.nodes.find((node) => node.id === "analyze")!.config.routing = {
      pinned_model: "no-such-model",
    };

    const verdict = validateWorkflowDocument(document, {
      catalogue: { ...toDslCatalogue(SUGGESTIONS), models: ["claude-sonnet-5", "claude-fable-5"] },
    });

    expect(verdict.valid).toBe(true);
    expect(verdict.warnings.map((warning) => warning.code)).toEqual([
      DslWarningCode.REFERENCE_UNKNOWN_MODEL,
    ]);
  });

  it("flags nothing for a deployment with nothing to suggest", () => {
    const document = standardFix();
    document.nodes.find((node) => node.id === "implement")!.config.skill = "no-such-skill";

    const verdict = validateWorkflowDocument(document, {
      catalogue: toDslCatalogue({ skills: [], taskRoutes: [] }),
    });

    expect(verdict.warnings).toEqual([]);
  });
});

describe("the documented example", () => {
  /** `openapi.json`'s example for the catalog's `200`. */
  const example = (
    JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "openapi.json"), "utf8")) as {
      paths: Record<
        string,
        {
          get: {
            responses: Record<string, { content: Record<string, { example: StageCatalog }> }>;
          };
        }
      >;
    }
  ).paths["/api/v1/workflows/catalog"].get.responses["200"].content["application/json"].example;

  it("names the schema the service reads", () => {
    expect(example.schemaId).toBe(publishedSchemaId(SCHEMA));
  });

  it("shows entries exactly as the service serves them", () => {
    // An example is copied into clients; one that drifted from the served config schemas would
    // teach a client a form the inspector never draws.
    const served = stageCatalogEntries(nodeTypeSchemas(SCHEMA));

    expect(example.nodeTypes.length).toBeGreaterThan(0);
    for (const entry of example.nodeTypes) {
      expect(entry).toEqual(served.find((candidate) => candidate.type === entry.type));
    }
  });
});
