"use client";

import { useMemo, useState, useTransition } from "react";

import { Button, EmptyState, Tag, cx } from "@/app/ui";

import {
  NO_TOKENS_NOTE,
  NO_TOKENS_TITLE,
  REVOKE,
  REVOKE_NOTE,
  REVOKING,
  TOKENS_CAPTION,
  TOKENS_LOADING,
  TOKENS_UNREAD_TITLE,
  type TokenListing,
  type TokenRow,
  revokeLabel,
  revokedNote,
  tokenRows,
  withToken,
} from "./enroll";
import { revokeEnrollmentToken } from "./enroll-actions";

import "./farm.css";

/**
 * The workspace's enrollment tokens, with the revoke
 * (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258)).
 *
 * **One list, mounted twice**: in the sheet the enroll card opens (`app/farm/token-sheet.tsx`)
 * and as the settings section's **Farm tokens** tab (`app/farm/farm-tokens-screen.tsx`, decision
 * S2). It owns the revoke and nothing about where the listing came from — the caller holds the
 * listing and is told when a revoke changes it — which is what lets one be read by a press and
 * the other by a route.
 *
 * **There is no value here to protect.** Every token arrives masked and there is no operation
 * that un-masks one; what this guards instead is the *way back* the issue asks for — a token
 * minted, copied and never used is a live credential nobody remembers creating, and this is
 * where it is found and killed.
 *
 * A revoke's answer replaces its row in place (`withToken`), so the list does not reorder or
 * flash, and says what it did in a status region with the number of machines the token had
 * already admitted — the figure the service calls the one an incident turns on.
 *
 * @param props.listing The listing, or `null` while its first read is in flight.
 * @param props.onListing Called with the listing as a revoke left it.
 * @returns The list, or what stands where it would be.
 */
export function TokenList({
  listing,
  onListing,
}: Readonly<{ listing: TokenListing | null; onListing: (next: TokenListing) => void }>) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [said, setSaid] = useState<{ readonly tone: "status" | "alert"; readonly text: string } | null>(null);
  const [, startTransition] = useTransition();

  const rows = useMemo(
    () => (listing?.ok ? tokenRows(listing, listing.readAt) : []),
    [listing],
  );

  /**
   * Revoke one token. A second press while one is in flight does nothing: Server Actions are
   * dispatched one at a time, and two revokes queued behind each other is two answers to narrate.
   *
   * @param row The row pressed.
   */
  function revoke(row: TokenRow): void {
    if (revoking !== null || listing === null) return;

    setRevoking(row.id);
    setSaid(null);

    startTransition(async () => {
      const outcome = await revokeEnrollmentToken(row.id);

      setRevoking(null);

      if (outcome.ok) {
        onListing(withToken(listing, outcome.token));
        setSaid({ tone: "status", text: revokedNote(outcome.token) });
      } else {
        setSaid({ tone: "alert", text: outcome.reason });
      }
    });
  }

  if (listing === null) return <EmptyState note={TOKENS_LOADING} variant="flush" />;
  if (!listing.ok) return <EmptyState note={listing.reason} title={TOKENS_UNREAD_TITLE} variant="flush" />;
  if (rows.length === 0) return <EmptyState note={NO_TOKENS_NOTE} title={NO_TOKENS_TITLE} variant="flush" />;

  return (
    <div className="farm-tokens">
      {/*
        A list rather than a table: it is drawn at two measures — a sheet and a settings page —
        and a row of self-describing facts wraps where six columns would scroll sideways.
      */}
      <ul aria-label={TOKENS_CAPTION} className="farm-tokens__list">
        {rows.map((row) => (
          <li
            className={cx("farm-tokens__row", row.state !== "live" && "farm-tokens__row--dead")}
            key={row.id}
          >
            <span className="farm-tokens__mask">{row.masked}</span>
            <Tag>{row.pool}</Tag>
            <span className="farm-tokens__fact">{row.window}</span>
            <span className="farm-tokens__fact">{row.uses}</span>
            {row.createdBy !== null && <span className="farm-tokens__fact">{row.createdBy}</span>}
            {/* Revoked, expired or spent: it admits nobody already, and the row says which. */}
            {row.revocable && (
              <Button
                aria-busy={revoking === row.id || undefined}
                aria-label={revokeLabel(row.masked)}
                className="farm-tokens__revoke"
                onClick={() => revoke(row)}
                size="sm"
                tone="danger"
              >
                {revoking === row.id ? REVOKING : REVOKE}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {/* A refusal interrupts; a revoke that took is what the reader asked for. */}
      <p className="farm-tokens__said" role={said?.tone ?? "status"}>
        {said?.text ?? ""}
      </p>

      <p className="farm-tokens__note">{REVOKE_NOTE}</p>
    </div>
  );
}
