"use client";

import { useState } from "react";

import type { ChatOnCall, SlackChannel } from "@/app/api/chatops";
import type { Reading } from "@/app/api/reading";
import type { NotificationRoute, NotificationRoutes } from "@/app/api/settings-integrations";
import { Button, Card, CardHead, EmptyState, Toggle } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import { setOnCall, setRouteChannel, setRouteEnabled } from "./routing-actions";
import {
  ADD_CHANNEL_CHOICE,
  ADD_CHANNEL_VALUE,
  CANCEL_LABEL,
  CHANGE_LABEL,
  CHANGE_NAME,
  CHOOSE_CHANNEL,
  type ChatOpsOutcome,
  type ChatRoute,
  DM_ON_CALL,
  MANAGE_SETTINGS_LABEL,
  MANAGE_SETTINGS_PATH,
  NOBODY_CHOICE,
  NO_CANDIDATES,
  NO_CHANNEL,
  ON_CALL_FAILED,
  ON_CALL_PICKER_LABEL,
  ROTATIONS_NOTE,
  ROUTES_EMPTY,
  ROUTES_UNREAD,
  ROUTE_ARROW,
  ROUTE_FAILED,
  ROUTE_OFF,
  ROUTE_ON,
  ROUTING_ROLE_NOTE,
  ROUTING_TITLE,
  channelName,
  chatRoutes,
  onCallView,
  refusalText,
  refused,
  routeChannelWarning,
  routeChoices,
  routePickerName,
  routeSwitchName,
} from "./view";

import "./chatops-side.css";

/** What the card takes. */
export interface RoutingCardProps {
  /** The notification routes — #488's store — or why they could not be read. */
  readonly routes: Reading<NotificationRoutes>;
  /** Who **+ DM on-call** reaches, or why that could not be read. */
  readonly onCall: Reading<ChatOnCall>;
  /** The workspace's channels, as served — the bound ones are what a row's picker offers. */
  readonly channels: readonly SlackChannel[];
  /** Whether this reader may edit routes and designate — an owner or an admin. */
  readonly mayAdminister: boolean;
  /** The id the card's title takes, so the card is named by it. */
  readonly titleId: string;
  /** Called with a route as a write left it. */
  readonly onRoute: (route: NotificationRoute) => void;
  /** Called with the on-call resource as a designation left it. */
  readonly onOnCall: (onCall: ChatOnCall) => void;
  /** Open #541's sheet, to bind a channel that is not offered yet. */
  readonly onAddChannel: () => void;
}

/**
 * The routing card (CA.3, [#543](https://github.com/NobuData/ouroboros/issues/543)) — mockup
 * 19's **WHAT GETS PUBLISHED WHERE**, as the configuration itself rather than a picture of it.
 *
 * **One store, two views.** The rows are #488's notification routes that post to a chat channel
 * — the ones Settings → Notifications edits — read on the page's poll and written through the
 * same `PATCH`. A write here draws its answer at once and asks the poll to confirm it; a change
 * made in Settings arrives on the next poll. Nothing syncs the two, because there is one of them.
 *
 * **Every word on a row is the service's**: the event's label, its qualifier — the
 * stage-transition route's *noisy, off by default* — the channel it posts to and whether that
 * channel can still be posted to. The card adds only the controls.
 *
 * **The switch is optimistic.** It flips when pressed; a refusal puts it back and says why on
 * the row, in the service's sentence — switching on a route with no channel is the service's to
 * refuse, and nothing here pre-empts it. A locked route says why and is not switched.
 *
 * **A reader who may not edit reads the same rows** as words — the channel, *on* or *off*, the
 * designee — with one line saying whose the controls are.
 *
 * @param props See {@link RoutingCardProps}.
 * @returns The card.
 */
