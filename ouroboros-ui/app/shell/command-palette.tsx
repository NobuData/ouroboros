"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useSession } from "@/app/api/auth-client";
import { useTheme } from "@/app/theme-provider";
import { cx } from "@/app/ui/class-names";
import { EmptyState } from "@/app/ui/empty-state";

import { signOutOfSession } from "./actions";
import {
  type CommandAction,
  type CommandContext,
  groupCommandActions,
  runnableCommandActions,
} from "./command";
import { CONSOLE_SCOPE, isConsoleQuery } from "./console";
import {
  ConsoleCompletionOption,
  ConsoleEntryOption,
  ConsoleNamed,
  ConsoleReplySeat,
} from "./console-view";
import { requestLeave } from "./leave-guard";
import { menuFocusTarget } from "./menu";
import { permittedNavEntries } from "./nav";
import { ShellOverlay } from "./overlay";
import { useCommandActions } from "./use-command-actions";
import { type ConsoleRow, useConsole } from "./use-console";
import { useNavRegistry } from "./use-shell-nav";

// The shell's own sources, registering themselves the moment the palette is loaded. An import
// for its effect rather than for a value, which is what "sources register themselves" means —
// and the reason nothing below names a single source.
import "./command-sources";

// The sidebar's eleven entries, for the same reason: the navigation source reads the registry
// through the context, and a palette opened on a page that never rendered a sidebar would
// otherwise find it empty.
import "./nav-modules";

import "./shell.css";

/**
 * The ⌘K palette ([#79](https://github.com/NobuData/ouroboros/issues/79)) — the surface behind
 * the header's search pill.
 *
 * ```
 * ┌──────────────────────────────────────────────┐
 * │ ⌕ Search…                                    │  ← focus lands here
 * │ Navigation only for now — content search #93 │
 * │ NAVIGATION                                   │
 * │  ▸ Go to Dashboard                           │  ← ↑↓ walk these
 * │  ▸ Go to Issues                    soon      │  ← and skip these
 * │ ACTIONS                                      │
 * │  ▸ Toggle theme                    to dark   │
 * │  ▸ Sign out                                  │
 * └──────────────────────────────────────────────┘
 * ```
 *
 * **It names no source.** Everything it draws comes from `app/shell/command-registry.ts`
 * through `app/shell/use-command-actions.ts`, so #93's content search registers a source from
 * its own directory and this file does not change — the registry's whole justification, and
 * the same argument `app/shell/sidebar-nav.tsx` makes about the sidebar.
 *
 * ### It is a combobox, not a menu
 *
 * The ARIA pattern is a text box that owns a listbox: focus stays in the input the reader is
 * typing into, and the highlighted row is named by `aria-activedescendant` rather than
 * actually focused. That is what lets ↑↓ move the selection while every other key goes on
 * editing the query — a roving focus like the account menu's would take the arrows away from
 * the text box, where a reader who has typed a word reasonably expects them to move the caret.
 *
 * For the same reason **Home and End are left alone**: in a text box they belong to the text.
 * The ring is ↑↓ and Enter, and it walks only the rows that can be activated
 * (`runnableCommandActions`), because stopping on a row Enter would do nothing on teaches a
 * reader that the palette is broken.
 *
 * ### Command mode
 *
 * A box that starts with `/ouro ` is a command, not a search (BZ.5,
 * [#539](https://github.com/NobuData/ouroboros/issues/539)): the rows become the grammar's
 * commands and then the completions of whichever argument the caret is on, Enter runs the line
 * through the same dispatcher Slack's adapter calls, and the reply is drawn in a box under the
 * list while the palette stays open for the next one.
 *
 * ```
 * ┌──────────────────────────────────────────────┐
 * │ ⌕ /ouro queue #4▮                            │
 * │ /ouro queue <ticket> [workflow]  send an is… │  ← the command the line names
 * │  ▸ #485  OTA rollback flag                   │  ← ↑↓ walk these, Tab accepts one
 * │  ▸ #486  Telemetry backoff                   │
 * │ ┌──────────────────────────────────────────┐ │
 * │ │ Done /ouro status                        │ │  ← the last reply
 * │ │ 3 loops live · 12 queued · farm 4/5 …    │ │
 * │ └──────────────────────────────────────────┘ │
 * └──────────────────────────────────────────────┘
 * ```
 *
 * **It is the same listbox, the same highlight and the same ring.** `app/shell/use-console.ts`
 * supplies rows the way a command source does, and the handler below walks whichever rows are
 * showing with the one piece of arithmetic it always used. What the mode adds to the keyboard
 * is two keys the search has no use for — Tab, which completes, and ↑ on an empty line, which
 * recalls what was run before — and one exception to "the highlight always starts on a row":
 * a list of completions starts with none, so Enter on a finished line runs it instead of
 * accepting a suggestion nobody chose.
 *
 * ### What it does not own
 *
 * Everything a dialog owes the keyboard — the portal above the pane, the scroll lock, the
 * focus trap, Escape, focus back to the pill — is `ShellOverlay`'s, which is the point of that
 * component. The one thing this asks it for is where focus lands
 * (`ShellOverlayProps.initialFocus`), because a palette that opens with focus on its own frame
 * is one the reader has to press Tab to use.
 */

