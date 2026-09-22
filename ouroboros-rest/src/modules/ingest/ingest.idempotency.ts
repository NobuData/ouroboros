/**
 * How the contract recognises a request it has already answered.
 *
 * AP.1 ([#303](https://github.com/NobuData/ouroboros/issues/303)):
 *
 * > **Idempotency**: duplicate keys are no-ops returning the original result, not errors.
 *
 * *Not errors* is the load-bearing half. A `409` on a replay would be correct about the state
 * and useless to the caller: an executor retries because it did not hear the answer, and
 * telling it *"you already sent that"* without telling it **what it was told** leaves it
 * exactly where it was. So a replay is answered with the stored response — the same run id, the same
 * sequence numbers, the same change-set number the first attempt got. *The same values*, not
 * the same bytes: `jsonb` sorts an object's keys, so a replay's JSON is the first answer's
 * fields in PostgreSQL's order rather than in the mapper's, which is why every one of these
 * shapes has to survive that round trip unchanged (`ingest.resources.ts`).
 *
 * ---------------------------------------------------------------------------
 * **The digest is what makes storing a response safe.**
 *
 * A key is a name the caller chose, and a caller can reuse one by mistake — a loop variable
 * that did not advance, a retry built from a stale template. Without a check, the second
 * request would be answered with the first one's result: the caller would be told its report
 * landed, and it would not have. That is the worst outcome available on this surface, and it
 * is silent.
 *
 * So the receipt carries a SHA-256 of the request, and a key presented with a *different*
 * body is refused with `idempotency_key_reused` — a refusal the caller can act on, because it
 * still holds the report.
 *
 * **The digest is of the canonical form, not of the bytes that arrived.** Two JSON encodings
 * of the same request differ in whitespace and key order, and an executor that re-serialised
 * its retry through a different library would otherwise see its own resend refused as a
 * different request. {@link canonicalJson} is what removes that: keys sorted, no whitespace,
 * `undefined` dropped the way `JSON.stringify` drops it.
 *
 * **It is computed over the validated request, not the raw body.** By the time this runs the
 * global pipe has rejected every field the operation does not define and coerced the ones it
 * does, so the digest describes *what the service understood* rather than what was typed —
 * which is the thing two requests have to agree about for one to be a replay of the other.
 */

import { createHash } from "node:crypto";

/**
 * One request's canonical JSON.
 *
 * @param value - Anything `JSON.stringify` accepts. In practice a validated DTO.
 * @returns The value as JSON with every object's keys in code-unit order, at every depth, and
 *   with no whitespace. Arrays keep their order, because an array's order is data —
 *   `events[]` is the batch's own sequence and two orderings are two different batches.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

/**
 * Rebuild a value with every object's keys sorted.
 *
 * @param value - The value to rebuild.
 * @returns A structurally equal value whose objects enumerate in sorted order. Primitives,
 *   `null` and arrays are returned as they are; a class instance is treated as a plain object,
 *   which is what a validated DTO is once it has been through `class-transformer`.
 */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  // `Date` is the one object here whose own enumeration is empty, so sorting its keys would
  // render it as `{}`. It serialises to an ISO string through `toJSON`, and that is the form
  // two requests can be compared in.
  if (value instanceof Date) {
    return value.toISOString();
  }

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};

  for (const key of Object.keys(source).sort()) {
    // `undefined` is dropped rather than rendered, matching `JSON.stringify` — so a DTO whose
    // optional field was absent and one whose optional field was explicitly `undefined`
    // produce one digest, as they produce one request.
    if (source[key] !== undefined) {
      sorted[key] = canonicalise(source[key]);
    }
  }

  return sorted;
}

/**
 * The digest a receipt stores.
 *
 * @param request - The validated request, whatever shape the operation's DTO has.
 * @returns SHA-256 of {@link canonicalJson}, lower-case hex — the form
 *   `run_ingest_receipts_request_digest_shape` accepts, which is what stops a service that
 *   forgot to hash from writing a request body into that column.
 */
export function requestDigest(request: unknown): string {
  return createHash("sha256").update(canonicalJson(request), "utf8").digest("hex");
}
