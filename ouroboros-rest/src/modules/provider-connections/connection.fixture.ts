/**
 * A provider connection, for the suites that assert about one.
 *
 * One builder, so the row shape four specs assume is the shape one file describes — the same
 * reason `tenancy/organization.fixture.ts` and `auth/principal.fixture.ts` exist. The values
 * are mockup 07's Anthropic card, so a failure reads against something recognisable rather
 * than against `test-1`.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import type { ConnectionRow } from "./provider-connections.repository";

/** The workspace every fixture connection belongs to — `principal.fixture.ts`'s own. */
export const FIXTURE_WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/** The person who added them — `principal.fixture.ts`'s user. */
export const FIXTURE_ACTOR = "5eed0003-0000-4000-8000-000000000001";

/** The connection id the fixtures use — the seed's Anthropic card. */
export const FIXTURE_CONNECTION = "5eed000c-0000-4000-8000-000000000001";

/**
 * The credential the fixtures seal.
 *
 * Shaped like a real Anthropic key and long enough to be findable: `payloads.spec.ts` greps
 * every rendered payload for this exact string, and a secret of `"x"` would appear in a
 * hundred innocent sentences and prove nothing. Its last four characters are the mockup's
 * own, so the mask a suite asserts is `••••Xq4A`.
 */
export const FIXTURE_SECRET = "sk-ant-api03-notarealkey-DEADBEEFCAFEXq4A";

/** What {@link FIXTURE_SECRET} masks to. */
export const FIXTURE_MASK = "••••Xq4A";

/** A sealed value shaped like one of the vault's envelopes. */
export const FIXTURE_ENVELOPE = "ouro.v1.1.c2VlZC1ub25jZS0x.ZGV2LXNlZWQtdmFsdWU";

/**
 * A stored connection, as the repository reads one.
 *
 * @param overrides - What to change. Everything else is mockup 07's Anthropic card.
 * @returns The row.
 */
export function connectionRow(overrides: Partial<ConnectionRow> = {}): ConnectionRow {
  return {
    id: FIXTURE_CONNECTION,
    kind: "anthropic",
    display_name: "Anthropic Claude",
    base_url: null,
    status: "active",
    last_checked_at: new Date("2026-08-23T09:59:41.882Z"),
    monthly_cap_cents: 60_000,
    added_by: FIXTURE_ACTOR,
    last_used_at: new Date("2026-08-23T09:57:12.004Z"),
    capability_note: "api.anthropic.com · primary coding lane",
    enabled: true,
    created_at: new Date("2026-06-12T16:20:00.000Z"),
    updated_at: new Date("2026-08-23T09:59:41.882Z"),
    ...overrides,
  };
}
