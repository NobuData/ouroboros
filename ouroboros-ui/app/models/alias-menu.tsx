"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { menuConsumesKey, menuFocusTarget, menuItems, menuKeyAction } from "@/app/shell/menu";
import { cx } from "@/app/ui";

import { EMPTY_REGISTRY, RESOLVES } from "./chain";
import type { AliasCell } from "./matrix";
import { useRouteEditor } from "./route-editor";
import { TARGETS_LOADING } from "./rules";

import "./models.css";

/**
 * The alias swap menu ([#202](https://github.com/NobuData/ouroboros/issues/202)) — the
 * registry list, each row previewing what the alias resolves to, so a swap is never a blind
 * pick.
 *
 * One component for two triggers: a hop's pill opens it to *swap* that hop, and **+ Add hop**
 * opens it to append one. The list, the read behind it and the keyboard are the same either
 * way; what differs is the trigger, which the caller draws, and which row is *current*, which
 * only a swap has.
 *
 * ### Every row is `alias → resolves: model · provider`
 *
 * The ticket's own line. The resolution is the registry's — `app/models/rules.ts`'s
 * `ruleTarget` composes it from `GET /api/v1/routing/aliases` with the same function the
 * matrix draws its cells with — so the preview a reader picks from and the line the matrix
 * prints after the swap are one string. An unbound alias is offered and says *no provider*
 * where the provider would be, which is the honest preview of a hop that resolution will drop
 * with a stated reason.
 *
 * ### The keyboard is `app/shell/menu.ts`'s
 *
 * The ARIA menu pattern as decisions — roving focus that wraps, Escape closing and restoring
 * focus, Tab dismissing without stealing the browser's own move — written once for the
 * shell's menus and reused by the registry's import menu. This is the fourth menu on it, and
 * the wiring here is the same as `app/registry/import-menu.tsx`'s: open state, the
 * outside-press dismissal, focus into the panel on open and back on the trigger on close.
 *
 * The rows are `menuitemradio` rather than `menuitem`, because a swap *is* a choice among
 * alternatives with one current — `aria-checked` on the hop's present alias is how a reader
 * hears which row they are already on.
 */

/** What the caller's trigger has to wear. Spread onto whichever element draws it. */
export interface AliasMenuTriggerProps {
  readonly "aria-haspopup": "menu";
  readonly "aria-expanded": boolean;
  readonly "aria-controls": string | undefined;
  readonly "aria-label": string | undefined;
  readonly onClick: () => void;
  readonly type: "button";
}

/** What the menu takes. */
export interface AliasMenuProps {
  /**
   * The trigger's accessible name, where its content is not one — a pill reading `coder-max`
   * does not say *swap*. Omitted for a trigger whose text is its name.
   */
  readonly label?: string;
  /** The menu's accessible name. */
  readonly menuLabel: string;
  /** The alias the hop names now, for a swap. Omitted for an add, which has no current row. */
  readonly current?: string;
  /** What to do with the alias picked. The menu closes itself. */
  readonly onPick: (target: AliasCell) => void;
  /** The trigger, drawn by the caller with these props spread onto it. */
  readonly trigger: (props: AliasMenuTriggerProps) => ReactNode;
  /** Classes from the page — placement only. */
  readonly className?: string;
}

/**
 * The menu and its trigger.
 *
 * @param props See {@link AliasMenuProps}.
 * @returns The trigger, and the panel while it is open.
 */
