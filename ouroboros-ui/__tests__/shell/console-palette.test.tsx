import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStub, menuWorkspaces, signedIn, signedOut } from "../helpers/account";
import {
  DRY_RUN_ID,
  EXPLAIN_UNAVAILABLE,
  STATUS_REPLY,
  TICKETS,
  completions,
  consoleActions,
  grammar,
  record,
  resetConsoleActions,
  result,
} from "../helpers/console";
import { renderThemed } from "../helpers/theme";
import {
  ASYNC_NOTE,
  COMPLETIONS_UNREADABLE,
  CONFIRM_NOTE,
  CONSOLE_SCOPE,
  GRAMMAR_LOADING,
  GRAMMAR_UNREADABLE,
  RUN_FAILED,
} from "@/app/shell/console";
import { CONSOLE_HISTORY_STORAGE_KEY } from "@/app/shell/console-history";
import { THEME_STORAGE_KEY } from "@/app/theme";

/**
 * The palette's command mode (BZ.5, [#539](https://github.com/NobuData/ouroboros/issues/539)).
 *
 * What needs a rendered palette: getting into the mode and back out of it, the command list
 * with its denied and `v2` rows, the keyboard — which is the palette's own, with Tab and the
 * history added — completions that arrive late, empty or not at all, a line running and its
 * boxed reply, the confirm rule's preview, a result that follows as a toast after the palette
 * has closed, and the history ↑ recalls.
 *
 * The four Server Actions are replaced by `helpers/console.ts`'s, whose defaults are a service
 * that answers; the session is `helpers/account.ts`'s, because the history is keyed by it.
 * The reading of a line is `__tests__/shell/console.test.ts`, the storage is
 * `console-history.test.ts`, and the wait is `console-watch.test.ts`.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

vi.mock("@/app/shell/actions", () => ({ signOutOfSession: vi.fn() }));

vi.mock("@/app/api/auth-client", async () =>
  (await import("../helpers/account")).authClientModule(),
);

vi.mock("@/app/shell/console-actions", async () =>
  (await import("../helpers/console")).consoleActionsModule(),
);

const { CommandPalette } = await import("@/app/shell/command-palette");
const { ConsoleToasts } = await import("@/app/shell/console-toasts");
const { resetConsoleWatch, CONSOLE_WATCH_INTERVAL_MS } = await import("@/app/shell/console-watch");
const { CONSOLE_COMPLETION_DELAY_MS } = await import("@/app/shell/use-console");

/** Told when the palette dismisses itself. */
const onClose = vi.fn();

/**
 * Render the palette, open.
 *
 * @returns The box.
 */
function open(): HTMLInputElement {
  renderThemed(<CommandPalette onClose={onClose} />);
  return screen.getByRole<HTMLInputElement>("combobox");
}

/**
 * Type into the box, leaving the caret at the end as typing does.
 *
 * @param box The box.
 * @param query Its new content.
 */
function type(box: HTMLElement, query: string): void {
  fireEvent.change(box, { target: { value: query } });
}

/**
 * Open the palette in command mode, with the grammar read.
 *
 * @param query What the box holds. The bare prefix and its space by default.
 * @returns The box.
 */
async function command(query = "/ouro "): Promise<HTMLInputElement> {
  const box = open();
  type(box, query);
  await waitFor(() => expect(consoleActions.readConsoleGrammar).toHaveBeenCalled());
  await act(async () => {});
  return box;
}

/**
 * Press a key in the box.
 *
 * @param box The box.
 * @param key The key.
 * @returns Whether the palette left the key alone — false when it spent it.
 */
function press(box: HTMLElement, key: string): boolean {
  return fireEvent.keyDown(box, { key });
}

/** The rows of the list, in order. */
function rows(): HTMLElement[] {
  return screen.queryAllByRole("option");
}

/** The row the keyboard is pointing at. */
function highlighted(): HTMLElement | undefined {
  return rows().find((row) => row.getAttribute("aria-selected") === "true");
}

/**
 * One command's row.
 *
 * @param usage Its usage line, as the row prints it.
 * @returns The row.
 */
function row(usage: string): HTMLElement {
  const found = rows().find((one) => one.querySelector("code")?.textContent === usage);
  if (found === undefined) throw new Error(`No row ${usage}`);
  return found;
}

/** The boxed reply. */
function reply(): HTMLElement {
  const box = document.querySelector<HTMLElement>(".shell-console__reply");
  if (box === null) throw new Error("No reply is drawn");
  return box;
}

/**
 * A promise a case settles by hand.
 *
 * @returns The promise and its resolver.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

/**
 * Run a line and wait for its reply.
 *
 * @param box The box.
 * @param query The whole line, with the prefix.
 */
async function run(box: HTMLElement, query: string): Promise<void> {
  const before = consoleActions.runConsoleCommand.mock.calls.length;

  type(box, query);
  press(box, "Enter");
  await waitFor(() => expect(consoleActions.runConsoleCommand.mock.calls.length).toBe(before + 1));
  await act(async () => {});
}

beforeEach(() => {
  onClose.mockClear();
  resetConsoleActions();
  resetConsoleWatch();
  signedIn();
  window.localStorage.removeItem(CONSOLE_HISTORY_STORAGE_KEY);
  window.localStorage.removeItem(THEME_STORAGE_KEY);
});

afterEach(() => {
  resetConsoleWatch();
  vi.useRealTimers();
});

