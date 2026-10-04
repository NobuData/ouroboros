/**
 * Who may do what on the settings hub, decided once
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)).
 *
 * The page has three variants and the issue names them: a **viewer** reads all of it and
 * changes none of it, an **admin** works everything except the owner-only operations, and an
 * **owner** works everything. The frame turns the roles the service reported for this person in
 * this workspace into one of those three, here, so the head, the save model and every card ask
 * one question of one value instead of each reading a role and concluding something slightly
 * different.
 *
 * ### This is presentation; the payloads and the service decide
 *
 * Nothing here is enforcement — every write behind this page is `@Roles(...)` at the service,
 * and a Server Action is a POST anybody can reach. And nothing here overrides a card's own
 * payload: `GET /api/v1/settings/workspace` says per field whether it is `editable` and why
 * not, `GET /api/v1/settings/members` carries `canManage`, and a card renders *those*. The tier
 * is for what no payload describes — whether the head offers **Save changes** at all, and
 * whether the dirty state can hold an edit — and it is derived from the same membership the
 * service reported (`app/api/membership.ts`), so it cannot name a role the service did not.
 *
 * `member` reads like `viewer` here. The Members card's display mapping says the same thing
 * (`member`/`viewer → Viewer`), and the contract's rule is one sentence: administering a
 * workspace is `owner` or `admin`.
 *
 * Framework-free and pure.
 */

import { type Role, mayAdminister, primaryRole } from "@/app/api/membership";

/** The page's three variants. */
export type SettingsTier =
  /** Everything, including the owner-only operations (delete, restore). */
  | "owner"
  /** Everything except the owner-only operations. */
  | "admin"
  /** The whole page, legible, with nothing to operate. */
  | "read-only";

/** What the frame hands the page about its reader. */
export interface SettingsAccess {
  /** Which variant of the page this reader gets. */
  readonly tier: SettingsTier;
  /** The reader's strongest role, to be **named** in the read-only note — never decided from. */
  readonly role: Role;
  /** Whether this reader may change settings at all: `owner` or `admin`. */
  readonly mayEdit: boolean;
  /** Whether this reader may run the owner-only operations. */
  readonly mayOwn: boolean;
}

/**
 * The page's variant for a membership's roles.
 *
 * Errs low, in `mayAdminister`'s direction and for its reason: an empty list, or one holding
 * only roles this installation does not recognise, is read-only — a page that guessed high
 * would draw a control the service then refuses.
 *
 * @param roles The roles from the active membership.
 * @returns The tier, the role to name, and the two questions the page asks of them.
 */
export function settingsAccess(roles: readonly Role[]): SettingsAccess {
  const role = primaryRole(roles);
  const mayOwn = roles.includes("owner");
  const mayEdit = mayAdminister(roles);

  return {
    tier: mayOwn ? "owner" : mayEdit ? "admin" : "read-only",
    role,
    mayEdit,
    mayOwn,
  };
}

/** What a reader with nothing to operate finds where the head's **Save changes** would be. */
export const READ_ONLY_ACCESS: SettingsAccess = settingsAccess([]);

/** The two parts of the read-only note: who the reader is here, and what follows from it. */
export interface ReadOnlyNote {
  /** *Viewing workspace settings as a viewer.* */
  readonly head: string;
  /** What that means for this page. */
  readonly body: string;
}

/** What every read-only reader is told, whatever their role is called. */
export const READ_ONLY_BODY =
  "Every setting on this page can be read. Changing one takes an owner or an admin.";

/**
 * The sentence a reader who may look and not change is given, once, under the tab row.
 *
 * It names the role and says what is true — everything is readable — rather than leaving a
 * page of controls that do nothing to imply something is broken. The shape is the mounted
 * pages' own (`app/sources/states.ts`), so the section says it one way.
 *
 * @param role The reader's strongest role — `member` or `viewer`, for a reader this is drawn for.
 * @returns The note's two parts.
 */
export function readOnlyNote(role: Role): ReadOnlyNote {
  return { head: `Viewing workspace settings as a ${role}.`, body: READ_ONLY_BODY };
}
