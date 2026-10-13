"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";

import { useSession } from "@/app/api/auth-client";
import type { ConsoleCommandResult } from "@/app/api/console";
import { type ConsoleAnswer, deniedView, isConsoleQuery, isConsoleRefusal } from "@/app/shell/console";
import { menuFocusTarget } from "@/app/shell/menu";
import { type ConsoleRow, type ConsoleState, useConsole } from "@/app/shell/use-console";

import { type ComposerMode, composerMode } from "./view";

/**
 * The mirror's composer, as state (CA.2, [#542](https://github.com/NobuData/ouroboros/issues/542)).
 *
 * **It is the palette's command mode with a different box around it.** The grammar, the
 * completions, the history ↑ recalls, the guard against a second Enter and the wait for an
 * asynchronous result are all `app/shell/use-console.ts`'s — the one client of the dispatcher —
 * and what this hook adds is what the palette supplies for itself: a box, a caret and a
 * highlighted row. The one difference in what is sent is the channel the line was typed under.
 *
 * **Only a command can be sent.** What the box holds is read by `composerMode`; anything that
 * is not `/ouro …` is a message, messages live in Slack, and nothing here sends one.
 */

/** What the composer's component is handed. */
export interface MirrorComposerState {
  /** The box's content. */
  readonly text: string;
  /** What that content is, as far as sending goes. */
  readonly mode: ComposerMode;
  /** The command mode's rows, notes and pending line. */
  readonly cli: ConsoleState;
  /** Whether the box holds the prefix, so the list under it is the console's. */
  readonly commanding: boolean;
  /** The highlighted row, when there is one. */
  readonly activeRow: ConsoleRow | undefined;
  /** The highlighted row's element id, for `aria-activedescendant`. */
  readonly activeId: string | undefined;
  /** The list's element id. */
  readonly listId: string;
  /** Why the last line could not be sent, or run. Null once the reader types again. */
  readonly notice: string | null;
  /**
   * A row's element id.
   *
   * @param row The row.
   * @returns The id.
   */
  readonly rowId: (row: ConsoleRow) => string;
  /** The box changed. */
  readonly onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  /** A key went down in the box. */
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  /** The caret may have moved without the text changing. */
  readonly onSelect: (event: React.SyntheticEvent<HTMLInputElement>) => void;
  /** A row was pressed. */
  readonly choose: (row: ConsoleRow) => void;
  /** The pointer moved onto a row. */
  readonly point: (row: ConsoleRow) => void;
  /** **Send** was pressed: run the line as it stands. */
  readonly send: () => void;
  /**
   * Put a line in the box and the focus on it, without sending it — the commands card's
   * **Try it** (CA.3, [#543](https://github.com/NobuData/ouroboros/issues/543)). Asking for the
   * line the box already holds puts the caret back at its end.
   *
   * @param line The line, prefix included.
   */
  readonly prefill: (line: string) => void;
}

/**
 * The composer.
 *
 * @param channelId The bound channel the lines are typed under.
 * @param input The box — the caller's ref, so the caret can be put back in it and the focus
 *   returned to it after a row is pressed.
 * @param onSent Called once the dispatcher has answered a line — whatever it answered: the
 *   command is a record now, and the stream should read it.
 * @returns See {@link MirrorComposerState}.
 */
