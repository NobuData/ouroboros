import { ApiHarness } from "../../../testing/harness.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { GithubRateLimiter } from "../../github/github.rate-limit";
import { PrMirrorRepository } from "../../pull-requests/pr-sync.repository";
import { waiverAnnotationKey } from "../../pull-requests/criteria/criteria.annotation";
import { EVIDENCE_COMMENT_KEY } from "../../pull-requests/merge/merge.evidence";
import { PrSyncService } from "../../pull-requests/pr-sync.service";
import { FIRST_PUSH, SECOND_PUSH } from "../conformance.pr.fixture";
import { TicketSourceRegistry } from "../ticket-source.registry";
import { insertSource } from "../ticket-sync.integration.fixture";
import { TicketSourcesService } from "../ticket-sources.service";
import { CREATE_COMMENT_ROUTE, UPDATE_COMMENT_ROUTE } from "./github.pr";
import { GithubTicketSourceProvider } from "./github.provider";
import {
  SOURCE_LOGIN,
  SOURCE_REPO,
  SOURCE_TOKEN,
  recordingFactory,
} from "./github.provider.fixture";
import { RECORDED_DEFAULT_BRANCH, prRecording } from "./github.pr-recordings.fixture";

/**
 * AX.1's sandbox round trip, end to end ([#357](https://github.com/NobuData/ouroboros/issues/357)):
 * *"create a branch and PR → push a second commit → revision 2 detected with correct file counts"*,
 * then *"mergePR with squash and branch delete"*, *"commentPR edits on re-publish"* and *"issue close
 * via `Closes #N` is verified after merge"* — through the real `GithubTicketSourceProvider`, K.3's
 * real client, a sealed credential opened by the real vault, and V052's tables.
 *
 * The sandbox is a recorded GitHub repository (`github.pr-recordings.fixture.ts`) rather than a
 * live one: CI holds no GitHub token, and a round trip that needs one is a test nobody runs. The
 * recording applies github.com's rules the provider depends on — a second open PR for a branch is
 * refused, keyword closing happens only on a merge into the default branch.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

describe("the GitHub PR round trip, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());

  afterEach(() => api.truncate());

  /**
   * A GitHub source on a recorded repository, its provider, and the PR sync over both.
   *
   * @returns Everything a case needs.
   */
  async function recorded() {
    const { organizationId, sourceId } = await insertSource(api, {
      kind: "github",
      displayName: "GitHub · acme-robotics",
      config: { login: SOURCE_LOGIN, repos: [SOURCE_REPO] },
      credential: SOURCE_TOKEN,
    });
    const github = prRecording();
    const provider = new GithubTicketSourceProvider(
      recordingFactory(github.octokit).factory,
      new GithubRateLimiter(),
    );
    const sources = api.nest.get(TicketSourcesService);
    const service = new PrSyncService(
      api.nest.get(PrMirrorRepository),
      new TicketSourceRegistry([provider]),
      sources,
    );
    const source = {
      sourceId,
      organizationId,
      kind: "github" as const,
      displayName: "GitHub · acme-robotics",
      config: { login: SOURCE_LOGIN, repos: [SOURCE_REPO] },
      cursor: null,
      syncedAt: null,
    };

    return { organizationId, sourceId, github, provider, sources, service, source };
  }

  it("creates a branch and PR, detects revision 2 after a second push, merges squash with delete, verifies the close, and edits its comment", async () => {
    const { organizationId, sourceId, github, provider, sources, service, source } =
      await recorded();

    // Create a branch and PR.
    github.push("loop/482-canbus-flake", FIRST_PUSH);

    const issue = github.openIssue();
    const created = await sources.withCredentials(source, (context) =>
      provider.createPR(context, {
        branch: "loop/482-canbus-flake",
        base: RECORDED_DEFAULT_BRANCH,
        title: "can: fix flaky telemetry frame order under ISR load",
        body: `Loop #1847 · Closes #${String(issue)}.`,
      }),
    );
    const prNumber = created?.number ?? 0;

    expect(created?.url).toBe(
      `https://github.com/${SOURCE_LOGIN}/${SOURCE_REPO}/pull/${String(prNumber)}`,
    );
    await expect(service.sync(organizationId, sourceId, prNumber)).resolves.toMatchObject({
      revisionSeq: 1,
      newRevision: true,
    });

    // Push a second commit → revision 2, with correct file counts.
    github.push("loop/482-canbus-flake", SECOND_PUSH);

    await expect(service.sync(organizationId, sourceId, prNumber)).resolves.toMatchObject({
      revisionSeq: 2,
      newRevision: true,
    });

    const { rows: prs } = await api.sql.query<{
      id: string;
      external_url: string;
      additions: number;
      deletions: number;
      changed_files: number;
    }>(
      `select id, external_url, additions, deletions, changed_files
         from ${SCHEMA_NAME}.pull_requests where source_id = $1`,
      [sourceId],
    );
    const { rows: revisions } = await api.sql.query<{
      revision_seq: number;
      files: { path: string; additions: number; deletions: number }[];
    }>(
      `select revision_seq, files from ${SCHEMA_NAME}.pr_revisions where pr_id = $1 order by revision_seq`,
      [prs[0].id],
    );

    expect(prs[0]).toMatchObject({ additions: 68, deletions: 15, changed_files: 3 });
    expect(revisions.map((row) => row.files.length)).toEqual([2, 3]);
    expect(revisions[1].files.reduce((sum, file) => sum + file.additions, 0)).toBe(68);

    // Comment, then re-publish: one comment, edited.
    const evidence = await sources.withCredentials(source, async (context) => [
      await provider.commentPR(context, prNumber, { key: "evidence", body: "5 of 7 gates green" }),
      await provider.commentPR(context, prNumber, { key: "evidence", body: "7 of 7 gates green" }),
    ]);

    expect(evidence.map((result) => result.mode)).toEqual(["created", "edited"]);
    expect(github.ledger().comments).toHaveLength(1);

    // Merge squash with branch delete; the close is verified, not assumed.
    const merged = await sources.withCredentials(source, (context) =>
      provider.mergePR(context, prNumber, {
        strategy: "squash",
        message: `fix(can): order telemetry frames under ISR load\n\nCloses #${String(issue)}.`,
        deleteBranch: true,
      }),
    );

    expect(merged).toMatchObject({
      alreadyMerged: false,
      branchDeleted: true,
      closures: [{ reference: `#${String(issue)}`, closed: true }],
    });
    expect(github.ledger().branches).not.toContain("loop/482-canbus-flake");
    await expect(service.sync(organizationId, sourceId, prNumber)).resolves.toMatchObject({
      state: "merged",
      revisionSeq: 2,
      newRevision: false,
    });
  });
  it("keeps one comment per key across repeated publishes through the PR sync — PATCH, never a second POST (AX.6)", async () => {
    const { organizationId, sourceId, github, service } = await recorded();

    github.push("loop/482-canbus-flake", FIRST_PUSH);

    const prNumber = github.open("loop/482-canbus-flake", "can: fix flaky telemetry frame order");
    const keys = [
      EVIDENCE_COMMENT_KEY,
      waiverAnnotationKey("5eed0040-0000-4000-8000-000000000001"),
    ];
    const modes: string[] = [];

    for (const round of [1, 2, 3]) {
      for (const key of keys) {
        const published = await service.comment(organizationId, sourceId, prNumber, {
          key,
          body: `${key} · publish ${String(round)}`,
        });

        modes.push(published.mode);
      }
    }

    const routes = github.calls.map((call) => call.route);

    expect(modes).toEqual(["created", "created", "edited", "edited", "edited", "edited"]);
    expect(routes.filter((route) => route === CREATE_COMMENT_ROUTE)).toHaveLength(2);
    expect(routes.filter((route) => route === UPDATE_COMMENT_ROUTE)).toHaveLength(4);
    expect(github.ledger().comments.map(([, , body]) => body.split("\n")[0])).toEqual([
      `${EVIDENCE_COMMENT_KEY} · publish 3`,
      `${keys[1]} · publish 3`,
    ]);
  });
});
