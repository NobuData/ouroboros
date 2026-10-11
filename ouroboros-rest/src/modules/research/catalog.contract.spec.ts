import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import { ResearchCatalogService } from "./catalog.service";
import type { ResearchRepository } from "./research.repository";
import { buildWebTool } from "./tools/adapters/web/web.factory";
import { ResearchToolRegistry } from "./tools/research-tool.registry";
import type { StoredToolSettings } from "./tools/research-tool.settings.store";

/**
 * The tools catalog is what `openapi.yaml` documents (CN.3, #629) — the real service over a real
 * adapter's schema, held to the schemas the UI's client is generated from.
 */

function validator(name: string) {
  const id = "https://ouroboros.build/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });
  return ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
}

type Example = { content: Record<string, { example?: unknown }> };

function operation(path: string, method: string) {
  return (
    document().paths as Record<
      string,
      Record<string, { requestBody: Example; responses: Record<string, Example> }>
    >
  )[path][method];
}

/** The catalog over the web tool's real schema: enabled with a sealed key, and unreachable. */
function world() {
  const tool = buildWebTool(
    { researchSearxngUrl: "http://localhost:8888", researchFetchTimeoutMs: 50 } as never,
    {} as never,
  );
  jest.spyOn(tool, "healthCheck").mockResolvedValue({ state: "down", detail: "unreachable" });

  return new ResearchCatalogService(
    {
      listTools: () =>
        Promise.resolve([
          { slug: "web", displayName: "Web search & page reader" },
          { slug: "docs", displayName: "Docs, standards & papers" },
          { slug: "oracle", displayName: "Oracle" },
        ]),
    } as unknown as ResearchRepository,
    new ResearchToolRegistry([tool]),
    {
      settingsFor: (_organizationId: string, slug: string) =>
        Promise.resolve(slug === "web" ? { config: { provider: "brave" }, secret: "k" } : null),
      store: () => Promise.resolve(),
    } as unknown as StoredToolSettings,
  );
}

describe("the research tools contract", () => {
  it("documents the catalog: a form row, the planned row and a row nothing is known about", async () => {
    const valid = validator("ResearchToolCatalog");
    const catalog = await world().tools("org-acme");

    expect(valid(catalog)).toBe(true);
    expect(valid.errors).toBeNull();
    expect(catalog.tools.map((tool) => tool.enable?.kind ?? null)).toEqual([
      "form",
      "planned",
      null,
    ]);
    expect(valid({ ...catalog, extra: true })).toBe(false);
  });

  it("documents what a save answers, and holds its own examples to the schemas", async () => {
    const entry = validator("ResearchToolCatalogEntry");
    const saved = await world().enable("org-acme", "web", { provider: "searxng" }, "user-1");

    expect(entry(saved)).toBe(true);
    expect(entry.errors).toBeNull();

    const list = operation("/api/v1/research/tools", "get");
    expect(
      validator("ResearchToolCatalog")(list.responses["200"].content["application/json"].example),
    ).toBe(true);

    const put = operation("/api/v1/research/tools/{slug}", "put");
    const body = validator("ResearchToolEnable");
    expect(body(put.requestBody.content["application/json"].example)).toBe(true);
    expect(body({ config: {}, secret: "x" })).toBe(false);
  });
});
