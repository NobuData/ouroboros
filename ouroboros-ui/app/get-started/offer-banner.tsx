"use client";

import { useState } from "react";

import { Button } from "@/app/ui";

import { dismissWizard } from "./actions";
import {
  OFFER_DISMISS,
  OFFER_DISMISSING,
  OFFER_LINE,
  OFFER_LINK,
  OFFER_NO_REPO,
  type GetStartedOffer,
  getStartedPath,
} from "./view";

import "./get-started.css";

/**
 * The dashboard's *Get started* banner (BC.1, [#390](https://github.com/NobuData/ouroboros/issues/390))
 * — how a fresh workspace is brought to `/get-started`. The user chose a banner over a redirect,
 * so nobody is pulled away from a page they asked for.
 *
 * It is drawn only while BB.2's fresh-org rule offers the wizard (#385), read on the server. **Any
 * member may dismiss it** — viewers included, as the service allows — and dismissal is the
 * service's fact, so it sticks on every device; the banner goes the moment the service says so.
 *
 * @param props.offer The offer, from the server read.
 * @returns The banner, or nothing once dismissed.
 */
export function GetStartedBanner({ offer }: Readonly<{ offer: GetStartedOffer }>) {
  const [state, setState] = useState<
    { phase: "shown" | "dismissing" | "gone" } | { phase: "refused"; reason: string }
  >({ phase: "shown" });

  if (state.phase === "gone") return null;

  /** Record the dismissal; hide the banner once the service stops offering the wizard. */
  function dismiss(): void {
    if (offer.repo === null || state.phase === "dismissing") return;

    setState({ phase: "dismissing" });
    void dismissWizard(offer.repo).then((outcome) =>
      setState(outcome.ok ? { phase: outcome.value ? "shown" : "gone" } : { phase: "refused", reason: outcome.reason }),
    );
  }

  return (
    <section aria-label="Get started" className="offer-banner">
      <p className="offer-banner__line">{OFFER_LINE}</p>
      <Button href={getStartedPath(offer.repo)} size="sm" tone="primary">
        {OFFER_LINK}
      </Button>
      <Button
        onClick={dismiss}
        reason={offer.repo === null ? OFFER_NO_REPO : state.phase === "dismissing" ? OFFER_DISMISSING : undefined}
        size="sm"
        tone="ghost"
      >
        {OFFER_DISMISS}
      </Button>
      {state.phase === "refused" && (
        <p className="offer-banner__refusal" role="alert">
          {state.reason}
        </p>
      )}
    </section>
  );
}
