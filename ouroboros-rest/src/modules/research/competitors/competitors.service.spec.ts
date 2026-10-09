import { ConflictError, InvalidRequestError, NotFoundError } from "../../errors/error.envelope";
import type { CompetitorsRepository, CompetitorRow, WatchRow } from "./competitors.repository";
import { COMPETITOR_ERRORS, MAX_WATCHES_PER_COMPETITOR } from "./competitors.errors";
import { CompetitorsService, metaOf, validateWatch } from "./competitors.service";

const ORG = "org-acme";
const RIVAL = "5eed0094-0000-4000-8000-000000000001";
const WATCH = "5eed0094-0000-4000-8000-000000000011";
const AT = new Date("2026-09-01T06:00:00Z");

const rival: CompetitorRow = {
  id: RIVAL,
  organizationId: ORG,
  name: "Skylink",
  meta: { site: "https://skylink.example.com" },
  createdAt: AT,
};
const watch: WatchRow = {
  id: WATCH,
  competitorId: RIVAL,
  sourceKind: "changelog",
  url: "https://skylink.example.com/changelog",
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
  createdAt: AT,
};

/** A pg error naming a constraint. */
const violation = (constraint: string) =>
  Object.assign(new Error(constraint), { code: "23505", constraint });

function build(overrides: Partial<Record<keyof CompetitorsRepository, jest.Mock>> = {}) {
  const repository = {
    listCompetitors: jest.fn().mockResolvedValue([rival]),
    listWatches: jest.fn().mockResolvedValue([watch]),
    summary: jest.fn().mockResolvedValue({
      rivalsWatched: 1,
      watchesEnabled: 1,
      sourceKinds: ["changelog"],
      subLine: "1 rival watched · changelogs",
    }),
    findCompetitor: jest.fn().mockResolvedValue(rival),
    findWatch: jest.fn().mockResolvedValue(watch),
    createCompetitor: jest.fn().mockResolvedValue(rival),
    updateCompetitor: jest.fn().mockResolvedValue(rival),
    deleteCompetitor: jest.fn().mockResolvedValue(true),
    countWatches: jest.fn().mockResolvedValue(0),
    createWatch: jest.fn().mockResolvedValue(watch),
    updateWatch: jest.fn().mockResolvedValue(watch),
    deleteWatch: jest.fn().mockResolvedValue(true),
    changes: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  return {
    repository,
    service: new CompetitorsService(repository as unknown as CompetitorsRepository),
  };
}

describe("the competitor registry", () => {
  it("lists rivals with their watches and the registry's sub-line", async () => {
    const { service } = build();

    expect(await service.list(ORG)).toMatchObject({
      items: [
        {
          id: RIVAL,
          name: "Skylink",
          site: "https://skylink.example.com",
          aliases: [],
          watches: [{ id: WATCH }],
        },
      ],
      summary: { subLine: "1 rival watched · changelogs" },
    });
  });

  it("answers a taken name with 409 competitor_name_taken", async () => {
    const { service } = build({
      createCompetitor: jest.fn().mockRejectedValue(violation("competitors_organization_name_key")),
    });

    await expect(service.create(ORG, { name: " skylink " })).rejects.toMatchObject({
      response: { code: COMPETITOR_ERRORS.nameTaken, details: { name: "skylink" } },
    });
  });

  it("answers a rival of another workspace with 404", async () => {
    const { service } = build({ findCompetitor: jest.fn().mockResolvedValue(undefined) });

    await expect(
      service.addWatch(ORG, RIVAL, { sourceKind: "page", url: "https://x.example.com" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.update(ORG, RIVAL, { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses to remove a cited rival or watch — disable it instead", async () => {
    const cited = Object.assign(new Error("fk"), {
      code: "23503",
      constraint: "source_records_snapshot_fk",
    });
    const { service } = build({
      deleteCompetitor: jest.fn().mockRejectedValue(cited),
      deleteWatch: jest.fn().mockRejectedValue(cited),
    });

    await expect(service.remove(ORG, RIVAL)).rejects.toMatchObject({
      response: { code: COMPETITOR_ERRORS.cited },
    });
    await expect(service.removeWatch(ORG, RIVAL, WATCH)).rejects.toBeInstanceOf(ConflictError);
  });

  it("adds a watch, due at once, daily and enabled unless told otherwise", async () => {
    const { repository, service } = build();

    await service.addWatch(ORG, RIVAL, {
      sourceKind: "changelog",
      url: watch.url,
      selector: " main .entries ",
    });

    expect(repository.createWatch).toHaveBeenCalledWith(RIVAL, {
      sourceKind: "changelog",
      url: watch.url,
      selector: "main .entries",
      cadence: "daily",
      enabled: true,
    });
  });

  it("caps a rival's watches, and answers a duplicate with 409", async () => {
    const full = build({ countWatches: jest.fn().mockResolvedValue(MAX_WATCHES_PER_COMPETITOR) });
    const duplicate = build({
      createWatch: jest.fn().mockRejectedValue(violation("competitor_watches_target_key")),
    });

    await expect(
      full.service.addWatch(ORG, RIVAL, { sourceKind: "page", url: watch.url }),
    ).rejects.toMatchObject({
      response: { code: COMPETITOR_ERRORS.tooManyWatches },
    });
    await expect(
      duplicate.service.addWatch(ORG, RIVAL, { sourceKind: "page", url: watch.url }),
    ).rejects.toMatchObject({
      response: { code: COMPETITOR_ERRORS.watchExists },
    });
  });

  it("passes only a cleared render_required on, so the tracker stays the one that marks it", async () => {
    const { repository, service } = build();

    await service.updateWatch(ORG, RIVAL, WATCH, { renderRequired: false, cadence: "weekly" });

    expect(repository.updateWatch).toHaveBeenCalledWith(WATCH, {
      cadence: "weekly",
      renderRequired: false,
    });
  });

  it("pages the change feed newest first, with a cursor only when the page is full", async () => {
    const row = {
      snapshotId: "s2",
      previousSnapshotId: "s1",
      watchId: WATCH,
      competitorId: RIVAL,
      competitorName: "Skylink",
      sourceKind: "changelog" as const,
      url: watch.url,
      selector: null,
      contentHash: `sha256:${"c".repeat(64)}`,
      diff: "+ 6.2",
      takenAt: AT,
    };
    const { repository, service } = build({ changes: jest.fn().mockResolvedValue([row]) });

    const full = await service.feed(ORG, { limit: 1, since: "2026-08-01T00:00:00Z" });
    const partial = await service.feed(ORG, { limit: 2 });

    expect(full).toEqual({
      items: [expect.objectContaining({ snapshotId: "s2", takenAt: AT.toISOString() })],
      nextBefore: AT.toISOString(),
    });
    expect(partial.nextBefore).toBeNull();
    expect(repository.changes).toHaveBeenCalledWith(ORG, {
      since: new Date("2026-08-01T00:00:00Z"),
      limit: 1,
    });
  });
});

describe("a watch's fit to its kind", () => {
  it("lets a page kind take a CSS selector", () => {
    expect(() =>
      validateWatch("release_notes", "https://x.example.com", "main .release-list"),
    ).not.toThrow();
  });

  it.each([
    ["rss", "https://x.example.com/feed", "main", COMPETITOR_ERRORS.selectorInvalid],
    ["page", "https://x.example.com", "//div", COMPETITOR_ERRORS.selectorInvalid],
    ["github_releases", "https://x.example.com/repo", null, COMPETITOR_ERRORS.urlInvalid],
  ] as const)("refuses a %s watch of %s with %s", (kind, url, selector, code) => {
    expect(() => validateWatch(kind, url, selector)).toThrow(InvalidRequestError);
    try {
      validateWatch(kind, url, selector);
    } catch (error) {
      expect((error as InvalidRequestError).getResponse()).toMatchObject({ code });
    }
  });
});

describe("a rival's details", () => {
  it("replace what is given, remove what is null, keep what is omitted", () => {
    expect(
      metaOf(
        { site: "https://a.example.com", notes: "old" },
        { notes: null, aliases: ["Sky", "sky", " Skylink R "] },
      ),
    ).toEqual({
      site: "https://a.example.com",
      aliases: ["sky", "Skylink R"],
    });
  });
});
