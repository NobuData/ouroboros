"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

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
import { menuFocusTarget } from "./menu";
import { permittedNavEntries } from "./nav";
import { ShellOverlay } from "./overlay";
import { useCommandActions } from "./use-command-actions";
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
  const context = useMemo<CommandContext>(
    () => ({
      nav,
      navigate: (route) => router.push(route),
      theme: resolved,
      setTheme,
      // Invoked rather than submitted, which is the one difference from the account menu's
      // sign-out: there is no form here to carry a press, and the action redirects, so what
      // follows it is a navigation the browser is already being given.
      signOut: () => void signOutOfSession(),
    }),
    [nav, router, resolved, setTheme],
  );

  const { actions, searching } = useCommandActions(query, context);

  const runnable = runnableCommandActions(actions);
  /** The highlighted row: the one the arrows chose, or — when the query has moved the list
   *  out from under it — the best match, so Enter always has something to do. */
  const active = runnable.find((action) => action.id === chosen) ?? runnable[0];
  const activeId = active === undefined ? undefined : optionId(base, active.id);

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
      // The wrap is `app/shell/menu.ts`'s arithmetic — "one on from here, round the ends" is
      // one rule, and the account menu had it first. What differs between the two surfaces is
      // which keys mean it, and that is decided above rather than there.
      const from = active === undefined ? -1 : runnable.indexOf(active);
      const at = menuFocusTarget(step, from, runnable.length);
      if (at === undefined) return;

      event.preventDefault();
      setChosen(runnable[at].id);
      return;
    }

    if (event.key === "Enter" && active !== undefined) {
      event.preventDefault();
      activate(active);
    }
  }

  /**
   * Carry out an action and close behind it.
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
    onClose();
  }

  const groups = groupCommandActions(actions);

  return (
    <ShellOverlay open onClose={onClose} label="Search" initialFocus={input}>
      <div className="shell-palette">
        <div className="shell-palette__box">
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
            onChange={(event) => setQuery(event.target.value)}
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
          Screens and commands. Searching issues, runs and the queue arrives with #93.
        </p>

        <div
          className="shell-palette__list"
          id={`${base}-list`}
          role="listbox"
          aria-label="Screens and commands"
        >
          {groups.map((group, index) => (
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
          {groups.length === 0 && !searching && (
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
          {searching && (
            <p className="shell-palette__searching" role="status">
              Searching…
            </p>
          )}
        </div>

        {/*
          The bindings, on the surface that uses them. Described-by the text box, so they are
          announced once when focus lands rather than found by a reader who thought to look.
        */}
        <p className="shell-palette__keys" id={`${base}-keys`}>
          <kbd className="shell-palette__key">↑</kbd>
          <kbd className="shell-palette__key">↓</kbd> to move
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
