/**
 * Every sentence and every decision of the Members & Roles card
 * (BS.3, [#493](https://github.com/NobuData/ouroboros/issues/493)) — as pure values and functions,
 * so a unit test reaches each one without rendering anything.
 *
 * ### Four row classes, one table, no blank-cell confusion
 *
 * Mockup 17's table holds four kinds of row, and each carries a different truth:
 *
 * - **a person** — avatar, name (with `you` on the caller's own row), a role, the capability,
 *   and a real *last active* from their newest session, or `—` when there is none;
 * - **a service account** — the service avatar, a mono name, `Service`, never the capability (a
 *   bot holds no person's approval power), and when its token last authenticated;
 * - **a pending invitation** — dimmed, the address, the role it will join with, *invited 2h ago*
 *   where the capability would be (it is not a member, so it has none), and Resend / Revoke.
 *
 * {@link cardRows} composes them in the mockup's order: people, then service accounts, then
 * invitations.
 *
 * ### What the card refuses to say
 *
 * - **No fabricated activity.** A `null` timestamp is `—`, never `now`.
 * - **No Okta promise.** The footer's sync line exists only when the service reports a real
 *   directory sync ({@link directorySyncLine}); until SCIM (BT.1) ships it reports none, and an
 *   administrator who read *"Roles sync from Okta nightly ✓"* would believe removing someone from
 *   a group removes them here.
 * - **No casual permission change.** The capability column is a permission editor; its
 *   consequence ({@link CAPABILITY_CONSEQUENCE}) is attached to the control before it is used.
 */

import type {
  MemberDisplayRole,
  MemberInvitation,
  MembersPage,
  OrganizationRole,
  ServiceAccount,
  ServiceMember,
  ServiceScopeName,
  WorkspaceMember,
} from "@/app/api/settings-members";

/* ------------------------------------------------------------------------------ the card */

/** The card's title — the settings section's own. */
export const MEMBERS_TITLE = "Members & roles";

/** The head's action. */
export const INVITE_LABEL = "+ Invite member";

/** The table's caption, for a screen reader; the card title is what a sighted reader sees. */
export const MEMBERS_CAPTION = "Members, service accounts and pending invitations";

/** The four column headers, in the mockup's order. */
export const MEMBER_COLUMNS = {
  member: "Member",
  role: "Role",
  capability: "Can approve loops",
  lastActive: "Last active",
} as const;

/** The tag on the caller's own row. */
export const YOU_TAG = "you";

/** The capability column's two read-only marks. */
export const CAPABILITY_YES = "✓";
export const CAPABILITY_NO = "—";

/** What a missing timestamp is drawn as — never a guess. */
export const NEVER = "—";

/** The service row's avatar glyph. */
export const SERVICE_GLYPH = "⚙︎";

/** What the card says when its read failed. */
export function membersUnread(reason: string): string {
  return `The members of this workspace could not be read. ${reason}`;
}

/* ------------------------------------------------------------------------------- roles */

/** One choice of the invite and role pickers. */
export interface RoleChoice {
  /** What the card prints — decision S3's label. */
  readonly label: Exclude<MemberDisplayRole, "Service">;
  /** What the service is sent. */
  readonly role: OrganizationRole;
  /** What the role may do, in the hierarchy footer's words. */
  readonly note: string;
}

/**
 * The three roles a person can be given here. **Viewer sends `viewer`** (decided with the user):
 * the plugin's `member` also displays as Viewer, and a member keeps that role until somebody
 * changes it, but the card never assigns it.
 */
export const ROLE_CHOICES: readonly RoleChoice[] = [
  { label: "Owner", role: "owner", note: "everything, including deleting the workspace" },
  { label: "Maintainer", role: "admin", note: "approve/merge, and every setting but deletion" },
  { label: "Viewer", role: "viewer", note: "read-only" },
];

/** The role an invitation starts on — the least that is useful. */
export const DEFAULT_INVITE_ROLE: OrganizationRole = "viewer";

