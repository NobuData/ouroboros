import { describe, expect, it } from "vitest";

import {
  type CodeSession,
  EMPTY_SESSION,
  addTab,
  adoptRead,
  arrive,
  bufferOf,
  bufferText,
  closeTab,
  discardBuffer,
  editBuffer,
  isCloseFocusedTabKey,
  isCloseTabKey,
  isDiverged,
  isModified,
  markSaved,
  openTab,
  parseSession,
  rebaseBuffer,
  retainPaths,
  tabKeyTarget,
} from "@/app/workflows/code/code-tabs";

import { STANDARD_FIX_TEXT } from "../../helpers/workflow-code";

/**
 * The tab strip and its buffers, as decisions (V.3, #171) — the acceptance criteria this suite
 * holds in data: **switching files preserves each file's buffer**, and **the modified-dot is
 * truthful: set on edit, cleared on successful save**. V.4 (#172) adds the etag each buffer was typed
 * under, and the one question it answers: **may this buffer be saved over the draft as it is read now,
 * or did the draft move under it?** The drawing and the navigation are `code-workbench.test.tsx`'s;
 * keeping the session for a browser session is `code-session.test.ts`'s.
 */

const STANDARD_FIX = "workflows/standard-fix.loop.ts";
const HOTFIX = "workflows/hotfix-p0.loop.ts";
const CONFIG = "ouroboros.config.ts";

/** The etag the page read the file under. */
const ETAG = "etag-1";

/** `STANDARD_FIX_TEXT` with one comment typed at the top. */
const EDITED = `// note\n${STANDARD_FIX_TEXT}`;

/**
 * A key press with no modifier held, unless the case says otherwise.
 *
 * @param key `KeyboardEvent.key`.
 * @param over The modifiers, and `code`, this case holds.
 * @returns The event's fields the decisions read.
 */
function press(key: string, over: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; code: string }> = {}) {
  return { key, code: "", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...over };
}

/**
 * A session with tabs open.
 *
 * @param tabs The tabs.
 * @param active The open one.
 * @returns The session.
 */
function withTabs(tabs: readonly string[], active: string | null): CodeSession {
  return { ...EMPTY_SESSION, tabs, active };
}

describe("opening", () => {
  it("adds a tab at the end without opening it, once", () => {
    const added = addTab(withTabs([STANDARD_FIX], STANDARD_FIX), HOTFIX);

    expect(added).toEqual(withTabs([STANDARD_FIX, HOTFIX], STANDARD_FIX));
    expect(addTab(added, HOTFIX)).toBe(added);
  });

  it("opens a file — its tab added when it has none, and put in the pane", () => {
    const opened = openTab(withTabs([STANDARD_FIX], STANDARD_FIX), CONFIG);

    expect(opened).toEqual(withTabs([STANDARD_FIX, CONFIG], CONFIG));
    expect(openTab(opened, CONFIG)).toBe(opened);
    expect(openTab(opened, STANDARD_FIX)).toEqual(withTabs([STANDARD_FIX, CONFIG], STANDARD_FIX));
  });

  it("opens the route's file on arrival, and nothing for a route whose workflow is missing", () => {
    expect(arrive(EMPTY_SESSION, STANDARD_FIX)).toEqual(withTabs([STANDARD_FIX], STANDARD_FIX));
    expect(arrive(withTabs([CONFIG], CONFIG), null)).toEqual(withTabs([CONFIG], null));
    expect(arrive(EMPTY_SESSION, null)).toBe(EMPTY_SESSION);
  });
});

