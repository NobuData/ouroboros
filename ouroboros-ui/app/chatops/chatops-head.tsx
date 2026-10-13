"use client";

import { Button, Eyebrow } from "@/app/ui";

import {
  ADD_CHANNEL_LABEL,
  BIND_ROLE_REASON,
  CHATOPS_EYEBROW,
  CHATOPS_HEADLINE,
  CHATOPS_SUBLINE,
  type OpenChannelLink,
} from "./view";

/** What the head takes. */
export interface ChatOpsHeadProps {
  /** Whether **+ Add channel ▾** is offered — only while Slack is connected. */
  readonly offersAdd: boolean;
  /** Whether this reader may bind a channel — an owner or an admin. */
  readonly mayAdminister: boolean;
  /** The link to the channel bound for loops, or null when there is none to open. */
  readonly open: OpenChannelLink | null;
  /** Open the channel picker. Called by **+ Add channel ▾**. */
  readonly onAddChannel: () => void;
}

/**
 * The Chat Ops page head — mockup 19's eyebrow, headline, subline and two actions (CA.1,
 * [#541](https://github.com/NobuData/ouroboros/issues/541)).
 *
 * **The copy is verbatim** (`app/chatops/view.ts`).
 *
 * **Each action is there only when it is true.** *+ Add channel ▾* is drawn while Slack is
 * connected, and opens the picker; for a reader who is not an owner or an admin it is inert and
 * says why. *Open #channel ↗* leaves for Slack — the real conversation — through the link the
 * service built for the channel bound for loops, and is **absent** while no channel is: a dead
 * button in the page's most prominent place would be worse than none.
 *
 * @param props See {@link ChatOpsHeadProps}.
 * @returns The head.
 */
export function ChatOpsHead({ offersAdd, mayAdminister, open, onAddChannel }: ChatOpsHeadProps) {
  return (
    <div className="chatops__head">
      <div className="chatops__headings">
        <Eyebrow>{CHATOPS_EYEBROW}</Eyebrow>
        <h1 className="chatops__title">{CHATOPS_HEADLINE}</h1>
        <p className="chatops__sub">{CHATOPS_SUBLINE}</p>
      </div>
      {(offersAdd || open !== null) && (
        <div className="chatops__actions">
          {offersAdd && (
            <Button
              aria-haspopup="dialog"
              onClick={onAddChannel}
              reason={mayAdminister ? undefined : BIND_ROLE_REASON}
              tone="ghost"
            >
              {ADD_CHANNEL_LABEL}
            </Button>
          )}
          {open !== null && (
            <Button href={open.href} rel="noreferrer" target="_blank" tone="primary">
              {open.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