/**
 * The choice a member currently holds, for preselecting the picker.
 *
 * @param display The member's display role.
 * @returns The matching choice's role.
 */
export function choiceOf(display: MemberDisplayRole): OrganizationRole {
  return ROLE_CHOICES.find((choice) => choice.label === display)?.role ?? DEFAULT_INVITE_ROLE;
}

/**
 * The label for a plugin role.
 *
 * @param role The role.
 * @returns `Owner`, `Maintainer` or `Viewer`.
 */
export function roleLabel(role: OrganizationRole): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Maintainer";
  return "Viewer";
}

/**
 * The strongest of a member's plugin roles — what a change is measured from.
 *
 * @param roles The roles.
 * @returns `owner`, `admin`, `member` or `viewer`; `viewer` for none.
 */
export function strongestRole(roles: readonly OrganizationRole[]): OrganizationRole {
  for (const role of ["owner", "admin", "member", "viewer"] as const) {
    if (roles.includes(role)) return role;
  }
  return "viewer";
}

/** Why the Owner choice is unavailable to an admin. */
export const OWNER_ONLY_REASON = "Only an owner can make someone an owner.";

/**
 * Whether a member is the workspace's last owner — the one the service will not demote or remove.
 *
 * @param member The member.
 * @param members Everyone in the workspace.
 * @returns `true` when they hold `owner` and nobody else does.
 */
export function isLastOwner(member: WorkspaceMember, members: readonly WorkspaceMember[]): boolean {
  return (
    member.roles.includes("owner") &&
    members.filter((other) => other.roles.includes("owner")).length <= 1
  );
}

/** Why the last owner's role cannot be changed — the service's own sentence. */
export const LAST_OWNER_DEMOTE =
  "This is the workspace's last owner. Make someone else an owner before changing this role.";

/** Why the last owner cannot be removed — the service's own sentence. */
export const LAST_OWNER_REMOVE =
  "This is the workspace's last owner. Make someone else an owner before removing them.";

/* -------------------------------------------------------------------------- the capability */

/** What ticking or unticking **Can approve loops** does — stated before it is used. */
export const CAPABILITY_CONSEQUENCE =
  "Grants approve and merge: answering approval items in the Needs-You inbox, and approving, " +
  "waiving, arming and merging on pull requests. Unticking removes it at once.";

/** Why a service account never holds the capability. */
export const SERVICE_NO_CAPABILITY = "Service accounts never approve or merge loops.";

/**
 * The checkbox's accessible name.
 *
 * @param name The member's name.
 * @returns `Can approve loops: Maya Chen`.
 */
export function capabilityLabel(name: string): string {
  return `${MEMBER_COLUMNS.capability}: ${name}`;
}

/**
 * What the toast says once a capability change landed.
 *
 * @param name The member's name.
 * @param granted The new value.
 * @returns The sentence.
 */
export function capabilityChanged(name: string, granted: boolean): string {
  return granted
    ? `${name} can now approve and merge loops.`
    : `${name} can no longer approve or merge loops.`;
}

/**
 * What the toast says when a capability change was refused, and the box went back.
 *
 * @param name The member's name.
 * @param reason The service's sentence.
 * @returns The sentence.
 */
export function capabilityRefused(name: string, reason: string): string {
  return `${name}'s approval capability was not changed. ${reason}`;
}

/* ------------------------------------------------------------------------------ time */

/**
 * A timestamp as the table's *Last active* prints it: `now`, `41s`, `12m`, `2h`, `3d`.
 *
 * @param at The instant, or `null` when there is none.
 * @param now What to measure against.
 * @returns The relative age, or `—` for no timestamp — never a fabricated one.
 */
