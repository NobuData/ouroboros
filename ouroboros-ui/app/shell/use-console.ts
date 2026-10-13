"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ConsoleCompletion, ConsoleCompletions, ConsoleGrammar } from "@/app/api/console";

import {
  COMMANDS_LABEL,
  COMPLETIONS_LABEL,
  COMPLETIONS_UNREADABLE,
  type ConsoleAnswer,
  type ConsoleEntry,
  type ConsoleReplyView,
  GRAMMAR_LOADING,
  GRAMMAR_UNREADABLE,
  RUN_FAILED,
  acceptCompletion,
  completionRequest,
  completionTarget,
  consoleEntries,
  consoleOffset,
  consoleQuery,
  consoleText,
  deniedView,
  entryQuery,
  filterEntries,
  isConsoleRefusal,
  namedEntry,
  noCommandMatches,
  nothingMatches,
  refusalView,
  replyView,
} from "./console";
import { readConsoleCompletions, readConsoleGrammar, runConsoleCommand } from "./console-actions";
import { historyStep, readConsoleHistory, recordConsoleLine } from "./console-history";
import { watchConsoleCommand } from "./console-watch";

/**
 * The palette's command mode, resolved into the rows it draws and the three things its keys do
 * (BZ.5, [#539](https://github.com/NobuData/ouroboros/issues/539)).
 *
 * `app/shell/console.ts` is pure and `app/shell/console-watch.ts` is framework-free, both on
 * purpose; this file is where either meets React — the split `app/shell/use-command-actions.ts`
 * makes for the palette's ordinary rows, and for the same reasons.
 *
 * ### It supplies rows; it does not own the keyboard
 *
 * The palette has one listbox, one highlighted row and one ring the arrows walk
 * (`app/shell/command-palette.tsx`), and command mode does not get a second of any of them.
 * What this hook hands back is the same thing a command source does — rows — plus what Enter
 * and Tab mean on one, and whether an arrow was a step through the history instead. Which row
 * is highlighted stays the palette's to decide.
 *
 * ```
 *   /ouro pau▮            naming      rows = the commands the text could become
 *   /ouro pause loop 18▮  arguments   rows = what the service says could be typed next
 * ```
 */

/** How long the typing has to stop before the completions are asked for. */
export const CONSOLE_COMPLETION_DELAY_MS = 150;

/** One row of command mode: a command to choose, or a completion to accept. */
export type ConsoleRow =
  | {
      /** A line of the command list. */
      readonly kind: "entry";
      /** Unique among the rows, and prefixed so it can never collide with an action's id. */
      readonly id: string;
      /** The command. */
      readonly entry: ConsoleEntry;
    }
  | {
      /** Something that could be typed next. */
      readonly kind: "completion";
      /** Unique among the rows. */
      readonly id: string;
      /** What to insert, and what to show beside it. */
      readonly completion: ConsoleCompletion;
    };

/** Which way an arrow pointed, in the palette's own vocabulary (`app/shell/menu.ts`). */
export type ConsoleStep = "next" | "previous";

/** What the palette tells the hook. */
export interface ConsoleOptions {
  /** Whether the palette is in command mode. Everything below is inert while it is not. */
  readonly active: boolean;
  /** The box's whole content. */
  readonly query: string;
  /** The caret's offset in the box. */
  readonly caret: number;
  /**
   * Put a line in the box.
   *
   * @param query The box's new content.
   * @param caret Where the caret goes. The end of the line when omitted.
   */
  readonly place: (query: string, caret?: number) => void;
  /** The signed-in person's `user.id`, or empty while the session is not known. */
  readonly userId: string;
  /** The workspace the session acts in, or empty when it has none. */
  readonly workspaceId: string;
}

