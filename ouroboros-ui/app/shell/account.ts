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

import { ROLES, primaryRole, type Role } from "@/app/api/membership";

/** The signed-in person, in the words the menu draws them in. */
export interface MenuPerson {
  /** What to call them: their display name, or their address when they have no name. */
  readonly name: string;
  /** Their address, shown under the name — and the name itself when there is no other. */
  readonly email: string;
  /** Their picture, or `null`, which is what makes the menu draw a monogram instead. */
  readonly avatarUrl: string | null;
  /**
   * Their role in the acting workspace, or `null` while it is not known — the fetch still
   * in flight, failed, or there being no acting workspace to hold a role in. Null renders
   * as *nothing*, never as a guessed role: § 3.5's honesty rule, applied to a single word.
   */
  readonly role: Role | null;
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
  /**
   * `member.role` for the acting workspace, as `organization.getActiveMemberRole` answered
   * it — raw text, possibly a comma-separated list (the plugin's `addMember` accepts an
   * array and joins it), possibly carrying words this build does not know. `undefined` and
   * `null` both mean *not known*: the fetch has not answered, failed, or there is no acting
   * workspace. CP.3 ([#645](https://github.com/NobuData/ouroboros/issues/645)).
   */
  readonly activeRole?: string | null;
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
  activeRole,
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
      role: roleOf(activeRole, active),
    },
    workspaces,
    active,
    switchable: workspaces.some((workspace) => workspace.id !== active?.id),
  };
}

/**
 * The one word the identity block says about the acting workspace, or nothing.
 *
 * @param activeRole What the plugin answered, raw — see {@link AccountReading.activeRole}.
 * @param active The workspace the session is acting in, already resolved.
 * @returns The strongest role the text grants, through `primaryRole` — the same collapse
 *   the dashboard's subline makes, so "what am I here" reads identically everywhere. `null`
 *   when there is nothing honest to say: no acting workspace (a role is a role *in*
 *   somewhere), or an answer that has not arrived. The one asymmetry is deliberate: text
 *   naming only words this build does not know still collapses to `viewer`, because the
 *   service granted *something* and the least is the only safe reading of it — exactly
 *   `primaryRole`'s published contract.
 */
function roleOf(
  activeRole: string | null | undefined,
  active: MenuWorkspace | undefined,
): Role | null {
  if (active === undefined || activeRole == null) return null;

  const words = activeRole
    .split(",")
    .map((word) => word.trim())
    .filter((word): word is Role => ROLES.includes(word as Role));

  return primaryRole(words);
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

/**
 * The tenant chip's accessible name (H.1,
 * [#77](https://github.com/NobuData/ouroboros/issues/77)).
 *
 * The chip draws `acme-robotics / helios-firmware ▾` and the caret is decoration, so what a
 * screen reader would otherwise be given is two identifiers and no word saying what either
 * of them is. This is that word — and it **contains the visible text verbatim**, which is
 * WCAG 2.5.3's *Label in Name*: somebody driving the product by voice says what they can see,
 * and a name that paraphrased the chip would leave them naming a control that does not
 * answer to it.
 *
 * What kind of control it is comes from `aria-haspopup="menu"` on the button and is not
 * written into the name, so the word "menu" is announced once rather than twice.
 *
 * @param workspace The active workspace's slug, as the chip draws it.
 * @param repo The focus repository's name, or the words the chip uses for *all of them* —
 *   already decided by the caller, because the absence of a choice is the focus-repo store's
 *   fact and not this module's (`app/shell/focus-repo.ts`).
 * @returns The name.
 */
export function tenantChipLabel(workspace: string, repo: string): string {
  return `Workspace and focus repository: ${workspace} / ${repo}`;
}

/**
 * The tenant chip's tooltip — what the ellipsis is hiding
 * ([#650](https://github.com/NobuData/ouroboros/issues/650)).
 *
 * Both halves of the chip truncate (`shell.css`: `text-overflow: ellipsis` on
 * `.shell-tenant__org` and `.shell-tenant__repo`), and at the top of § 4's font-size range
 * they genuinely do: at 150% the header's other chrome leaves the chip about sixty pixels
 * short of the workspace slug alone. A screen reader is unaffected —
 * {@link tenantChipLabel} carries both names in full — but a **sighted pointer user** was
 * left with `acme-rob… / All rep…` and no way to see the rest, which is the exact failure
 * `docs/DESIGN_SYSTEM_APP_SHELL.md` § 4 answers with *truncation with tooltips*. The
 * readability audit measured it (`tests/e2e/support/readability.ts`) and this is the answer.
 *
 * It is the **visible text**, not the accessible name: a tooltip is read by somebody who
 * can already see the control and wants the characters the box cut off, so prefixing it
 * with *Workspace and focus repository* would make them read a sentence to find two words.
 * The name says what the control is; this says what it says.
 *
 * @param workspace The active workspace's slug, as the chip draws it.
 * @param repo The focus repository's name, or the words the chip uses for *all of them*.
 * @returns The tooltip.
 */
export function tenantChipTitle(workspace: string, repo: string): string {
  return `${workspace} / ${repo}`;
}