export function useMirrorComposer(
  channelId: string,
  input: React.RefObject<HTMLInputElement | null>,
  onSent: () => void,
): MirrorComposerState {
  const base = useId();

  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Where the caret must be put once the box has been re-rendered with a line placed in it. */
  const placed = useRef<number | null>(null);

  const place = useCallback((line: string, at: number = line.length): void => {
    placed.current = at;
    setText(line);
    setCaret(at);
  }, []);

  const onSettled = useCallback(
    (answer: ConsoleAnswer<ConsoleCommandResult>): void => {
      // A refusal is a line the service would not read at all: there is no record of it, so
      // it is said here, and the line is still in the box to mend.
      if (isConsoleRefusal(answer)) {
        setNotice(answer.error);
        return;
      }

      setNotice(null);
      onSent();
    },
    [onSent],
  );

  const session = useSession();
  const commanding = isConsoleQuery(text);

  const cli = useConsole({
    active: commanding,
    query: text,
    caret,
    place,
    userId: session.data?.user.id ?? "",
    workspaceId: session.data?.session.activeOrganizationId ?? "",
    channelId,
    cleared: "",
    onSettled,
  });

  const ring = commanding ? cli.rows.map((row) => row.id) : [];
  const moved = chosen !== null && ring.includes(chosen);
  // The palette's rule: the command list always has a row for Enter to act on; the
  // completions start with none, so Enter on a finished line runs it.
  const activeKey = moved ? chosen : commanding && cli.stage === "arguments" ? undefined : ring[0];
  const activeRow = commanding ? cli.rows.find((row) => row.id === activeKey) : undefined;

  const rowId = (row: ConsoleRow): string => `${base}-${row.id}`;

  useLayoutEffect(() => {
    if (placed.current === null) return;

    input.current?.setSelectionRange(placed.current, placed.current);
    placed.current = null;
  }, [input, text]);

  /**
   * Enter on a row, or on the line.
   *
   * A command the caller may not run says why here, where the reader is looking, rather than
   * being sent to be refused.
   *
   * @param row The highlighted row, when there is one.
   */
  function enter(row: ConsoleRow | undefined): void {
    if (row?.kind === "entry" && !row.entry.allowed) {
      setNotice(deniedView(row.entry).text);
      return;
    }

    cli.enter(row);
  }

  return {
    text,
    mode: composerMode(text),
    cli,
    commanding,
    activeRow,
    activeId: activeRow === undefined ? undefined : rowId(activeRow),
    listId: `${base}-list`,
    notice,
    rowId,

    onChange(event) {
      // Leading blanks are not part of anything typed here, and with them gone the prefix is
      // always at the very start of the box — where the console reads it.
      const raw = event.target.value;
      const value = raw.trimStart();
      const at = Math.max(0, (event.target.selectionStart ?? raw.length) - (raw.length - value.length));

      if (raw !== value) placed.current = at;

      setText(value);
      setCaret(at);
      setNotice(null);
      cli.edited();
    },

    onKeyDown(event) {
      if (!commanding) return;

      const step = event.key === "ArrowDown" ? "next" : event.key === "ArrowUp" ? "previous" : null;

      if (step !== null) {
        if (cli.recall(step, moved)) {
          event.preventDefault();
          return;
        }

        const from = activeKey === undefined ? -1 : ring.indexOf(activeKey);
        const at = menuFocusTarget(step, from, ring.length);
        if (at === undefined) return;

        event.preventDefault();
        setChosen(ring[at] ?? null);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        enter(activeRow);
        return;
      }

      if (event.key === "Tab" && !event.shiftKey && cli.tab(activeRow)) event.preventDefault();
    },

    onSelect(event) {
      const at = event.currentTarget.selectionStart ?? event.currentTarget.value.length;
      if (at !== caret) setCaret(at);
    },

    choose(row) {
      enter(row);
      input.current?.focus();
    },

    point(row) {
      setChosen(row.id);
    },

    send() {
      if (composerMode(text) !== "command") return;

      // The button sends the line as it stands, whatever row is highlighted under it.
      cli.enter(undefined);
    },

    prefill(line) {
      // A line still on its way is the box's; nothing replaces it under the reader.
      if (cli.pending !== null) return;

      if (line === text) {
        // Nothing re-renders for the same line, so the caret is put back by hand.
        input.current?.setSelectionRange(line.length, line.length);
        setCaret(line.length);
      } else {
        place(line);
      }

      setNotice(null);
      cli.edited();
      input.current?.focus();
    },
  };
}
