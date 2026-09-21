import { describe, expect, it } from "vitest";

import { ROLES } from "@/app/api/membership";
import {
  CREATE_POOL,
  FARM_LOADING_LABEL,
  FARM_READ_ONLY_BODY,
  FIRST_RUN_MEMBER_NOTE,
  FIRST_RUN_NOTE,
  FLEET_DOWN_BODY,
  FLEET_THIN_BODY,
  GO_TO_ENROLL,
  STEP_COPY_COMMAND,
  STEP_CREATE_POOL,
  STEP_ONE,
  STEP_RUN_COMMAND,
  STEP_TWO,
  farmFirstRun,
  farmReadOnlyNote,
  firstRunSteps,
  fleetWarning,
  isPromoted,
  stepEyebrow,
} from "@/app/farm/states";

import { emptyFarm, farmRunner, farmStats, runnerPool, seededFarm } from "../helpers/farm";

/**
 * The build farm's states as decisions (#262): when a page is a first run and which kind, what
 * the steps and the cards' eyebrows then are, when a fleet is offline-heavy and how that is said,
 * and the read-only note — each a unit test on a small value, which is why `app/farm/states.ts`
 * is pure.
 */

/**
 * The payload's `runnersOnline`, with nothing offline named.
 *
 * @param online How many the fleet can vouch for.
 * @param total How many are enrolled.
 * @returns The card.
 */
function fleet(online: number, total: number) {
  return { online, total, note: null, offline: null };
}

describe("farmFirstRun", () => {
  it("is no first run over a page that could not be read — unread is not empty", () => {
    expect(farmFirstRun(null)).toBeNull();
    expect(farmFirstRun(null, [])).toBeNull();
    expect(farmFirstRun(null, [runnerPool()])).toBeNull();
  });

  it("is no first run once a single runner is enrolled, whatever the pools say", () => {
    expect(farmFirstRun(seededFarm())).toBeNull();
    expect(farmFirstRun({ ...emptyFarm(), runners: [farmRunner()] })).toBeNull();
    expect(farmFirstRun({ ...emptyFarm(), runners: [farmRunner()] }, [])).toBeNull();
  });

  it("starts at the pool when there is nothing at all — a runner enrols into one", () => {
    expect(farmFirstRun(emptyFarm())).toBe("no-pools");
  });

  it("starts at the command once there is a pool and no machine", () => {
    expect(farmFirstRun({ ...emptyFarm(), pools: [runnerPool()] })).toBe("no-runners");
  });

  it("reads the screen's pools over the page's, so a pool created a moment ago counts at once", () => {
    // The page has not caught up with a create…
    expect(farmFirstRun(emptyFarm(), [runnerPool()])).toBe("no-runners");
    // …nor with a delete.
    expect(farmFirstRun({ ...emptyFarm(), pools: [runnerPool()] }, [])).toBe("no-pools");
  });

  it("falls back to the page's pools when the screen holds none of its own", () => {
    expect(farmFirstRun({ ...emptyFarm(), pools: [runnerPool()] }, null)).toBe("no-runners");
    expect(farmFirstRun(emptyFarm(), null)).toBe("no-pools");
  });

  it("does not count an offline runner as no runner — a quiet fleet is not a first run", () => {
    const quiet = { ...emptyFarm(), runners: [farmRunner({ status: "offline" })] };

    expect(farmFirstRun(quiet)).toBeNull();
  });
});

describe("firstRunSteps", () => {
  it("puts the pool first only when there is none — the one case the command cannot be minted", () => {
    expect(firstRunSteps("no-pools")).toEqual([STEP_CREATE_POOL, STEP_COPY_COMMAND, STEP_RUN_COMMAND]);
  });

  it("makes enrolment step one wherever it can be", () => {
    expect(firstRunSteps("no-runners")).toEqual([STEP_COPY_COMMAND, STEP_RUN_COMMAND]);
  });

  it("gives every step a title and a sentence, and no two the same title", () => {
    const steps = firstRunSteps("no-pools");

    for (const step of steps) {
      expect(step.title.trim()).not.toBe("");
      expect(step.body).toMatch(/\.$/);
    }
    expect(new Set(steps.map((step) => step.title)).size).toBe(steps.length);
  });

  it("says what the mockup's note says about the connection — outbound, mTLS, no inbound ports", () => {
    expect(STEP_RUN_COMMAND.body).toContain("outbound over mTLS");
    expect(STEP_RUN_COMMAND.body).toContain("no inbound ports");
  });

  it("tells the reader the command is a secret before they copy it", () => {
    expect(STEP_COPY_COMMAND.body).toContain("single-use token");
    expect(STEP_COPY_COMMAND.body).toContain("secret");
  });
});

describe("the first run's copy", () => {
  it("points an administrator at the card marked with the eyebrow it names", () => {
    expect(FIRST_RUN_NOTE).toContain(STEP_ONE);
  });

  it("tells a member who can act and what they will then see, and points at no control", () => {
    expect(FIRST_RUN_MEMBER_NOTE).toContain("owners and admins");
    expect(FIRST_RUN_MEMBER_NOTE).toContain("readable here");
    expect(FIRST_RUN_MEMBER_NOTE).not.toContain(STEP_ONE);
  });

  it("names its two calls to action differently, because they do different things", () => {
    expect(CREATE_POOL).toBe("Create a pool");
    expect(GO_TO_ENROLL).not.toBe(CREATE_POOL);
  });
});

