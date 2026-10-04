/**
 * Emission validation — a payload against its kind's schema, refs against its ref shape — before
 * anything is written.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)). V093 validates both again at
 * write time, and the database stays the authority: this is here so a plane that hands over a bad
 * payload is told **which fact** is wrong, in a sentence, and **no item is filed** — rather than
 * learning it from a constraint name in a log line.
 *
 * Ajv compiles each published `(kind, version)` once; declarations are immutable, so the cache never
 * needs invalidating.
 */

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";

import {
  DECISION_REF_TYPES,
  type DecisionRef,
  type DecisionRefShape,
  type PublishedDecisionKind,
} from "./decision.types";

/** V093's ceiling on a card's tags. */
export const MAX_DECISION_REFS = 16;

/** V093's ceiling on a source reference. */
export const MAX_SOURCE_REF_LENGTH = 500;

/** V093's plane grammar — a slug with no colon. */
export const PLANE_PATTERN = /^[a-z][a-z0-9_.-]{0,62}$/;

/** A lower-case uuid — what a run, PR or ticket ref names. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One problem with an emission, as a person would want it stated.
 */
export interface DecisionViolation {
  /** Where — `payload.checks_passed`, `refs`, `key.plane`. */
  readonly field: string;
  /** What is wrong with it. */
  readonly message: string;
}

/**
 * Ajv's verdict on one property, as a sentence.
 *
 * @param error - What Ajv reported.
 * @returns The violation.
 */
function violationOf(error: ErrorObject): DecisionViolation {
  const property =
    error.keyword === "required"
      ? String((error.params as { missingProperty: string }).missingProperty)
      : error.keyword === "additionalProperties"
        ? String((error.params as { additionalProperty: string }).additionalProperty)
        : error.instancePath.replace(/^\//, "").replaceAll("/", ".");
  const field = property === "" ? "payload" : `payload.${property}`;

  switch (error.keyword) {
    case "required":
      return { field, message: "is a fact this kind's templates need, and it is missing." };
    case "additionalProperties":
      return { field, message: "is not a fact this kind declares." };
    case "enum":
      return {
        field,
        message: `must be one of ${(error.params as { allowedValues: unknown[] }).allowedValues
          .map((value) => JSON.stringify(value))
          .join(", ")}.`,
      };
    default:
      return { field, message: `${error.message ?? "is invalid"}.` };
  }
}

/** Compiles and caches each published declaration's payload validator. */
export class DecisionPayloadValidator {
  private readonly ajv = new Ajv2020({ strict: false, allErrors: true });

  private readonly compiled = new Map<string, ValidateFunction>();

  /**
   * Check a payload against the kind's schema.
   *
   * @param kind - The published declaration the item will pin.
   * @param payload - The facts.
   * @returns Every violation; empty when the payload conforms.
   */
  validate(kind: PublishedDecisionKind, payload: unknown): DecisionViolation[] {
    const validator = this.validatorFor(kind);

    if (validator(payload)) {
      return [];
    }

    return (validator.errors ?? []).map(violationOf);
  }

  /**
   * The compiled validator for one `(kind, version)`.
   *
   * @param kind - The declaration.
   * @returns Its validator, compiled once.
   */
  private validatorFor(kind: PublishedDecisionKind): ValidateFunction {
    const key = `${kind.kindId}@${String(kind.version)}`;
    let validator = this.compiled.get(key);

    if (validator === undefined) {
      // `$schema`/`$id` are annotations here; the cache key is the identity.
      const { $schema: _schema, $id: _id, ...schema } = kind.payloadSchema;
      validator = this.ajv.compile(schema);
      this.compiled.set(key, validator);
    }

    return validator;
  }
}

/**
 * Check an emission's refs against the kind's ref shape.
 *
 * @param shape - The kind's `{required, optional}`.
 * @param refs - The refs, in tag order.
 * @returns Every violation; empty when the refs fit. Whether each ref names a row of the
 *   workspace is the database's question (`decision_ref_resolves`), not this one's.
 */
export function refViolations(
  shape: DecisionRefShape,
  refs: readonly DecisionRef[],
): DecisionViolation[] {
  const violations: DecisionViolation[] = [];
  const allowed = new Set([...shape.required, ...shape.optional]);
  const seen = new Set<string>();

  if (refs.length > MAX_DECISION_REFS) {
    violations.push({ field: "refs", message: `holds at most ${String(MAX_DECISION_REFS)} refs.` });
  }

  for (const [index, ref] of refs.entries()) {
    const field = `refs[${String(index)}]`;

    if (!(DECISION_REF_TYPES as readonly string[]).includes(ref.type) || !allowed.has(ref.type)) {
      violations.push({ field, message: `is a ${ref.type} ref, which this kind does not take.` });
    } else if (ref.type !== "path" && !UUID.test(ref.id)) {
      violations.push({ field, message: "must name its row by lower-case uuid." });
    } else if (ref.type === "path" && (ref.id.trim() === "" || ref.id.startsWith("/"))) {
      violations.push({ field, message: "must be a repository-relative path." });
    }

    if (ref.label.trim() === "") {
      violations.push({ field, message: "needs a label — the tag's text." });
    }

    const identity = `${ref.type}:${ref.id}`;

    if (seen.has(identity)) {
      violations.push({ field, message: "names a ref the row already carries." });
    }

    seen.add(identity);
  }

  for (const type of shape.required) {
    if (!refs.some((ref) => ref.type === type)) {
      violations.push({ field: "refs", message: `must carry a ${type} ref.` });
    }
  }

  return violations;
}

/**
 * Check an emission's idempotency key.
 *
 * @param plane - The plane.
 * @param sourceRef - The plane's reference.
 * @returns Every violation; empty when the key is well formed.
 */
export function keyViolations(plane: string, sourceRef: string): DecisionViolation[] {
  const violations: DecisionViolation[] = [];

  if (!PLANE_PATTERN.test(plane)) {
    violations.push({ field: "key.plane", message: "must be a lower-case slug with no colon." });
  }

  if (
    sourceRef === "" ||
    sourceRef.trim() !== sourceRef ||
    sourceRef.length > MAX_SOURCE_REF_LENGTH
  ) {
    violations.push({
      field: "key.sourceRef",
      message: `must be non-blank, with no surrounding whitespace, and at most ${String(MAX_SOURCE_REF_LENGTH)} characters.`,
    });
  }

  return violations;
}
