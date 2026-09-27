import {
  MAX_DISARM_REASON,
  MERGE_REFUSAL_CODES,
  formatDisarmReason,
  parseDisarmReason,
  recheck,
  recheckHost,
  recheckVerification,
  refusal,
  type RecheckInput,
} from "./merge.recheck";

/**
 * The re-check (AX.4, [#360](https://github.com/NobuData/ouroboros/issues/360), decision V3): each
 * way the situation can have moved since arming refuses with its designed code, in the documented
 * order, and only the pending wait leaves an arm standing.
 */

/** Revision 2 of #514, all seven gates satisfied, the host open at its head. */
const READY: RecheckInput = {
  armedRevisionId: "rev-2",
  latest: { id: "rev-2", seq: 2, headSha: "c81d3e4a9f" },
  gates: { mergeReady: true, red: [], satisfied: 7, required: 7 },
  host: { state: "open", headSha: "c81d3e4a9f00112233", mergeable: true },
};

describe("recheck", () => {
  it("passes a PR whose arm, gates and host all still hold", () => {
    expect(recheck(READY)).toEqual({ ok: true });
  });

  it("passes a direct merge of a plan never armed, and a host still computing mergeability", () => {
    expect(recheck({ ...READY, armedRevisionId: null })).toEqual({ ok: true });
    expect(recheck({ ...READY, host: { ...READY.host, mergeable: null } })).toEqual({ ok: true });
  });

  it("refuses a head that moved after arming — the head-sha check", () => {
    const verdict = recheck({
      ...READY,
      latest: { id: "rev-3", seq: 3, headSha: "d00dfeed11" },
    });

    expect(verdict).toMatchObject({ ok: false, code: "head_moved", disarms: true });
    expect(verdict.ok ? "" : verdict.message).toContain("revision 3 (d00dfee)");
  });

  it("refuses a PR with no revision at all", () => {
    expect(recheck({ ...READY, latest: null })).toMatchObject({ code: "head_moved" });
  });

  it("refuses a gate that went red, naming it", () => {
    expect(
      recheck({
        ...READY,
        gates: { mergeReady: false, red: ["Physical HIL"], satisfied: 6, required: 7 },
      }),
    ).toEqual({
      ok: false,
      code: "gate_red",
      message: "Physical HIL is red on revision 2.",
      disarms: true,
    });
    expect(
      recheck({
        ...READY,
        gates: { mergeReady: false, red: ["Build", "Test suite"], satisfied: 5, required: 7 },
      }),
    ).toMatchObject({ message: "Build, Test suite are red on revision 2." });
  });

  it("waits, without disarming, while gates are only pending", () => {
    expect(
      recheck({ ...READY, gates: { mergeReady: false, red: [], satisfied: 5, required: 7 } }),
    ).toEqual({
      ok: false,
      code: "gates_pending",
      message: "5 of 7 required gates are satisfied on revision 2.",
      disarms: false,
    });
  });

  it("refuses a PR the host no longer reports open", () => {
    expect(recheck({ ...READY, host: { ...READY.host, state: "closed" } })).toMatchObject({
      code: "host_not_open",
      message: "The host reports the PR closed.",
    });
  });

  it("refuses a host head the mirror has not verified — a push not yet synced", () => {
    expect(recheck({ ...READY, host: { ...READY.host, headSha: "e1f2a3b4c5" } })).toMatchObject({
      code: "host_head_moved",
      disarms: true,
    });
  });

  it("refuses a host conflict", () => {
    expect(recheck({ ...READY, host: { ...READY.host, mergeable: false } })).toMatchObject({
      code: "host_conflict",
      disarms: true,
    });
  });

  it("asks in order: the arm before the gates, the gates before the host", () => {
    const everything: RecheckInput = {
      armedRevisionId: "rev-1",
      latest: READY.latest,
      gates: { mergeReady: false, red: ["Build"], satisfied: 0, required: 7 },
      host: { state: "closed", headSha: "ffffffff", mergeable: false },
    };

    expect(recheck(everything)).toMatchObject({ code: "head_moved" });
    expect(recheck({ ...everything, armedRevisionId: "rev-2" })).toMatchObject({
      code: "gate_red",
    });
    expect(recheck({ ...everything, armedRevisionId: "rev-2", gates: READY.gates })).toMatchObject({
      code: "host_not_open",
    });
  });

  it("is its two halves composed — the database's, then the host's", () => {
    expect(recheckVerification(READY)).toEqual({ ok: true });
    expect(
      recheckHost(READY.latest ?? { id: "", seq: 0, headSha: "" }, {
        ...READY.host,
        mergeable: false,
      }),
    ).toMatchObject({ code: "host_conflict" });
  });
});

describe("disarm_reason", () => {
  it("stores code and sentence, and reads them back", () => {
    const stored = formatDisarmReason(refusal("gate_red", "Physical HIL is red on revision 2."));

    expect(stored).toBe("gate_red: Physical HIL is red on revision 2.");
    expect(parseDisarmReason(stored)).toEqual({
      code: "gate_red",
      message: "Physical HIL is red on revision 2.",
    });
    expect(parseDisarmReason(null)).toBeNull();
  });

  it("round-trips every code", () => {
    for (const code of MERGE_REFUSAL_CODES) {
      expect(parseDisarmReason(formatDisarmReason({ code, message: "m" }))).toEqual({
        code,
        message: "m",
      });
    }
  });

  it("bounds what it stores to V058's 1024", () => {
    expect(formatDisarmReason({ code: "host_refused", message: "x".repeat(2000) })).toHaveLength(
      MAX_DISARM_REASON,
    );
  });

  it("shows a reason whose code it does not know rather than hiding it", () => {
    expect(parseDisarmReason("somebody wrote this by hand")).toEqual({
      code: "host_refused",
      message: "somebody wrote this by hand",
    });
  });
});
