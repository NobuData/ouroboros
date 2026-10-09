import { conformanceContext } from "../../conformance.fixture";
import { sourceRecordViolations } from "../../research-tool.citations";
import { ResearchToolError } from "../../research-tool.errors";
import { renderSubLine } from "../../research-tool.health";
import { page } from "../web/web.recordings.fixture";
import {
  CHANGELOG_SELECTOR,
  CHANGELOG_URL,
  CHANGELOG_V2,
  GITHUB_URL,
  MemoryCompetitorStore,
  ORG,
  SKYLINK,
  recordedReader,
  recordedReleases,
  sequentialIds,
  watch,
} from "./competitor.recordings.fixture";
import { CompetitorSnapshotter } from "./competitor.snapshotter";
import { CompetitorResearchTool, diffExcerpt } from "./competitor.tool";

const T1 = new Date("2026-09-01T06:00:00Z");
const T2 = new Date("2026-09-02T06:00:00Z");
const NOW = new Date("2026-09-03T06:00:00Z");

/** A registry with one changelog watch that has archived one change. */
async function archivedChange() {
  const store = new MemoryCompetitorStore([
    watch({
      id: "w-changelog",
      sourceKind: "changelog",
      url: CHANGELOG_URL,
      selector: CHANGELOG_SELECTOR,
    }),
    watch({ id: "w-gh", sourceKind: "github_releases", url: GITHUB_URL }),
    watch({
      id: "w-filings",
      sourceKind: "filings",
      url: "https://skylink.example.com/investors",
      cadence: "weekly",
    }),
  ]);
  const reader = recordedReader();
  const snapshotter = new CompetitorSnapshotter({
    store,
    pages: reader.fetcher,
    releases: recordedReleases().reader,
    random: () => 0.5,
    newId: sequentialIds(),
  });

  await snapshotter.check(store.current("w-changelog"), T1);
  reader.pages.set(CHANGELOG_URL, page(200, CHANGELOG_V2, { "content-type": "text/html" }));
  await snapshotter.check(store.current("w-changelog"), T2);
  await snapshotter.check(store.current("w-gh"), T2);

  return { store, tool: new CompetitorResearchTool(store, () => NOW) };
}

const context = { ...conformanceContext({ config: {}, secret: null }), organizationId: ORG };

