"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";

import type { ChannelPurpose, SlackChannel, SlackChannels } from "@/app/api/chatops";
import type { Reading } from "@/app/api/reading";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button } from "@/app/ui";

import { bindChannel, refreshChannels, unbindChannel } from "./chatops-actions";
import {
  BACK_LABEL,
  BINDING_LABEL,
  BIND_FAILED,
  BIND_LABEL,
  CHANNELS_UNREAD,
  CHOOSE_PURPOSE_REASON,
  type ChatOpsOutcome,
  DONE_LABEL,
  NO_CHANNELS,
  PICKER_LIST_LABEL,
  PICKER_NOTE,
  PRIVATE_MARK,
  PURPOSES,
  PURPOSE_LABELS,
  PURPOSE_ROUTES,
  REFRESHING_LABEL,
  REFRESH_FAILED,
  REFRESH_LABEL,
  UNBINDING_LABEL,
  UNBIND_FAILED,
  UNBIND_LABEL,
  botText,
  boundNotice,
  boundText,
  channelName,
  listedText,
  membersText,
  notJoinedNote,
  offeredChannels,
  pickerTitle,
  purposeQuestion,
  refusalText,
  refused,
  unbindName,
  unboundNotice,
} from "./view";

/** What the picker takes. */
export interface ChannelPickerProps {
  /** Whether it is open. */
  readonly open: boolean;
  /** The purpose it was opened for — the post-install block's buttons — or null. */
  readonly preset: ChannelPurpose | null;
  /** The workspace's channels, as the page holds them. */
  readonly channels: Reading<SlackChannels>;
  /** The instant the page was read, which *listed 2m ago* is measured from. */
  readonly now: Date;
  /** Close it. */
  readonly onClose: () => void;
  /** Called with the channels as they stand after a refresh, a bind or an unbind. */
  readonly onChanged: (channels: SlackChannels) => void;
}

/**
 * **+ Add channel ▾** (CA.1, [#541](https://github.com/NobuData/ouroboros/issues/541)) — the
 * workspace's Slack channels, and what one of them is for.
 *
 * A dialog in the shell's overlay layer (`app/shell/overlay.tsx`), in two steps: choose a channel,
 * then say whether it carries loops, alerts or the leads' digest — each purpose named with the
 * routes it switches on. **Bind** asks the service; the page behind redraws from its answer.
 *
 * **A channel the bot is not in fails with an explanation, not a spinner.** Such a channel stays
 * in the list, and choosing it says — before anything is asked — that the bot has to be invited
 * with `/invite @Ouroboros`, private channels included, and offers *Refresh from Slack* to check
 * again afterwards. If Bind is pressed anyway and the service refuses, its sentence is printed
 * in the dialog and the button is a button again.
 *
 * Archived channels are not offered. A bound channel offers *Unbind*. An empty list says why it
 * might be, and offers the refresh.
 *
 * @param props See {@link ChannelPickerProps}.
 * @returns The dialog.
 */
export function ChannelPicker({ open, preset, channels, now, onClose, onChanged }: ChannelPickerProps) {
  return (
    <ShellOverlay label={pickerTitle(preset)} onClose={onClose} open={open}>
      {/* Mounted only while open, so each opening starts from the list with nothing chosen. */}
      <PickerBody channels={channels} now={now} onChanged={onChanged} onClose={onClose} preset={preset} />
    </ShellOverlay>
  );
}

/** Which write is in flight — the one control that says so. */
type Busy = "bind" | "refresh" | `unbind:${string}`;

/**
 * The picker's two steps.
 *
 * @param props The picker's own, without `open`.
 * @returns The step the reader is on.
 */
