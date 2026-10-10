import { DOC, INVESTIGATION, SOURCE, rs124Roadmap } from "./pipeline.fixture";
import {
  pendingProjection,
  type DocRow,
  type IssueRow,
  type SuggestionRow,
  type VersionRow,
} from "./pipeline.repository";
import {
  initialsOf,
  planningHref,
  projectionResource,
  roadmapResource,
  settingsResource,
  suggestionResource,
} from "./pipeline.resources";
import { itemsOf, mergeRoadmap, renderRoadmap } from "./roadmap.structure";

const RS124 = {
  id: INVESTIGATION,
  displayId: "RS-124",
  question: "Q",
  status: "issues_filed" as const,
};
const SHA = "8c1b2e40d6a5f3c19b7e2a4d8f0c6b13e5a7d9f2";

function doc(change: Partial<DocRow> = {}): DocRow {
  return {
    id: DOC,
    organizationId: "org-acme",
    investigationId: INVESTIGATION,
    title: "Helios — Q4 Improvement Roadmap",
    currentVersion: 3,
    targetSourceId: SOURCE,
    batchId: "batch-1",
    createdAt: new Date("2026-10-01T09:00:00Z"),
    ...change,
  };
}

function version(): VersionRow {
  const structure = mergeRoadmap(rs124Roadmap(), null);
  const first = itemsOf(structure)[0].item;

  Object.assign(first, { draft_id: "d-1", ticket_id: "t-742", ticket_key: "#742", checked: true });

  return {
    docId: DOC,
    version: 3,
    structure,
    markdown: renderRoadmap("Helios — Q4 Improvement Roadmap", structure),
    generatedBy: "create-issues@v1 · writeback",
    projection: { ...pendingProjection("docs/ROADMAP.md"), state: "committed", committed_sha: SHA },
    createdAt: new Date("2026-10-02T10:00:00Z"),
  };
}

const ISSUE: IssueRow = {
  id: "t-742",
  key: "#742",
  url: "https://github.com/acme-robotics/helios-firmware/issues/742",
  title: "Wind-feedforward MPC in final approach",
  state: "closed",
  labels: ["mvp"],
  estimate: { effort: "l", risk: "high", estMinutes: 4320 },
};

function suggestion(change: Partial<SuggestionRow> = {}): SuggestionRow {
  return {
    id: "s-1",
    docId: DOC,
    authorKind: "user",
    authorUserId: "user-ken",
    authorName: "Ken Suenobu",
    authorAgent: null,
    text: "Pull #744 into the M1 MVP set.",
    hint: { item: "dock-gust" },
    status: "open",
    appliedVersion: null,
    appliedAt: null,
    dismissedAt: null,
    createdAt: new Date("2026-10-03T09:00:00Z"),
    ...change,
  };
}

