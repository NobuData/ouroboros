import type { WorkflowCatalogService } from "../workflows/catalog.service";
import { CopilotContextService } from "./copilot.context";
import { GUARD_VOCABULARY } from "./copilot.guards";

describe("the copilot grounding", () => {
  it("assembles the catalog, the skills, the task routes and the guards from the workspace's reads", async () => {
    const catalog = {
      catalog: jest.fn().mockResolvedValue({
        schemaId: "v1",
        nodeTypes: [
          { type: "llm", label: "Model stage" },
          { type: "infra", label: "Build / test" },
        ],
        suggestions: { skills: [], taskRoutes: [] },
      }),
      dslCatalogue: jest.fn().mockResolvedValue({ skills: ["pr-etiquette"], tasks: ["review"] }),
    };
    const service = new CopilotContextService(catalog as unknown as WorkflowCatalogService);

    const grounding = await service.grounding("acme-robotics-id");

    expect(catalog.catalog).toHaveBeenCalledWith("acme-robotics-id");
    expect(grounding.context).toEqual({
      catalog: [
        { type: "llm", label: "Model stage", summary: "" },
        { type: "infra", label: "Build / test", summary: "" },
      ],
      skills: ["pr-etiquette"],
      tasks: ["review"],
      guards: GUARD_VOCABULARY,
    });
    expect(grounding.catalogue).toEqual({ skills: ["pr-etiquette"], tasks: ["review"] });
  });

  it("sends empty lists when the catalogue supplies nothing, not undefined", async () => {
    const catalog = {
      catalog: jest.fn().mockResolvedValue({
        schemaId: "v1",
        nodeTypes: [],
        suggestions: { skills: [], taskRoutes: [] },
      }),
      dslCatalogue: jest.fn().mockResolvedValue({ skills: [] }),
    };
    const service = new CopilotContextService(catalog as unknown as WorkflowCatalogService);

    const grounding = await service.grounding("acme-robotics-id");

    expect(grounding.context.tasks).toEqual([]);
    expect(grounding.context.skills).toEqual([]);
  });
});
