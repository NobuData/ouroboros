import { ResearchCatalogService } from "./catalog.service";
import type { KindRow, ResearchRepository, ToolRow } from "./research.repository";
import {
  BUILT_IN_KIND_ORDER,
  BUILT_IN_TOOL_ORDER,
  type InvestigationKindResource,
  orderCatalog,
} from "./resources";
import type { ResearchToolAdapter } from "./tools/research-tool.adapter";
import type { ResearchToolRegistry } from "./tools/research-tool.registry";

/**
 * The composer's catalogs (CN.2, #628): the kinds mapped from their rows in the mockup's order,
 * and the tools judged connected by the registry alone — no database beyond the slug table, no
 * network at all.
 */

const WORKSPACE = "org-acme";

/** V106's four, as the table answers them — by slug, which is not the composer's order. */
const SEEDED_KINDS: readonly KindRow[] = [
  kind(
    "bug_root_cause",
    "Bug root cause",
    "bug",
    ["code", "tickets", "telemetry"],
    ["brief", "fix_draft"],
  ),
  kind(
    "gap_analysis",
    "Gap analysis",
    "gap",
    ["web", "competitor", "code", "tickets", "telemetry"],
    ["brief", "matrix"],
  ),
  kind(
    "regression_forensics",
    "Regression forensics",
    "reg",
    ["code", "telemetry", "tickets"],
    ["brief", "fix_draft"],
  ),
  kind(
    "roadmap_improvements",
    "Roadmap & improvements",
    "road",
    ["tickets", "web", "competitor"],
    ["brief", "roadmap_doc"],
  ),
];

/** V106's six, by slug. */
const SEEDED_TOOLS: readonly ToolRow[] = [
  { slug: "code", displayName: "Codebase & git mining" },
  { slug: "competitor", displayName: "Competitor tracker" },
  { slug: "docs", displayName: "Docs, standards & papers" },
  { slug: "telemetry", displayName: "Build & test telemetry" },
  { slug: "tickets", displayName: "Issue & PR history index" },
  { slug: "web", displayName: "Web search & page reader" },
];

/** The adapters this build ships: every seeded tool but `docs`. */
const GLYPHS: Readonly<Record<string, string>> = {
  web: "◍",
  competitor: "⌖",
  code: "⌥",
  tickets: "▤",
  telemetry: "∿",
};

function kind(
  slug: string,
  displayName: string,
  tintKey: string,
  tools: string[],
  deliverables: InvestigationKindResource["playbook"]["deliverables"],
): KindRow {
  return {
    slug,
    displayName,
    tintKey,
    playbook: {
      version: 1,
      default_tools: tools,
      synthesis_template: `${slug}@1`,
      deliverables: deliverables as KindRow["playbook"]["deliverables"],
    },
  };
}

/** A registry answering an adapter for each slug in {@link GLYPHS}, named after its row. */
function registry(): ResearchToolRegistry {
  return {
    find: (slug: string): ResearchToolAdapter | undefined => {
      const glyph = GLYPHS[slug];
      if (glyph === undefined) return undefined;

      const row = SEEDED_TOOLS.find((tool) => tool.slug === slug)!;
      return {
        slug,
        displayMeta: () => ({ name: row.displayName, glyph, subLine: "" }),
      } as unknown as ResearchToolAdapter;
    },
  } as unknown as ResearchToolRegistry;
}

function service(
  kinds: readonly KindRow[] = SEEDED_KINDS,
  tools: readonly ToolRow[] = SEEDED_TOOLS,
) {
  const research = {
    listKinds: jest.fn().mockResolvedValue([...kinds]),
    listTools: jest.fn().mockResolvedValue([...tools]),
  };

  return {
    research,
    catalog: new ResearchCatalogService(research as unknown as ResearchRepository, registry()),
  };
}

describe("the kinds catalog", () => {
  it("maps each row to the composer's shape, in the mockup's order", async () => {
    const { research, catalog } = service();

    const answer = await catalog.kinds(WORKSPACE);

    expect(research.listKinds).toHaveBeenCalledWith(WORKSPACE);
    expect(answer.kinds.map((entry) => entry.slug)).toEqual(BUILT_IN_KIND_ORDER);
    expect(answer.kinds[3]).toEqual({
      slug: "gap_analysis",
      name: "Gap analysis",
      tint: "gap",
      playbook: {
        version: 1,
        defaultTools: ["web", "competitor", "code", "tickets", "telemetry"],
        deliverables: ["brief", "matrix"],
      },
    });
  });

  it("puts a workspace's own kinds after the built-in four, by name", async () => {
    const { catalog } = service([
      kind("zeta_review", "Zeta review", "gap", ["web"], ["brief"]),
      ...SEEDED_KINDS,
      kind("alpha_audit", "Alpha audit", "bug", ["code"], ["brief"]),
    ]);

    const answer = await catalog.kinds(WORKSPACE);

    expect(answer.kinds.map((entry) => entry.slug)).toEqual([
      ...BUILT_IN_KIND_ORDER,
      "alpha_audit",
      "zeta_review",
    ]);
  });

  it("answers an empty catalog for a workspace with no kinds, rather than inventing the four", async () => {
    const { catalog } = service([]);

    expect(await catalog.kinds(WORKSPACE)).toEqual({ kinds: [] });
  });
});

describe("the tools catalog", () => {
  it("lists every registered slug in the mockup's order, connected where an adapter exists", async () => {
    const { catalog } = service();

    const answer = await catalog.tools();

    expect(answer.tools.map((entry) => entry.slug)).toEqual(BUILT_IN_TOOL_ORDER);
    expect(answer.tools.map((entry) => entry.connected)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("names and glyphs a connected tool from its adapter, and an idle one from the table", async () => {
    const { catalog } = service();

    const { tools } = await catalog.tools();

    expect(tools.find((entry) => entry.slug === "competitor")).toEqual({
      slug: "competitor",
      name: "Competitor tracker",
      glyph: "⌖",
      connected: true,
    });
    expect(tools.find((entry) => entry.slug === "docs")).toEqual({
      slug: "docs",
      name: "Docs, standards & papers",
      glyph: null,
      connected: false,
    });
  });

  it("asks the registry and the slug table, and nothing else — no health check, no network", async () => {
    const { research, catalog } = service();

    await catalog.tools();

    expect(research.listTools).toHaveBeenCalledTimes(1);
    expect(research.listKinds).not.toHaveBeenCalled();
  });
});

describe("the catalog order", () => {
  it("ranks built-in slugs by the published order, then the rest by name, then by slug", () => {
    const ordered = orderCatalog(
      [
        { slug: "b", name: "Same" },
        { slug: "gap_analysis", name: "Gap analysis" },
        { slug: "a", name: "Same" },
        { slug: "bug_root_cause", name: "Bug root cause" },
        { slug: "c", name: "Another" },
      ],
      BUILT_IN_KIND_ORDER,
    );

    expect(ordered.map((entry) => entry.slug)).toEqual([
      "bug_root_cause",
      "gap_analysis",
      "c",
      "a",
      "b",
    ]);
  });

  it("returns a new array and leaves the input as it was", () => {
    const input = [
      { slug: "docs", name: "Docs" },
      { slug: "web", name: "Web" },
    ];

    const ordered = orderCatalog(input, BUILT_IN_TOOL_ORDER);

    expect(ordered).not.toBe(input);
    expect(input.map((entry) => entry.slug)).toEqual(["docs", "web"]);
    expect(ordered.map((entry) => entry.slug)).toEqual(["web", "docs"]);
  });
});
