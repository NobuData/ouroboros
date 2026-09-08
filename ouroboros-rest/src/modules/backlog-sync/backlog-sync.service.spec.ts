import { Logger } from "@nestjs/common";

import { GithubClient } from "../github/github.client";
import { GithubClientFactory } from "../github/github.client.factory";
import type { GithubCredentialsService } from "../github/github.credentials.service";
import { GITHUB_FAILURES, GithubApiError } from "../github/github.errors";
import { GithubRateLimiter } from "../github/github.rate-limit";
import { fakeOctokit, httpError, response, type ScriptedAnswer } from "../github/github.fixture";
import {
  FIXTURE_NOW,
  FIXTURE_REPO_ID,
  FIXTURE_SLUG,
  FIXTURE_WORKSPACE,
  issuePayload,
  pullRequestPayload,
  recordingIntake,
  target,
  type RecordingIntake,
} from "./backlog-sync.fixture";
import {
  BacklogSyncRepository,
  type PollWrite,
  type PollWritten,
  type SyncTarget,
} from "./backlog-sync.repository";
import { BacklogSyncService } from "./backlog-sync.service";
import { MAX_ISSUES_PER_POLL } from "./cadence";
import { SYNC_NO_REPOSITORIES } from "./sync.report";

/**
 * The cycle: what it asks GitHub, what it writes down, and what it says when it does neither.
 *
 * Driven over the **real** `GithubClient` against `github.fixture.ts`'s scriptable Octokit,
 * rather than over a stubbed client. That is deliberate and it is what makes the `since`
 * assertions worth anything: the parameters below are the ones the library would actually be
 * handed, walked through the real pagination, the real rate guard and the real failure
 * classification. A stubbed client would only prove this service calls a method it wrote.
 *
 * The repository is a recorder rather than a database — `backlog-sync.repository.spec.ts` is
 * where the statements are asserted, and the integration suite is where both meet PostgreSQL.
 */

/** Everything the sync asks of its repository, recorded. */
interface RecordingRepository extends BacklogSyncRepository {
  /** Every poll written, in order. */
  readonly polls: PollWrite[];
}

/**
 * A repository that records what it was told to write.
 *
 * @param targets - What {@link BacklogSyncRepository.enabledRepositories} answers.
 * @param written - What each poll reports back. Defaults to *nothing changed*, which is the
 *   answer most assertions here do not care about.
 * @returns The recorder.
 */
function recordingRepository(
  targets: readonly SyncTarget[],
  written: Partial<PollWritten> = {},
): RecordingRepository {
  const polls: PollWrite[] = [];

  return {
    polls,
    enabledRepositories: () => Promise.resolve([...targets]),
    applyPoll: (write: PollWrite) => {
      polls.push(write);

      return Promise.resolve({
        imported: 0,
        updated: 0,
        unchanged: 0,
        estimable: [],
        ...written,
      });
    },
  } as unknown as RecordingRepository;
}

/**
 * A client factory answering with a real client over a scripted Octokit.
 *
 * @param answers - What GitHub answers, in order.
 * @param failure - When given, what `forOrganization` rejects with instead — the no-token case.
 * @returns The factory, and the fake it built the client over.
 */
function factory(
  answers: readonly ScriptedAnswer[],
  failure?: Error,
): { factory: GithubClientFactory; octokit: ReturnType<typeof fakeOctokit> } {
  const octokit = fakeOctokit(answers);
  const limiter = new GithubRateLimiter();

  return {
    octokit,
    factory: {
      forOrganization: (organizationId: string) =>
        failure === undefined
          ? Promise.resolve(new GithubClient(organizationId, octokit, limiter))
          : Promise.reject(failure),
    } as unknown as GithubClientFactory,
  };
}

/**
 * A credentials service that answers with a fixed set of configured workspaces.
 *
 * @param organizations - Which workspaces have a token.
 * @returns The stand-in.
 */
function credentials(organizations: readonly string[]): GithubCredentialsService {
  return {
    configuredOrganizations: () => Promise.resolve([...organizations]),
  } as unknown as GithubCredentialsService;
}

/** A page of issues, as Octokit's paginator yields one. */
function page(items: readonly unknown[]): ScriptedAnswer {
  return response(items);
}

