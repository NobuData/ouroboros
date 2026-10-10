import { Logger } from "@nestjs/common";

import { pipelineBench } from "./pipeline.bench.fixture";
import { DOC, INVESTIGATION, ORG, refused, roadmapRun, rs124Roadmap } from "./pipeline.fixture";
import type { DocRow, VersionRow } from "./pipeline.repository";
import { prBody, prTitle, roadmapBranch } from "./roadmap.projector";

const BRANCH = "ouroboros/roadmap-5eed0097";
const PATH = "docs/ROADMAP.md";

/** A bench with v1 stored and nothing projected yet. */
async function stored() {
  const bench = pipelineBench();

  bench.repo.supported = false;
  bench.skills.answer(roadmapRun(rs124Roadmap()));
  await bench.roadmap.generate(ORG, INVESTIGATION);
  bench.repo.supported = true;

  return bench;
}

function rows(bench: Awaited<ReturnType<typeof stored>>): { doc: DocRow; version: VersionRow } {
  return { doc: bench.store.docs.get(DOC) as DocRow, version: bench.store.current() as VersionRow };
}

describe("projecting a roadmap into its repository", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  it("commits to the document's branch and proposes it — never to the default branch", async () => {
    const bench = await stored();
    const { doc, version } = rows(bench);
    const outcome = await bench.projector.settle(doc, version);

    expect(outcome).toEqual({
      projection: {
        state: "pr_open",
        path: PATH,
        pr_ref: "#88",
        committed_sha: null,
        observed_sha: null,
      },
      problem: null,
    });
    expect(bench.repo.log).toEqual([`commit ${BRANCH} ${PATH}`, "pr #88 opened"]);
    expect(bench.repo.branches.get("main")?.has(PATH)).toBe(false);
    expect(bench.repo.prs[0]).toMatchObject({
      branch: BRANCH,
      base: "main",
      draft: false,
      title: "docs: Helios — Q4 Improvement Roadmap (v1)",
    });
    expect(bench.store.current()?.projection.state).toBe("pr_open");
  });

  it("opens a draft pull request while the workspace is in dry-run", async () => {
    const bench = await stored();

    bench.policy.dryRun = true;
    await bench.projector.settle(rows(bench).doc, rows(bench).version);

    expect(bench.repo.prs[0]?.draft).toBe(true);
  });

  it("commits directly only when the workspace opted in", async () => {
    const bench = await stored();

    bench.store.policy.set(ORG, { directCommit: true });

    const outcome = await bench.projector.settle(rows(bench).doc, rows(bench).version);

    expect(outcome.projection).toMatchObject({ state: "committed", pr_ref: null });
    expect(outcome.projection.committed_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(bench.repo.log).toEqual([`commit main ${PATH}`]);
    expect(bench.repo.prs).toEqual([]);
  });

  it("still goes through a draft pull request when opted in but in dry-run", async () => {
    const bench = await stored();

    bench.store.policy.set(ORG, { directCommit: true });
    bench.policy.dryRun = true;

    const outcome = await bench.projector.settle(rows(bench).doc, rows(bench).version);

    expect(outcome.projection.state).toBe("pr_open");
    expect(bench.repo.prs[0]?.draft).toBe(true);
    expect(bench.repo.branches.get("main")?.has(PATH)).toBe(false);
  });

  it("finds a version the default branch already holds, and proposes nothing", async () => {
    const bench = await stored();
    const { doc, version } = rows(bench);
    const sha = bench.repo.handEdit(PATH, version.markdown);
    const outcome = await bench.projector.settle(doc, version);

    expect(outcome.projection).toMatchObject({
      state: "committed",
      committed_sha: sha,
      pr_ref: null,
    });
    expect(bench.repo.prs).toEqual([]);
  });

  it("follows a merged pull request to committed, at the commit the file landed in", async () => {
    const bench = await stored();

    await bench.projector.settle(rows(bench).doc, rows(bench).version);
    bench.repo.merge(88);

    const outcome = await bench.projector.settle(rows(bench).doc, rows(bench).version);
    const landed = bench.repo.branches.get("main")?.get(PATH)?.sha;

    expect(outcome.projection).toEqual({
      state: "committed",
      path: PATH,
      pr_ref: "#88",
      committed_sha: landed,
      observed_sha: null,
    });
  });

  it("sends a pull request closed unmerged back to pending, and proposes it again next time", async () => {
    const bench = await stored();

    await bench.projector.settle(rows(bench).doc, rows(bench).version);
    bench.repo.prs[0].state = "closed";

    const closed = await bench.projector.settle(rows(bench).doc, rows(bench).version);

    expect(closed.projection).toMatchObject({ state: "pending", pr_ref: null });

    const again = await bench.projector.settle(rows(bench).doc, rows(bench).version);

    expect(again.projection).toMatchObject({ state: "pr_open", pr_ref: "#89" });
  });

  it("leaves an open pull request, a committed version and a drifted one where they are", async () => {
    const bench = await stored();

    await bench.projector.settle(rows(bench).doc, rows(bench).version);

    const open = await bench.projector.settle(rows(bench).doc, rows(bench).version);

    expect(open.projection.state).toBe("pr_open");
    expect(bench.repo.log).toHaveLength(2);

    bench.repo.merge(88);
    await bench.projector.settle(rows(bench).doc, rows(bench).version);

    const log = [...bench.repo.log];

    expect(
      (await bench.projector.settle(rows(bench).doc, rows(bench).version)).projection.state,
    ).toBe("committed");
    expect(bench.repo.log).toEqual(log);
  });

  it.each<[string, (bench: Awaited<ReturnType<typeof stored>>) => void, string]>([
    ["a refused token", (bench) => void (bench.repo.refusal = refused("auth")), "auth"],
    [
      "a tracker with no repository",
      (bench) => void (bench.repo.supported = false),
      "has no repository",
    ],
    ["a removed source", (bench) => void (bench.store.sourceRows.length = 0), "was removed"],
  ])("stays pending and says why for %s", async (_name, arrange, problem) => {
    const bench = await stored();

    arrange(bench);

    const outcome = await bench.projector.settle(rows(bench).doc, rows(bench).version);

    expect(outcome.projection.state).toBe("pending");
    expect(outcome.problem).toContain(problem);
    expect(bench.store.current()?.projection.state).toBe("pending");
  });

  it("says a document whose source link is gone has no repository", async () => {
    const bench = await stored();
    const { doc, version } = rows(bench);
    const outcome = await bench.projector.settle({ ...doc, targetSourceId: null }, version);

    expect(outcome.problem).toContain("was removed");
  });

  it("does not hide a failure that is not the repository's refusal", async () => {
    const bench = await stored();

    bench.repo.defaultBranch = () => Promise.reject(new Error("a bug"));

    await expect(bench.projector.settle(rows(bench).doc, rows(bench).version)).rejects.toThrow(
      "a bug",
    );
  });

  describe("reading the file", () => {
    it("answers the default branch's file, null when absent, and nothing when unreachable", async () => {
      const bench = await stored();
      const { doc, version } = rows(bench);

      expect(await bench.projector.read(doc, version)).toEqual({ file: null });

      const sha = bench.repo.handEdit(PATH, "edited");

      expect(await bench.projector.read(doc, version)).toEqual({
        file: { content: "edited", blobSha: `blob-${sha}`, commitSha: sha },
      });

      bench.repo.refusal = refused();

      expect(await bench.projector.read(doc, version)).toBeNull();
    });
  });

  describe("recording a drift", () => {
    it("moves a committed version to drift_detected at the commit it was seen at", async () => {
      const bench = await stored();

      bench.store.policy.set(ORG, { directCommit: true });
      await bench.projector.settle(rows(bench).doc, rows(bench).version);

      const { doc, version } = rows(bench);
      const seen = "b".repeat(40);
      const projection = await bench.projector.markDrift(doc, version, seen);

      expect(projection).toEqual({
        ...version.projection,
        state: "drift_detected",
        observed_sha: seen,
      });
      expect(bench.store.current()?.projection).toEqual(projection);
    });

    it("falls back to the committed sha when the repository was not read", async () => {
      const bench = await stored();

      bench.store.policy.set(ORG, { directCommit: true });
      await bench.projector.settle(rows(bench).doc, rows(bench).version);

      const { doc, version } = rows(bench);

      expect((await bench.projector.markDrift(doc, version, null)).observed_sha).toBe(
        version.projection.committed_sha,
      );
      expect((await bench.projector.markDrift(doc, version, "not-a-sha")).observed_sha).toBe(
        version.projection.committed_sha,
      );
    });

    it("leaves a version that is not committed alone", async () => {
      const bench = await stored();
      const { doc, version } = rows(bench);

      expect(await bench.projector.markDrift(doc, version, "b".repeat(40))).toEqual(
        version.projection,
      );
      expect(bench.store.current()?.projection.state).toBe("pending");
    });
  });

  describe("what the pull request says", () => {
    it("names the version, counts what is in it, and warns against hand edits", async () => {
      const bench = await stored();
      const { doc, version } = rows(bench);

      expect(roadmapBranch(DOC)).toBe(BRANCH);
      expect(prTitle(doc, version)).toBe("docs: Helios — Q4 Improvement Roadmap (v1)");
      expect(prBody(doc, version)).toBe(
        [
          "**Helios — Q4 Improvement Roadmap** — version 1, generated by `create-roadmap@v1`.",
          "",
          "2 milestones · 6 items",
          "",
          "`docs/ROADMAP.md` is a projection of the roadmap Ouroboros holds. To change it, suggest a change on the Research page and apply it; a hand edit of the file is reported as drift.",
        ].join("\n"),
      );
    });

    it("keeps a long title within the host's bound and counts singulars", async () => {
      const bench = await stored();
      const { doc, version } = rows(bench);
      const one = {
        ...version,
        structure: {
          milestones: [
            {
              ...version.structure.milestones[0],
              items: [version.structure.milestones[0].items[0]],
            },
          ],
        },
      };

      expect(prTitle({ ...doc, title: "x".repeat(300) }, version)).toHaveLength(256);
      expect(prBody(doc, one)).toContain("1 milestone · 1 item\n");
    });
  });
});