describe("closing", () => {
  const three = withTabs([STANDARD_FIX, HOTFIX, CONFIG], HOTFIX);

  it("keeps the open file when another tab closes", () => {
    expect(closeTab(three, CONFIG)).toEqual(withTabs([STANDARD_FIX, HOTFIX], HOTFIX));
  });

  it("opens the tab to the right of the open one that closed, else the one to its left, else nothing", () => {
    expect(closeTab(three, HOTFIX).active).toBe(CONFIG);
    expect(closeTab(withTabs([STANDARD_FIX, HOTFIX], HOTFIX), HOTFIX).active).toBe(STANDARD_FIX);
    expect(closeTab(withTabs([HOTFIX], HOTFIX), HOTFIX)).toEqual(withTabs([], null));
  });

  it("changes nothing for a tab that is not open", () => {
    expect(closeTab(three, "workflows/gone.loop.ts")).toBe(three);
  });

  it("keeps the closed file's buffer, so closing a tab never loses what was typed", () => {
    const edited = editBuffer(withTabs([STANDARD_FIX], STANDARD_FIX), STANDARD_FIX, STANDARD_FIX_TEXT, EDITED, ETAG);
    const closed = closeTab(edited, STANDARD_FIX);

    expect(isModified(closed, STANDARD_FIX)).toBe(true);
    expect(bufferText(openTab(closed, STANDARD_FIX), STANDARD_FIX, STANDARD_FIX_TEXT)).toBe(EDITED);
  });
});

describe("forgetting files the project no longer has", () => {
  it("drops their tabs and buffers, and the open file with them", () => {
    const session = editBuffer(withTabs([STANDARD_FIX, HOTFIX], HOTFIX), HOTFIX, "a", "b", ETAG);

    expect(retainPaths(session, new Set([STANDARD_FIX, CONFIG]))).toEqual(withTabs([STANDARD_FIX], null));
  });

  it("keeps the open file when it is still known, and the same session when everything is", () => {
    const session = withTabs([STANDARD_FIX, HOTFIX], STANDARD_FIX);

    expect(retainPaths(session, new Set([STANDARD_FIX]))).toEqual(withTabs([STANDARD_FIX], STANDARD_FIX));
    expect(retainPaths(session, new Set([STANDARD_FIX, HOTFIX]))).toBe(session);
  });
});

describe("the buffer, and the modified-dot it is", () => {
  const opened = withTabs([STANDARD_FIX], STANDARD_FIX);

  it("carries no dot and opens on the read before anything is typed", () => {
    expect(isModified(opened, STANDARD_FIX)).toBe(false);
    expect(bufferOf(opened, STANDARD_FIX)).toBeUndefined();
    expect(bufferText(opened, STANDARD_FIX, STANDARD_FIX_TEXT)).toBe(STANDARD_FIX_TEXT);
  });

  it("is set by the edit, over the file as it was read and under the etag it was read with", () => {
    const edited = editBuffer(opened, STANDARD_FIX, STANDARD_FIX_TEXT, EDITED, ETAG);

    expect(bufferOf(edited, STANDARD_FIX)).toEqual({ base: STANDARD_FIX_TEXT, text: EDITED, etag: ETAG });
    expect(isModified(edited, STANDARD_FIX)).toBe(true);
    expect(bufferText(edited, STANDARD_FIX, STANDARD_FIX_TEXT)).toBe(EDITED);
    expect(isModified(edited, HOTFIX)).toBe(false);
  });

  it("clears the moment the text is typed back to what it was", () => {
    const edited = editBuffer(opened, STANDARD_FIX, STANDARD_FIX_TEXT, EDITED, ETAG);
    const reverted = editBuffer(edited, STANDARD_FIX, STANDARD_FIX_TEXT, STANDARD_FIX_TEXT, ETAG);

    expect(isModified(reverted, STANDARD_FIX)).toBe(false);
    expect(reverted.buffers).toEqual({});
  });

  it("keeps the base and the etag it started from when the read moves underneath an edit", () => {
    const edited = editBuffer(opened, STANDARD_FIX, STANDARD_FIX_TEXT, EDITED, ETAG);
    const again = editBuffer(edited, STANDARD_FIX, "a newer read", `${EDITED}x`, "etag-9");

    expect(bufferOf(again, STANDARD_FIX)).toEqual({ base: STANDARD_FIX_TEXT, text: `${EDITED}x`, etag: ETAG });
  });

  it("returns the same session for an edit that changes nothing", () => {
    const edited = editBuffer(opened, STANDARD_FIX, STANDARD_FIX_TEXT, EDITED, ETAG);

    expect(editBuffer(edited, STANDARD_FIX, STANDARD_FIX_TEXT, EDITED, ETAG)).toBe(edited);
    expect(editBuffer(opened, STANDARD_FIX, STANDARD_FIX_TEXT, STANDARD_FIX_TEXT, ETAG)).toBe(opened);
  });

  it("is kept per file, so switching files preserves each one's", () => {
    const both = editBuffer(
      editBuffer(opened, STANDARD_FIX, STANDARD_FIX_TEXT, EDITED, ETAG),
      HOTFIX,
      "hotfix",
      "hotfix, edited",
      ETAG,
    );
    const switched = openTab(openTab(both, HOTFIX), STANDARD_FIX);

    expect(bufferText(switched, STANDARD_FIX, STANDARD_FIX_TEXT)).toBe(EDITED);
    expect(bufferText(switched, HOTFIX, "hotfix")).toBe("hotfix, edited");
  });
});

