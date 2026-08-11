/**
 * The one answer a client gets when the engine could not serve a request.
 *
 * Same arrangement as `auth.errors.ts` and `tenancy.errors.ts`: a code is only meaningful
 * beside the operation that produces it, `openapi.yaml` publishes the two together, and this
 * file is what makes the string in the document and the string in the answer one constant
 * rather than two.
 *
 * There is exactly one code here, and that is the design rather than a stub.
 * `docs/ARCHITECTURE.md` § 3.2 enumerates what can go wrong on this leg — the engine is
 * down, the engine is slow, the address no longer resolves, the two sides hold different
 * shared secrets, the answer was not the contract — and answers all of them the same way:
 *
 *   * **`502`, never `500`.** This service is working and the request was well-formed;
 *     something it depends on failed, and retrying is a reasonable thing for a client to do.
 *     That is what `502` says and `500` does not.
 *   * **`502`, never `401`.** A shared-secret mismatch is a *deployment's* mistake, not the
 *     caller's. Forwarding the engine's `401` would invite a browser to sign in again
 *     against a boundary it cannot reach at all, and would tell whoever asked that there is
 *     an inner service with its own credential. It is logged where an operator reads it
 *     (`engine.client.ts`) and answered here.
 *   * **The message names no address.** `OURO_ENGINE_URL` is internal topology. A client
 *     learns that the system cannot serve the request and nothing it could use to probe the
 *     inside of the network.
 */

import { UpstreamError } from "../errors/error.envelope";

/**
 * Every code the engine gateway can answer with.
 *
 * `as const` so each value is its own literal type, and so `engine.errors.spec.ts` can check
 * the specification's copy against these rather than against a string typed twice.
 */
export const ENGINE_ERRORS = {
  /** The engine could not be reached, refused the call, or did not answer the contract. */
  unavailable: "engine_unavailable",
} as const;

/** One of {@link ENGINE_ERRORS}' values. */
export type EngineErrorCode = (typeof ENGINE_ERRORS)[keyof typeof ENGINE_ERRORS];

/** What a person is told. Constant, and the same sentence for every way this can fail. */
export const ENGINE_UNAVAILABLE_MESSAGE =
  "The engine is not available right now. Try again in a moment.";

/**
 * `502` — the engine could not serve this request.
 *
 * @returns The error to throw. It carries no `details`: everything that would go in them —
 *   the status the engine answered, the code the socket failed with, the address that was
 *   called — is in the service log instead, for the reason this file's header gives.
 */
export function engineUnavailable(): UpstreamError {
  return new UpstreamError(ENGINE_ERRORS.unavailable, ENGINE_UNAVAILABLE_MESSAGE);
}