/** What the palette needs to be told. */
export interface CommandPaletteProps {
  /**
   * Called when it is dismissed — Escape, the backdrop, or an action having been run.
   *
   * The palette is mounted only while it is open (the pill renders it conditionally), so the
   * query resets by unmounting rather than by anything here remembering to clear it.
   */
  readonly onClose: () => void;
}

/**
 * The palette.
 *
 * @param props See {@link CommandPaletteProps}.
 * @returns The dialog and everything in it.
 */
export function CommandPalette({ onClose }: CommandPaletteProps) {
  const router = useRouter();
  const { resolved, setTheme } = useTheme();
  const { entries, capabilities } = useNavRegistry();

  const input = useRef<HTMLInputElement>(null);
  const base = useId();

  const [query, setQuery] = useState("");
  /**
   * Where the caret is in the box. Only command mode reads it — a completion is for the word
   * the caret is in, which need not be the last one — but it is tracked always, because the
   * keystroke that enters the mode is one it has to have seen.
   */
  const [caret, setCaret] = useState(0);
  /** Where the caret must be put once the box has been re-rendered with a line placed in it:
   *  React leaves it at the end, and a completion accepted mid-line belongs mid-line. */
  const placed = useRef<number | null>(null);
  /** Which row the arrows last moved to, held as an id — the list changes under it on every
   *  keystroke, and an index would then point at a different row than the one highlighted. */
  const [chosen, setChosen] = useState<string | null>(null);

  /** The entries this reader may see, from a snapshot the registry replaces only on a change. */
  const nav = useMemo(
    () => permittedNavEntries(entries, capabilities),
    [entries, capabilities],
  );

  /**
   * What the shell can do, handed to every source.
   *
   * Memoised on the four things that can actually change it, because it is a dependency of the
   * search effect in `useCommandActions` — an identity rebuilt every render would re-fetch
   * every render. `router` and `setTheme` are stable by their own contracts, and `nav` is the
   * memo above.
   */
  /**
   * Put a line in the box, as though it had been typed.
   *
   * Stable for the palette's lifetime, because it is on the context below and the context is a
   * dependency of the search effect.
   *
   * @param text The box's new content.
   * @param at Where the caret goes. The end of the line when omitted.
   */
  const place = useCallback((text: string, at: number = text.length): void => {
    placed.current = at;
    setQuery(text);
    setCaret(at);
  }, []);

  const context = useMemo<CommandContext>(
    () => ({
      nav,
      // Both departures go through the leave guard (#491): a command is a function call, not
      // a press on a link, so a page holding unsaved work has no other way to hear one coming.
      navigate: (route) => {
        requestLeave(() => {
          router.push(route);
        });
      },
      theme: resolved,
      setTheme,
      // Invoked rather than submitted, which is the one difference from the account menu's
      // sign-out: there is no form here to carry a press, and the action redirects, so what
      // follows it is a navigation the browser is already being given.
      signOut: () => {
        requestLeave(() => void signOutOfSession());
      },
      fill: place,
    }),
    [nav, router, resolved, setTheme, place],
  );

  /** Whether the box holds a command rather than a search — see *Command mode* above. */
  const commanding = isConsoleQuery(query);

  // An empty query in command mode, so no source is asked to search for "/ouro status": the
  // rows of that mode are the console's, and the ordinary ones are simply not drawn.
  const { actions, searching } = useCommandActions(commanding ? "" : query, context);

  const session = useSession();

  const mode = useConsole({
    active: commanding,
    query,
    caret,
    place,
    // Whose history ↑ recalls. Empty while the session is still being read, which the history
    // treats as nobody's: nothing is recalled and nothing is kept (`console-history.ts`).
    userId: session.data?.user.id ?? "",
    workspaceId: session.data?.session.activeOrganizationId ?? "",
  });

  const runnable = runnableCommandActions(actions);

  /**
   * The rows the arrows walk, by id — the one ring, whichever mode filled it.
   *
   * In command mode a row the caller may not run is **in** it, where a screen nobody has built
   * is not: `app/shell/console-view.tsx` says why.
   */
  const ring = commanding
    ? mode.rows.map((row) => row.id)
    : runnable.map((action) => action.id);

  /**
   * The highlighted row: the one the arrows chose, or — when the query has moved the list
   * out from under it — the best match, so Enter always has something to do. The exception is
   * a list of completions, which starts with no highlight at all (see *Command mode*).
   */
  const moved = chosen !== null && ring.includes(chosen);
  const activeKey = moved
    ? chosen
    : commanding && mode.stage === "arguments"
      ? undefined
      : ring[0];

  const active = commanding ? undefined : runnable.find((action) => action.id === activeKey);
  const activeRow = commanding ? mode.rows.find((row) => row.id === activeKey) : undefined;
  const activeId = activeKey === undefined ? undefined : optionId(base, activeKey);

  useLayoutEffect(() => {
    // After the render that put the line in the box, and before the browser paints it with
    // the caret at the end. A layout effect for that reason: the caret would otherwise be seen
    // to jump.
    if (placed.current === null) return;

    input.current?.setSelectionRange(placed.current, placed.current);
    placed.current = null;
  }, [query]);

  useEffect(() => {
    // Keep the highlighted row on screen when the arrows walk past the fold. `block: "nearest"`
    // so a row already visible is not scrolled to the middle for no reason.
    //
    // `getElementById` rather than a query inside the list: the row's id carries both a
    // `useId()` prefix and a source-prefixed action id, and neither is a valid CSS identifier
    // without escaping. The optional call is for jsdom, which implements no layout and
    // therefore no `scrollIntoView`.
    if (activeId === undefined) return;
    document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  /**
   * The palette's keyboard: the ring, and Enter.
   *
   * Escape is deliberately absent — it belongs to `ShellOverlay`, which is the only thing that
   * knows what closing means and where focus goes afterwards.
   *
   * @param event The key press, from the text box.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    const step =
      event.key === "ArrowDown" ? "next" : event.key === "ArrowUp" ? "previous" : null;

    if (step !== null) {
      // The history gets the arrow first, in command mode: ↑ on an empty line recalls what was
      // run, and while a recalled line is in the box both arrows walk the history.
      if (commanding && mode.recall(step, moved)) {
        event.preventDefault();
        return;
      }

      // The wrap is `app/shell/menu.ts`'s arithmetic — "one on from here, round the ends" is
      // one rule, and the account menu had it first. What differs between the two surfaces is
      // which keys mean it, and that is decided above rather than there.
      const from = activeKey === undefined ? -1 : ring.indexOf(activeKey);
      const at = menuFocusTarget(step, from, ring.length);
      if (at === undefined) return;

      event.preventDefault();
      setChosen(ring[at]);
      return;
    }

    if (commanding) {
      if (event.key === "Enter") {
        event.preventDefault();
        mode.enter(activeRow);
        return;
      }

      // Tab completes when there is something to complete, and is otherwise left to move
      // focus — which is how the keyboard reaches a reply's link. Shift+Tab is never taken.
      // Stopped as well as prevented, so the overlay's focus trap does not also act on a key
      // that has already been spent.
      if (event.key === "Tab" && !event.shiftKey && mode.tab(activeRow)) {
        event.preventDefault();
        event.stopPropagation();
      }

      return;
    }

    if (event.key === "Enter" && active !== undefined) {
      event.preventDefault();
      activate(active);
    }
  }

  /**
   * The box changed under the reader's hands.
   *
   * @param event The edit — typing, a paste, a deletion.
   */
  function onChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setQuery(event.target.value);
    setCaret(event.target.selectionStart ?? event.target.value.length);
    mode.edited();
  }

  /**
   * The caret may have moved without the text changing — an arrow, Home, a click, a drag.
   *
   * Heard three ways (`onSelect`, and the key and the pointer coming up) because no one of
   * them is raised for every way a caret moves in every browser, and reading the caret again
   * when it has not moved costs a state write React discards.
   *
   * @param event Whatever happened, in the box.
   */
  function onCaret(event: React.SyntheticEvent<HTMLInputElement>): void {
    setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
  }

  /**
   * A row of command mode was pressed: the same as Enter on it.
   *
   * @param row The row.
   */
  function chooseRow(row: ConsoleRow): void {
    mode.enter(row);
  }

  /**
   * Carry out an action and — unless its whole effect is inside the palette — close behind it.
   *
   * Closing here rather than in each `run` is what keeps a source from having to know it is
   * being rendered in a dialog: #93's issue rows navigate, and navigating out of a palette
   * that stayed open would leave a dialog over the screen it just opened.
   *
   * @param action The action to run.
   */
  function activate(action: CommandAction): void {
    if (action.run === undefined) return;
    action.run();
    // The one kind of action whose effect is inside the palette — see `stays`.
    if (action.stays !== true) onClose();
  }

  const groups = groupCommandActions(actions);

  return (
    <ShellOverlay open onClose={onClose} label="Search" initialFocus={input}>
      <div className="shell-palette">
        <div
          className={cx("shell-palette__box", mode.pending !== null && "shell-palette__box--pending")}
          aria-busy={mode.pending !== null ? true : undefined}
        >
          <Search className="shell-palette__search" size={16} aria-hidden />
          <input
            className="shell-palette__input"
            id={`${base}-query`}
            ref={input}
            type="text"
            // The combobox pattern's own four attributes. `aria-expanded` is always true
            // because the list is always rendered — an empty one still says something, which
            // is the point of the empty state below.
            role="combobox"
            aria-expanded
            aria-controls={`${base}-list`}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Search"
            aria-describedby={`${base}-scope ${base}-keys`}
            // A browser's own suggestion list over a palette's would be two dropdowns, and
            // only one of them would answer the arrow keys.
            autoComplete="off"
            spellCheck={false}
            placeholder="Search screens and commands…"
            value={query}
            // Held still while a line is out — read-only rather than disabled, because a
            // disabled box drops the focus the reader will want back the moment the reply
            // lands. The second Enter is refused by the console itself.
            readOnly={mode.pending !== null}
            onChange={onChange}
            onSelect={onCaret}
            onKeyUp={onCaret}
            onClick={onCaret}
            onKeyDown={onKeyDown}
          />
        </div>

        {/*
          What the palette can and cannot answer, said rather than discovered. MVP scope is
          navigation (the issue's own decision), so a reader typing an issue number gets a
          sentence naming what is coming instead of an empty list they have to interpret —
          the design system's honesty rule (§ 3.5).
        */}
        <p className="shell-palette__scope" id={`${base}-scope`}>
          {commanding
            ? CONSOLE_SCOPE
            : "Screens and commands. Searching issues, runs and the queue arrives with #93."}
        </p>

        {/* The command the line names, once it names one: what each position takes. */}
        {commanding && mode.named !== null && <ConsoleNamed entry={mode.named} />}

        <div
          className="shell-palette__list"
          id={`${base}-list`}
          role="listbox"
          aria-label={commanding ? mode.label : "Screens and commands"}
        >
          {commanding &&
            mode.rows.map((row) =>
              row.kind === "entry" ? (
                <ConsoleEntryOption
                  key={row.id}
                  entry={row.entry}
                  id={optionId(base, row.id)}
                  active={row.id === activeKey}
                  onChoose={() => chooseRow(row)}
                  onPoint={() => setChosen(row.id)}
                />
              ) : (
                <ConsoleCompletionOption
                  key={row.id}
                  completion={row.completion}
                  id={optionId(base, row.id)}
                  active={row.id === activeKey}
                  onChoose={() => chooseRow(row)}
                  onPoint={() => setChosen(row.id)}
                />
              ),
            )}

          {/*
            What command mode says in place of rows: the grammar is on its way or could not be
            read, no command matches, the completions came back empty or not at all. Said
            rather than left as an empty box, for the reason the empty state below gives.
          */}
          {commanding && mode.note !== null && (
            <p className="shell-console__note">{mode.note}</p>
          )}

          {!commanding && groups.map((group, index) => (
            <div
              key={group.name}
              className="shell-palette__group"
              role="group"
              aria-labelledby={`${base}-group-${index}`}
            >
              <p className="shell-palette__heading" id={`${base}-group-${index}`}>
                {group.name}
              </p>
              {group.actions.map((action) => (
                <Option
                  key={action.id}
                  action={action}
                  id={optionId(base, action.id)}
                  active={action.id === active?.id}
                  onChoose={() => activate(action)}
                  onPoint={() => setChosen(action.id)}
                />
              ))}
            </div>
          ))}

          {/*
            "Nothing matched" is only true once nothing is still coming, which is the whole
            reason `useCommandActions` reports a search in flight: a palette that drew this
            over an answer on its way would be telling a reader something it does not know.
          */}
          {!commanding && groups.length === 0 && !searching && (
            <EmptyState
              className="shell-palette__empty"
              variant="flush"
              note={`Nothing here matches “${query.trim()}”. Try a screen name, or press Esc.`}
            />
          )}

          {/*
            A source is out over the wire. `role="status"` because it appears in answer to
            typing and disappears without one — somebody reading the screen with a screen
            reader is the reader most likely to be waiting without knowing it.
          */}
          {!commanding && searching && (
            <p className="shell-palette__searching" role="status">
              Searching…
            </p>
          )}
        </div>

        {/*
          The bindings, on the surface that uses them. Described-by the text box, so they are
          announced once when focus lands rather than found by a reader who thought to look.
        */}
        {/*
          The reply's seat, between the list and the bindings. Mounted for as long as the mode
          is on rather than when there is a reply: see `ConsoleReplySeat`.
        */}
        {commanding && (
          <ConsoleReplySeat
            pending={mode.pending}
            reply={mode.reply}
            onFill={(line) => {
              // Fills and hands the box back; running it is still the reader's Enter.
              place(line);
              input.current?.focus();
            }}
            onFollow={onClose}
          />
        )}

        <p className="shell-palette__keys" id={`${base}-keys`}>
          <kbd className="shell-palette__key">↑</kbd>
          <kbd className="shell-palette__key">↓</kbd> to move
          {commanding && (
            <>
              <span className="shell-palette__gap" aria-hidden>
                ·
              </span>
              <kbd className="shell-palette__key">Tab</kbd> to complete
            </>
          )}
          <span className="shell-palette__gap" aria-hidden>
            ·
          </span>
          <kbd className="shell-palette__key">↵</kbd> to run
          <span className="shell-palette__gap" aria-hidden>
            ·
          </span>
          <kbd className="shell-palette__key">Esc</kbd> to close
        </p>
      </div>
    </ShellOverlay>
  );
}

/**
 * The DOM id of one row.
 *
 * Derived from the action's own id rather than from its position, so `aria-activedescendant`
 * keeps naming the same row when the list around it is re-ranked by the next keystroke.
 *
 * @param base The `useId()` prefix, which is what keeps two palettes on one page apart.
 * @param action The action's id.
 * @returns The element id.
 */
function optionId(base: string, action: string): string {
  return `${base}-option-${action}`;
}

/** What one row needs to be told. */
interface OptionProps {
  /** The action to draw. */
  readonly action: CommandAction;
  /** Its element id, which `aria-activedescendant` points at. */
  readonly id: string;
  /** Whether it is the highlighted row. */
  readonly active: boolean;
  /** Called when it is chosen — a press, or Enter on the highlight. */
  readonly onChoose: () => void;
  /** Called when the pointer moves onto it, so hovering and the arrows agree about which row
   *  Enter would run. */
  readonly onPoint: () => void;
}

/**
 * One row of the palette.
 *
 * A `div role="option"` rather than a button, which is the listbox pattern: an option is not
 * separately focusable, and a button here would put every row in the Tab order of a dialog the
 * reader is meant to drive with the arrows. The press is caught on `mousedown` **prevented**
 * and acted on in `click`, so a pointer press does not pull focus out of the text box on its
 * way to activating the row.
 *
 * An unavailable row draws its reason where a runnable one draws its hint, and carries
 * `aria-disabled` — the house rule (§ 3.5): a row that cannot be acted on is labelled with
 * why, never removed and never silently inert.
 *
 * @param props See {@link OptionProps}.
 * @returns The row.
 */
function Option({ action, id, active, onChoose, onPoint }: OptionProps) {
  const Icon = action.icon;
  const runnable = action.run !== undefined;
  const detail = runnable ? action.hint : action.unavailable;

  return (
    <div
      className={cx(
        "shell-palette__option",
        active && "shell-palette__option--active",
        !runnable && "shell-palette__option--soon",
      )}
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={runnable ? undefined : true}
      title={runnable ? undefined : `${action.label} — ${action.unavailable}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={runnable ? onChoose : undefined}
      onMouseEnter={runnable ? onPoint : undefined}
    >
      {Icon !== undefined && <Icon className="shell-palette__icon" size={16} aria-hidden />}
      <span className="shell-palette__label">{action.label}</span>
      {detail !== undefined && <span className="shell-palette__detail">{detail}</span>}
    </div>
  );
}