describe("a successful save", () => {
  const edited = editBuffer(withTabs([STANDARD_FIX], STANDARD_FIX), STANDARD_FIX, STANDARD_FIX_TEXT, EDITED, ETAG);

  it("clears the dot when the editor still holds exactly what was saved, and keeps that text until a read", () => {
    const saved = markSaved(edited, STANDARD_FIX, EDITED, "etag-2");

    expect(isModified(saved, STANDARD_FIX)).toBe(false);
    // The page's read is still the pre-save text; the editor must not fall back to it.
    expect(bufferText(saved, STANDARD_FIX, STANDARD_FIX_TEXT)).toBe(EDITED);
    expect(markSaved(saved, STANDARD_FIX, EDITED, "etag-2")).toBe(saved);
  });

  it("measures the next edit from the saved text, under the saved etag", () => {
    const saved = markSaved(edited, STANDARD_FIX, EDITED, "etag-2");
    const next = editBuffer(saved, STANDARD_FIX, STANDARD_FIX_TEXT, STANDARD_FIX_TEXT, ETAG);

    expect(isModified(next, STANDARD_FIX)).toBe(true);
    expect(bufferOf(next, STANDARD_FIX)?.etag).toBe("etag-2");
    expect(editBuffer(saved, STANDARD_FIX, STANDARD_FIX_TEXT, EDITED, ETAG)).toBe(saved);
  });

  it("keeps the dot, measured from the saved text, when the person typed on while it was in flight", () => {
    const typedOn = editBuffer(edited, STANDARD_FIX, STANDARD_FIX_TEXT, `${EDITED}more`, ETAG);
    const saved = markSaved(typedOn, STANDARD_FIX, EDITED, "etag-2");

    expect(bufferOf(saved, STANDARD_FIX)).toEqual({ base: EDITED, text: `${EDITED}more`, etag: "etag-2" });
    expect(isModified(saved, STANDARD_FIX)).toBe(true);
  });

  it("changes nothing for a file with nothing unsaved", () => {
    const session = withTabs([HOTFIX], HOTFIX);

    expect(markSaved(session, HOTFIX, "anything", "etag-2")).toBe(session);
  });
});

describe("a read that caught up", () => {
  const edited = editBuffer(withTabs([STANDARD_FIX], STANDARD_FIX), STANDARD_FIX, STANDARD_FIX_TEXT, EDITED, ETAG);

  it("retires a buffer whose text the file now reads as — a save made elsewhere", () => {
    expect(isModified(adoptRead(edited, STANDARD_FIX, EDITED), STANDARD_FIX)).toBe(false);
  });

  it("leaves unsaved text the read differs from, and a file with no buffer, alone", () => {
    expect(adoptRead(edited, STANDARD_FIX, "a different draft")).toBe(edited);
    expect(adoptRead(edited, HOTFIX, "anything")).toBe(edited);
  });

  it("retires the clean buffer a save left, whatever the fresh read says — the read is newer", () => {
    const saved = markSaved(edited, STANDARD_FIX, EDITED, "etag-2");

    expect(adoptRead(saved, STANDARD_FIX, EDITED).buffers).toEqual({});
    expect(adoptRead(saved, STANDARD_FIX, "someone else's newer draft").buffers).toEqual({});
  });
});

