/**
 * The competitor tracker, through the conformance kit (CL.3, #616).
 *
 * Its one operation reads the archive the schedule wrote, so the recording is a changelog watch
 * that has been snapshotted twice — one real change — and the kit holds the answer to the citation
 * contract: a `competitor_diff` source naming the snapshot that carries the diff.
 */

import {
  conformanceContext,
  describeToolConformance,
  type ToolConformance,
} from "../../conformance.fixture";
import { page } from "../web/web.recordings.fixture";
import {
  CHANGELOG_SELECTOR,
  CHANGELOG_URL,
  CHANGELOG_V2,
  MemoryCompetitorStore,
  ORG,
  recordedReader,
  recordedReleases,
  sequentialIds,
  watch,
} from "./competitor.recordings.fixture";
import { CompetitorSnapshotter } from "./competitor.snapshotter";
import { CompetitorResearchTool } from "./competitor.tool";

const T1 = new Date("2026-09-01T06:00:00Z");
const T2 = new Date("2026-09-02T06:00:00Z");

/**
 * The archive after two checks, and the tool over it.
 *
 * @param now - The tool's clock.
 * @returns The store and the tool.
 */
async function archive(
  now: Date,
): Promise<{ store: MemoryCompetitorStore; tool: CompetitorResearchTool }> {
  const store = new MemoryCompetitorStore([
    watch({
      id: "w-changelog",
      sourceKind: "changelog",
      url: CHANGELOG_URL,
      selector: CHANGELOG_SELECTOR,
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

  return { store, tool: new CompetitorResearchTool(store, () => now) };
}

const failing = (failure: Error) =>
  new CompetitorResearchTool({ resolveCompetitor: () => Promise.reject(failure) } as never);

describeToolConformance("competitor", (): ToolConformance => {
  const ready = archive(new Date("2026-09-02T12:00:00Z"));
  const context = { ...conformanceContext({ config: {}, secret: null }), organizationId: ORG };
  const tool = new CompetitorResearchTool(
    {
      summary: async (org: string) => (await ready).store.summary(org),
      resolveCompetitor: async (org: string, rival: string) =>
        (await ready).store.resolveCompetitor(org, rival),
      changes: async (org: string, query: never) => (await ready).store.changes(org, query),
      listWatches: async () => (await ready).store.listWatches(ORG),
    },
    () => new Date("2026-09-02T12:00:00Z"),
  );

  return {
    adapter: tool,
    config: {},
    secret: null,
    operations: {
      query: () => tool.query(context, { op: "changes", rival: "Skylink", windowDays: 90 }),
    },
    failures: {
      network: () =>
        failing(Object.assign(new Error("connect"), { code: "ECONNREFUSED" })).query(context, {
          op: "changes",
          rival: "Skylink",
        }),
      upstream: () =>
        failing(new Error("relation missing")).query(context, { op: "changes", rival: "Skylink" }),
      unsupported: () => tool.query(context, { op: "scrape", rival: "Skylink" }),
    },
    health: {
      healthy: () => tool.healthCheck({}, null, ORG),
      degraded: async () => {
        const { store } = await ready;
        store.watches.set("w-stale", {
          ...watch({ id: "w-stale", sourceKind: "page", url: `${CHANGELOG_URL}/old` }),
          lastSuccessAt: new Date("2026-08-01T00:00:00Z"),
        });
        const answer = await tool.healthCheck({}, null, ORG);
        store.watches.delete("w-stale");
        return answer;
      },
      down: () =>
        new CompetitorResearchTool({
          listWatches: () => Promise.reject(new Error("gone")),
        } as never).healthCheck({}, null, ORG),
    },
  };
});
