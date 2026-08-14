import { describe, expect, it } from "vitest";

import {
  MENU_ITEM_SELECTOR,
  type MenuAction,
  menuConsumesKey,
  menuFocusTarget,
  menuItems,
  menuKeyAction,
} from "@/app/shell/menu";

/**
 * The ARIA menu pattern's keyboard, as the two header menus share it
 * ([#77](https://github.com/NobuData/ouroboros/issues/77)).
 *
 * The behaviour is asserted end to end in `user-menu.test.tsx` and `tenant-chip.test.tsx` —
 * keys pressed against a rendered menu, focus checked where it landed. What is here is the
 * half those cannot reach cheaply: the *decisions*, named one at a time, including the ones
 * that only happen in a state a rendered menu is hard to get into (focus outside the ring,
 * an empty menu, a key nobody claimed).
 *
 * The module is framework-free, so none of this needs React — only {@link menuItems} touches
 * a DOM, and jsdom is the environment either way.
 */

/** Focus in the menu's own column, not on anything that opens a submenu. */
const IN_MENU = { inSubmenu: false, onBranch: false };

/** Focus on an item that owns a submenu. */
const ON_BRANCH = { inSubmenu: false, onBranch: true };

/** Focus inside an open submenu. */
const IN_SUBMENU = { inSubmenu: true, onBranch: false };

describe("what a key means to an open menu", () => {
  it("closes the whole menu on Escape at the top level", () => {
    expect(menuKeyAction({ key: "Escape" }, IN_MENU)).toBe("close");
  });

  it("closes only the submenu on Escape inside one", () => {
    // Innermost first. Closing the whole menu would throw away a choice still being made,
    // and is the one judgement this module makes rather than transcribes.
    expect(menuKeyAction({ key: "Escape" }, IN_SUBMENU)).toBe("close-submenu");
  });

  it("opens a submenu with Right, and only from the item that owns one", () => {
    expect(menuKeyAction({ key: "ArrowRight" }, ON_BRANCH)).toBe("open-submenu");
    expect(menuKeyAction({ key: "ArrowRight" }, IN_MENU)).toBe("none");
  });

  it("does not re-open a submenu with Right from inside it", () => {
    // A branch item stays focusable while its submenu is open; Right pressed *in* the
    // submenu is not a request to open it again.
    expect(menuKeyAction({ key: "ArrowRight" }, { inSubmenu: true, onBranch: true })).toBe("none");
  });

  it("leaves a submenu with Left, and does nothing with Left outside one", () => {
    expect(menuKeyAction({ key: "ArrowLeft" }, IN_SUBMENU)).toBe("close-submenu");
    expect(menuKeyAction({ key: "ArrowLeft" }, ON_BRANCH)).toBe("none");
  });

  it("walks with the arrows and jumps with Home and End", () => {
    expect(menuKeyAction({ key: "ArrowDown" }, IN_MENU)).toBe("next");
    expect(menuKeyAction({ key: "ArrowUp" }, IN_MENU)).toBe("previous");
    expect(menuKeyAction({ key: "Home" }, IN_MENU)).toBe("first");
    expect(menuKeyAction({ key: "End" }, IN_MENU)).toBe("last");
  });

  it("reads Tab as a dismissal rather than as a movement", () => {
    expect(menuKeyAction({ key: "Tab" }, IN_MENU)).toBe("dismiss");
  });

  it("claims nothing else, including every printable character", () => {
    // A menu that swallowed these would be a menu the browser's own type-ahead cannot
    // reach into.
    for (const key of ["a", "Z", " ", "Enter", "F5", "PageDown"]) {
      expect(menuKeyAction({ key }, IN_MENU)).toBe("none");
    }
  });
});

describe("which presses the browser must not also act on", () => {
  it("suppresses every key the menu acted on", () => {
    const acted: MenuAction[] = [
      "close",
      "close-submenu",
      "open-submenu",
      "next",
      "previous",
      "first",
      "last",
    ];

    for (const action of acted) expect(menuConsumesKey(action)).toBe(true);
  });

  it("lets Tab through, because the move it is about to make is the right one", () => {
    // The whole reason this is a function rather than `action !== "none"`: preventing Tab
    // would close the menu and leave focus on an element that no longer exists.
    expect(menuConsumesKey("dismiss")).toBe(false);
    expect(menuConsumesKey("none")).toBe(false);
  });
});

describe("where the roving focus lands", () => {
  it("steps forward and back", () => {
    expect(menuFocusTarget("next", 0, 4)).toBe(1);
    expect(menuFocusTarget("previous", 2, 4)).toBe(1);
  });

  it("wraps at both ends", () => {
    expect(menuFocusTarget("next", 3, 4)).toBe(0);
    expect(menuFocusTarget("previous", 0, 4)).toBe(3);
  });

  it("jumps to either end", () => {
    expect(menuFocusTarget("first", 2, 4)).toBe(0);
    expect(menuFocusTarget("last", 2, 4)).toBe(3);
  });

  it("enters from nowhere at the end the key is travelling from", () => {
    // `-1` is what `indexOf` answers when focus is not on an item at all. Down should land
    // on the first item and Up on the last, rather than wherever the arithmetic happens to
    // put a negative index.
    expect(menuFocusTarget("next", -1, 4)).toBe(0);
    expect(menuFocusTarget("previous", -1, 4)).toBe(3);
  });

  it("has nowhere to go in an empty menu", () => {
    for (const action of ["next", "previous", "first", "last"] as const) {
      expect(menuFocusTarget(action, -1, 0)).toBeUndefined();
    }
  });

  it("moves nothing for an action that is not a movement", () => {
    for (const action of ["close", "close-submenu", "open-submenu", "dismiss", "none"] as const) {
      expect(menuFocusTarget(action, 0, 4)).toBeUndefined();
    }
  });
});

describe("reading a menu's items", () => {
  /**
   * A panel holding one of each shape a menu is built from.
   *
   * @returns The element, detached — `querySelectorAll` does not need it in the document.
   */
  function panel(): HTMLElement {
    const element = document.createElement("div");
    element.innerHTML = `
      <button role="menuitem" id="one"></button>
      <span>furniture</span>
      <div role="none"><button role="menuitemradio" id="two"></button></div>
      <p id="note">still loading</p>
      <button role="menuitem" id="three"></button>
    `;
    return element;
  }

  it("finds both item roles, at any depth, in document order", () => {
    // Depth matters: a submenu's choices are nested inside a `role="none"` wrapper and are
    // part of the same walk while it is open.
    expect(menuItems(panel()).map((item) => item.id)).toEqual(["one", "two", "three"]);
  });

  it("passes over everything that is not an item", () => {
    const found = menuItems(panel());

    expect(found.map((item) => item.id)).not.toContain("note");
  });

  it("answers a list rather than nothing for a menu that is closed", () => {
    // The callers walk the result without asking whether there was one.
    expect(menuItems(null)).toEqual([]);
  });

  it("selects on the roles the pattern defines, not on the markup", () => {
    expect(MENU_ITEM_SELECTOR).toContain('[role="menuitem"]');
    expect(MENU_ITEM_SELECTOR).toContain('[role="menuitemradio"]');
  });
});
