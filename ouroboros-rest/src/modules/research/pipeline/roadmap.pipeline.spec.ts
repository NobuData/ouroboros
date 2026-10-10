/**
 * The pipeline, end to end (#624's acceptance fixture): brief → doc v1 → PR open → apply the
 * human suggestion → v2 (a re-run, not a patch) → create-issues files six issues under two
 * milestones → writeback v3 → v3 ≡ tracker; filing again files nothing; a tracker-side change
 * raises exactly one suggestion and rewrites nothing.
 */

import { BRIEF_MARKDOWN, pipelineBench, type PipelineBench } from "./pipeline.bench.fixture";
import {
  DOC,
  INVESTIGATION,
  ORG,
  USER,
  issuesRun,
  roadmapRun,
  rs124Roadmap,
  rs124RoadmapWithGustInMvp,
} from "./pipeline.fixture";
import { itemsOf } from "./roadmap.structure";

const ITEM_KEYS = [
  "dock-mpc",
  "dock-retry",
  "dock-gust",
  "fleet-battery",
  "fleet-gaps",
  "fleet-playbook",
];

/** Run the pipeline up to the writeback, and answer the bench at v3. */
async function filedPipeline(): Promise<PipelineBench> {
  const bench = pipelineBench();

  bench.skills.answer(
    roadmapRun(rs124Roadmap()),
    roadmapRun(rs124RoadmapWithGustInMvp()),
    issuesRun(ITEM_KEYS),
  );

  await bench.roadmap.generate(ORG, INVESTIGATION);

  const suggestion = await bench.roadmap.suggest(ORG, USER, INVESTIGATION, {
    text: "Pull the gust estimator into the M1 MVP set.",
    hint: { item: "dock-gust", change: "mvp", to: true },
  });

  await bench.roadmap.apply(ORG, USER, INVESTIGATION, suggestion.id);
  await bench.issues.file(ORG, USER, INVESTIGATION);
  bench.planning.size("batch-1");
  await bench.issues.file(ORG, USER, INVESTIGATION);

  return bench;
}

