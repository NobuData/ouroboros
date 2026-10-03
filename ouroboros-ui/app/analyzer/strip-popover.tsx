"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/**
 * A meta-strip value that opens a small popover explaining itself (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516)) — the analyzer list behind
 * `deterministic analyzers v1 ⓘ` and the computed basis behind the confidence tag.
 *
 * The disclosure the insights KPI methodology uses (`app/insights/kpi-methodology.tsx`): a real
 * button with `aria-expanded`, a labelled group as the panel, Escape and a press outside close it
 * and Escape gives focus back to the trigger.
 *
 * @param props.trigger What the button shows — the strip's value.
 * @param props.triggerClassName The button's classes, from the strip.
 * @param props.title The popover's heading, which also names it.
 * @param props.children The popover's body.
 * @returns The trigger, and the popover while open.
 */
export function StripPopover({
  trigger,
  triggerClassName,
  title,
  children,
}: Readonly<{ trigger: ReactNode; triggerClassName: string; title: string; children: ReactNode }>) {
  const panelId = useId();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    /** Close on Escape, and give focus back to the trigger. */
    function onKey(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;

      setOpen(false);
      button.current?.focus();
    }

    /** Close on a press outside the trigger and its popover. */
    function onPress(event: MouseEvent): void {
      if (!(event.target instanceof Node) || root.current?.contains(event.target) !== true) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPress);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPress);
    };
  }, [open]);

  return (
    <span className="analyzer-pop" ref={root}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        className={triggerClassName}
        onClick={() => setOpen((current) => !current)}
        ref={button}
        type="button"
      >
        {trigger}
      </button>
      {open && (
        <span aria-labelledby={titleId} className="analyzer-pop__panel" id={panelId} role="group">
          <span className="analyzer-pop__title" id={titleId}>
            {title}
          </span>
          {children}
        </span>
      )}
    </span>
  );
}
