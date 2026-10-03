import { describe, expect, it } from "vitest";

import {
  BODY_SOURCE_NOTE,
  INTAKE_SYNC_NOTE,
  NOTHING_TO_DRAFT,
  NO_TICKETS_YET,
  OPEN_ISSUES_LABEL,
  PUSHED_TICK_REASON,
  PUSH_FAILED,
  batchCaption,
  closedSummary,
  draftIds,
  draftLabel,
  draftTitle,
  draftedEvidence,
  evidenceName,
  isClosed,
  manyGroups,
  openedEvidence,
  pushBlock,
  pushLabel,
  pushTitle,
  pushToast,
  selectAll,
  tickReason,
  ticketRows,
  ticketsEmpty,
  undraftedEvidence,
} from "@/app/analyzer/tickets-view";
import { ISSUES_PATH } from "@/app/paths";
import {
  BATCH_CLOSED_REASON,
  DRAFT_ROLE_REASON,
  NOTHING_SELECTED_REASON,
  PUSH_ROLE_REASON,
  PUSH_RUNNING_REASON,
  type TrackerOption,
  loopTimeText,
  pushMode,
  rowPush,
  rowSizing,
  selectedCount,
  trackerOptions,
} from "@/app/planning/generator";

import {
  TICKETS_BATCH_ID,
  TICKET_EVIDENCE,
  TICKET_TITLES,
  anotherBatch,
  emptyTickets,
  landed,
  pushReport,
  refused,
  seededBatch,
  seededTickets,
  ticketsWith,
  undraftedTicket,
} from "../helpers/analyzer-tickets";
import { writableCatalog } from "../helpers/planning";
import { SEEDED_GITHUB_ID, seededSources } from "../helpers/sources";

/**
 * The drafted-tickets card's decisions (#519), as values: the seeded card is mockup 18's; nothing
 * about a draft is decided here that the planning page decides differently; the total is the
 * service's and moves only with the service's answer; a closed batch says what reached the
 * tracker; and the toast promises intake only where intake will have the tickets.
 */

/** The workspace's trackers, as the planning page's segment draws them. */
const TRACKERS = trackerOptions(seededSources(), { ok: true, value: writableCatalog() });

/** The seeded batch's tracker. */
const GITHUB = TRACKERS.find((option) => option.sourceId === SEEDED_GITHUB_ID);

/** A tracker of another kind, connected and writable — intake does not list its tickets. */
const LINEAR: TrackerOption = {
  key: "5eed001a-0000-4000-8000-000000000003",
  sourceId: "5eed001a-0000-4000-8000-000000000003",
  kind: "linear",
  label: "Linear",
  monogram: "LN",
  tint: "ln",
  pushName: "Linear",
};

/** No ticks drawn and not yet confirmed. */
const NONE: ReadonlyMap<string, boolean> = new Map();

describe("the seeded card", () => {
  const tickets = seededTickets();
  const { batch, drafts } = tickets.batches[0]!;
  const rows = ticketRows(batch, drafts);

  it("is mockup 18's four rows — key, title, effort chip and evidence line", () => {
    expect(
      rows.map((row) => [
        row.draft.localKey,
        row.draft.title,
        rowSizing(row.draft, batch.autoSize),
        row.stated?.evidenceLine,
      ]),
    ).toEqual([
      ["BA-1", TICKET_TITLES["BA-1"], { state: "sized", effort: "M" }, TICKET_EVIDENCE["BA-1"]],
      ["BA-2", TICKET_TITLES["BA-2"], { state: "sized", effort: "XS" }, TICKET_EVIDENCE["BA-2"]],
      ["BA-3", TICKET_TITLES["BA-3"], { state: "sized", effort: "L" }, TICKET_EVIDENCE["BA-3"]],
      ["BA-4", TICKET_TITLES["BA-4"], { state: "sized", effort: "S" }, TICKET_EVIDENCE["BA-4"]],
    ]);
  });

  it("says `est. total ~1.5 days of loop time` — the service's sum, in the planning footer's words", () => {
    expect(batch.summary).toMatchObject({ estMinutes: 2160, loopDays: 1.5 });
    expect(loopTimeText(batch)).toBe("est. total ~1.5 days of loop time");
  });

  it("offers `Push 4 tickets to backlog`, every row ticked and none pushed", () => {
    expect(selectedCount(batch.drafts, NONE)).toBe(4);
    expect(pushMode(batch.drafts, NONE)).toBe("push");
    expect(pushLabel(4)).toBe("Push 4 tickets to backlog");
    expect(rows.every((row) => rowPush(row.draft, true, false).state === "none")).toBe(true);
  });

  it("is one group, so no caption is needed to tell batches apart", () => {
    expect(manyGroups(tickets)).toBe(false);
    expect(ticketsEmpty(tickets, true)).toBeNull();
  });
});

