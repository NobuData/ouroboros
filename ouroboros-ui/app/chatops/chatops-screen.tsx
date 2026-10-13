"use client";

import { useId, useRef, useState } from "react";

import type {
  ChannelPurpose,
  ChatOnCall,
  SlackChannels,
  SlackConnection,
  SlackVerification,
} from "@/app/api/chatops";
import type { Reading } from "@/app/api/reading";
import type { NotificationRoute, NotificationRoutes } from "@/app/api/settings-integrations";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { Button, Card, EmptyState, RetryBanner } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import { AiPresenceCard } from "./ai-presence-card";
import { BoundChannels } from "./bound-channels";
import { ChannelPicker } from "./channel-picker";
import { ChatOpsHead } from "./chatops-head";
import { type ChatOpsPollOptions, createChatOpsPoll } from "./chatops-poll";
import { CommandsCard } from "./commands-card";
import { FirstChannels } from "./first-channels";
import { HealthStrip } from "./health-strip";
import { InstallJourney } from "./install-journey";
import { MirrorCard, type MirrorComposerHandle } from "./mirror-card";
import type { MirrorPollOptions } from "./mirror-poll";
import { RoutingCard } from "./routing-card";
import {
  CHANNELS_UNREAD,
  CHATOPS_ENDPOINT,
  type ChatOpsPage,
  MANAGE_SETTINGS_LABEL,
  MANAGE_SETTINGS_PATH,
  STALE_HEADLINE,
  UNREAD_HEADLINE,
  channelsBody,
  journeyFor,
  mirrorAddress,
  mirrorChannel,
  offersAddChannel,
  openChannelLink,
  showsHealth,
  withRoute,
} from "./view";

import "./chatops.css";

/** What the screen takes. */
export interface ChatOpsScreenProps {
  /** The connection and the channels, read on the server — or why they could not be. */
  readonly page: Reading<ChatOpsPage>;
  /** Whether this reader may install, verify, bind and unbind — an owner or an admin. */
  readonly mayAdminister: boolean;
  /** When the server read the page, ISO 8601. */
  readonly readAt: string;
  /** Test seams for the page's poll. */
  readonly poll?: ChatOpsPollOptions;
  /** The channel the address names (`?channel=<id>`), whose mirror is shown — or none. */
  readonly channel?: string | null;
  /** Test seams for the channel mirror's poll and its earlier read. */
  readonly mirror?: MirrorPollOptions;
}

/** What a write on this page answered, held until the poll's next answer replaces it. */
interface Written {
  /** The poll's payload when the write landed — a newer one supersedes what is held here. */
  readonly over: ChatOpsPage | null;
  /** The connection as a verification left it. */
  readonly connection?: SlackConnection;
  /** The channels as a refresh, a bind or an unbind left them. */
  readonly channels?: SlackChannels;
  /** The notification routes as a switch or a channel pick left them (CA.3, #543). */
  readonly routes?: NotificationRoutes;
  /** The on-call resource as a designation left it. */
  readonly onCall?: ChatOnCall;
}

/**
 * Chat Ops (CA.1, [#541](https://github.com/NobuData/ouroboros/issues/541)) —
 * `docs/mockups/19-chatops.html`'s head, and the integration's real front door under it.
 *
 * It renders **inside the app shell**, so it starts at its page head and contributes no chrome of
 * its own (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 2): the shell's content pane is the scroll
 * container, and there is no sidebar entry — the surfaces that used to say *arrives with Chat
 * Ops* are how a reader gets here.
 *
 * **The page is whatever the connection is** (`app/chatops/view.ts`):
 *
 * - no app on the deployment, or an app this workspace has not installed → the install journey;
 * - a connection that exists — working, revoked or failing → the health strip under the head;
 * - connected, and no channel has a purpose → the post-install step, *Bind your first channels*;
 * - connected, with bound channels → the **channel mirror** (CA.2,
 *   [#542](https://github.com/NobuData/ouroboros/issues/542)) in the main column — our record of
 *   what was published to one of them — and beside it the **commands** generated from the
 *   registry, **what gets published where** (CA.3,
 *   [#543](https://github.com/NobuData/ouroboros/issues/543)), the **AI-presence** preview (CA.4,
 *   [#544](https://github.com/NobuData/ouroboros/issues/544)) and the list of the channels, each
 *   with its way out to Slack and its way to show its own mirror.
 *
 * **Which mirror shows is in the address.** `?channel=<id>` names it; without one, or with one
 * that is not a bound channel, it is the first bound channel's. Choosing a row rewrites the
 * address in place, so a reload — and a link sent to somebody — shows the same channel.
 *
 * **It stays true without a reload.** One poll re-reads the connection and the channels every
 * cadence, so a connection Slack revoked shows on the strip by itself. A write made here — a
 * verification, a refresh, a bind, an unbind, a route switched or repointed, an on-call
 * designation — draws its own answer at once and asks the poll to
 * read again; a re-read that fails raises a retry banner over the page **as last read**, never in
 * its place.
 *
 * @param props See {@link ChatOpsScreenProps}.
 * @returns The screen.
 */
