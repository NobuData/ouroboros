import { ApiHarness } from "../../../testing/harness.fixture";
import { httpError } from "../../github/github.fixture";
import { GithubRateLimiter } from "../../github/github.rate-limit";
import { cycleWith, insertSource, sourceRow, ticketsOf } from "../ticket-sync.integration.fixture";
import { GithubTicketSourceProvider } from "./github.provider";
import {
  SOURCE_LOGIN,
  SOURCE_REPO,
  SOURCE_TOKEN,
  issuePayload,
  pullRequestPayload,
  recordingFactory,
  scriptedOctokit,
  type OctokitScript,
} from "./github.provider.fixture";

/**
 * The GitHub provider end to end, against a migrated database
 * ([#140](https://github.com/NobuData/ouroboros/issues/140)).
 *
 * Q.3's first acceptance criterion: *"the intake MVP criteria for sync … all hold when running
 * through the SPI"*. The **real** `GithubTicketSourceProvider` is registered over a scripted GitHub,
 * so a cold import, a no-change poll, an upstream edit and a close are asserted against V030's
 * columns with nothing standing in but the network.
 *
 * These cases lived at the end of `ticket-sources.integration-spec.ts` until Q.5
 * ([#142](https://github.com/NobuData/ouroboros/issues/142)) moved that suite onto the in-memory
 * provider — *the core intake harness runs entirely on the fake* — and they moved here, beside the
 * provider they are about, unchanged. The shared row helpers are `ticket-sync.integration.fixture.ts`.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

describe("the GitHub provider, end to end, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    // A day, so the application's own loop cannot fire a cycle in the middle of a test.
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());

  afterEach(() => api.truncate());

  /**
   * A workspace with one GitHub source, configured and credentialed for real.
   *
   * @param repos - The enabled repositories.
   * @returns The workspace and the source.
   */
  function githubSource(repos: readonly string[] = [SOURCE_REPO]) {
    return insertSource(api, {
      kind: "github",
      displayName: "GitHub · acme-robotics",
      config: { login: SOURCE_LOGIN, repos: [...repos] },
      credential: SOURCE_TOKEN,
    });
  }

  /**
   * The real GitHub provider over a scripted GitHub.
   *
   * @param script - What each repository answers.
   * @returns The provider, built the way `ticket-sources.module.ts` builds it.
   */
  function githubProvider(script: OctokitScript): GithubTicketSourceProvider {
    return new GithubTicketSourceProvider(
      recordingFactory(scriptedOctokit(script)).factory,
      new GithubRateLimiter(),
    );
  }

  it("lands every open issue on a cold import, with pull requests excluded", async () => {
    // The intake MVP's first sync criterion, through the SPI and into V030's columns.
    const { sourceId } = await githubSource();

    await cycleWith(api, [
      githubProvider({
        issues: {
          [SOURCE_REPO]: [
            [
              issuePayload({ number: 1 }),
              pullRequestPayload({ number: 2 }),
              issuePayload({ number: 3 }),
            ],
          ],
        },
      }),
    ]);

    const stored = await ticketsOf(api, sourceId);

    expect(stored.map((ticket) => ticket.external_key)).toStrictEqual(["#1", "#3"]);
    expect(stored[0]).toMatchObject({
      external_url: "https://github.com/acme-robotics/helios-firmware/issues/1",
      state: "open",
      labels: ["bug", "i2c"],
      author: "field-support",
      meta: { github: { owner: SOURCE_LOGIN, repo: SOURCE_REPO } },
      sizing_status: "unsized",
    });
  });

  it("records a watermark the next cycle resumes from", async () => {
    const { sourceId } = await githubSource();

    await cycleWith(api, [githubProvider({ issues: { [SOURCE_REPO]: [[issuePayload()]] } })]);

    // What the page saw, not this host's clock — see `watermarkOf`.
    expect(await sourceRow(api, sourceId)).toMatchObject({
      sync_cursor: "2026-09-11T09:00:00.000Z",
      status: "active",
      status_reason: null,
    });
  });

  it("touches no row on a poll that found the same issue again", async () => {
    // GitHub's `since` is inclusive, so the boundary issue comes back on every poll. The row must
    // not move: `tickets_touch_updated_at` is unconditional, so an `updated_at` that stayed put is a
    // statement that was never issued.
    const { sourceId } = await githubSource();
    const provider = githubProvider({ issues: { [SOURCE_REPO]: [[issuePayload()]] } });

    await cycleWith(api, [provider]);

    const [first] = await ticketsOf(api, sourceId);

    await cycleWith(api, [provider]);

    const [second] = await ticketsOf(api, sourceId);

    expect(second.updated_at).toStrictEqual(first.updated_at);
    expect(second.synced_at).toStrictEqual(first.synced_at);
  });

  it("shows an upstream edit within one poll", async () => {
    const { sourceId } = await githubSource();

    await cycleWith(api, [githubProvider({ issues: { [SOURCE_REPO]: [[issuePayload()]] } })]);
    await cycleWith(api, [
      githubProvider({
        issues: {
          [SOURCE_REPO]: [
            [
              issuePayload({
                title: "Watchdog resets, revised",
                updated_at: "2026-09-12T09:00:00Z",
              }),
            ],
          ],
        },
      }),
    ]);

    expect((await ticketsOf(api, sourceId))[0].title).toBe("Watchdog resets, revised");
  });

  it("flips state when an issue is closed upstream", async () => {
    const { sourceId } = await githubSource();

    await cycleWith(api, [githubProvider({ issues: { [SOURCE_REPO]: [[issuePayload()]] } })]);
    await cycleWith(api, [
      githubProvider({
        issues: {
          [SOURCE_REPO]: [[issuePayload({ state: "closed", updated_at: "2026-09-12T09:00:00Z" })]],
        },
      }),
    ]);

    expect((await ticketsOf(api, sourceId))[0].state).toBe("closed");
  });

  it("records a spent rate limit as a status with a resume time", async () => {
    // Q.3's fourth acceptance criterion, through V031's column: what a settings page renders is
    // composed from the class, and the *when* is the one piece of provider knowledge that reaches a
    // person unchanged.
    const { sourceId } = await githubSource();

    await cycleWith(api, [
      githubProvider({
        issuesFail: {
          [SOURCE_REPO]: httpError(403, {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-limit": "5000",
            "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 900),
            "retry-after": "900",
          }),
        },
      }),
    ]);

    const row = await sourceRow(api, sourceId);

    expect(row.status).toBe("error");
    expect(row.status_reason).toMatch(/^rate limited until \d{2}:\d{2} UTC$/);
    // A failed sync is not stamped: "synced 40s ago" must never claim a sync that failed.
    expect(row.synced_at).toBeNull();
  });

  it("marks a repository it cannot see as an error a person can act on", async () => {
    const { sourceId } = await githubSource(["no-such-repo"]);

    await cycleWith(api, [githubProvider({ issuesFail: { "no-such-repo": httpError(404) } })]);

    expect(await sourceRow(api, sourceId)).toMatchObject({
      status: "error",
      status_reason: "project or repository not found",
    });
  });
});
