import { GithubApiError } from "../../../../github/github.errors";
import {
  CADENCE_MS,
  FILINGS_NOTE,
  RENDER_REQUIRED_NOTE,
} from "../../../competitors/competitor.kinds";
import { page } from "../web/web.recordings.fixture";
import {
  ATOM_URL,
  CHANGELOG_SELECTOR,
  CHANGELOG_URL,
  CHANGELOG_V1_REDATED,
  CHANGELOG_V2,
  DEALERS_URL,
  GITHUB_URL,
  MemoryCompetitorStore,
  ORG,
  RSS_URL,
  SPA_URL,
  recordedReader,
  recordedReleases,
  rssXml,
  sequentialIds,
  watch,
} from "./competitor.recordings.fixture";
import {
  CONTENT_REF_PREFIX,
  CompetitorSnapshotter,
  FAILURE_RETRY_MS,
} from "./competitor.snapshotter";

const T1 = new Date("2026-09-01T06:00:00Z");
const T2 = new Date("2026-09-02T06:00:00Z");
const T3 = new Date("2026-09-03T06:00:00Z");

/** A snapshotter over the recorded site, with jitter pinned to the middle of its window. */
function build(
  watches = [
    watch({
      id: "w-changelog",
      sourceKind: "changelog",
      url: CHANGELOG_URL,
      selector: CHANGELOG_SELECTOR,
    }),
  ],
) {
  const store = new MemoryCompetitorStore(watches);
  const reader = recordedReader();
  const releases = recordedReleases();
  const snapshotter = new CompetitorSnapshotter({
    store,
    pages: reader.fetcher,
    releases: releases.reader,
    random: () => 0.5,
    newId: sequentialIds(),
  });
  return { store, reader, releases, snapshotter };
}

