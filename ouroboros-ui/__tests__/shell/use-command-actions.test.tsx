import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commandAction, commandContext, commandSource } from "../helpers/command";
import type { CommandAction, CommandContext } from "@/app/shell/command";
import { registerCommandSource } from "@/app/shell/command-registry";
import { COMMAND_SEARCH_DELAY_MS, useCommandActions } from "@/app/shell/use-command-actions";

/**
 * The registry, a query and a context, resolved into rows
 * ([#79](https://github.com/NobuData/ouroboros/issues/79)).
 *
 * **This suite is the acceptance criterion "the action registry API is documented for #93 to
 * extend", held to by exercise.** H.3 ships navigation only, so nothing in production has a
 * `find` — and a seam nothing has ever been passed through is a seam that does not work yet
 * and nobody has found out. So the asynchronous half is driven here through a fixture source
 * shaped exactly like the one [#93](https://github.com/NobuData/ouroboros/issues/93) will
 * register: debounced, abortable, and appended below what the shell already knew.
 *
 * Nothing here imports `app/shell/command-sources.ts`, so the registry a case sees holds only
 * what that case registered — vitest gives each file its own module graph, and the seeded
 * sources register at import. The palette's own rendering of the real ones is
 * `__tests__/shell/command-palette.test.tsx`.
 */

/** The removers this case registered, run after it whatever it asserted. */
const cleanup: (() => void)[] = [];

/**
 * Register a source and remember how to take it away again.
 *
 * @param source The source.
 * @returns Nothing.
 */
function register(source: Parameters<typeof registerCommandSource>[0]): void {
  cleanup.push(registerCommandSource(source));
}

/**
 * Render the hook against a context that never moves.
 *
 * The context is built once and reused, which is the contract the hook documents: it is a
 * dependency of the search effect, so an identity rebuilt every render would re-fetch every
 * render. Building it here is also how this suite would notice if that stopped being true.
 *
 * @param query What has been typed.
 * @param context The context, defaulting to a fresh set of spies.
 * @returns The Testing Library render result.
 */
