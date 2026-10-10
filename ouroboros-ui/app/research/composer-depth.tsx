"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import type { InvestigationDepth } from "@/app/api/research";
import { menuConsumesKey, menuFocusTarget, menuKeyAction } from "@/app/shell/menu";
import { Button, cx } from "@/app/ui";

import {
  DEPTHS,
  DEPTH_LABELS,
  DEPTH_MENU_LABEL,
  type DepthEstimates,
  depthBudget,
  depthButtonLabel,
} from "./composer";

/** What the Depth menu takes. */
export interface DepthMenuProps {
  /** The chosen depth. */
  readonly depth: InvestigationDepth;
  /** Every depth's estimate, so each option can print its budget; null while none has answered. */
  readonly estimates: DepthEstimates | null;
  /** Told the depth picked. The menu closes itself. */
  readonly onPick: (depth: InvestigationDepth) => void;
  /** Why the button cannot act, when it cannot. */
  readonly reason?: string;
}

/** The selector the roving focus walks — the options, in document order. */
const OPTION_SELECTOR = '[role="option"]';

/**
 * Mockup 22's **Depth: Deep dive ▾** (CN.2, [#628](https://github.com/NobuData/ouroboros/issues/628)):
 * a ghost button that opens a listbox of the three depths, **each option carrying its budget** —
 * the service's estimate line for that depth, so the choice is informed by the same figures the
 * estimate line will print once it is made. An unpriced researcher leaves every budget without
 * a `$`, here as everywhere.
 *
 * The keyboard is the shell's menu pattern (`app/shell/menu.ts`): focus lands on the chosen
 * option when the list opens, arrows wrap, Home and End jump, Escape closes with focus back on
 * the button, Tab dismisses. Enter or Space picks.
 *
 * @param props See {@link DepthMenuProps}.
 * @returns The button, and the options while open.
 */
export function DepthMenu({ depth, estimates, onPick, reason }: DepthMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const showing = open && reason === undefined;

  /**
   * The options, read from the document so the walk follows what is rendered.
   *
   * @returns The option elements, or none while closed.
   */
  function options(): HTMLElement[] {
    return Array.from(list.current?.querySelectorAll<HTMLElement>(OPTION_SELECTOR) ?? []);
  }

  /**
   * Close the list.
   *
   * @param restoreFocus Whether focus goes back to the button.
   */
  function close(restoreFocus: boolean): void {
    setOpen(false);
    if (restoreFocus) wrapper.current?.querySelector<HTMLButtonElement>(":scope > button")?.focus();
  }

  // A press anywhere outside dismisses.
  useEffect(() => {
    if (!showing) return undefined;

    function onPointerDown(event: PointerEvent): void {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [showing]);

  // Focus lands on the chosen option when the list opens.
  useEffect(() => {
    if (!showing) return;

    const chosen = options().find((option) => option.getAttribute("aria-selected") === "true");
    (chosen ?? options()[0])?.focus();
  }, [showing]);

  /**
   * The list's keyboard.
   *
   * @param event The key press, on the list.
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

    const rows = options();
    const target = menuFocusTarget(action, rows.indexOf(document.activeElement as HTMLElement), rows.length);
    if (target !== undefined) rows[target]?.focus();
  }

  return (
    <div className="research__depth" ref={wrapper}>
      <Button
        aria-controls={showing ? listId : undefined}
        aria-expanded={showing}
        aria-haspopup="listbox"
        onClick={() => setOpen(!showing)}
        reason={reason}
        size="sm"
        tone="ghost"
      >
        {depthButtonLabel(depth)} <span aria-hidden="true">▾</span>
      </Button>

      {showing ? (
        <div
          aria-label={DEPTH_MENU_LABEL}
          className="research__depth-panel"
          id={listId}
          onKeyDown={onKeyDown}
          ref={list}
          role="listbox"
          tabIndex={-1}
        >
          {DEPTHS.map((option) => (
            <button
              aria-selected={option === depth}
              className={cx("research__depth-option", option === depth && "research__depth-option--sel")}
              key={option}
              onClick={() => {
                onPick(option);
                close(true);
              }}
              role="option"
              type="button"
            >
              <span className="research__depth-name">{DEPTH_LABELS[option]}</span>
              <span className="research__depth-budget">{depthBudget(option, estimates)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