export function relativeAge(at: string | null, now: number): string {
  if (at === null) return NEVER;

  const then = Date.parse(at);
  if (Number.isNaN(then)) return NEVER;

  const seconds = Math.max(0, Math.floor((now - then) / 1000));

  if (seconds < 10) return "now";
  if (seconds < 60) return `${String(seconds)}s`;
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))}m`;
  if (seconds < 86_400) return `${String(Math.floor(seconds / 3600))}h`;
  return `${String(Math.floor(seconds / 86_400))}d`;
}

/**
 * What a pending row says where the capability would be.
 *
 * @param invitation The invitation.
 * @param now What to measure against.
 * @returns `invited 2h ago`, `invited just now`, or that it expired.
 */
export function invitedAgo(invitation: MemberInvitation, now: number): string {
  const age = relativeAge(invitation.invitedAt, now);
  const when = age === "now" ? "invited just now" : `invited ${age} ago`;

  return invitation.expired ? `${when} · expired` : when;
}

/* ------------------------------------------------------------------------------ avatars */

/**
 * A mini-avatar's monogram.
 *
 * @param name A name, or an address for an invitation.
 * @returns Up to two letters: `Ken S` → `KS`, `priya@acme.dev` → `P`.
 */
export function initials(name: string): string {
  const base = name.includes("@") ? name.slice(0, 1) : name;
  const letters = base
    .split(/\s+/)
    .filter((word) => word !== "")
    .map((word) => word[0] ?? "")
    .join("");

  return letters.slice(0, 2).toUpperCase();
}

/* ------------------------------------------------------------------------------ rows */

/** One table row, of one of the three kinds. */
export type CardRow =
  | { readonly kind: "member"; readonly key: string; readonly member: WorkspaceMember }
  | { readonly kind: "service"; readonly key: string; readonly account: ServiceRowModel }
  | { readonly kind: "invitation"; readonly key: string; readonly invitation: MemberInvitation };

/**
 * The table's rows in the mockup's order: people, service accounts, then pending invitations.
 *
 * @param members The people.
 * @param services The service accounts.
 * @param invitations The pending invitations.
 * @returns The rows, each keyed uniquely across kinds.
 */
export function cardRows(
  members: readonly WorkspaceMember[],
  services: readonly ServiceRowModel[],
  invitations: readonly MemberInvitation[],
): CardRow[] {
  return [
    ...members.map((member): CardRow => ({ kind: "member", key: `member:${member.id}`, member })),
    ...services.map((account): CardRow => ({
      kind: "service",
      key: `service:${account.id}`,
      account,
    })),
    ...invitations.map((invitation): CardRow => ({
      kind: "invitation",
      key: `invite:${invitation.id}`,
      invitation,
    })),
  ];
}

/* ------------------------------------------------------------------------------ footer */

/**
 * The directory-sync half of the footer.
 *
 * @param sync What the service reported — `null` until SCIM (BT.1) syncs for real.
 * @param now What to measure the last sync against.
 * @returns The line, or `null` — the line is **absent**, never a placeholder, until sync is real.
 */
export function directorySyncLine(
  sync: MembersPage["footer"]["directorySync"],
  now: number,
): string | null {
  if (sync === null) return null;

  return (
    `Roles sync from ${sync.provider} group ${sync.groupPattern} ${sync.cadence} ✓ · ` +
    `last synced ${relativeAge(sync.lastSyncedAt, now)} ago`
  );
}

/* ------------------------------------------------------------------------------ dialogs */

/** The invite dialog. */
export const INVITE_TITLE = "Invite a member";
export const INVITE_EMAIL = "Email";
export const INVITE_ROLE = "Role";
export const INVITE_SEND = "Send invitation";
export const INVITE_SENDING = "Inviting…";
export const INVITE_NOTE =
  "They join with this role when they accept. Until then the invitation is a dimmed row you can " +
  "resend or revoke.";
export const CANCEL = "Cancel";

/**
 * What the toast says once an invitation exists.
 *
 * @param email The address.
 * @returns The sentence.
 */
export function invited(email: string): string {
  return `Invitation sent to ${email}.`;
}

/** A pending row's two actions. */
export const RESEND = "Resend";
export const REVOKE = "Revoke";

/**
 * The accessible names of a pending row's actions.
 *
 * @param action `Resend` or `Revoke`.
 * @param email The address.
 * @returns `Resend invitation to priya@acme.dev`.
 */
export function invitationActionLabel(action: "Resend" | "Revoke", email: string): string {
  return `${action} invitation to ${email}`;
}

/**
 * What the toast says after a resend or a revoke.
 *
 * @param action Which.
 * @param email The address.
 * @returns The sentence.
 */
export function invitationDone(action: "resend" | "revoke", email: string): string {
  return action === "resend"
    ? `Invitation to ${email} resent — it is good for another week.`
    : `Invitation to ${email} revoked.`;
}

/** The member dialog. */
export const MANAGE_TITLE = "Change role or remove";
export const ROLE_SAVE = "Change role";
export const ROLE_SAVING = "Saving…";
export const ROLE_UNCHANGED = "Choose a different role first.";
export const REMOVE_LABEL = "Remove from workspace";
export const REMOVE_CONFIRM = "Yes, remove";
export const REMOVING = "Removing…";

/**
 * The role cell's button name for an administrator.
 *
 * @param name The member's name.
 * @param label Their role's label.
 * @returns `Change role or remove: Maya Chen (Maintainer)`.
 */
export function manageLabel(name: string, label: string): string {
  return `${MANAGE_TITLE}: ${name} (${label})`;
}

/**
 * The confirmation for a change that takes power away — the destructive kind.
 *
 * @param name The member's name.
 * @param from The role they hold.
 * @param to The role they would get.
 * @returns The sentence, or `null` when the change only adds power and needs no confirmation.
 */
export function demotionWarning(
  name: string,
  from: OrganizationRole,
  to: OrganizationRole,
): string | null {
  const rank: Record<OrganizationRole, number> = { owner: 3, admin: 2, member: 1, viewer: 1 };

  if (rank[to] >= rank[from]) return null;

  return `${name} goes from ${roleLabel(from)} to ${roleLabel(to)} at once, losing what that role allowed.`;
}

/**
 * The removal confirmation.
 *
 * @param name The member's name.
 * @returns The sentence.
 */
export function removeWarning(name: string): string {
  return `${name} loses access to this workspace at once. Their audit history stays.`;
}

/**
 * What the toast says after a role change or a removal.
 *
 * @param name The member's name.
 * @param role The new role, or `null` for a removal.
 * @returns The sentence.
 */
export function memberChanged(name: string, role: OrganizationRole | null): string {
  return role === null ? `${name} was removed.` : `${name} is now ${roleLabel(role)}.`;
}

/* ------------------------------------------------------------------------- service accounts */

/** The section under the table. */
export const SERVICE_TITLE = "Service accounts";
export const SERVICE_CREATE = "+ Create service account";
export const SERVICE_CREATE_TITLE = "Create a service account";
export const SERVICE_NONE = "No service accounts. A bot that calls the API gets one here.";
export const SERVICE_NAME = "Name";
export const SERVICE_NAME_HINT =
  "3–40 lower-case letters, digits or hyphens, starting with a letter.";
export const SERVICE_SCOPES = "Scopes";
export const SERVICE_SUBMIT = "Create and show token";
export const SERVICE_CREATING = "Creating…";
export const SERVICE_SCOPES_REQUIRED = "Choose at least one scope.";
export const SERVICE_NAME_INVALID =
  "Use 3–40 lower-case letters, digits or hyphens, starting with a letter.";

/** The service's own name rule, checked before sending. */
export const SERVICE_NAME_PATTERN = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/** The row's two actions. */
export const ROTATE = "Rotate";
export const REVOKE_ACCOUNT = "Revoke";

/**
 * The accessible names of a service row's actions.
 *
 * @param action `Rotate` or `Revoke`.
 * @param name The account.
 * @returns `Rotate devops-bot's token`.
 */
