/**
 * The provider-terms record: which connections may serve model invocation, and on whose word.
 *
 * DH.4 ([#1304](https://github.com/NobuData/ouroboros/issues/1304)). The human-readable copy
 * of this record is the table in `docs/MODEL_PROVIDERS.md` § *Provider terms — which
 * connections may serve invocation*, and the two must say the same thing: this file is what
 * the code reads, the table is what a reviewer reads, and `invocation.terms.spec.ts` holds
 * them to one another.
 *
 * ---------------------------------------------------------------------------
 * **Eligibility is not capability.** `ProviderCapabilities.invocation` says an adapter
 * *implements* `invoke()`; this record says whether it *may*. AF.2
 * ([#235](https://github.com/NobuData/ouroboros/issues/235)) is what implements invocation,
 * and it may do so only for a kind this record clears — the conformance kit asserts that
 * direction, and asserts that an uncleared kind declares no `invoke` at all.
 *
 * **A record without a primary source is not a clearance.** A credential kind is `cleared`
 * only when a primary source — the vendor's own terms, or the customer operating the endpoint
 * themselves — was read and dated. Anything else is `unverified`, which this file treats
 * exactly as it treats `refused`: the connection does not serve invocation, and the reason
 * says why.
 *
 * **Per connection, the credential kind is known.** A credential this record refuses is
 * refused when the connection is saved ({@link isSubscriptionCredential}) and never stored, so
 * every stored connection holds the kind's accepted credential, and a connection's eligibility
 * is its kind's.
 */

import type { ProviderConnectionKind } from "../db/schema";

/** Whether a credential kind may serve invocation, as the record found it. */
export type InvocationStanding = "cleared" | "refused" | "unverified";

/** One credential kind an adapter accepts, and what the record found about it. */
export interface CredentialTerms {
  /** The credential kind, in words a person recognises — `API key (Console)`. */
  readonly credential: string;
  /** What the record found. Only `cleared` lets a connection serve invocation. */
  readonly standing: InvocationStanding;
  /** The primary source read, in words, or null where none was found. */
  readonly source: string | null;
  /** Where that source lives, or null when it is not a page (a customer-operated endpoint). */
  readonly sourceUrl: string | null;
  /** The date the source was read, `YYYY-MM-DD`, or null where none was found. */
  readonly read: string | null;
}

/** One adapter's terms record. */
export interface AdapterTerms {
  /** The credential kinds it accepts, the one a stored connection holds first. */
  readonly credentials: readonly [CredentialTerms, ...CredentialTerms[]];
  /**
   * Why a stored connection of this kind cannot serve invocation, as a sentence, or null when
   * it can. What the Providers page and a dropped route hop say.
   */
  readonly reason: string | null;
}

/** The date the record's sources were read. */
const READ_ON = "2026-10-10";

/** Anthropic's *Legal and compliance* page, the primary source for both Anthropic rows. */
const ANTHROPIC_LEGAL = "https://code.claude.com/docs/en/legal-and-compliance";

/**
 * The record, one entry per connection kind.
 *
 * Keyed by every {@link ProviderConnectionKind} — `custom` included, with no cleared row — so
 * a kind added to V015 without an entry fails to compile here instead of defaulting to
 * anything.
 */
export const INVOCATION_TERMS: Readonly<Record<ProviderConnectionKind, AdapterTerms>> = {
  anthropic: {
    credentials: [
      {
        credential: "API key (Console)",
        standing: "cleared",
        source: "Anthropic, Legal and compliance",
        sourceUrl: ANTHROPIC_LEGAL,
        read: READ_ON,
      },
      {
        credential: "claude.ai subscription or session token",
        standing: "refused",
        source: "Anthropic, Legal and compliance",
        sourceUrl: ANTHROPIC_LEGAL,
        read: READ_ON,
      },
    ],
    reason: null,
  },
  openai_compatible: {
    credentials: [
      {
        credential: "Endpoint key, or none",
        standing: "cleared",
        source: "Customer-operated endpoint",
        sourceUrl: null,
        read: READ_ON,
      },
    ],
    reason: null,
  },
  ollama: {
    credentials: [
      {
        credential: "None (base URL)",
        standing: "cleared",
        source: "Local, customer-operated",
        sourceUrl: null,
        read: READ_ON,
      },
    ],
    reason: null,
  },
  copilot: {
    credentials: [
      {
        credential: "Seat entitlement",
        standing: "unverified",
        source: null,
        sourceUrl: null,
        read: null,
      },
    ],
    reason:
      "GitHub's terms for serving model calls to a third-party orchestrator from a Copilot " +
      "seat are unverified — no primary source has been recorded.",
  },
  cursor: {
    credentials: [
      {
        credential: "API key",
        standing: "unverified",
        source: null,
        sourceUrl: null,
        read: null,
      },
    ],
    reason:
      "Cursor's terms for serving model calls to a third-party orchestrator are unverified — " +
      "only a forum reply has been found, which is not a primary source.",
  },
  custom: {
    credentials: [
      {
        credential: "Any",
        standing: "unverified",
        source: null,
        sourceUrl: null,
        read: null,
      },
    ],
    reason: "No provider-terms record exists for a custom connection.",
  },
};

/** Whether one connection may serve invocation, and why not when it may not. */
export interface InvocationEligibility {
  /** Whether a stored connection of this kind may serve model invocation. */
  readonly eligible: boolean;
  /** Why it may not, as a sentence, or null when it may. */
  readonly reason: string | null;
}

/**
 * Whether a stored connection of this kind may serve invocation.
 *
 * Read from the credential a stored connection holds — the record's first row — so a kind
 * whose accepted credential is not `cleared` is ineligible however many other rows it has.
 *
 * @param kind - The connection's kind.
 * @returns Eligibility, with the record's reason when it is not.
 */
export function invocationEligibility(kind: ProviderConnectionKind): InvocationEligibility {
  const terms = INVOCATION_TERMS[kind];
  const eligible = terms.credentials[0].standing === "cleared";

  return { eligible, reason: eligible ? null : terms.reason };
}

/**
 * Whether the record clears this kind — the conformance kit's question.
 *
 * @param kind - An adapter's kind.
 * @returns `true` when a stored connection of the kind may serve invocation.
 */
export function invocationCleared(kind: ProviderConnectionKind): boolean {
  return invocationEligibility(kind).eligible;
}

/**
 * The shapes a claude.ai subscription credential takes: an OAuth access token (`sk-ant-oat…`),
 * its refresh token (`sk-ant-ort…`), and the browser session key (`sk-ant-sid…`). A Console
 * API key is `sk-ant-api…` and an admin key `sk-ant-admin…`; neither matches.
 */
const SUBSCRIPTION_CREDENTIAL = /^(?:bearer\s+)?sk-ant-(?:oat|ort|sid)\d*-/i;

/**
 * Whether a submitted credential is recognisably a claude.ai subscription or session token.
 *
 * Checked on every save that carries a credential, whatever the kind: a subscription token
 * pasted into an OpenAI-compatible connection pointed at a proxy is the same token.
 *
 * @param secret - The credential as submitted.
 * @returns `true` when it must be refused.
 */
export function isSubscriptionCredential(secret: string): boolean {
  return SUBSCRIPTION_CREDENTIAL.test(secret.trim());
}
