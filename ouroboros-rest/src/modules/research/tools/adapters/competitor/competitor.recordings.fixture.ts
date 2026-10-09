/**
 * Recordings the competitor tracker's suites run on — a rival's changelog in two versions, its
 * feeds, its GitHub releases, a JS-rendered page — and an in-memory registry that behaves as V112
 * and V117 do (the chain, the archive's hash, the summary view), so every suite runs with no
 * network and no database.
 */

import { createHash } from "node:crypto";

import type { CompetitorSourceKind } from "../../../../db/schema";
import { COMPETITOR_SOURCE_KINDS, SOURCE_KIND_LABELS } from "../../../competitors/competitor.kinds";
import type {
  ChangeQuery,
  ChangeRow,
  CheckRecord,
  ClaimedWatch,
  CompetitorRow,
  LatestSnapshot,
  NewSnapshot,
  TrackerSummary,
  WatchRow,
} from "../../../competitors/competitors.repository";
import { PageFetcher } from "../web/web.fetcher";
import { ManualClock, RecordedSite, page, type Recorded } from "../web/web.recordings.fixture";
import type { GithubRelease } from "./competitor.github";
import type { ReleasesReader } from "./competitor.snapshotter";

/** The rival's site. */
export const RIVAL_SITE = "https://skylink.example.com";

/** Its changelog — scoped to `main .entries`. */
export const CHANGELOG_URL = `${RIVAL_SITE}/changelog`;

/** Its RSS feed. */
export const RSS_URL = `${RIVAL_SITE}/releases.rss`;

/** Its Atom feed. */
export const ATOM_URL = `${RIVAL_SITE}/news.atom`;

/** A page that only renders with JavaScript. */
export const SPA_URL = `${RIVAL_SITE}/app/roadmap`;

/** A page robots.txt forbids. */
export const DEALERS_URL = `${RIVAL_SITE}/dealers/pricing`;

/** Its GitHub repository. */
export const GITHUB_URL = "https://github.com/skylink/firmware";

/** The selector the changelog watch carries. */
export const CHANGELOG_SELECTOR = "main .entries";

/**
 * The changelog page.
 *
 * @param entries - The release entries, newest first.
 * @param footerDate - The footer's "last updated" — outside the selector, so it never registers.
 * @returns The HTML.
 */
export function changelogHtml(entries: readonly string[], footerDate: string): string {
  return `<!doctype html><html><head><title>Skylink changelog</title><script>track()</script></head>
<body>
  <nav class="site-nav"><a href="/">Home</a> <a href="/changelog">Changelog</a></nav>
  <div class="banner">Spring sale — 20% off docks until ${footerDate}</div>
  <main>
    <h1>Changelog</h1>
    <section class="entries">
${entries.map((entry) => `      <article class="entry"><p>${entry}</p></article>`).join("\n")}
    </section>
  </main>
  <footer>Last updated ${footerDate}</footer>
</body></html>`;
}

/** The changelog before 6.2. */
export const CHANGELOG_V1 = changelogHtml(
  ["6.1 — Beacon-guided approach for the S4 dock.", "6.0 — Fleet portal launches."],
  "2026-09-01",
);

/** The same entries, a new footer date and banner — no change inside the selector. */
export const CHANGELOG_V1_REDATED = changelogHtml(
  ["6.1 — Beacon-guided approach for the S4 dock.", "6.0 — Fleet portal launches."],
  "2026-09-08",
);

/** The changelog after 6.2 — one real change. */
export const CHANGELOG_V2 = changelogHtml(
  [
    "6.2 — Gust-adaptive final approach: wind feedforward is applied over the last 2 m of descent.",
    "6.1 — Beacon-guided approach for the S4 dock.",
    "6.0 — Fleet portal launches.",
  ],
  "2026-09-15",
);

