import { ResearchCatalogService } from "./catalog.service";
import type { KindRow, ResearchRepository, ToolRow } from "./research.repository";
import {
  BUILT_IN_KIND_ORDER,
  BUILT_IN_TOOL_ORDER,
  type InvestigationKindResource,
  orderCatalog,
} from "./resources";
import type { ResearchToolAdapter } from "./tools/research-tool.adapter";
import type { ResearchToolConfig, ResearchToolConfigSchema } from "./tools/research-tool.config";
import { toolNotRegistered } from "./tools/research-tool.errors";
import { NOT_CONFIGURED_HEALTH, type ToolHealth } from "./tools/research-tool.health";
import type { ResearchToolRegistry } from "./tools/research-tool.registry";
import type { ToolSettings } from "./tools/research-tool.settings";
import type { StoredToolSettings, ToolSettingsWrite } from "./tools/research-tool.settings.store";

/**
 * The catalogs (CN.2, #628; CN.3, #629): the kinds mapped from their rows in the mockup's order,
 * and the tools as one workspace sees them — connected by the registry, their sub-line, health
 * and enable form by the adapter under that workspace's stored settings.
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

/** The web tool's form: a provider, and the key that is sealed rather than stored. */
const WEB_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Web search & page reader",
  properties: {
    provider: { type: "string", title: "Search provider", enum: ["searxng", "brave"] },
    apiKey: { type: "string", title: "API key", minLength: 1, "x-ouroboros-secret": true },
  },
  required: ["provider"],
  additionalProperties: false,
} as unknown as ResearchToolConfigSchema;

/** Every other tool's: one optional setting, as the conformance kit requires. */
const PLAIN_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Settings",
  properties: { windowDays: { type: "string", title: "Window (days)" } },
  required: [],
  additionalProperties: false,
} as unknown as ResearchToolConfigSchema;

/** What each adapter answers, replaceable per test. */
interface Behaviour {
  counts?: () => Promise<Record<string, number | string | null>>;
  health?: (
    config: ResearchToolConfig | null,
    secret: string | null,
    organizationId?: string,
  ) => Promise<ToolHealth>;
}

/** An adapter per slug in {@link GLYPHS}: configured ⇒ healthy, unconfigured ⇒ idle. */
function registry(behaviours: Readonly<Record<string, Behaviour>> = {}): ResearchToolRegistry {
  const find = (slug: string): ResearchToolAdapter | undefined => {
    const glyph = GLYPHS[slug];
    if (glyph === undefined) return undefined;

    const row = SEEDED_TOOLS.find((tool) => tool.slug === slug)!;
    const behaviour = behaviours[slug] ?? {};

    return {
      slug,
      displayMeta: () => ({
        name: row.displayName,
        glyph,
        subLine: slug === "competitor" ? "{rivals} rivals watched · {kinds}" : "always on",
      }),
      configSchema: () => structuredClone(slug === "web" ? WEB_SCHEMA : PLAIN_SCHEMA),
      counts:
        behaviour.counts ?? (() => Promise.resolve({ rivals: 4, kinds: "release notes, filings" })),
      healthCheck:
        behaviour.health ??
        ((config: ResearchToolConfig | null) =>
          Promise.resolve(
            config === null ? NOT_CONFIGURED_HEALTH : { state: "healthy", detail: "200 · 41ms" },
          )),
    } as unknown as ResearchToolAdapter;
  };

  return {
    find,
    get: (slug: string): ResearchToolAdapter => {
      const adapter = find(slug);
      if (adapter === undefined) throw toolNotRegistered(slug, Object.keys(GLYPHS));
      return adapter;
    },
  } as unknown as ResearchToolRegistry;
}

/** The stored settings, in memory: what `store` wrote is what `settingsFor` reads. */
function settingsStore(initial: Readonly<Record<string, ToolSettings>> = {}) {
  const held = new Map<string, ToolSettings>(Object.entries(initial));
  const settingsFor = jest.fn((_organizationId: string, slug: string) =>
    Promise.resolve(held.get(slug) ?? null),
  );
  const store = jest.fn((_organizationId: string, slug: string, write: ToolSettingsWrite) => {
    held.set(slug, {
      config: write.config,
      secret: write.secret ?? held.get(slug)?.secret ?? null,
    });
    return Promise.resolve();
  });

  return { settingsFor, store };
}

/** The five MVP tools enabled, as the dev seed leaves acme-robotics. */
const ENABLED: Readonly<Record<string, ToolSettings>> = Object.fromEntries(
  Object.keys(GLYPHS).map((slug) => [slug, { config: {}, secret: null }]),
);

