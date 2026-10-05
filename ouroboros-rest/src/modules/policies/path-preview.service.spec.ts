import { Logger } from "@nestjs/common";

import { sourceMissing } from "../detection/detection.errors";
import { DomainError } from "../errors/error.envelope";
import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import type { RepoTree } from "../ticket-sources/ticket-source.probe";
import { PATH_PREVIEW_GLOB_INVALID } from "./path-preview";
import {
  PATH_PREVIEW_REASONS,
  PathPreviewService,
  TREE_CACHE_TTL_MS,
  type PathPreviewReader,
} from "./path-preview.service";

/**
 * The match preview (BS.4, #494): every enabled repository, each listed once a minute at most,
 * and a repository that cannot be listed answered as `unavailable` rather than failing the rest.
 */

const ORG = "org-494";

const FIRMWARE: RepoTree = {
  truncated: false,
  entries: [
    { path: "boot", type: "dir" },
    { path: "boot/stage1.S", type: "file" },
    { path: "keys/prod.pem", type: "file" },
    { path: "src/app.c", type: "file" },
  ],
};

/**
 * A preview over stubbed repositories and trees.
 *
 * @param trees - What listing each repository answers: a tree, or an error to throw.
 * @returns The service and its doubles.
 */
function harness(trees: Record<string, RepoTree | Error>) {
  const enabledRepos = jest.fn((organizationId?: string) =>
    Promise.resolve(
      Object.keys(trees).map((repo) => ({ organizationId: organizationId ?? ORG, repo })),
    ),
  );
  const readTree = jest.fn<
    ReturnType<PathPreviewReader["readTree"]>,
    Parameters<PathPreviewReader["readTree"]>
  >((_organizationId, repo, pick) => {
    const tree = trees[repo];

    if (tree instanceof Error) {
      return Promise.reject(tree);
    }

    // The preview reads no file — only the listing.
    expect(pick(tree)).toEqual([]);

    return Promise.resolve({ tree, files: new Map() });
  });
  const service = new PathPreviewService({ enabledRepos }, { readTree });
  const clock = { at: Date.parse("2026-10-05T12:00:00.000Z") };

  jest.spyOn(service, "now").mockImplementation(() => clock.at);

  return { service, enabledRepos, readTree, clock };
}

describe("the path preview service", () => {
  it("answers what each glob covers in each enabled repository of the workspace", async () => {
    const { service, enabledRepos, readTree } = harness({ "acme/firmware": FIRMWARE });

    await expect(service.preview(ORG, ["boot/**", "docs/**"])).resolves.toEqual({
      repositories: [
        {
          repository: "acme/firmware",
          status: "listed",
          reason: null,
          fileCount: 3,
          truncated: false,
          globs: [
            { glob: "boot/**", matchCount: 1, samples: ["boot/stage1.S"] },
            { glob: "docs/**", matchCount: 0, samples: [] },
          ],
        },
      ],
    });
    expect(enabledRepos).toHaveBeenCalledWith(ORG);
    expect(readTree).toHaveBeenCalledWith(ORG, "acme/firmware", expect.any(Function));
  });

  it("answers no repositories for a workspace with none enabled", async () => {
    const { service, readTree } = harness({});

    await expect(service.preview(ORG, ["boot/**"])).resolves.toEqual({ repositories: [] });
    expect(readTree).not.toHaveBeenCalled();
  });

  it("refuses a bad glob before any repository is read", async () => {
    const { service, enabledRepos, readTree } = harness({ "acme/firmware": FIRMWARE });

    await expect(service.preview(ORG, ["boot/**", "/etc/passwd"])).rejects.toMatchObject({
      code: PATH_PREVIEW_GLOB_INVALID,
      details: { invalid: [{ index: 1, glob: "/etc/passwd" }] },
    });
    expect(enabledRepos).not.toHaveBeenCalled();
    expect(readTree).not.toHaveBeenCalled();
  });

  it("says a truncated listing is one", async () => {
    const { service } = harness({ "acme/firmware": { ...FIRMWARE, truncated: true } });

    const { repositories } = await service.preview(ORG, ["boot/**"]);

    expect(repositories[0]).toMatchObject({ status: "listed", truncated: true });
  });

  it.each([
    ["no source covers it", sourceMissing("acme/ghost"), PATH_PREVIEW_REASONS.noSource],
    [
      "the host rate-limits",
      new TicketSourceError("rate_limit", "secondary rate limit"),
      PATH_PREVIEW_REASONS.rateLimit,
    ],
    [
      "the host refuses",
      new TicketSourceError("upstream", "502 from the host"),
      PATH_PREVIEW_REASONS.hostError,
    ],
    ["anything else fails", new Error("socket hang up"), PATH_PREVIEW_REASONS.hostError],
  ])(
    "answers a repository as unavailable when %s, and still previews the rest",
    async (_, error, reason) => {
      jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

      const { service } = harness({ "acme/ghost": error, "acme/firmware": FIRMWARE });

      const { repositories } = await service.preview(ORG, ["boot/**"]);

      expect(repositories).toEqual([
        {
          repository: "acme/ghost",
          status: "unavailable",
          reason,
          fileCount: null,
          truncated: false,
          globs: [{ glob: "boot/**", matchCount: 0, samples: [] }],
        },
        expect.objectContaining({ repository: "acme/firmware", status: "listed", fileCount: 3 }),
      ]);
      // Never the provider's own words — they are a log's, not a settings page's.
      expect(JSON.stringify(repositories)).not.toContain(error.message);
    },
  );

  it("lists a repository once a minute, however often the editor asks", async () => {
    const { service, readTree, clock } = harness({ "acme/firmware": FIRMWARE });

    await service.preview(ORG, ["boot/**"]);
    clock.at += TREE_CACHE_TTL_MS - 1;
    await service.preview(ORG, ["keys/**"]);

    expect(readTree).toHaveBeenCalledTimes(1);

    clock.at += 1;
    const { repositories } = await service.preview(ORG, ["keys/**"]);

    expect(readTree).toHaveBeenCalledTimes(2);
    expect(repositories[0].globs).toEqual([
      { glob: "keys/**", matchCount: 1, samples: ["keys/prod.pem"] },
    ]);
  });

  it("keeps each workspace's listing its own", async () => {
    const { service, readTree } = harness({ "acme/firmware": FIRMWARE });

    await service.preview(ORG, ["boot/**"]);
    await service.preview("org-other", ["boot/**"]);

    expect(readTree.mock.calls.map(([organizationId]) => organizationId)).toEqual([
      ORG,
      "org-other",
    ]);
  });

  it("never caches a failure — the next ask tries again", async () => {
    const trees: Record<string, RepoTree | Error> = {
      "acme/firmware": new TicketSourceError("rate_limit", "slow down"),
    };
    const { service, readTree } = harness(trees);

    await expect(service.preview(ORG, ["boot/**"])).resolves.toMatchObject({
      repositories: [{ status: "unavailable" }],
    });

    trees["acme/firmware"] = FIRMWARE;

    await expect(service.preview(ORG, ["boot/**"])).resolves.toMatchObject({
      repositories: [{ status: "listed" }],
    });
    expect(readTree).toHaveBeenCalledTimes(2);
  });

  it("refuses with a domain error a caller can render", async () => {
    const { service } = harness({});

    await expect(service.preview(ORG, ["a b"])).rejects.toBeInstanceOf(DomainError);
  });
});