describe("the competitor tracker tool", () => {
  it("is mockup 22's second row, its sub-line computed from the registry", async () => {
    const { store, tool } = await archivedChange();

    expect(tool.displayMeta()).toEqual({
      name: "Competitor tracker",
      glyph: "⌖",
      subLine: "{watched} · {kinds}",
    });
    expect(tool.capabilities()).toEqual({ search: false, fetch: false, query: true, watch: true });
    expect(renderSubLine(tool.displayMeta().subLine, await tool.counts(ORG))).toBe(
      "1 rival watched · changelogs, GitHub releases, filings",
    );

    // Remove the rival's watches: the card says so — the sub-line is not a constant.
    store.watches.clear();
    expect(renderSubLine(tool.displayMeta().subLine, await tool.counts(ORG))).toBe(
      "0 rivals watched · no sources yet",
    );
  });

  it("answers changes(rival, window) with each change cited as a competitor_diff source", async () => {
    const { tool } = await archivedChange();

    const result = await tool.query(
      { ...context, organizationId: ORG },
      { op: "changes", rival: "skylink", windowDays: 90 },
    );

    expect(result.sources).toHaveLength(1);
    const [source] = result.sources;
    expect(source).toMatchObject({
      kind: "competitor_diff",
      locator: CHANGELOG_URL,
      title: "Skylink · changelogs · changed 2026-09-02",
      retrievedAt: T2.toISOString(),
      excerpt:
        "+ 6.2 — Gust-adaptive final approach: wind feedforward is applied over the last 2 m of descent.",
    });
    expect(source.snapshotId).toBeDefined();
    expect(sourceRecordViolations(source)).toEqual([]);
    expect(result.payload).toMatchObject({
      op: "changes",
      rival: { id: SKYLINK.id, name: "Skylink" },
      window: { until: NOW.toISOString() },
    });
  });

  it("looks back the workspace's configured window when the call names none", async () => {
    const { tool } = await archivedChange();

    const result = await tool.query(
      { ...context, organizationId: ORG, config: { windowDays: "30" } },
      { op: "changes", rival: "Skylink" },
    );

    expect((result.payload as { window: { since: string } }).window.since).toBe(
      new Date(NOW.getTime() - 30 * 86_400_000).toISOString(),
    );
  });

  it("answers latest(rival, kind) with the most recent change, found by an alias", async () => {
    const { tool } = await archivedChange();

    const result = await tool.query(
      { ...context, organizationId: ORG },
      {
        op: "latest",
        rival: "Skylink Robotics",
        sourceKind: "changelog",
      },
    );

    expect(result.sources).toHaveLength(1);
    expect((result.payload as { changes: unknown[] }).changes).toHaveLength(1);
  });

  it("answers an empty window with a null payload and nothing to cite", async () => {
    const { tool } = await archivedChange();

    const result = await tool.query(
      { ...context, organizationId: ORG },
      { op: "latest", rival: "Skylink", sourceKind: "rss" },
    );

    expect(result).toEqual({ payload: null, sources: [], usage: { tokens: 0 } });
  });

  it("refuses an unknown op, a rival it does not watch, and a bad window — classified", async () => {
    const { tool } = await archivedChange();
    const ask = (input: Record<string, unknown>) =>
      tool.query({ ...context, organizationId: ORG }, input);

    await expect(ask({ op: "scrape", rival: "Skylink" })).rejects.toBeInstanceOf(ResearchToolError);
    await expect(ask({ op: "changes", rival: "Nobody" })).rejects.toMatchObject({
      errorClass: "unsupported",
    });
    await expect(ask({ op: "changes", rival: "Skylink", windowDays: 0 })).rejects.toMatchObject({
      errorClass: "unsupported",
    });
    await expect(ask({ op: "latest", rival: "Skylink" })).rejects.toMatchObject({
      errorClass: "unsupported",
    });
  });

  it("classifies an archive it cannot reach as network, and any other failure as upstream", async () => {
    const unreachable = new CompetitorResearchTool({
      resolveCompetitor: () =>
        Promise.reject(Object.assign(new Error("x"), { code: "ECONNREFUSED" })),
    } as never);
    const broken = new CompetitorResearchTool({
      resolveCompetitor: () => Promise.reject(new Error("syntax")),
    } as never);

    await expect(
      unreachable.query(context, { op: "changes", rival: "Skylink" }),
    ).rejects.toMatchObject({
      errorClass: "network",
    });
    await expect(broken.query(context, { op: "changes", rival: "Skylink" })).rejects.toMatchObject({
      errorClass: "upstream",
    });
  });

  describe("health", () => {
    it("is idle with no configuration, and with nothing readable to watch", async () => {
      const { store, tool } = await archivedChange();

      expect((await tool.healthCheck(null, null, ORG)).state).toBe("not_configured");
      store.watches.clear();
      expect(await tool.healthCheck({}, null, ORG)).toEqual({
        state: "not_configured",
        detail: "no rivals watched yet",
      });
    });

    it("is healthy while every readable watch was read within two cadences — filings not counted", async () => {
      const { tool } = await archivedChange();

      expect(await tool.healthCheck({}, null, ORG)).toEqual({
        state: "healthy",
        detail: "2 watches fresh · newest read 24h ago",
      });
    });

    it("is degraded when some watches are stale and down when all are", async () => {
      const { store } = await archivedChange();
      const later = (days: number) =>
        new CompetitorResearchTool(store, () => new Date(T2.getTime() + days * 86_400_000));

      store.watches.set("w-gh", { ...store.current("w-gh"), cadence: "weekly" });
      expect((await later(3).healthCheck({}, null, ORG)).state).toBe("degraded");
      expect(await later(30).healthCheck({}, null, ORG)).toMatchObject({
        state: "down",
        detail: "2 of 2 watches stale · newest read 30d ago",
      });
    });
  });
});

describe("a diff's excerpt", () => {
  it("keeps whole lines within 4 KiB", () => {
    const diff = Array.from(
      { length: 400 },
      (_, index) => `+ line ${String(index)} of a long changelog`,
    ).join("\n");
    const excerpt = diffExcerpt(diff);

    expect(Buffer.byteLength(excerpt)).toBeLessThanOrEqual(4096);
    expect(excerpt.endsWith("\n…")).toBe(true);
    expect(excerpt.split("\n")[0]).toBe("+ line 0 of a long changelog");
  });
});
