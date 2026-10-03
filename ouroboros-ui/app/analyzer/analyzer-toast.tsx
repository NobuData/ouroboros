"use client";

import Link from "next/link";

import { Button } from "@/app/ui";

import { useAnalyzer } from "./analyzer-store";
import { GO_GLYPH } from "./suggestions-view";
import { DISMISS_TOAST } from "./tickets-view";

/**
 * The toast a push leaves on the page (BW.4,
 * [#519](https://github.com/NobuData/ouroboros/issues/519)) — what it did, and where the tickets
 * went.
 *
 * The knowledge page's toast's shape (`app/knowledge/knowledge-toast.tsx`): an always-mounted seat,
 * so the live region exists before it has something to say and collapses to nothing while empty;
 * the sentence, what to know before following it, its links, then a dismissal. **It stays until
 * dismissed** — nothing here disappears on a clock, because a sentence on a timer is one a reader
 * may not have finished.
 *
 * It is held in the page's store rather than by the card that raised it, so it outlives the rows
 * that were pushed: once a batch closes, its group collapses to a summary, and the toast is still
 * there saying where the tickets are.
 *
 * @returns The seat, with the toast in it while there is one.
 */
export function AnalyzerToastSeat() {
  const { toast, dismissToast } = useAnalyzer();

  return (
    <div className="analyzer-toast__seat" role="status">
      {toast !== null && (
        <div className="analyzer-toast">
          <span className="analyzer-toast__text">{toast.text}</span>
          {toast.note !== null && <span className="analyzer-toast__note">{toast.note}</span>}
          <span className="analyzer-toast__actions">
            {toast.links.map((link) => (
              <Link className="analyzer-toast__link" href={link.href} key={link.href}>
                {link.label} <span aria-hidden="true">{GO_GLYPH}</span>
              </Link>
            ))}
            <Button aria-label={DISMISS_TOAST} onClick={dismissToast} size="sm" tone="ghost">
              <span aria-hidden="true">×</span>
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
