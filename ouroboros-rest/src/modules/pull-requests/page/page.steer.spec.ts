import { MAX_STEER_LENGTH } from "../../controls/controls.dto";
import { composeSteer, NOTE_PREFIX } from "./page.steer";

/**
 * *Return to loop*'s steer text (AX.5, [#361](https://github.com/NobuData/ouroboros/issues/361)) —
 * the selected gates' evidence, never "please fix the PR".
 */

const HIL = { key: "physical_hil", evidence: "overshoot 2.4% > 2.0% · rig helios-rig-02" };
const TESTS = { key: "test_suite", evidence: "61/63 after attempt 3" };

describe("composeSteer", () => {
  it("is the gate's evidence line, keyed by the gate", () => {
    expect(composeSteer([HIL])).toBe("physical_hil: overshoot 2.4% > 2.0% · rig helios-rig-02");
  });

  it("changes with the selection — one line per gate, in the order given", () => {
    expect(composeSteer([TESTS, HIL])).toBe(
      "test_suite: 61/63 after attempt 3\nphysical_hil: overshoot 2.4% > 2.0% · rig helios-rig-02",
    );
    expect(composeSteer([TESTS])).not.toBe(composeSteer([HIL]));
  });

  it("appends the person's note after a blank line, marked as a note", () => {
    expect(composeSteer([HIL], "  keep the PID loop on its own timer ")).toBe(
      `${composeSteer([HIL])}\n\n${NOTE_PREFIX}keep the PID loop on its own timer`,
    );
    expect(composeSteer([HIL], "   ")).toBe(composeSteer([HIL]));
  });

  it("says so when a red gate carries no evidence line, rather than sending an empty one", () => {
    expect(composeSteer([{ key: "custom:bench", evidence: null }])).toBe(
      "custom:bench: red (no evidence line)",
    );
  });

  it("stays within AP.4's steer limit, shortening the note before the evidence", () => {
    const gates = Array.from({ length: 7 }, (_, index) => ({
      key: `custom:g${String(index)}`,
      evidence: "x".repeat(512),
    }));
    const text = composeSteer(gates, "n".repeat(1024));

    expect(text.length).toBeLessThanOrEqual(MAX_STEER_LENGTH);
    expect(text).toContain(composeSteer(gates));
    expect(text.endsWith("…")).toBe(true);
  });

  it("drops the note entirely when the evidence leaves no room for it", () => {
    const text = composeSteer([{ key: "build", evidence: "e".repeat(100) }], "note", 108);

    expect(text).toBe(`build: ${"e".repeat(100)}`.slice(0, 108));
  });
});