describe("a row's evidence", () => {
  it("is joined to its draft by key, not by position — an action's batch may be newer than the page's evidence", () => {
    const { drafts } = seededTickets().batches[0]!;
    const reordered = seededBatch();
    reordered.drafts.reverse();

    expect(ticketRows(reordered, drafts).map((row) => [row.draft.localKey, row.stated?.localKey])).toEqual([
      ["BA-4", "BA-4"],
      ["BA-3", "BA-3"],
      ["BA-2", "BA-2"],
      ["BA-1", "BA-1"],
    ]);
  });

  it("is absent for a draft the page read no evidence for — never another draft's", () => {
    const { drafts } = seededTickets().batches[0]!;
    const [row] = ticketRows(seededBatch(), drafts.slice(1));

    expect(row?.draft.localKey).toBe("BA-1");
    expect(row?.stated).toBeNull();
    expect(draftedEvidence(row!)).toMatchObject({ localKey: "BA-1", line: null, evidence: [], evidenceTotal: 0 });
  });

  it("names its control by what it is about, with the line itself in the name", () => {
    expect(evidenceName("BA-2", TICKET_EVIDENCE["BA-2"])).toBe(
      "Evidence for BA-2: cache-miss signature matches ccache issue #1412 in 118 builds",
    );
  });

  it("opens with the references the body lists, and how many there are in all", () => {
    const tickets = seededTickets();
    const evidence = openedEvidence(tickets, { group: "batch", batchId: TICKETS_BATCH_ID, localKey: "BA-2" });

    expect(evidence).toMatchObject({
      localKey: "BA-2",
      title: TICKET_TITLES["BA-2"],
      line: TICKET_EVIDENCE["BA-2"],
      evidenceTotal: 118,
    });
    expect(evidence?.evidence).toHaveLength(3);
    expect(BODY_SOURCE_NOTE).toContain("draft's body");
  });

  it("follows the row: gone when its batch or its draft is no longer on the card", () => {
    const tickets = seededTickets();

    expect(openedEvidence(tickets, null)).toBeNull();
    expect(openedEvidence(tickets, { group: "batch", batchId: TICKETS_BATCH_ID, localKey: "BA-9" })).toBeNull();
    expect(openedEvidence(emptyTickets(), { group: "batch", batchId: TICKETS_BATCH_ID, localKey: "BA-1" })).toBeNull();
    expect(openedEvidence(tickets, { group: "undrafted", id: undraftedTicket().id })).toBeNull();
  });

  it("opens an un-drafted suggestion's too — what its draft will carry", () => {
    const suggestion = undraftedTicket();
    const tickets = seededTickets((card) => {
      card.undrafted = [suggestion];
    });

    expect(openedEvidence(tickets, { group: "undrafted", id: suggestion.id })).toEqual(undraftedEvidence(suggestion));
    expect(undraftedEvidence(suggestion)).toMatchObject({ localKey: null, line: suggestion.evidenceLine, evidenceTotal: 9 });
  });
});

