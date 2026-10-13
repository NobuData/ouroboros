"use client";

import Image from "next/image";
import type { ReactNode } from "react";

import { Button } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import { APP_TAG, BOT_NAME, CONSOLE_SURFACE_MARK, UNKNOWN_AUTHOR, clockText, initials, isInApp } from "./view";

// The message treatments are the mirror's sheet, wherever a message is drawn.
import "./chatops-mirror.css";

/**
 * A message of a Chat Ops thread — mockup 19's `.msg` — from the app or from a person.
 *
 * **One set of components draws every thread on the page**: the channel mirror's stream (CA.2,
 * [#542](https://github.com/NobuData/ouroboros/issues/542)) and the AI-presence card (CA.4,
 * [#544](https://github.com/NobuData/ouroboros/issues/544)). That is the second half of the
 * activation contract in `presence-view.ts`: the card is already made of the live components, so
 * handing it a live thread changes its data and nothing it is drawn with.
 */

/** The app mark's drawn size, in CSS pixels — the sheet sizes it in rem. */
const MARK_SIZE = 22;

/** When a message was sent: a real instant, or the words of one that never happened. */
export interface MessageTime {
  /** The instant, ISO 8601 — drawn on the stream's clock, in the reader's zone. */
  readonly at?: string;
  /** The time as written, for an illustrated message. Used only when there is no `at`. */
  readonly clock?: string;
}

/**
 * An instant on the stream's clock.
 *
 * @param props.at The instant, ISO 8601.
 * @returns The time, or nothing for a stamp that cannot be read.
 */
export function Clock({ at }: Readonly<{ at: string }>) {
  const text = clockText(at);

  return text === "" ? null : (
    <time className="chatops-mirror__ts" dateTime={at}>
      {text}
    </time>
  );
}

/**
 * A message's time.
 *
 * @param props See {@link MessageTime}.
 * @returns The instant on the stream's clock; the written time, as plain text, when there is no
 *   instant — it names no moment, so it is not a `<time>`; or nothing.
 */
function Stamp({ at, clock }: MessageTime) {
  if (at !== undefined) return <Clock at={at} />;

  return clock === undefined || clock === "" ? null : <span className="chatops-mirror__ts">{clock}</span>;
}

/**
 * A message from the app: its mark, its name with the tag that says it is an app, and the time.
 *
 * @param props.at When it was posted, ISO 8601.
 * @param props.clock The time as written, for an illustrated message.
 * @param props.children What it said.
 * @returns The message.
 */
export function BotMessage({ at, clock, children }: Readonly<MessageTime & { children: ReactNode }>) {
  return (
    <div className="chatops-mirror__msg">
      <span aria-hidden className="chatops-mirror__avatar">
        <Image
          alt=""
          className="chatops-mirror__mark chatops-mirror__mark--light"
          height={MARK_SIZE}
          src="/brand/icon-light.png"
          width={MARK_SIZE}
        />
        <Image
          alt=""
          className="chatops-mirror__mark chatops-mirror__mark--dark"
          height={MARK_SIZE}
          src="/brand/icon-dark.png"
          width={MARK_SIZE}
        />
      </span>
      <div className="chatops-mirror__body">
        <div className="chatops-mirror__meta">
          <span className="chatops-mirror__name chatops-mirror__name--bot">
            {BOT_NAME}
            <span className="chatops-mirror__app">{APP_TAG}</span>
          </span>
          <Stamp at={at} clock={clock} />
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * A message from a person: their initials, their name, and the time.
 *
 * @param props.name Who, or null (or blank) for nobody we can name.
 * @param props.surface Where it was typed, when the record says — `console` is marked as such.
 * @param props.at When it was sent, ISO 8601.
 * @param props.clock The time as written, for an illustrated message.
 * @param props.children What they said.
 * @returns The message.
 */
export function PersonMessage({
  name,
  surface,
  at,
  clock,
  children,
}: Readonly<MessageTime & { name: string | null | undefined; surface?: string; children: ReactNode }>) {
  const known = name !== null && name !== undefined && name.trim() !== "";

  return (
    <div className="chatops-mirror__msg" data-surface={surface}>
      <span
        aria-hidden
        className={cx(
          "chatops-mirror__avatar",
          "chatops-mirror__avatar--human",
          !known && "chatops-mirror__avatar--unknown",
        )}
      >
        {initials(name)}
      </span>
      <div className="chatops-mirror__body">
        <div className="chatops-mirror__meta">
          <span className="chatops-mirror__name">{known ? name : UNKNOWN_AUTHOR}</span>
          {surface === "console" && <span className="chatops-mirror__surface">{CONSOLE_SURFACE_MARK}</span>}
          <Stamp at={at} clock={clock} />
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * A system line, between two rules — the mockup's `.sys-line`, for something that happened.
 *
 * @param props.children The line.
 * @returns The line.
 */
export function SystemLine({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="chatops-mirror__sys">{children}</div>;
}

/**
 * A small button that goes where a record points.
 *
 * A path of this application stays in the tab; an address with an origin of its own opens in a
 * new one.
 *
 * @param props.href Where.
 * @param props.label What the button says.
 * @param props.tone Its treatment.
 * @returns The link.
 */
export function RefButton({
  href,
  label,
  tone,
}: Readonly<{ href: string; label: string; tone: "primary" | "danger" | "ghost" }>) {
  return isInApp(href) ? (
    <Button href={href} size="sm" tone={tone}>
      {label}
    </Button>
  ) : (
    <Button href={href} rel="noopener noreferrer" size="sm" target="_blank" tone={tone}>
      {label}
    </Button>
  );
}