function service(
  options: {
    kinds?: readonly KindRow[];
    tools?: readonly ToolRow[];
    stored?: Readonly<Record<string, ToolSettings>>;
    behaviours?: Readonly<Record<string, Behaviour>>;
  } = {},
) {
  const research = {
    listKinds: jest.fn().mockResolvedValue([...(options.kinds ?? SEEDED_KINDS)]),
    listTools: jest.fn().mockResolvedValue([...(options.tools ?? SEEDED_TOOLS)]),
  };
  const settings = settingsStore(options.stored ?? ENABLED);

  return {
    research,
    settings,
    catalog: new ResearchCatalogService(
      research as unknown as ResearchRepository,
      registry(options.behaviours),
      settings as unknown as StoredToolSettings,
    ),
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
    const { catalog } = service({
      kinds: [
        kind("zeta_review", "Zeta review", "gap", ["web"], ["brief"]),
        ...SEEDED_KINDS,
        kind("alpha_audit", "Alpha audit", "bug", ["code"], ["brief"]),
      ],
    });

    const answer = await catalog.kinds(WORKSPACE);

    expect(answer.kinds.map((entry) => entry.slug)).toEqual([
      ...BUILT_IN_KIND_ORDER,
      "alpha_audit",
      "zeta_review",
    ]);
  });

  it("answers an empty catalog for a workspace with no kinds, rather than inventing the four", async () => {
    const { catalog } = service({ kinds: [] });

    expect(await catalog.kinds(WORKSPACE)).toEqual({ kinds: [] });
  });
});

