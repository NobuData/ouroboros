/**
 * Reading what the analyzer stored as JSON — a finding's `data`, a basis, an impact (V081, V087).
 *
 * The stored documents are held to their shapes when they are written, but a read must not trust
 * that a key an older row never carried is there. Each of these answers the value when it is the
 * type asked for and **nothing** otherwise — `null`, or an empty object — never a default that
 * would read as a measurement.
 */

/**
 * A stored JSON object, or `null` when the value is not one.
 *
 * @param value - Any stored JSON value.
 * @returns The object; `null` for an array, a scalar or nothing.
 */
export function objectOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * A stored JSON object, or an empty one for anything else.
 *
 * @param value - Any stored JSON value.
 * @returns The object, so its keys can be read without a guard.
 */
export function objectOf(value: unknown): Record<string, unknown> {
  return objectOrNull(value) ?? {};
}

/**
 * A stored JSON number, or `null`.
 *
 * @param value - Any stored JSON value.
 * @returns The number when it is a finite one.
 */
export function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A stored JSON string, or `null`.
 *
 * @param value - Any stored JSON value.
 * @returns The string when it is one.
 */
export function textOf(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
