import { describe, expect, it } from "vitest";

import {
  DRAIN,
  LIFECYCLE_FORBIDDEN,
  REMOVE,
  REMOVE_CONSEQUENCES,
  RUNNER_ALREADY_REMOVED,
  RUNNER_GONE,
  UNDRAIN,
  VIEW_DETAILS,
  isRemovable,
  lifecycleConfirm,
  lifecycleDone,
  lifecycleNote,
  lifecycleRefusal,
  lifecycleTitle,
  removeBlocked,
  runnerMenu,
} from "@/app/farm/lifecycle";
import type { RunnerIntent, RunnerStatus } from "@/app/farm/runners";

/**
 * Every decision the runner's `⋯` menu makes (#260): what it offers, to whom, and what it says
 * before and after a write. Pure, so each acceptance criterion is a small value.
 */

/**
 * A menu, as the words on it.
 *
 * @param status What the fleet last observed.
 * @param intent What an operator last intended.
 * @param mayAdminister Whether the reader may act.
 * @returns The labels, in order.
 */
function labels(status: RunnerStatus, intent: RunnerIntent, mayAdminister = true): string[] {
  return runnerMenu(status, intent, mayAdminister).map((item) => item.label);
}

describe("what the menu offers", () => {
  it("offers Drain, Remove and View details on a machine in service", () => {
    expect(labels("online", "active")).toEqual([DRAIN, REMOVE, VIEW_DETAILS]);
    expect(labels("building", "active")).toEqual([DRAIN, REMOVE, VIEW_DETAILS]);
  });

  it("offers Undrain in Drain's place on a drained machine", () => {
    expect(labels("draining", "draining")).toEqual([UNDRAIN, REMOVE, VIEW_DETAILS]);
  });

  it("decides between the two on intent, so a drain just asked for is not offered twice", () => {
    // The pill still reads *building* until the agent's next heartbeat. The menu reads what the
    // operator asked for, and offers the way back.
    expect(labels("building", "draining")).toEqual([UNDRAIN, REMOVE, VIEW_DETAILS]);
  });

  it("offers Drain again on a machine that was returned to service and still reports draining", () => {
    // Undrain was already asked. Offering it again would be offering what was done.
    expect(labels("draining", "active")).toEqual([DRAIN, REMOVE, VIEW_DETAILS]);
  });

  it("lets an offline machine be drained — the intent is told at its next hello", () => {
    expect(labels("offline", "active")).toEqual([DRAIN, REMOVE, VIEW_DETAILS]);
  });

  it("marks only Remove as destructive", () => {
    expect(
      runnerMenu("offline", "active", true)
        .filter((item) => item.danger)
        .map((item) => item.label),
    ).toEqual([REMOVE]);
  });
});

describe("the removal guard", () => {
  it.each<[RunnerStatus, boolean]>([
    ["online", false],
    ["building", false],
    ["draining", true],
    ["offline", true],
    ["removed", false],
  ])("reads %s as removable: %s", (status, removable) => {
    // The service's `REMOVABLE_STATUSES`, exactly.
    expect(isRemovable(status)).toBe(removable);
  });

  it.each<RunnerStatus>(["online", "building"])(
    "blocks Remove on a machine that is %s, and keeps it on the menu with the reason",
    (status) => {
      const remove = runnerMenu(status, "active", true).find((item) => item.action === "remove");

      // Drawn and inert rather than absent: *blocked, with an explanation*.
      expect(remove?.reason).toBe(removeBlocked(status));
    },
  );

  it.each<RunnerStatus>(["offline", "draining"])("permits Remove on a machine that is %s", (status) => {
    const remove = runnerMenu(status, "active", true).find((item) => item.action === "remove");

    expect(remove?.reason).toBeNull();
  });

  it("says why, in the pill's own word, and what to do instead", () => {
    // `online` is drawn as *idle*: the sentence uses the word the reader can see in the row.
    expect(removeBlocked("online")).toContain("idle");
    expect(removeBlocked("building")).toContain("building");
    expect(removeBlocked("building")).toMatch(/orphans/u);
    expect(removeBlocked("building")).toMatch(/Drain it first/u);
  });

  it("blocks on what was observed, not on what was asked", () => {
    // Drained a second ago and still building: the service's guard reads `status`, so the
    // removal would be refused — and the menu says so rather than offering it.
    const remove = runnerMenu("building", "draining", true).find((item) => item.action === "remove");

    expect(remove?.reason).toBe(removeBlocked("building"));
  });
});

describe("a member", () => {
  it.each<[RunnerStatus, RunnerIntent]>([
    ["online", "active"],
    ["building", "active"],
    ["draining", "draining"],
    ["offline", "active"],
  ])("sees View details alone on a machine that is %s", (status, intent) => {
    // Absent rather than disabled — the issue's wording. View details is a read.
    expect(labels(status, intent, false)).toEqual([VIEW_DETAILS]);
  });
});

describe("a machine that has been retired", () => {
  it("has nothing left to do to it", () => {
    expect(labels("removed", "removed")).toEqual([VIEW_DETAILS]);
    expect(labels("offline", "removed")).toEqual([VIEW_DETAILS]);
  });
});

