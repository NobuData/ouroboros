/**
 * How the PR plane prints a HIL measurement's figures — shared by the gate engine's `physical_hil`
 * line (AX.2, #358) and the criteria matrix's evidence line (AX.3, #359), so the two cards on one
 * page read a measurement the same way.
 *
 * ```
 * metric   overshoot_pct → overshoot     reordered_frames → reordered frames
 * figures  1.7 and 2  → 1.7% and 2.0%     (one scale, never rounded)
 * unit     %  → glued · count → none · ms → spaced
 * ```
 *
 * Pure.
 */

/**
 * A metric as a reader says it — the unit suffix off, underscores as spaces.
 *
 * @param metric - `hil_measurements.metric`, `overshoot_pct`.
 * @returns `overshoot`.
 */
export function metricLabel(metric: string): string {
  return metric.replace(/_(pct|percent)$/, "").replace(/_/g, " ");
}

/**
 * The scale two figures share — the finer of the two.
 *
 * The HIL parser stores a JSON `2.0` limit as numeric `2`, so a value and its limit are printed at
 * one scale: the comparison a reader makes is between like figures.
 *
 * @param values - `numeric` values as text.
 * @returns The most digits after the point among them.
 */
export function sharedScale(...values: readonly string[]): number {
  return Math.max(0, ...values.map(decimals));
}

/**
 * A figure at a scale, with its unit.
 *
 * @param value - A `numeric` as text.
 * @param unit - `hil_measurements.unit`.
 * @param scale - Digits wanted after the point; see {@link sharedScale}.
 * @returns `2.0%`, `3`, `412 ms`.
 */
export function figureWithUnit(value: string, unit: string, scale: number): string {
  const figure = atScale(value, scale);

  return unit === "%" ? `${figure}%` : unit === "count" ? figure : `${figure} ${unit}`;
}

/**
 * Digits after the point in a `numeric` rendered as text.
 *
 * @param value - `2.40`, `2`.
 * @returns `2`, `0`.
 */
function decimals(value: string): number {
  const point = value.indexOf(".");

  return point === -1 ? 0 : value.length - point - 1;
}

/**
 * A `numeric` padded with trailing zeros to a scale — `2` at 1 is `2.0`. Never rounds.
 *
 * @param value - The digits.
 * @param scale - Digits wanted after the point; never fewer than the value has.
 * @returns The padded digits.
 */
function atScale(value: string, scale: number): string {
  const missing = scale - decimals(value);

  if (missing <= 0) {
    return value;
  }

  return `${value}${decimals(value) === 0 ? "." : ""}${"0".repeat(missing)}`;
}