describe("selection", () => {
  it("takes the planning page's reasons for the same checkbox — a viewer, a push running, an abandoned batch", () => {
    const batch = seededBatch();
    const [draft] = batch.drafts;

    expect(tickReason(draft!, batch, true, false)).toBeUndefined();
    expect(tickReason(draft!, batch, false, false)).toBe(DRAFT_ROLE_REASON);
    expect(tickReason(draft!, batch, true, true)).toBe(PUSH_RUNNING_REASON);
    expect(tickReason(draft!, seededBatch(undefined, { status: "abandoned" }), true, false)).toBe(BATCH_CLOSED_REASON);
  });

  it("adds this card's: a draft already in the tracker is not something to select", () => {
    const batch = seededBatch((draft) => (draft.localKey === "BA-1" ? landed(621) : undefined), { status: "pushing" });

    expect(tickReason(batch.drafts[0]!, batch, true, false)).toBe(PUSHED_TICK_REASON);
    expect(tickReason(batch.drafts[1]!, batch, true, false)).toBeUndefined();
    // Who may not select at all hears that first.
    expect(tickReason(batch.drafts[0]!, batch, false, false)).toBe(DRAFT_ROLE_REASON);
  });

  it("select-all is checked when every draft is ticked, and a press unticks them all", () => {
    expect(selectAll(seededBatch().drafts, NONE)).toEqual({
      checked: true,
      indeterminate: false,
      next: false,
      keys: ["BA-1", "BA-2", "BA-3", "BA-4"],
    });
  });

  it("is mixed when some are ticked, and a press ticks only the ones that are not", () => {
    const batch = seededBatch((draft) => (draft.localKey === "BA-3" ? { selected: false } : undefined));

    expect(selectAll(batch.drafts, NONE)).toEqual({ checked: false, indeterminate: true, next: true, keys: ["BA-3"] });
  });

  it("is unchecked when none is ticked", () => {
    const batch = seededBatch(() => ({ selected: false }));

    expect(selectAll(batch.drafts, NONE)).toMatchObject({ checked: false, indeterminate: false, next: true });
  });

  it("counts a tick drawn and not yet confirmed", () => {
    const pending = new Map([["BA-3", false]]);

    expect(selectAll(seededBatch().drafts, pending)).toMatchObject({ checked: false, indeterminate: true, keys: ["BA-3"] });
  });

  it("neither counts nor changes a draft already pushed", () => {
    const batch = seededBatch(
      (draft) => (draft.localKey === "BA-1" ? landed(621) : draft.localKey === "BA-2" ? { selected: false } : undefined),
      { status: "pushing" },
    );

    expect(selectAll(batch.drafts, NONE)).toEqual({ checked: false, indeterminate: true, next: true, keys: ["BA-2"] });
    // With every open draft ticked, a press unticks those — never the pushed one.
    expect(selectAll(seededBatch((draft) => (draft.localKey === "BA-1" ? landed(621) : undefined)).drafts, NONE)).toEqual(
      { checked: true, indeterminate: false, next: false, keys: ["BA-2", "BA-3", "BA-4"] },
    );
  });

  it("has nothing to change when every draft is pushed", () => {
    const batch = seededBatch((draft) => landed(620 + Number(draft.localKey.slice(3))));

    expect(selectAll(batch.drafts, NONE)).toEqual({ checked: false, indeterminate: false, next: true, keys: [] });
  });
});

describe("the total and the push button follow the selection", () => {
  it("count what is ticked: three drafts, and the estimator's minutes for those three", () => {
    const batch = seededBatch((draft) => (draft.localKey === "BA-3" ? { selected: false } : undefined));

    expect(pushLabel(selectedCount(batch.drafts, NONE))).toBe("Push 3 tickets to backlog");
    expect(batch.summary.estMinutes).toBe(1140);
    expect(loopTimeText(batch)).toBe("est. total ~0.8 days of loop time");
  });

  it("say one ticket, not `1 tickets`", () => {
    expect(pushLabel(1)).toBe("Push 1 ticket to backlog");
  });

  it("say `so far` while a ticked draft is still unsized, and nothing when none is ticked", () => {
    const sizing = seededBatch((draft) => (draft.localKey === "BA-2" ? { estimate: null } : undefined));

    expect(loopTimeText(sizing)).toBe("est. total ~1.4 days of loop time so far");
    expect(loopTimeText(seededBatch(() => ({ selected: false })))).toBe("est. total — nothing selected");
  });

  it("name where a push files them in the control's tooltip — the label says only *backlog*", () => {
    expect(pushTitle(GITHUB)).toBe("Files them in GitHub Issues.");
    expect(pushTitle(undefined)).toBeUndefined();
  });
});

