"use client";

import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react";
import { memo } from "react";

import type { StageEdge as StageEdgeType } from "./graph";
import {
  EDGE_VARIANTS,
  type EdgeVariant,
  type LabelTone,
  edgeVariant,
  labelAnchor,
  labelTone,
} from "./treatment";

/**
 * The edge every connection is drawn as (S.3, [#149](https://github.com/NobuData/ouroboros/issues/149)):
 * mockup 04's `.edge` — the plain path, the **active** path in the accent with its glow, and the
 * dashed **loop** in accent-deep with its drop-shadow, the ouroboros itself — each ending in an
 * arrowhead of its own colour, with the label as the mockup's `.elabel` pill in the tone its
 * condition reports.
 *
 * ### The line is a bezier, the arrowheads are the mockup's
 *
 * The mockup draws every edge as a cubic curve between two sides, which is React Flow's bezier
 * between the handles `graph.ts` chose. The arrowheads are not the library's: its markers are
 * coloured by an attribute, and a colour written into an attribute is a colour the token sheet
 * cannot switch. So the three the mockup defines (`#m-d`, `#m-a`, `#m-l`) are drawn once per
 * canvas by {@link EdgeMarkers}, filled from `canvas.css`, and each edge names the one its
 * variant takes. The ids are fixed rather than generated: the studio mounts one canvas, and two
 * canvases would define identical markers under one id, which draws the same arrowhead.
 *
 * ### The label is HTML, beside the line
 *
 * The mockup's `.elabel` is an HTML pill — a rem type size, a full radius, a hairline in its tone —
 * and an SVG rectangle can have none of those at every font size. So the label is drawn in React
 * Flow's label layer above the edges (`EdgeLabelRenderer`), positioned at the curve's midpoint and
 * set against the line the way the mockup sets it (`treatment.ts`'s `labelAnchor`). It is hidden
 * from the accessibility tree because the edge already carries it in its name
 * (`view.ts`'s `edgeName`), and it lets every pointer event through to the stage beneath.
 */

/** Each variant's arrowhead id — the mockup's `#m-d`, `#m-a` and `#m-l`. */
export const MARKER_IDS: Readonly<Record<EdgeVariant, string>> = {
  plain: "studio-arrow-plain",
  active: "studio-arrow-active",
  loop: "studio-arrow-loop",
};

/** Each variant's arrowhead fill, as a literal class list. */
const ARROW_CLASS: Readonly<Record<EdgeVariant, string>> = {
  plain: "studio-arrow studio-arrow--plain",
  active: "studio-arrow studio-arrow--active",
  loop: "studio-arrow studio-arrow--loop",
};

/** Each label tone, as a literal class list. */
const LABEL_CLASS: Readonly<Record<LabelTone, string>> = {
  plain: "studio-edge-label",
  accent: "studio-edge-label studio-edge-label--accent",
  warn: "studio-edge-label studio-edge-label--warn",
  ok: "studio-edge-label studio-edge-label--ok",
  err: "studio-edge-label studio-edge-label--err",
};

/**
 * The line's class list: the plain edge, the loop's dash, the active path's accent — and a loop
 * the path takes, which is both.
 *
 * @param isLoop Whether the edge is a loop.
 * @param onPath Whether the execution path takes it.
 * @returns The classes.
 */
function pathClass(isLoop: boolean, onPath: boolean): string {
  if (isLoop) return onPath ? "studio-edge studio-edge--loop studio-edge--active" : "studio-edge studio-edge--loop";

  return onPath ? "studio-edge studio-edge--active" : "studio-edge";
}

/**
 * The three arrowheads, defined once for every edge on the canvas to name.
 *
 * The mockup's own marker geometry: an 8-unit box with the point at 7.5, drawn 7 units square in
 * the stroke's width, turned to the path's direction at either end.
 *
 * @returns An SVG holding nothing but the definitions, out of the layout and the accessibility tree.
 */
export function EdgeMarkers() {
  return (
    <svg aria-hidden="true" className="studio-canvas__markers">
      <defs>
        {EDGE_VARIANTS.map((variant) => (
          <marker
            id={MARKER_IDS[variant]}
            key={variant}
            markerHeight="7"
            markerWidth="7"
            orient="auto-start-reverse"
            refX="7"
            refY="4"
            viewBox="0 0 8 8"
          >
            <path className={ARROW_CLASS[variant]} d="M0,0.5 L7.5,4 L0,7.5 Z" />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

/**
 * The edge.
 *
 * @param props React Flow's edge props: the two ends it measured, the sides they are on, the label,
 *   and `data` — the connection and whether the execution path takes it.
 * @returns The line with its arrowhead and, where the document labels it, the pill.
 */
export const StageEdge = memo(function StageEdge({
  id,
  data,
  label,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
}: EdgeProps<StageEdgeType>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const connection = data?.connection;
  const onPath = data?.onPath === true;
  const isLoop = connection?.kind === "loop";
  const variant = connection === undefined ? "plain" : edgeVariant(connection, onPath);

  return (
    <>
      <BaseEdge className={pathClass(isLoop, onPath)} markerEnd={`url(#${MARKER_IDS[variant]})`} path={path} />
      {typeof label === "string" && label !== "" && (
        <EdgeLabelRenderer>
          <span
            aria-hidden="true"
            className={LABEL_CLASS[connection === undefined ? "plain" : labelTone(connection)]}
            data-anchor={labelAnchor({ x: sourceX, y: sourceY }, { x: targetX, y: targetY })}
            data-edge={id}
            // Where the curve's midpoint is on the stage — a measured position, not a style.
            style={{ transform: `translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
