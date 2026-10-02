import { describe, expect, it } from "vitest";

import type { Playbook } from "@/app/api/playbooks";
import {
  BACK_TO_HEALTHY,
  FLAKY_ROWS,
  FLAKY_STATES,
  NO_FLAKY,
  NO_PLAYBOOK,
  PLAYBOOKS_HREF,
  PLAYBOOKS_LINK,
  UNDER_THRESHOLD,
  flakyContext,
  flakyPlaybookOf,
  flakyRow,
  flakyView,
  platformPart,
  playbookLink,
} from "@/app/insights/flaky-view";
import { BUILD_FARM_PATH, FARM_RUNNERS_HASH, KNOWLEDGE_PATH, playbookPath, runPath } from "@/app/paths";

import { FIXING_RUN_ID, SEEDED_PLAYBOOK, flakyCase, seededFlaky, withoutResolved } from "../helpers/insights";

/**
 * The flaky card's decisions (#446): AT.3's three states as pills, the rate and its hue, the
 * history as sparkline values, and the context line whose every link resolves — or is absent
 * when nothing measured it — and the playbook line, present, absent and unknown.
 */

describe("flakyRow", () => {
  it("draws the seeded fixed case — a zero rate, a receded strip and the loop that fixed it", () => {
    const row = flakyRow(flakyCase());

    expect(row.name).toBe("tests/telemetry/test_frame_order.c");
    expect(row.where).toBe("telemetry integration · acme/helios-firmware");
    expect(row.state).toEqual({ label: "fixed", tone: "ok" });
    expect(row.rate).toBe("0.0%");
    expect(row.rateWarn).toBe(false);
    expect(row.dim).toBe(true);
    expect(row.context).toEqual([
      { text: "fixed by " },
      { text: "loop #1847", href: runPath(FIXING_RUN_ID, "insights") },
    ]);
    expect(row.summary).toBe("tests/telemetry/test_frame_order.c, fixed, 0.0% flaky, fixed by loop #1847");
  });

  it("draws a quarantined case's rate in the warning hue", () => {
    const row = flakyRow(withoutResolved({ state: "quarantined", ratePct: 4.1, trend: "rising" }));

    expect(row.state).toEqual({ label: "quarantined", tone: "warn" });
    expect(row.rate).toBe("4.1%");
    expect(row.rateWarn).toBe(true);
    expect(row.dim).toBe(false);
  });

  it("says a case that did not run in an em dash, never 0.0%", () => {
    const row = flakyRow(withoutResolved({ state: "watching", ratePct: null }));

    expect(row.rate).toBe("—");
    expect(row.summary).toContain("did not run");
  });

  it("draws a day the case did not run as a zero-height bar, keeping the strip's length", () => {
    const row = flakyRow(withoutResolved({ history: [{ day: "2026-08-07", ratePct: 2 }, { day: "2026-08-08", ratePct: null }] }));

    expect(row.history).toEqual([2, 0]);
  });

  it("names the case by its name when it has one, else its key, and leaves out an unknown suite", () => {
    expect(flakyRow(flakyCase({ name: "frame order" })).name).toBe("frame order");
    expect(flakyRow(flakyCase({ suite: null })).where).toBe("acme/helios-firmware");
  });

  it("matches AT.3's three states, pill for pill", () => {
    expect(Object.keys(FLAKY_STATES).sort()).toEqual(["fixed", "quarantined", "watching"]);
    expect(FLAKY_STATES.watching).toEqual({ label: "watching", tone: "neutral" });
  });
});