function renderActions(query: string, context: CommandContext = commandContext().context) {
  return renderHook(({ typed }: { typed: string }) => useCommandActions(typed, context), {
    initialProps: { typed: query },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  while (cleanup.length > 0) cleanup.pop()?.();
});

describe("what a source lists", () => {
  it("is offered before anything is typed", () => {
    register(commandSource({ list: () => [commandAction({ id: "a" })] }));

    const { result } = renderActions("");

    expect(result.current.actions.map((action) => action.id)).toEqual(["a"]);
  });

  it("is filtered by the query", () => {
    register(
      commandSource({
        list: () => [
          commandAction({ id: "a", label: "Go to Dashboard" }),
          commandAction({ id: "b", label: "Sign out" }),
        ],
      }),
    );

    const { result } = renderActions("sign");

    expect(result.current.actions.map((action) => action.id)).toEqual(["b"]);
  });

  it("is gathered from every source, in the registry's order", () => {
    register(commandSource({ id: "second", sort: 20, list: () => [commandAction({ id: "b" })] }));
    register(commandSource({ id: "first", sort: 10, list: () => [commandAction({ id: "a" })] }));

    const { result } = renderActions("");

    expect(result.current.actions.map((action) => action.id)).toEqual(["a", "b"]);
  });

  it("is handed the context, which is where an action's `run` comes from", () => {
    const { context, navigate } = commandContext();
    register(
      commandSource({
        list: (given) => [commandAction({ id: "a", run: () => given.navigate("/somewhere") })],
      }),
    );

    const { result } = renderActions("", context);
    result.current.actions[0].run?.();

    expect(navigate).toHaveBeenCalledWith("/somewhere");
  });

  it("re-reads when a source registers while the palette is open", () => {
    const { result } = renderActions("");

    act(() => register(commandSource({ list: () => [commandAction({ id: "late" })] })));

    expect(result.current.actions.map((action) => action.id)).toEqual(["late"]);
  });
});

describe("what a source finds", () => {
  /**
   * A source that searches, and the spy standing in for its request.
   *
   * @param answer What it resolves with.
   * @returns The `find` spy.
   */
  function registerFinder(answer: readonly CommandAction[] = [commandAction({ id: "found" })]) {
    // The three parameters are named so `find.mock.calls` proves the palette handed all of
    // them over; the signal is the one this stub acts on, which is what a real source does
    // when it is asked for an answer nobody is waiting for any more.
    const find = vi.fn(
      async (
        query: string,
        context: CommandContext,
        signal: AbortSignal,
      ): Promise<readonly CommandAction[]> => (signal.aborted ? [] : answer),
    );

    register(commandSource({ id: "finder", find, list: undefined }));
    return find;
  }

  it("is not asked for a query nobody typed", async () => {
    const find = registerFinder();

    renderActions("");
    await act(async () => void vi.advanceTimersByTime(COMMAND_SEARCH_DELAY_MS * 4));

    expect(find).not.toHaveBeenCalled();
  });

  it("is asked once the typing stops", async () => {
    const find = registerFinder();

    const { result } = renderActions("482");
    await act(async () => void vi.advanceTimersByTime(COMMAND_SEARCH_DELAY_MS));

    expect(find).toHaveBeenCalledWith("482", expect.anything(), expect.any(AbortSignal));
    await waitFor(() =>
      expect(result.current.actions.map((action) => action.id)).toContain("found"),
    );
  });

  it("is not asked for every keystroke on the way to a query", async () => {
    // The debounce is here rather than in each source, so a source owns its request and not
    // the timing — and so two sources cannot deliver two halves of one answer a moment apart.
    const find = registerFinder();

    const { rerender } = renderActions("4");
    rerender({ typed: "48" });
    rerender({ typed: "482" });
    await act(async () => void vi.advanceTimersByTime(COMMAND_SEARCH_DELAY_MS));

    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith("482", expect.anything(), expect.any(AbortSignal));
  });

  it("is told the answer is no longer wanted when the query moves on", async () => {
    const find = registerFinder();

    const { rerender } = renderActions("482");
    await act(async () => void vi.advanceTimersByTime(COMMAND_SEARCH_DELAY_MS));
    const [, , signal] = find.mock.calls[0];

    rerender({ typed: "483" });

    expect(signal.aborted).toBe(true);
  });

  it("shows nothing it found for a query that is no longer in the box", async () => {
    // A query that moved on makes the previous answer invisible by arithmetic, which is why
    // there is no "clear the results" branch anywhere for somebody to forget to reach.
    registerFinder();

    const { result, rerender } = renderActions("482");
    await act(async () => void vi.advanceTimersByTime(COMMAND_SEARCH_DELAY_MS));
    await waitFor(() =>
      expect(result.current.actions.map((action) => action.id)).toContain("found"),
    );

    rerender({ typed: "483" });

    expect(result.current.actions.map((action) => action.id)).not.toContain("found");
  });

  it("says a search is out, so the palette does not report no matches over an answer still coming", async () => {
    registerFinder();

    const { result } = renderActions("482");

    expect(result.current.searching).toBe(true);
    await act(async () => void vi.advanceTimersByTime(COMMAND_SEARCH_DELAY_MS));
    await waitFor(() => expect(result.current.searching).toBe(false));
  });

  it("says no search is out when nothing registered can run one", () => {
    register(commandSource({ list: () => [] }));

    expect(renderActions("482").result.current.searching).toBe(false);
  });

  it("contributes nothing when a source fails, and does not take the palette with it", async () => {
    register(
      commandSource({
        id: "broken",
        list: undefined,
        find: () => Promise.reject(new Error("the service refused")),
      }),
    );
    register(
      commandSource({
        id: "listing",
        list: () => [commandAction({ id: "still-here", label: "Go to run 482" })],
      }),
    );

    const { result } = renderActions("482");
    await act(async () => void vi.advanceTimersByTime(COMMAND_SEARCH_DELAY_MS));

    await waitFor(() => expect(result.current.searching).toBe(false));
    expect(result.current.actions.map((action) => action.id)).toEqual(["still-here"]);
  });

  it("puts what it found below what the shell already knew", async () => {
    // Which is the shape of the scope decision: navigation is what H.3 ships, and content
    // search arrives under it rather than in front of it.
    registerFinder();
    register(
      commandSource({
        id: "listing",
        sort: 5,
        list: () => [commandAction({ id: "known", label: "482" })],
      }),
    );

    const { result } = renderActions("482");
    await act(async () => void vi.advanceTimersByTime(COMMAND_SEARCH_DELAY_MS));

    await waitFor(() =>
      expect(result.current.actions.map((action) => action.id)).toEqual(["known", "found"]),
    );
  });

  it("does not second-guess what a source decided matched", async () => {
    // A source that searched has already chosen; re-running the matcher over data it never
    // saw could only remove rows.
    registerFinder([commandAction({ id: "found", label: "Nothing like the query" })]);

    const { result } = renderActions("482");
    await act(async () => void vi.advanceTimersByTime(COMMAND_SEARCH_DELAY_MS));

    await waitFor(() =>
      expect(result.current.actions.map((action) => action.id)).toContain("found"),
    );
  });
});