describe("the pipeline card", () => {
  it("draws the mockup's row: #742 est 3.0 loop-days, L, cx:high, under a dated milestone", () => {
    const card = roadmapResource(RS124, doc(), version(), [ISSUE], [suggestion()]);

    expect(card.doc).toEqual({
      id: DOC,
      title: "Helios — Q4 Improvement Roadmap",
      version: 3,
      generatedBy: "create-issues@v1 · writeback",
      generatedAt: "2026-10-02T10:00:00.000Z",
      targetSourceId: SOURCE,
    });
    expect(card.milestones[0]).toMatchObject({
      key: "m1",
      name: "Docking parity",
      targetDate: "2026-10-15",
      dueLabel: "due Oct 15",
      done: 1,
      total: 3,
    });
    expect(card.milestones[0]?.items[0]).toEqual({
      key: "dock-mpc",
      title: "Wind-feedforward MPC in final approach",
      mvp: true,
      effort: "l",
      checked: true,
      draftId: "d-1",
      ticket: { id: "t-742", key: "#742", url: ISSUE.url, state: "closed" },
      estimate: { effort: "l", complexity: "high", estMinutes: 4320, loopDays: 3 },
    });
    expect(card.issues).toEqual({
      batchId: "batch-1",
      filed: 1,
      total: 6,
      label: "1 issue · 2 milestones",
    });
    expect(card.projection.label).toBe("docs/ROADMAP.md · committed 8c1b2e4");
    expect(card.markdown).toContain("- [x] #742 Wind-feedforward MPC in final approach `MVP` `L`");
    expect(card.suggestions).toMatchObject({ open: 1 });
  });

  it("shows a filed item whose ticket the mirror has not got yet, without inventing a state", () => {
    const card = roadmapResource(RS124, doc(), version(), [], []);

    expect(card.milestones[0]?.items[0]).toMatchObject({
      ticket: { id: "t-742", key: "#742", url: null, state: null },
      estimate: null,
    });
  });

  it("rounds loop-days to one decimal, and leaves an unknown time unknown", () => {
    const rounded = roadmapResource(
      RS124,
      doc(),
      version(),
      [{ ...ISSUE, estimate: { effort: "m", risk: null, estMinutes: 2000 } }],
      [],
    );
    const unknown = roadmapResource(
      RS124,
      doc(),
      version(),
      [{ ...ISSUE, estimate: { effort: "m", risk: null, estMinutes: null } }],
      [],
    );

    expect(rounded.milestones[0]?.items[0]?.estimate).toMatchObject({
      loopDays: 1.4,
      complexity: null,
    });
    expect(unknown.milestones[0]?.items[0]?.estimate).toMatchObject({
      estMinutes: null,
      loopDays: null,
    });
  });

  it("gives an undated milestone no due label", () => {
    const undated = version();

    undated.structure.milestones[1].target_date = null;

    expect(roadmapResource(RS124, doc(), undated, [], []).milestones[1]?.dueLabel).toBeNull();
  });

  it("counts open suggestions only", () => {
    const card = roadmapResource(
      RS124,
      doc(),
      version(),
      [],
      [
        suggestion(),
        suggestion({ id: "s-2", status: "applied", appliedVersion: 2 }),
        suggestion({ id: "s-3", status: "dismissed" }),
      ],
    );

    expect(card.suggestions.open).toBe(1);
    expect(
      card.suggestions.items.map((item) => [item.id, item.status, item.appliedVersion]),
    ).toEqual([
      ["s-1", "open", null],
      ["s-2", "applied", 2],
      ["s-3", "dismissed", null],
    ]);
  });
});

describe("a projection's line", () => {
  const base = pendingProjection("docs/ROADMAP.md");

  it.each([
    [base, "docs/ROADMAP.md · not in the repository yet"],
    [
      { ...base, state: "pr_open" as const, pr_ref: "#88" },
      "docs/ROADMAP.md · pull request #88 open",
    ],
    [
      { ...base, state: "committed" as const, committed_sha: SHA },
      "docs/ROADMAP.md · committed 8c1b2e4",
    ],
    [
      {
        ...base,
        state: "drift_detected" as const,
        committed_sha: SHA,
        observed_sha: "a".repeat(40),
      },
      "docs/ROADMAP.md · drift detected since 8c1b2e4",
    ],
  ])("reads %j", (projection, label) => {
    expect(projectionResource(projection).label).toBe(label);
  });

  it("carries the reason a projection could not move", () => {
    expect(projectionResource(base, "The repository refused.")).toMatchObject({
      state: "pending",
      prRef: null,
      committedSha: null,
      observedSha: null,
      problem: "The repository refused.",
    });
    expect(projectionResource(base).problem).toBeNull();
  });
});

describe("a suggestion's chip", () => {
  it("is a person's initials, AI for the product, and ? for someone who is gone", () => {
    expect(suggestionResource(suggestion())).toMatchObject({
      authorLabel: "KS",
      authorName: "Ken Suenobu",
    });
    expect(
      suggestionResource(
        suggestion({
          authorKind: "ai",
          authorUserId: null,
          authorName: null,
          authorAgent: "estimator",
        }),
      ),
    ).toMatchObject({ authorLabel: "AI", authorName: "estimator" });
    expect(suggestionResource(suggestion({ authorUserId: null, authorName: null }))).toMatchObject({
      authorLabel: "?",
      authorName: null,
    });
  });

  it.each([
    ["Ken Suenobu", "KS"],
    ["maya", "M"],
    ["  Jorge  Luis   Borges ", "JB"],
    ["", "?"],
  ])("initials %p as %s", (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});

describe("the small resources", () => {
  it("links Planning on one batch, and answers the policy", () => {
    expect(planningHref("batch-1")).toBe("/planning?batch=batch-1");
    expect(settingsResource({ directCommit: true })).toEqual({ directCommit: true });
  });
});