describe("a buffer over a draft that moved (V.4, #172)", () => {
  const opened = withTabs([STANDARD_FIX], STANDARD_FIX);
  const edited = editBuffer(opened, STANDARD_FIX, STANDARD_FIX_TEXT, EDITED, ETAG);
  const THEIRS = `${STANDARD_FIX_TEXT}// theirs\n`;

  it("is diverged when its base is not the text read and it was typed under another etag", () => {
    expect(isDiverged(edited, STANDARD_FIX, THEIRS, "etag-theirs")).toBe(true);
  });

  it("is diverged when the etag it was typed under is unknown and its base is not the text read", () => {
    const unknown = editBuffer(opened, STANDARD_FIX, STANDARD_FIX_TEXT, EDITED, null);

    expect(isDiverged(unknown, STANDARD_FIX, THEIRS, "etag-theirs")).toBe(true);
    expect(isDiverged(unknown, STANDARD_FIX, STANDARD_FIX_TEXT, "etag-theirs")).toBe(false);
  });

  it("is not diverged over the read it was typed on, whatever the etag — the draft says exactly what it was typed over", () => {
    expect(isDiverged(edited, STANDARD_FIX, STANDARD_FIX_TEXT, "etag-reprinted")).toBe(false);
  });

  it("is not diverged under the etag read — the canonical text of this editor's own save", () => {
    const saved = markSaved(editBuffer(edited, STANDARD_FIX, STANDARD_FIX_TEXT, `${EDITED}x`, ETAG), STANDARD_FIX, EDITED, "etag-2");

    expect(isDiverged(saved, STANDARD_FIX, "the same draft, printed canonically", "etag-2")).toBe(false);
  });

  it("is never diverged with nothing unsaved: no buffer, or a clean one", () => {
    expect(isDiverged(opened, STANDARD_FIX, THEIRS, "etag-theirs")).toBe(false);
    expect(isDiverged(markSaved(edited, STANDARD_FIX, EDITED, "etag-2"), STANDARD_FIX, THEIRS, "etag-theirs")).toBe(false);
  });

  it("is measured from the draft as it is read now when the person keeps their text — Save mine", () => {
    const rebased = rebaseBuffer(edited, STANDARD_FIX, THEIRS, "etag-theirs");

    expect(bufferOf(rebased, STANDARD_FIX)).toEqual({ base: THEIRS, text: EDITED, etag: "etag-theirs" });
    expect(isModified(rebased, STANDARD_FIX)).toBe(true);
    expect(isDiverged(rebased, STANDARD_FIX, THEIRS, "etag-theirs")).toBe(false);
  });

  it("is dropped when kept over a read that says the same, and changes nothing with no buffer", () => {
    expect(rebaseBuffer(edited, STANDARD_FIX, EDITED, "etag-theirs").buffers).toEqual({});
    expect(rebaseBuffer(opened, STANDARD_FIX, THEIRS, "etag-theirs")).toBe(opened);
  });

  it("is dropped by Reload theirs, and dropping nothing changes nothing", () => {
    expect(discardBuffer(edited, STANDARD_FIX).buffers).toEqual({});
    expect(bufferText(discardBuffer(edited, STANDARD_FIX), STANDARD_FIX, THEIRS)).toBe(THEIRS);
    expect(discardBuffer(opened, STANDARD_FIX)).toBe(opened);
  });
});

