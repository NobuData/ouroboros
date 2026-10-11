import { describe, expect, it } from "vitest";

import {
  OPEN_NO_ADDRESS,
  OPEN_PENDING,
  PIPELINE_CAPTION,
  SKILLS_HREF,
  actionName,
  appliedSuggestions,
  appliedTag,
  applyDone,
  applyRunning,
  authorTitle,
  complexityChip,
  doneLabel,
  driftSuggestion,
  effortOf,
  estimateLabel,
  metaLine,
  milestoneHeading,
  openReason,
  openSuggestions,
  pipelineCandidates,
  pipelineTitle,
  skillTitle,
  suggestionParts,
  suggestionsTitle,
  syncTag,
  trackerMilestone,
  versionTag,
} from "@/app/research/pipeline";

import {
  appliedRoadmap,
  driftedRoadmap,
  investigationRow,
  roadmapItem,
  roadmapSuggestion,
  seededRoadmap,
} from "../helpers/research";

/**
 * The pipeline card's rules (#631), without a browser: what each line of the card says for the
 * seeded roadmap, and for the states the seeded stack does not hold.
 */

describe("the head", () => {
  it("names the investigation, then the card's argument", () => {
    expect(pipelineTitle(seededRoadmap())).toBe("RS-124 — From brief to roadmap to issues");
  });

  it("has somewhere to open the document once it is in the repository", () => {
    expect(openReason(seededRoadmap())).toBeNull();
  });

  it("says why it cannot open a document that is not in the repository, or has no address", () => {
    const seeded = seededRoadmap();
    const pending = { ...seeded.projection, state: "pending" as const, href: null };
    const unaddressed = { ...seeded.projection, href: null };

    expect(openReason(seededRoadmap({ projection: pending }))).toBe(OPEN_PENDING);
    expect(openReason(seededRoadmap({ projection: unaddressed }))).toBe(OPEN_NO_ADDRESS);
  });

  it("sends a skill chip to the Knowledge registry's skills, saying which version runs", () => {
    const [createRoadmap] = seededRoadmap().skills;

    expect(SKILLS_HREF).toBe("/knowledge#skills-drafts");
    expect(skillTitle(createRoadmap!)).toBe("create-roadmap · published v1 — open in the Knowledge registry");
    expect(skillTitle({ ...createRoadmap!, version: null })).toMatch(/created in this workspace's registry on first use/);
  });
});

describe("the document", () => {
  it("writes the meta line: path, commit, origin brief", () => {
    expect(metaLine(seededRoadmap())).toBe(
      "docs/ROADMAP.md · committed 8c1b2e4 · generated from the RS-124 brief",
    );
  });

  it("tags the version an apply advances", () => {
    expect(versionTag(seededRoadmap())).toBe("v1");
    expect(versionTag(appliedRoadmap())).toBe("v2");
  });

  it("heads a milestone with its key, name and target — the day it names, wherever the reader is", () => {
    const [m1, m2] = seededRoadmap().milestones;

    expect(milestoneHeading(m1!)).toBe("M1 · Docking parity — target Oct 15");
    expect(milestoneHeading(m2!)).toBe("M2 · Fleet reliability — target Nov 20");
    expect(milestoneHeading({ ...m1!, targetDate: null })).toBe("M1 · Docking parity");
    expect(milestoneHeading({ ...m1!, targetDate: "soon" })).toBe("M1 · Docking parity");
  });
});

describe("the tracker", () => {
  it("names a milestone and counts what is done", () => {
    const [m1] = seededRoadmap().milestones;

    expect(trackerMilestone(m1!)).toBe("◆ M1 · Docking parity");
    expect(doneLabel(m1!)).toBe("1/3 done");
  });

  it.each([
    [3, "est 3.0 loop-days"],
    [1.5, "est 1.5 loop-days"],
    [1, "est 1.0 loop-day"],
    [0.5, "est 0.5 loop-day"],
  ])("writes %s loop-days as %s", (loopDays, label) => {
    const estimate = { effort: "m" as const, complexity: "medium", estMinutes: loopDays * 1440, loopDays };

    expect(estimateLabel(roadmapItem(742, { estimate }))).toBe(label);
  });

  it("says nothing of an estimate the estimator has not made", () => {
    const unsized = roadmapItem(742, { estimate: null });
    const untimed = roadmapItem(742, {
      estimate: { effort: "m", complexity: null, estMinutes: null, loopDays: null },
    });

    expect(estimateLabel(unsized)).toBeNull();
    expect(complexityChip(unsized)).toBeNull();
    expect(estimateLabel(untimed)).toBeNull();
    expect(complexityChip(untimed)).toBeNull();
  });

  it("takes the effort from the estimator once sized, and from the roadmap until then", () => {
    const estimate = { effort: "l" as const, complexity: "high", estMinutes: 4320, loopDays: 3 };

    expect(effortOf(roadmapItem(742, { effort: "m", estimate }))).toBe("L");
    expect(effortOf(roadmapItem(742, { effort: "xs", estimate: null }))).toBe("XS");
    expect(effortOf(roadmapItem(742, { effort: null, estimate: null }))).toBeNull();
  });

  it.each([
    ["low", "cx:low", "ok"],
    ["medium", "cx:med", "warn"],
    ["high", "cx:high", "err"],
    ["extreme", "cx:extreme", "neutral"],
  ])("draws complexity %s as %s", (complexity, label, tone) => {
    const estimate = { effort: "m" as const, complexity, estMinutes: 1, loopDays: 0 };

    expect(complexityChip(roadmapItem(742, { estimate }))).toEqual({ label, tone });
  });

  it("keeps the caption verbatim, estimator attribution included", () => {
    expect(PIPELINE_CAPTION).toBe(
      "create-issues writes the issue numbers, MVP flags, and descriptions back into ROADMAP.md — " +
        "the file and the tracker never drift. Dates, estimates, effort, and complexity come from the " +
        "estimator during issue creation.",
    );
  });
});

describe("the sync tag", () => {
  it("says synced only for a committed document whose every item is filed", () => {
    expect(syncTag(seededRoadmap())).toEqual({
      label: "6 issues · 2 milestones · synced",
      tone: "neutral",
      synced: true,
    });
  });

  it("says drift detected for a document in drift — never synced", () => {
    expect(syncTag(driftedRoadmap())).toEqual({
      label: "6 issues · 2 milestones · drift detected",
      tone: "warn",
      synced: false,
    });
  });

  it("says what stands between the document and the tracker otherwise", () => {
    const seeded = seededRoadmap();
    const unfiled = { batchId: null, filed: 0, total: 6, label: "0 issues · 2 milestones" };
    const partial = { ...seeded.issues, filed: 4, label: "4 issues · 2 milestones" };

    expect(syncTag(seededRoadmap({ issues: unfiled }))).toMatchObject({
      label: "0 issues · 2 milestones · not filed yet",
      tone: "neutral",
      synced: false,
    });
    expect(syncTag(seededRoadmap({ issues: partial }))).toMatchObject({
      label: "4 issues · 2 milestones · 4 of 6 filed",
      tone: "warn",
    });
    expect(syncTag(appliedRoadmap())).toMatchObject({
      label: "6 issues · 2 milestones · writeback not committed yet",
      synced: false,
    });
  });

  it("shows the detector's suggestion only while the document is in drift", () => {
    expect(driftSuggestion(driftedRoadmap())?.text).toMatch(/Reconcile ROADMAP.md/);
    expect(driftSuggestion(seededRoadmap())).toBeNull();

    const settled = driftedRoadmap();
    const dismissed = settled.suggestions.items.map((suggestion) => ({ ...suggestion, status: "dismissed" as const }));

    expect(driftSuggestion({ ...settled, suggestions: { open: 0, items: dismissed } })).toBeNull();
  });
});

describe("suggestions", () => {
  it("counts the open ones in the heading", () => {
    expect(suggestionsTitle(2)).toBe("Suggested changes — 2 open");
  });

  it("shows the open ones as they came, the applied ones newest version first, and no dismissed one", () => {
    const items = [
      roadmapSuggestion({ id: "a", status: "applied", appliedVersion: 2 }),
      roadmapSuggestion({ id: "b", status: "dismissed" }),
      roadmapSuggestion({ id: "c" }),
      roadmapSuggestion({ id: "d", status: "applied", appliedVersion: 3 }),
    ];
    const roadmap = seededRoadmap({ suggestions: { open: 1, items } });

    expect(openSuggestions(roadmap).map((suggestion) => suggestion.id)).toEqual(["c"]);
    expect(appliedSuggestions(roadmap).map((suggestion) => suggestion.id)).toEqual(["d", "a"]);
    expect(appliedTag(items[0]!)).toBe("applied · v2");
    expect(appliedTag({ ...items[0]!, appliedVersion: null })).toBe("applied");
  });

  it("tells a suggestion's issue references from its words", () => {
    expect(suggestionParts("Pull #744 into M1, after #742.")).toEqual([
      { text: "Pull ", ref: false },
      { text: "#744", ref: true },
      { text: " into M1, after ", ref: false },
      { text: "#742", ref: true },
      { text: ".", ref: false },
    ]);
    expect(suggestionParts("No reference here")).toEqual([{ text: "No reference here", ref: false }]);
  });

  it("names who suggested it, and each action by the suggestion it acts on", () => {
    expect(authorTitle(roadmapSuggestion())).toBe("Ken Suenobu");
    expect(authorTitle(roadmapSuggestion({ authorKind: "ai", authorName: null }))).toBe("Raised by the product");
    expect(authorTitle(roadmapSuggestion({ authorName: null }))).toBe("A member");
    expect(actionName("Dismiss", roadmapSuggestion({ text: "Split #745" }))).toBe("Dismiss: Split #745");
  });

  it("words a re-run as a run: the skill on a version, then the version it wrote", () => {
    expect(applyRunning(1)).toBe("Re-running create-roadmap on v1…");
    expect(applyDone(1, 2)).toBe("create-roadmap finished — v1 → v2");
  });
});

describe("which investigations are asked for a roadmap", () => {
  it("asks the ones the service links to a roadmap first, keeping the service's order otherwise", () => {
    const link = { kind: "roadmap" as const, label: "to roadmap →", roadmapDocId: "doc-1" };
    const rows = [
      investigationRow({ id: "newest" }),
      investigationRow({ id: "linked", link }),
      investigationRow({ id: "oldest", link: null }),
    ];

    expect(pipelineCandidates(rows).map((row) => row.id)).toEqual(["linked", "newest", "oldest"]);
    expect(pipelineCandidates([])).toEqual([]);
  });
});