describe("the competitor snapshotter", () => {
  it("snapshots a changelog twice and archives exactly one citable diff for its single change", async () => {
    const { store, reader, snapshotter } = build();

    const first = await snapshotter.check(store.current("w-changelog"), T1);
    reader.pages.set(CHANGELOG_URL, page(200, CHANGELOG_V2, { "content-type": "text/html" }));
    const second = await snapshotter.check(store.current("w-changelog"), T2);

    expect(first).toMatchObject({ outcome: "first", diff: null });
    expect(second.outcome).toBe("changed");
    expect(second.diff).toBe(
      "+ 6.2 — Gust-adaptive final approach: wind feedforward is applied over the last 2 m of descent.",
    );
    expect(store.snapshots).toHaveLength(2);
    expect(store.snapshots.filter((snapshot) => snapshot.diff !== null)).toHaveLength(1);
    expect(store.snapshots[1]).toMatchObject({
      previousId: store.snapshots[0].id,
      contentRef: `${CONTENT_REF_PREFIX}${store.snapshots[1].id}`,
      takenAt: T2,
    });
    // The archive is the scoped region: no navigation, banner or footer.
    expect(store.snapshots[1].content).not.toMatch(/Home|sale|Last updated/);
  });

  it("writes no snapshot and no diff when the content is unchanged", async () => {
    const { store, snapshotter } = build();

    await snapshotter.check(store.current("w-changelog"), T1);
    const again = await snapshotter.check(store.current("w-changelog"), T2);

    expect(again).toMatchObject({ outcome: "unchanged", diff: null, snapshotId: null });
    expect(store.snapshots).toHaveLength(1);
    expect(store.current("w-changelog").lastSuccessAt).toEqual(T2);
  });

  it("scopes the diff to the selector — a new footer date and banner do not register", async () => {
    const { store, reader, snapshotter } = build();

    await snapshotter.check(store.current("w-changelog"), T1);
    reader.pages.set(
      CHANGELOG_URL,
      page(200, CHANGELOG_V1_REDATED, { "content-type": "text/html" }),
    );
    const redated = await snapshotter.check(store.current("w-changelog"), T2);

    expect(redated.outcome).toBe("unchanged");
    expect(store.snapshots).toHaveLength(1);
  });

  it("without a selector diffs the main content, which leaves page furniture out", async () => {
    const { store, reader, snapshotter } = build([
      watch({ id: "w-page", sourceKind: "page", url: CHANGELOG_URL }),
    ]);

    await snapshotter.check(store.current("w-page"), T1);
    reader.pages.set(
      CHANGELOG_URL,
      page(200, CHANGELOG_V1_REDATED, { "content-type": "text/html" }),
    );
    expect((await snapshotter.check(store.current("w-page"), T2)).outcome).toBe("unchanged");
  });

  it("reads an RSS feed and diffs a new item", async () => {
    const { store, reader, snapshotter } = build([
      watch({ id: "w-rss", sourceKind: "rss", url: RSS_URL }),
    ]);

    expect((await snapshotter.check(store.current("w-rss"), T1)).outcome).toBe("first");
    reader.pages.set(
      RSS_URL,
      page(200, rssXml(["6.2 — Gust-adaptive final approach", "6.1 — Beacon-guided approach"]), {
        "content-type": "application/rss+xml",
      }),
    );
    const changed = await snapshotter.check(store.current("w-rss"), T2);

    expect(changed.outcome).toBe("changed");
    expect(changed.diff).toContain("+ 6.2 — Gust-adaptive final approach");
  });

  it("reads an Atom feed", async () => {
    const { store, snapshotter } = build([
      watch({ id: "w-atom", sourceKind: "rss", url: ATOM_URL }),
    ]);

    await snapshotter.check(store.current("w-atom"), T1);

    expect(store.snapshots[0].content).toContain("Skylink opens a Rotterdam depot");
    expect(store.snapshots[0].content).toContain(`${"https://skylink.example.com"}/news/rotterdam`);
  });

  it("refuses a page that is not a feed, honestly", async () => {
    const { store, snapshotter } = build([
      watch({ id: "w-feed", sourceKind: "rss", url: "https://skylink.example.com/not-a-feed" }),
    ]);

    expect(await snapshotter.check(store.current("w-feed"), T1)).toMatchObject({
      outcome: "failed",
      note: "the URL did not answer an RSS or Atom feed",
    });
  });

  it("reads GitHub releases with the workspace's token — drafts never, pre-releases marked", async () => {
    const { store, releases, snapshotter } = build([
      watch({ id: "w-gh", sourceKind: "github_releases", url: GITHUB_URL }),
    ]);

    expect((await snapshotter.check(store.current("w-gh"), T1)).outcome).toBe("first");

    expect(releases.asked).toEqual([`${ORG}:skylink/firmware`]);
    expect(store.snapshots[0].content).toContain("v6.2.0 — Gust-adaptive final approach");
    expect(store.snapshots[0].content).toContain("v6.3.0-beta.1 (pre-release)");
    expect(store.snapshots[0].content).not.toContain("secret draft");
  });

  it("says a GitHub watch needs the workspace's token rather than failing silently", async () => {
    const store = new MemoryCompetitorStore([
      watch({ id: "w-gh", sourceKind: "github_releases", url: GITHUB_URL }),
    ]);
    const snapshotter = new CompetitorSnapshotter({
      store,
      pages: recordedReader().fetcher,
      releases: recordedReleases(new GithubApiError("not_configured", "no token")).reader,
      random: () => 0.5,
    });

    const result = await snapshotter.check(store.current("w-gh"), T1);

    expect(result.outcome).toBe("failed");
    expect(result.note).toContain("GitHub token");
    expect(store.snapshots).toHaveLength(0);
  });

  it("marks a JS-rendered page render_required with its honest note — never an empty snapshot", async () => {
    const { store, snapshotter } = build([
      watch({ id: "w-spa", sourceKind: "page", url: SPA_URL, selector: ".roadmap" }),
    ]);

    const result = await snapshotter.check(store.current("w-spa"), T1);

    expect(result).toMatchObject({
      outcome: "render_required",
      note: RENDER_REQUIRED_NOTE,
      snapshotId: null,
    });
    expect(store.current("w-spa")).toMatchObject({
      renderRequired: true,
      lastNote: RENDER_REQUIRED_NOTE,
    });
    expect(store.snapshots).toHaveLength(0);
  });

  it("says a selector matched nothing on an ordinary page, rather than archiving nothing", async () => {
    const { store, snapshotter } = build([
      watch({
        id: "w-miss",
        sourceKind: "changelog",
        url: CHANGELOG_URL,
        selector: ".no-such-region",
      }),
    ]);

    expect(await snapshotter.check(store.current("w-miss"), T1)).toMatchObject({
      outcome: "failed",
      note: "the selector .no-such-region matched nothing on the page",
    });
    expect(store.current("w-miss").renderRequired).toBe(false);
  });

  it("records a robots denial on the watch with the rule, and reads nothing", async () => {
    const { store, reader, snapshotter } = build([
      watch({ id: "w-dealers", sourceKind: "page", url: DEALERS_URL }),
    ]);

    const result = await snapshotter.check(store.current("w-dealers"), T1);

    expect(result.outcome).toBe("robots_denied");
    expect(result.note).toContain("Disallow: /dealers/");
    expect(reader.site.urls()).not.toContain(DEALERS_URL);
  });

  it("keeps filings registered but unread, with the v2 note, and touches no network", async () => {
    const { store, reader, snapshotter } = build([
      watch({
        id: "w-filings",
        sourceKind: "filings",
        url: "https://novum.example.io/investors",
        cadence: "weekly",
      }),
    ]);

    expect(await snapshotter.check(store.current("w-filings"), T1)).toMatchObject({
      outcome: "unsupported",
      note: FILINGS_NOTE,
    });
    expect(reader.site.urls()).toEqual([]);
  });

  it("schedules the next check at the cadence with jitter, and a failure sooner", async () => {
    const low = new CompetitorSnapshotter({
      store: new MemoryCompetitorStore([
        watch({ id: "w", sourceKind: "changelog", url: CHANGELOG_URL }),
      ]),
      pages: recordedReader().fetcher,
      releases: recordedReleases().reader,
      random: () => 0,
    });
    const high = new CompetitorSnapshotter({
      store: new MemoryCompetitorStore([
        watch({ id: "w", sourceKind: "changelog", url: CHANGELOG_URL }),
      ]),
      pages: recordedReader().fetcher,
      releases: recordedReleases().reader,
      random: () => 0.999999,
    });
    const daily = CADENCE_MS.daily;

    const early = await low.check(
      watch({ id: "w", sourceKind: "changelog", url: CHANGELOG_URL }),
      T1,
    );
    const late = await high.check(
      watch({ id: "w", sourceKind: "changelog", url: CHANGELOG_URL }),
      T1,
    );
    const failed = await low.check(
      watch({ id: "w", sourceKind: "changelog", url: "https://down.example.test/changelog" }),
      T3,
    );

    expect(early.nextCheckAt.getTime() - T1.getTime()).toBe(daily * 0.75);
    expect(late.nextCheckAt.getTime() - T1.getTime()).toBeLessThanOrEqual(daily * 1.25);
    expect(late.nextCheckAt.getTime() - T1.getTime()).toBeGreaterThan(daily * 1.24);
    expect(failed.outcome).toBe("failed");
    expect(failed.nextCheckAt.getTime() - T3.getTime()).toBe(FAILURE_RETRY_MS * 0.75);
  });

  it("diffs against a seed's snapshot whose text was never archived, saying so", async () => {
    const { store, snapshotter } = build();
    store.snapshots.push({
      id: "seed-snapshot",
      watchId: "w-changelog",
      previousId: null,
      contentHash: "sha256:" + "0".repeat(64),
      contentRef: "archive://competitor/skylink/changelog/6.0.html",
      diff: null,
      takenAt: new Date("2026-08-20T00:00:00Z"),
      content: null as unknown as string,
    });

    const result = await snapshotter.check(store.current("w-changelog"), T1);

    expect(result.outcome).toBe("changed");
    expect(result.diff).toContain("previous snapshot's text was not archived");
    expect(result.diff).toContain("+ 6.1 — Beacon-guided approach for the S4 dock.");
  });

  it("keeps the chain ordered when the clock has not moved past the previous snapshot", async () => {
    const { store, reader, snapshotter } = build();

    await snapshotter.check(store.current("w-changelog"), T2);
    reader.pages.set(CHANGELOG_URL, page(200, CHANGELOG_V2, { "content-type": "text/html" }));
    await snapshotter.check(store.current("w-changelog"), T1);

    expect(store.snapshots[1].takenAt.getTime()).toBe(T2.getTime() + 1);
  });
});