export function AliasMenu({ label, menuLabel, current, onPick, trigger, className }: AliasMenuProps) {
  const editor = useRouteEditor();
  const [open, setOpen] = useState(false);

  const wrapper = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  /**
   * The trigger, found rather than held: the caller draws it, and the direct-child selector
   * is exact because the rows are inside the panel.
   *
   * @returns The trigger element, or `null` before the first render has committed.
   */
  function triggerElement(): HTMLButtonElement | null {
    return wrapper.current?.querySelector<HTMLButtonElement>(":scope > button") ?? null;
  }

  /**
   * Close the menu.
   *
   * @param restoreFocus Whether focus goes back to the trigger. False for a dismissal the
   *   browser is already resolving — a Tab, or a press elsewhere on the page.
   */
  function close(restoreFocus: boolean): void {
    setOpen(false);
    if (restoreFocus) triggerElement()?.focus();
  }

  /** Open the menu, and read the registry the first time any menu on the page opens. */
  function toggle(): void {
    if (!open) editor.readRegistry();
    setOpen(!open);
  }

  // A press anywhere outside dismisses — `pointerdown` rather than `click`, so the menu is
  // gone before whatever was pressed reacts.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent): void {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  // Focus lands on the first row when the menu opens — or on the panel itself while the
  // registry is still on its way, and moves to the first row when it arrives, so a keyboard
  // reader is never left on a trigger whose menu opened somewhere they are not.
  const registry = editor.registry;
  useEffect(() => {
    if (!open) return;

    const panel = menu.current;
    if (panel === null) return;

    const inside = panel.contains(document.activeElement);
    const first = menuItems(panel)[0];

    if (first !== undefined && (!inside || document.activeElement === panel)) {
      first.focus();
    } else if (!inside) {
      panel.focus();
    }
  }, [open, registry]);

  /**
   * The menu's keyboard.
   *
   * @param event The key press, on the panel — the rows do not listen individually.
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const action = menuKeyAction(event, { inSubmenu: false, onBranch: false });

    if (menuConsumesKey(action)) event.preventDefault();

    if (action === "close") {
      close(true);
      return;
    }

    if (action === "dismiss") {
      close(false);
      return;
    }

    const rows = menuItems(menu.current);
    const target = menuFocusTarget(
      action,
      rows.indexOf(document.activeElement as HTMLElement),
      rows.length,
    );

    if (target !== undefined) rows[target]?.focus();
  }

  /**
   * Pick a row.
   *
   * @param target The alias.
   */
  function pick(target: AliasCell): void {
    onPick(target);
    close(true);
  }

  return (
    <span className={cx("models-chain__menu-wrap", className)} ref={wrapper}>
      {trigger({
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? menuId : undefined,
        "aria-label": label,
        onClick: toggle,
        type: "button",
      })}

      {open ? (
        <div
          aria-label={menuLabel}
          className="models-chain__menu"
          id={menuId}
          onKeyDown={onKeyDown}
          ref={menu}
          role="menu"
          tabIndex={-1}
        >
          <MenuBody current={current} onPick={pick} registry={registry} />
        </div>
      ) : null}
    </span>
  );
}

/**
 * What is inside the panel: the rows, or the one sentence that says why there are none.
 *
 * Three sentences for three facts — the list is on its way, the list could not be read, the
 * list is empty — because a panel that showed nothing for any of them would be a menu that
 * opened onto a blank.
 *
 * @param props.registry The list as read, or `null` while it is on its way.
 * @param props.current The alias that is current, for a swap.
 * @param props.onPick What to do with a row.
 * @returns The rows or the sentence.
 */
function MenuBody({
  registry,
  current,
  onPick,
}: Readonly<{
  registry: ReturnType<typeof useRouteEditor>["registry"];
  current: string | undefined;
  onPick: (target: AliasCell) => void;
}>) {
  if (registry === null) {
    return (
      <p className="models-chain__menu-note" role="status">
        {TARGETS_LOADING}
      </p>
    );
  }

  if (!registry.ok) {
    return (
      <p className="models-chain__menu-note models-chain__menu-note--failed" role="alert">
        {registry.reason}
      </p>
    );
  }

  if (registry.aliases.length === 0) {
    return <p className="models-chain__menu-note">{EMPTY_REGISTRY}</p>;
  }

  return (
    <>
      {registry.aliases.map((target) => (
        <button
          aria-checked={current === undefined ? undefined : current === target.alias}
          className="models-chain__option"
          key={target.alias}
          onClick={() => {
            onPick(target);
          }}
          role="menuitemradio"
          type="button"
        >
          <span className="models-chain__option-alias">{target.alias}</span>
          <span className="models-chain__option-res">
            {RESOLVES} {target.resolution}
          </span>
        </button>
      ))}
    </>
  );
}
