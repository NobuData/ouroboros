import type { AppConfigService } from "../config/config.service";
import { SYNTHETIC_NODE_TYPE, withSyntheticNodeType } from "./catalog.fixture";
import type { WorkflowCatalogRepository } from "./catalog.repository";
import { DslSchemaError, readPublishedDslSchema } from "./catalog.schema";
import { WorkflowCatalogService } from "./catalog.service";

/**
 * `WorkflowCatalogService` — the node types built once, the suggestions read per request — R.3
 * ([#145](https://github.com/NobuData/ouroboros/issues/145)).
 *
 * The statement is `catalog.repository.spec.ts`' and the shapes are `catalog.resources.spec.ts`';
 * what is left for this suite is the assembly, and the fixture proof one layer up: a service
 * handed a schema with a synthetic node type serves it, with no other change.
 */

const WORKSPACE = "acme-robotics-id";

describe("the stage catalog service", () => {
  let repository: jest.Mocked<Pick<WorkflowCatalogRepository, "taskKindNames">>;
  let config: Pick<AppConfigService, "workflowSkillSuggestions">;

  /** A service over the given schema, or the committed one. */
  function service(schema = readPublishedDslSchema()): WorkflowCatalogService {
    return new WorkflowCatalogService(
      repository as unknown as WorkflowCatalogRepository,
      config as AppConfigService,
      schema,
    );
  }

  beforeEach(() => {
    repository = { taskKindNames: jest.fn().mockResolvedValue(["analyze", "implement"]) };
    config = { workflowSkillSuggestions: Object.freeze(["repo-map", "zephyr-conventions"]) };
  });

  it("reads the task kinds of the workspace it was asked about", async () => {
    await service().catalog(WORKSPACE);

    expect(repository.taskKindNames).toHaveBeenCalledWith(WORKSPACE);
  });

  it("answers the published node types, the configured skills and the workspace's task kinds", async () => {
    const catalog = await service().catalog(WORKSPACE);

    expect(catalog.schemaId).toBe("https://ouroboros.build/schemas/workflow-dsl/v1.json");
    expect(catalog.nodeTypes.map((entry) => entry.type)).toEqual([
      "trigger",
      "llm",
      "infra",
      "flow",
      "term",
    ]);
    expect(catalog.suggestions).toEqual({
      skills: ["repo-map", "zephyr-conventions"],
      taskRoutes: ["analyze", "implement"],
    });
  });

  it("builds the node types once, not per request", async () => {
    const subject = service();

    const first = await subject.catalog(WORKSPACE);
    const second = await subject.catalog("another-workspace");

    expect(second.nodeTypes).toBe(first.nodeTypes);
  });

  it("reads the suggestions per request, so a new task kind is in the next answer", async () => {
    const subject = service();
    await subject.catalog(WORKSPACE);

    repository.taskKindNames.mockResolvedValueOnce(["analyze", "implement", "docs"]);

    expect((await subject.catalog(WORKSPACE)).suggestions.taskRoutes).toEqual([
      "analyze",
      "implement",
      "docs",
    ]);
  });

  it("does not let one answer's suggestions leak into the next", async () => {
    const subject = service();
    const first = await subject.catalog(WORKSPACE);

    (first.suggestions.skills as string[]).push("edited-by-a-caller");

    expect((await subject.catalog(WORKSPACE)).suggestions.skills).toEqual([
      "repo-map",
      "zephyr-conventions",
    ]);
  });

  it("serves a node type added to the schema, with nothing else changed", async () => {
    const catalog = await service(withSyntheticNodeType(readPublishedDslSchema())).catalog(
      WORKSPACE,
    );

    expect(catalog.nodeTypes.map((entry) => entry.type)).toContain(SYNTHETIC_NODE_TYPE);
    expect(catalog.nodeTypes.at(-1)).toMatchObject({
      type: SYNTHETIC_NODE_TYPE,
      class: SYNTHETIC_NODE_TYPE,
      defaults: { config: {} },
    });
  });

  it("fails at construction for a schema it cannot read node types from", () => {
    expect(() => service({ $id: "https://ouroboros.build/schemas/workflow-dsl/v1.json" })).toThrow(
      DslSchemaError,
    );
  });
});
