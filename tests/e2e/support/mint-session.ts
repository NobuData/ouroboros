/**
 * A session for a production-mode stack, minted in the database (DJ.4,
 * [#1317](https://github.com/NobuData/ouroboros/issues/1317)).
 *
 * Production turns password sign-in off (`ouroboros-rest`'s `password.provider.ts`), and the only
 * other way in is GitHub, which a CI run cannot click through. So the production leg writes what a
 * sign-in would have written — a person, a workspace they own, and a session acting in it — and
 * presents the session the way BetterAuth issues it: `<token>.<signature>`, the signature the
 * HMAC-SHA-256 of the token under `BETTER_AUTH_SECRET`, base64, the whole URL-encoded.
 *
 * Throwaway stacks only: it writes to the stack's database through `docker compose exec`.
 */

import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { psql } from "./insights";

/** The secret `docker-compose.yml` gives `rest` when the environment names none. */
const DEFAULT_AUTH_SECRET = "dev-better-auth-secret-change-me";

/** A minted person, their workspace, and the cookie value that signs them in. */
export interface MintedProductionSession {
  readonly userId: string;
  readonly organizationId: string;
  /** The value of the `better-auth.session_token` cookie, signed and encoded. */
  readonly cookieValue: string;
}

/**
 * A SQL string literal.
 *
 * @param value Text with no quoting of its own.
 * @returns It, single-quoted with quotes doubled.
 */
function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Sign a session token as BetterAuth's cookie carries it.
 *
 * @param token The `session.token`.
 * @param secret `BETTER_AUTH_SECRET`.
 * @returns `encodeURIComponent("<token>.<base64 HMAC-SHA-256>")`.
 */
export function signedSessionCookie(token: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(token).digest("base64");

  return encodeURIComponent(`${token}.${signature}`);
}

/**
 * Write an approved person who owns a fresh workspace, and a session acting in it.
 *
 * @param label A word that makes the rows recognizable — the leg's name.
 * @returns The ids and the cookie value.
 */
export async function mintProductionSession(label: string): Promise<MintedProductionSession> {
  const suffix = randomUUID().slice(0, 8);
  const userId = `e2e-${label}-${suffix}`;
  const organizationId = `e2e-${label}-org-${suffix}`;
  const token = randomBytes(24).toString("base64url");

  await psql(`
    begin;
    insert into ouroboros."user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
      values (${literal(userId)}, 'Production Leg', ${literal(`${userId}@example.test`)}, true, now(), now());
    insert into ouroboros.organization ("id", "name", "slug", "createdAt")
      values (${literal(organizationId)}, 'Production Leg', ${literal(organizationId)}, now());
    insert into ouroboros.member ("id", "organizationId", "userId", "role", "createdAt")
      values (${literal(randomUUID())}, ${literal(organizationId)}, ${literal(userId)}, 'owner', now());
    insert into ouroboros.session ("id", "token", "userId", "expiresAt", "createdAt", "updatedAt",
                                   "activeOrganizationId")
      values (${literal(randomUUID())}, ${literal(token)}, ${literal(userId)},
              now() + interval '1 hour', now(), now(), ${literal(organizationId)});
    commit;`);

  return {
    userId,
    organizationId,
    cookieValue: signedSessionCookie(token, process.env.BETTER_AUTH_SECRET ?? DEFAULT_AUTH_SECRET),
  };
}
