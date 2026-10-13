"use client";

import { useState, useTransition } from "react";

import type { SlackChannel, SlackChannels } from "@/app/api/chatops";
import { Button } from "@/app/ui";

import { refreshChannels, unbindChannel } from "./chatops-actions";
import {
  type ChatOpsOutcome,
  LINK_COMMAND,
  OPEN_SLACK_LABEL,
  REFRESHING_LABEL,
  REFRESH_FAILED,
  REJOINED_LABEL,
  REMOVED_ROLE_NOTE,
  UNBINDING_LABEL,
  UNBIND_FAILED,
  UNBIND_LABEL,
  UNLINKED_LABEL,
  UNLINKED_LEAD,
  UNLINKED_TAIL,
  UNLINKED_TITLE,
  refusalText,
  refused,
  removedNote,
  unbindName,
} from "./view";

/*
 * What stands over the mirror's stream when the happy picture is not the true one (CA.5,
 * [#545](https://github.com/NobuData/ouroboros/issues/545)). Each says what is wrong, what it
 * costs and what to do — in the card, where the reader is already looking.
 */

/** What the unlinked banner takes. */
export interface UnlinkedBannerProps {
  /** The channel whose mirror is showing — its Slack link is the banner's way out. */
  readonly channel: Pick<SlackChannel, "url">;
}

/**
 * The unlinked-reader banner: the reader has no linked Slack identity.
 *
 * **Nothing in the app is affected** — a command typed here runs under the session — and the
 * banner says so first. What does not work is Slack's side: a button pressed there cannot act as
 * somebody Ouroboros cannot name. Saying it once here is what stops *the Allow button is broken*.
 *
 * **Linking starts in Slack**, where the identity is (decision C4): the banner names the command
 * and opens the channel to type it in. It does not offer a link of its own — the app does not
 * know which Slack user the reader is until they say so from there.
 *
 * @param props See {@link UnlinkedBannerProps}.
 * @returns The banner.
 */
export function UnlinkedBanner({ channel }: UnlinkedBannerProps) {
  return (
    <section aria-label={UNLINKED_LABEL} className="chatops-mirror__notice">
      <p className="chatops-mirror__notice-text">
        <strong className="chatops-mirror__notice-title">{UNLINKED_TITLE}</strong> {UNLINKED_LEAD}{" "}
        <code className="chatops-mirror__notice-code">{LINK_COMMAND}</code> {UNLINKED_TAIL}
      </p>
      {channel.url !== "" && (
        <Button href={channel.url} rel="noopener noreferrer" size="sm" target="_blank" tone="ghost">
          {OPEN_SLACK_LABEL}
        </Button>
      )}
    </section>
  );
}

/** What the removed-channel warning takes. */
export interface RemovedBannerProps {
  /** The channel the bot was removed from. */
  readonly channel: SlackChannel;
  /** Whether this reader may refresh the list and unbind — an owner or an admin. */
  readonly mayAdminister: boolean;
  /**
   * Called with the channels as a refresh or an unbind left them.
   *
   * @param channels The channels.
   */
  readonly onChanged: (channels: SlackChannels) => void;
}

/** Which of the warning's two writes is out. */
type Write = "refresh" | "unbind";

/**
 * The warning on a bound channel the bot was removed from, with its two ways out.
 *
 * **Re-joining is an invitation, made in Slack.** The app asks for no scope to join a channel by
 * itself, so the warning says where to type the invite — and **I invited it — refresh** reads the
 * channels from Slack again, which is how the bot's return is noticed. **Unbind** is the other
 * answer: stop sending this channel anything. Both are an owner's or an admin's; everyone else
 * is told who can.
 *
 * @param props See {@link RemovedBannerProps}.
 * @returns The warning.
 */
export function RemovedBanner({ channel, mayAdminister, onChanged }: RemovedBannerProps) {
  const [writing, setWriting] = useState<Write | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Make one of the two writes, and hand its answer up.
   *
   * @param which The write.
   * @param write The call.
   * @param fallback What is said when it could not be made at all.
   */
  function run(which: Write, write: () => Promise<ChatOpsOutcome<SlackChannels>>, fallback: string): void {
    if (pending) return;

    setFailure(null);
    setWriting(which);

    startTransition(async () => {
      try {
        const outcome = await write();

        if (refused(outcome)) setFailure(refusalText(outcome.error, fallback));
        else onChanged(outcome);
      } catch {
        setFailure(fallback);
      } finally {
        setWriting(null);
      }
    });
  }

  const refreshing = pending && writing === "refresh";
  const unbinding = pending && writing === "unbind";

  return (
    <div className="chatops-mirror__warning" role="note">
      <p className="chatops-mirror__warning-text">
        {removedNote(channel)}
        {!mayAdminister && <> {REMOVED_ROLE_NOTE}</>}
      </p>
      {mayAdminister && (
        <div className="chatops-mirror__warning-actions">
          <Button
            aria-busy={refreshing || undefined}
            onClick={() => run("refresh", refreshChannels, REFRESH_FAILED)}
            reason={refreshing ? REFRESHING_LABEL : undefined}
            size="sm"
            tone="ghost"
          >
            {refreshing ? REFRESHING_LABEL : REJOINED_LABEL}
          </Button>
          <Button
            aria-busy={unbinding || undefined}
            aria-label={unbindName(channel)}
            onClick={() => run("unbind", () => unbindChannel(channel.id), UNBIND_FAILED)}
            reason={unbinding ? UNBINDING_LABEL : undefined}
            size="sm"
            tone="ghost"
          >
            {unbinding ? UNBINDING_LABEL : UNBIND_LABEL}
          </Button>
        </div>
      )}
      {failure !== null && (
        <p className="chatops-mirror__alert" role="alert">
          {failure}
        </p>
      )}
    </div>
  );
}
