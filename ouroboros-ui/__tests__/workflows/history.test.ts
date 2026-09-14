import { describe, expect, it } from "vitest";

import { HISTORY_LIMIT, canRedo, canUndo, record, redo, startHistory, undo } from "@/app/workflows/history";

/**
 * Undo and redo over the draft (#151): a bounded history of values, where recording a new value
 * clears what was undone and recording the same value records nothing.
 */

describe("a fresh history", () => {
  it("holds one value with nothing to undo or redo", () => {
    const history = startHistory("a");

    expect(history).toEqual({ past: [], present: "a", future: [] });
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it("answers the same history for an undo or a redo with nothing to step to", () => {
    const history = startHistory("a");

    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });
});

describe("recording", () => {
  it("puts the new value in force and the old one behind it", () => {
    const history = record(record(startHistory("a"), "b"), "c");

    expect(history).toEqual({ past: ["a", "b"], present: "c", future: [] });
    expect(canUndo(history)).toBe(true);
  });

  it("records nothing for the value already in force", () => {
    const value = { nodes: [] };
    const history = startHistory(value);

    expect(record(history, value)).toBe(history);
  });

  it("drops the oldest value past the limit", () => {
    let history = startHistory(0);
    for (let n = 1; n <= 5; n += 1) history = record(history, n, 3);

    expect(history.past).toEqual([2, 3, 4]);
    expect(history.present).toBe(5);
  });

  it("keeps fifty steps by default", () => {
    let history = startHistory(0);
    for (let n = 1; n <= HISTORY_LIMIT + 10; n += 1) history = record(history, n);

    expect(HISTORY_LIMIT).toBe(50);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]).toBe(10);
  });

  it("clears the redo list, because a redo onto a changed value would replay onto the wrong state", () => {
    const undone = undo(record(record(startHistory("a"), "b"), "c"));
    expect(canRedo(undone)).toBe(true);

    const history = record(undone, "d");

    expect(history).toEqual({ past: ["a", "b"], present: "d", future: [] });
    expect(canRedo(history)).toBe(false);
  });
});

describe("undo and redo", () => {
  it("step back and forward through every recorded value, in order", () => {
    const history = record(record(startHistory("a"), "b"), "c");

    const once = undo(history);
    const twice = undo(once);

    expect(once).toEqual({ past: ["a"], present: "b", future: ["c"] });
    expect(twice).toEqual({ past: [], present: "a", future: ["b", "c"] });
    expect(redo(twice)).toEqual(once);
    expect(redo(redo(twice))).toEqual(history);
  });
});
