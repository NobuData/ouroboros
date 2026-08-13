import { vi } from "vitest";

import { seededWorkspaces } from "./login";

/**
 * The browser's half of a session — what `app/api/auth-client.ts`'s hooks report, stubbed.
 *
 * The account menu ([#721](https://github.com/NobuData/ouroboros/issues/721)) is the one
 * surface in this module that reads the session *client-side*, so it is the one surface a
 * suite cannot set up by answering `fetch`: `useSession()` and `useListOrganizations()` are
 * stores, and what a suite wants to say is "this person, these workspaces, acting in that
 * one" rather than "these three requests resolve with these bodies".
 *
 * So the hooks are replaced instead, and this is the state they read. Every suite that
 * renders the shell needs it — the header and the shell itself both mount the menu — which is
 * why it is written once here.
 *
 * ```ts
 * vi.mock("@/app/api/auth-client", async () =>
 *   (await import("../helpers/account")).authClientModule(),
 * );
 * ```
 *
 * The vocabulary is **BetterAuth's**, not this application's: `name` and `image` rather than
 * `displayName` and `avatarUrl`, because that translation is `app/api/auth-server.ts`'s and
 * the browser's client never makes it. `app/shell/account.ts` is what reads the library's
 * words on this side, and these are the words it reads.
 */

/** The seeded person, as `get-session` reports them (`ouroboros-db/migrations/R__dev_seed.sql`). */
export const MENU_USER = {
  name: "Ken Suenobu",
  email: "ken@acme-robotics.dev",
  image: null as string | null,
};

/** One workspace, in the three fields `organization.list` gives the menu. */
export interface StubWorkspace {
  id: string;
  slug: string;
  name: string;
}

/**
 * The mockup's three workspaces, as the organization plugin lists them.
 *
 * Derived from `helpers/login.ts`'s `seededWorkspaces()` rather than written out again: the
 * ids are what a switch is asserted against and the slugs are what it draws, and two copies
 * of them would be two things to keep in step with the seed.
 *
 * @returns The three, oldest first — the listing's own order.
 */
export function menuWorkspaces(): StubWorkspace[] {
  return seededWorkspaces().map(({ id, slug, name }) => ({ id, slug, name }));
}

/** What one of the client's query stores reports. */
interface StubQuery<T> {
  data: T | null;
  isPending: boolean;
}

/**
 * `organization.setActive`, in the shape the menu calls it and the shape it answers.
 *
 * The answer is BetterAuth's `{data, error}` rather than a resolution or a rejection, which
 * is the third outcome `app/api/auth-client.ts`'s `unwrap` exists to collapse — so a case
 * that stubs a refusal is stubbing the same thing the service would have sent.
 */
type SetActive = (args: { organizationId: string }) => Promise<{
  data: unknown;
  error: { status?: number; code?: string; message?: string } | null;
}>;

/** The session and the workspace listing, as this case wants them answered. */
export interface AuthClientStub {
  /** `useSession()`. `data: null` with `isPending: false` is *nobody signed in*. */
  session: StubQuery<{
    user: typeof MENU_USER;
    session: { activeOrganizationId: string | null };
  }>;
  /** `useListOrganizations()`. */
  organizations: StubQuery<StubWorkspace[]>;
  /** `organization.setActive`, and what it answers. */
  setActive: ReturnType<typeof vi.fn<SetActive>>;
}

/**
 * The state the stubbed hooks read. Mutable, so a case says what it is about and re-renders.
 *
 * The default is the world every acceptance criterion is written against: Ken Suenobu, the
 * three seeded workspaces, acting in the first of them.
 */
export const authStub: AuthClientStub = {
  session: { data: null, isPending: false },
  organizations: { data: null, isPending: false },
  setActive: vi.fn<SetActive>(),
};

/**
 * Put the stub back to the signed-in default. Call it in `beforeEach`.
 *
 * @param activeOrganizationId Which workspace the session is acting in. Defaults to the
 *   first, which is what `ouroboros-rest` stamps a session with.
 */
export function signedIn(activeOrganizationId: string | null = menuWorkspaces()[0].id): void {
  authStub.session = {
    data: { user: { ...MENU_USER }, session: { activeOrganizationId } },
    isPending: false,
  };
  authStub.organizations = { data: menuWorkspaces(), isPending: false };
  authStub.setActive.mockReset();
  authStub.setActive.mockResolvedValue({ data: {}, error: null });
}

/** The state before any answer has arrived: the menu knows nothing yet. */
export function stillLoading(): void {
  authStub.session = { data: null, isPending: true };
  authStub.organizations = { data: null, isPending: true };
  authStub.setActive.mockReset();
}

/** A session that answered *nobody* — what the browser holds just after a sign-out. */
export function signedOut(): void {
  authStub.session = { data: null, isPending: false };
  authStub.organizations = { data: null, isPending: false };
  authStub.setActive.mockReset();
}

/**
 * The module `@/app/api/auth-client` is replaced by.
 *
 * Everything but the two hooks and `setActive` is the **real** module, so `unwrap` is the
 * translation the application actually ships rather than a second reading of `{data, error}`
 * written for the tests — which is the half of a refusal a suite most wants to be genuine.
 *
 * @returns The mocked module.
 */
export async function authClientModule(): Promise<Record<string, unknown>> {
  const actual =
    await vi.importActual<typeof import("@/app/api/auth-client")>("@/app/api/auth-client");

  return {
    ...actual,
    useSession: () => authStub.session,
    useListOrganizations: () => authStub.organizations,
    organization: { setActive: (args: { organizationId: string }) => authStub.setActive(args) },
  };
}
