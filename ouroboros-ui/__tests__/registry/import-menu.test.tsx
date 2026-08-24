import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ImportMenu } from "@/app/registry/import-menu";
import {
  IMPORT_ITEM_REASON,
  IMPORT_LABEL,
  IMPORT_MENU_LABEL,
  MEMBER_REASON,
  NO_PROVIDERS_REASON,
  importSources,
  type ImportState,
} from "@/app/registry/view";

import { seededProviders } from "../helpers/models";
import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * Mockup 21's **Import from provider ▾** (#591) — the dropdown the drawing implies and the
 * two states it does not draw.
 *
 * Three properties are worth a suite of their own, and each of them is a way this control
 * could be wrong while looking right:
 *
 * 1. **A blocked control says why.** The mockup draws one state — a ghost button with a caret
 *    — and a fresh workspace never sees it. What a reader meets instead is a control that
 *    cannot act, and the whole of § 3.5 is that such a control is labelled rather than dead.
 * 2. **A row that cannot act is still reachable.** `aria-disabled`, never `disabled`: a
 *    `disabled` row leaves the tab order and takes its own tooltip with it, so the keyboard
 *    reader who most needs the explanation is the one who could never reach it.
 * 3. **The keyboard is the ARIA menu pattern.** It is `app/shell/menu.ts`'s and has its own
 *    unit suite; what is asserted here is that this menu is *wired* to it — focus into the
 *    menu on open, a roving walk that wraps, Escape closing and returning focus.
 *
 * Events are `fireEvent`'s, as the shell's own menu suite drives its menu: this module has no
 * `user-event` dependency, and what is being asserted is the wiring rather than a browser's
 * dispatch order.
 */

/** The state for a workspace with the seeded five connections, read by an admin. */
const READY: ImportState = { kind: "ready", sources: importSources(seededProviders()) };

/** The trigger, by its accessible name — which is the label without the mockup's caret. */
function trigger(): HTMLElement {
  return screen.getByRole("button", { name: IMPORT_LABEL });
}

/**
 * Open the menu.
 *
 * @returns The trigger, the menu, and its rows — everything a case then asserts against.
 */
function open(): { trigger: HTMLElement; menu: HTMLElement; rows: HTMLElement[] } {
  const control = trigger();

  fireEvent.click(control);

  const menu = screen.getByRole("menu", { name: IMPORT_MENU_LABEL });

  return { trigger: control, menu, rows: within(menu).getAllByRole("menuitem") };
}

