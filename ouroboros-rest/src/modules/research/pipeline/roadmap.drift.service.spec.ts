import { Logger } from "@nestjs/common";

import { pipelineBench, type PipelineBench } from "./pipeline.bench.fixture";
import { PIPELINE_ERRORS } from "./pipeline.errors";
import {
  DOC,
  INVESTIGATION,
  ORG,
  USER,
  issuesRun,
  refused,
  roadmapRun,
  rs124Roadmap,
} from "./pipeline.fixture";

const KEYS = [
  "dock-mpc",
  "dock-retry",
  "dock-gust",
  "fleet-battery",
  "fleet-gaps",
  "fleet-playbook",
];
const PATH = "docs/ROADMAP.md";

/** RS-124 filed as #742…#747 and its pull request merged: a committed, clean document. */
async function committed(): Promise<PipelineBench> {
  const bench = pipelineBench();

  bench.skills.answer(roadmapRun(rs124Roadmap()), issuesRun(KEYS));
  await bench.roadmap.generate(ORG, INVESTIGATION);
  await bench.issues.file(ORG, USER, INVESTIGATION, { pushUnsized: true });
  bench.repo.merge(88);
  await bench.drift.check(ORG, INVESTIGATION);

  return bench;
}

describe("the drift check", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  it("follows the merged pull request and finds a clean document identical", async () => {
    const bench = await committed();
    const check = await bench.drift.check(ORG, INVESTIGATION);

    expect(check).toMatchObject({ identical: true, differences: [], raised: null });
    expect(check.roadmap.projection.state).toBe("committed");
    expect(bench.store.suggestionRows).toEqual([]);
  });

  it("retries a projection that could not be made, and reports the reason while it still cannot", async () => {
    const bench = pipelineBench();

    bench.repo.refusal = refused("auth");
    bench.skills.answer(roadmapRun(rs124Roadmap()));
    await bench.roadmap.generate(ORG, INVESTIGATION);

    const blocked = await bench.drift.check(ORG, INVESTIGATION);

    expect(blocked.identical).toBe(true);
    expect(blocked.roadmap.projection).toMatchObject({ state: "pending" });
    expect(blocked.roadmap.projection.problem).toContain("auth");

    bench.repo.refusal = null;

    const projected = await bench.drift.check(ORG, INVESTIGATION);

    expect(projected.roadmap.projection).toMatchObject({
      state: "pr_open",
      prRef: "#88",
      problem: null,
    });
  });

  it("reports a hand-edited file at the commit it was edited in", async () => {
    const bench = await committed();
    const sha = bench.repo.handEdit(PATH, "# Someone's own roadmap\n");
    const check = await bench.drift.check(ORG, INVESTIGATION);

    expect(check.identical).toBe(false);
    expect(check.differences).toEqual([
      {
        field: "file",
        itemKey: null,
        ticketKey: null,
        document: "docs/ROADMAP.md as generated",
        tracker: `edited at ${sha.slice(0, 7)}`,
      },
    ]);
    expect(check.roadmap.projection).toMatchObject({ state: "drift_detected", observedSha: sha });
    expect(check.raised?.text).toContain("the file was edited at");
    // The file is not put back.
    expect(bench.repo.branches.get("main")?.get(PATH)?.content).toBe("# Someone's own roadmap\n");
  });

  it("reports a file that was deleted", async () => {
    const bench = await committed();

    bench.repo.branches.get("main")?.delete(PATH);

    const check = await bench.drift.check(ORG, INVESTIGATION);

    expect(check.differences[0]).toMatchObject({
      field: "file",
      tracker: "removed from the repository",
    });
    expect(check.roadmap.projection.observedSha).toBe(check.roadmap.projection.committedSha);
  });

  it("does not call an unreadable repository a drift", async () => {
    const bench = await committed();

    bench.repo.handEdit(PATH, "edited");
    bench.repo.refusal = refused("auth");

    const check = await bench.drift.check(ORG, INVESTIGATION);

    expect(check).toMatchObject({ identical: true, raised: null });
    expect(check.roadmap.projection.state).toBe("committed");
  });

  it("raises a tracker difference on a document whose pull request is still open, and leaves its state", async () => {
    const bench = pipelineBench();

    bench.skills.answer(roadmapRun(rs124Roadmap()), issuesRun(KEYS));
    await bench.roadmap.generate(ORG, INVESTIGATION);
    await bench.issues.file(ORG, USER, INVESTIGATION, { pushUnsized: true });
    bench.store.trackerChange("#742", { labels: [] });

    const check = await bench.drift.check(ORG, INVESTIGATION);

    expect(check.differences).toEqual([
      { field: "mvp", itemKey: "dock-mpc", ticketKey: "#742", document: "MVP", tracker: "not MVP" },
    ]);
    expect(check.raised).not.toBeNull();
    expect(check.roadmap.projection.state).toBe("pr_open");
  });

  it("raises again only once the standing suggestion is settled", async () => {
    const bench = await committed();

    bench.store.trackerChange("#746", { title: "Telemetry gap alarms" });

    const first = await bench.drift.check(ORG, INVESTIGATION);

    expect((await bench.drift.check(ORG, INVESTIGATION)).raised).toBeNull();

    await bench.roadmap.dismiss(ORG, USER, INVESTIGATION, first.raised!.id);

    const after = await bench.drift.check(ORG, INVESTIGATION);

    expect(after.raised).not.toBeNull();
    expect(after.raised?.id).not.toBe(first.raised?.id);
    expect(bench.store.suggestionRows.filter((row) => row.status === "open")).toHaveLength(1);
  });

  it("does not let a person's open suggestion stand in for the drift's", async () => {
    const bench = await committed();

    await bench.roadmap.suggest(ORG, USER, INVESTIGATION, { text: "Something else." });
    bench.store.trackerChange("#746", { state: "closed" });

    expect((await bench.drift.check(ORG, INVESTIGATION)).raised).not.toBeNull();
  });

  it("is not found for a workspace that does not own the investigation", async () => {
    const bench = await committed();

    await expect(bench.drift.check("org-elsewhere", INVESTIGATION)).rejects.toMatchObject({
      code: PIPELINE_ERRORS.investigationNotFound,
    });
  });

  describe("the scheduled pass", () => {
    it("checks every watched document and counts what it found", async () => {
      const bench = await committed();

      expect(await bench.drift.pass()).toEqual({ checked: 1, drifted: 0, raised: 0 });

      bench.store.trackerChange("#744", { state: "closed" });

      expect(await bench.drift.pass()).toEqual({ checked: 1, drifted: 1, raised: 1 });
      // A document already known to have drifted is not looked at again by the pass.
      expect(await bench.drift.pass()).toEqual({ checked: 0, drifted: 0, raised: 0 });
      expect(bench.store.versions.every((version) => version.docId === DOC)).toBe(true);
    });

    it("carries on past a document that cannot be checked", async () => {
      const bench = await committed();
      const watched = bench.store.watchedDocs.bind(bench.store);

      bench.store.watchedDocs = async (limit) => [
        { organizationId: ORG, investigationId: "00000000-0000-4000-8000-000000000000" },
        ...(await watched(limit)),
      ];

      expect(await bench.drift.pass()).toEqual({ checked: 1, drifted: 0, raised: 0 });
      expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
    });
  });
});
