import { rs124Roadmap } from "./pipeline.fixture";
import {
  MVP_LABEL,
  canonical,
  isCalendarDate,
  itemsOf,
  mergeRoadmap,
  refreshStates,
  renderRoadmap,
  roadmapProblems,
  sameStructure,
  targetLabel,
  writeback,
  type RoadmapStructure,
  type TrackerTicket,
} from "./roadmap.structure";

function ticket(id: string, change: Partial<TrackerTicket> = {}): TrackerTicket {
  return { id, key: `#${id}`, title: "A ticket", state: "open", labels: [], ...change };
}

function filed(structure: RoadmapStructure, key: string, number: string): RoadmapStructure {
  return {
    milestones: structure.milestones.map((milestone) => ({
      ...milestone,
      items: milestone.items.map((item) =>
        item.key === key
          ? { ...item, draft_id: `draft-${number}`, ticket_id: number, ticket_key: `#${number}` }
          : item,
      ),
    })),
  };
}

describe("a roadmap's structure", () => {
  describe("merging a skill's answer", () => {
    it("stores a first version with no draft, no ticket and nothing done", () => {
      const structure = mergeRoadmap(rs124Roadmap(), null);

      expect(structure.milestones.map((milestone) => milestone.key)).toEqual(["m1", "m2"]);
      expect(structure.milestones[0]).toMatchObject({
        name: "Docking parity",
        target_date: "2026-10-15",
      });
      expect(itemsOf(structure)).toHaveLength(6);
      expect(itemsOf(structure)[0]?.item).toEqual({
        key: "dock-mpc",
        title: "Wind-feedforward MPC in final approach",
        draft_id: null,
        ticket_id: null,
        ticket_key: null,
        mvp: true,
        effort: "l",
        checked: false,
      });
    });

    it("keeps a surviving item's draft, ticket and done state by its key", () => {
      const previous = filed(mergeRoadmap(rs124Roadmap(), null), "dock-gust", "744");

      itemsOf(previous)[2].item.checked = true;

      const answer = rs124Roadmap();

      // The skill moves the item to the other milestone, retitles it and flags it.
      const [gust] = answer.milestones[0].items.splice(2, 1);

      answer.milestones[1].items.unshift({ ...gust, title: "Gust estimator", mvp: true });

      const merged = mergeRoadmap(answer, previous);
      const moved = itemsOf(merged).find(({ item }) => item.key === "dock-gust");

      expect(moved?.milestone.key).toBe("m2");
      expect(moved?.item).toMatchObject({
        title: "Gust estimator",
        mvp: true,
        draft_id: "draft-744",
        ticket_id: "744",
        ticket_key: "#744",
        checked: true,
      });
    });

    it("starts a new item with nothing, and forgets an item the skill dropped", () => {
      const previous = filed(mergeRoadmap(rs124Roadmap(), null), "fleet-battery", "745");
      const answer = rs124Roadmap();

      answer.milestones[1].items[0] = {
        key: "fleet-battery-model",
        title: "Battery health model v2",
        mvp: false,
        effort: "m",
      };

      const merged = mergeRoadmap(answer, previous);

      expect(itemsOf(merged).map(({ item }) => item.key)).not.toContain("fleet-battery");
      expect(
        itemsOf(merged).find(({ item }) => item.key === "fleet-battery-model")?.item,
      ).toMatchObject({
        draft_id: null,
        ticket_id: null,
        ticket_key: null,
        checked: false,
      });
    });

    it("trims names and titles", () => {
      const answer = rs124Roadmap();

      answer.milestones[0].name = "  Docking parity ";
      answer.milestones[0].items[0].title = " MPC  ";

      const merged = mergeRoadmap(answer, null);

      expect(merged.milestones[0]?.name).toBe("Docking parity");
      expect(merged.milestones[0]?.items[0]?.title).toBe("MPC");
    });
  });

  describe("what cannot be stored", () => {
    it("accepts the seeded roadmap", () => {
      expect(roadmapProblems(rs124Roadmap())).toEqual([]);
    });

    it.each<[string, (r: ReturnType<typeof rs124Roadmap>) => void, string]>([
      ["a blank title", (r) => void (r.title = "  "), "the title"],
      ["a title over 200 characters", (r) => void (r.title = "x".repeat(201)), "the title"],
      ["no milestones", (r) => void (r.milestones = []), "1–50 milestones"],
      [
        "a malformed milestone key",
        (r) => void (r.milestones[0].key = "M 1"),
        'milestone key "M 1" is malformed',
      ],
      [
        "a repeated milestone key",
        (r) => void (r.milestones[1].key = "m1"),
        'milestone key "m1" repeats',
      ],
      ["a blank milestone name", (r) => void (r.milestones[0].name = " "), "needs a name"],
      [
        "an impossible date",
        (r) => void (r.milestones[0].targetDate = "2026-02-30"),
        "not a calendar date",
      ],
      [
        "a malformed item key",
        (r) => void (r.milestones[0].items[0].key = "Dock"),
        'item key "Dock" is malformed',
      ],
      [
        "an item key repeated across milestones",
        (r) => void (r.milestones[1].items[0].key = "dock-mpc"),
        'item key "dock-mpc" repeats',
      ],
      ["a blank item title", (r) => void (r.milestones[0].items[0].title = ""), "needs a title"],
      [
        "an item title over 512 characters",
        (r) => void (r.milestones[0].items[0].title = "x".repeat(513)),
        "needs a title",
      ],
    ])("names %s", (_name, mutate, problem) => {
      const roadmap = rs124Roadmap();

      mutate(roadmap);

      expect(roadmapProblems(roadmap).join("; ")).toContain(problem);
    });

    it("refuses more than fifty milestones and more than five hundred items", () => {
      const roadmap = rs124Roadmap();

      roadmap.milestones = Array.from({ length: 51 }, (_unused, index) => ({
        key: `m${String(index)}`,
        name: "M",
        targetDate: null,
        items: Array.from({ length: 10 }, (_item, item) => ({
          key: `i${String(index)}-${String(item)}`,
          title: "T",
          mvp: false,
          effort: null,
        })),
      }));

      const problems = roadmapProblems(roadmap).join("; ");

      expect(problems).toContain("1–50 milestones");
      expect(problems).toContain("at most 500 items");
    });

    it("tells a calendar date from a string shaped like one", () => {
      expect(isCalendarDate("2026-10-15")).toBe(true);
      expect(isCalendarDate("2024-02-29")).toBe(true);
      expect(isCalendarDate("2026-02-29")).toBe(false);
      expect(isCalendarDate("2026-13-01")).toBe(false);
      expect(isCalendarDate("15 Oct 2026")).toBe(false);
      expect(isCalendarDate("2026-10-15T00:00:00Z")).toBe(false);
    });
  });

  describe("the writeback", () => {
    const structure = mergeRoadmap(rs124Roadmap(), null);

    it("gives a pushed item its draft, its ticket, and the tracker's flag and state", () => {
      const next = writeback(
        structure,
        new Map([["dock-gust", { draftId: "d-3", ticket: { id: "t-744", key: "#744" } }]]),
        new Map([
          [
            "t-744",
            ticket("t-744", { key: "#744", labels: [MVP_LABEL, "docking"], state: "closed" }),
          ],
        ]),
      );

      expect(itemsOf(next)[2]?.item).toMatchObject({
        draft_id: "d-3",
        ticket_id: "t-744",
        ticket_key: "#744",
        mvp: true,
        checked: true,
      });
      // Nothing else moved, and the input is untouched.
      expect(itemsOf(next)[0]?.item).toEqual(itemsOf(structure)[0]?.item);
      expect(itemsOf(structure)[2]?.item.ticket_id).toBeNull();
    });

    it("clears an MVP flag the created issue does not carry", () => {
      const next = writeback(
        structure,
        new Map([["dock-mpc", { draftId: "d-1", ticket: { id: "t-742", key: "#742" } }]]),
        new Map([["t-742", ticket("t-742", { labels: [] })]]),
      );

      expect(itemsOf(next)[0]?.item.mvp).toBe(false);
    });

    it("records a draft that has not been pushed yet, and nothing more", () => {
      const next = writeback(
        structure,
        new Map([["dock-mpc", { draftId: "d-1", ticket: null }]]),
        new Map(),
      );

      expect(itemsOf(next)[0]?.item).toMatchObject({
        draft_id: "d-1",
        ticket_id: null,
        ticket_key: null,
        mvp: true,
        checked: false,
      });
    });

    it("keeps the document's flag when the mirror has not got the ticket yet", () => {
      const next = writeback(
        structure,
        new Map([["dock-mpc", { draftId: "d-1", ticket: { id: "t-742", key: "#742" } }]]),
        new Map(),
      );

      expect(itemsOf(next)[0]?.item).toMatchObject({
        ticket_key: "#742",
        mvp: true,
        checked: false,
      });
    });

    it("leaves an item that was already filed exactly as it is", () => {
      const already = filed(structure, "dock-mpc", "742");
      const next = writeback(
        already,
        new Map([["dock-mpc", { draftId: "other", ticket: { id: "999", key: "#999" } }]]),
        new Map([["742", ticket("742", { state: "closed", labels: [] })]]),
      );

      expect(sameStructure(next, already)).toBe(true);
    });
  });

  describe("refreshing done states", () => {
    it("takes every filed item's state from the tracker, and nothing else", () => {
      const structure = filed(
        filed(mergeRoadmap(rs124Roadmap(), null), "dock-mpc", "742"),
        "dock-retry",
        "743",
      );

      itemsOf(structure)[1].item.checked = true;

      const next = refreshStates(
        structure,
        new Map([
          ["742", ticket("742", { state: "closed", labels: [], title: "Renamed" })],
          ["743", ticket("743", { state: "open" })],
        ]),
      );

      expect(
        itemsOf(next)
          .slice(0, 3)
          .map(({ item }) => [item.key, item.checked, item.mvp, item.title]),
      ).toEqual([
        ["dock-mpc", true, true, "Wind-feedforward MPC in final approach"],
        ["dock-retry", false, true, "Re-planned abort & retry vectors"],
        ["dock-gust", false, false, "Gust estimator from IMU residuals"],
      ]);
    });

    it("keeps the state of an item whose ticket the mirror lacks", () => {
      const structure = filed(mergeRoadmap(rs124Roadmap(), null), "dock-mpc", "742");

      itemsOf(structure)[0].item.checked = true;

      expect(itemsOf(refreshStates(structure, new Map()))[0]?.item.checked).toBe(true);
    });
  });

  describe("comparing", () => {
    it("ignores key order and sees every field", () => {
      const structure = mergeRoadmap(rs124Roadmap(), null);
      const shuffled: RoadmapStructure = JSON.parse(
        JSON.stringify({
          milestones: structure.milestones.map((milestone) => ({
            items: milestone.items.map((item) =>
              Object.fromEntries(Object.entries(item).reverse()),
            ),
            target_date: milestone.target_date,
            name: milestone.name,
            key: milestone.key,
          })),
        }),
      ) as RoadmapStructure;

      expect(sameStructure(structure, shuffled)).toBe(true);
      expect(Object.keys(canonical(shuffled).milestones[0])).toEqual([
        "key",
        "name",
        "target_date",
        "items",
      ]);

      shuffled.milestones[1].items[2].checked = true;

      expect(sameStructure(structure, shuffled)).toBe(false);
    });
  });

  describe("the Markdown projection", () => {
    it("prints the seeded file's shape", () => {
      let structure = mergeRoadmap(rs124Roadmap(), null);

      structure = filed(structure, "dock-mpc", "742");
      itemsOf(structure)[0].item.checked = true;

      expect(renderRoadmap("Helios — Q4 Improvement Roadmap", structure)).toBe(
        [
          "# Helios — Q4 Improvement Roadmap",
          "",
          "## M1 · Docking parity — target Oct 15",
          "- [x] #742 Wind-feedforward MPC in final approach `MVP` `L`",
          "- [ ] Re-planned abort & retry vectors `MVP` `M`",
          "- [ ] Gust estimator from IMU residuals `M`",
          "",
          "## M2 · Fleet reliability — target Nov 20",
          "- [ ] Battery health model v2 `M`",
          "- [ ] Telemetry gap alerts `S`",
          "- [ ] Operator recovery playbook docs `XS`",
          "",
        ].join("\n"),
      );
    });

    it("omits what an item or milestone does not have", () => {
      const structure: RoadmapStructure = {
        milestones: [
          {
            key: "later",
            name: "Later",
            target_date: null,
            items: [
              {
                key: "a",
                title: "Unsized",
                draft_id: null,
                ticket_id: null,
                ticket_key: null,
                mvp: false,
                effort: null,
                checked: false,
              },
            ],
          },
          { key: "empty", name: "Empty", target_date: null, items: [] },
        ],
      };

      expect(renderRoadmap("R", structure)).toBe(
        "# R\n\n## LATER · Later\n- [ ] Unsized\n\n## EMPTY · Empty\n",
      );
    });

    it("is the same bytes for the same input", () => {
      const structure = mergeRoadmap(rs124Roadmap(), null);

      expect(renderRoadmap("R", structure)).toBe(renderRoadmap("R", canonical(structure)));
    });

    it("reads a target date in UTC", () => {
      expect(targetLabel("2026-01-01")).toBe("Jan 1");
      expect(targetLabel("2026-12-31")).toBe("Dec 31");
    });
  });
});
