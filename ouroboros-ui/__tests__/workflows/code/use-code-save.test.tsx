import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkflowCode } from "@/app/api/workflows";
import type { ActionOutcome } from "@/app/workflows/action-outcome";
import { OFFLINE_REASON, UNREACHABLE_REASON, WORKFLOW_CODE_INVALID } from "@/app/workflows/code/code-save";
import { type CodeSaveOptions, type SaveCodeCall, useCodeSave } from "@/app/workflows/code/use-code-save";

import { STANDARD_FIX_TEXT, workflowCode } from "../../helpers/workflow-code";

/**
 * The code editor's save loop (V.4, #172), driven the way the workbench drives it, over a fake clock.
 *
 * The ticket's three failure modes, as this hook owns them:
 *
 * - **a typo mid-keystroke must not corrupt the draft** — a `422` hands up the diagnostics, writes nothing,
 *   and the next edit is the next attempt;
 * - **a concurrent edit must not silently win or silently lose** — a `409` stops the loop and is reported
 *   once, and nothing is written after it;
 * - **no lost keystrokes across the save cycle** — scripted typing during an in-flight request, one
 *   character at a time, all lands in the next write.
 *
 * And the fourth surface: **offline or server error** keeps the text, says the real reason, and retries.
 */

const DELAY = 800;
const SLUG = "standard-fix";

/** What a person types: the file, with a comment at the top. */
const EDITED = `// tighten the retry\n${STANDARD_FIX_TEXT}`;

/**
 * What a write that took answers.
 *
 * @param etag The new etag.
 * @param text The file as the draft now reads.
 * @returns The outcome.
 */
function took(etag: string, text: string): ActionOutcome<WorkflowCode> {
  return { ok: true, value: workflowCode({ etag, text }) };
}

/**
 * What a refused write answers.
 *
 * @param code The refusal's code.
 * @param details Its details.
 * @param message Its sentence.
 * @returns The outcome.
 */
function refused(code: string, details: Record<string, unknown> = {}, message = "Refused."): ActionOutcome<WorkflowCode> {
  return { ok: false, refusal: { code, message, details } };
}

/** The diagnostics a `422` carries. */
const DIAGNOSTICS = [
  { severity: "error", range: { line: 4, column: 8, endLine: 4, endColumn: 11 }, code: "code_syntax_error", message: "Expected a string." },
];

/**
 * A promise released by hand, for a write that is still in flight.
 *
 * @returns The promise and its release.
 */
function deferred<T>(): { promise: Promise<T>; release: (value: T) => void } {
  let release: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

let online = true;

/** Render the hook with a spy for every seam. */
function setup(overrides: Partial<CodeSaveOptions> = {}) {
  let answered = 0;
  const save = vi.fn<SaveCodeCall>((_slug, _etag, text) => {
    answered += 1;
    return Promise.resolve(took(`etag-${answered + 1}`, text));
  });
  const callbacks = { onSaved: vi.fn(), onInvalid: vi.fn(), onConflict: vi.fn(), onReverted: vi.fn() };
  const options: CodeSaveOptions = {
    slug: SLUG,
    etag: "etag-1",
    stored: STANDARD_FIX_TEXT,
    enabled: true,
    save,
    delay: DELAY,
    online: () => online,
    ...callbacks,
    ...overrides,
  };
  const hook = renderHook((props: CodeSaveOptions) => useCodeSave(props), { initialProps: options });

  return { ...hook, ...callbacks, save: (overrides.save ?? save) as ReturnType<typeof vi.fn<SaveCodeCall>> };
}

/** Let the clock run, and every promise it released settle. */
async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Make the page hidden or visible. */
function setVisibility(state: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

beforeEach(() => {
  online = true;
  vi.useFakeTimers();
});

afterEach(() => {
  setVisibility("visible");
  vi.useRealTimers();
});

describe("writing an edit", () => {
  it("writes nothing for the text the draft already holds", async () => {
    const { result, save } = setup();

    act(() => result.current.schedule(STANDARD_FIX_TEXT));
    await elapse(DELAY * 2);

    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toEqual({ state: "idle", reason: null });
  });

  it("waits out the delay, then writes the file with the etag the page read", async () => {
    const { result, save, onSaved } = setup();

    act(() => result.current.schedule(EDITED));
    expect(result.current.status.state).toBe("pending");

    await elapse(DELAY - 1);
    expect(save).not.toHaveBeenCalled();

    await elapse(1);
    expect(save).toHaveBeenCalledExactlyOnceWith(SLUG, "etag-1", EDITED);
    expect(result.current.status).toEqual({ state: "saved", reason: null });
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ etag: "etag-2" }), EDITED);
  });

  it("folds typing inside the delay into one write of the latest text", async () => {
    const { result, save } = setup();

    act(() => result.current.schedule(`${EDITED}a`));
    await elapse(DELAY / 2);
    act(() => result.current.schedule(`${EDITED}ab`));
    await elapse(DELAY);

    expect(save).toHaveBeenCalledExactlyOnceWith(SLUG, "etag-1", `${EDITED}ab`);
  });

  it("sends each write with the etag the previous write was answered with", async () => {
    const { result, save } = setup();

    act(() => result.current.schedule(EDITED));
    await elapse(DELAY);
    act(() => result.current.schedule(`${EDITED}more`));
    await elapse(DELAY);

    expect(save.mock.calls.map((call) => call[1])).toEqual(["etag-1", "etag-2"]);
  });

  it("writes nothing at all for a reader who may not edit", async () => {
    const { result, save } = setup({ enabled: false });

    act(() => result.current.schedule(EDITED));
    await elapse(DELAY * 2);

    expect(save).not.toHaveBeenCalled();
    expect(result.current.status.state).toBe("idle");
  });

  it("cancels a waiting write when the text is typed back to what the draft holds, and says so", async () => {
    const { result, save, onReverted } = setup();

    act(() => result.current.schedule(EDITED));
    act(() => result.current.schedule(STANDARD_FIX_TEXT));
    await elapse(DELAY * 2);

    expect(save).not.toHaveBeenCalled();
    expect(onReverted).toHaveBeenCalledOnce();
    expect(result.current.status.state).toBe("idle");
  });
});

