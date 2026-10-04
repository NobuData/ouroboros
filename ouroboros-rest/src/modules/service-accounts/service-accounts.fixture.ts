/**
 * In-memory stand-ins for the service-accounts suites (#485).
 */

import type { ServiceAccountRow } from "./service-accounts.repository";

/** The fixture workspace's id. */
export const SA_ORG = "5eed0001-0000-4000-8000-000000000001";

/** The administrator acting. */
export const SA_ADMIN = "5eed0003-0000-4000-8000-000000000001";

/** An instant. */
export const SA_AT = new Date("2026-10-03T12:00:00.000Z");

/**
 * An account row with a live token, overridable.
 *
 * @param overrides - Fields to change.
 * @returns The row.
 */
export function accountRow(overrides: Partial<ServiceAccountRow> = {}): ServiceAccountRow {
  return {
    id: "5eed0091-0000-4000-8000-000000000001",
    name: "devops-bot",
    scopes: ["api.read", "farm.submit"],
    created_by: SA_ADMIN,
    created_at: SA_AT,
    disabled_at: null,
    token_id: "5eed0092-0000-4000-8000-000000000001",
    token_hint_sealed: "ouro.v1.1.nonce.ciphertext",
    token_created_at: SA_AT,
    token_last_used_at: null,
    ...overrides,
  };
}