/** An application shell: no text until its script runs. */
export const SPA_HTML = `<!doctype html><html><head><title>Roadmap</title>
<script src="/static/runtime.js"></script><script src="/static/app.js"></script></head>
<body><noscript>You need to enable JavaScript to run this app.</noscript><div id="root"></div></body></html>`;

/**
 * An RSS 2.0 feed.
 *
 * @param titles - Item titles, newest first.
 * @returns The XML.
 */
export function rssXml(titles: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
  <title>Skylink releases</title><link>${RIVAL_SITE}</link>
${titles
  .map(
    (title, index) => `  <item>
    <title>${title}</title>
    <link>${RIVAL_SITE}/releases/${String(titles.length - index)}</link>
    <pubDate>Tue, 0${String(index + 1)} Sep 2026 00:00:00 GMT</pubDate>
    <description><![CDATA[<p>${title} — <b>details</b> inside.</p>]]></description>
  </item>`,
  )
  .join("\n")}
</channel></rss>`;
}

/** An Atom feed. */
export const ATOM_XML = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Skylink news</title>
  <entry>
    <title>Skylink opens a Rotterdam depot</title>
    <link rel="alternate" href="${RIVAL_SITE}/news/rotterdam"/>
    <updated>2026-09-10T00:00:00Z</updated>
    <summary>Same-day dock swaps in the Benelux.</summary>
  </entry>
</feed>`;

/** GitHub's answer for the firmware repository, newest first. */
export const GITHUB_RELEASES: readonly GithubRelease[] = [
  {
    tag_name: "v6.2.0",
    name: "Gust-adaptive final approach",
    published_at: "2026-09-15T00:00:00Z",
    prerelease: false,
    draft: false,
    body: "Wind feedforward over the last 2 m.",
    html_url: "https://github.com/skylink/firmware/releases/tag/v6.2.0",
  },
  {
    tag_name: "v6.3.0-beta.1",
    name: "v6.3.0-beta.1",
    published_at: "2026-09-20T00:00:00Z",
    prerelease: true,
    draft: false,
    body: "Visual approach (beta).",
    html_url: "https://github.com/skylink/firmware/releases/tag/v6.3.0-beta.1",
  },
  { tag_name: "v7.0.0", name: "secret draft", draft: true, body: "not yet" },
];

/** The rival's site, as recorded: changelog v1, feeds, the shell, and a robots.txt. */
export function rivalSitePages(): Map<string, Recorded> {
  return new Map<string, Recorded>([
    [
      `${RIVAL_SITE}/robots.txt`,
      page(200, "User-agent: *\nDisallow: /dealers/\n", { "content-type": "text/plain" }),
    ],
    [CHANGELOG_URL, page(200, CHANGELOG_V1, { "content-type": "text/html; charset=utf-8" })],
    [
      RSS_URL,
      page(200, rssXml(["6.1 — Beacon-guided approach"]), {
        "content-type": "application/rss+xml",
      }),
    ],
    [ATOM_URL, page(200, ATOM_XML, { "content-type": "application/atom+xml" })],
    [SPA_URL, page(200, SPA_HTML, { "content-type": "text/html" })],
    [
      `${RIVAL_SITE}/not-a-feed`,
      page(200, "<html><body><p>hello</p></body></html>", { "content-type": "text/html" }),
    ],
  ]);
}

/** A page reader over the recorded site, through #615's real fetch pipeline. */
export function recordedReader(pages = rivalSitePages()): {
  fetcher: PageFetcher;
  site: RecordedSite;
  pages: Map<string, Recorded>;
} {
  const clock = new ManualClock();
  const site = new RecordedSite(pages, clock);
  const fetcher = new PageFetcher(
    site,
    { timeoutMs: 15_000, maxBytes: 5_242_880, maxRedirects: 5, hostIntervalMs: 0 },
    clock,
  );
  return { fetcher, site, pages };
}

/**
 * Recorded GitHub releases.
 *
 * @param answer - What the API answers, or an error to throw.
 * @returns The reader, and every repository it was asked about.
 */
export function recordedReleases(answer: readonly GithubRelease[] | Error = GITHUB_RELEASES): {
  reader: ReleasesReader;
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    reader: (organizationId, repository) => {
      asked.push(`${organizationId}:${repository.owner}/${repository.repo}`);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
}

/** The workspace the recordings belong to. */
export const ORG = "org-skylink-watchers";

/** The rival. */
export const SKYLINK: CompetitorRow = {
  id: "c0000000-0000-4000-8000-000000000001",
  organizationId: ORG,
  name: "Skylink",
  meta: { site: RIVAL_SITE, aliases: ["Skylink Robotics"] },
  createdAt: new Date("2026-08-01T00:00:00Z"),
};

/**
 * A watch with defaults.
 *
 * @param fields - What differs.
 * @returns The claimed watch.
 */
export function watch(
  fields: Partial<ClaimedWatch> & { id: string; sourceKind: CompetitorSourceKind; url: string },
): ClaimedWatch {
  return {
    competitorId: SKYLINK.id,
    selector: null,
    cadence: "daily",
    enabled: true,
    renderRequired: false,
    lastSnapshotAt: null,
    nextCheckAt: null,
    lastCheckedAt: null,
    lastSuccessAt: null,
    lastOutcome: null,
    lastNote: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    organizationId: ORG,
    competitorName: SKYLINK.name,
    ...fields,
  };
}

interface StoredSnapshot extends NewSnapshot {
  readonly content: string;
}

/**
 * The registry in memory — V112's chain rules and V117's archive hash enforced, so a suite that
 * passes here would pass against the database.
 */
export class MemoryCompetitorStore {
  readonly rivals: CompetitorRow[] = [SKYLINK];
  readonly watches = new Map<string, ClaimedWatch>();
  readonly snapshots: StoredSnapshot[] = [];
  readonly checks: { watchId: string; check: CheckRecord }[] = [];

  /** @param watches - The watches it starts with. */
  constructor(watches: readonly ClaimedWatch[] = []) {
    for (const entry of watches) this.watches.set(entry.id, entry);
  }

  latestSnapshot(watchId: string): Promise<LatestSnapshot | undefined> {
    const latest = this.snapshots
      .filter((snapshot) => snapshot.watchId === watchId)
      .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())[0];

    return Promise.resolve(
      latest === undefined
        ? undefined
        : {
            id: latest.id,
            contentHash: latest.contentHash,
            takenAt: latest.takenAt,
            content: latest.content,
          },
    );
  }

  async insertSnapshot(snapshot: NewSnapshot): Promise<void> {
    const previous = await this.latestSnapshot(snapshot.watchId);
    const hash = `sha256:${createHash("sha256").update(snapshot.content, "utf8").digest("hex")}`;

    if (hash !== snapshot.contentHash) throw new Error("competitor_snapshot_contents_hash");
    if ((previous?.id ?? null) !== snapshot.previousId)
      throw new Error("competitor_snapshots_previous_fk");
    if (previous !== undefined && snapshot.takenAt <= previous.takenAt)
      throw new Error("competitor_snapshots_chain");
    if (
      previous !== undefined &&
      (previous.contentHash !== snapshot.contentHash) !== (snapshot.diff !== null)
    ) {
      throw new Error("competitor_snapshots_chain");
    }
    if (snapshot.diff !== null && snapshot.diff.trim() === "")
      throw new Error("competitor_snapshots_diff_bounded");

    this.snapshots.push({ ...snapshot });
  }

  recordCheck(watchId: string, check: CheckRecord): Promise<void> {
    this.checks.push({ watchId, check });
    const current = this.watches.get(watchId);
    if (current !== undefined) {
      this.watches.set(watchId, {
        ...current,
        lastCheckedAt: check.checkedAt,
        lastOutcome: check.outcome,
        lastNote: check.note,
        nextCheckAt: check.nextCheckAt,
        lastSuccessAt: check.succeeded ? check.checkedAt : current.lastSuccessAt,
        renderRequired: current.renderRequired || check.renderRequired,
      });
    }
    return Promise.resolve();
  }

  summary(organizationId: string): Promise<TrackerSummary> {
    const watched = [...this.watches.values()].filter(
      (entry) => entry.organizationId === organizationId && entry.enabled && !entry.renderRequired,
    );
    const rivals = new Set(watched.map((entry) => entry.competitorId)).size;
    const kinds = COMPETITOR_SOURCE_KINDS.filter((kind) =>
      watched.some((entry) => entry.sourceKind === kind),
    );

    return Promise.resolve({
      rivalsWatched: rivals,
      watchesEnabled: watched.length,
      sourceKinds: kinds,
      subLine:
        rivals === 0
          ? "0 rivals watched"
          : `${String(rivals)} ${rivals === 1 ? "rival" : "rivals"} watched · ${kinds.map((kind) => SOURCE_KIND_LABELS[kind]).join(", ")}`,
    });
  }

  resolveCompetitor(organizationId: string, rival: string): Promise<CompetitorRow | undefined> {
    const wanted = rival.trim().toLowerCase();
    return Promise.resolve(
      this.rivals.find(
        (candidate) =>
          candidate.organizationId === organizationId &&
          (candidate.id === rival ||
            candidate.name.toLowerCase() === wanted ||
            (Array.isArray(candidate.meta.aliases) &&
              candidate.meta.aliases.some(
                (alias) => typeof alias === "string" && alias.toLowerCase() === wanted,
              ))),
      ),
    );
  }

  changes(organizationId: string, query: ChangeQuery): Promise<ChangeRow[]> {
    const rows = this.snapshots
      .filter((snapshot) => snapshot.diff !== null)
      .map((snapshot) => ({ snapshot, watch: this.watches.get(snapshot.watchId) }))
      .filter(
        (entry): entry is { snapshot: StoredSnapshot; watch: ClaimedWatch } =>
          entry.watch !== undefined && entry.watch.organizationId === organizationId,
      )
      .filter(
        ({ watch: entry }) =>
          query.competitorId === undefined || entry.competitorId === query.competitorId,
      )
      .filter(
        ({ watch: entry }) =>
          query.sourceKind === undefined || entry.sourceKind === query.sourceKind,
      )
      .filter(({ snapshot }) => query.since === undefined || snapshot.takenAt >= query.since)
      .filter(({ snapshot }) => query.before === undefined || snapshot.takenAt < query.before)
      .sort((a, b) => b.snapshot.takenAt.getTime() - a.snapshot.takenAt.getTime())
      .slice(0, query.limit)
      .map(({ snapshot, watch: entry }) => ({
        snapshotId: snapshot.id,
        previousSnapshotId: snapshot.previousId,
        watchId: entry.id,
        competitorId: entry.competitorId,
        competitorName: entry.competitorName,
        sourceKind: entry.sourceKind,
        url: entry.url,
        selector: entry.selector,
        contentHash: snapshot.contentHash,
        diff: snapshot.diff ?? "",
        takenAt: snapshot.takenAt,
      }));

    return Promise.resolve(rows);
  }

  listWatches(organizationId: string): Promise<WatchRow[]> {
    return Promise.resolve(
      [...this.watches.values()].filter((entry) => entry.organizationId === organizationId),
    );
  }

  /** The watch as it stands now. */
  current(watchId: string): ClaimedWatch {
    const entry = this.watches.get(watchId);
    if (entry === undefined) throw new Error(`no watch ${watchId}`);
    return entry;
  }
}

/** Sequential snapshot ids, so assertions can name them. */
export function sequentialIds(prefix = "5a000000-0000-4000-8000-"): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}${String(next).padStart(12, "0")}`;
  };
}
