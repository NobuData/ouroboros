/**
 * The facade's own refusals, in the Anthropic error format — DH.2
 * ([#1303](https://github.com/NobuData/ouroboros/issues/1303)).
 *
 * A harness reads errors the way the Messages API writes them, so the facade writes its own
 * that way too: `{type: "error", error: {type, message}}`, with the status the API would use.
 * What Ouroboros adds is an `ouroboros` object naming the rule that fired, which is what the
 * stage adapter (DH.3, #1308) reads to halt the stage rather than retry it. Every refusal here
 * is a `4xx` the SDK does not retry, except `provider_unavailable`'s `502`.
 *
 * Upstream errors are **not** this file's: those are relayed unmodified, as the vendor's
 * gateway guide requires.
 */

import type { InvokeCap } from "../invoke.contract";

/** The rules a facade refusal can name. */
export const FACADE_ERROR_CODES = [
  "credential_invalid",
  "credential_expired",
  "credential_revoked",
  "credential_run_mismatch",
  "run_finished",
  "alias_mismatch",
  "alias_unavailable",
  "no_anthropic_hop",
  "cost_cap_exceeded",
  "resolution_failed",
  "vote_execution_unavailable",
  "provider_unavailable",
] as const;

/** One of {@link FACADE_ERROR_CODES}. */
export type FacadeErrorCode = (typeof FACADE_ERROR_CODES)[number];

/** A refusal's body, as the Messages API shapes an error, plus the rule. */
export interface FacadeErrorBody {
  readonly type: "error";
  readonly error: { readonly type: string; readonly message: string };
  readonly ouroboros: {
    readonly code: FacadeErrorCode;
    readonly cap?: InvokeCap;
    readonly reason?: string;
    /** Hops of the resolution the facade skipped, each with why. */
    readonly skipped?: readonly string[];
  };
}

/** A refusal: the status and the body. */
export interface FacadeRefusal {
  readonly status: number;
  readonly body: FacadeErrorBody;
}

/** The Anthropic error `type` and the status each rule answers with. */
const SHAPES: Readonly<Record<FacadeErrorCode, readonly [number, string]>> = Object.freeze({
  credential_invalid: [401, "authentication_error"],
  credential_expired: [401, "authentication_error"],
  credential_revoked: [401, "authentication_error"],
  credential_run_mismatch: [401, "authentication_error"],
  run_finished: [401, "authentication_error"],
  alias_mismatch: [403, "permission_error"],
  alias_unavailable: [404, "not_found_error"],
  no_anthropic_hop: [400, "invalid_request_error"],
  cost_cap_exceeded: [400, "invalid_request_error"],
  resolution_failed: [400, "invalid_request_error"],
  vote_execution_unavailable: [400, "invalid_request_error"],
  provider_unavailable: [502, "api_error"],
});

/**
 * A refusal for a rule.
 *
 * @param code - The rule.
 * @param message - The sentence for a person. Ours, never a provider's.
 * @param extra - The cap, the reason or the skipped hops, when the rule has them.
 * @returns The refusal.
 */
export function facadeRefusal(
  code: FacadeErrorCode,
  message: string,
  extra: Omit<FacadeErrorBody["ouroboros"], "code"> = {},
): FacadeRefusal {
  const [status, type] = SHAPES[code];

  return {
    status,
    body: { type: "error", error: { type, message }, ouroboros: { code, ...extra } },
  };
}