export function serviceActionLabel(action: "Rotate" | "Revoke", name: string): string {
  return action === "Rotate" ? `Rotate ${name}'s token` : `Revoke ${name}`;
}

/**
 * The rotation confirmation.
 *
 * @param name The account.
 * @returns The sentence.
 */
export function rotateWarning(name: string): string {
  return (
    `${name}'s current token stops working the moment the new one is shown. ` +
    "Anything using it must be given the new token."
  );
}

/**
 * The revocation confirmation.
 *
 * @param name The account.
 * @returns The sentence.
 */
export function revokeWarning(name: string): string {
  return `${name}'s token stops working at once and the account is disabled. This cannot be undone — create a new account instead.`;
}

export const ROTATE_CONFIRM = "Rotate and show new token";
export const REVOKE_CONFIRM = "Yes, revoke";
export const WORKING = "Working…";

/**
 * What the toast says after a revocation.
 *
 * @param name The account.
 * @returns The sentence.
 */
export function revoked(name: string): string {
  return `${name} was revoked.`;
}

/**
 * The scopes, as a row prints them.
 *
 * @param scopes The account's scopes.
 * @returns `api.read · farm.submit`.
 */
export function scopeList(scopes: readonly ServiceScopeName[]): string {
  return scopes.join(" · ");
}

