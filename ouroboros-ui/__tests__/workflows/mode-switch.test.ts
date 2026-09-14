import { describe, expect, it } from "vitest";

import {
  SURFACE_LABELS,
  SWITCH_PROMPT_CANCEL,
  SWITCH_PROMPT_TITLE,
  type UnsavedBuffer,
  isPlainClick,
  switchPrompt,
  switchPromptBody,
} from "@/app/workflows/mode-switch";

/**
 * When a switch between the studio's editors asks first (V.1, #169).
 *
 * The ticket's criterion, in its words: **an unsaved, unparsed buffer prompts before a mode
 * switch discards it** — and, because both editors read the one draft (C3), nothing else does.
 * So most of this suite is the cases that must *not* prompt: a prompt that appeared on every
 * switch would teach a reader to dismiss it, which is the same failure as no prompt at all.
 */

/** The code editor holding code that has not parsed. */
const HELD: UnsavedBuffer = { surface: "code" };

/** A plain primary click. */
const PLAIN = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

describe("switchPrompt", () => {
  it("asks before leaving Code for Visual while Code holds a buffer", () => {
    const prompt = switchPrompt(HELD, "code", "visual");

    expect(prompt).not.toBeNull();
    expect(prompt?.title).toBe(SWITCH_PROMPT_TITLE);
    expect(prompt?.body).toBe(switchPromptBody("visual"));
    expect(prompt?.confirm).toBe("Discard and open Visual");
    expect(prompt?.cancel).toBe(SWITCH_PROMPT_CANCEL);
  });

  it("asks nothing when no buffer is held — both editors read the one draft", () => {
    expect(switchPrompt(null, "code", "visual")).toBeNull();
    expect(switchPrompt(null, "visual", "code")).toBeNull();
  });

  it("asks nothing for a press on the tab already open, which leaves nothing behind", () => {
    expect(switchPrompt(HELD, "code", "code")).toBeNull();
  });

  it("asks nothing when the buffer belongs to a surface other than the one being left", () => {
    // The Visual page cannot hold the code editor's buffer; a stale hold must not prompt there.
    expect(switchPrompt(HELD, "visual", "code")).toBeNull();
  });
});

describe("what the prompt says", () => {
  it("says the code never reached the draft, and what the other editor opens on", () => {
    const body = switchPromptBody("visual");

    expect(body).toMatch(/has not parsed yet/);
    expect(body).toMatch(/none of it has reached the draft both editors share/);
    expect(body).toMatch(/Switching to Visual discards it/);
    expect(body).toMatch(/last draft that saved/);
  });

  it("names each surface the way the segmented control does", () => {
    expect(SURFACE_LABELS).toEqual({ visual: "Visual", code: "Code" });
    expect(switchPromptBody("code")).toMatch(/Switching to Code discards it/);
  });

  it("offers staying as the plain answer, not a second destructive one", () => {
    expect(SWITCH_PROMPT_CANCEL).toBe("Keep editing");
  });
});

describe("isPlainClick", () => {
  it("is true for a primary click with nothing held", () => {
    expect(isPlainClick(PLAIN)).toBe(true);
  });

  it.each([
    ["⌘", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
    ["the middle button", { button: 1 }],
    ["the secondary button", { button: 2 }],
  ])("is false with %s, which opens the link elsewhere and discards nothing here", (_, change) => {
    expect(isPlainClick({ ...PLAIN, ...change })).toBe(false);
  });
});