describe("flakyContext", () => {
  it("says a fixed case nothing attributes is healthy again — and cites no loop", () => {
    expect(flakyContext(withoutResolved({ state: "fixed" }))).toEqual([{ text: BACK_TO_HEALTHY }]);
  });

  it("names the trend and the rig a quarantined case flaked on, the rig linked to the farm", () => {
    expect(flakyContext(withoutResolved({ state: "quarantined", trend: "rising", platform: "rig:hil-rig-02" }))).toEqual([
      { text: "rising on " },
      { text: "hil-rig-02", href: `${BUILD_FARM_PATH}#${FARM_RUNNERS_HASH}` },
    ]);
  });

  it("guesses no machine when the occurrences named several, or none", () => {
    expect(flakyContext(withoutResolved({ state: "quarantined", trend: "falling" }))).toEqual([{ text: "falling" }]);
    expect(flakyContext(withoutResolved({ state: "quarantined", trend: "flat" }))).toEqual([{ text: "steady" }]);
  });

  it("says a watching case is under threshold, as the mockup does, whatever its trend", () => {
    expect(flakyContext(withoutResolved({ state: "watching", trend: "rising" }))).toEqual([{ text: UNDER_THRESHOLD }]);
    expect(flakyContext(withoutResolved({ state: "watching", platform: "linux-x64" }))).toEqual([
      { text: `${UNDER_THRESHOLD} on ` },
      { text: "linux-x64" },
    ]);
  });
});

describe("platformPart", () => {
  it("links a rig to the farm's runner list and draws any other platform as words", () => {
    expect(platformPart("rig:hil-rig-02")).toEqual({ text: "hil-rig-02", href: "/build-farm#runners-card-title" });
    expect(platformPart("macos-arm64")).toEqual({ text: "macos-arm64" });
  });
});

describe("flakyView", () => {
  it("tags the card with the page's own range", () => {
    expect(flakyView(seededFlaky(), "7d").tag).toBe("7d window");
  });

  it("draws the seeded three rows, in the service's order, with nothing more to say", () => {
    const view = flakyView(seededFlaky(), "30d");

    expect(view.rows.map((row) => row.state.label)).toEqual(["fixed", "quarantined", "watching"]);
    expect(view.more).toBeNull();
    expect(view.empty).toBeNull();
  });

  it("draws the worst rows and says how many more there are", () => {
    const cases = Array.from({ length: FLAKY_ROWS + 3 }, (_, index) => flakyCase({ caseKey: `t${index}` }));
    const view = flakyView({ cases }, "30d");

    expect(view.rows.map((row) => row.name)).toEqual(["t0", "t1", "t2", "t3", "t4"]);
    expect(view.more).toBe(`Showing the worst ${FLAKY_ROWS} of ${FLAKY_ROWS + 3}.`);
  });

  it("draws the designed empty state for a range with nothing distrusted", () => {
    expect(flakyView({ cases: [] }, "30d")).toMatchObject({ rows: [], empty: NO_FLAKY, more: null });
  });
});

describe("the playbook", () => {
  /**
   * A playbook as the list serves it.
   *
   * @param id Its id.
   * @param name Its name.
   * @returns The playbook.
   */
  const recipe = (id: string, name: string) => ({ id, name }) as Playbook;

  it("finds the flaky-test recipe among the workspace's, and nothing else", () => {
    expect(flakyPlaybookOf([recipe("a", "CVE bump"), recipe("b", "Flaky test hunt")])).toEqual({
      id: "b",
      name: "Flaky test hunt",
    });
    expect(flakyPlaybookOf([recipe("a", "CVE bump"), recipe("c", "Flaky test hunt v2")])).toBeNull();
    expect(flakyPlaybookOf([])).toBeNull();
  });

  it("links the real recipe by its row on the Knowledge page", () => {
    expect(playbookLink(SEEDED_PLAYBOOK)).toEqual({
      kind: "link",
      label: "Open playbook: Flaky test hunt →",
      href: playbookPath(SEEDED_PLAYBOOK.id),
    });
    expect(playbookPath("5eed")).toBe(`${KNOWLEDGE_PATH}#playbook-5eed`);
  });

  it("says plainly that there is none, and where recipes are made", () => {
    expect(playbookLink(null)).toEqual({ kind: "absent", note: NO_PLAYBOOK, label: PLAYBOOKS_LINK, href: PLAYBOOKS_HREF });
    expect(PLAYBOOKS_HREF).toBe("/knowledge#playbooks");
  });

  it("draws nothing when the playbooks could not be read — neither claim is known", () => {
    expect(playbookLink(undefined)).toBeNull();
  });
});