function PickerBody({ preset, channels, now, onClose, onChanged }: Omit<ChannelPickerProps, "open">) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<ChannelPurpose | null>(preset);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [pending, startTransition] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);
  const titleId = useId();
  const group = useId();

  const offered = channels.ok ? offeredChannels(channels.value.channels) : [];
  const chosen = chosenId === null ? null : (offered.find((channel) => channel.id === chosenId) ?? null);
  const running = pending ? busy : null;
  const step = chosen === null ? "list" : "purpose";

  // A step change unmounts the control that was pressed; without this, focus falls to the
  // document and Escape no longer reaches the dialog. The first step's focus is the overlay's.
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }

    heading.current?.focus();
  }, [step]);

  /**
   * Run one write: only its own control reports it, and whatever it answers ends it.
   *
   * @param which The control.
   * @param fallback What to say when nothing answered at all.
   * @param write The action.
   * @param onDone What to do with the channels it answered.
   */
  function run(
    which: Busy,
    fallback: string,
    write: () => Promise<ChatOpsOutcome<SlackChannels>>,
    onDone: (channels: SlackChannels) => void = () => {},
  ): void {
    if (pending) return;

    setFailure(null);
    setNotice(null);
    setBusy(which);

    startTransition(async () => {
      try {
        const outcome = await write();

        if (refused(outcome)) {
          setFailure(refusalText(outcome.error, fallback));
          return;
        }

        onChanged(outcome);
        onDone(outcome);
      } catch {
        setFailure(fallback);
      } finally {
        setBusy(null);
      }
    });
  }

  /** List the channels from Slack again. */
  function refresh(): void {
    run("refresh", REFRESH_FAILED, refreshChannels);
  }

  /**
   * Bind the chosen channel to the chosen purpose, and go back to the list saying so.
   *
   * @param channel The chosen channel.
   * @param to What it is for.
   */
  function bind(channel: SlackChannel, to: ChannelPurpose): void {
    run("bind", BIND_FAILED, () => bindChannel(channel.id, to), () => {
      setNotice(boundNotice(channel, to));
      setChosenId(null);
      setPurpose(preset);
    });
  }

  /**
   * Take a channel's purpose away.
   *
   * @param channel The channel.
   */
  function unbind(channel: SlackChannel): void {
    run(`unbind:${channel.id}`, UNBIND_FAILED, () => unbindChannel(channel.id), () => {
      setNotice(unboundNotice(channel));
    });
  }

  /**
   * Move between the steps, leaving the last step's messages behind.
   *
   * @param id The channel to choose, or null for the list.
   */
  function go(id: string | null): void {
    setChosenId(id);
    setFailure(null);
    setNotice(null);
  }

  const refreshButton = (
    <Button onClick={refresh} reason={running === "refresh" ? REFRESHING_LABEL : undefined} size="sm" tone="ghost">
      {running === "refresh" ? REFRESHING_LABEL : REFRESH_LABEL}
    </Button>
  );

  const refusal = failure !== null && (
    <p className="chatops__refusal" role="alert">
      {failure}
    </p>
  );

  if (chosen !== null) {
    return (
      <div className="chatops__picker">
        <h2 className="shell-overlay__title" id={titleId} ref={heading} tabIndex={-1}>
          {purposeQuestion(chosen)}
        </h2>
        <ChannelFacts channel={chosen} />

        {!chosen.joined && (
          <div className="chatops__picker-warning" role="note">
            <p className="chatops__picker-text">{notJoinedNote(chosen)}</p>
            {refreshButton}
          </div>
        )}

        <div aria-labelledby={titleId} className="chatops__choices" role="radiogroup">
          {PURPOSES.map((option) => (
            <label className="chatops__choice" key={option}>
              <input
                checked={purpose === option}
                className="chatops__choice-input"
                name={group}
                onChange={() => setPurpose(option)}
                type="radio"
                value={option}
              />
              <span className="chatops__choice-text">
                <span className="chatops__purpose-name">{PURPOSE_LABELS[option]}</span>{" "}
                <span className="chatops__purpose-routes">{PURPOSE_ROUTES[option]}</span>
              </span>
            </label>
          ))}
        </div>

        {refusal}

        <div className="chatops__picker-actions">
          <Button onClick={() => go(null)} tone="ghost">
            {BACK_LABEL}
          </Button>
          <Button
            onClick={() => {
              if (purpose !== null) bind(chosen, purpose);
            }}
            reason={running === "bind" ? BINDING_LABEL : purpose === null ? CHOOSE_PURPOSE_REASON : undefined}
            tone="primary"
          >
            {running === "bind" ? BINDING_LABEL : BIND_LABEL}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="chatops__picker">
      <h2 className="shell-overlay__title" id={titleId} ref={heading} tabIndex={-1}>
        {pickerTitle(preset)}
      </h2>
      <p className="chatops__picker-text">{PICKER_NOTE}</p>

      {notice !== null && (
        <p className="chatops__picker-notice" role="status">
          {notice}
        </p>
      )}

      {!channels.ok ? (
        <p className="chatops__picker-text">
          {CHANNELS_UNREAD} {channels.reason}
        </p>
      ) : offered.length === 0 ? (
        <p className="chatops__picker-text">{NO_CHANNELS}</p>
      ) : (
        <ul aria-label={PICKER_LIST_LABEL} className="chatops__picks">
          {offered.map((channel) => {
            const unbinding = running === `unbind:${channel.id}`;

            return (
              <li className="chatops__pick-row" key={channel.id}>
                <button className="chatops__pick" onClick={() => go(channel.id)} type="button">
                  <span className="chatops__channel-name">{channelName(channel)}</span>{" "}
                  <ChannelFacts channel={channel} />
                </button>
                {channel.purpose !== null && (
                  <Button
                    aria-label={unbindName(channel)}
                    onClick={() => unbind(channel)}
                    reason={unbinding ? UNBINDING_LABEL : undefined}
                    size="sm"
                    tone="ghost"
                  >
                    {unbinding ? UNBINDING_LABEL : UNBIND_LABEL}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {refusal}

      <div className="chatops__picker-foot">
        <span className="chatops__picker-listed">
          {listedText(channels.ok ? channels.value.refreshedAt : null, now)}
        </span>
        {refreshButton}
        <Button onClick={onClose} tone="primary">
          {DONE_LABEL}
        </Button>
      </div>
    </div>
  );
}

/**
 * What is known of a channel, in words: private or not, how many people, whether the bot is in
 * it, and what it is already bound for.
 *
 * @param props.channel The channel.
 * @returns The line.
 */
function ChannelFacts({ channel }: Readonly<{ channel: SlackChannel }>) {
  const facts = [
    channel.isPrivate ? PRIVATE_MARK : null,
    membersText(channel.memberCount),
    botText(channel),
    boundText(channel),
  ].filter((fact): fact is string => fact !== null);

  return <span className="chatops__pick-facts">{facts.join(" · ")}</span>;
}
