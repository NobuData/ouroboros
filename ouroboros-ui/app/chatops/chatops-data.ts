import "server-only";

/**
 * The Chat Ops page's reads (CA.1, [#541](https://github.com/NobuData/ouroboros/issues/541)),
 * made once on the server so the page arrives whole — and made again, the same way, for its
 * poll (`app/api/chatops-page.ts`).
 *
 * Two reads, together: the connection, which decides what the page is, and the channels, which
 * are a {@link Reading} of their own — a channel list that could not be read costs the lists and
 * leaves the head, the strip and the install journey standing.
 */

import { chatops } from "@/app/api/chatops";
import type { ApiClient } from "@/app/api/client";
import { type Reading, attempt } from "@/app/api/reading";

import type { ChatOpsPage } from "./view";

/**
 * Read the connection and the channels.
 *
 * @param client The client to call through. Defaults to the server-side one.
 * @param signal Aborts the reads.
 * @returns The page's payload.
 * @throws {ApiError} What the service answered for the connection. A refused channel list is
 *   kept as a value.
 */
export async function loadChatOps(client?: ApiClient, signal?: AbortSignal): Promise<ChatOpsPage> {
  const [connection, channels] = await Promise.all([
    chatops.connection(client, signal),
    attempt(() => chatops.channels(client, signal)),
  ]);

  return { connection, channels };
}

/** The page's first paint: what was read, and when. */
export interface ChatOpsReadings {
  /** The connection and the channels, or why they could not be read. */
  readonly page: Reading<ChatOpsPage>;
  /** When the page was read, ISO 8601 — what *verified 2m ago* is measured from until a poll answers. */
  readonly readAt: string;
}

/**
 * Read the page for its first paint.
 *
 * @returns The reading — a failure carries the service's sentence — and the instant it was made.
 */
export async function readChatOps(): Promise<ChatOpsReadings> {
  const page = await attempt(() => loadChatOps());

  return { page, readAt: new Date().toISOString() };
}