/**
 * When a token last authenticated, as the service row says it.
 *
 * @param at The instant, or `null`.
 * @param now What to measure against.
 * @returns `used 41s ago`, or `never used`.
 */
export function lastUsed(at: string | null, now: number): string {
  if (at === null) return "never used";

  const age = relativeAge(at, now);

  return age === "now" ? "used just now" : `used ${age} ago`;
}

/** One service account as the section draws it, from whichever read the reader may make. */
export interface ServiceRowModel {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly ServiceScopeName[];
  readonly lastUsedAt: string | null;
  /** The masked token (`orb_svc_••••ab12`) — only an administrator's read carries it. */
  readonly hint: string | null;
}

/**
 * The service section's rows: an administrator's full list when it was read, otherwise the
 * members page's `Service` rows (which carry no hint — a viewer never sees one).
 *
 * @param list The administrator's list, or `null`.
 * @param fallback The members page's service rows.
 * @returns The rows, enabled accounts only.
 */
export function serviceRows(
  list: readonly ServiceAccount[] | null,
  fallback: readonly ServiceMember[],
): ServiceRowModel[] {
  if (list === null) {
    return fallback.map((account) => ({
      id: account.id,
      name: account.name,
      scopes: account.scopes,
      lastUsedAt: account.lastActiveAt,
      hint: null,
    }));
  }

  return list
    .filter((account) => account.disabledAt === null)
    .map((account) => ({
      id: account.id,
      name: account.name,
      scopes: account.scopes,
      lastUsedAt: account.token?.lastUsedAt ?? null,
      hint: account.token?.hint ?? null,
    }));
}

/* --------------------------------------------------------------------- the one-time token */

/** The one-time display (#229's discipline). */
export const TOKEN_TITLE = "Copy this token now";
export const TOKEN_WARNING =
  "This is the only time this token is shown — you will not see it again. If it is lost, " +
  "rotate the account to get a new one.";
export const TOKEN_DONE = "I have copied it";

/**
 * The token dialog's lead.
 *
 * @param name The account.
 * @param rotated Whether this token replaced an older one.
 * @returns The sentence.
 */
export function tokenLead(name: string, rotated: boolean): string {
  return rotated
    ? `${name} has a new token. The previous one has already stopped working.`
    : `${name} was created. Use the token as Authorization: Bearer <token>.`;
}

/* ------------------------------------------------------------------------------ refusals */

/**
 * A write's outcome, as the card's Server Actions answer it: what the service returned, or the
 * sentence that says why not (kept here because a `"use server"` module exports only functions).
 */
export type MembersWrite<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string; readonly code: string | null };

/** What a write that could not reach the service, or got no sentence, says. */
export const WRITE_FAILED = "The change could not be made. Nothing was changed — try again.";

/**
 * The sentence for a refusal.
 *
 * @param message The service's message, possibly empty.
 * @returns The message, or {@link WRITE_FAILED}.
 */
export function refusalSentence(message: string): string {
  return message.trim() === "" ? WRITE_FAILED : message;
}
