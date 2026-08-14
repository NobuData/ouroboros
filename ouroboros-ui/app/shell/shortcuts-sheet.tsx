"use client";

import { useClientValue } from "./client-value";
import { ShellOverlay } from "./overlay";
import { MAC_HINT, shortcutHint } from "./search-pill";

/**
 * The keyboard-shortcuts sheet the account menu opens
 * ([#645](https://github.com/NobuData/ouroboros/issues/645)) — § 1.1's last link, as a
 * dialog over the pane rather than a page, because a reader asking "what can I press?" is
 * in the middle of something the answer should not navigate them away from.
 *
 * Everything a sheet owes the keyboard — the portal above the pane, the scroll lock, the
 * focus trap, Escape, focus restoration — is `ShellOverlay`'s, which is the point of that
 * component: this file is only the content, exactly as the search pill's panel is.
 *
 * **It lists what exists, and nothing else.** Every row below is a binding something in
 * this product actually handles today — the palette shortcut (`search-pill.tsx`), the
 * palette's own ring and Enter (`command-palette.tsx`, added by
 * [#79](https://github.com/NobuData/ouroboros/issues/79) in the change that wired them),
 * the two roving rings (`sidebar-nav.tsx`, `user-menu.tsx`) and the dismissals. The design
 * system's honesty rule (§ 3.5) reads the same for documentation as for controls: a sheet
 * promising bindings nobody wired would be teaching readers presses that do nothing, which
 * is worse than a shorter sheet. New bindings add their row here in the change that wires
 * them.
 *
 * The search row's key cap is the platform's own spelling, through the same
 * `shortcutHint()` the pill shows — one platform question, one answer, two places it is
 * drawn.
 *
 * @param props.open Whether the sheet is showing.
 * @param props.onClose Called on Escape, the backdrop, or the close button. Focus
 *   restoration is the caller's concern when the opener has since unmounted — the menu
 *   item that opens this closes its menu behind itself.
 * @returns The sheet, while open; nothing otherwise (`ShellOverlay` unmounts, never hides).
 */
export function ShortcutsSheet({
  open,
  onClose,
}: Readonly<{ open: boolean; onClose: () => void }>) {
  const search = useClientValue(shortcutHint, MAC_HINT);

  /** The bindings, grouped the way a reader looks for them: where am I, then what. */
  const groups: readonly {
    readonly name: string;
    readonly rows: readonly { readonly keys: readonly string[]; readonly does: string }[];
  }[] = [
    {
      name: "Anywhere",
      rows: [
        { keys: [search], does: "Open search" },
        { keys: ["Esc"], does: "Close a menu, drawer or dialog" },
      ],
    },
    {
      name: "Search palette",
      rows: [
        { keys: ["↑", "↓"], does: "Move between actions, wrapping at the ends" },
        { keys: ["↵"], does: "Run the highlighted action" },
      ],
    },
    {
      name: "Sidebar",
      rows: [
        { keys: ["↑", "↓"], does: "Move between entries, wrapping at the ends" },
        { keys: ["Home", "End"], does: "Jump to the first or last entry" },
        { keys: ["Enter"], does: "Open the entry" },
      ],
    },
    {
      name: "Account menu",
      rows: [
        { keys: ["↑", "↓"], does: "Move between items" },
        { keys: ["→", "←"], does: "Enter or leave the workspace submenu" },
        { keys: ["Enter"], does: "Activate the item" },
        { keys: ["Tab"], does: "Leave the menu" },
      ],
    },
  ];

  return (
    <ShellOverlay open={open} onClose={onClose} label="Keyboard shortcuts">
      <h2 className="shell-overlay__title">Keyboard shortcuts</h2>

      {groups.map((group) => (
        <section key={group.name} className="shell-shortcuts__group">
          <h3 className="shell-shortcuts__heading">{group.name}</h3>
          {/*
            A list of definitions rather than a table: two columns with no relation beyond
            "this does that" gain nothing from table semantics, and a <dl> reads out as
            exactly the pairing it is.
          */}
          <dl className="shell-shortcuts">
            {group.rows.map((row) => (
              <div key={row.does} className="shell-shortcuts__row">
                <dt className="shell-shortcuts__keys">
                  {row.keys.map((key) => (
                    <kbd key={key} className="shell-shortcuts__key">
                      {key}
                    </kbd>
                  ))}
                </dt>
                <dd className="shell-shortcuts__does">{row.does}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <button type="button" className="shell-overlay__close" onClick={onClose}>
        Close
      </button>
    </ShellOverlay>
  );
}
