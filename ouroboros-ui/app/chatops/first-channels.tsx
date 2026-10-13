"use client";

import type { ChannelPurpose } from "@/app/api/chatops";
import { Button, Card, CardHead } from "@/app/ui";

import {
  BIND_ROLE_REASON,
  FIRST_CHANNELS_LEAD,
  FIRST_CHANNELS_TITLE,
  INVITE_COMMAND,
  INVITE_REMINDER_LEAD,
  INVITE_REMINDER_TAIL,
  PURPOSES,
  PURPOSE_LABELS,
  PURPOSE_ROUTES,
  chooseChannelLabel,
} from "./view";

/** What the block takes. */
export interface FirstChannelsProps {
  /** Whether this reader may bind a channel — an owner or an admin. */
  readonly mayAdminister: boolean;
  /** The id the card's title takes, so the card is named by it. */
  readonly titleId: string;
  /** Open the channel picker for one purpose. */
  readonly onChoose: (purpose: ChannelPurpose) => void;
}

/**
 * The post-install step (CA.1, [#541](https://github.com/NobuData/ouroboros/issues/541)) — what a
 * workspace sees between *connected* and *useful*: Slack is installed and no channel has a
 * purpose, so nothing is delivered anywhere yet.
 *
 * It names the three purposes and the default routes each one switches on, and each has a button
 * that opens the picker already set to that purpose. For a reader who is not an owner or an admin
 * the buttons are inert and say why — the step stays visible to whoever has to ask for it. The
 * reminder under them is the one thing that otherwise fails silently: the bot posts only where
 * it has been invited.
 *
 * @param props See {@link FirstChannelsProps}.
 * @returns The block's card.
 */
export function FirstChannels({ mayAdminister, titleId, onChoose }: FirstChannelsProps) {
  return (
    <Card aria-labelledby={titleId} as="section" className="chatops__first">
      <CardHead title={FIRST_CHANNELS_TITLE} titleId={titleId} />
      <p className="chatops__lead">{FIRST_CHANNELS_LEAD}</p>
      <ul className="chatops__purposes">
        {PURPOSES.map((purpose) => (
          <li className="chatops__purpose" key={purpose}>
            <div className="chatops__purpose-text">
              <span className="chatops__purpose-name">{PURPOSE_LABELS[purpose]}</span>
              <span className="chatops__purpose-routes">{PURPOSE_ROUTES[purpose]}</span>
            </div>
            <Button
              aria-haspopup="dialog"
              onClick={() => onChoose(purpose)}
              reason={mayAdminister ? undefined : BIND_ROLE_REASON}
              size="sm"
              tone="ghost"
            >
              {chooseChannelLabel(purpose)}
            </Button>
          </li>
        ))}
      </ul>
      <p className="chatops__invite">
        {INVITE_REMINDER_LEAD} <code className="chatops__code">{INVITE_COMMAND}</code> {INVITE_REMINDER_TAIL}
      </p>
    </Card>
  );
}
