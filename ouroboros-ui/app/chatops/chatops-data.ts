import "server-only";

/**
 * The Chat Ops page's reads (CA.1, [#541](https://github.com/NobuData/ouroboros/issues/541)),
 * made once on the server so the page arrives whole — and made again, the same way, for its
 * poll (`app/api/chatops-page.ts`).
 *
 * Five reads, together: the connection, which decides what the page is, and four that are each a
 * {@link Reading} of their own — the channels, the `/ouro` grammar, the notification routes and
 * the on-call designee (CA.3, [#543](https://github.com/NobuData/ouroboros/issues/543)). One of
 * them refused costs its own card, or its own line, and leaves the rest of the page standing.
 */

import { chatops } from "@/app/api/chatops";
import type { ApiClient } from "@/app/api/client";
import { consoleApi } from "@/app/api/console";
import { type Reading, attempt } from "@/app/api/reading";
import { settingsIntegrations } from "@/app/api/settings-integrations";

import type { ChatOpsPage } from "./view";

/**
 * Read the connection, and everything beside it.
 *
 * @param client The client to call through. Defaults to the server-side one.
 * @param signal Aborts the reads.
 * @returns The page's payload.
 * @throws {ApiError} What the service answered for the connection. Any other read that was
 *   refused is kept as a value.
 */
export async function loadChatOps(client?: ApiClient, signal?: AbortSignal): Promise<ChatOpsPage> {
  const [connection, channels, grammar, routes, onCall] = await Promise.all([
    chatops.connection(client, signal),
    attempt(() => chatops.channels(client, signal)),
    attempt(() => consoleApi.grammar(client, signal)),
    attempt(() => settingsIntegrations.routes(client, signal)),
    attempt(() => chatops.onCall(client, signal)),
  ]);

  return { connection, channels, grammar, routes, onCall };
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
