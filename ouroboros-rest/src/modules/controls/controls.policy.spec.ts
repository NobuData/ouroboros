import { RUN_CONTROL_KINDS, type OrganizationRole, type RunControlKind } from "../db/schema";
import {
  CONTROL_ROLES,
  confirmationMatches,
  defaultAckDetail,
  finishedRunRejection,
  isDeduplicated,
  mayRequest,
  ttlSeconds,
} from "./controls.policy";

/**
 * The pure rules of the control queue (#306): the role matrix, the typed confirmation, what
 * collapses into one control, the TTLs, and the sentences an ack and a rejection default to.
 */

describe("the role matrix", () => {
  const ROLES: readonly OrganizationRole[] = ["owner", "admin", "member", "viewer"];

  /** Who may press each button, as the issue states it: steer is member+, the rest admin+. */
  const EXPECTED: Record<RunControlKind, readonly OrganizationRole[]> = {
    steer: ["owner", "admin", "member"],
    pause: ["owner", "admin"],
    resume: ["owner", "admin"],
    abort: ["owner", "admin"],
  };

  it.each(RUN_CONTROL_KINDS.flatMap((kind) => ROLES.map((role) => [kind, role] as const)))(
    "%s by a %s is decided by the matrix",
    (kind, role) => {
      expect(mayRequest(kind, [role])).toBe(EXPECTED[kind].includes(role));
    },
  );

  it("covers every kind the schema declares", () => {
    expect(Object.keys(CONTROL_ROLES).sort()).toEqual([...RUN_CONTROL_KINDS].sort());
  });

  it("lets a membership through when any one of its roles suffices", () => {
    expect(mayRequest("abort", ["member", "admin"])).toBe(true);
  });

  it("refuses a membership with no recognised role", () => {
    expect(mayRequest("steer", [])).toBe(false);
  });
});

describe("the typed confirmation", () => {
  it("matches the loop number exactly", () => {
    expect(confirmationMatches(1847, "1847")).toBe(true);
  });

  it("forgives surrounding whitespace and a leading #", () => {
    expect(confirmationMatches(1847, "  1847 ")).toBe(true);
    expect(confirmationMatches(1847, "#1847")).toBe(true);
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["another run's number", "1846"],
    ["a word", "abort"],
    ["a prefix", "184"],
    ["the number with a suffix", "18470"],
    ["two hashes", "##1847"],
  ])("refuses a confirmation that is %s", (_description, typed) => {
    expect(confirmationMatches(1847, typed)).toBe(false);
  });
});

describe("what collapses into one control", () => {
  it("collapses a repeated pause or abort", () => {
    expect(isDeduplicated("pause")).toBe(true);
    expect(isDeduplicated("abort")).toBe(true);
  });

  it("keeps every steer and every resume", () => {
    expect(isDeduplicated("steer")).toBe(false);
    expect(isDeduplicated("resume")).toBe(false);
  });
});

describe("the TTLs", () => {
  const TTLS = { control: 120, steer: 300 };

  it("gives a steer the steer TTL and every other kind the control TTL", () => {
    expect(ttlSeconds("steer", TTLS)).toBe(300);
    expect(ttlSeconds("pause", TTLS)).toBe(120);
    expect(ttlSeconds("resume", TTLS)).toBe(120);
    expect(ttlSeconds("abort", TTLS)).toBe(120);
  });
});

describe("the default sentences", () => {
  it("names the attempt a steer landed on, which is what the console reads out", () => {
    expect(defaultAckDetail("steer", 2)).toBe("steering applied to attempt 2");
  });

  it("says less rather than guessing when the executor named no attempt", () => {
    expect(defaultAckDetail("steer")).toBe("steering applied");
  });

  it("has a sentence for every other kind", () => {
    expect(defaultAckDetail("pause")).toBe("paused");
    expect(defaultAckDetail("resume")).toBe("resumed");
    expect(defaultAckDetail("abort")).toBe("aborted — branch preserved");
  });

  it("explains a rejection with the run's status, readably", () => {
    expect(finishedRunRejection("needs_human")).toBe(
      "The run is needs human and has already finished, so there is nothing left to control.",
    );
    expect(finishedRunRejection("canceled")).toContain("canceled");
  });

  it("keeps every rejection within the ack detail's bound", () => {
    for (const status of ["merged", "needs_human", "failed", "canceled"] as const) {
      expect(finishedRunRejection(status).length).toBeLessThanOrEqual(1024);
    }
  });
});
