"use client";

import { ShellOverlay } from "@/app/shell/overlay";
import { Eyebrow } from "@/app/ui";

import { TOKENS_CLOSE, TOKENS_EYEBROW, TOKENS_TITLE, type TokenListing } from "./enroll";
import { TokenList } from "./token-list";

/**
 * The token management sheet — what the enroll card's **Manage tokens →** opens
 * (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258)).
 *
 * A frame and nothing else: the list, its states and the revoke are `app/farm/token-list.tsx`'s,
 * which the settings section's **Farm tokens** tab mounts too. The modal contract — focus in,
 * Tab kept inside, Escape and a press outside close, focus back to the control that opened it —
 * is the shell overlay's (`app/shell/overlay.tsx`).
 *
 * The caller owns the listing, because the read starts in the press that opens the sheet
 * (`app/farm/enroll-card.tsx`) — so the sheet's first paint is *Reading the tokens…* rather than
 * an empty panel.
 *
 * @param props.open Whether the sheet is open.
 * @param props.listing The listing, or `null` while its read is in flight.
 * @param props.onListing Called with the listing as a revoke left it.
 * @param props.onClose Called when the reader dismisses the sheet.
 * @returns The sheet while open; nothing otherwise.
 */
export function TokenSheet({
  open,
  listing,
  onListing,
  onClose,
}: Readonly<{
  open: boolean;
  listing: TokenListing | null;
  onListing: (next: TokenListing) => void;
  onClose: () => void;
}>) {
  return (
    <ShellOverlay label={TOKENS_TITLE} onClose={onClose} open={open}>
      <div>
        <Eyebrow>{TOKENS_EYEBROW}</Eyebrow>
        <h2 className="shell-overlay__title">{TOKENS_TITLE}</h2>
      </div>

      <TokenList listing={listing} onListing={onListing} />

      <button className="shell-overlay__close" onClick={onClose} type="button">
        {TOKENS_CLOSE}
      </button>
    </ShellOverlay>
  );
}
