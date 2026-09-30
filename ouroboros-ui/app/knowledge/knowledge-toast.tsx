"use client";

import { Button } from "@/app/ui";

import { DISMISS_TOAST, type KnowledgeToast } from "./toast";

import "./knowledge.css";

/**
 * The toast the head's actions leave under it
 * (BG.1, [#417](https://github.com/NobuData/ouroboros/issues/417)).
 *
 * The build farm's submit toast's shape (`app/farm/submit-toast.tsx`): an always-mounted seat so
 * the live region exists before it has something to say, collapsed to nothing while empty; the
 * sentence, then its links, then a dismissal. **It stays until dismissed** — a toast on a timer is
 * a sentence a reader may not have finished, and the product's rule (`app/workflows/studio-toast.tsx`)
 * is that nothing here disappears on a clock.
 *
 * The links are the review states an import fills — the skills table's draft rows and the facts
 * card's awaiting queue — as anchors on this page, so the reader sees where their content went and
 * that none of it is live yet.
 *
 * @param props.toast What to say, or `null` for nothing.
 * @param props.onDismiss Called when the reader dismisses it.
 * @returns The seat, with the toast in it while there is one.
 */
export function KnowledgeToastSeat({
  toast,
  onDismiss,
}: Readonly<{ toast: KnowledgeToast | null; onDismiss: () => void }>) {
  return (
    <div className="knowledge-toast__seat" role="status">
      {toast !== null && (
        <div className="knowledge-toast">
          <span className="knowledge-toast__text">{toast.text}</span>
          {toast.links.map((link) => (
            <Button href={link.href} key={link.href} size="sm" tone="ghost">
              {link.label}
            </Button>
          ))}
          <Button aria-label={DISMISS_TOAST} onClick={onDismiss} size="sm" tone="ghost">
            <span aria-hidden="true">×</span>
          </Button>
        </div>
      )}
    </div>
  );
}
