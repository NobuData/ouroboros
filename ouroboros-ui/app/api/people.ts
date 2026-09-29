import "server-only";

/**
 * The workspace's people, by id — what turns the user id on a record into a name beside it.
 *
 * The service names who did something by user id: who minted an enrollment token (AI.3,
 * [#258](https://github.com/NobuData/ouroboros/issues/258)), who classified a failure
 * ([#340](https://github.com/NobuData/ouroboros/issues/340)). The names are the auth family's,
 * read here once for both.
 *
 * **A name is decoration.** A members listing that failed is `null`, so a caller prints that the
 * name was not read — never a *former member* claimed over somebody who was merely not looked up.
 */

import { currentAccess } from "@/app/api/access";
import { AuthError } from "@/app/api/auth-client";
import { members } from "@/app/api/members";

/**
 * How many members are read for their names. The auth service answers the whole membership
 * and `members.list` windows it, so this is a ceiling on the lookup rather than a page size.
 */
const MEMBER_WINDOW = 1000;

/**
 * Display names by user id, or `null` when the members could not be read.
 *
 * A member with no display name is listed under their address: a row that says *who* is the
 * point, and an address is who.
 *
 * @returns The lookup.
 * @throws Whatever is not an `AuthError` — Next.js's redirect signal above all.
 */
export async function readPeople(): Promise<Record<string, string> | null> {
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
