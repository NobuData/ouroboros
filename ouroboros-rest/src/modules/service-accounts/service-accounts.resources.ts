/**
 * What the service-account routes publish ([#485](https://github.com/NobuData/ouroboros/issues/485)).
 *
 * **The token is never a field of an account.** It appears in exactly one shape —
 * {@link ServiceAccountSecretResource}, the answer to create and rotate — and every other read
 * carries only the masked hint, which is all the database could give back anyway.
 */

import { SERVICE_SCOPE_DESCRIPTIONS, SERVICE_SCOPES } from "../auth/service.scopes";
import type { ServiceAccountRow } from "./service-accounts.repository";

/** An account's live token, as metadata. */
export interface ServiceTokenResource {
  /** The masked form, e.g. `orb_svc_••••ab12`. */
  hint: string;
  /** When it was minted (created or rotated). */
  createdAt: string;
  /** When it last authenticated a request, or `null` if never. */
  lastUsedAt: string | null;
}

/** One service account. */
export interface ServiceAccountResource {
  id: string;
  /** `devops-bot`. */
  name: string;
  /** How the audit trail names it: `service:devops-bot`. */
  actor: string;
  scopes: string[];
  createdAt: string;
  createdBy: string | null;
  /** When it was revoked, or `null`. */
  disabledAt: string | null;
  /** The live token, or `null` once revoked. */
  token: ServiceTokenResource | null;
}

/** The answer to create and rotate: the account, and the token — **shown once**. */
export interface ServiceAccountSecretResource {
  account: ServiceAccountResource;
  /** The full token. Not stored, not retrievable: copy it now. */
  token: string;
}

/** A registered scope, for the settings card's picker. */
export interface ServiceScopeResource {
  scope: string;
  description: string;
}

/** `GET /settings/service-accounts`. */
export interface ServiceAccountListResource {
  items: ServiceAccountResource[];
  /** The registered allow-list. */
  scopes: ServiceScopeResource[];
}

/**
 * Render one account.
 *
 * @param row - The stored account and its live token's metadata.
 * @param hint - The live token's opened hint, or `null` when it has none.
 * @returns The resource.
 */
export function serviceAccountResource(
  row: ServiceAccountRow,
  hint: string | null,
): ServiceAccountResource {
  return {
    id: row.id,
    name: row.name,
    actor: `service:${row.name}`,
    scopes: [...row.scopes],
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    disabledAt: row.disabled_at?.toISOString() ?? null,
    token:
      row.token_id !== null && hint !== null && row.token_created_at !== null
        ? {
            hint,
            createdAt: row.token_created_at.toISOString(),
            lastUsedAt: row.token_last_used_at?.toISOString() ?? null,
          }
        : null,
  };
}

/**
 * The registered scopes.
 *
 * @returns Each scope with what it grants.
 */
export function serviceScopeResources(): ServiceScopeResource[] {
  return SERVICE_SCOPES.map((scope) => ({ scope, description: SERVICE_SCOPE_DESCRIPTIONS[scope] }));
}
