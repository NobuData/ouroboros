/**
 * zod's issues, translated into the DSL's diagnostic vocabulary
 * ([#133](https://github.com/NobuData/ouroboros/issues/133)).
 *
 * zod names its failures after *its own* checks — `invalid_type`, `too_big`,
 * `unrecognized_keys` — and pydantic names the same failures after its own — `missing`,
 * `less_than_equal`, `extra_forbidden`. Neither vocabulary is the product's, and a client
 * that switched on one would break the day the other validator answered it. So both sides
 * translate into {@link DslErrorCode}, and `schemas/workflow-dsl/fixtures/expected.json`
 * records what the translation has to produce.
 *
 * The one translation worth reading twice is **missing versus wrong type**. pydantic
 * distinguishes them (`missing` and `*_type`); zod reports both as `invalid_type`, and the
 * issue does not carry the value it rejected in a form this code can trust. So the value is
 * looked up in the input by the issue's own path: absent means `schema.required`, present
 * means `schema.type`. That is the same question pydantic answers internally, asked from
 * outside.
 */

import type { z } from "zod";

import type { DslDiagnostic, DslEdgeAnchor } from "./dsl.errors";
import { DslErrorCode, pointer } from "./dsl.errors";

/** The graph anchor to attach to every diagnostic a translation produces. */
export interface DiagnosticAnchor {
  /** The id of the node these diagnostics are about, when they are about one. */
  node?: string;
  /** The endpoints of the edge these diagnostics are about, when they are about one. */
  edge?: DslEdgeAnchor;
}

/**
 * Read the value one zod path points at.
 *
 * Returns `undefined` both for an absent property and for a property whose value is
 * `undefined`; the DSL has no `undefined` — it is JSON — so the two cases cannot be
 * confused here.
 *
 * @param root - The value the schema was run against.
 * @param path - A zod issue's path, outermost segment first.
 * @returns The value at that path, or `undefined` if any step of it is absent.
 */
export function valueAtPath(root: unknown, path: readonly PropertyKey[]): unknown {
  let cursor: unknown = root;
  for (const segment of path) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<PropertyKey, unknown>)[segment];
  }
  return cursor;
}

/** A zod path, rendered as the tail of a JSON Pointer. */
function pointerFor(base: readonly (string | number)[], path: readonly PropertyKey[]): string {
  return pointer(...base, ...path.map((segment) => String(segment)));
}

/**
 * Translate one zod issue into a code and a human sentence.
 *
 * Split out from {@link diagnosticsFromZodIssues} because `unrecognized_keys` is the one
 * issue that becomes *several* diagnostics — one per undeclared key — and mixing the two
 * shapes into one function made both harder to read than either.
 *
 * @param issue - The zod issue.
 * @param present - Whether the value the issue points at exists in the input.
 * @returns The code and the message.
 */
function translate(
  issue: z.core.$ZodIssue,
  present: boolean,
): { code: DslErrorCode; message: string } {
  switch (issue.code) {
    case "invalid_type":
      return present
        ? {
            code: DslErrorCode.SCHEMA_TYPE,
            message: `Expected ${issue.expected} here.`,
          }
        : {
            code: DslErrorCode.SCHEMA_REQUIRED,
            message: "This property is required.",
          };

    case "invalid_value":
      // An absent enum member reaches zod as `invalid_value` rather than `invalid_type`,
      // because there is no type to be wrong about — every accepted value is a literal. It
      // is still a missing property, which is what pydantic calls it and what a reader is
      // owed: "expected one of …" about a field nobody wrote is an answer to a question
      // nobody asked.
      return present
        ? {
            code: DslErrorCode.SCHEMA_ENUM,
            message: `Expected one of ${issue.values.map((value) => JSON.stringify(value)).join(", ")}.`,
          }
        : {
            code: DslErrorCode.SCHEMA_REQUIRED,
            message: "This property is required.",
          };

    case "too_big":
      return issue.origin === "number" || issue.origin === "int" || issue.origin === "bigint"
        ? {
            code: DslErrorCode.SCHEMA_RANGE,
            message: `Must be at most ${String(issue.maximum)}.`,
          }
        : {
            code: DslErrorCode.SCHEMA_LENGTH,
            message: `Must hold at most ${String(issue.maximum)} entries.`,
          };

    case "too_small":
      return issue.origin === "number" || issue.origin === "int" || issue.origin === "bigint"
        ? {
            code: DslErrorCode.SCHEMA_RANGE,
            message: `Must be at least ${String(issue.minimum)}.`,
          }
        : {
            code: DslErrorCode.SCHEMA_LENGTH,
            message: `Must hold at least ${String(issue.minimum)} entries.`,
          };

    case "invalid_format":
      return {
        code: DslErrorCode.SCHEMA_PATTERN,
        message: `Must match ${issue.pattern ?? issue.format}.`,
      };

    default:
      // `not_multiple_of`, `invalid_union`, `invalid_key`, `invalid_element` and `custom`
      // are reachable only from schema constructs this DSL does not use — no multiples, no
      // unions (the dispatch is by hand, see dsl.schema.ts), no keyed records with
      // constrained keys, no refinements. Mapping them to `schema.type` rather than
      // throwing keeps a future schema edit from turning a validation into a 500; the
      // conformance suite is what would report that the edit needs a code of its own.
      return {
        code: DslErrorCode.SCHEMA_TYPE,
        message: "This value does not match the workflow schema.",
      };
  }
}

/**
 * Translate a zod failure into diagnostics.
 *
 * @param issues - The issues from one `safeParse`.
 * @param base - Where in the whole document the parsed value lives, as pointer segments —
 *   `[]` for the document itself, `["nodes", 3, "config"]` for a node's config.
 * @param parsed - The value that was parsed, so a missing property can be told from one of
 *   the wrong type.
 * @param anchor - The node or edge to anchor every resulting diagnostic to.
 * @returns One diagnostic per issue, plus one per undeclared key.
 */
export function diagnosticsFromZodIssues(
  issues: readonly z.core.$ZodIssue[],
  base: readonly (string | number)[],
  parsed: unknown,
  anchor: DiagnosticAnchor = {},
): DslDiagnostic[] {
  const diagnostics: DslDiagnostic[] = [];

  for (const issue of issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        diagnostics.push({
          code: DslErrorCode.SCHEMA_UNKNOWN_PROPERTY,
          path: pointerFor(base, [...issue.path, key]),
          ...anchor,
          message: `\`${key}\` is not a property the workflow schema declares.`,
        });
      }
      continue;
    }

    const present = valueAtPath(parsed, issue.path) !== undefined;
    const { code, message } = translate(issue, present);
    diagnostics.push({
      code,
      path: pointerFor(base, issue.path),
      ...anchor,
      message,
    });
  }

  return diagnostics;
}