describe("no lost keystrokes", () => {
  it("writes every character typed while a write is in flight, one at a time, in the next write on top of it", async () => {
    const first = deferred<ActionOutcome<WorkflowCode>>();
    const save = vi.fn<SaveCodeCall>();
    save
      .mockImplementationOnce(() => first.promise)
      .mockImplementation((_slug, _etag, text) => Promise.resolve(took("etag-3", text)));
    const { result, onSaved } = setup({ save });

    let typed = `${EDITED}//`;
    act(() => result.current.schedule(typed));
    await elapse(DELAY);
    expect(result.current.status.state).toBe("saving");

    // Scripted typing: a character every 60ms, for longer than the debounce, while the write is out.
    for (const character of " keep every keystroke") {
      typed += character;
      const text = typed;
      act(() => result.current.schedule(text));
      await elapse(60);
    }
    await elapse(DELAY * 2);
    // Serial: nothing more has been sent while the first write is still in flight.
    expect(save).toHaveBeenCalledOnce();

    await act(async () => {
      first.release(took("etag-2", `${EDITED}//`));
      await vi.advanceTimersByTimeAsync(0);
    });
    await elapse(DELAY);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual([SLUG, "etag-2", `${EDITED}// keep every keystroke`]);
    expect(onSaved.mock.calls.map((call) => call[1])).toEqual([`${EDITED}//`, `${EDITED}// keep every keystroke`]);
    expect(result.current.status.state).toBe("saved");
  });

  it("reports pending, not saved, when a write lands with newer text still waiting", async () => {
    const first = deferred<ActionOutcome<WorkflowCode>>();
    const save = vi.fn<SaveCodeCall>();
    save.mockImplementationOnce(() => first.promise).mockImplementation((_s, _e, text) => Promise.resolve(took("etag-3", text)));
    const { result } = setup({ save });

    act(() => result.current.schedule(EDITED));
    await elapse(DELAY);
    act(() => result.current.schedule(`${EDITED}x`));
    await act(async () => {
      first.release(took("etag-2", EDITED));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.status.state).toBe("pending");
  });
});

describe("a file that does not parse", () => {
  it("hands up the diagnostics with the text they were counted in, and writes nothing more", async () => {
    const save = vi.fn<SaveCodeCall>(() => Promise.resolve(refused(WORKFLOW_CODE_INVALID, { diagnostics: DIAGNOSTICS })));
    const { result, onInvalid, onSaved } = setup({ save });

    act(() => result.current.schedule(EDITED));
    await elapse(DELAY * 3);

    expect(save).toHaveBeenCalledOnce();
    expect(result.current.status).toEqual({ state: "invalid", reason: null });
    expect(onInvalid).toHaveBeenCalledExactlyOnceWith(DIAGNOSTICS, EDITED);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("keeps going: the next edit is the next attempt, with the same etag, since nothing was written", async () => {
    const save = vi.fn<SaveCodeCall>();
    save
      .mockResolvedValueOnce(refused(WORKFLOW_CODE_INVALID, { diagnostics: DIAGNOSTICS }))
      .mockImplementation((_s, _e, text) => Promise.resolve(took("etag-2", text)));
    const { result, onSaved } = setup({ save });

    act(() => result.current.schedule(`${EDITED}typo`));
    await elapse(DELAY);
    act(() => result.current.schedule(EDITED));
    await elapse(DELAY);

    expect(save.mock.calls.map((call) => call[1])).toEqual(["etag-1", "etag-1"]);
    expect(result.current.status.state).toBe("saved");
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("says pending rather than invalid when newer text was typed while the refused write was out", async () => {
    const first = deferred<ActionOutcome<WorkflowCode>>();
    const save = vi.fn<SaveCodeCall>();
    save.mockImplementationOnce(() => first.promise).mockImplementation((_s, _e, text) => Promise.resolve(took("etag-2", text)));
    const { result } = setup({ save });

    act(() => result.current.schedule(`${EDITED}typo`));
    await elapse(DELAY);
    act(() => result.current.schedule(EDITED));
    await act(async () => {
      first.release(refused(WORKFLOW_CODE_INVALID, { diagnostics: DIAGNOSTICS }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.status.state).toBe("pending");
  });

  it("clears a refusal when the text is typed back to what the draft holds", async () => {
    const save = vi.fn<SaveCodeCall>(() => Promise.resolve(refused(WORKFLOW_CODE_INVALID, { diagnostics: DIAGNOSTICS })));
    const { result, onReverted } = setup({ save });

    act(() => result.current.schedule(EDITED));
    await elapse(DELAY);
    act(() => result.current.schedule(STANDARD_FIX_TEXT));

    expect(result.current.status.state).toBe("idle");
    expect(onReverted).toHaveBeenCalledOnce();
  });
});

describe("a draft changed elsewhere", () => {
  it("stops the loop, reports the conflict once with the editor that won, and never writes again", async () => {
    const save = vi.fn<SaveCodeCall>(() =>
      Promise.resolve(
        refused("workflow_draft_conflict", {
          expected: "etag-1",
          current: "etag-9",
          editedIn: "visual",
          updatedAt: "2026-09-15T11:59:00.000Z",
        }),
      ),
    );
    const { result, onConflict } = setup({ save });

    act(() => result.current.schedule(EDITED));
    await elapse(DELAY);

    expect(result.current.status).toEqual({ state: "conflict", reason: null });
    expect(onConflict).toHaveBeenCalledExactlyOnceWith({
      current: "etag-9",
      editedIn: "visual",
      updatedAt: "2026-09-15T11:59:00.000Z",
    });

    act(() => result.current.schedule(`${EDITED}more`));
    await elapse(DELAY * 2);
    let flushed = "";
    await act(async () => {
      flushed = await result.current.flush();
    });

    expect(save).toHaveBeenCalledOnce();
    expect(flushed).toBe("conflict");
  });
});

describe("a write that did not arrive", () => {
  it("keeps the text, says nothing came back, and tries again on its own", async () => {
    const save = vi.fn<SaveCodeCall>();
    save.mockRejectedValueOnce(new TypeError("fetch failed")).mockImplementation((_s, _e, text) => Promise.resolve(took("etag-2", text)));
    const { result, onSaved } = setup({ save, backoff: () => 5000 });

    act(() => result.current.schedule(EDITED));
    await elapse(DELAY);

    expect(result.current.status).toEqual({ state: "failed", reason: UNREACHABLE_REASON });

    await elapse(4999);
    expect(save).toHaveBeenCalledOnce();

    await elapse(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual([SLUG, "etag-1", EDITED]);
    expect(result.current.status).toEqual({ state: "saved", reason: null });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("says the browser is offline when it is, and tries again the moment it is back online", async () => {
    online = false;
    const save = vi.fn<SaveCodeCall>();
    save.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockImplementation((_s, _e, text) => Promise.resolve(took("etag-2", text)));
    const { result } = setup({ save, backoff: () => 60_000 });

    act(() => result.current.schedule(EDITED));
    await elapse(DELAY);
    expect(result.current.status).toEqual({ state: "failed", reason: OFFLINE_REASON });

    online = true;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status.state).toBe("saved");
  });

  it("says the service's own sentence for a service error, and keeps the reason while the retry is in flight", async () => {
    const retry = deferred<ActionOutcome<WorkflowCode>>();
    const save = vi.fn<SaveCodeCall>();
    save.mockResolvedValueOnce(refused("internal_error", {}, "The service failed.")).mockImplementationOnce(() => retry.promise);
    const { result } = setup({ save, backoff: () => 1000 });

    act(() => result.current.schedule(EDITED));
    await elapse(DELAY);
    expect(result.current.status).toEqual({ state: "failed", reason: "The service failed." });

    await elapse(1000);
    expect(result.current.status).toEqual({ state: "saving", reason: "The service failed." });

    await act(async () => {
      retry.release(took("etag-2", EDITED));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toEqual({ state: "saved", reason: null });
  });

  it("does not retry on its own what a retry cannot fix, but writes it again when flushed", async () => {
    const save = vi.fn<SaveCodeCall>();
    save
      .mockResolvedValueOnce(refused("forbidden", {}, "Your role cannot edit this workflow."))
      .mockImplementation((_s, _e, text) => Promise.resolve(took("etag-2", text)));
    const { result } = setup({ save, backoff: () => 1000 });

    act(() => result.current.schedule(EDITED));
    await elapse(DELAY);
    await elapse(60_000);

    expect(save).toHaveBeenCalledOnce();
    expect(result.current.status).toEqual({ state: "failed", reason: "Your role cannot edit this workflow." });

    let flushed = "";
    await act(async () => {
      flushed = await result.current.flush();
    });
    expect(flushed).toBe("saved");
  });

  it("retries the newest text, and keeps the failure said while more is typed", async () => {
    const save = vi.fn<SaveCodeCall>();
    save.mockRejectedValueOnce(new TypeError("fetch failed")).mockImplementation((_s, _e, text) => Promise.resolve(took("etag-2", text)));
    const { result } = setup({ save, backoff: () => 10_000 });

    act(() => result.current.schedule(EDITED));
    await elapse(DELAY);
    act(() => result.current.schedule(`${EDITED}newer`));

    expect(result.current.status.state).toBe("failed");

    await elapse(DELAY);
    expect(save.mock.calls[1]?.[2]).toBe(`${EDITED}newer`);
  });
});

describe("flushing and cancelling", () => {
  it("writes what is waiting at once, and answers where the save stands", async () => {
    const { result, save } = setup();

    act(() => result.current.schedule(EDITED));
    let flushed = "";
    await act(async () => {
      flushed = await result.current.flush();
    });

    expect(save).toHaveBeenCalledOnce();
    expect(flushed).toBe("saved");

    await elapse(DELAY * 2);
    expect(save).toHaveBeenCalledOnce();
  });

  it("answers idle, and writes nothing, when nothing was typed", async () => {
    const { result, save } = setup();
    let flushed = "";

    await act(async () => {
      flushed = await result.current.flush();
    });

    expect(flushed).toBe("idle");
    expect(save).not.toHaveBeenCalled();
  });

  it("forgets what is waiting when cancelled — a buffer the person dropped is never written", async () => {
    const { result, save } = setup();

    act(() => result.current.schedule(EDITED));
    act(() => result.current.cancel());
    await elapse(DELAY * 2);

    expect(save).not.toHaveBeenCalled();
    expect(result.current.status.state).toBe("idle");
  });
});

describe("leaving the page", () => {
  it("writes what is waiting the moment the page is hidden", async () => {
    const { result, save } = setup();

    act(() => result.current.schedule(EDITED));
    await act(async () => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(save).toHaveBeenCalledOnce();
  });

  it("asks before the page is left with text unwritten, and asks nothing once it is written", async () => {
    const { result } = setup();

    const unwritten = new Event("beforeunload", { cancelable: true });
    act(() => result.current.schedule(EDITED));
    act(() => {
      window.dispatchEvent(unwritten);
    });
    expect(unwritten.defaultPrevented).toBe(true);

    await elapse(DELAY);

    const written = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(written);
    expect(written.defaultPrevented).toBe(false);
  });

  it("writes what is waiting when the page unmounts — following a tab to another workflow", async () => {
    const { result, save, unmount } = setup();

    act(() => result.current.schedule(EDITED));
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(save).toHaveBeenCalledOnce();
  });

  it("leaves no retry behind an unmounted page", async () => {
    const save = vi.fn<SaveCodeCall>(() => Promise.reject(new TypeError("fetch failed")));
    const { result, unmount } = setup({ save, backoff: () => 1000 });

    act(() => result.current.schedule(EDITED));
    await elapse(DELAY);
    unmount();
    await elapse(10_000);

    // The unmount's own write of the kept text, and nothing after it.
    expect(save).toHaveBeenCalledTimes(2);
  });
});