describe("the roadmap pipeline, end to end", () => {
  it("generates v1 from the brief export and opens a pull request for it", async () => {
    const bench = pipelineBench();

    bench.skills.answer(roadmapRun(rs124Roadmap()));

    const card = await bench.roadmap.generate(ORG, INVESTIGATION);

    expect(card.doc).toMatchObject({ id: DOC, version: 1, generatedBy: "create-roadmap@v1" });
    expect(card.projection).toMatchObject({
      state: "pr_open",
      path: "docs/ROADMAP.md",
      prRef: "#88",
      label: "docs/ROADMAP.md · pull request #88 open",
      problem: null,
    });
    expect(bench.skills.calls[0]).toMatchObject({
      slug: "create-roadmap",
      output: "roadmap",
      input: { brief: BRIEF_MARKDOWN, previous: null, suggestions: [], today: "2026-10-01" },
    });
    expect(bench.repo.branches.get("main")?.size).toBe(0);
    expect(
      bench.repo.branches.get("ouroboros/roadmap-5eed0097")?.get("docs/ROADMAP.md")?.content,
    ).toBe(card.markdown);
    expect(card.markdown).toContain("## M1 · Docking parity — target Oct 15");
    expect(card.markdown).toContain("- [ ] Gust estimator from IMU residuals `M`");
  });

  it("applies the human suggestion by re-running the skill, producing v2", async () => {
    const bench = pipelineBench();

    bench.skills.answer(roadmapRun(rs124Roadmap()), roadmapRun(rs124RoadmapWithGustInMvp()));
    await bench.roadmap.generate(ORG, INVESTIGATION);

    const suggestion = await bench.roadmap.suggest(ORG, USER, INVESTIGATION, {
      text: "Pull the gust estimator into the M1 MVP set.",
      hint: { item: "dock-gust", change: "mvp", to: true },
    });
    const card = await bench.roadmap.apply(ORG, USER, INVESTIGATION, suggestion.id);

    // A re-run: the skill was asked again, shown v1 and the suggestion.
    const rerun = bench.skills.calls[1];

    expect(rerun?.input.suggestions).toEqual([
      {
        from: "a person",
        text: "Pull the gust estimator into the M1 MVP set.",
        hint: { item: "dock-gust", change: "mvp", to: true },
      },
    ]);
    expect(rerun?.input.previous).toMatchObject({
      title: "Helios — Q4 Improvement Roadmap",
      milestones: [{ key: "m1" }, { key: "m2" }],
    });

    // Not a patch: v1 is untouched and v2 is exactly what the skill answered.
    expect(card.doc.version).toBe(2);
    expect(card.doc.generatedBy).toBe(`create-roadmap@v1 · suggestion ${suggestion.id}`);
    expect(bench.store.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(
      itemsOf(bench.store.versions[0].structure).find(({ item }) => item.key === "dock-gust")?.item
        .mvp,
    ).toBe(false);
    expect(card.milestones[0]?.items[2]).toMatchObject({ key: "dock-gust", mvp: true });
    expect(card.suggestions.items[0]).toMatchObject({ status: "applied", appliedVersion: 2 });
    expect(card.suggestions.open).toBe(0);

    // The same branch and the same pull request, now proposing v2.
    expect(card.projection).toMatchObject({ state: "pr_open", prRef: "#88" });
    expect(bench.repo.prs).toHaveLength(1);
    expect(bench.repo.prs[0]?.title).toBe("docs: Helios — Q4 Improvement Roadmap (v2)");
  });

  it("files six issues under two dated milestones and writes them back as v3", async () => {
    const bench = pipelineBench();

    bench.skills.answer(
      roadmapRun(rs124Roadmap()),
      roadmapRun(rs124RoadmapWithGustInMvp()),
      issuesRun(ITEM_KEYS),
    );
    await bench.roadmap.generate(ORG, INVESTIGATION);

    const suggestion = await bench.roadmap.suggest(ORG, USER, INVESTIGATION, {
      text: "Gust into MVP.",
    });

    await bench.roadmap.apply(ORG, USER, INVESTIGATION, suggestion.id);

    // The first call drafts and waits for the one sizer.
    const waiting = await bench.issues.file(ORG, USER, INVESTIGATION);

    expect(waiting).toMatchObject({ stage: "sizing", unsized: 6, wroteVersion: false });
    expect(bench.planning.pushes).toEqual([]);
    expect(bench.store.tickets.size).toBe(0);

    const batch = bench.planning.batches.get("batch-1");

    expect(batch?.input.planner).toBe("create-roadmap-v1");
    expect(batch?.input.prompt).toBe(
      "RS-124 brief → ROADMAP.md → create-issues: 2 milestones, 6 issues.",
    );
    expect(
      batch?.input.drafts.map((draft) => [draft.localKey, draft.milestone, draft.labels]),
    ).toEqual([
      ["RM-1", { name: "Docking parity", dueOn: "2026-10-15" }, ["mvp"]],
      ["RM-2", { name: "Docking parity", dueOn: "2026-10-15" }, ["mvp"]],
      ["RM-3", { name: "Docking parity", dueOn: "2026-10-15" }, ["mvp"]],
      ["RM-4", { name: "Fleet reliability", dueOn: "2026-11-20" }, []],
      ["RM-5", { name: "Fleet reliability", dueOn: "2026-11-20" }, []],
      ["RM-6", { name: "Fleet reliability", dueOn: "2026-11-20" }, []],
    ]);

    bench.planning.size("batch-1");

    const filed = await bench.issues.file(ORG, USER, INVESTIGATION);

    expect(filed).toMatchObject({ stage: "filed", wroteVersion: true, unsized: 0, undrafted: [] });
    expect(filed.roadmap.doc).toMatchObject({
      version: 3,
      generatedBy: "create-issues@v1 · writeback",
    });
    expect(filed.roadmap.issues).toMatchObject({
      batchId: "batch-1",
      filed: 6,
      total: 6,
      label: "6 issues · 2 milestones",
    });
    expect(
      filed.roadmap.milestones.flatMap((milestone) =>
        milestone.items.map((item) => item.ticket?.key),
      ),
    ).toEqual(["#742", "#743", "#744", "#745", "#746", "#747"]);

    // Two milestones, each with its due date, as the tracker was told.
    expect(
      new Set([...bench.planning.milestones.values()].map((entry) => JSON.stringify(entry))),
    ).toEqual(
      new Set([
        JSON.stringify({ name: "Docking parity", dueOn: "2026-10-15" }),
        JSON.stringify({ name: "Fleet reliability", dueOn: "2026-11-20" }),
      ]),
    );

    // Estimator fields come from the tracker's estimate — nothing here computed one.
    expect(filed.roadmap.milestones[0]?.items[0]?.estimate).toEqual({
      effort: "m",
      complexity: "medium",
      estMinutes: 2160,
      loopDays: 1.5,
    });
    expect(filed.roadmap.markdown).toContain(
      "- [ ] #744 Gust estimator from IMU residuals `MVP` `M`",
    );
    expect(bench.store.investigations.get(INVESTIGATION)?.status).toBe("issues_filed");

    // The writeback is projected too: the pull request now proposes v3.
    expect(bench.repo.prs[0]?.title).toBe("docs: Helios — Q4 Improvement Roadmap (v3)");
  });

  it("verifies v3 identical to the tracker", async () => {
    const bench = await filedPipeline();

    const check = await bench.drift.check(ORG, INVESTIGATION);

    expect(check.identical).toBe(true);
    expect(check.differences).toEqual([]);
    expect(check.raised).toBeNull();
    expect(check.roadmap.doc.version).toBe(3);
  });

  it("files nothing twice when create-issues is run again", async () => {
    const bench = await filedPipeline();
    const before = {
      tickets: bench.store.tickets.size,
      versions: bench.store.versions.length,
      pushes: bench.planning.pushes.length,
      runs: bench.skills.calls.length,
      batches: bench.planning.batches.size,
    };

    const again = await bench.issues.file(ORG, USER, INVESTIGATION);

    expect(again).toMatchObject({ stage: "filed", wroteVersion: false });
    expect({
      tickets: bench.store.tickets.size,
      versions: bench.store.versions.length,
      pushes: bench.planning.pushes.length,
      runs: bench.skills.calls.length,
      batches: bench.planning.batches.size,
    }).toEqual(before);
  });

  it("raises exactly one suggestion for a tracker-side change, and rewrites nothing", async () => {
    const bench = await filedPipeline();

    bench.repo.merge(88);
    await bench.drift.check(ORG, INVESTIGATION);

    const committed = bench.store.current();

    expect(committed?.projection.state).toBe("committed");

    // Someone closes #744 and retitles #745 in the tracker.
    bench.store.trackerChange("#744", { state: "closed" });
    bench.store.trackerChange("#745", { title: "Battery health model v3" });

    const versions = bench.store.versions.length;
    const file = bench.repo.branches.get("main")?.get("docs/ROADMAP.md")?.content;
    const first = await bench.drift.check(ORG, INVESTIGATION);
    const second = await bench.drift.check(ORG, INVESTIGATION);

    expect(first.identical).toBe(false);
    expect(first.differences.map((difference) => [difference.ticketKey, difference.field])).toEqual(
      [
        ["#744", "state"],
        ["#745", "title"],
      ],
    );
    expect(first.raised).toMatchObject({
      authorKind: "ai",
      authorLabel: "AI",
      authorName: "drift-detector",
      status: "open",
    });
    expect(first.raised?.text).toContain("#744 is done in the tracker and open in the document");
    expect(first.roadmap.projection.state).toBe("drift_detected");

    // The second check sees the same drift and adds nothing.
    expect(second.identical).toBe(false);
    expect(second.raised).toBeNull();
    expect(
      bench.store.suggestionRows.filter((row) => row.authorAgent === "drift-detector"),
    ).toHaveLength(1);

    // Never a silent rewrite: no version, no file change, the stored structure as it was.
    expect(bench.store.versions).toHaveLength(versions);
    expect(bench.repo.branches.get("main")?.get("docs/ROADMAP.md")?.content).toBe(file);
    expect(bench.store.current()?.structure).toEqual(committed?.structure);
  });

  it("resolves the drift by applying its suggestion — a re-run that takes the tracker's state", async () => {
    const bench = await filedPipeline();

    bench.repo.merge(88);
    await bench.drift.check(ORG, INVESTIGATION);
    bench.store.trackerChange("#744", { state: "closed" });

    const drift = await bench.drift.check(ORG, INVESTIGATION);

    bench.skills.answer(roadmapRun(rs124RoadmapWithGustInMvp()));

    const card = await bench.roadmap.apply(ORG, USER, INVESTIGATION, drift.raised!.id);

    expect(card.doc.version).toBe(4);
    expect(card.milestones[0]?.items[2]).toMatchObject({ key: "dock-gust", checked: true });
    expect(card.milestones[0]?.items[2]?.ticket?.key).toBe("#744");
    expect((await bench.drift.check(ORG, INVESTIGATION)).identical).toBe(true);
  });
});