describe("the tools catalog", () => {
  it("lists every registered slug in the mockup's order, connected where an adapter exists", async () => {
    const { catalog } = service();

    const answer = await catalog.tools(WORKSPACE);

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

  it("draws an enabled tool from its adapter: computed sub-line, health dot and its form", async () => {
    const { catalog } = service();

    const { tools } = await catalog.tools(WORKSPACE);

    expect(tools.find((entry) => entry.slug === "competitor")).toEqual({
      slug: "competitor",
      name: "Competitor tracker",
      glyph: "⌖",
      connected: true,
      subLine: "4 rivals watched · release notes, filings",
      health: { state: "healthy", dot: "ok", detail: "200 · 41ms" },
      configured: true,
      hasCredential: false,
      enable: {
        kind: "form",
        title: "Settings",
        fields: [expect.objectContaining({ name: "windowDays", widget: "text", required: false })],
        values: {},
      },
    });
  });

  it("computes the sub-line: a fifth rival changes the tracker's line", async () => {
    let rivals = 4;
    const { catalog } = service({
      behaviours: { competitor: { counts: () => Promise.resolve({ rivals, kinds: "filings" }) } },
    });
    const line = async () =>
      (await catalog.tools(WORKSPACE)).tools.find((entry) => entry.slug === "competitor")!.subLine;

    expect(await line()).toBe("4 rivals watched · filings");
    rivals = 5;
    expect(await line()).toBe("5 rivals watched · filings");
  });

  it("draws the planned sixth tool idle, with the mockup's line and when it arrives", async () => {
    const { catalog } = service();

    const { tools } = await catalog.tools(WORKSPACE);

    expect(tools.find((entry) => entry.slug === "docs")).toEqual({
      slug: "docs",
      name: "Docs, standards & papers",
      glyph: "§",
      connected: false,
      subLine: "datasheets, RFCs, arXiv — PDF reader with citations",
      health: { state: "not_configured", dot: "idle", detail: "not configured" },
      configured: false,
      hasCredential: false,
      enable: { kind: "planned", release: "v2", issue: 635 },
    });
  });

  it("says nothing about enabling a tool with neither an adapter nor a plan", async () => {
    const { catalog } = service({
      tools: [...SEEDED_TOOLS, { slug: "oracle", displayName: "Oracle" }],
    });

    const oracle = (await catalog.tools(WORKSPACE)).tools.find((entry) => entry.slug === "oracle");

    expect(oracle).toMatchObject({ glyph: null, subLine: null, enable: null, connected: false });
  });

  it("counts the tools that answer — healthy or degraded, never idle or down", async () => {
    const { catalog } = service({
      behaviours: {
        web: { health: () => Promise.resolve({ state: "down", detail: "unreachable" }) },
        code: { health: () => Promise.resolve({ state: "degraded", detail: "slow" }) },
      },
    });

    const answer = await catalog.tools(WORKSPACE);

    expect(answer.connectedCount).toBe(4);
    expect(answer.tools.map((entry) => entry.health.dot)).toEqual([
      "err",
      "ok",
      "warn",
      "ok",
      "ok",
      "idle",
    ]);
  });

  it("draws every tool idle for a workspace that enabled none", async () => {
    const { catalog } = service({ stored: {} });

    const answer = await catalog.tools(WORKSPACE);

    expect(answer.connectedCount).toBe(0);
    expect(answer.tools.every((entry) => entry.health.dot === "idle")).toBe(true);
    expect(answer.tools.every((entry) => !entry.configured)).toBe(true);
  });

  it("hands the health check the workspace, its settings and its opened credential", async () => {
    const health = jest.fn().mockResolvedValue({ state: "healthy", detail: "ok" });
    const { catalog, settings } = service({
      stored: { web: { config: { provider: "brave" }, secret: "BSA-key" } },
      behaviours: { web: { health } },
    });

    const web = (await catalog.tools(WORKSPACE)).tools.find((entry) => entry.slug === "web")!;

    expect(settings.settingsFor).toHaveBeenCalledWith(WORKSPACE, "web");
    expect(health).toHaveBeenCalledWith({ provider: "brave" }, "BSA-key", WORKSPACE);
    expect(web.hasCredential).toBe(true);
    expect(web.enable).toMatchObject({ kind: "form", values: { provider: "brave" } });
    expect(JSON.stringify(web)).not.toContain("BSA-key");
  });

  it("draws a tool whose adapter breaks its promises down, with dashes for counts", async () => {
    const { catalog } = service({
      behaviours: {
        competitor: {
          counts: () => Promise.reject(new Error("boom")),
          health: () => Promise.reject(new Error("boom")),
        },
      },
    });

    const answer = await catalog.tools(WORKSPACE);
    const tracker = answer.tools.find((entry) => entry.slug === "competitor")!;

    expect(tracker.health).toEqual({
      state: "down",
      dot: "err",
      detail: "the tool's health check failed",
    });
    expect(tracker.subLine).toBe("— rivals watched · —");
    expect(answer.tools).toHaveLength(6);
  });

  it("reads a tool whose settings cannot be read as not enabled", async () => {
    const { catalog, settings } = service();
    settings.settingsFor.mockRejectedValueOnce(new Error("pool gone"));

    const answer = await catalog.tools(WORKSPACE);

    expect(answer.tools.filter((entry) => !entry.configured)).toHaveLength(2);
  });
});

describe("enabling a tool", () => {
  it("stores the config apart from the credential and answers the row, now healthy", async () => {
    const { catalog, settings } = service({ stored: {} });

    const row = await catalog.enable(
      WORKSPACE,
      "web",
      { provider: "brave", apiKey: "BSA-key" },
      "user-1",
    );

    expect(settings.store).toHaveBeenCalledWith(WORKSPACE, "web", {
      config: { provider: "brave" },
      secret: "BSA-key",
      userId: "user-1",
    });
    expect(row).toMatchObject({
      slug: "web",
      configured: true,
      hasCredential: true,
      health: { state: "healthy", dot: "ok" },
    });
    expect(JSON.stringify(row)).not.toContain("BSA-key");
  });

  it("keeps the stored credential when the form is saved without one", async () => {
    const { catalog, settings } = service({
      stored: { web: { config: { provider: "brave" }, secret: "BSA-key" } },
    });

    const row = await catalog.enable(WORKSPACE, "web", { provider: "brave" }, "user-1");

    expect(settings.store).toHaveBeenCalledWith(WORKSPACE, "web", {
      config: { provider: "brave" },
      secret: null,
      userId: "user-1",
    });
    expect(row.hasCredential).toBe(true);
  });

  it("enables a tool that needs nothing with an empty form", async () => {
    const { catalog, settings } = service({ stored: {} });

    const row = await catalog.enable(WORKSPACE, "code", {}, "user-1");

    expect(settings.store).toHaveBeenCalledWith(WORKSPACE, "code", {
      config: {},
      secret: null,
      userId: "user-1",
    });
    expect(row.health.dot).toBe("ok");
  });

  it("refuses what the tool's schema refuses, naming the field, and stores nothing", async () => {
    const { catalog, settings } = service({ stored: {} });

    await expect(
      catalog.enable(WORKSPACE, "web", { provider: "altavista" }, "user-1"),
    ).rejects.toMatchObject({
      code: "research_tool_config_invalid",
      details: { tool: "web", fields: { provider: expect.any(Array) as unknown } },
    });
    await expect(catalog.enable(WORKSPACE, "web", {}, "user-1")).rejects.toMatchObject({
      code: "research_tool_config_invalid",
    });
    expect(settings.store).not.toHaveBeenCalled();
  });

  it("answers 404 for a slug the installation does not have", async () => {
    const { catalog, settings } = service();

    await expect(catalog.enable(WORKSPACE, "oracle", {}, "user-1")).rejects.toMatchObject({
      code: "research_tool_not_found",
      details: { tool: "oracle" },
    });
    expect(settings.store).not.toHaveBeenCalled();
  });

  it("answers 501 for the planned tool — there is no adapter to configure", async () => {
    const { catalog, settings } = service();

    await expect(catalog.enable(WORKSPACE, "docs", {}, "user-1")).rejects.toMatchObject({
      code: "research_tool_not_registered",
    });
    expect(settings.store).not.toHaveBeenCalled();
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
