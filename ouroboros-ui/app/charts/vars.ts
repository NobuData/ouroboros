import type { CSSProperties } from "react";

/**
 * The one inline style a chart writes: custom properties carrying a datum.
 *
 * Every chart primitive passes its data to `charts.css` the way `app/ui/meter.tsx` does — a
 * fraction in a custom property, read by a declaration the stylesheet owns — so the call site
 * never decides a colour, a size or a font. This types that hand-off once.
 *
 * @param properties The custom properties, e.g. `{ "--chart-fill": "62.5%" }`.
 * @returns A style React accepts.
 */
export function chartVars(properties: Readonly<Record<`--chart-${string}`, string>>): CSSProperties {
  return properties as CSSProperties;
}