describe("stepEyebrow and isPromoted", () => {
  it("marks nothing outside a first run", () => {
    for (const card of ["enroll", "pools"] as const) {
      expect(stepEyebrow(null, card)).toBeNull();
      expect(isPromoted(null, card)).toBe(false);
    }
  });

  it("makes the pools card step one and the enroll card step two while there is no pool", () => {
    expect(stepEyebrow("no-pools", "pools")).toBe(STEP_ONE);
    expect(stepEyebrow("no-pools", "enroll")).toBe(STEP_TWO);
    expect(isPromoted("no-pools", "pools")).toBe(true);
    expect(isPromoted("no-pools", "enroll")).toBe(false);
  });

  it("makes the enroll card step one once there is a pool, and leaves the pools card unmarked", () => {
    expect(stepEyebrow("no-runners", "enroll")).toBe(STEP_ONE);
    expect(stepEyebrow("no-runners", "pools")).toBeNull();
    expect(isPromoted("no-runners", "enroll")).toBe(true);
    expect(isPromoted("no-runners", "pools")).toBe(false);
  });

  it("promotes exactly one card in either state", () => {
    for (const state of ["no-pools", "no-runners"] as const) {
      const promoted = (["enroll", "pools"] as const).filter((card) => isPromoted(state, card));

      expect(promoted).toHaveLength(1);
    }
  });
});

describe("fleetWarning", () => {
  it("says nothing over mockup 08's 4/5 — one machine away is an ordinary afternoon", () => {
    expect(fleetWarning(farmStats().runnersOnline)).toBeNull();
  });

  it("says nothing over an empty fleet: that is the first run's state, not a warning", () => {
    expect(fleetWarning(fleet(0, 0))).toBeNull();
  });

  it("says nothing while more than half the fleet is connected", () => {
    expect(fleetWarning(fleet(5, 5))).toBeNull();
    expect(fleetWarning(fleet(3, 5))).toBeNull();
    expect(fleetWarning(fleet(2, 3))).toBeNull();
    expect(fleetWarning(fleet(1, 1))).toBeNull();
  });

  it("warns from exactly half down, counting the machines away", () => {
    expect(fleetWarning(fleet(2, 4))).toEqual({
      headline: "2 of 4 runners are offline.",
      body: FLEET_THIN_BODY,
    });
    expect(fleetWarning(fleet(2, 5))?.headline).toBe("3 of 5 runners are offline.");
  });

  it("agrees with its verb when one machine is away", () => {
    expect(fleetWarning(fleet(1, 2))?.headline).toBe("1 of 2 runners is offline.");
  });

  it("says a fleet with nothing connected cannot build at all", () => {
    expect(fleetWarning(fleet(0, 5))).toEqual({
      headline: "All 5 runners are offline.",
      body: FLEET_DOWN_BODY,
    });
  });

  it("does not say `All 1 runners` over a fleet of one", () => {
    expect(fleetWarning(fleet(0, 1))).toEqual({
      headline: "The only runner is offline.",
      body: FLEET_DOWN_BODY,
    });
  });

  it("treats a count that overshoots as the whole fleet rather than printing a negative", () => {
    // The contract never sends one; a sentence reading `-1 of 2` must not be reachable anyway.
    expect(fleetWarning(fleet(-1, 2))?.headline).toBe("All 2 runners are offline.");
  });

  it("tells the two bodies apart: one fleet queues on what is left, the other on nothing", () => {
    expect(FLEET_THIN_BODY).toContain("still connected");
    expect(FLEET_DOWN_BODY).toContain("Nothing can build");
  });
});

describe("farmReadOnlyNote", () => {
  it("names the role with its article", () => {
    expect(farmReadOnlyNote("member").head).toBe("Viewing the build farm as a member.");
    expect(farmReadOnlyNote("viewer").head).toBe("Viewing the build farm as a viewer.");
    expect(farmReadOnlyNote("owner").head).toBe("Viewing the build farm as an owner.");
    expect(farmReadOnlyNote("admin").head).toBe("Viewing the build farm as an admin.");
  });

  it("forms a sentence for every role the contract publishes", () => {
    for (const role of ROLES) {
      expect(farmReadOnlyNote(role)).toEqual({
        head: expect.stringMatching(/^Viewing the build farm as an? \w+\.$/),
        body: FARM_READ_ONLY_BODY,
      });
    }
  });

  it("explains all three regions — the table, the pools and the enroll card — and who may write", () => {
    expect(FARM_READ_ONLY_BODY).toContain("an owner or an admin");
    expect(FARM_READ_ONLY_BODY).toContain("pool's switches");
    expect(FARM_READ_ONLY_BODY).toContain("enroll card");
    expect(FARM_READ_ONLY_BODY).toContain("runner's menu");
  });
});

describe("loading", () => {
  it("names the page it is loading", () => {
    expect(FARM_LOADING_LABEL).toBe("Loading the build farm");
  });
});