/** What the palette draws, and what its keys ask. */
export interface ConsoleState {
  /**
   * Which list is showing: the commands a name could become, or the completions of an argument.
   * The difference the palette cares about is the highlight — the command list always has a row
   * for Enter to act on, as the palette's own list does; the completions start with none, so
   * Enter on a finished line runs it rather than accepting a suggestion nobody chose.
   */
  readonly stage: "naming" | "arguments";
  /** The rows the arrows walk. */
  readonly rows: readonly ConsoleRow[];
  /** The list's accessible name. */
  readonly label: string;
  /** The command the line names, drawn above its completions. Null while it names none. */
  readonly named: ConsoleEntry | null;
  /** What the list says instead of, or under, its rows — nothing matched, nothing was read. */
  readonly note: string | null;
  /** The line that is out, without the prefix. Null while nothing is. */
  readonly pending: string | null;
  /** The last reply. Null before the first. */
  readonly reply: ConsoleReplyView | null;
  /**
   * Offer an arrow to the history before the ring gets it.
   *
   * @param step Which way it pointed.
   * @param moved Whether the arrows have already moved the highlight in the list showing.
   * @returns True when the key was a step through the history, and the ring should stay put.
   */
  readonly recall: (step: ConsoleStep, moved: boolean) => boolean;
  /**
   * Enter: accept the highlighted row, or run the line.
   *
   * @param row The highlighted row, when there is one.
   */
  readonly enter: (row: ConsoleRow | undefined) => void;
  /**
   * Tab: complete what is being typed.
   *
   * @param row The highlighted row, when there is one. The first row otherwise.
   * @returns True when it completed something; false when there was nothing to complete, in
   *   which case the key is left to move focus as it does anywhere else.
   */
  readonly tab: (row: ConsoleRow | undefined) => boolean;
  /** The reader typed: whatever walk through the history was in progress is over. */
  readonly edited: () => void;
}

/** What the completions endpoint last answered, and what it answered *for*. */
interface Completed {
  /** The text it was asked, so a stale answer can be recognised rather than shown. */
  readonly request: string;
  /** What it answered. */
  readonly answer: ConsoleAnswer<ConsoleCompletions>;
}

/** A walk through the history in progress. */
interface Walk {
  /** Where it is, as an index into the lines, newest first. */
  readonly at: number;
  /** What the box held before it began, to put back when ↓ walks off the newest line. */
  readonly draft: string;
}

/** No rows, as one frozen array rather than a fresh one per render. */
const NO_ROWS: readonly ConsoleRow[] = Object.freeze([]);

/** No entries, likewise. */
const NO_ENTRIES: readonly ConsoleEntry[] = Object.freeze([]);

/**
 * Command mode.
 *
 * @param options See {@link ConsoleOptions}.
 * @returns See {@link ConsoleState}.
 */
