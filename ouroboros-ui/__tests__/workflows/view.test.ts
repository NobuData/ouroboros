import { describe, expect, it } from "vitest";

import { WORKFLOWS_PATH, workflowPath } from "@/app/paths";
import {
  ANY_ISSUE,
  BROWSE_TEMPLATES_SOON,
  CODE_SOON_NOTE,
  COPILOT_SOON_NOTE,
  DRY_RUN_SOON,
  NEW_WORKFLOW_MEMBER_REASON,
  NOT_PUBLISHED,
  NO_DRAFT,
  NO_TRIGGER,
  PUBLISH_SOON,
  STUDIO_EYEBROW,
  BLANK_DEFINITION,
  canvasDefinition,
  describedDefinition,
  isLiveTab,
  lastEdited,
  naturalList,
  newWorkflowReason,
  publishLabel,
  railItems,
  readTrigger,
  studioSubline,
  studioTabs,
  triggerSentence,
  versionWord,
} from "@/app/workflows/view";

import {
  DRAFT_EDITED_AT,
  READ_AT,
  definitionWithTrigger,
  railEntry,
  seededRail,
  standardFixDefinition,
  workflowDetail,
} from "../helpers/workflows";

/**
 * The studio frame's decisions (#147): the trigger in words, the composed subline, the
 * segmented control, the actions' reasons, and the rail's items.
 *
 * The acceptance criterion these exist for, in the ticket's words: **head values are real —
 * version, last-edited and usage come from the API, and the trigger sentence is composed from
 * the definition rather than stored.** Every case below is a small value in, a sentence or a
 * flag out.
 */

/** The instant every *ago* below is measured from. */
const NOW = new Date(READ_AT);

describe("reading a trigger out of a definition", () => {
  it("reads the three conditions as facts", () => {
    expect(
      readTrigger(
        definitionWithTrigger({
          event: "ticket_queued",
          conditions: { effort_lte: "s", labels: ["docs", "manual"], source: "github" },
        }),
      ),
    ).toEqual({ event: "ticket_queued", effortLte: "s", labels: ["docs", "manual"], source: "github" });
  });

  it("reads a trigger with no conditions as the catch-all", () => {
    expect(readTrigger(definitionWithTrigger({ event: "ticket_queued", conditions: {} }))).toEqual({
      event: "ticket_queued",
      effortLte: null,
      labels: [],
      source: null,
    });
  });

  it("finds no trigger in a document that has none", () => {
    // `{}` is the blank canvas — the state **+ New workflow** leaves behind — and a draft is
    // stored unvalidated, so the head of a workflow somebody is still building has to render.
    expect(readTrigger(null)).toBeNull();
    expect(readTrigger({})).toBeNull();
    expect(readTrigger({ trigger: "ticket_queued" })).toBeNull();
    expect(readTrigger({ trigger: { conditions: { effort_lte: "m" } } })).toBeNull();
  });

  it("reads a malformed condition as absent rather than throwing", () => {
    expect(
      readTrigger(
        definitionWithTrigger({
          event: "ticket_queued",
          conditions: { effort_lte: "huge", labels: ["docs", 7, null], source: 3 },
        }),
      ),
    ).toEqual({ event: "ticket_queued", effortLte: null, labels: ["docs"], source: null });
    expect(
      readTrigger(definitionWithTrigger({ event: "ticket_queued", conditions: "all" })),
    ).toEqual({ event: "ticket_queued", effortLte: null, labels: [], source: null });
  });
});

