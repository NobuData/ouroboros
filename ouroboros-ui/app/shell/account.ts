/**
 * What the account menu shows, decided from the browser's session and nothing else.
 *
 * The menu is a Client Component because it is a menu — it opens, it closes, it moves focus —
 * and once it was one anyway, the session it draws is the *browser's*
 * (`app/api/auth-client.ts`'s `useSession`) rather than a value threaded down from a Server
 * Component. That is the choice `app/(app)/layout.tsx` argues for from the other side: a
 * layout does not re-render on a client-side navigation, so a session read there would be one
 * more thing that can be stale, and the shell would have to wait for it before it could draw
 * a `loading.tsx` beneath itself.
 *
 * What is left over is this file: the decisions that would otherwise be conditions inside
 * JSX. It is **framework-free and value-free** in the way `app/login/view.ts` and
 * `app/api/membership.ts` are — no `next/*`, no `better-auth`, no fetch — so each outcome is
 * something a test can name without a DOM.
 *
 * ### The inputs are deliberately wider than the library's types
 *
 * Every field below is optional or nullable, and that is not defensiveness for its own sake:
 * `useSession()` reports *pending* as `data: null`, the organization plugin reports a listing
 * it has not fetched the same way, and BetterAuth's own session type leaves
 * `activeOrganizationId` off the base session and lets the plugin widen it — which
 * `app/api/auth-server.ts` already reads defensively for the same reason. Taking the loose
 * shape here means the component hands over what it has and this module decides what that
 * amounts to.
 */

/** The signed-in person, in the words the menu draws them in. */
export interface MenuPerson {
  /** What to call them: their display name, or their address when they have no name. */
  readonly name: string;
  /** Their address, shown under the name — and the name itself when there is no other. */
  readonly email: string;
  /** Their picture, or `null`, which is what makes the menu draw a monogram instead. */
  readonly avatarUrl: string | null;
}

/**
 * One workspace the menu can name, and switch to.
 *
 * The organization plugin's own row (`organization.list`), narrowed to the three fields a
 * menu has any use for. It is **not** `app/api/membership.ts`'s `Membership`: that is
 * `GET /api/v1/orgs`'s row model — roles, repository counts, the monogram — which the login
 * screen's step 2 renders and a one-line menu entry has nothing to do with. See
 * `app/api/auth-client.ts` for why the two listings are both right.
 */
export interface MenuWorkspace {
  /** The organization's id — what `organization.setActive` is called with. */
  readonly id: string;
  /** Its slug, which is the name every mockup writes in a row like this one. */
  readonly slug: string;
  /** Its display name. Not drawn today; carried so a wider row needs no new read. */
  readonly name: string;
}

/** What the menu draws. */
export type AccountView =
  /** The session has not answered yet. The menu opens; it just has nothing to say. */
  | { readonly state: "pending" }
  /**
   * The session answered *nobody*.
   *
   * Unreachable from inside the shell, because every screen in `app/(app)` goes through
   * `requireWorkspace()` first — but it is what the browser holds in the moment between a
   * sign-out and the navigation that follows it, and a menu that rendered a stale name then
   * would be the one place in the product still claiming somebody is signed in.
   */
  | { readonly state: "signed-out" }
  /** Somebody is signed in. */
  | {
      readonly state: "signed-in";
      /** Who. */
      readonly person: MenuPerson;
      /** Every workspace they belong to, in the order the service listed them. */
      readonly workspaces: readonly MenuWorkspace[];
      /**
       * The one the session is acting in — `session."activeOrganizationId"` resolved against
       * the listing above.
       *
       * `undefined` is possible and is not a bug: the pointer is a reference rather than a
       * fact (`app/api/identity.ts`), the listing may not have arrived yet, and a session may
       * point at a workspace somebody has since been removed from.
       */
      readonly active: MenuWorkspace | undefined;
      /** Whether there is anywhere to switch *to* — see {@link accountView}. */
      readonly switchable: boolean;
    };

/** The session and the workspace listing, as loosely as the client reports them. */
export interface AccountReading {
  /** `useSession().data?.user`. */
  readonly user:
    | { readonly name?: string | null; readonly email?: string | null; readonly image?: string | null }
    | null
    | undefined;
  /** `useSession().data?.session.activeOrganizationId`. */
  readonly activeOrganizationId: string | null | undefined;
  /** `useListOrganizations().data`. `null` covers *not fetched* and *failed* alike. */
  readonly organizations:
    | readonly { readonly id: string; readonly slug: string; readonly name: string }[]
    | null
    | undefined;
  /** `useSession().isPending` — whether the answer is still on its way. */
  readonly pending: boolean;
}

/**
 * Decide what the account menu shows.
 *
 * **`switchable` is the one judgement here.** It is *not* "more than one workspace": it is
 * whether there is a workspace the session is not already acting in, which is the same rule
 * the login screen's step 2 keeps when it replaces a radio group of one with a hidden field —
 * "a radio group of one is a control that cannot be changed, and the design system's honesty
 * rule (§ 3.5) is against drawing one" (`app/login/enablement-card.tsx`). The two differ in
 * exactly one case, and it is a real one: somebody who belongs to a single workspace their
 * session is *not* pointing at can still move into it, so the switch is offered.
 *
 * @param reading The session and the workspace listing, as the client reports them.
 * @returns The view to draw.
 */
export function accountView({
  user,
  activeOrganizationId,
  organizations,
  pending,
}: AccountReading): AccountView {
  if (user === null || user === undefined) {
    return pending ? { state: "pending" } : { state: "signed-out" };
  }

  const email = user.email ?? "";
  const workspaces = (organizations ?? []).map(({ id, slug, name }) => ({ id, slug, name }));
  const active = workspaces.find((workspace) => workspace.id === activeOrganizationId);

  return {
    state: "signed-in",
    person: {
      // The address stands in for a missing name, which is the fallback the login card's own
      // identity line already makes (`app/login/sign-in-card.tsx`).
      name: user.name?.trim() || email,
      email,
      // An empty `image` is an absence rather than a picture at the empty URL, and `""` in
      // an `<img src>` re-requests the current page in every browser.
      avatarUrl: user.image?.trim() || null,
    },
    workspaces,
    active,
    switchable: workspaces.some((workspace) => workspace.id !== active?.id),
  };
}

/**
 * The avatar button's accessible name.
 *
 * The button is an icon, so its name is the only thing a screen reader has to go on — and it
 * is the one place the menu's *contents* can be announced without opening it. Naming the
 * person and the workspace here is what makes "the menu reflects the seeded user" true for
 * somebody who never sees it.
 *
 * @param view What the menu would draw.
 * @returns `"Account menu"`, extended with whatever is known. Always begins with those two
 *   words, so the control is findable by the same name in every state.
 */
export function accountMenuLabel(view: AccountView): string {
  if (view.state === "pending") return "Account menu";
  if (view.state === "signed-out") return "Account menu — not signed in";

  const where = view.active === undefined ? "" : `, ${view.active.slug}`;

  return `Account menu — ${view.person.name}${where}`;
}