export function ChatOpsScreen({
  page: initial,
  mayAdminister,
  readAt,
  poll,
  channel: named = null,
  mirror,
}: ChatOpsScreenProps) {
  const { snapshot, refresh } = useKeyedPoll(CHATOPS_ENDPOINT, () => createChatOpsPoll(poll));
  const [written, setWritten] = useState<Written | null>(null);
  const [picker, setPicker] = useState<{ readonly preset: ChannelPurpose | null } | null>(null);
  const [wanted, setWanted] = useState<string | null>(named);
  const journeyTitle = useId();
  const channelsTitle = useId();
  const commandsTitle = useId();
  const routingTitle = useId();
  const presenceTitle = useId();
  /** The mirror's composer, for the commands card's **Try it**. */
  const composer = useRef<MirrorComposerHandle>(null);

  const read = snapshot.data ?? (initial.ok ? initial.value : null);
  // What a write answered stands until the poll has answered again since.
  const mine = written !== null && written.over === snapshot.data ? written : null;
  const page: ChatOpsPage | null =
    read === null
      ? null
      : {
          connection: mine?.connection ?? read.connection,
          channels: mine?.channels === undefined ? read.channels : { ok: true, value: mine.channels },
          grammar: read.grammar,
          routes: mine?.routes === undefined ? read.routes : { ok: true, value: mine.routes },
          onCall: mine?.onCall === undefined ? read.onCall : { ok: true, value: mine.onCall },
        };
  const now = new Date(snapshot.updatedAt ?? readAt);

  /**
   * Draw a write's answer now, and have the poll confirm it.
   *
   * @param answer What the write changed.
   */
  function land(answer: Omit<Written, "over">): void {
    setWritten((held) => ({ ...(held?.over === snapshot.data ? held : null), ...answer, over: snapshot.data }));
    refresh();
  }

  /**
   * Show a channel's mirror, and say so in the address.
   *
   * @param id The channel.
   */
  function showMirror(id: string): void {
    setWanted(id);
    window.history.replaceState(window.history.state, "", mirrorAddress(id));
  }

  const onChannels = (channels: SlackChannels) => land({ channels });
  const onVerified = (verification: SlackVerification) => land({ connection: verification.connection });
  const onOnCall = (onCall: ChatOnCall) => land({ onCall });

  /**
   * A route was written: draw it among the routes as held.
   *
   * @param route The route as the write left it.
   */
  function onRoute(route: NotificationRoute): void {
    if (page?.routes.ok === true) land({ routes: withRoute(page.routes.value, route) });
    else refresh();
  }

  const stale = snapshot.error !== null && (
    <RetryBanner className="chatops__stale" headline={STALE_HEADLINE} onRetry={refresh} reason={snapshot.error} />
  );

  if (page === null) {
    return (
      <main className="chatops">
        <ChatOpsHead mayAdminister={mayAdminister} offersAdd={false} onAddChannel={() => {}} open={null} />
        {stale}
        <Card>
          <EmptyState note={initial.ok ? undefined : initial.reason} title={UNREAD_HEADLINE} variant="flush" />
        </Card>
      </main>
    );
  }

  const journey = journeyFor(page.connection);
  const body = channelsBody(page);
  // An unbound page has no mirror: that is the post-install step's journey, not this card's.
  const mirrored = body === "bound" && page.channels.ok ? mirrorChannel(page.channels.value.channels, wanted) : null;

  return (
    <main className="chatops">
      <ChatOpsHead
        mayAdminister={mayAdminister}
        offersAdd={offersAddChannel(page.connection)}
        onAddChannel={() => setPicker({ preset: null })}
        open={openChannelLink(page)}
      />
      {stale}
      {showsHealth(page.connection) && (
        <HealthStrip connection={page.connection} mayAdminister={mayAdminister} now={now} onVerified={onVerified} />
      )}

      <div className={cx("chatops__body", mirrored !== null && "chatops__body--wide")}>
        {journey !== null && (
          <InstallJourney
            connection={page.connection}
            journey={journey}
            mayAdminister={mayAdminister}
            titleId={journeyTitle}
          />
        )}
        {body === "first" && (
          <FirstChannels
            mayAdminister={mayAdminister}
            onChoose={(preset) => setPicker({ preset })}
            titleId={channelsTitle}
          />
        )}
        {body === "bound" && page.channels.ok && (
          <div className="chatops__columns">
            {mirrored !== null && (
              <div className="chatops__main">
                <MirrorCard
                  appVersion={page.connection.appVersion}
                  channel={mirrored}
                  composerRef={composer}
                  key={mirrored.id}
                  poll={mirror}
                  readAt={readAt}
                />
              </div>
            )}
            <div className="chatops__side">
              <CommandsCard
                grammar={page.grammar}
                // With no mirror there is no composer, and nothing to try a command in.
                onTry={mirrored === null ? undefined : (line) => composer.current?.prefill(line)}
                titleId={commandsTitle}
              />
              <RoutingCard
                channels={page.channels.value.channels}
                mayAdminister={mayAdminister}
                onAddChannel={() => setPicker({ preset: null })}
                onCall={page.onCall}
                onOnCall={onOnCall}
                onRoute={onRoute}
                routes={page.routes}
                titleId={routingTitle}
              />
              {/* The designed preview until #546 hands it a live source — see presence-view.ts. */}
              <AiPresenceCard titleId={presenceTitle} />
              <BoundChannels
                channels={page.channels.value.channels}
                mayAdminister={mayAdminister}
                onChanged={onChannels}
                onShow={showMirror}
                shown={mirrored?.id ?? null}
                titleId={channelsTitle}
              />
            </div>
          </div>
        )}
        {body === "unread" && !page.channels.ok && (
          <Card>
            <EmptyState note={page.channels.reason} title={CHANNELS_UNREAD} variant="flush" />
          </Card>
        )}

        {/* With bound channels the routing card carries this link, at its own foot. */}
        {body !== "bound" && (
          <div className="chatops__foot">
            <Button href={MANAGE_SETTINGS_PATH} size="sm" tone="ghost">
              {MANAGE_SETTINGS_LABEL}
            </Button>
          </div>
        )}
      </div>

      <ChannelPicker
        channels={page.channels}
        now={now}
        onChanged={onChannels}
        onClose={() => setPicker(null)}
        open={picker !== null}
        preset={picker?.preset ?? null}
      />
    </main>
  );
}