describe("a list in prose", () => {
  it("joins the way a sentence does", () => {
    expect(naturalList([])).toBe("");
    expect(naturalList(["docs"])).toBe("docs");
    expect(naturalList(["dependencies", "tech-debt"])).toBe("dependencies and tech-debt");
    expect(naturalList(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("the trigger sentence", () => {
  it("composes the mockup's sentence from the seeded standard-fix", () => {
    // The ticket's own example, and the seed's own trigger: `effort_lte: m`, and nothing else.
    expect(triggerSentence(standardFixDefinition())).toBe(
      "Runs when a sized issue with effort ≤ M is queued.",
    );
  });

  it("composes one sentence for each of the other four seeded triggers", () => {
    // `R__dev_seed_workflows.sql`'s four other predicates, each read as words.
    const cases: readonly [unknown, string][] = [
      [{ labels: ["enhancement"] }, "Runs when an issue labelled enhancement is queued."],
      [
        { labels: ["dependencies", "tech-debt"] },
        "Runs when an issue labelled dependencies and tech-debt is queued.",
      ],
      [
        { effort_lte: "s", labels: ["docs"] },
        "Runs when a sized issue with effort ≤ S labelled docs is queued.",
      ],
      [
        { labels: ["p0", "priority-high"] },
        "Runs when an issue labelled p0 and priority-high is queued.",
      ],
    ];

    for (const [conditions, sentence] of cases) {
      expect(triggerSentence(definitionWithTrigger({ event: "ticket_queued", conditions }))).toBe(
        sentence,
      );
    }
  });

  it("names the tracker a source condition restricts it to, as its owner spells it", () => {
    expect(
      triggerSentence(
        definitionWithTrigger({ event: "ticket_queued", conditions: { source: "github" } }),
      ),
    ).toBe("Runs when an issue from GitHub is queued.");
    expect(
      triggerSentence(
        definitionWithTrigger({
          event: "ticket_queued",
          conditions: { effort_lte: "xl", labels: ["security"], source: "linear" },
        }),
      ),
    ).toBe("Runs when a sized issue with effort ≤ XL labelled security from Linear is queued.");
  });

  it("prints a tracker this build does not know by its kind rather than dropping it", () => {
    expect(
      triggerSentence(
        definitionWithTrigger({ event: "ticket_queued", conditions: { source: "youtrack" } }),
      ),
    ).toBe("Runs when an issue from youtrack is queued.");
  });

  it("says a trigger with no conditions fires on any issue", () => {
    expect(triggerSentence(definitionWithTrigger({ event: "ticket_queued", conditions: {} }))).toBe(
      `Runs when ${ANY_ISSUE} is queued.`,
    );
  });

  it("is honest about a document with no trigger", () => {
    // *Runs when …* would be a claim about a predicate that does not exist.
    expect(triggerSentence(null)).toBe(NO_TRIGGER);
    expect(triggerSentence({})).toBe(NO_TRIGGER);
  });

  it("describes an event this build does not know by name rather than guessing at it", () => {
    expect(triggerSentence(definitionWithTrigger({ event: "pr_opened", conditions: {} }))).toBe(
      "Runs on pr_opened.",
    );
  });
});

describe("which document the head describes", () => {
  it("prefers the version in force, because the subline sits beside its chip", () => {
    const inForce = definitionWithTrigger({ event: "ticket_queued", conditions: {} });
    const detail = workflowDetail({
      version: { ...workflowDetail().version!, definition: inForce },
    });

    expect(describedDefinition(detail)).toBe(inForce);
  });

  it("falls back to the draft for a workflow that has published nothing", () => {
    const draft = definitionWithTrigger({ event: "ticket_queued", conditions: {} });
    const detail = workflowDetail({
      currentVersion: null,
      version: null,
      draft: { ...workflowDetail().draft, definition: draft },
    });

    expect(describedDefinition(detail)).toBe(draft);
  });

  it("has nothing to describe for a workflow with neither", () => {
    const detail = workflowDetail({
      currentVersion: null,
      version: null,
      draft: { etag: "none", definition: null, updatedAt: null },
    });

    expect(describedDefinition(detail)).toBeNull();
  });
});

describe("which document the canvas opens on", () => {
  it("prefers the draft, because the canvas is where the next version is edited", () => {
    // The reverse of the head's order: the head describes what runs, the canvas what will.
    const draft = definitionWithTrigger({ event: "ticket_queued", conditions: {} });
    const detail = workflowDetail({ draft: { ...workflowDetail().draft, definition: draft } });

    expect(canvasDefinition(detail)).toBe(draft);
    expect(describedDefinition(detail)).not.toBe(draft);
  });

  it("falls back to the version in force for a workflow with no draft open", () => {
    const detail = workflowDetail({ draft: { etag: "none", definition: null, updatedAt: null } });

    expect(canvasDefinition(detail)).toBe(detail.version?.definition);
  });

  it("opens on a blank document for a workflow with neither", () => {
    const detail = workflowDetail({
      currentVersion: null,
      version: null,
      draft: { etag: "none", definition: null, updatedAt: null },
    });

    expect(canvasDefinition(detail)).toBe(BLANK_DEFINITION);
    expect(BLANK_DEFINITION).toEqual({});
  });
});

describe("the three facts", () => {
  it("measures last edited from the draft's stamp against the instant the page was read", () => {
    expect(lastEdited(DRAFT_EDITED_AT, NOW)).toBe("Last edited 2h ago");
  });

  it("says so for a workflow with no draft rather than borrowing another stamp", () => {
    expect(lastEdited(null, NOW)).toBe(NO_DRAFT);
  });

  it("spells the version as the chip does, and says when there is none", () => {
    expect(versionWord(14)).toBe("v14");
    expect(versionWord(1)).toBe("v1");
    expect(versionWord(null)).toBe(NOT_PUBLISHED);
  });
});

describe("the subline", () => {
  it("is the mockup's sentence, with the seed's own usage figure", () => {
    // Trigger derived, last-edited measured, version and usage served — and `42%` rather than
    // the mockup's `61%`, which P.5 (#136) records as unreachable from the seeded runs.
    expect(studioSubline(workflowDetail(), railEntry(), NOW)).toBe(
      "Runs when a sized issue with effort ≤ M is queued. Last edited 2h ago · v14 · used by 42% of runs.",
    );
  });

  it("prints the usage caption as served, never a figure composed here", () => {
    // `no runs yet` is P.4's answer for a workspace with nothing to divide by; a client that
    // composed `used by 0% of runs` from `usagePercent: null` would be the lie the null exists
    // to prevent.
    const entry = railEntry({ usagePercent: null, usageCaption: "no runs yet" });

    expect(studioSubline(workflowDetail(), entry, NOW)).toMatch(/· no runs yet\.$/);
  });

  it("degrades each fact on its own for a workflow that has only ever had a draft", () => {
    const detail = workflowDetail({
      currentVersion: null,
      version: null,
      draft: { etag: "e", definition: {}, updatedAt: DRAFT_EDITED_AT },
    });

    expect(studioSubline(detail, railEntry({ currentVersion: null }), NOW)).toBe(
      `${NO_TRIGGER} Last edited 2h ago · ${NOT_PUBLISHED} · used by 42% of runs.`,
    );
  });
});

describe("the actions", () => {
  it("labels publish with the next version, which is what the button does", () => {
    expect(publishLabel(14)).toBe("Publish v15");
    expect(publishLabel(null)).toBe("Publish v1");
  });

  it("names the issue each inert action waits for", () => {
    // § 3.5: a control that cannot act says what is missing, and the reason is a usable answer
    // to "when?" rather than the word *soon*.
    for (const reason of [BROWSE_TEMPLATES_SOON, DRY_RUN_SOON, PUBLISH_SOON]) {
      expect(reason).toMatch(/#\d+/);
    }
  });

  it("makes the tile inert for a role that may not create, and only for that role", () => {
    expect(newWorkflowReason(true)).toBeUndefined();
    expect(newWorkflowReason(false)).toBe(NEW_WORKFLOW_MEMBER_REASON);
  });
});

describe("the segmented control", () => {
  it("is Visual, Code and Copilot in the mockup's order", () => {
    expect(studioTabs("standard-fix").map((tab) => tab.label)).toEqual([
      "Visual",
      "Code",
      "Copilot",
    ]);
  });

  it("links the one live segment to this workflow's own visual surface", () => {
    const [visual] = studioTabs("standard-fix");

    expect(isLiveTab(visual!)).toBe(true);
    expect(isLiveTab(visual!) && visual.href).toBe(workflowPath("standard-fix"));
  });

  it("links it to the landing when nothing is selected", () => {
    const [visual] = studioTabs(null);

    expect(isLiveTab(visual!) && visual.href).toBe(WORKFLOWS_PATH);
  });

  it("labels the two unbuilt segments with the issue that builds each", () => {
    // The ticket's honesty obligation, and the two amendments recorded on it: V.1 (#169) turns
    // Code on, CE.1 (#565) turns Copilot on.
    const [, code, copilot] = studioTabs("standard-fix");

    expect(isLiveTab(code!)).toBe(false);
    expect(isLiveTab(copilot!)).toBe(false);
    expect(!isLiveTab(code!) && code.note).toBe(CODE_SOON_NOTE);
    expect(!isLiveTab(copilot!) && copilot.note).toBe(COPILOT_SOON_NOTE);
    expect(CODE_SOON_NOTE).toMatch(/#169/);
    expect(COPILOT_SOON_NOTE).toMatch(/#565/);
  });

  it("names the section the way the eyebrow does", () => {
    expect(STUDIO_EYEBROW).toBe("Workflow Studio");
  });
});

describe("the rail", () => {
  it("keeps the service's order, which is creation order", () => {
    expect(railItems(seededRail(), null).map((item) => item.slug)).toEqual([
      "standard-fix",
      "feature-loop",
      "deps-refresh",
      "docs-loop",
      "hotfix-p0",
    ]);
  });

  it("prints every caption as served, never one composed here", () => {
    expect(railItems(seededRail(), null).map((item) => item.caption)).toEqual([
      "12 stages · auto-merge",
      "7 stages · auto-merge",
      "5 stages · needs review",
      "4 stages · auto-merge",
      "5 stages · paused",
    ]);
  });

  it("lights exactly the selected workflow", () => {
    const items = railItems(seededRail(), "deps-refresh");

    expect(items.filter((item) => item.active).map((item) => item.slug)).toEqual(["deps-refresh"]);
  });

  it("lights nothing when nothing is selected, or when the slug is not on the rail", () => {
    expect(railItems(seededRail(), null).some((item) => item.active)).toBe(false);
    expect(railItems(seededRail(), "gone").some((item) => item.active)).toBe(false);
  });

  it("marks the paused workflow with the err-dot, and only that one", () => {
    const items = railItems(seededRail(), null);

    expect(items.filter((item) => item.paused).map((item) => item.slug)).toEqual(["hotfix-p0"]);
  });

  it("links each entry to its own studio URL", () => {
    for (const item of railItems(seededRail(), null)) {
      expect(item.href).toBe(workflowPath(item.slug));
    }
  });
});