describe("getting into command mode", () => {
  it("is not where the palette starts, and asks the service nothing until it is entered", () => {
    open();

    expect(screen.getByRole("listbox", { name: "Screens and commands" })).toBeInTheDocument();
    expect(consoleActions.readConsoleGrammar).not.toHaveBeenCalled();
  });

  it("happens on the prefix and a space", async () => {
    await command("/ouro ");

    expect(screen.getByRole("listbox", { name: "Commands" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Go to Dashboard/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /Sign out/ })).toBeNull();
  });

  it("happens on the prefix exactly", async () => {
    await command("/ouro");

    expect(screen.getByRole("listbox", { name: "Commands" })).toBeInTheDocument();
    expect(rows()).toHaveLength(12);
  });

  it("does not happen on a word that merely starts like it", () => {
    const box = open();

    type(box, "/ouroboros");

    expect(screen.getByRole("listbox", { name: "Screens and commands" })).toBeInTheDocument();
    expect(consoleActions.readConsoleGrammar).not.toHaveBeenCalled();
  });

  it("is offered as a row, so the prefix does not have to be known", () => {
    open();

    const entry = screen.getByRole("option", { name: /Run a command/ });

    expect(entry).toHaveTextContent("/ouro");
    expect(within(screen.getByRole("group", { name: "Commands" })).getByRole("option")).toBe(entry);
  });

  it("is entered from that row, which fills the prefix and leaves the palette open", async () => {
    const box = open();

    type(box, "run a comm");
    expect(highlighted()).toHaveTextContent("Run a command");
    press(box, "Enter");

    expect(box).toHaveValue("/ouro ");
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByRole("listbox", { name: "Commands" })).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(12));
    expect(box).toHaveFocus();
  });

  it("finds that row by the prefix half typed", () => {
    const box = open();

    type(box, "/ou");

    expect(screen.getByRole("option", { name: /Run a command/ })).toBeInTheDocument();
  });

  it("says what the mode is, where the palette said what it searches", async () => {
    await command();

    expect(screen.getByRole("dialog")).toHaveTextContent(CONSOLE_SCOPE);
    expect(screen.getByRole("dialog")).not.toHaveTextContent("#93");
    expect(screen.getByRole("dialog")).toHaveTextContent("Tab to complete");
  });

  it("keeps the dialog and the box what they were", async () => {
    const box = await command();

    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
    expect(box).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    expect(box).toHaveFocus();
  });
});

