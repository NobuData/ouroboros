"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { RetryBanner } from "@/app/ui";

import { type HubReads, unreadHeadline, unreadReason, unreadSections } from "./unread";

import "./settings.css";

/**
 * The settings hub's error state (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496))
 * — DASH-I.7's retry box, above the grid, while any section's read was refused.
 *
 * Each degraded seat already says why it could not be drawn; this says it **once for the page**
 * — how many sections, which ones — and offers the one thing that can fix it: **Retry**, which
 * re-reads the route (`router.refresh()`), so every seat is read again and the box leaves with
 * the last failure. The page's unsaved edits survive it: a refresh re-renders the server's part
 * and keeps the client's state.
 *
 * @param props.reads The hub's reads (`app/settings/unread.ts`).
 * @returns The box, or nothing while every read that was made succeeded.
 */
export function SettingsReadBanner({ reads }: Readonly<{ reads: HubReads }>) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const unread = unreadSections(reads);

  if (unread.length === 0) return null;

  return (
    <RetryBanner
      className="settings__retry"
      headline={unreadHeadline(unread.length)}
      onRetry={() => {
        // The primitive never makes the control inert; this keeps a second press from stacking
        // a second transition on the first.
        if (retrying) return;
        startRetry(() => {
          router.refresh();
        });
      }}
      reason={unreadReason(unread)}
      retrying={retrying}
    />
  );
}
