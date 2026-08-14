/**
 * The ARIA menu pattern's keyboard, as a decision rather than as a `switch` inside a
 * component ([#77](https://github.com/NobuData/ouroboros/issues/77)).
 *
 * Two menus hang from the shell's header and they are not the same component: the account
 * menu (`app/shell/user-menu.tsx`, CP.3) opens from the avatar, and the tenant chip
 * (`app/shell/tenant-chip.tsx`, H.1) opens from the workspace. What they share is the
 * *keyboard* — a roving focus through whatever is currently rendered, Escape closing the
 * innermost thing that is open, Right and Left through a submenu, Tab dismissing — and a
 * second copy of that is a second copy to keep correct. `app/shell/focus-trap.ts` is the
 * same argument for the same shell, one layer up.
 *
 * **Framework-free**, in that file's way: the event is taken as the one field the logic
 * reads, which a DOM `KeyboardEvent` and a React synthetic event both satisfy, so neither
 * caller converts anything and this module imports nothing. The one function that touches
 * the DOM ({@link menuItems}) takes the element it reads.
 *
 * ### Why the items are read from the DOM and not held in a list
 *
 * The roving focus has to follow *what is rendered*, which is what makes a submenu's choices
 * part of the same Up/Down walk while it is open and absent from it the moment it closes.
 * A ref array would be a second list to keep in step with the first, and the first is the
 * document.
 */

/**
 * What the pattern counts as an item: the two roles the shell's menus draw.
 *
 * `menuitemcheckbox` is absent because nothing in the shell draws one; adding it here is
 * how a menu that grows one joins the walk, and is the only edit that would be needed.
 */
export const MENU_ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"]';

/**
 * A menu's focusable items, in document order.
 *
 * @param panel The menu or submenu to read, or `null` when it is closed.
 * @returns The items, or an empty list when there is no menu — never `null`, so a caller
 *   walks the result without asking whether there was one.
 */
export function menuItems(panel: HTMLElement | null): HTMLElement[] {
  return Array.from(panel?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? []);
}

/** The part of a key press this module reads — a DOM event and a React one both satisfy it. */
export interface MenuKeyEvent {
  /** Which key. `KeyboardEvent.key`, so `"ArrowDown"` rather than a code. */
  readonly key: string;
}

/** Where focus is sitting when the key is pressed. */
export interface MenuFocus {
  /** Whether focus is inside an open submenu rather than in the menu's own column. */
  readonly inSubmenu: boolean;
  /** Whether the focused item is one that *opens* a submenu — what Right acts on. */
  readonly onBranch: boolean;
}

/** What a key press means to an open menu. */
export type MenuAction =
  /** Nothing this menu handles. The browser's own response stands. */
  | "none"
  /** Close the whole menu and put focus back on the control that opened it. */
  | "close"
  /** Close only the open submenu, landing on the item that opened it. */
  | "close-submenu"
  /** Open the submenu the focused item owns, and move focus into it. */
  | "open-submenu"
  /** Move the roving focus one item on. */
  | "next"
  /** Move it one item back. */
  | "previous"
  /** Jump to the first item. */
  | "first"
  /** Jump to the last item. */
  | "last"
  /** Close without restoring focus — the browser is already moving it. */
  | "dismiss";

/**
 * What an open menu should do about a key press.
 *
 * **Escape is innermost-first**, which is the one judgement here: inside a submenu it closes
 * the submenu, because closing the whole menu would throw away a choice still being made.
 * Everything else is the ARIA menu pattern read literally — Right opens a submenu from the
 * item that owns one and does nothing anywhere else, Left leaves one and does nothing
 * outside one, and Tab is a dismissal rather than a movement.
 *
 * @param event The key press.
 * @param focus Where focus is sitting — see {@link MenuFocus}.
 * @returns What the menu should do. `"none"` for every key the menu does not claim, which
 *   includes every printable character: a menu that swallowed those would be a menu a
 *   browser's own type-ahead could not reach into.
 */
export function menuKeyAction(event: MenuKeyEvent, focus: MenuFocus): MenuAction {
  switch (event.key) {
    case "Escape":
      return focus.inSubmenu ? "close-submenu" : "close";
    case "ArrowRight":
      return focus.onBranch && !focus.inSubmenu ? "open-submenu" : "none";
    case "ArrowLeft":
      return focus.inSubmenu ? "close-submenu" : "none";
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "previous";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "Tab":
      return "dismiss";
    default:
      return "none";
  }
}

/**
 * Whether the browser's own response to the key must be suppressed.
 *
 * True for everything the menu acted on, and **false for `"dismiss"`**, which is the whole
 * reason this is a function rather than `action !== "none"`: Tab closes the menu *and* lets
 * the browser move focus, because the move the browser is about to make is the right one.
 * Preventing it would close the menu and leave focus on an element that no longer exists.
 *
 * @param action What {@link menuKeyAction} decided.
 * @returns Whether the caller should call `preventDefault()`.
 */
export function menuConsumesKey(action: MenuAction): boolean {
  return action !== "none" && action !== "dismiss";
}

/**
 * Which item the roving focus lands on.
 *
 * @param action What {@link menuKeyAction} decided.
 * @param at Where focus is now, as an index into the items — `-1` when focus is not on one
 *   of them at all, which is what `Array.indexOf` answers.
 * @param count How many items there are.
 * @returns The index to focus, or `undefined` when the action does not move focus or there
 *   is nothing to move it to. The walk **wraps** at both ends, and from nowhere at all Down
 *   lands on the first item and Up on the last — the pattern's own answer, and the only one
 *   that does not depend on how far a negative index happens to be from the end.
 */
export function menuFocusTarget(
  action: MenuAction,
  at: number,
  count: number,
): number | undefined {
  if (count === 0) return undefined;

  switch (action) {
    case "next":
      return at < 0 ? 0 : (at + 1) % count;
    case "previous":
      return at < 0 ? count - 1 : (at - 1 + count) % count;
    case "first":
      return 0;
    case "last":
      return count - 1;
    default:
      return undefined;
  }
}
