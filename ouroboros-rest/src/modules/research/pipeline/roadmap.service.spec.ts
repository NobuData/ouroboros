import { ConflictError } from "../../errors/error.envelope";
import { BRIEF_MARKDOWN, pipelineBench } from "./pipeline.bench.fixture";
import { PIPELINE_ERRORS, skillFailed } from "./pipeline.errors";
import {
  DOC,
  INVESTIGATION,
  ORG,
  SOURCE,
  USER,
  refused,
  roadmapRun,
  rs124Roadmap,
  rs124RoadmapWithGustInMvp,
} from "./pipeline.fixture";
import { previousView, suggestionInput } from "./roadmap.service";
import { itemsOf, mergeRoadmap } from "./roadmap.structure";

const OTHER_ORG = "org-elsewhere";
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

/** A bench with RS-124's v1 generated. */
async function generated() {
  const bench = pipelineBench();

  bench.skills.answer(roadmapRun(rs124Roadmap()));
  await bench.roadmap.generate(ORG, INVESTIGATION);

  return bench;
}

/** The code a rejected promise carries. */
async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return (error as { code: string }).code;
  }

  throw new Error("expected a refusal");
}

describe("the roadmap document service", () => {
  describe("generating", () => {
    it("stores v1 under the skill's title, targeted at the workspace's only source", async () => {
      const bench = await generated();

      expect(bench.store.docs.get(DOC)).toMatchObject({
        title: "Helios — Q4 Improvement Roadmap",
        currentVersion: 1,
        targetSourceId: SOURCE,
        batchId: null,
      });
      expect(bench.store.versions[0]).toMatchObject({
        version: 1,
        generatedBy: "create-roadmap@v1",
      });
      expect(
        bench.store.versions[0]?.markdown.startsWith("# Helios — Q4 Improvement Roadmap\n\n## M1"),
      ).toBe(true);
    });

    it("hands the skill the brief, the investigation's own outline and the date", async () => {
      const bench = pipelineBench();

      bench.store.inputs.set(INVESTIGATION, { title: "Q4", themes: [] });
      bench.skills.answer(roadmapRun(rs124Roadmap()));
      await bench.roadmap.generate(ORG, INVESTIGATION);

      expect(bench.skills.calls[0]).toEqual({
        slug: "create-roadmap",
        output: "roadmap",
        run: INVESTIGATION,
        input: {
          investigation: "RS-124",
          question: "What should Helios ship next quarter?",
          today: "2026-10-01",
          brief: BRIEF_MARKDOWN,
          outline: { title: "Q4", themes: [] },
          previous: null,
          suggestions: [],
        },
      });
    });

    it("stamps the workspace's skill version", async () => {
      const bench = pipelineBench();

      bench.skills.versions["create-roadmap"] = 7;
      bench.skills.answer(roadmapRun(rs124Roadmap()));

      expect((await bench.roadmap.generate(ORG, INVESTIGATION)).doc.generatedBy).toBe(
        "create-roadmap@v7",
      );
    });

    it("writes where the request says", async () => {
      const bench = pipelineBench();

      bench.skills.answer(roadmapRun(rs124Roadmap()));

      const card = await bench.roadmap.generate(ORG, INVESTIGATION, {
        path: "ROADMAP.md",
        targetSourceId: SOURCE,
      });

      expect(card.projection.path).toBe("ROADMAP.md");
      expect(bench.repo.branches.get("ouroboros/roadmap-5eed0097")?.has("ROADMAP.md")).toBe(true);
    });

    it("refuses a second roadmap for the same investigation, before running anything", async () => {
      const bench = await generated();

      expect(await codeOf(bench.roadmap.generate(ORG, INVESTIGATION))).toBe(
        PIPELINE_ERRORS.roadmapExists,
      );
      expect(bench.skills.calls).toHaveLength(1);
    });

    it("reads a lost creation race as the same refusal", async () => {
      const bench = pipelineBench();

      bench.skills.answer(roadmapRun(rs124Roadmap()));
      bench.store.createDoc = () =>
        Promise.reject(
          Object.assign(new Error("duplicate"), { constraint: "roadmap_docs_investigation_key" }),
        );

      expect(await codeOf(bench.roadmap.generate(ORG, INVESTIGATION))).toBe(
        PIPELINE_ERRORS.roadmapExists,
      );
    });

    it("does not swallow any other storage failure", async () => {
      const bench = pipelineBench();

      bench.skills.answer(roadmapRun(rs124Roadmap()));
      bench.store.createDoc = () => Promise.reject(new Error("the database went away"));

      await expect(bench.roadmap.generate(ORG, INVESTIGATION)).rejects.toThrow(
        "the database went away",
      );
    });

    it("answers 404 for an investigation of another workspace", async () => {
      const bench = pipelineBench();

      expect(await codeOf(bench.roadmap.generate(OTHER_ORG, INVESTIGATION))).toBe(
        PIPELINE_ERRORS.investigationNotFound,
      );
      expect(bench.skills.calls).toEqual([]);
    });

    it("needs to be told the source when the workspace has none, or several", async () => {
      const none = pipelineBench();

      none.store.sourceRows.length = 0;
      await expect(none.roadmap.generate(ORG, INVESTIGATION)).rejects.toMatchObject({
        code: PIPELINE_ERRORS.targetRequired,
        details: { candidates: 0 },
      });

      const two = pipelineBench();

      two.store.sourceRows.push({
        id: "source-2",
        organizationId: ORG,
        kind: "jira",
        displayName: "Jira",
      });
      await expect(two.roadmap.generate(ORG, INVESTIGATION)).rejects.toMatchObject({
        code: PIPELINE_ERRORS.targetRequired,
        details: { candidates: 2 },
      });

      two.skills.answer(roadmapRun(rs124Roadmap()));

      expect(
        (await two.roadmap.generate(ORG, INVESTIGATION, { targetSourceId: SOURCE })).doc
          .targetSourceId,
      ).toBe(SOURCE);
    });

    it("refuses a source the workspace does not have", async () => {
      const bench = pipelineBench();

      expect(
        await codeOf(bench.roadmap.generate(ORG, INVESTIGATION, { targetSourceId: UNKNOWN })),
      ).toBe(PIPELINE_ERRORS.sourceNotFound);
    });

    it("stores nothing when the skill cannot be run", async () => {
      const bench = pipelineBench();

      bench.skills.answer(
        skillFailed("create-roadmap", "gateway_unavailable", "The gateway is not available."),
      );

      await expect(bench.roadmap.generate(ORG, INVESTIGATION)).rejects.toMatchObject({
        code: PIPELINE_ERRORS.skillFailed,
        details: { slug: "create-roadmap", reason: "gateway_unavailable" },
      });
      expect(bench.store.docs.size).toBe(0);
      expect(bench.repo.log).toEqual([]);
    });

    it.each([
      ["no roadmap at all", null],
      ["a roadmap V113 would refuse", { ...rs124Roadmap(), milestones: [] }],
    ])("stores nothing when the run answers %s", async (_name, roadmap) => {
      const bench = pipelineBench();

      bench.skills.answer({ ...roadmapRun(rs124Roadmap()), roadmap });

      expect(await codeOf(bench.roadmap.generate(ORG, INVESTIGATION))).toBe(
        PIPELINE_ERRORS.outputInvalid,
      );
      expect(bench.store.docs.size).toBe(0);
    });
  });

  describe("projecting a fresh version", () => {
    it("keeps the document and says why when the repository refuses", async () => {
      const bench = pipelineBench();

      bench.repo.refusal = refused("permission");
      bench.skills.answer(roadmapRun(rs124Roadmap()));

      const card = await bench.roadmap.generate(ORG, INVESTIGATION);

      expect(card.doc.version).toBe(1);
      expect(card.projection.state).toBe("pending");
      expect(card.projection.problem).toContain("permission");
      expect(card.projection.label).toBe("docs/ROADMAP.md · not in the repository yet");
    });
  });

  describe("the card", () => {
    it("draws milestones, due labels and counts", async () => {
      const bench = await generated();
      const card = await bench.roadmap.card(ORG, INVESTIGATION);

      expect(card.investigation).toEqual({ id: INVESTIGATION, displayId: "RS-124" });
      expect(card.milestones.map((m) => [m.key, m.dueLabel, m.done, m.total])).toEqual([
        ["m1", "due Oct 15", 0, 3],
        ["m2", "due Nov 20", 0, 3],
      ]);
      expect(card.issues).toEqual({
        batchId: null,
        filed: 0,
        total: 6,
        label: "0 issues · 2 milestones",
      });
      expect(card.milestones[0]?.items[0]).toMatchObject({
        ticket: null,
        estimate: null,
        draftId: null,
      });
      expect(card.suggestions).toEqual({ open: 0, items: [] });
    });

    it("is not found before a roadmap exists, or from another workspace", async () => {
      const bench = pipelineBench();

      expect(await codeOf(bench.roadmap.card(ORG, INVESTIGATION))).toBe(
        PIPELINE_ERRORS.roadmapNotFound,
      );

      const made = await generated();

      expect(await codeOf(made.roadmap.card(OTHER_ORG, INVESTIGATION))).toBe(
        PIPELINE_ERRORS.investigationNotFound,
      );
    });
  });

  describe("suggestions", () => {
    it("stores a person's suggestion open, trimmed, with their initials", async () => {
      const bench = await generated();
      const suggestion = await bench.roadmap.suggest(ORG, USER, INVESTIGATION, {
        text: "  Pull the gust estimator into MVP.  ",
      });

      expect(suggestion).toMatchObject({
        authorKind: "user",
        authorLabel: "KS",
        authorName: "Ken Suenobu",
        text: "Pull the gust estimator into MVP.",
        hint: null,
        status: "open",
        appliedVersion: null,
      });
      expect((await bench.roadmap.card(ORG, INVESTIGATION)).suggestions.open).toBe(1);
      expect(bench.store.versions).toHaveLength(1);
    });

    it("raises the product's own as the AI's, under its agent", async () => {
      const bench = await generated();

      await bench.roadmap.raise(DOC, "estimator", "Split the battery model.", {
        item: "fleet-battery",
      });

      expect((await bench.roadmap.card(ORG, INVESTIGATION)).suggestions.items[0]).toMatchObject({
        authorKind: "ai",
        authorLabel: "AI",
        authorName: "estimator",
        hint: { item: "fleet-battery" },
      });
    });

    it("re-runs with every earlier applied suggestion, in the order they were applied", async () => {
      const bench = await generated();
      const first = await bench.roadmap.suggest(ORG, USER, INVESTIGATION, { text: "First." });
      const second = await bench.roadmap.raise(DOC, "estimator", "Second.");

      bench.skills.answer(roadmapRun(rs124Roadmap()), roadmapRun(rs124RoadmapWithGustInMvp()));
      await bench.roadmap.apply(ORG, USER, INVESTIGATION, first.id);
      await bench.roadmap.apply(ORG, USER, INVESTIGATION, second.id);

      expect(bench.skills.calls[1]?.input.suggestions).toEqual([
        { from: "a person", text: "First." },
      ]);
      expect(bench.skills.calls[2]?.input.suggestions).toEqual([
        { from: "a person", text: "First." },
        { from: "estimator", text: "Second." },
      ]);
      expect(bench.skills.calls[2]?.run).toBe(DOC);
      expect(bench.store.docs.get(DOC)?.currentVersion).toBe(3);
    });

    it("takes a new title from the re-run", async () => {
      const bench = await generated();
      const suggestion = await bench.roadmap.suggest(ORG, USER, INVESTIGATION, {
        text: "Rename it.",
      });

      bench.skills.answer(roadmapRun({ ...rs124Roadmap(), title: "Helios — Winter Roadmap" }));

      const card = await bench.roadmap.apply(ORG, USER, INVESTIGATION, suggestion.id);

      expect(card.doc.title).toBe("Helios — Winter Roadmap");
      expect(card.markdown.startsWith("# Helios — Winter Roadmap\n")).toBe(true);
    });

    it("leaves the suggestion open and the document alone when the re-run fails", async () => {
      const bench = await generated();
      const suggestion = await bench.roadmap.suggest(ORG, USER, INVESTIGATION, { text: "Change." });

      bench.skills.answer(skillFailed("create-roadmap", "skill_output_invalid", "No."));

      expect(await codeOf(bench.roadmap.apply(ORG, USER, INVESTIGATION, suggestion.id))).toBe(
        PIPELINE_ERRORS.skillFailed,
      );
      expect(bench.store.suggestionRows[0]?.status).toBe("open");
      expect(bench.store.versions).toHaveLength(1);
    });

    it("answers a conflict when the document moved while the skill ran", async () => {
      const bench = await generated();
      const suggestion = await bench.roadmap.suggest(ORG, USER, INVESTIGATION, { text: "Change." });

      bench.skills.answer(roadmapRun(rs124Roadmap()));
      bench.store.raceNext = true;

      const error = await bench.roadmap
        .apply(ORG, USER, INVESTIGATION, suggestion.id)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as { code: string }).code).toBe(PIPELINE_ERRORS.versionConflict);
      expect(bench.store.suggestionRows[0]?.status).toBe("open");
    });

    it("applies or dismisses a suggestion once", async () => {
      const bench = await generated();
      const applied = await bench.roadmap.suggest(ORG, USER, INVESTIGATION, { text: "A." });
      const dismissed = await bench.roadmap.suggest(ORG, USER, INVESTIGATION, { text: "B." });

      bench.skills.answer(roadmapRun(rs124Roadmap()));
      await bench.roadmap.apply(ORG, USER, INVESTIGATION, applied.id);
      await bench.roadmap.dismiss(ORG, USER, INVESTIGATION, dismissed.id);

      for (const id of [applied.id, dismissed.id]) {
        expect(await codeOf(bench.roadmap.apply(ORG, USER, INVESTIGATION, id))).toBe(
          PIPELINE_ERRORS.suggestionSettled,
        );
        expect(await codeOf(bench.roadmap.dismiss(ORG, USER, INVESTIGATION, id))).toBe(
          PIPELINE_ERRORS.suggestionSettled,
        );
      }
      expect(await codeOf(bench.roadmap.apply(ORG, USER, INVESTIGATION, UNKNOWN))).toBe(
        PIPELINE_ERRORS.suggestionNotFound,
      );
      expect(bench.skills.calls).toHaveLength(2);
    });

    it("audits a dismissal with what was turned down, and changes no version", async () => {
      const bench = await generated();
      const suggestion = await bench.roadmap.raise(DOC, "estimator", "Split the battery model.");
      const card = await bench.roadmap.dismiss(ORG, USER, INVESTIGATION, suggestion.id);

      expect(card.suggestions.items[0]?.status).toBe("dismissed");
      expect(card.doc.version).toBe(1);
      expect(bench.audits).toEqual([
        expect.objectContaining({
          organizationId: ORG,
          actorId: USER,
          action: "roadmap.suggestion_dismissed",
          subjectType: "roadmap_doc",
          subjectId: DOC,
          detail: {
            suggestionId: suggestion.id,
            authorKind: "ai",
            authorAgent: "estimator",
            text: "Split the battery model.",
            version: 1,
          },
        }),
      ]);
    });

    it("reports a dismissal that lost a race as settled, and audits nothing", async () => {
      const bench = await generated();
      const suggestion = await bench.roadmap.suggest(ORG, USER, INVESTIGATION, { text: "A." });

      bench.store.dismissSuggestion = () => Promise.resolve(false);

      expect(await codeOf(bench.roadmap.dismiss(ORG, USER, INVESTIGATION, suggestion.id))).toBe(
        PIPELINE_ERRORS.suggestionSettled,
      );
      expect(bench.audits).toEqual([]);
    });
  });

  describe("the policy", () => {
    it("is off until someone turns it on, and audits each change once", async () => {
      const bench = pipelineBench();

      expect(await bench.roadmap.settings(ORG)).toEqual({ directCommit: false });
      expect(await bench.roadmap.saveSettings(ORG, USER, true)).toEqual({ directCommit: true });
      expect(await bench.roadmap.saveSettings(ORG, USER, true)).toEqual({ directCommit: true });
      expect(await bench.roadmap.settings(ORG)).toEqual({ directCommit: true });
      expect(await bench.roadmap.settings(OTHER_ORG)).toEqual({ directCommit: false });
      expect(bench.audits).toEqual([
        expect.objectContaining({
          action: "roadmap.policy_updated",
          subjectType: "roadmap_pipeline_settings",
          subjectId: ORG,
          actorId: USER,
          detail: { previousDirectCommit: false, directCommit: true },
        }),
      ]);
    });
  });

  describe("what the skill is shown", () => {
    it("shows a version without internal ids — issue keys and done states only", () => {
      const structure = mergeRoadmap(rs124Roadmap(), null);
      const first = itemsOf(structure)[0].item;

      Object.assign(first, {
        draft_id: "d-1",
        ticket_id: "t-742",
        ticket_key: "#742",
        checked: true,
      });

      const view = JSON.stringify(previousView("Helios", structure));

      expect(view).toContain('"issue":"#742"');
      expect(view).toContain('"done":true');
      expect(view).not.toContain("d-1");
      expect(view).not.toContain("t-742");
    });

    it("names who asked, and passes a hint only when there is one", () => {
      const base = {
        id: "s",
        docId: DOC,
        authorUserId: null,
        authorName: null,
        text: "Do it.",
        status: "open" as const,
        appliedVersion: null,
        appliedAt: null,
        dismissedAt: null,
        createdAt: new Date(),
      };

      expect(
        suggestionInput({ ...base, authorKind: "user", authorAgent: null, hint: null }),
      ).toEqual({
        from: "a person",
        text: "Do it.",
      });
      expect(
        suggestionInput({ ...base, authorKind: "ai", authorAgent: null, hint: { a: 1 } }),
      ).toEqual({
        from: "ai",
        text: "Do it.",
        hint: { a: 1 },
      });
    });
  });
});
