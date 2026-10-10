import { rs124Roadmap } from "./pipeline.fixture";
import {
  DRIFT_AGENT,
  MAX_NAMED_DIFFERENCES,
  compareWithTracker,
  differenceText,
  driftSuggestion,
  fileDifference,
  type DriftDifference,
} from "./roadmap.drift";
import {
  itemsOf,
  mergeRoadmap,
  type RoadmapStructure,
  type TrackerTicket,
} from "./roadmap.structure";

/** RS-124 with every item filed as #742…#747, and a mirror that agrees with it. */
function filedRoadmap(): { structure: RoadmapStructure; tickets: Map<string, TrackerTicket> } {
  const structure = mergeRoadmap(rs124Roadmap(), null);
  const tickets = new Map<string, TrackerTicket>();

  itemsOf(structure).forEach(({ item }, index) => {
    const number = String(742 + index);

    item.ticket_id = `t-${number}`;
    item.ticket_key = `#${number}`;
    tickets.set(item.ticket_id, {
      id: item.ticket_id,
      key: item.ticket_key,
      title: item.title,
      state: "open",
      labels: item.mvp ? ["mvp", "roadmap"] : ["roadmap"],
    });
  });

  return { structure, tickets };
}

function change(
  tickets: Map<string, TrackerTicket>,
  id: string,
  patch: Partial<TrackerTicket>,
): void {
  tickets.set(id, { ...(tickets.get(id) as TrackerTicket), ...patch });
}

describe("document versus tracker", () => {
  it("finds nothing when they agree", () => {
    const { structure, tickets } = filedRoadmap();

    expect(compareWithTracker(structure, tickets)).toEqual([]);
  });

  it("does not compare an item that was never filed", () => {
    const { structure, tickets } = filedRoadmap();
    const unfiled = itemsOf(structure)[5].item;

    tickets.delete(unfiled.ticket_id as string);
    unfiled.ticket_id = null;
    unfiled.ticket_key = null;

    expect(compareWithTracker(structure, tickets)).toEqual([]);
  });

  it("names a retitled issue, a closed one and a changed MVP flag — in reading order", () => {
    const { structure, tickets } = filedRoadmap();

    change(tickets, "t-745", { title: "Battery health model v3" });
    change(tickets, "t-744", { state: "closed", labels: ["mvp"] });
    change(tickets, "t-742", { labels: [] });

    expect(compareWithTracker(structure, tickets)).toEqual([
      { field: "mvp", itemKey: "dock-mpc", ticketKey: "#742", document: "MVP", tracker: "not MVP" },
      {
        field: "state",
        itemKey: "dock-gust",
        ticketKey: "#744",
        document: "open",
        tracker: "done",
      },
      {
        field: "mvp",
        itemKey: "dock-gust",
        ticketKey: "#744",
        document: "not MVP",
        tracker: "MVP",
      },
      {
        field: "title",
        itemKey: "fleet-battery",
        ticketKey: "#745",
        document: "Battery health model v2",
        tracker: "Battery health model v3",
      },
    ]);
  });

  it("sees an issue reopened after the document called it done", () => {
    const { structure, tickets } = filedRoadmap();

    itemsOf(structure)[0].item.checked = true;

    expect(compareWithTracker(structure, tickets)).toEqual([
      { field: "state", itemKey: "dock-mpc", ticketKey: "#742", document: "done", tracker: "open" },
    ]);
  });

  it("reports a filed item whose ticket is gone, and compares nothing else about it", () => {
    const { structure, tickets } = filedRoadmap();

    tickets.delete("t-746");

    expect(compareWithTracker(structure, tickets)).toEqual([
      {
        field: "missing",
        itemKey: "fleet-gaps",
        ticketKey: "#746",
        document: "filed",
        tracker: "no such ticket",
      },
    ]);
  });

  it("describes a hand-edited file by the commit it was seen at", () => {
    expect(fileDifference("docs/ROADMAP.md", "8c1b2e40d6a5f3c19b7e2a4d8f0c6b13e5a7d9f2")).toEqual({
      field: "file",
      itemKey: null,
      ticketKey: null,
      document: "docs/ROADMAP.md as generated",
      tracker: "edited at 8c1b2e4",
    });
    expect(fileDifference("docs/ROADMAP.md", null).tracker).toBe("edited in the repository");
  });

  it.each<[DriftDifference, string]>([
    [
      {
        field: "missing",
        itemKey: "a",
        ticketKey: "#7",
        document: "filed",
        tracker: "no such ticket",
      },
      "#7 is in the document but no longer in the tracker",
    ],
    [
      { field: "title", itemKey: "a", ticketKey: "#7", document: "Old", tracker: "New" },
      '#7 is titled "New" in the tracker and "Old" in the document',
    ],
    [
      { field: "state", itemKey: "a", ticketKey: "#7", document: "open", tracker: "done" },
      "#7 is done in the tracker and open in the document",
    ],
    [
      { field: "mvp", itemKey: "a", ticketKey: null, document: "MVP", tracker: "not MVP" },
      "a is not MVP in the tracker and MVP in the document",
    ],
    [
      {
        field: "file",
        itemKey: null,
        ticketKey: null,
        document: "x",
        tracker: "edited at 8c1b2e4",
      },
      "the file was edited at 8c1b2e4 and no longer matches the document",
    ],
  ])("says %j as a clause", (difference, text) => {
    expect(differenceText(difference)).toBe(text);
  });

  it("raises one suggestion naming every difference, with them as its hint", () => {
    const differences: DriftDifference[] = [
      {
        field: "state",
        itemKey: "dock-gust",
        ticketKey: "#744",
        document: "open",
        tracker: "done",
      },
      {
        field: "title",
        itemKey: "fleet-battery",
        ticketKey: "#745",
        document: "v2",
        tracker: "v3",
      },
    ];

    expect(driftSuggestion(differences)).toEqual({
      text:
        "Tracker drift — #744 is done in the tracker and open in the document; " +
        '#745 is titled "v3" in the tracker and "v2" in the document. ' +
        "Apply to regenerate the roadmap from what the tracker and the repository now say.",
      hint: {
        drift: [
          { field: "state", item: "dock-gust", ticket: "#744", document: "open", tracker: "done" },
          { field: "title", item: "fleet-battery", ticket: "#745", document: "v2", tracker: "v3" },
        ],
      },
    });
  });

  it("counts the differences it does not spell out, and still hints all of them", () => {
    const differences: DriftDifference[] = Array.from(
      { length: MAX_NAMED_DIFFERENCES + 3 },
      (_unused, index) => ({
        field: "state",
        itemKey: `i${String(index)}`,
        ticketKey: `#${String(index)}`,
        document: "open",
        tracker: "done",
      }),
    );
    const suggestion = driftSuggestion(differences);

    expect(suggestion.text).toContain("; and 3 more.");
    expect(suggestion.text.split(";")).toHaveLength(MAX_NAMED_DIFFERENCES + 1);
    expect((suggestion.hint.drift as unknown[]).length).toBe(MAX_NAMED_DIFFERENCES + 3);
    expect(suggestion.text.length).toBeLessThan(4000);
  });

  it("names its agent", () => {
    expect(DRIFT_AGENT).toBe("drift-detector");
  });
});
