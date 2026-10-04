/**
 * Rows for the members suites (#485).
 */

import type { InvitationRow, MemberRow } from "./members.repository";

/** The fixture workspace. */
export const M_ORG = "5eed0001-0000-4000-8000-000000000001";

/** An instant. */
export const M_AT = new Date("2026-10-03T12:00:00.000Z");

/**
 * A member row, overridable.
 *
 * @param overrides - Fields to change.
 * @returns The row.
 */
export function memberRow(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    member_id: "member-maya",
    user_id: "user-maya",
    name: "Maya Chen",
    email: "maya@acme.dev",
    image: null,
    role: "admin",
    joined_at: M_AT,
    last_active_at: null,
    can_approve_loops: null,
    ...overrides,
  };
}

/**
 * A pending invitation row, overridable.
 *
 * @param overrides - Fields to change.
 * @returns The row.
 */
export function invitationRow(overrides: Partial<InvitationRow> = {}): InvitationRow {
  return {
    id: "invite-priya",
    email: "priya@acme.dev",
    role: "member",
    status: "pending",
    created_at: new Date("2026-10-03T10:00:00.000Z"),
    expires_at: new Date("2026-10-05T10:00:00.000Z"),
    inviter_id: "user-ken",
    ...overrides,
  };
}
