import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkflowDefinition, WorkflowDraft } from "@/app/api/workflows";
import { type AutosaveOptions, type SaveDraftCall, useAutosave } from "@/app/workflows/use-autosave";

import { standardFixDefinition } from "../helpers/workflows";

/**
 * The draft's autosave (#152), driven the way the studio drives it, over a fake clock.
 *
 * The ticket's criteria as this hook owns them: **a stale draft write surfaces the reload dialog and nothing
 * is silently overwritten** — a `409` stops autosave and is reported once, and no later edit is written; and
 * **edit, close the tab, reopen: the draft is intact** — a hidden or closed page writes what is waiting at
 * once rather than when the timer would have. Between them: edits are debounced into one write, writes are
 * serial and each carries the etag the last one was answered with, and nothing the draft already holds is sent.
 */

const DELAY = 1000;
const OPENING = standardFixDefinition();

/**
 * The opening document with one stage moved.
 *
 * @param by How far.
 * @returns A new document.
 */
function moved(by: number): WorkflowDefinition {
  const document = standardFixDefinition();
  (document.nodes as { position: { x: number } }[])[0].position.x += by;
  return document;
}

/**
 * What a write that took answers.
 *
 * @param etag The new etag.
 * @param definition The document written.
 * @returns The outcome.
 */
function took(etag: string, definition: WorkflowDefinition) {
  return { ok: true as const, value: { etag, definition, updatedAt: "2026-09-13T12:00:00.000Z" } satisfies WorkflowDraft };
}

/** Render the hook with a spy for every seam. */
function setup(overrides: Partial<AutosaveOptions> = {}) {
  let answered = 0;
  const save = vi.fn<SaveDraftCall>((_id, _etag, definition) => {
    answered += 1;
    return Promise.resolve(took(`etag-${answered + 1}`, definition));
  });
  const onSaved = vi.fn();
  const onConflict = vi.fn();
  const options: AutosaveOptions = {
    workflowId: "wf",
    etag: "etag-1",
    stored: OPENING,
    enabled: true,
    save,
    delay: DELAY,
    onSaved,
    onConflict,
    ...overrides,
  };
  const hook = renderHook((props: AutosaveOptions) => useAutosave(props), { initialProps: options });

  return { ...hook, save: (overrides.save ?? save) as ReturnType<typeof vi.fn<SaveDraftCall>>, onSaved, onConflict };
}

/** Let the clock run, and every promise it released settle. */
async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Make the page hidden, as closing or switching away from the tab does. */
function setVisibility(state: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  setVisibility("visible");
  vi.useRealTimers();
});

describe("writing an edit", () => {
  it("writes nothing for the document the draft already holds — the editor's first hand-up", async () => {
    const { result, save } = setup();

    act(() => result.current.schedule(standardFixDefinition()));
    await elapse(DELAY * 2);

    expect(save).not.toHaveBeenCalled();
    expect(result.current.status.state).toBe("idle");
  });

  it("waits out the delay, then writes the document with the etag the page read", async () => {
    const { result, save, onSaved } = setup();
    const edit = moved(5);

    act(() => result.current.schedule(edit));
    expect(result.current.status.state).toBe("pending");

    await elapse(DELAY - 1);
    expect(save).not.toHaveBeenCalled();

    await elapse(1);
    expect(save).toHaveBeenCalledExactlyOnceWith("wf", "etag-1", edit);
    expect(result.current.status.state).toBe("saved");
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ etag: "etag-2" }));
  });

  it("folds edits inside the delay into one write of the latest", async () => {
    const { result, save } = setup();

    act(() => result.current.schedule(moved(5)));
    await elapse(DELAY / 2);
    act(() => result.current.schedule(moved(10)));
    await elapse(DELAY);

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][2]).toEqual(moved(10));
  });

  it("sends each write with the etag the previous write was answered with", async () => {
    const { result, save } = setup();

    act(() => result.current.schedule(moved(5)));
    await elapse(DELAY);
    act(() => result.current.schedule(moved(10)));
    await elapse(DELAY);

    expect(save.mock.calls.map((call) => call[1])).toEqual(["etag-1", "etag-2"]);
  });

  it("holds an edit made while a write is in flight until that write lands, then writes it on top", async () => {
    let release: (value: ReturnType<typeof took>) => void = () => undefined;
    const save = vi.fn<SaveDraftCall>();
    save
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
      .mockImplementation((_id, _etag, definition) => Promise.resolve(took("etag-3", definition)));
    const { result } = setup({ save });

    act(() => result.current.schedule(moved(5)));
    await elapse(DELAY);
    expect(result.current.status.state).toBe("saving");

    act(() => result.current.schedule(moved(10)));
    await elapse(DELAY * 3);
    // Serial: the second write has not been sent while the first is still in flight.
    expect(save).toHaveBeenCalledOnce();

    await act(async () => {
      release(took("etag-2", moved(5)));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1]).toBe("etag-2");
    expect(save.mock.calls[1][2]).toEqual(moved(10));
    expect(result.current.status.state).toBe("saved");
  });

  it("cancels a waiting write when an undo brings the draft back to what is stored", async () => {
    const { result, save } = setup();

    act(() => result.current.schedule(moved(5)));
    act(() => result.current.schedule(standardFixDefinition()));
    await elapse(DELAY * 2);

    expect(save).not.toHaveBeenCalled();
    expect(result.current.status.state).toBe("idle");
  });

  it("writes nothing at all for a reader who may not edit", async () => {
    const { result, save } = setup({ enabled: false });

    act(() => result.current.schedule(moved(5)));
    await elapse(DELAY * 2);

    expect(save).not.toHaveBeenCalled();
    expect(result.current.status.state).toBe("idle");
  });
});

