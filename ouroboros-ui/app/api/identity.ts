/**
 * Identity: who is signed in, in this application's vocabulary rather than the library's.
 *
 * **These types were `app/api/session.ts`'s, and that module is gone**
 * ([#716](https://github.com/NobuData/ouroboros/issues/716)). It held the vocabulary and the
 * reads together over a hand-written transport; BetterAuth's own client
 * (`app/api/auth-client.ts`) is the transport now, and the reads composed on top of it are
 * `app/api/auth-server.ts`. What is left over is the part neither of those owns — the words
 * a *screen* uses — and it lives here, alone, for the reason `app/api/membership.ts` gives
 * for the same split: a pure view decision (`app/login/view.ts`), a component
 * (`app/login/login-screen.tsx`) and a server-only reader all name these types, and a
 * component that imported them from the reader would drag `server-only` into a client
 * bundle.
 *
 * So this file is **framework-free and value-free**: types and nothing else. Nothing here
 * reads a cookie, a header or the network, and nothing imports `next/*` or `better-auth`.
 *
 * The translation from the library's words into these ones happens once, in
 * `app/api/auth-server.ts`. BetterAuth says `name` and `image`; every screen in this module
 * says `displayName` and `avatarUrl`, because they are what the design system's monogram and
 * account menu are specified in terms of.
 *
 * @see app/api/membership.ts — the other half of the vocabulary: what a person holds, and
 *   which workspace a reference resolves to.
 */

import type { Membership } from "@/app/api/membership";

/** The signed-in person, in this application's vocabulary rather than the library's. */
export interface SessionUser {
  id: string;
  email: string;
  /** BetterAuth calls this `name`. */
  displayName: string;
  /** BetterAuth calls this `image`. `null` is what makes the UI draw a monogram. */
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A workspace whose registered email domain matches the person's address. Not membership.
 *
 * **Always `null` today, and the field is kept rather than removed.** It was the third part
 * of `GET /api/v1/auth/me`'s answer — *your organisation is already on Ouroboros, ask an
 * owner to add you* — and BetterAuth has no equivalent, because the question is about this
 * installation's tenant domains rather than about a session.
 * [#712](https://github.com/NobuData/ouroboros/issues/712)'s
 * `POST /api/v1/auth/discover` is where it moves, and
 * [#718](https://github.com/NobuData/ouroboros/issues/718) is what wires the screen to it.
 * Keeping the field means the one card that renders the state
 * (`app/login/workspace-card.tsx`) stays whole in the meantime, rendering nothing rather
 * than being deleted and rebuilt.
 */
export interface TenantSuggestion {
  tenantId: string;
  slug: string;
  displayName: string;
}

/** Who is signed in, the workspaces they belong to, and a suggestion when they have none. */
export interface Session {
  user: SessionUser;
  memberships: Membership[];
  tenantSuggestion: TenantSuggestion | null;
}