describe("the tab keyboard", () => {
  const tabs = [STANDARD_FIX, HOTFIX, CONFIG];

  it("steps with Left and Right, wrapping at the ends", () => {
    expect(tabKeyTarget(press("ArrowRight"), tabs, STANDARD_FIX)).toBe(HOTFIX);
    expect(tabKeyTarget(press("ArrowRight"), tabs, CONFIG)).toBe(STANDARD_FIX);
    expect(tabKeyTarget(press("ArrowLeft"), tabs, STANDARD_FIX)).toBe(CONFIG);
    expect(tabKeyTarget(press("ArrowLeft"), tabs, CONFIG)).toBe(HOTFIX);
  });

  it("jumps with Home and End", () => {
    expect(tabKeyTarget(press("Home"), tabs, CONFIG)).toBe(STANDARD_FIX);
    expect(tabKeyTarget(press("End"), tabs, STANDARD_FIX)).toBe(CONFIG);
  });

  it("answers no chord, no other key, and no empty strip", () => {
    expect(tabKeyTarget(press("ArrowRight", { altKey: true }), tabs, STANDARD_FIX)).toBeNull();
    expect(tabKeyTarget(press("ArrowRight", { metaKey: true }), tabs, STANDARD_FIX)).toBeNull();
    expect(tabKeyTarget(press("Enter"), tabs, STANDARD_FIX)).toBeNull();
    expect(tabKeyTarget(press("ArrowRight"), [], STANDARD_FIX)).toBeNull();
  });

  it("reads an unknown tab as the first", () => {
    expect(tabKeyTarget(press("ArrowRight"), tabs, "workflows/gone.loop.ts")).toBe(HOTFIX);
  });

  it("closes the focused tab with a plain Delete or Backspace", () => {
    expect(isCloseFocusedTabKey(press("Delete"))).toBe(true);
    expect(isCloseFocusedTabKey(press("Backspace"))).toBe(true);
    expect(isCloseFocusedTabKey(press("Delete", { metaKey: true }))).toBe(false);
    expect(isCloseFocusedTabKey(press("x"))).toBe(false);
  });

  it("closes the open tab with Alt+W — by character, or by physical key where ⌥W types ∑", () => {
    expect(isCloseTabKey(press("w", { altKey: true, code: "KeyW" }))).toBe(true);
    expect(isCloseTabKey(press("∑", { altKey: true, code: "KeyW" }))).toBe(true);
    expect(isCloseTabKey(press("W", { altKey: true }))).toBe(true);
  });

  it("leaves ⌘W, Ctrl+W, a plain W and every other chord to the browser", () => {
    expect(isCloseTabKey(press("w", { code: "KeyW" }))).toBe(false);
    expect(isCloseTabKey(press("w", { metaKey: true, code: "KeyW" }))).toBe(false);
    expect(isCloseTabKey(press("w", { ctrlKey: true, code: "KeyW" }))).toBe(false);
    expect(isCloseTabKey(press("w", { altKey: true, shiftKey: true, code: "KeyW" }))).toBe(false);
    expect(isCloseTabKey(press("q", { altKey: true, code: "KeyQ" }))).toBe(false);
  });
});

describe("storage", () => {
  it("round-trips a session, each buffer's etag included", () => {
    const session = editBuffer(withTabs([STANDARD_FIX, CONFIG], CONFIG), STANDARD_FIX, "a", "b", ETAG);

    expect(parseSession(JSON.stringify(session))).toEqual(session);
  });

  it("reads nothing, bad JSON and a value that is not a session as the empty session", () => {
    expect(parseSession(null)).toBe(EMPTY_SESSION);
    expect(parseSession("{not json")).toBe(EMPTY_SESSION);
    expect(parseSession("[]")).toBe(EMPTY_SESSION);
    expect(parseSession("42")).toBe(EMPTY_SESSION);
  });

  it("drops whatever in a session is not a session's, and reads an etag that is not a string as unknown", () => {
    const raw = JSON.stringify({
      tabs: [STANDARD_FIX, 7, STANDARD_FIX, HOTFIX],
      active: CONFIG,
      buffers: {
        [STANDARD_FIX]: { base: "a", text: "b", etag: ETAG },
        [HOTFIX]: { base: "same", text: "same" },
        [CONFIG]: { base: 1, text: "b" },
        "workflows/feature-loop.loop.ts": { base: "c", text: "d", etag: 5 },
        "workflows/docs-loop.loop.ts": { base: "e", text: "f" },
        broken: "text",
      },
    });

    expect(parseSession(raw)).toEqual({
      tabs: [STANDARD_FIX, HOTFIX],
      active: null,
      buffers: {
        [STANDARD_FIX]: { base: "a", text: "b", etag: ETAG },
        "workflows/feature-loop.loop.ts": { base: "c", text: "d", etag: null },
        "workflows/docs-loop.loop.ts": { base: "e", text: "f", etag: null },
      },
    });
  });

  it("reads missing fields as empty ones", () => {
    expect(parseSession("{}")).toEqual(EMPTY_SESSION);
  });

  it("never reads a buffer off the prototype", () => {
    expect(bufferOf(EMPTY_SESSION, "constructor")).toBeUndefined();
    expect(isModified(EMPTY_SESSION, "toString")).toBe(false);
  });
});