describe("a stale write", () => {
  it("stops autosave, reports the conflict once, and never writes again", async () => {
    const save = vi.fn<SaveDraftCall>(() =>
      Promise.resolve({
        ok: false as const,
        refusal: {
          code: "workflow_draft_conflict",
          message: "This draft was changed in another tab.",
          details: { expected: "etag-1", current: "etag-9", editedIn: "visual", updatedAt: "2026-09-13T11:59:00.000Z" },
        },
      }),
    );
    const { result, onConflict } = setup({ save });

    act(() => result.current.schedule(moved(5)));
    await elapse(DELAY);

    expect(result.current.status.state).toBe("conflict");
    expect(onConflict).toHaveBeenCalledExactlyOnceWith({
      current: "etag-9",
      editedIn: "visual",
      updatedAt: "2026-09-13T11:59:00.000Z",
    });

    act(() => result.current.schedule(moved(10)));
    await elapse(DELAY * 2);
    let flushed = "";
    await act(async () => {
      flushed = await result.current.flush();
    });

    expect(save).toHaveBeenCalledOnce();
    expect(flushed).toBe("conflict");
  });
});

describe("a refused write", () => {
  it("says why, and writes the same document again on the next flush", async () => {
    const save = vi.fn<SaveDraftCall>();
    save
      .mockResolvedValueOnce({ ok: false, refusal: { code: "internal_error", message: "the service failed", details: {} } })
      .mockImplementation((_id, _etag, definition) => Promise.resolve(took("etag-2", definition)));
    const { result } = setup({ save });

    act(() => result.current.schedule(moved(5)));
    await elapse(DELAY);

    expect(result.current.status).toEqual({ state: "failed", reason: "the service failed" });

    let flushed = "";
    await act(async () => {
      flushed = await result.current.flush();
    });

    expect(flushed).toBe("saved");
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][2]).toEqual(moved(5));
  });
});

describe("flushing", () => {
  it("writes what is waiting at once, and answers where the save stands", async () => {
    const { result, save } = setup();

    act(() => result.current.schedule(moved(5)));
    let flushed = "";
    await act(async () => {
      flushed = await result.current.flush();
    });

    expect(save).toHaveBeenCalledOnce();
    expect(flushed).toBe("saved");

    // The timer the edit set was cancelled: nothing is written a second time.
    await elapse(DELAY * 2);
    expect(save).toHaveBeenCalledOnce();
  });

  it("answers idle, and writes nothing, when nothing was edited", async () => {
    const { result, save } = setup();
    let flushed = "";

    await act(async () => {
      flushed = await result.current.flush();
    });

    expect(flushed).toBe("idle");
    expect(save).not.toHaveBeenCalled();
  });
});

describe("leaving the page", () => {
  it("writes what is waiting the moment the page is hidden", async () => {
    const { result, save } = setup();

    act(() => result.current.schedule(moved(5)));
    await act(async () => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(save).toHaveBeenCalledOnce();
  });

  it("asks before the page is left with an edit unwritten, and asks nothing once it is written", async () => {
    const { result } = setup();

    const unwritten = new Event("beforeunload", { cancelable: true });
    act(() => result.current.schedule(moved(5)));
    act(() => {
      window.dispatchEvent(unwritten);
    });
    expect(unwritten.defaultPrevented).toBe(true);

    await elapse(DELAY);

    const written = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(written);
    expect(written.defaultPrevented).toBe(false);
  });

  it("writes what is waiting when the page unmounts — following the rail to another workflow", async () => {
    const { result, save, unmount } = setup();

    act(() => result.current.schedule(moved(5)));
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(save).toHaveBeenCalledOnce();
  });
});
