"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { menuConsumesKey, menuFocusTarget, menuItems, menuKeyAction } from "@/app/shell/menu";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Chip } from "@/app/ui";
import { REGISTRY_PATH } from "@/app/paths";

import { removeProvider } from "./key-actions";
import {
  CLOSE,
  DELETE_CONFIRM,
  DELETE_ITEM,
  DELETE_NOTE,
  DELETING,
  DEPENDENT_ROUTES,
  IN_USE_NOTE,
  MENU_GLYPH,
  OPEN_ROUTING,
  deleteTitle,
  inUseTitle,
  menuLabel,
} from "./keys";

/**
 * The card's overflow menu and the delete it holds
 * ([#229](https://github.com/NobuData/ouroboros/issues/229)).
 *
 * Delete carries the dependency guard. Routing aliases point at connections (Y.1,
 * [#189](https://github.com/NobuData/ouroboros/issues/189)); deleting underneath them would
 * break every route that resolves through the provider. The service returns `409` with the
 * alias names, and this surface turns that into a dialog that says which routes are affected
 * and links to where they are repointed — rather than a bare *could not delete*.
 *
 * ### Three states, and the pre-flight does not replace the answer
 *
 * The card already knows its dependents (the same read the switch's confirm uses), so the
 * confirmation *pre-warns* when there are any. But the delete is attempted regardless and it
 * is the **service's** `409` that blocks it, because a pre-flight cannot close the race where
 * an alias is repointed onto this connection between the read and the press. So:
 * `confirm → deleting → gone`, or `confirm → deleting → blocked` (the service named routes),
 * or `confirm → deleting → failed` (some other refusal). The blocked state is the same
 * whether the pre-flight saw the aliases or not.
 *
 * ### The menu keyboard is `app/shell/menu.ts`'s
 *
 * The ARIA menu pattern — roving focus, Escape, Tab dismissing without stealing the move —
 * is that module's, framework-free, shared with the registry's and the shell's menus. This
 * is the fourth caller and adds only the wiring: open state, outside-press dismissal, and
 * moving focus in on open and back to the trigger on close.
 */

/** The delete dialog's state. */
type Phase =
  | { readonly kind: "closed" }
  | { readonly kind: "confirm" }
  | { readonly kind: "deleting" }
  | { readonly kind: "blocked"; readonly aliases: readonly string[] }
  | { readonly kind: "failed"; readonly reason: string };

/** What the menu is told. */
export interface CardMenuProps {
  /** The connection. */
  readonly connectionId: string;
  /** The card's heading, for the trigger's name and the dialog's title. */
  readonly displayName: string;
}

/**
 * The overflow menu.
 *
 * @param props See {@link CardMenuProps}.
 * @returns The three-dot trigger, its menu, and the delete dialog.
 */
export function CardMenu({ connectionId, displayName }: CardMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "closed" });

  const wrapper = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  /** The trigger, found rather than held — `Button` takes no ref (registry's import menu). */
  function triggerElement(): HTMLButtonElement | null {
    return wrapper.current?.querySelector<HTMLButtonElement>(":scope > button") ?? null;
  }

  /** Close the menu, optionally putting focus back on the trigger. */
  function close(restoreFocus: boolean): void {
    setOpen(false);
    if (restoreFocus) triggerElement()?.focus();
  }

  // Outside-press dismissal — `pointerdown`, so the menu is gone before the press lands.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent): void {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Focus the first item when the menu opens.
  useEffect(() => {
    if (open) menuItems(menu.current)[0]?.focus();
  }, [open]);

  /** The menu's keyboard, over whatever is rendered. */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const action = menuKeyAction(event, { inSubmenu: false, onBranch: false });

    if (menuConsumesKey(action)) event.preventDefault();
    if (action === "close") return close(true);
    if (action === "dismiss") return close(false);

    const rows = menuItems(menu.current);
    const target = menuFocusTarget(action, rows.indexOf(document.activeElement as HTMLElement), rows.length);
    if (target !== undefined) rows[target]?.focus();
  }

  /** Open the confirmation from the menu. */
  function requestDelete(): void {
    close(false);
    setPhase({ kind: "confirm" });
  }

  /** Attempt the delete. */
  function destroy(): void {
    setPhase({ kind: "deleting" });

    void removeProvider(connectionId).then((outcome) => {
      if (outcome.ok) {
        // The card leaves with the fresh read, never hidden here.
        setPhase({ kind: "closed" });
        router.refresh();
        return;
      }

      setPhase(
        outcome.kind === "in-use"
          ? { kind: "blocked", aliases: outcome.aliases }
          : { kind: "failed", reason: outcome.reason },
      );
    });
  }

  return (
    <div className="providers-card__menu" ref={wrapper}>
      <Button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={menuLabel(displayName)}
        onClick={() => setOpen(!open)}
        size="sm"
        tone="ghost"
      >
        <span aria-hidden="true">{MENU_GLYPH}</span>
      </Button>

      {open && (
        <div
          aria-label={menuLabel(displayName)}
          className="providers-card__menu-panel"
          id={menuId}
          onKeyDown={onKeyDown}
          ref={menu}
          role="menu"
        >
          <button
            className="providers-card__menu-item providers-card__menu-item--danger"
            onClick={requestDelete}
            role="menuitem"
            type="button"
          >
            {DELETE_ITEM}
          </button>
        </div>
      )}

      <ShellOverlay
        label={phase.kind === "blocked" ? inUseTitle(displayName) : deleteTitle(displayName)}
        onClose={() => setPhase({ kind: "closed" })}
        open={phase.kind !== "closed"}
      >
        {phase.kind === "blocked" ? (
          <div className="providers-keys__dialog">
            <h2 className="shell-overlay__title">{inUseTitle(displayName)}</h2>
            <p className="shell-overlay__note">{IN_USE_NOTE}</p>
            <ul aria-label={DEPENDENT_ROUTES} className="providers-keys__aliases">
              {phase.aliases.map((alias) => (
                <li key={alias}>
                  <Chip mono tone="model">
                    {alias}
                  </Chip>
                </li>
              ))}
            </ul>
            <div className="providers-keys__actions">
              <Button href={REGISTRY_PATH} tone="primary">
                {OPEN_ROUTING}
              </Button>
              <Button onClick={() => setPhase({ kind: "closed" })} tone="ghost" type="button">
                {CLOSE}
              </Button>
            </div>
          </div>
        ) : phase.kind === "failed" ? (
          <div className="providers-keys__dialog">
            <h2 className="shell-overlay__title">{deleteTitle(displayName)}</h2>
            <p className="providers-keys__note providers-keys__note--err" role="alert">
              {phase.reason}
            </p>
            <div className="providers-keys__actions">
              <Button onClick={() => setPhase({ kind: "closed" })} tone="ghost" type="button">
                {CLOSE}
              </Button>
            </div>
          </div>
        ) : (
          <div className="providers-keys__dialog">
            <h2 className="shell-overlay__title">{deleteTitle(displayName)}</h2>
            <p className="shell-overlay__note">{DELETE_NOTE}</p>
            <div className="providers-keys__actions">
              <Button
                onClick={destroy}
                reason={phase.kind === "deleting" ? DELETING : undefined}
                tone="danger"
                type="button"
              >
                {phase.kind === "deleting" ? DELETING : DELETE_CONFIRM}
              </Button>
              <Button onClick={() => setPhase({ kind: "closed" })} tone="ghost" type="button">
                {CLOSE}
              </Button>
            </div>
          </div>
        )}
      </ShellOverlay>
    </div>
  );
}