describe("why a push cannot act", () => {
  const input = { mode: "push", count: 3, tracker: GITHUB, mayAdminister: true, busy: null, trackersFailure: null } as const;

  it("is the planning page's reasons for the same push", () => {
    expect(pushBlock(input)).toBeUndefined();
    expect(pushBlock({ ...input, mayAdminister: false })).toBe(PUSH_ROLE_REASON);
    expect(pushBlock({ ...input, count: 0 })).toBe(NOTHING_SELECTED_REASON);
    expect(pushBlock({ ...input, busy: "Pushing…" })).toBe("Pushing…");
    expect(pushBlock({ ...input, tracker: undefined })).toMatch(/not connected/);
  });

  it("says the trackers could not be read, when that is why the batch's is missing", () => {
    const unread = { ...input, tracker: undefined, trackersFailure: "The workspace's trackers could not be read." };

    expect(pushBlock(unread)).toBe("The workspace's trackers could not be read.");
    // Who may not push hears that instead — it would still be true once the trackers were read.
    expect(pushBlock({ ...unread, mayAdminister: false })).toBe(PUSH_ROLE_REASON);
    // A failure that did not cost this batch its tracker changes nothing.
    expect(pushBlock({ ...input, trackersFailure: "The workspace's trackers could not be read." })).toBeUndefined();
  });
});

describe("the toast a push leaves", () => {
  it("says what landed, and points at Issues — with why they may not be there yet", () => {
    const after = seededBatch((draft) => (draft.localKey === "BA-3" ? { selected: false } : landed(620 + Number(draft.localKey.slice(3)))), {
      status: "pushed",
    });

    expect(pushToast(pushReport(after), GITHUB)).toEqual({
      text: "Pushed 3 tickets to GitHub.",
      note: INTAKE_SYNC_NOTE,
      links: [{ label: OPEN_ISSUES_LABEL, href: ISSUES_PATH }],
    });
  });

  it("says how many did not land, in the planning page's words, and still links what did", () => {
    const after = seededBatch(
      (draft) => (draft.localKey === "BA-2" ? refused("GitHub answered 502.") : landed(620 + Number(draft.localKey.slice(3)))),
      { status: "pushing" },
    );
    const toast = pushToast(pushReport(after), GITHUB);

    expect(toast.text).toBe("Pushed 3 tickets to GitHub; 1 ticket did not land — Resume push re-runs only those.");
    expect(toast.links).toHaveLength(1);
  });

  it("offers no link when nothing landed", () => {
    const after = seededBatch(() => refused("GitHub answered 502."), { status: "pushing" });
    const toast = pushToast(pushReport(after), GITHUB);

    expect(toast.text).toContain("4 tickets did not land");
    expect(toast).toMatchObject({ note: null, links: [] });
  });

  it("says when to resume a throttled push", () => {
    const after = seededBatch((draft) => (draft.localKey === "BA-1" ? landed(621) : undefined), { status: "pushing" });
    const toast = pushToast(pushReport(after, { outcome: "throttled", retryAt: "2026-10-02T18:30:00.000Z" }), GITHUB);

    expect(toast.text).toBe("GitHub is rate limiting — 3 tickets did not land. Resume push after 18:30 UTC.");
  });

  it("never promises Issues for a tracker intake does not list", () => {
    const after = seededBatch((draft) => landed(620 + Number(draft.localKey.slice(3))), { status: "pushed" });

    expect(pushToast(pushReport(after), LINEAR)).toEqual({ text: "Pushed 4 tickets to Linear.", note: null, links: [] });
    // …nor for a batch whose tracker is no longer among the workspace's.
    expect(pushToast(pushReport(after), undefined)).toEqual({
      text: "Pushed 4 tickets to the tracker.",
      note: null,
      links: [],
    });
  });

  it("has its own sentence should a report ever say nothing", () => {
    expect(PUSH_FAILED).toBe("The push could not be made.");
  });
});

