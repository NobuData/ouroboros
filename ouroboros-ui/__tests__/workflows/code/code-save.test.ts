import { describe, expect, it } from "vitest";

import { relativeAgo } from "@/app/format";
import { AUTOSAVE_DELAY_MS, PENDING_NOTE, SAVED_NOTE, SAVING_NOTE } from "@/app/workflows/autosave";
import {
  CODE_CONFLICT_NOTE,
  CODE_DIVERGED_NOTE,
  CODE_FAILED_NOTE,
  CODE_IDLE_NOTE,
  CODE_INVALID_NOTE,
  CODE_SAVE_DELAY_MS,
  type CodeSaveState,
  OFFLINE_REASON,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  UNREACHABLE_REASON,
  WORKFLOW_CODE_INVALID,
  codeConflictBody,
  codeSaveNote,
  divergedNote,
  failureReason,
  isRetryable,
  isSaveKey,
  retryDelay,
} from "@/app/workflows/code/code-save";

/**
 * The code editor's save loop, decided (V.4, #172): what the pane says for each answer, which failures
 * are tried again and how soon, what the conflict dialog tells a person, and which key is the save.
 */

/**
 * A key press with nothing held, unless the case says otherwise.
 *
 * @param key `KeyboardEvent.key`.
 * @param over The modifiers and `code`.
 * @returns The event's fields the decision reads.
 */
function press(key: string, over: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; code: string }> = {}) {
  return { key, code: "", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...over };
}

describe("the contract's code and the pace", () => {
  it("names the refusal of a file that does not parse", () => {
    expect(WORKFLOW_CODE_INVALID).toBe("workflow_code_invalid");
  });

  it("writes typing sooner than the canvas writes a drag", () => {
    expect(CODE_SAVE_DELAY_MS).toBeGreaterThan(0);
    expect(CODE_SAVE_DELAY_MS).toBeLessThan(AUTOSAVE_DELAY_MS);
  });
});

describe("what the pane says", () => {
  it.each<[CodeSaveState, string]>([
    ["idle", CODE_IDLE_NOTE],
    ["pending", PENDING_NOTE],
    ["saving", SAVING_NOTE],
    ["saved", SAVED_NOTE],
    ["invalid", CODE_INVALID_NOTE],
    ["conflict", CODE_CONFLICT_NOTE],
    ["failed", CODE_FAILED_NOTE],
  ])("says one sentence for %s", (state, note) => {
    expect(codeSaveNote({ state, reason: null }, false)).toBe(note);
  });

  it("says the draft is untouched when the file does not parse", () => {
    expect(CODE_INVALID_NOTE).toMatch(/draft is unchanged/);
  });

  it("says the loop waits for a choice over any state while the tab's text is diverged", () => {
    expect(codeSaveNote({ state: "saved", reason: null }, true)).toBe(CODE_DIVERGED_NOTE);
    expect(codeSaveNote({ state: "idle", reason: null }, true)).toBe(CODE_DIVERGED_NOTE);
  });
});

describe("a failed write", () => {
  it("states the real reason: offline first, then the service's own sentence, then that nothing came back", () => {
    expect(failureReason("The service failed.", false)).toBe(OFFLINE_REASON);
    expect(failureReason(null, false)).toBe(OFFLINE_REASON);
    expect(failureReason("The service failed.", true)).toBe("The service failed.");
    expect(failureReason(null, true)).toBe(UNREACHABLE_REASON);
  });

  it("is tried again when nothing came back or the service failed, and not when a retry cannot help", () => {
    expect(isRetryable(null)).toBe(true);
    expect(isRetryable("internal_error")).toBe(true);
    expect(isRetryable("response_unreadable")).toBe(true);

    for (const code of ["forbidden", "workflow_not_found", "payload_too_large", "validation_failed", "workflow_draft_etag_required"]) {
      expect(isRetryable(code), code).toBe(false);
    }
  });

  it("waits twice as long before each retry, up to half a minute", () => {
    expect(retryDelay(1)).toBe(RETRY_BASE_MS);
    expect(retryDelay(2)).toBe(RETRY_BASE_MS * 2);
    expect(retryDelay(3)).toBe(RETRY_BASE_MS * 4);
    expect(retryDelay(10)).toBe(RETRY_MAX_MS);
    expect(retryDelay(0)).toBe(RETRY_BASE_MS);
    expect(retryDelay(2.7)).toBe(RETRY_BASE_MS * 2);
  });
});

describe("the conflict dialog", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");
  const updatedAt = "2026-09-15T11:58:00.000Z";

  it("names the visual editor, and when, and says nothing was overwritten", () => {
    const body = codeConflictBody({ current: "etag-9", editedIn: "visual", updatedAt }, now);

    expect(body).toContain(`in the visual editor ${relativeAgo(updatedAt, now)}`);
    expect(body).toContain("nothing was overwritten");
    expect(body).toMatch(/Reload theirs/);
    expect(body).toMatch(/keep mine/);
  });

  it("names another code editor, or somewhere else when the service could not say", () => {
    expect(codeConflictBody({ current: null, editedIn: "code", updatedAt: null }, now)).toContain(
      "in the code editor — another tab, or another person, so",
    );
    expect(codeConflictBody({ current: null, editedIn: null, updatedAt: null }, now)).toContain(
      "changed somewhere else, so",
    );
  });

  it("counts the lines a kept text differs by", () => {
    expect(divergedNote(1)).toMatch(/^1 line differs /);
    expect(divergedNote(4)).toMatch(/^4 lines differ /);
    expect(divergedNote(4)).toMatch(/Nothing is saved until you choose\.$/);
  });
});

describe("the save key", () => {
  it("is ⌘S or Ctrl+S — by character, or by physical key on a layout that types something else", () => {
    expect(isSaveKey(press("s", { metaKey: true, code: "KeyS" }))).toBe(true);
    expect(isSaveKey(press("s", { ctrlKey: true, code: "KeyS" }))).toBe(true);
    expect(isSaveKey(press("S", { metaKey: true }))).toBe(true);
    expect(isSaveKey(press("ы", { ctrlKey: true, code: "KeyS" }))).toBe(true);
  });

  it("is not a plain S, nor a chord with Alt or Shift, nor another letter", () => {
    expect(isSaveKey(press("s", { code: "KeyS" }))).toBe(false);
    expect(isSaveKey(press("s", { metaKey: true, shiftKey: true, code: "KeyS" }))).toBe(false);
    expect(isSaveKey(press("s", { ctrlKey: true, altKey: true, code: "KeyS" }))).toBe(false);
    expect(isSaveKey(press("d", { metaKey: true, code: "KeyD" }))).toBe(false);
  });
});