export function RoutingCard({
  routes,
  onCall,
  channels,
  mayAdminister,
  titleId,
  onRoute,
  onOnCall,
  onAddChannel,
}: RoutingCardProps) {
  const rows = routes.ok ? chatRoutes(routes.value.items) : [];

  return (
    <Card aria-labelledby={titleId} as="section" className="chatops-side__routing">
      <CardHead title={ROUTING_TITLE} titleId={titleId} />

      {!routes.ok && <EmptyState note={routes.reason} title={ROUTES_UNREAD} variant="flush" />}
      {routes.ok && rows.length === 0 && <EmptyState title={ROUTES_EMPTY} variant="flush" />}
      {rows.length > 0 && (
        <ul className="chatops-side__routes">
          {rows.map((route) => (
            <RouteRow
              channels={channels}
              key={route.kind}
              mayAdminister={mayAdminister}
              onAddChannel={onAddChannel}
              onCall={onCall}
              onOnCall={onOnCall}
              onRoute={onRoute}
              route={route}
            />
          ))}
        </ul>
      )}

      {!mayAdminister && rows.length > 0 && <p className="chatops-side__role">{ROUTING_ROLE_NOTE}</p>}

      <div className="chatops-side__foot">
        <Button href={MANAGE_SETTINGS_PATH} size="sm" tone="ghost">
          {MANAGE_SETTINGS_LABEL}
        </Button>
      </div>
    </Card>
  );
}

/** What a row draws ahead of the service's answer. */
interface Held {
  /** The switch's position, as pressed. */
  readonly enabled?: boolean;
  /** The channel, as picked. */
  readonly channelId?: string;
}

/**
 * One route.
 *
 * @param props.route The route.
 * @param props.channels The workspace's channels.
 * @param props.onCall Who **+ DM on-call** reaches.
 * @param props.mayAdminister Whether the reader may edit.
 * @param props.onRoute Called with the route as a write left it.
 * @param props.onOnCall Called with the on-call resource as a designation left it.
 * @param props.onAddChannel Open the add-a-channel sheet.
 * @returns The row.
 */