describe("a closed batch", () => {
  it("is one the service has pushed or abandoned — a push that stopped short is not", () => {
    expect(isClosed({ status: "pushed" })).toBe(true);
    expect(isClosed({ status: "abandoned" })).toBe(true);
    for (const status of ["drafting", "sized", "pushing"] as const) expect(isClosed({ status })).toBe(false);
  });

  it("says every ticket is in the tracker", () => {
    const batch = seededBatch((draft) => landed(620 + Number(draft.localKey.slice(3))), { status: "pushed" });
    const summary = closedSummary(batch, GITHUB);

    expect(summary.headline).toBe("All 4 tickets are in GitHub.");
    expect(summary.leftOut).toBeNull();
    expect(summary.pushed.map((draft) => draft.pushedTicket?.externalKey)).toEqual(["#621", "#622", "#623", "#624"]);
  });

  it("says what was left out — the draft somebody unticked", () => {
    const batch = seededBatch(
      (draft) => (draft.localKey === "BA-3" ? { selected: false } : landed(620 + Number(draft.localKey.slice(3)))),
      { status: "pushed" },
    );

    expect(closedSummary(batch, GITHUB)).toMatchObject({
      headline: "3 of 4 drafts were pushed to GitHub.",
      leftOut: "BA-3 was left out.",
    });
  });

  it("lists several left out as prose", () => {
    const one = seededBatch((draft) => (draft.localKey === "BA-1" ? landed(621) : { selected: false }), { status: "pushed" });

    expect(closedSummary(one, GITHUB)).toMatchObject({
      headline: "1 of 4 drafts was pushed to GitHub.",
      leftOut: "BA-2, BA-3 and BA-4 were left out.",
    });

    const two = seededBatch((draft) => (draft.localKey < "BA-3" ? landed(621) : { selected: false }), { status: "pushed" });

    expect(closedSummary(two, GITHUB).leftOut).toBe("BA-3 and BA-4 were left out.");
  });

  it("says a single-draft batch's ticket is in the tracker", () => {
    const batch = seededBatch((draft) => landed(620 + Number(draft.localKey.slice(3))), { status: "pushed" });
    batch.drafts = batch.drafts.slice(0, 1);

    expect(closedSummary(batch, GITHUB).headline).toBe("The ticket is in GitHub.");
  });

  it("says an abandoned batch was abandoned, and names no tracker it cannot", () => {
    const batch = seededBatch(undefined, { status: "abandoned" });

    expect(closedSummary(batch, undefined)).toMatchObject({
      headline: "This batch was abandoned with 0 of 4 drafts pushed to the tracker.",
      leftOut: "BA-1, BA-2, BA-3 and BA-4 were left out.",
      pushed: [],
    });
  });
});

describe("groups", () => {
  it("are captioned once there are two — two batches, or a batch beside un-drafted suggestions", () => {
    const two = seededTickets((card) => {
      card.batches.push(anotherBatch("5eed006a-0000-4000-8000-000000000009", "2026-09-25T09:00:00.000Z"));
    });
    const mixed = seededTickets((card) => {
      card.undrafted = [undraftedTicket()];
    });

    expect(manyGroups(two)).toBe(true);
    expect(manyGroups(mixed)).toBe(true);
    expect(manyGroups(seededTickets((card) => { card.batches = []; card.undrafted = [undraftedTicket()]; }))).toBe(false);
  });

  it("say when a batch was drafted, and for which tracker", () => {
    expect(batchCaption({ createdAt: "2026-10-02T18:00:00.000Z" }, GITHUB)).toBe("Drafted Oct 2 for GitHub Issues");
    expect(batchCaption({ createdAt: "2026-09-25T09:00:00.000Z" }, undefined)).toBe("Drafted Sep 25");
  });
});

describe("the empty card", () => {
  it("says an analysis has yet to run, or that the last one found nothing to draft — never an empty box", () => {
    expect(ticketsEmpty(emptyTickets(), false)).toBe(NO_TICKETS_YET);
    expect(ticketsEmpty(emptyTickets(), true)).toBe(NOTHING_TO_DRAFT);
  });

  it("is not empty with only un-drafted suggestions, or only a closed batch", () => {
    expect(ticketsEmpty(seededTickets((card) => { card.batches = []; card.undrafted = [undraftedTicket()]; }), true)).toBeNull();
    expect(ticketsEmpty(ticketsWith(seededBatch(undefined, { status: "pushed" })), true)).toBeNull();
  });
});

describe("drafting the un-drafted", () => {
  it("counts what it drafts, and sends them most confident first — `BA-1` is the surest", () => {
    const suggestions = [undraftedTicket(), undraftedTicket({ id: "5eed0067-0000-4000-8000-000000000026", confidence: 61 })];

    expect(draftLabel(2)).toBe("Draft 2 tickets");
    expect(draftLabel(1)).toBe("Draft 1 ticket");
    expect(draftTitle(2)).toBe("Draft 2 tickets from the analyzer's findings");
    expect(draftIds(suggestions)).toEqual([
      "5eed0067-0000-4000-8000-000000000025",
      "5eed0067-0000-4000-8000-000000000026",
    ]);
  });
});