describe("what a confirmation says", () => {
  it("titles each write with the runner's name", () => {
    expect(lifecycleTitle("drain", "forge-01")).toBe("Drain forge-01?");
    expect(lifecycleTitle("undrain", "bigiron")).toBe("Return bigiron to service?");
    expect(lifecycleTitle("remove", "forge-03")).toBe("Remove forge-03 from the fleet?");
  });

  it("promises that the current job continues, and names it", () => {
    const note = lifecycleNote("drain", { name: "forge-01", job: "#479 zephyr build" });

    expect(note).toContain("finishes #479 zephyr build");
    expect(note).toContain("not interrupted");
    expect(note).toContain("no deadline");
  });

  it("says what a drain means for a machine running nothing", () => {
    const note = lifecycleNote("drain", { name: "forge-02", job: null });

    expect(note).toContain("forge-02 accepts no new builds");
    expect(note).not.toContain("finishes");
  });

  it("says what an undrain does", () => {
    expect(lifecycleNote("undrain", { name: "bigiron", job: null })).toBe(
      "bigiron accepts new builds again.",
    );
  });

  it("names what a removal will do, rather than asking whether the reader is sure", () => {
    const text = REMOVE_CONSEQUENCES.join(" ");

    // Each is something the service does: the row leaves the page's counts, the certificate is
    // revoked, the builds keep their rows, and an audit event is written.
    expect(text).toMatch(/leaves the fleet/u);
    expect(text).toMatch(/certificate is revoked/u);
    expect(text).toMatch(/cannot reconnect/u);
    expect(text).toMatch(/keep their history/u);
    expect(text).toMatch(/audit trail/u);
    expect(text).not.toMatch(/are you sure/iu);
  });

  it("words the confirming button for what it does, and for while it is doing it", () => {
    expect(lifecycleConfirm("drain", "forge-01", false)).toBe("Drain forge-01");
    expect(lifecycleConfirm("drain", "forge-01", true)).toBe("Draining…");
    expect(lifecycleConfirm("undrain", "bigiron", false)).toBe("Return bigiron to service");
    expect(lifecycleConfirm("remove", "forge-03", false)).toBe("Remove forge-03");
    expect(lifecycleConfirm("remove", "forge-03", true)).toBe("Removing…");
  });
});

describe("what a refusal says", () => {
  it("names the state the machine is now in when the service's guard refused", () => {
    // The page that offered the removal was up to ten seconds old; the service's answer is the
    // newer one, and it carries the status.
    const sentence = lifecycleRefusal("remove", {
      code: "farm_runner_not_removable",
      details: { status: "building" },
    });

    expect(sentence).toContain("It is building now");
    expect(sentence).toContain("was not removed");
    expect(sentence).toMatch(/Drain it/u);
  });

  it("uses the pill's word for a machine that came back online", () => {
    expect(
      lifecycleRefusal("remove", { code: "farm_runner_not_removable", details: { status: "online" } }),
    ).toContain("It is idle now");
  });

  it("still makes sense when the refusal carries no status it knows", () => {
    expect(
      lifecycleRefusal("remove", { code: "farm_runner_not_removable", details: { status: 7 } }),
    ).toContain("It is connected now");
  });

  it("tells a member who reached the action anyway that nothing changed", () => {
    expect(lifecycleRefusal("drain", { code: "forbidden", details: {} })).toBe(LIFECYCLE_FORBIDDEN);
    expect(LIFECYCLE_FORBIDDEN).toContain("Nothing was changed");
  });

  it("tells a machine that is gone from one that was already removed", () => {
    expect(lifecycleRefusal("drain", { code: "farm_runner_not_found", details: {} })).toBe(RUNNER_GONE);
    expect(lifecycleRefusal("drain", { code: "farm_runner_removed", details: {} })).toBe(
      RUNNER_ALREADY_REMOVED,
    );
  });

  it.each([
    ["drain", "could not be drained"],
    ["undrain", "could not be returned to service"],
    ["remove", "could not be removed"],
  ] as const)("says a failed %s in its own words, and that nothing changed", (action, phrase) => {
    const sentence = lifecycleRefusal(action, { code: "internal_error", details: {} });

    expect(sentence).toContain(phrase);
    expect(sentence).toContain("Nothing was changed");
  });
});

describe("what is said once a write has taken", () => {
  it("says done when the agent was told", () => {
    expect(lifecycleDone("drain", "forge-01", true)).toContain("forge-01 is draining");
    expect(lifecycleDone("undrain", "bigiron", true)).toBe("bigiron is back in service.");
  });

  it("says asked, not done, while the frame has not reached the agent", () => {
    // `pushed: false` is not a failure — the intent is written — but the machine does not
    // know yet, and saying *is draining* would be a claim about it.
    expect(lifecycleDone("drain", "forge-01", false)).toBe(
      "Drain requested — forge-01 is told at its next heartbeat.",
    );
    expect(lifecycleDone("undrain", "bigiron", false)).toContain("requested");
  });

  it("says a removal plainly", () => {
    expect(lifecycleDone("remove", "forge-03", null)).toBe("forge-03 was removed from the fleet.");
  });
});