function RouteRow({
  route,
  channels,
  onCall,
  mayAdminister,
  onRoute,
  onOnCall,
  onAddChannel,
}: Readonly<
  Pick<RoutingCardProps, "channels" | "onCall" | "mayAdminister" | "onRoute" | "onOnCall" | "onAddChannel"> & {
    route: ChatRoute;
  }
>) {
  const [held, setHeld] = useState<Held | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const { chat } = route;
  const enabled = held?.enabled ?? route.enabled;
  const channelId = held?.channelId ?? chat.channel?.id ?? "";
  const warning = routeChannelWarning(chat.channel);

  /**
   * Draw a change now, send it, and put the row back if the service refuses.
   *
   * @param change What the row shows meanwhile.
   * @param send The write.
   */
  async function write(change: Held, send: () => Promise<ChatOpsOutcome<NotificationRoute>>): Promise<void> {
    // One write at a time on a row: the second would be drawn over the first's answer.
    if (held !== null) return;

    setFailure(null);
    setHeld(change);

    try {
      const outcome = await send();

      if (refused(outcome)) setFailure(refusalText(outcome.error, ROUTE_FAILED));
      else onRoute(outcome);
    } catch {
      setFailure(ROUTE_FAILED);
    } finally {
      setHeld(null);
    }
  }

  /**
   * The picker changed.
   *
   * @param value A channel's id, or the add-a-channel choice.
   */
  function pick(value: string): void {
    if (value === ADD_CHANNEL_VALUE) {
      onAddChannel();
      return;
    }

    if (value === "" || value === channelId) return;

    void write({ channelId: value }, () => setRouteChannel(route.kind, value));
  }

  return (
    <li className="chatops-side__route">
      <div className="chatops-side__route-line">
        <span className="chatops-side__evt">
          {chat.label}
          {chat.note !== null && <span className="chatops-side__evt-note"> — {chat.note}</span>}
        </span>

        <span className="chatops-side__chan">
          <span aria-hidden>{ROUTE_ARROW}</span>
          {mayAdminister ? (
            <select
              aria-label={routePickerName(route)}
              className={cx("ou-input", "chatops-side__picker")}
              onChange={(event) => pick(event.target.value)}
              value={channelId}
            >
              {channelId === "" && <option value="">{CHOOSE_CHANNEL}</option>}
              {routeChoices(channels, chat.channel).map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
              <option value={ADD_CHANNEL_VALUE}>{ADD_CHANNEL_CHOICE}</option>
            </select>
          ) : (
            <span>{chat.channel === null ? NO_CHANNEL : channelName(chat.channel)}</span>
          )}
        </span>

        {mayAdminister ? (
          <Toggle
            checked={enabled}
            className="chatops-side__switch"
            label={routeSwitchName(route)}
            locked={route.locked}
            onClick={() => void write({ enabled: !enabled }, () => setRouteEnabled(route.kind, !enabled))}
            reason={route.locked ? (route.lockedReason ?? undefined) : undefined}
          />
        ) : (
          <span className="chatops-side__state">{enabled ? ROUTE_ON : ROUTE_OFF}</span>
        )}
      </div>

      {chat.dmOnCall && <OnCallAffix mayAdminister={mayAdminister} onCall={onCall} onOnCall={onOnCall} />}

      {warning !== null && (
        <p className={cx("chatops-side__route-note", "chatops-side__route-note--warn")} role="note">
          {warning}
        </p>
      )}
      {route.locked && route.lockedReason !== null && route.lockedReason !== "" && (
        <p className="chatops-side__route-note">{route.lockedReason}</p>
      )}
      {failure !== null && (
        <p className="chatops-side__alert" role="alert">
          {failure}
        </p>
      )}
    </li>
  );
}

/**
 * The **+ DM on-call** affix: who it reaches, that rotations are not here yet, and — for a
 * reader who may — the way to designate somebody else.
 *
 * Only a member with a linked Slack identity can be designated: a DM has to have somewhere to
 * go. With nobody linked the picker says what has to happen first rather than offering nobody.
 *
 * @param props.onCall The on-call resource, or why it could not be read.
 * @param props.mayAdminister Whether the reader may designate.
 * @param props.onOnCall Called with the resource as a designation left it.
 * @returns The affix.
 */
function OnCallAffix({
  onCall,
  mayAdminister,
  onOnCall,
}: Readonly<Pick<RoutingCardProps, "onCall" | "mayAdminister" | "onOnCall">>) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const view = onCallView(onCall);
  const designee = onCall.ok ? onCall.value.designee : null;
  const candidates = onCall.ok ? onCall.value.candidates : [];
  const listed = designee === null || candidates.some((one) => one.memberId === designee.memberId);

  /**
   * Designate a member, or nobody.
   *
   * @param value The member's id, or `""` for nobody.
   */
  async function designate(value: string): Promise<void> {
    if (picked !== null || value === (designee?.memberId ?? "")) return;

    setFailure(null);
    setPicked(value);

    try {
      const outcome = await setOnCall(value === "" ? null : value);

      if (refused(outcome)) {
        setFailure(refusalText(outcome.error, ON_CALL_FAILED));
      } else {
        onOnCall(outcome);
        setOpen(false);
      }
    } catch {
      setFailure(ON_CALL_FAILED);
    } finally {
      setPicked(null);
    }
  }

  return (
    <>
      <div className="chatops-side__oncall">
        <span className={cx("chatops-side__oncall-who", view.warn && "chatops-side__oncall-who--warn")}>
          {DM_ON_CALL} ({view.text})
        </span>
        <span className="chatops-side__oncall-note">{ROTATIONS_NOTE}</span>
        {mayAdminister && onCall.ok && !open && (
          <Button aria-label={CHANGE_NAME} onClick={() => setOpen(true)} size="sm" tone="ghost">
            {CHANGE_LABEL}
          </Button>
        )}
      </div>

      {open && (
        <div className="chatops-side__oncall-edit">
          {(candidates.length > 0 || designee !== null) && (
            <select
              aria-label={ON_CALL_PICKER_LABEL}
              className={cx("ou-input", "chatops-side__picker")}
              onChange={(event) => void designate(event.target.value)}
              value={picked ?? designee?.memberId ?? ""}
            >
              {designee !== null && !listed && <option value={designee.memberId}>{designee.name}</option>}
              {candidates.map((one) => (
                <option key={one.memberId} value={one.memberId}>
                  {one.name}
                </option>
              ))}
              <option value="">{NOBODY_CHOICE}</option>
            </select>
          )}
          {candidates.length === 0 && <p className="chatops-side__route-note">{NO_CANDIDATES}</p>}
          <Button
            onClick={() => {
              setOpen(false);
              setFailure(null);
            }}
            size="sm"
            tone="ghost"
          >
            {CANCEL_LABEL}
          </Button>
        </div>
      )}

      {failure !== null && (
        <p className="chatops-side__alert" role="alert">
          {failure}
        </p>
      )}
    </>
  );
}