describe("getting back out of it", () => {
  it("restores the navigation results as soon as the prefix is cut into", async () => {
    const box = await command("/ouro sta");

    type(box, "/our");

    expect(screen.getByRole("listbox", { name: "Screens and commands" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("#93");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Tab to complete");

    type(box, "");

    expect(screen.getByRole("option", { name: /Go to Dashboard/ })).toBeInTheDocument();
    expect(highlighted()).toHaveTextContent("Go to Dashboard");
  });

  it("takes the reply's seat away with it", async () => {
    const box = await command();
    await run(box, "/ouro status");

    type(box, "dash");

    expect(document.querySelector(".shell-console__seat")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("closes on Escape, as the palette always did", async () => {
    const box = await command();

    press(box, "Escape");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the command list", () => {
  it("shows every command of the grammar, each with its usage and its summary", async () => {
    await command();

    expect(rows().map((one) => one.querySelector("code")?.textContent)).toEqual([
      "/ouro status",
      "/ouro queue #485 [workflow]",
      "/ouro pause loop 1847",
      "/ouro resume loop 1847",
      "/ouro abort loop 1847",
      "/ouro answer q-231 allow_once",
      "/ouro dry-run #486 [workflow]",
      "/ouro route implement claude-fable-5",
      "/ouro explain pr 514",
      "/ouro estimate #490",
      "/ouro pause all",
      "/ouro help [command]",
    ]);
    expect(row("/ouro status")).toHaveTextContent("everything live, in one line");
    expect(row("/ouro pause all")).toHaveTextContent("the big red button");
  });

  it("lists a command the caller may not run, dimmed, with the reason", async () => {
    await command();

    for (const usage of [
      "/ouro pause loop 1847",
      "/ouro resume loop 1847",
      "/ouro route implement claude-fable-5",
      "/ouro pause all",
    ]) {
      expect(row(usage)).toHaveTextContent("needs admin");
      expect(row(usage)).toHaveClass("shell-console__row--denied");
      expect(row(usage)).toHaveAttribute("aria-disabled", "true");
    }

    expect(row("/ouro status")).not.toHaveClass("shell-console__row--denied");
    expect(row("/ouro status")).not.toHaveAttribute("aria-disabled");
  });

  it("lets the arrows land on a denied command, so it can be read", async () => {
    const box = await command();

    press(box, "ArrowDown");
    press(box, "ArrowDown");

    expect(highlighted()).toBe(row("/ouro pause loop 1847"));
  });

  it("says why instead of running it, on Enter", async () => {
    const box = await command("/ouro pause l");

    expect(highlighted()).toBe(row("/ouro pause loop 1847"));
    press(box, "Enter");

    expect(consoleActions.runConsoleCommand).not.toHaveBeenCalled();
    expect(box).toHaveValue("/ouro pause l");
    expect(reply()).toHaveTextContent("Denied");
    expect(reply()).toHaveTextContent("You cannot run /ouro pause loop here: needs admin.");
  });

  it("says why on a press, too", async () => {
    await command();

    fireEvent.click(row("/ouro route implement claude-fable-5"));

    expect(consoleActions.runConsoleCommand).not.toHaveBeenCalled();
    expect(reply()).toHaveTextContent("You cannot run /ouro route here: needs admin.");
  });

  it("lists `explain pr` with its v2 label, exactly as the grammar words its stage", async () => {
    await command();

    const tags = [...row("/ouro explain pr 514").querySelectorAll(".shell-console__tag")];

    expect(tags.map((tag) => tag.textContent)).toEqual(["v2"]);
    expect(grammar().commands.find((one) => one.id === "explain pr")?.stage).toBe("v2");
    expect(rows().filter((one) => one.querySelector(".shell-console__tag")?.textContent === "v2")).toHaveLength(1);
  });

  it("narrows to the commands that start with what was typed", async () => {
    const box = await command("/ouro pa");

    expect(rows().map((one) => one.querySelector("code")?.textContent)).toEqual([
      "/ouro pause loop 1847",
      "/ouro pause all",
    ]);

    // The ones that start with it lead; the ones that merely contain it follow.
    type(box, "/ouro e");
    expect(rows().slice(0, 2).map((one) => one.querySelector("code")?.textContent)).toEqual([
      "/ouro explain pr 514",
      "/ouro estimate #490",
    ]);
    expect(highlighted()).toBe(row("/ouro explain pr 514"));

    type(box, "/ouro loop");
    expect(rows()).toHaveLength(3);
  });

  it("says so when no command matches, and still sends the line as typed", async () => {
    const box = await command("/ouro deploy now");

    expect(rows()).toHaveLength(0);
    expect(screen.getByRole("listbox")).toHaveTextContent(
      "No command matches “deploy now”. Press ↵ to send it as typed, or Esc to close.",
    );

    consoleActions.runConsoleCommand.mockResolvedValue(
      result({ command: null, outcome: "error", reply: { text: "I do not know `deploy`." } }),
    );
    press(box, "Enter");

    await waitFor(() => expect(reply()).toHaveTextContent("I do not know `deploy`."));
    expect(consoleActions.runConsoleCommand).toHaveBeenCalledWith("deploy now");
    expect(reply()).toHaveTextContent("Error");
  });

  it("says the commands are on their way, rather than showing an empty box", async () => {
    const reading = deferred<ReturnType<typeof grammar>>();
    consoleActions.readConsoleGrammar.mockReturnValue(reading.promise);

    await command();
    expect(screen.getByRole("listbox")).toHaveTextContent(GRAMMAR_LOADING);

    await act(async () => reading.resolve(grammar()));
    expect(rows()).toHaveLength(12);
    expect(screen.getByRole("listbox")).not.toHaveTextContent(GRAMMAR_LOADING);
  });

  it("says the commands could not be listed, and still runs what is typed", async () => {
    consoleActions.readConsoleGrammar.mockResolvedValue({ error: "No.", code: "internal_error" });

    const box = await command("/ouro status");

    expect(screen.getByRole("listbox")).toHaveTextContent(GRAMMAR_UNREADABLE);
    press(box, "Enter");

    await waitFor(() => expect(reply()).toHaveTextContent(STATUS_REPLY));
  });
});

describe("the keyboard, which is the palette's own", () => {
  it("starts on the first command", async () => {
    await command();

    expect(highlighted()).toBe(row("/ouro status"));
  });

  it("names the highlighted row to the box", async () => {
    const box = await command();

    expect(box).toHaveAttribute("aria-activedescendant", row("/ouro status").id);
    press(box, "ArrowDown");
    expect(box).toHaveAttribute("aria-activedescendant", row("/ouro queue #485 [workflow]").id);
  });

  it("moves down and back up, and wraps at the ends", async () => {
    const box = await command();

    press(box, "ArrowDown");
    expect(highlighted()).toBe(row("/ouro queue #485 [workflow]"));

    press(box, "ArrowUp");
    expect(highlighted()).toBe(row("/ouro status"));

    press(box, "ArrowUp");
    expect(highlighted()).toBe(row("/ouro help [command]"));
  });

  it("fills a command's name in on Enter, ready for its argument, and runs nothing", async () => {
    const box = await command();

    press(box, "ArrowDown");
    press(box, "Enter");

    expect(box).toHaveValue("/ouro queue ");
    expect(consoleActions.runConsoleCommand).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("fills it in on a press, and keeps focus in the box", async () => {
    const box = await command();

    const target = row("/ouro estimate #490");
    expect(fireEvent.mouseDown(target)).toBe(false);
    fireEvent.click(target);

    expect(box).toHaveValue("/ouro estimate ");
    expect(box).toHaveFocus();
  });

  it("completes a half-typed name on Tab", async () => {
    const box = await command("/ouro sta");

    expect(press(box, "Tab")).toBe(false);
    expect(box).toHaveValue("/ouro status ");
  });

  it("leaves Tab alone on an empty line, so the keyboard can reach a reply's link", async () => {
    const box = await command();

    // Nothing is filled in: the key goes on to the overlay's focus trap, as it does anywhere
    // else in a dialog.
    press(box, "Tab");

    expect(box).toHaveValue("/ouro ");
  });

  it("never takes Shift+Tab", async () => {
    const box = await command("/ouro sta");

    fireEvent.keyDown(box, { key: "Tab", shiftKey: true });

    expect(box).toHaveValue("/ouro sta");
  });
});

describe("completing an argument", () => {
  beforeEach(() => {
    consoleActions.readConsoleCompletions.mockResolvedValue(completions("queue", "ticket", TICKETS));
  });

  it("names the command the line has reached, with what each position takes", async () => {
    await command("/ouro queue ");

    const named = document.querySelector(".shell-console__named");

    expect(named).toHaveTextContent("/ouro queue <ticket> [workflow]");
    expect(named).toHaveTextContent("send an issue into the loop");
  });

  it("shows a named command's denial and stage above its completions", async () => {
    const box = await command("/ouro route ");

    expect(document.querySelector(".shell-console__named")).toHaveTextContent("needs admin");
    expect(document.querySelector(".shell-console__named")).toHaveClass("shell-console__named--denied");

    type(box, "/ouro explain pr ");
    expect(document.querySelector(".shell-console__named")).toHaveTextContent("v2");
  });

  it("asks the service with the text as typed, and lists what it answers", async () => {
    await command("/ouro queue #4");

    const first = await screen.findByRole("option", { name: /#485/ });

    expect(consoleActions.readConsoleCompletions).toHaveBeenCalledWith("queue #4");
    expect(screen.getByRole("listbox", { name: "Completions" })).toBeInTheDocument();
    expect(first).toHaveTextContent("OTA rollback flag");
    expect(rows().map((one) => one.querySelector("code")?.textContent)).toEqual(["#485", "#486"]);
  });

  it("does not ask while the command's name is still being typed", async () => {
    await command("/ouro que");
    await act(async () => new Promise((done) => setTimeout(done, CONSOLE_COMPLETION_DELAY_MS + 50)));

    expect(consoleActions.readConsoleCompletions).not.toHaveBeenCalled();
  });

  it("highlights nothing until an arrow does, so Enter runs the line", async () => {
    const box = await command("/ouro queue #4");
    await screen.findByRole("option", { name: /#485/ });

    expect(highlighted()).toBeUndefined();
    expect(box).not.toHaveAttribute("aria-activedescendant");

    press(box, "Enter");

    await waitFor(() => expect(consoleActions.runConsoleCommand).toHaveBeenCalledWith("queue #4"));
  });

  it("moves through the completions with the arrows", async () => {
    const box = await command("/ouro queue #4");
    await screen.findByRole("option", { name: /#485/ });

    press(box, "ArrowDown");
    expect(highlighted()).toHaveTextContent("#485");

    press(box, "ArrowDown");
    expect(highlighted()).toHaveTextContent("#486");

    press(box, "ArrowDown");
    expect(highlighted()).toHaveTextContent("#485");

    press(box, "ArrowUp");
    expect(highlighted()).toHaveTextContent("#486");
  });

  it("accepts the highlighted completion on Tab, with a space after it", async () => {
    const box = await command("/ouro queue #4");
    await screen.findByRole("option", { name: /#485/ });

    press(box, "ArrowDown");
    press(box, "ArrowDown");

    expect(press(box, "Tab")).toBe(false);
    expect(box).toHaveValue("/ouro queue #486 ");
    expect(consoleActions.runConsoleCommand).not.toHaveBeenCalled();
  });

  it("accepts the first completion on Tab when none is highlighted", async () => {
    const box = await command("/ouro queue #4");
    await screen.findByRole("option", { name: /#485/ });

    press(box, "Tab");

    expect(box).toHaveValue("/ouro queue #485 ");
  });

  it("accepts the highlighted completion on Enter, rather than running the line", async () => {
    const box = await command("/ouro queue #4");
    await screen.findByRole("option", { name: /#485/ });

    press(box, "ArrowDown");
    press(box, "Enter");

    expect(box).toHaveValue("/ouro queue #485 ");
    expect(consoleActions.runConsoleCommand).not.toHaveBeenCalled();
  });

  it("accepts a completion on a press", async () => {
    const box = await command("/ouro queue #4");

    fireEvent.click(await screen.findByRole("option", { name: /#486/ }));

    expect(box).toHaveValue("/ouro queue #486 ");
    expect(box).toHaveFocus();
  });

  it("completes the word the caret is in, and leaves the caret after it", async () => {
    const box = await command("/ouro queue #4 standard-fix");

    // The caret walks back into the ticket.
    box.setSelectionRange(14, 14);
    fireEvent.keyUp(box, { key: "ArrowLeft" });

    await waitFor(() =>
      expect(consoleActions.readConsoleCompletions).toHaveBeenLastCalledWith("queue #4"),
    );
    await screen.findByRole("option", { name: /#485/ });

    press(box, "Tab");

    expect(box).toHaveValue("/ouro queue #485 standard-fix");
    expect(box.selectionStart).toBe(17);
  });

  it("says that nothing matches, from the argument the service names", async () => {
    consoleActions.readConsoleCompletions.mockResolvedValue(completions("queue", "ticket"));

    await command("/ouro queue #9");

    await waitFor(() =>
      expect(screen.getByRole("listbox")).toHaveTextContent("No open tickets match “#9”."),
    );
    expect(rows()).toHaveLength(0);
  });

  it("takes the vocabulary from the answer itself when the service names it", async () => {
    consoleActions.readConsoleCompletions.mockResolvedValue({
      ...completions("pause loop", "loop"),
      source: "loops",
    });

    await command("/ouro pause loop 99");

    await waitFor(() =>
      expect(screen.getByRole("listbox")).toHaveTextContent("No live loops match “99”."),
    );
  });

  it("says nothing of an argument nothing completes", async () => {
    consoleActions.readConsoleCompletions.mockResolvedValue(completions("explain pr", "pr"));

    await command("/ouro explain pr 51");
    await waitFor(() => expect(consoleActions.readConsoleCompletions).toHaveBeenCalled());
    await act(async () => {});

    expect(document.querySelector(".shell-console__note")).toBeNull();
  });

  it("says completions could not be read, and still runs the command", async () => {
    consoleActions.readConsoleCompletions.mockResolvedValue({ error: "No.", code: "internal_error" });

    const box = await command("/ouro queue #4");

    await waitFor(() => expect(screen.getByRole("listbox")).toHaveTextContent(COMPLETIONS_UNREADABLE));

    press(box, "Enter");
    await waitFor(() => expect(consoleActions.runConsoleCommand).toHaveBeenCalledWith("queue #4"));
  });

  it("degrades the same way when the request itself never arrives", async () => {
    consoleActions.readConsoleCompletions.mockRejectedValue(new TypeError("fetch failed"));

    await command("/ouro queue #4");

    await waitFor(() => expect(screen.getByRole("listbox")).toHaveTextContent(COMPLETIONS_UNREADABLE));
  });
});

describe("completions and the clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  /**
   * Let the debounce pass, and whatever it started answer.
   *
   * @param ms How long. One debounce by default.
   */
  async function wait(ms = CONSOLE_COMPLETION_DELAY_MS): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  /**
   * Open the palette in command mode under the fake clock.
   *
   * @param query What the box holds.
   * @returns The box.
   */
  async function commandNow(query: string): Promise<HTMLInputElement> {
    const box = open();
    type(box, query);
    await wait(0);
    return box;
  }

  it("waits for the typing to stop before it asks", async () => {
    const box = await commandNow("/ouro queue #");

    await wait(CONSOLE_COMPLETION_DELAY_MS - 1);
    expect(consoleActions.readConsoleCompletions).not.toHaveBeenCalled();

    type(box, "/ouro queue #4");
    await wait(CONSOLE_COMPLETION_DELAY_MS - 1);
    expect(consoleActions.readConsoleCompletions).not.toHaveBeenCalled();

    await wait(1);
    expect(CONSOLE_COMPLETION_DELAY_MS).toBe(150);
    expect(consoleActions.readConsoleCompletions).toHaveBeenCalledTimes(1);
    expect(consoleActions.readConsoleCompletions).toHaveBeenCalledWith("queue #4");
  });

  it("never shows an answer for text the box no longer holds", async () => {
    const slow = deferred<ReturnType<typeof completions>>();
    consoleActions.readConsoleCompletions
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(completions("queue", "ticket", [["#490", "Sensor drift"]]));

    const box = await commandNow("/ouro queue #48");
    await wait();
    expect(consoleActions.readConsoleCompletions).toHaveBeenCalledTimes(1);

    // The reader types on before the first answer is back.
    type(box, "/ouro queue #49");
    await wait();
    expect(rows().map((one) => one.querySelector("code")?.textContent)).toEqual(["#490"]);

    // The first answer arrives late, about a text that is gone.
    await act(async () => slow.resolve(completions("queue", "ticket", TICKETS)));
    await wait(0);

    expect(rows().map((one) => one.querySelector("code")?.textContent)).toEqual(["#490"]);
  });

  it("shows nothing stale while the next answer is on its way", async () => {
    consoleActions.readConsoleCompletions.mockResolvedValueOnce(
      completions("queue", "ticket", TICKETS),
    );

    const box = await commandNow("/ouro queue #4");
    await wait();
    expect(rows()).toHaveLength(2);

    consoleActions.readConsoleCompletions.mockReturnValueOnce(deferred<never>().promise);
    type(box, "/ouro queue #48");

    expect(rows()).toHaveLength(0);
  });
});

describe("running a line", () => {
  it("shows that it is out, and holds the box still", async () => {
    const running = deferred<ReturnType<typeof result>>();
    consoleActions.runConsoleCommand.mockReturnValue(running.promise);

    const box = await command("/ouro status");
    press(box, "Enter");

    const seat = screen.getByRole("status");

    expect(seat).toHaveTextContent("Running /ouro status…");
    expect(box).toHaveAttribute("readonly");
    expect(box.closest(".shell-palette__box")).toHaveClass("shell-palette__box--pending");
    expect(box.closest(".shell-palette__box")).toHaveAttribute("aria-busy", "true");
    expect(box).toHaveFocus();

    await act(async () => running.resolve(result()));

    expect(box).not.toHaveAttribute("readonly");
    expect(box.closest(".shell-palette__box")).not.toHaveAttribute("aria-busy");
    expect(seat).not.toHaveTextContent("Running");
  });

  it("cannot be sent twice", async () => {
    const running = deferred<ReturnType<typeof result>>();
    consoleActions.runConsoleCommand.mockReturnValue(running.promise);

    const box = await command("/ouro status");
    press(box, "Enter");
    press(box, "Enter");
    press(box, "Enter");

    expect(consoleActions.runConsoleCommand).toHaveBeenCalledTimes(1);

    await act(async () => running.resolve(result()));
    expect(consoleActions.runConsoleCommand).toHaveBeenCalledTimes(1);
  });

  it("sends what follows the prefix, trimmed", async () => {
    const box = await command();

    await run(box, "/ouro   queue #485   ");

    expect(consoleActions.runConsoleCommand).toHaveBeenCalledWith("queue #485");
  });

  it("sends nothing for an empty line", async () => {
    consoleActions.readConsoleGrammar.mockResolvedValue({ error: "No.", code: "internal_error" });

    const box = await command("/ouro   ");
    press(box, "Enter");

    expect(consoleActions.runConsoleCommand).not.toHaveBeenCalled();
  });

  it("draws the reply in a box, with what was run and how it came out", async () => {
    const box = await command();

    await run(box, "/ouro status");

    expect(reply()).toHaveTextContent("Done");
    expect(reply()).toHaveTextContent("/ouro status");
    expect(reply().querySelector(".shell-console__text")).toHaveTextContent(STATUS_REPLY);
    expect(reply().querySelector(".shell-console__mark")).toHaveClass("shell-console__mark--ok");
    // In the live region, so a screen reader hears it.
    expect(screen.getByRole("status")).toContainElement(reply());
  });

  it("stays open, with the box ready for the next command", async () => {
    const box = await command();

    await run(box, "/ouro status");

    expect(onClose).not.toHaveBeenCalled();
    expect(box).toHaveValue("/ouro ");
    expect(box).toHaveFocus();
    expect(rows()).toHaveLength(12);

    consoleActions.runConsoleCommand.mockResolvedValue(
      result({ command: "estimate", reply: { text: "M · $1.20 · 14m" } }),
    );
    await run(box, "/ouro estimate #490");

    expect(reply()).toHaveTextContent("M · $1.20 · 14m");
    expect(reply()).not.toHaveTextContent(STATUS_REPLY);
  });

  it("draws the reply's link as a link", async () => {
    consoleActions.runConsoleCommand.mockResolvedValue(
      result({
        command: "queue",
        reply: { text: "Queued #485.", link: { label: "Open loop #1852", url: "/runs/1852" } },
      }),
    );
    const box = await command();

    await run(box, "/ouro queue #485");

    expect(within(reply()).getByRole("link", { name: "Open loop #1852" })).toHaveAttribute(
      "href",
      "/runs/1852",
    );
  });

  it("closes behind a link into the application, and leaves one out of it alone", async () => {
    const still = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("click", still, true);

    try {
      consoleActions.runConsoleCommand.mockResolvedValue(
        result({ reply: { text: "Queued.", link: { label: "Open loop", url: "/runs/1852" } } }),
      );
      const box = await command();
      await run(box, "/ouro queue #485");

      fireEvent.click(within(reply()).getByRole("link", { name: "Open loop" }));
      expect(onClose).toHaveBeenCalledTimes(1);

      consoleActions.runConsoleCommand.mockResolvedValue(
        result({
          reply: { text: "Queued.", link: { label: "On GitHub", url: "https://github.com/a/b/issues/485" } },
        }),
      );
      await run(box, "/ouro queue #485");

      const outside = within(reply()).getByRole("link", { name: "On GitHub" });
      expect(outside).toHaveAttribute("href", "https://github.com/a/b/issues/485");
      fireEvent.click(outside);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("click", still, true);
    }
  });

  it("marks a denial in words", async () => {
    consoleActions.runConsoleCommand.mockResolvedValue(
      result({ command: "route", outcome: "denied", reply: { text: "Only owners and admins can repin a model." } }),
    );
    const box = await command();

    await run(box, "/ouro route implement claude-fable-5");

    expect(reply().querySelector(".shell-console__mark")).toHaveTextContent("Denied");
    expect(reply()).toHaveTextContent("Only owners and admins can repin a model.");
  });

  it("marks an error in words", async () => {
    consoleActions.runConsoleCommand.mockResolvedValue(
      result({ command: "queue", outcome: "error", reply: { text: "#9999 is not an open ticket." } }),
    );
    const box = await command();

    await run(box, "/ouro queue #9999");

    expect(reply().querySelector(".shell-console__mark")).toHaveTextContent("Error");
    expect(reply().querySelector(".shell-console__mark")).toHaveClass("shell-console__mark--error");
  });

  it("shows what a v2 command says instead of running", async () => {
    consoleActions.runConsoleCommand.mockResolvedValue(
      result({ command: "explain pr", outcome: "ok", reply: { text: EXPLAIN_UNAVAILABLE } }),
    );
    const box = await command();

    await run(box, "/ouro explain pr 514");

    expect(consoleActions.runConsoleCommand).toHaveBeenCalledWith("explain pr 514");
    expect(reply()).toHaveTextContent(EXPLAIN_UNAVAILABLE);
  });

  it("prints the service's refusal of a line it would not read, and keeps the line", async () => {
    consoleActions.runConsoleCommand.mockResolvedValue({
      error: "A command may be at most 2000 characters.",
      code: "validation_failed",
    });
    const box = await command();

    await run(box, "/ouro status");

    expect(reply()).toHaveTextContent("Error");
    expect(reply()).toHaveTextContent("A command may be at most 2000 characters.");
    expect(box).toHaveValue("/ouro status");
    expect(window.localStorage.getItem(CONSOLE_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("says a line could not be sent when the request never arrived", async () => {
    consoleActions.runConsoleCommand.mockRejectedValue(new TypeError("fetch failed"));
    const box = await command();

    await run(box, "/ouro status");

    await waitFor(() => expect(reply()).toHaveTextContent(RUN_FAILED));
    expect(box).not.toHaveAttribute("readonly");
  });
});

describe("the confirm rule", () => {
  const PREVIEW = "This would abort loop 1847 (#479 OTA rollback) and discard its workspace.";

  beforeEach(() => {
    consoleActions.runConsoleCommand.mockResolvedValue(
      result({
        command: "abort loop",
        reply: { text: PREVIEW },
        confirmWith: "abort loop 1847 confirm",
      }),
    );
  });

  it("shows the preview as something that has not run", async () => {
    const box = await command();

    await run(box, "/ouro abort loop 1847");

    expect(reply().querySelector(".shell-console__mark")).toHaveTextContent("Not run yet");
    expect(reply()).toHaveTextContent(PREVIEW);
    expect(reply()).toHaveTextContent(CONFIRM_NOTE);
    expect(reply()).not.toHaveTextContent("Done");
  });

  it("offers to put the confirming command in the box, and does not run it", async () => {
    const box = await command();
    await run(box, "/ouro abort loop 1847");

    fireEvent.click(
      within(reply()).getByRole("button", { name: "Put “/ouro abort loop 1847 confirm” in the box" }),
    );

    expect(box).toHaveValue("/ouro abort loop 1847 confirm");
    expect(box).toHaveFocus();
    expect(consoleActions.runConsoleCommand).toHaveBeenCalledTimes(1);
  });

  it("runs it only when the reader presses Enter", async () => {
    const box = await command();
    await run(box, "/ouro abort loop 1847");
    fireEvent.click(within(reply()).getByRole("button", { name: /Put/ }));

    consoleActions.runConsoleCommand.mockResolvedValue(
      result({ command: "abort loop", reply: { text: "Aborted loop 1847." } }),
    );
    press(box, "Enter");

    await waitFor(() => expect(reply()).toHaveTextContent("Aborted loop 1847."));
    expect(consoleActions.runConsoleCommand).toHaveBeenLastCalledWith("abort loop 1847 confirm");
    expect(reply().querySelector(".shell-console__mark")).toHaveTextContent("Done");
    expect(within(reply()).queryByRole("button")).toBeNull();
  });

  it("just shows the reply when nothing would confirm it", async () => {
    consoleActions.runConsoleCommand.mockResolvedValue(result());
    const box = await command();

    await run(box, "/ouro status");

    expect(within(reply()).queryByRole("button")).toBeNull();
    expect(reply()).not.toHaveTextContent(CONFIRM_NOTE);
  });
});

describe("a result that follows", () => {
  const ACK = "Dry run of #486 started. I will tell you when it finishes.";

  beforeEach(() => {
    vi.useFakeTimers();
    consoleActions.runConsoleCommand.mockResolvedValue(
      result({ commandId: DRY_RUN_ID, command: "dry-run", outcome: "async_pending", reply: { text: ACK } }),
    );
  });

  /**
   * Let time pass, and whatever it started answer.
   *
   * @param ms How long.
   */
  async function wait(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("shows the acknowledgement at once, then a toast with the deep link after the palette closed", async () => {
    consoleActions.readConsoleCommand
      .mockResolvedValueOnce(record({ outcome: "async_pending", completedAt: null, settledReply: null }))
      .mockResolvedValue(record());

    const shell = renderThemed(
      <>
        <CommandPalette onClose={onClose} />
        <ConsoleToasts />
      </>,
    );
    const box = screen.getByRole<HTMLInputElement>("combobox");
    type(box, "/ouro dry-run #486");
    await wait(0);

    press(box, "Enter");
    await wait(0);

    expect(reply().querySelector(".shell-console__mark")).toHaveTextContent("Started");
    expect(reply()).toHaveTextContent(ACK);
    expect(reply()).toHaveTextContent(ASYNC_NOTE);

    // The reader closes the palette. The wait is the shell's, not the palette's.
    shell.rerender(
      <>
        {null}
        <ConsoleToasts />
      </>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    const seat = screen.getByRole("status", { name: "Command results" });
    expect(seat).toBeEmptyDOMElement();

    await wait(CONSOLE_WATCH_INTERVAL_MS);
    expect(consoleActions.readConsoleCommand).toHaveBeenCalledWith(DRY_RUN_ID);
    expect(seat).toBeEmptyDOMElement();

    await wait(CONSOLE_WATCH_INTERVAL_MS);

    expect(seat).toHaveTextContent("Dry run of #486 passed: 4 stages, 0 writes.");
    expect(seat).toHaveTextContent("/ouro dry-run #486");
    expect(seat).toHaveTextContent("Done");
    expect(within(seat).getByRole("link", { name: "Open the dry run" })).toHaveAttribute(
      "href",
      "/workflows/dry-runs/41",
    );

    // Settled: nothing is read again.
    await wait(CONSOLE_WATCH_INTERVAL_MS * 3);
    expect(consoleActions.readConsoleCommand).toHaveBeenCalledTimes(2);
  });

  it("keeps the toast until it is dismissed", async () => {
    renderThemed(
      <>
        <CommandPalette onClose={onClose} />
        <ConsoleToasts />
      </>,
    );
    const box = screen.getByRole<HTMLInputElement>("combobox");
    type(box, "/ouro dry-run #486");
    await wait(0);
    press(box, "Enter");
    await wait(CONSOLE_WATCH_INTERVAL_MS);

    const seat = screen.getByRole("status", { name: "Command results" });
    expect(seat).toHaveTextContent("Dry run of #486 passed");

    await wait(60_000);
    expect(seat).toHaveTextContent("Dry run of #486 passed");

    fireEvent.click(within(seat).getByRole("button", { name: "Dismiss" }));
    expect(seat).toBeEmptyDOMElement();
  });

  it("stops waiting when the shell itself unmounts", async () => {
    consoleActions.readConsoleCommand.mockResolvedValue(
      record({ outcome: "async_pending", completedAt: null, settledReply: null }),
    );

    const shell = renderThemed(
      <>
        <CommandPalette onClose={onClose} />
        <ConsoleToasts />
      </>,
    );
    const box = screen.getByRole<HTMLInputElement>("combobox");
    type(box, "/ouro dry-run #486");
    await wait(0);
    press(box, "Enter");
    await wait(CONSOLE_WATCH_INTERVAL_MS);
    expect(consoleActions.readConsoleCommand).toHaveBeenCalledTimes(1);

    shell.unmount();
    await wait(CONSOLE_WATCH_INTERVAL_MS * 4);

    expect(consoleActions.readConsoleCommand).toHaveBeenCalledTimes(1);
  });

  it("waits for nothing when the command ran at once", async () => {
    consoleActions.runConsoleCommand.mockResolvedValue(result());

    renderThemed(<CommandPalette onClose={onClose} />);
    const box = screen.getByRole<HTMLInputElement>("combobox");
    type(box, "/ouro status");
    await wait(0);
    press(box, "Enter");
    await wait(CONSOLE_WATCH_INTERVAL_MS * 2);

    expect(consoleActions.readConsoleCommand).not.toHaveBeenCalled();
    expect(reply()).not.toHaveTextContent(ASYNC_NOTE);
  });
});

describe("the history", () => {
  /**
   * Run two lines, so there is something to recall.
   *
   * @param box The box.
   */
  async function runTwo(box: HTMLElement): Promise<void> {
    await run(box, "/ouro status");
    await run(box, "/ouro queue #485");
  }

  it("recalls what was run, newest first, on ↑ from an empty line", async () => {
    const box = await command();
    await runTwo(box);

    expect(press(box, "ArrowUp")).toBe(false);
    expect(box).toHaveValue("/ouro queue #485");

    press(box, "ArrowUp");
    expect(box).toHaveValue("/ouro status");

    // The oldest is where it stops.
    press(box, "ArrowUp");
    expect(box).toHaveValue("/ouro status");
  });

  it("walks back down, and off the newest to what was in the box", async () => {
    const box = await command();
    await runTwo(box);

    press(box, "ArrowUp");
    press(box, "ArrowUp");
    press(box, "ArrowDown");
    expect(box).toHaveValue("/ouro queue #485");

    press(box, "ArrowDown");
    expect(box).toHaveValue("/ouro ");
    expect(highlighted()).toBe(row("/ouro status"));
  });

  it("runs a recalled line on Enter, without a menu in the way", async () => {
    consoleActions.readConsoleCompletions.mockResolvedValue(completions("queue", "ticket", TICKETS));
    const box = await command();
    await runTwo(box);

    press(box, "ArrowUp");
    await act(async () => new Promise((done) => setTimeout(done, CONSOLE_COMPLETION_DELAY_MS + 50)));

    expect(rows()).toHaveLength(0);
    expect(consoleActions.readConsoleCompletions).not.toHaveBeenCalled();

    press(box, "Enter");
    await waitFor(() => expect(consoleActions.runConsoleCommand).toHaveBeenCalledTimes(3));
    expect(consoleActions.runConsoleCommand).toHaveBeenLastCalledWith("queue #485");
  });

  it("goes back to completing once the recalled line is edited", async () => {
    consoleActions.readConsoleCompletions.mockResolvedValue(completions("queue", "ticket", TICKETS));
    const box = await command();
    await runTwo(box);

    press(box, "ArrowUp");
    type(box, "/ouro queue #48");

    expect(await screen.findByRole("option", { name: /#485/ })).toBeInTheDocument();
  });

  it("does not add a line that repeats the one before it", async () => {
    const box = await command();
    await run(box, "/ouro status");
    await run(box, "/ouro status");

    press(box, "ArrowUp");
    press(box, "ArrowUp");

    expect(box).toHaveValue("/ouro status");
    expect(JSON.parse(window.localStorage.getItem(CONSOLE_HISTORY_STORAGE_KEY)!)).toEqual({
      [`${authStub.session.data!.user.id}/${menuWorkspaces()[0].id}`]: ["status"],
    });
  });

  it("leaves ↑ to the list once the arrows are in it", async () => {
    const box = await command();
    await runTwo(box);

    press(box, "ArrowDown");
    press(box, "ArrowDown");
    press(box, "ArrowUp");

    expect(box).toHaveValue("/ouro ");
    expect(highlighted()).toBe(row("/ouro queue #485 [workflow]"));
  });

  it("leaves ↑ to the list when there is nothing to recall", async () => {
    const box = await command();

    press(box, "ArrowUp");

    expect(box).toHaveValue("/ouro ");
    expect(highlighted()).toBe(row("/ouro help [command]"));
  });

  it("recalls from a line with no list under it", async () => {
    const box = await command();
    await runTwo(box);

    type(box, "/ouro status");
    expect(rows()).toHaveLength(0);
    press(box, "ArrowUp");

    expect(box).toHaveValue("/ouro queue #485");
  });

  it("is the workspace's: another workspace recalls nothing of this one's", async () => {
    const first = await command();
    await runTwo(first);

    signedIn(menuWorkspaces()[1].id);
    type(first, "/ouro  ");
    type(first, "/ouro ");

    press(first, "ArrowUp");

    expect(first).toHaveValue("/ouro ");
  });

  it("is the person's: somebody else in the same browser recalls nothing of theirs", async () => {
    const box = await command();
    await runTwo(box);

    authStub.session = {
      data: {
        user: { ...authStub.session.data!.user, id: "user-mia" },
        session: { activeOrganizationId: menuWorkspaces()[0].id },
      },
      isPending: false,
    };
    type(box, "/ouro  ");
    type(box, "/ouro ");

    press(box, "ArrowUp");

    expect(box).toHaveValue("/ouro ");
  });

  it("keeps nothing while nobody is known to be signed in", async () => {
    signedOut();
    const box = await command();

    await run(box, "/ouro status");

    expect(window.localStorage.getItem(CONSOLE_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("ignores a damaged history", async () => {
    window.localStorage.setItem(CONSOLE_HISTORY_STORAGE_KEY, "{not json");
    const box = await command();

    press(box, "ArrowUp");

    expect(box).toHaveValue("/ouro ");
    expect(highlighted()).toBe(row("/ouro help [command]"));
  });
});