export function useConsole({
  active,
  query,
  caret,
  place,
  userId,
  workspaceId,
}: ConsoleOptions): ConsoleState {
  /**
   * The grammar, or why it could not be read. Null until the first answer.
   *
   * Written from the promise's callback rather than from the effect body, which is what keeps
   * this clear of `react-hooks/set-state-in-effect` — `app/shell/use-command-actions.ts` argues
   * the case. It is kept when the palette leaves command mode, so coming back draws the list at
   * once while it is read again.
   */
  const [grammar, setGrammar] = useState<ConsoleAnswer<ConsoleGrammar> | null>(null);
  const [completed, setCompleted] = useState<Completed | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [reply, setReply] = useState<ConsoleReplyView | null>(null);
  const [walk, setWalk] = useState<Walk | null>(null);

  /**
   * Whether a line is out — the guard against a second Enter.
   *
   * A ref as well as {@link pending}, because two key presses can arrive inside one render and
   * the second would read the state the first has not yet committed.
   */
  const running = useRef(false);

  useEffect(() => {
    if (!active) return;

    let wanted = true;

    readConsoleGrammar()
      .then((answer) => {
        if (wanted) setGrammar(answer);
      })
      .catch(() => {
        if (wanted) setGrammar({ error: GRAMMAR_UNREADABLE, code: "" });
      });

    return () => {
      wanted = false;
    };
  }, [active]);

  const entries = useMemo(
    () => (grammar === null || isConsoleRefusal(grammar) ? NO_ENTRIES : consoleEntries(grammar)),
    [grammar],
  );

  const offset = consoleOffset(query);
  const text = consoleText(query);
  /** The caret, measured in the command's own text rather than in the box. */
  const at = Math.max(0, caret - offset);

  const named = active ? namedEntry(text, entries) : null;

  /**
   * What to ask the completions endpoint, or null when there is nothing to ask.
   *
   * Not while a line is out, and not while the history is being walked: a recalled line is one
   * the reader is about to run or step past, and a menu under it would take Enter away from
   * running it.
   */
  const request =
    pending === null && walk === null ? completionRequest(text, at, named) : null;

  useEffect(() => {
    if (request === null) return;

    const controller = new AbortController();

    const timer = setTimeout(() => {
      readConsoleCompletions(request)
        .then((answer) => {
          // A Server Action cannot be handed the signal, so the request itself is not
          // cancelled — its answer is. The cleanup below fires before the next effect runs,
          // which is what makes showing an older text's completions impossible rather than
          // merely unlikely.
          if (controller.signal.aborted) return;
          setCompleted({ request, answer });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setCompleted({ request, answer: { error: COMPLETIONS_UNREADABLE, code: "" } });
        });
    }, CONSOLE_COMPLETION_DELAY_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [request]);

  /** The answer, only while it still describes what is in the box. */
  const answer = request !== null && completed?.request === request ? completed.answer : null;

  let rows: readonly ConsoleRow[] = NO_ROWS;
  let note: string | null = null;

  if (!active || walk !== null) {
    // Nothing to offer: the mode is off, or the box holds a recalled line.
  } else if (named !== null) {
    if (answer === null) {
      // Not on an argument, or the answer is still on its way.
    } else if (isConsoleRefusal(answer)) {
      note = COMPLETIONS_UNREADABLE;
    } else if (answer.completions.length === 0) {
      note = nothingMatches(named.entry, answer, completionTarget(text, at).typed);
    } else {
      rows = answer.completions.map((completion) => ({
        kind: "completion",
        id: `console-completion:${completion.value}`,
        completion,
      }));
    }
  } else if (grammar === null) {
    note = GRAMMAR_LOADING;
  } else if (isConsoleRefusal(grammar)) {
    note = GRAMMAR_UNREADABLE;
  } else {
    rows = filterEntries(text, entries).map((entry) => ({
      kind: "entry",
      id: `console-entry:${entry.id}`,
      entry,
    }));

    if (rows.length === 0) note = noCommandMatches(text);
  }

  /**
   * Run a line through the dispatcher.
   *
   * The wait for an acknowledged command is started **before** anything is drawn, and from the
   * promise rather than from an effect: the palette may have been closed while the line was
   * out, and the result must still arrive (`app/shell/console-watch.ts`).
   *
   * @param line The line, without the prefix.
   */
  function run(line: string): void {
    if (running.current) return;

    running.current = true;
    setPending(line);
    setWalk(null);

    runConsoleCommand(line)
      .catch(() => ({ error: RUN_FAILED, code: "" }))
      .then((result) => {
        running.current = false;
        setPending(null);

        if (isConsoleRefusal(result)) {
          // The line never ran, so it is neither remembered nor cleared: it is still in the
          // box for the reader to mend.
          setReply(refusalView(line, result.error));
          return;
        }

        recordConsoleLine(userId, workspaceId, line);

        if (result.outcome === "async_pending" && result.commandId !== null) {
          watchConsoleCommand(result.commandId);
        }

        setReply(replyView(line, result));
        place(consoleQuery(""));
      });
  }

  /**
   * Accept a row: a completion into the line, a command's name into the box.
   *
   * @param row The row.
   */
  function accept(row: ConsoleRow): void {
    if (row.kind === "completion") {
      const edited = acceptCompletion(text, at, row.completion.value);
      place(`${query.slice(0, offset)}${edited.text}`, offset + edited.caret);
      return;
    }

    // Chosen for reading, not for running: a command the caller may not run says why, in the
    // place its reply would have gone, and the box is left as it was.
    if (!row.entry.allowed) {
      setReply(deniedView(row.entry));
      return;
    }

    place(entryQuery(row.entry));
  }

  return {
    stage: named === null ? "naming" : "arguments",
    rows,
    label: named === null ? COMMANDS_LABEL : COMPLETIONS_LABEL,
    named: named?.entry ?? null,
    note,
    pending,
    reply,

    recall(step, moved) {
      if (running.current) return false;

      const lines = readConsoleHistory(userId, workspaceId);

      if (step === "next") {
        if (walk === null) return false;

        const next = historyStep(walk.at, "newer", lines.length);

        if (next === null) {
          setWalk(null);
          place(walk.draft);
        } else {
          setWalk({ ...walk, at: next });
          place(consoleQuery(lines[next]));
        }

        return true;
      }

      // ↑ belongs to the list once the arrows are in it, and to the history otherwise: on an
      // empty line, or on one with no list under it at all.
      const begins = walk === null && ((text.trim() === "" && !moved) || rows.length === 0);
      if (walk === null && !begins) return false;

      const next = historyStep(walk?.at ?? null, "older", lines.length);
      if (next === null) return false;

      setWalk({ at: next, draft: walk?.draft ?? query });
      place(consoleQuery(lines[next]));

      return true;
    },

    enter(row) {
      if (running.current) return;

      if (row !== undefined) {
        accept(row);
        return;
      }

      const line = text.trim();
      if (line !== "") run(line);
    },

    tab(row) {
      if (running.current || rows.length === 0) return false;

      // A command's name is completed only once some of it has been typed. On an empty line
      // Tab is left alone, which is what lets the keyboard reach a reply's link.
      if (named === null && text.trim() === "") return false;

      accept(row ?? rows[0]);

      return true;
    },

    edited() {
      if (walk !== null) setWalk(null);
    },
  };
}
