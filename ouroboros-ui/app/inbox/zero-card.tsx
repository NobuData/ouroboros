import Image from "next/image";

import { Card } from "@/app/ui";

import { ZERO_LABEL, ZERO_LINE, ZERO_NOTE } from "./resolved-view";

/** The brand glyph's own size (#14), so the page reserves its box before the image arrives. */
const GLYPH = { width: 512, height: 296 } as const;

/**
 * **Inbox zero** (BO.3, [#468](https://github.com/NobuData/ouroboros/issues/468), mockup 16,
 * decision X8) — the dashed card the page draws when nothing is asking.
 *
 * **A real state, not a decoration.** The mockup shows it under live cards to demonstrate the
 * design; the page shows it **only** when the queue is genuinely empty, and never beside an item
 * that is still asking. That is a deliberate divergence from the mockup's layout, recorded here
 * so a reviewer comparing the two does not "fix" it back.
 *
 * **The copy is a claim.** *You'll be pinged only when policy says so.* is true because the
 * policies that fill this queue are the ones the policy card lists — so both lines are the
 * mockup's, verbatim.
 *
 * **The glyph has real transparency.** The mockup dims it with a blend mode that only works on
 * its dark background; this is the #14 mark with its own alpha channel, drawn once per palette
 * and dimmed by opacity, so it survives the light theme. It is decorative — the card is already
 * named — and carries no alternative text.
 *
 * @returns The card.
 */
export function ZeroCard() {
  return (
    <Card aria-label={ZERO_LABEL} as="section" className="inbox-zero">
      <span className="inbox-zero__glyph">
        <Image
          alt=""
          className="inbox-zero__mark inbox-zero__mark--light"
          height={GLYPH.height}
          src="/brand/glyph-light.png"
          width={GLYPH.width}
        />
        <Image
          alt=""
          className="inbox-zero__mark inbox-zero__mark--dark"
          height={GLYPH.height}
          src="/brand/glyph-dark.png"
          width={GLYPH.width}
        />
      </span>
      <p className="inbox-zero__line">{ZERO_LINE}</p>
      <p className="inbox-zero__note">{ZERO_NOTE}</p>
    </Card>
  );
}
