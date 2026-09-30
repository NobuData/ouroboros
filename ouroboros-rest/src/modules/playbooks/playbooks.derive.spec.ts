import {
  MAX_OVERRIDE_IDS,
  MAX_STEER_NOTES,
  MAX_STEER_NOTE_LENGTH,
  deriveOverrides,
  overlapOf,
  readFilter,
  readOverrides,
  readPreset,
  steerPreset,
  storedFilter,
  storedOverrides,
  storedPreset,
} from "./playbooks.derive";

/**
 * The pure rules of playbooks (#415, K6): a run's manifest as a delta against assembly, its steers
 * as a preset, and V072's three documents written and read.
 */

describe("deriving overrides from a run's manifest", () => {
  const resolved = [
    { skillId: "hil", required: true },
    { skillId: "zephyr", required: false },
    { skillId: "commit", required: false },
  ];

  it("derives nothing when the run has no injection record at all", () => {
    expect(deriveOverrides(null, resolved)).toEqual({ enable: [], disable: [] });
  });

  it("derives nothing when the run's skills are what assembly resolves today", () => {
    expect(deriveOverrides(new Set(["hil", "zephyr", "commit"]), resolved)).toEqual({
      enable: [],
      disable: [],
    });
  });

  it("enables what the run had and assembly would not; disables what it went without", () => {
    expect(deriveOverrides(new Set(["hil", "zephyr", "legacy-timer"]), resolved)).toEqual({
      enable: ["legacy-timer"],
      disable: ["commit"],
    });
  });

  it("never disables a required skill, even when the run went without it", () => {
    expect(deriveOverrides(new Set(["zephyr", "commit"]), resolved).disable).toEqual([]);
  });

  it("is sorted and capped at V072's bound", () => {
    const many = new Set(
      Array.from({ length: 80 }, (_, index) => `s${String(index).padStart(2, "0")}`),
    );
    const { enable } = deriveOverrides(many, []);

    expect(enable).toHaveLength(MAX_OVERRIDE_IDS);
    expect(enable).toEqual([...enable].sort());
  });
});

describe("steer notes", () => {
  it("keeps what was typed, trimmed, in order, once, without blanks", () => {
    expect(
      steerPreset(["  focus flakiest first ", "", "rerun 5x", "focus flakiest first"]),
    ).toEqual(["focus flakiest first", "rerun 5x"]);
  });

  it("holds V072's bounds: sixteen notes of at most 2000 characters", () => {
    const notes = steerPreset([
      "x".repeat(MAX_STEER_NOTE_LENGTH + 50),
      ...Array.from({ length: 30 }, (_, index) => `note ${String(index)}`),
    ]);

    expect(notes).toHaveLength(MAX_STEER_NOTES);
    expect(notes[0]).toHaveLength(MAX_STEER_NOTE_LENGTH);
  });
});

describe("V072's documents", () => {
  it("stores only non-empty halves and keys — {} is no delta and no preset", () => {
    expect(storedOverrides({ enable: [], disable: [] })).toEqual({});
    expect(storedOverrides({ enable: ["a"], disable: [] })).toEqual({ enable: ["a"] });
    expect(storedPreset({ steerNotes: [], factIds: [] })).toEqual({});
    expect(storedPreset({ steerNotes: [" go "], factIds: ["f"] })).toEqual({
      steer_notes: ["go"],
      fact_ids: ["f"],
    });
  });

  it("stores a filter admitting everything as null, and repositories lower-cased", () => {
    expect(storedFilter(null)).toBeNull();
    expect(storedFilter({ labels: [], repos: null })).toBeNull();
    expect(storedFilter({ labels: ["flaky", "flaky"], repos: ["Acme/Helios"] })).toEqual({
      labels: ["flaky"],
      repos: ["acme/helios"],
    });
  });

  it("reads each back, tolerating what is absent", () => {
    expect(readOverrides({ disable: ["x"] })).toEqual({ enable: [], disable: ["x"] });
    expect(readPreset({})).toEqual({ steerNotes: [], factIds: [] });
    expect(readPreset({ steer_notes: ["a"], fact_ids: ["f"] })).toEqual({
      steerNotes: ["a"],
      factIds: ["f"],
    });
    expect(readFilter(null)).toBeNull();
    expect(readFilter({ labels: ["dependencies"] })).toEqual({
      labels: ["dependencies"],
      repos: null,
    });
  });

  it("finds a skill both enabled and disabled", () => {
    expect(overlapOf({ enable: ["a", "b"], disable: ["b"] })).toEqual(["b"]);
    expect(overlapOf({ enable: ["a"], disable: ["b"] })).toEqual([]);
  });
});
