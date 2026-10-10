import { pipelineBench, type PipelineBench } from "./pipeline.bench.fixture";
import { PIPELINE_ERRORS, skillFailed } from "./pipeline.errors";
import {
  DOC,
  INVESTIGATION,
  ORG,
  USER,
  issuesRun,
  roadmapRun,
  rs124Roadmap,
} from "./pipeline.fixture";
import { batchPrompt, composeDrafts, draftKey, filingsOf } from "./roadmap.issues.service";
import { itemsOf, mergeRoadmap } from "./roadmap.structure";

const KEYS = [
  "dock-mpc",
  "dock-retry",
  "dock-gust",
  "fleet-battery",
  "fleet-gaps",
  "fleet-playbook",
];
const RS124 = {
  id: INVESTIGATION,
  displayId: "RS-124",
  question: "Q",
  status: "brief_ready" as const,
};

/** A bench with v1 generated and `create-issues` scripted. */
async function generated(): Promise<PipelineBench> {
  const bench = pipelineBench();

  bench.skills.answer(roadmapRun(rs124Roadmap()), issuesRun(KEYS));
  await bench.roadmap.generate(ORG, INVESTIGATION);

  return bench;
}

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return (error as { code: string }).code;
  }

  throw new Error("expected a refusal");
}

describe("create-issues", () => {
  it("asks the skill for one description per item, shown the roadmap and the brief", async () => {
    const bench = await generated();

    await bench.issues.file(ORG, USER, INVESTIGATION);

    const run = bench.skills.calls[1];

    expect(run).toMatchObject({ slug: "create-issues", output: "issue_bodies", run: DOC });
    expect(run?.input.roadmap).toEqual({
      title: "Helios — Q4 Improvement Roadmap",
      milestones: [
        { key: "m1", name: "Docking parity", target_date: "2026-10-15" },
        { key: "m2", name: "Fleet reliability", target_date: "2026-11-20" },
      ],
    });
    expect((run?.input.items as unknown[])[0]).toEqual({
      key: "dock-mpc",
      title: "Wind-feedforward MPC in final approach",
      milestone: "Docking parity",
      mvp: true,
      effort: "l",
    });
    expect(run?.input.brief).toContain("RS-124");
  });

  it("composes one batch for the document's source and remembers it", async () => {
    const bench = await generated();
    const answer = await bench.issues.file(ORG, USER, INVESTIGATION);

    expect(answer.batchId).toBe("batch-1");
    expect(bench.store.docs.get(DOC)?.batchId).toBe("batch-1");
    expect(bench.planning.batches.get("batch-1")?.input).toMatchObject({
      planner: "create-roadmap-v1",
      targetSourceId: bench.store.docs.get(DOC)?.targetSourceId,
    });
    expect(bench.planning.batches.get("batch-1")?.input.drafts[0]).toEqual({
      localKey: "RM-1",
      title: "Wind-feedforward MPC in final approach",
      body: "## Problem\nWhat dock-mpc fixes.\n\n---\n_From the RS-124 roadmap · Docking parity · MVP_",
      milestone: { name: "Docking parity", dueOn: "2026-10-15" },
      labels: ["mvp"],
      research: {
        investigation_id: INVESTIGATION,
        origin: "roadmap",
        capability: null,
        severity: null,
        item_key: "dock-mpc",
        effort: "l",
        sources: [],
      },
    });
  });

  it("waits for the sizer, without running the skill or composing again", async () => {
    const bench = await generated();

    await bench.issues.file(ORG, USER, INVESTIGATION);

    const second = await bench.issues.file(ORG, USER, INVESTIGATION);

    expect(second).toMatchObject({
      stage: "sizing",
      unsized: 6,
      wroteVersion: false,
      undrafted: [],
    });
    expect(bench.skills.calls).toHaveLength(2);
    expect(bench.planning.batches.size).toBe(1);
    expect(bench.planning.pushes).toEqual([]);
    expect(second.roadmap.doc.version).toBe(1);
  });

  it("pushes unsized drafts only when told to", async () => {
    const bench = await generated();
    const answer = await bench.issues.file(ORG, USER, INVESTIGATION, { pushUnsized: true });

    expect(answer).toMatchObject({ stage: "filed", wroteVersion: true });
    expect(answer.roadmap.milestones[0]?.items[0]?.estimate).toBeNull();
    expect(bench.planning.pushes).toEqual(["batch-1"]);
  });

  it("writes back what a partial push filed, resumes, and finishes", async () => {
    const bench = await generated();

    await bench.issues.file(ORG, USER, INVESTIGATION);
    bench.planning.size("batch-1");
    bench.planning.pushLimit = 2;

    const partial = await bench.issues.file(ORG, USER, INVESTIGATION);

    expect(partial).toMatchObject({ stage: "partial", wroteVersion: true });
    expect(partial.roadmap.doc.version).toBe(2);
    expect(partial.roadmap.issues).toMatchObject({ filed: 2, total: 6 });
    expect(bench.store.investigations.get(INVESTIGATION)?.status).toBe("brief_ready");
    // Unpushed items already know their drafts.
    expect(partial.roadmap.milestones[1]?.items[0]).toMatchObject({
      draftId: "batch-1-draft-4",
      ticket: null,
    });

    const done = await bench.issues.file(ORG, USER, INVESTIGATION);

    expect(done).toMatchObject({ stage: "filed", wroteVersion: true });
    expect(done.roadmap.doc.version).toBe(3);
    expect(done.roadmap.issues.filed).toBe(6);
    expect(bench.store.tickets.size).toBe(6);
    expect(bench.store.investigations.get(INVESTIGATION)?.status).toBe("issues_filed");
  });

  it("takes an MVP flag and a done state from the issue at the moment it is first filed", async () => {
    const bench = await generated();

    await bench.issues.file(ORG, USER, INVESTIGATION);
    bench.planning.size("batch-1");

    const push = bench.planning.push.bind(bench.planning);

    bench.planning.push = async (organizationId, batchId) => {
      const result = await push(organizationId, batchId);

      // The tracker adopted an existing, already-closed issue without the label for #742.
      bench.store.trackerChange("#742", { state: "closed", labels: [] });

      return result;
    };

    const answer = await bench.issues.file(ORG, USER, INVESTIGATION);

    expect(answer.roadmap.milestones[0]?.items[0]).toMatchObject({ mvp: false, checked: true });
    expect(answer.roadmap.markdown).toContain(
      "- [x] #742 Wind-feedforward MPC in final approach `L`",
    );
  });

  it("does not absorb a later tracker change into another writeback", async () => {
    const bench = await generated();

    await bench.issues.file(ORG, USER, INVESTIGATION, { pushUnsized: true });
    bench.store.trackerChange("#743", { state: "closed", labels: [] });

    const again = await bench.issues.file(ORG, USER, INVESTIGATION);

    expect(again.wroteVersion).toBe(false);
    expect(again.roadmap.milestones[0]?.items[1]).toMatchObject({ mvp: true, checked: false });
  });

  it("lists items that joined the roadmap after the batch was composed", async () => {
    const bench = await generated();

    await bench.issues.file(ORG, USER, INVESTIGATION, { pushUnsized: true });

    const suggestion = await bench.roadmap.suggest(ORG, USER, INVESTIGATION, {
      text: "Add an item.",
    });
    const wider = rs124Roadmap();

    wider.milestones[1].items.push({
      key: "fleet-ota",
      title: "OTA rollback",
      mvp: false,
      effort: "s",
    });
    bench.skills.answer(roadmapRun(wider));
    await bench.roadmap.apply(ORG, USER, INVESTIGATION, suggestion.id);

    const answer = await bench.issues.file(ORG, USER, INVESTIGATION);

    expect(answer).toMatchObject({
      stage: "partial",
      undrafted: ["fleet-ota"],
      wroteVersion: false,
    });
    expect(bench.planning.batches.size).toBe(1);
  });

  it("files nothing when the skill cannot be run", async () => {
    const bench = pipelineBench();

    bench.skills.answer(
      roadmapRun(rs124Roadmap()),
      skillFailed("create-issues", "gateway_unavailable", "The gateway is not available."),
    );
    await bench.roadmap.generate(ORG, INVESTIGATION);

    expect(await codeOf(bench.issues.file(ORG, USER, INVESTIGATION))).toBe(
      PIPELINE_ERRORS.skillFailed,
    );
    expect(bench.planning.batches.size).toBe(0);
    expect(bench.store.docs.get(DOC)?.batchId).toBeNull();
  });

  it("refuses an answer that skipped an item, composing nothing", async () => {
    const bench = pipelineBench();

    bench.skills.answer(roadmapRun(rs124Roadmap()), issuesRun(KEYS.slice(1)));
    await bench.roadmap.generate(ORG, INVESTIGATION);

    await expect(bench.issues.file(ORG, USER, INVESTIGATION)).rejects.toMatchObject({
      code: PIPELINE_ERRORS.outputInvalid,
      details: { problems: ['item "dock-mpc" has no description'] },
    });
    expect(bench.planning.batches.size).toBe(0);
  });

  it("refuses a document whose source was removed", async () => {
    const bench = await generated();

    bench.store.docs.set(DOC, { ...bench.store.docs.get(DOC)!, targetSourceId: null });

    expect(await codeOf(bench.issues.file(ORG, USER, INVESTIGATION))).toBe(
      PIPELINE_ERRORS.noTarget,
    );
  });

  it("answers a conflict when the document moved under the writeback", async () => {
    const bench = await generated();

    await bench.issues.file(ORG, USER, INVESTIGATION);
    bench.planning.size("batch-1");
    bench.store.raceNext = true;

    expect(await codeOf(bench.issues.file(ORG, USER, INVESTIGATION))).toBe(
      PIPELINE_ERRORS.versionConflict,
    );
    // The issues exist; the next call writes them back and files nothing new.
    const retry = await bench.issues.file(ORG, USER, INVESTIGATION);

    expect(retry).toMatchObject({ stage: "filed", wroteVersion: true });
    expect(bench.planning.pushes).toHaveLength(1);
  });

  it("is not found before a roadmap exists", async () => {
    expect(await codeOf(pipelineBench().issues.file(ORG, USER, INVESTIGATION))).toBe(
      PIPELINE_ERRORS.roadmapNotFound,
    );
  });

  describe("its parts", () => {
    const structure = mergeRoadmap(rs124Roadmap(), null);

    it("keys drafts by their place in the document", () => {
      expect(draftKey(1)).toBe("RM-1");
      expect(
        composeDrafts(RS124, structure, new Map(KEYS.map((key) => [key, "Body."]))).map(
          (d) => d.localKey,
        ),
      ).toEqual(["RM-1", "RM-2", "RM-3", "RM-4", "RM-5", "RM-6"]);
    });

    it("labels only MVP items, and files an undated milestone without a date", () => {
      const undated = mergeRoadmap(rs124Roadmap(), null);

      undated.milestones[1].target_date = null;

      const drafts = composeDrafts(RS124, undated, new Map(KEYS.map((key) => [key, "  Body.  "])));

      expect(drafts[2]).toMatchObject({
        labels: [],
        body: "Body.\n\n---\n_From the RS-124 roadmap · Docking parity_",
      });
      expect(drafts[3]?.milestone).toEqual({ name: "Fleet reliability", dueOn: null });
    });

    it("writes the filing line with singulars", () => {
      expect(batchPrompt("RS-124", structure)).toBe(
        "RS-124 brief → ROADMAP.md → create-issues: 2 milestones, 6 issues.",
      );
      expect(
        batchPrompt("RS-9", {
          milestones: [{ ...structure.milestones[0], items: [itemsOf(structure)[0].item] }],
        }),
      ).toBe("RS-9 brief → ROADMAP.md → create-issues: 1 milestone, 1 issue.");
    });

    it("reads filings off roadmap drafts only", () => {
      const draft = {
        id: "d-1",
        pushedTicketId: "t-742",
        pushedTicket: { externalId: "742", externalKey: "#742", url: "u" },
        research: { origin: "roadmap", itemKey: "dock-mpc" },
      };
      const filings = filingsOf({
        drafts: [
          draft,
          {
            ...draft,
            id: "d-2",
            pushedTicketId: null,
            pushedTicket: null,
            research: { origin: "roadmap", itemKey: "dock-retry" },
          },
          { ...draft, id: "d-3", research: { origin: "gap", itemKey: null } },
          { ...draft, id: "d-4", research: null },
        ] as never,
      });

      expect([...filings]).toEqual([
        ["dock-mpc", { draftId: "d-1", ticket: { id: "t-742", key: "#742" } }],
        ["dock-retry", { draftId: "d-2", ticket: null }],
      ]);
    });
  });
});
