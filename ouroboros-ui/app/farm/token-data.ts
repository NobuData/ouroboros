import "server-only";

/**
 * One read of the workspace's enrollment tokens, with the names a row needs beside it
 * (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258)).
 *
 * The token list has two homes — a sheet on `/build-farm` and the settings section's **Farm
 * tokens** tab (decision S2, the amendment on #258) — and one reader, this one: the settings
 * route calls it for its first paint, and `app/farm/enroll-actions.ts` calls it for the sheet
 * and for every refresh, so both draw one listing in one shape.
 *
 * ### Three reads, and only one of them can fail the list
 *
 * A token names its pool by id and its minter by user id, so the rows need the pools' names and
 * the members' beside them. Those two are decoration: a pools or a members listing that failed
 * leaves an em dash in a column (`NAME_UNREAD`), never a list that cannot be read — and never a
 * *deleted pool* or a *former member* claimed over something that was merely not read. The
 * tokens' own read is the one the list cannot survive, and its refusal is a sentence.
 *
 * **Nothing here is secret.** Every token the service lists is masked; there is no operation
 * that answers one un-masked.
 */

import { currentAccess } from "@/app/api/access";
import { AuthError } from "@/app/api/auth-client";
import { isApiError } from "@/app/api/errors";
import { farm } from "@/app/api/farm";
import { members } from "@/app/api/members";

import {
  FORBIDDEN_CODE,
  TOKENS_FORBIDDEN,
  TOKENS_UNAVAILABLE,
  type TokenListing,
  poolNames,
} from "./enroll";

/**
 * How many members are read for their names. The auth service answers the whole membership
 * and `members.list` windows it, so this is a ceiling on the lookup rather than a page size.
 */
const MEMBER_WINDOW = 1000;

/**
 * Pool names by id, or `null` when the pools could not be read.
 *
 * @returns The lookup.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
async function readPoolNames(): Promise<Record<string, string> | null> {
  try {
    return poolNames(await farm.pools());
  } catch (error) {
    if (!isApiError(error)) throw error;

    return null;
  }
}

/**
 * Display names by user id, or `null` when the members could not be read.
 *
 * A member with no display name is listed under their address: a row that says *who* is the
 * point, and an address is who.
 *
 * @returns The lookup.
 */
async function readPeople(): Promise<Record<string, string> | null> {
  const { membership } = await currentAccess();
  if (membership === undefined) return null;

  try {
    const page = await members.list(membership.id, { limit: MEMBER_WINDOW });

    return Object.fromEntries(
      page.items.flatMap((member) => {
        const name = member.displayName ?? member.email;

        return name === null ? [] : [[member.userId, name]];
      }),
    );
  } catch (error) {
    // The members come from the auth family, which refuses with its own error. A name is
    // decoration — see the module note — so a refusal is `null`; the redirect signal travels.
    if (!(error instanceof AuthError)) throw error;

    return null;
  }
}

/**
 * Read the listing.
 *
 * @param now The clock. Defaults to the real one; a suite passes one to hold `readAt` still.
 * @returns The tokens with their lookups, or the sentence to show instead. **It does not throw
 *   for a refusal** — a member who reaches this gets `TOKENS_FORBIDDEN`, not an error screen.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function readTokenListing(now: () => number = Date.now): Promise<TokenListing> {
  try {
    // The tokens first and alone: a refused listing must not cost two more reads, and a member
    // who is refused here is refused before anything about the workspace's people is fetched.
    const tokens = await farm.tokens();
    const [pools, people] = await Promise.all([readPoolNames(), readPeople()]);

    return { ok: true, tokens, pools, people, readAt: now() };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      reason: error.code === FORBIDDEN_CODE ? TOKENS_FORBIDDEN : TOKENS_UNAVAILABLE,
    };
  }
}