describe("the backlog sync cycle", () => {
  let intake: RecordingIntake;

  beforeEach(() => {
    intake = recordingIntake();

    // The pauses and the skipped payloads below are all logged on purpose, and every one of
    // them is asserted through the report rather than through the sink. Silencing the logger
    // keeps a suite about behaviour from printing a page of stack traces per run.
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  /**
   * Build the service around a scripted GitHub.
   *
   * @param options - The repositories to poll, what GitHub answers, who has a token, and what
   *   the repository reports back.
   * @returns The service and the two recorders a test asserts over.
   */
  function build(options: {
    targets?: readonly SyncTarget[];
    answers?: readonly ScriptedAnswer[];
    configured?: readonly string[];
    written?: Partial<PollWritten>;
    clientFailure?: Error;
  }) {
    const targets = options.targets ?? [target()];
    const repository = recordingRepository(targets, options.written);
    const github = factory(options.answers ?? [page([])], options.clientFailure);

    return {
      repository,
      octokit: github.octokit,
      service: new BacklogSyncService(
        repository,
        github.factory,
        credentials(options.configured ?? [FIXTURE_WORKSPACE]),
        intake,
      ),
    };
  }

  describe("the initial import", () => {
    it("asks for open issues, oldest update first, and sends no `since`", async () => {
      const { service, octokit } = build({ answers: [page([issuePayload()]), page([])] });

      await service.cycle(FIXTURE_NOW);

      expect(octokit.calls[0].params).toMatchObject({
        owner: "acme-robotics",
        repo: "helios-firmware",
        state: "open",
        sort: "updated",
        direction: "asc",
      });
      expect(octokit.calls[0].params).not.toHaveProperty("since");
    });

    it("lands every open issue the walk returns, across pages", async () => {
      const { service, repository } = build({
        answers: [
          page([issuePayload({ number: 1 }), issuePayload({ number: 2 })]),
          page([issuePayload({ number: 3 })]),
          page([]),
        ],
      });

      await service.cycle(FIXTURE_NOW);

      expect(repository.polls[0].issues.map((issue) => issue.number)).toEqual([1, 2, 3]);
    });

    it("excludes pull requests, and counts them", async () => {
      // The criterion a user sees first: GitHub's issues endpoint returns both.
      const { service, repository } = build({
        answers: [
          page([issuePayload({ number: 1 }), pullRequestPayload(), issuePayload({ number: 2 })]),
          page([]),
        ],
      });

      const report = await service.cycle(FIXTURE_NOW);

      expect(repository.polls[0].issues.map((issue) => issue.number)).toEqual([1, 2]);
      expect(report.organizations[0].repositories[0].pullRequests).toBe(1);
    });

    it("skips a payload it cannot represent without losing the rest of the page", async () => {
      const { service, repository } = build({
        answers: [
          page([
            issuePayload({ number: 1 }),
            issuePayload({ number: 2, title: "  " }),
            issuePayload({ number: 3 }),
          ]),
          page([]),
        ],
      });

      const report = await service.cycle(FIXTURE_NOW);

      expect(repository.polls[0].issues.map((issue) => issue.number)).toEqual([1, 3]);
      expect(report.organizations[0].repositories[0].unusable).toBe(1);
    });
  });

  describe("the incremental poll", () => {
    it("sends the stored watermark as `since`, and asks for every state", async () => {
      // `state=all` is what makes a close arrive at all: an issue that closed upstream simply
      // leaves an `open` listing, and the mirror would hold it open forever.
      const { service, octokit } = build({
        targets: [target({ cursor: "2026-09-08T07:00:00.000Z", syncedAt: FIXTURE_NOW })],
        answers: [page([]), page([])],
      });

      await service.cycle(FIXTURE_NOW);

      expect(octokit.calls[0].params).toMatchObject({
        state: "all",
        since: "2026-09-08T07:00:00.000Z",
        sort: "updated",
        direction: "asc",
      });
    });

    it("falls back to an initial import when the stored cursor is not a timestamp", async () => {
      const { service, octokit } = build({
        targets: [target({ cursor: "corrupted", syncedAt: FIXTURE_NOW })],
        answers: [page([]), page([])],
      });

      await service.cycle(FIXTURE_NOW);

      expect(octokit.calls[0].params).toMatchObject({ state: "open" });
      expect(octokit.calls[0].params).not.toHaveProperty("since");
    });

    it("costs one request and writes no watermark when nothing has changed", async () => {
      // The acceptance criterion, both halves. One page, no rows, and the stored cursor stands.
      const { service, repository, octokit } = build({
        targets: [target({ cursor: "2026-09-08T07:00:00.000Z", syncedAt: FIXTURE_NOW })],
        answers: [page([])],
      });

      const report = await service.cycle(FIXTURE_NOW);

      expect(octokit.calls).toHaveLength(1);
      expect(repository.polls[0].issues).toEqual([]);
      expect(repository.polls[0].cursor).toBeNull();
      expect(report.organizations[0].repositories[0]).toMatchObject({
        imported: 0,
        updated: 0,
        unchanged: 0,
      });
    });

    it("stops on GitHub's `304`, which costs nothing from the hourly budget", async () => {
      const { service, repository } = build({
        targets: [target({ cursor: "2026-09-08T07:00:00.000Z", syncedAt: FIXTURE_NOW })],
        answers: [response(undefined, { etag: '"abc"' }, 304)],
      });

      await service.cycle(FIXTURE_NOW);

      expect(repository.polls[0].issues).toEqual([]);
    });
  });

  describe("the watermark", () => {
    it("is the greatest update GitHub returned, never this process's clock", async () => {
      // A clock-derived watermark is wrong by however far this host has drifted from GitHub's,
      // and it is wrong in the direction that loses issues.
      const { service, repository } = build({
        answers: [
          page([
            issuePayload({ number: 1, updatedAt: "2026-09-08T07:00:00Z" }),
            issuePayload({ number: 2, updatedAt: "2026-09-08T09:30:00Z" }),
          ]),
          page([]),
        ],
      });

      await service.cycle(FIXTURE_NOW);

      expect(repository.polls[0].cursor).toBe("2026-09-08T09:30:00.000Z");
      expect(repository.polls[0].cursor).not.toBe(FIXTURE_NOW.toISOString());
    });

    it("does not depend on GitHub having honoured the sort order", async () => {
      const { service, repository } = build({
        answers: [
          page([
            issuePayload({ number: 1, updatedAt: "2026-09-08T09:30:00Z" }),
            issuePayload({ number: 2, updatedAt: "2026-09-08T07:00:00Z" }),
          ]),
          page([]),
        ],
      });

      await service.cycle(FIXTURE_NOW);

      expect(repository.polls[0].cursor).toBe("2026-09-08T09:30:00.000Z");
    });

    it("is the same value the report quotes, so a status cannot claim one the column lacks", async () => {
      const { service, repository } = build({
        answers: [page([issuePayload({ updatedAt: "2026-09-08T09:30:00Z" })]), page([])],
      });

      const report = await service.cycle(FIXTURE_NOW);

      expect(report.organizations[0].repositories[0].cursor).toBe(repository.polls[0].cursor);
    });

    it("reports the stored watermark when a poll earned none", async () => {
      const { service } = build({
        targets: [target({ cursor: "2026-09-01T00:00:00.000Z", syncedAt: FIXTURE_NOW })],
        answers: [page([])],
      });

      const report = await service.cycle(FIXTURE_NOW);

      expect(report.organizations[0].repositories[0].cursor).toBe("2026-09-01T00:00:00.000Z");
    });
  });

  describe("freshness", () => {
    it("is the cycle's own instant, shared by every repository it polls", async () => {
      const second = target({
        githubRepoId: "dfff0000-0000-0000-0000-00000000000b",
        name: "other",
      });
      const { service, repository } = build({
        targets: [target(), second],
        answers: [page([]), page([])],
      });

      const report = await service.cycle(FIXTURE_NOW);

      expect(repository.polls.map((poll) => poll.syncedAt)).toEqual([FIXTURE_NOW, FIXTURE_NOW]);
      expect(report.organizations[0].repositories.map((each) => each.syncedAt)).toEqual([
        FIXTURE_NOW,
        FIXTURE_NOW,
      ]);
    });

    it("is not claimed at all for a repository whose poll failed", async () => {
      // The whole of *"freshness can never claim a sync that partly failed"*, seen from here:
      // no write is attempted, so the stored stamp keeps saying when the last good poll was.
      const { service, repository } = build({ answers: [httpError(500)] });

      const report = await service.cycle(FIXTURE_NOW);

      expect(repository.polls).toEqual([]);
      expect(report.organizations[0].repositories[0].syncedAt).toBeUndefined();
      expect(report.organizations[0].repositories[0].pause).toBe(GITHUB_FAILURES.upstreamError);
    });
  });

  describe("the estimation handoff", () => {
    it("hands over exactly what the transaction committed, once", async () => {
      const estimable = [
        {
          organizationId: FIXTURE_WORKSPACE,
          issueId: "d1000000-0000-0000-0000-000000000485",
          githubRepoId: FIXTURE_REPO_ID,
          number: 485,
          reason: "imported" as const,
        },
      ];
      const { service } = build({
        answers: [page([issuePayload()]), page([])],
        written: { imported: 1, estimable },
      });

      const report = await service.cycle(FIXTURE_NOW);

      expect(intake.batches).toEqual([estimable]);
      expect(report.organizations[0].repositories[0].enqueued).toBe(1);
    });

    it("says nothing to the pipeline when a poll changed nothing", async () => {
      const { service } = build({ answers: [page([]), page([])] });

      await service.cycle(FIXTURE_NOW);

      expect(intake.batches).toEqual([]);
    });

    it("keeps the mirror when the pipeline refuses the handoff", async () => {
      // The rows are already committed and `unsized`, which is the state L.3's stale sweep is
      // designed to find. A throw here would turn a stored poll into a failed one.
      intake = recordingIntake(new Error("queue is full"));
      const { service, repository } = build({
        answers: [page([issuePayload()]), page([])],
        written: {
          imported: 1,
          estimable: [
            {
              organizationId: FIXTURE_WORKSPACE,
              issueId: "d1000000-0000-0000-0000-000000000485",
              githubRepoId: FIXTURE_REPO_ID,
              number: 485,
              reason: "imported",
            },
          ],
        },
      });

      await expect(service.cycle(FIXTURE_NOW)).resolves.toBeDefined();
      expect(repository.polls).toHaveLength(1);
    });
  });

  describe("when nothing is polled, it says why", () => {
    it("pauses `not_configured` for a workspace with no token", async () => {
      const { service } = build({
        clientFailure: new GithubApiError(GITHUB_FAILURES.notConfigured, "no token"),
      });

      const report = await service.cycle(FIXTURE_NOW);

      expect(report.organizations[0]).toEqual({
        organizationId: FIXTURE_WORKSPACE,
        pause: GITHUB_FAILURES.notConfigured,
        repositories: [],
      });
    });

    it("pauses `no_repositories` for a configured workspace with nothing enabled", async () => {
      const { service } = build({ targets: [] });

      const report = await service.cycle(FIXTURE_NOW);

      expect(report.organizations[0]).toEqual({
        organizationId: FIXTURE_WORKSPACE,
        pause: SYNC_NO_REPOSITORIES,
        repositories: [],
      });
    });

    it("reports a workspace whose token was cleared out from under its repositories", async () => {
      // The state a workspace is in the moment somebody presses *clear*: enabled repositories,
      // no credential. It is not in the configured set, so it would otherwise vanish from the
      // report entirely — which is the silent no-op the criterion forbids.
      const { service } = build({ configured: [] });

      const report = await service.cycle(FIXTURE_NOW);

      expect(report.organizations).toEqual([
        {
          organizationId: FIXTURE_WORKSPACE,
          pause: GITHUB_FAILURES.notConfigured,
          repositories: [],
        },
      ]);
    });

    it("pauses one repository without costing its neighbours their poll", async () => {
      const second = target({
        githubRepoId: "dfff0000-0000-0000-0000-00000000000b",
        name: "other",
      });
      const { service, repository } = build({
        targets: [target(), second],
        answers: [httpError(404), page([issuePayload()]), page([])],
      });

      const report = await service.cycle(FIXTURE_NOW);

      expect(report.organizations[0].repositories[0].pause).toBe(GITHUB_FAILURES.notFound);
      expect(report.organizations[0].repositories[1].pause).toBeUndefined();
      expect(repository.polls).toHaveLength(1);
    });

    it("stops the whole workspace when the token's budget is spent", async () => {
      // The budget belongs to the token, so carrying on would only spend a limit that is gone —
      // and every repository it did not reach keeps its previous, honest, freshness.
      const repositories = [
        target(),
        target({ githubRepoId: "dfff0000-0000-0000-0000-00000000000b", name: "other" }),
        target({ githubRepoId: "dfff0000-0000-0000-0000-00000000000c", name: "third" }),
        target({ githubRepoId: "dfff0000-0000-0000-0000-00000000000d", name: "fourth" }),
      ];
      const { service, repository } = build({
        targets: repositories,
        answers: [
          httpError(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "9999999999" }),
          page([]),
          page([]),
          page([]),
          page([]),
        ],
      });

      const report = await service.cycle(FIXTURE_NOW);

      expect(report.organizations[0].pause).toBe(GITHUB_FAILURES.rateLimited);
      // Three repositories are in the chunk and none of them is written: the rate guard is
      // shared across a workspace's clients, so once the first `403` teaches it the budget is
      // gone, the other two are refused *before* a request is sent. The fourth repository is
      // never reached at all, which is what the chunk boundary buys.
      expect(report.organizations[0].repositories).toHaveLength(3);
      expect(report.organizations[0].repositories.map((each) => each.pause)).toEqual([
        GITHUB_FAILURES.rateLimited,
        GITHUB_FAILURES.rateLimited,
        GITHUB_FAILURES.rateLimited,
      ]);
      expect(repository.polls).toEqual([]);
    });

    it("calls an unclassified failure `upstream_error` rather than guessing", async () => {
      const { service } = build({ clientFailure: new Error("a bug in this service") });

      const report = await service.cycle(FIXTURE_NOW);

      expect(report.organizations[0].pause).toBe(GITHUB_FAILURES.upstreamError);
    });
  });

  describe("the per-poll cap", () => {
    it("stops at the cap and reports the cycle as pending", async () => {
      const many = Array.from({ length: MAX_ISSUES_PER_POLL }, (_, index) =>
        issuePayload({ number: index + 1 }),
      );
      const { service, repository } = build({
        answers: [page(many), page([issuePayload({ number: 9999 })])],
      });

      const report = await service.cycle(FIXTURE_NOW);

      expect(repository.polls[0].issues).toHaveLength(MAX_ISSUES_PER_POLL);
      expect(report.organizations[0].repositories[0].capped).toBe(true);
      expect(report.pending).toBe(true);
    });

    it("leaves a resumable watermark, because the walk is in ascending update order", async () => {
      const many = Array.from({ length: MAX_ISSUES_PER_POLL }, (_, index) =>
        issuePayload({
          number: index + 1,
          createdAt: "2026-09-01T00:00:00Z",
          updatedAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
        }),
      );
      const { service, repository } = build({ answers: [page(many)] });

      await service.cycle(FIXTURE_NOW);

      expect(repository.polls[0].cursor).toBe(
        new Date(Date.UTC(2026, 8, 1, 0, MAX_ISSUES_PER_POLL - 1)).toISOString(),
      );
    });

    it("is not pending when every poll finished", async () => {
      const { service } = build({ answers: [page([issuePayload()]), page([])] });

      const report = await service.cycle(FIXTURE_NOW);

      expect(report.pending).toBe(false);
    });
  });

  describe("what a status endpoint can read afterwards", () => {
    it("remembers the last cycle, and nothing before one has run", async () => {
      const { service } = build({ answers: [page([]), page([])] });

      expect(service.lastCycle()).toBeUndefined();

      const report = await service.cycle(FIXTURE_NOW);

      expect(service.lastCycle()).toBe(report);
    });

    it("names each repository the way a log line does", async () => {
      const { service } = build({ answers: [page([]), page([])] });

      const report = await service.cycle(FIXTURE_NOW);

      expect(report.organizations[0].repositories[0].repository).toBe(FIXTURE_SLUG);
    });
  });
});
