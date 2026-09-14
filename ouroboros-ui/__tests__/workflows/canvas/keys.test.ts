import { describe, expect, it } from "vitest";

import { historyKey, isDeleteKey, isTypingTarget } from "@/app/workflows/canvas/keys";

/**
 * The canvas's shortcuts (#151): which presses are Undo, Redo and Delete, and where a press is typing
 * rather than a shortcut.
 */

/** A key press with no modifier held. */
const PLAIN = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

describe("history shortcuts", () => {
  it.each([
    ["⌘Z", { ...PLAIN, key: "z", metaKey: true }, "undo"],
    ["Ctrl+Z", { ...PLAIN, key: "z", ctrlKey: true }, "undo"],
    ["⇧⌘Z", { ...PLAIN, key: "Z", metaKey: true, shiftKey: true }, "redo"],
    ["Ctrl+Shift+Z", { ...PLAIN, key: "Z", ctrlKey: true, shiftKey: true }, "redo"],
    ["Ctrl+Y", { ...PLAIN, key: "y", ctrlKey: true }, "redo"],
  ] as const)("reads %s", (_name, event, action) => {
    expect(historyKey(event)).toBe(action);
  });

  it.each([
    ["a plain z", { ...PLAIN, key: "z" }],
    ["⌥⌘Z", { ...PLAIN, key: "z", metaKey: true, altKey: true }],
    ["Ctrl+Shift+Y", { ...PLAIN, key: "Y", ctrlKey: true, shiftKey: true }],
    ["⌘C", { ...PLAIN, key: "c", metaKey: true }],
  ] as const)("ignores %s", (_name, event) => {
    expect(historyKey(event)).toBeNull();
  });
});

describe("the delete shortcut", () => {
  it("is Delete or Backspace with no modifier", () => {
    expect(isDeleteKey({ ...PLAIN, key: "Delete" })).toBe(true);
    expect(isDeleteKey({ ...PLAIN, key: "Backspace" })).toBe(true);
    expect(isDeleteKey({ ...PLAIN, key: "Backspace", metaKey: true })).toBe(false);
    expect(isDeleteKey({ ...PLAIN, key: "Delete", ctrlKey: true })).toBe(false);
    expect(isDeleteKey({ ...PLAIN, key: "Enter" })).toBe(false);
  });
});

describe("typing", () => {
  it("is a press on a text input, a textarea or a select", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(isTypingTarget(document.createElement(tag)), tag).toBe(true);
    }
  });

  it("is not a press on a stage, a button or nothing at all", () => {
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