describe("when there is something to import from", () => {
  it("draws the mockup's ghost action, with the caret out of its accessible name", () => {
    // A screen reader announcing "Import from provider down-pointing triangle, menu" would be
    // reading the decoration twice, once badly.
    render(<ImportMenu state={READY} />);

    expect(trigger()).toHaveClass("ou-btn--ghost");
    expect(trigger()).toHaveAccessibleName(IMPORT_LABEL);
    expect(trigger().querySelector(".registry-import__caret")).toHaveAttribute("aria-hidden");
  });

  it("says it owns a menu, and that the menu is shut", () => {
    render(<ImportMenu state={READY} />);

    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("lists every connected provider when opened, in the order it was given", () => {
    render(<ImportMenu state={READY} />);

    const { rows } = open();

    expect(rows.map((row) => row.textContent)).toEqual([
      "Anthropic Claude",
      "Cursor",
      "GitHub Copilot",
      "OpenAI-compatible · local vLLM",
      "Ollama · workstation",
    ]);
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
  });

  it("names the menu, and points the trigger at it", () => {
    render(<ImportMenu state={READY} />);

    const { menu } = open();

    expect(trigger()).toHaveAttribute("aria-controls", menu.getAttribute("id"));
  });

  it("closes again on a second press", () => {
    render(<ImportMenu state={READY} />);
    open();

    fireEvent.click(trigger());

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes when the pointer goes somewhere else", () => {
    render(
      <>
        <ImportMenu state={READY} />
        <button type="button">elsewhere</button>
      </>,
    );
    open();

    fireEvent.pointerDown(screen.getByRole("button", { name: "elsewhere" }));

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays open when the pointer lands inside it", () => {
    render(<ImportMenu state={READY} />);
    const { menu } = open();

    fireEvent.pointerDown(menu);

    expect(screen.getByRole("menu", { name: IMPORT_MENU_LABEL })).toBeInTheDocument();
  });
});

describe("a row that cannot act yet", () => {
  it("is inert through aria-disabled rather than through disabled", () => {
    // The house rule (`app/ui/button.tsx`), applied inside the menu: the row stays in the tab
    // order, so the reader who needs the tooltip can reach it.
    render(<ImportMenu state={READY} />);

    for (const row of open().rows) {
      expect(row, row.textContent ?? "").toHaveAttribute("aria-disabled", "true");
      expect((row as HTMLButtonElement).disabled, row.textContent ?? "").toBe(false);
    }
  });

  it("says which issue wires it", () => {
    // The menu is this ticket's and the wizard behind it is CI.4's, so the list is real and
    // each row says plainly that the import itself is not built.
    render(<ImportMenu state={READY} />);

    for (const row of open().rows) {
      expect(row, row.textContent ?? "").toHaveAttribute("title", IMPORT_ITEM_REASON);
    }

    expect(IMPORT_ITEM_REASON).toMatch(/#594/);
  });

  it("is a button rather than a link, because choosing one opens a dialog", () => {
    // The distinction `app/ui/button.tsx` draws: a control that acts is a button, a control
    // that navigates is a link. CI.4's wizard is a dialog, so these never become anchors.
    render(<ImportMenu state={READY} />);

    for (const row of open().rows) {
      expect(row.tagName, row.textContent ?? "").toBe("BUTTON");
      expect(row.hasAttribute("href"), row.textContent ?? "").toBe(false);
    }
  });
});

describe("the keyboard", () => {
  it("puts focus on the first row when the menu opens", () => {
    // The ARIA menu pattern, and also the only way a keyboard reader learns it opened.
    render(<ImportMenu state={READY} />);

    const { rows } = open();

    expect(document.activeElement).toBe(rows[0]);
  });

  it("walks the rows with the arrow keys, wrapping at both ends", () => {
    render(<ImportMenu state={READY} />);
    const { menu, rows } = open();

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);

    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[0]);

    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[rows.length - 1]);
  });

  it("jumps to the ends with Home and End", () => {
    render(<ImportMenu state={READY} />);
    const { menu, rows } = open();

    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(rows[rows.length - 1]);

    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(rows[0]);
  });

  it("closes on Escape and gives focus back to the trigger", () => {
    // Without this the keyboard would be left on the document body, which is the same as
    // being nowhere.
    render(<ImportMenu state={READY} />);
    const { menu } = open();

    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes when the keyboard tabs out, without fighting the browser for focus", () => {
    // `menuConsumesKey` is what says so: every other key the menu claims is prevented, and
    // Tab is not — the move the browser is about to make is the right one.
    render(<ImportMenu state={READY} />);
    const { menu } = open();

    fireEvent.keyDown(menu, { key: "Tab" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).not.toBe(trigger());
  });

  it("leaves a printable key to the browser's own type-ahead", () => {
    render(<ImportMenu state={READY} />);
    const { menu, rows } = open();

    fireEvent.keyDown(menu, { key: "a" });

    expect(screen.getByRole("menu", { name: IMPORT_MENU_LABEL })).toBeInTheDocument();
    expect(document.activeElement).toBe(rows[0]);
  });
});

describe("when there is nothing to import from", () => {
  /** The blocked state a fresh workspace's admin meets. */
  const EMPTY: ImportState = { kind: "blocked", reason: NO_PROVIDERS_REASON, connect: true };

  it("is inert, and says why, and promises no menu it does not have", () => {
    // A caret promises a list. There is not one, so there is no caret.
    render(<ImportMenu state={EMPTY} />);

    expect(trigger()).toHaveAttribute("aria-disabled", "true");
    expect(trigger()).toHaveAttribute("title", NO_PROVIDERS_REASON);
    expect(trigger()).not.toHaveAttribute("aria-haspopup");
    expect(trigger().querySelector(".registry-import__caret")).toBeNull();

    fireEvent.click(trigger());

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("carries whichever blocked reason it was given", () => {
    // The control renders the sentence; deciding which of the three it is belongs to
    // `importState`, which has its own suite.
    render(<ImportMenu state={{ kind: "blocked", reason: MEMBER_REASON, connect: false }} />);

    expect(trigger()).toHaveAttribute("title", MEMBER_REASON);
  });

  it("stays reachable by keyboard, so its explanation is reachable too", () => {
    render(<ImportMenu state={EMPTY} />);

    expect((trigger() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the control in the %s palette", (palette) => {
    renderInPalette(palette, <ImportMenu state={READY} />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(trigger()).toBeInTheDocument();
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(<ImportMenu state={READY} />);

    expect(light).toBe(dark);
  });
});
