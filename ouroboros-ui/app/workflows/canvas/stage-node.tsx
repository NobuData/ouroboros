"use client";

import { Handle, type NodeProps, Position } from "@xyflow/react";
import { Fragment, memo } from "react";

import { SIDES, type Side, type StageNode as StageNodeType } from "./graph";
import { STAGE_KIND_WORDS } from "./view";

/**
 * The one node the canvas draws every stage as (S.2,
 * [#148](https://github.com/NobuData/ouroboros/issues/148)): the mockup's `.node` box — the
 * type line, the title — at the mockup's geometry, with a connection point on each side.
 *
 * **Deliberately plain.** The five treatments (the trigger's accent top, the violet model
 * stage, the warn-hued infra stage, the octagonal flow node, the terminal's mini pill), the
 * chip row and the `.sel` glow are S.3's ([#149](https://github.com/NobuData/ouroboros/issues/149)),
 * and this component is what S.3 replaces. What it settles is what S.3 inherits: the box is
 * the node's own element inside React Flow's positioned wrapper, the handles are the four
 * sides named in `graph.ts`, and every colour and length is a token (`canvas.css`).
 *
 * ### Eight handles, four sides
 *
 * React Flow attaches an edge to a handle of the edge's *type* — a source handle at one end, a
 * target handle at the other — and looks the handle up by id within that type. So each side
 * carries one of each, both named for the side, and an edge that `graph.ts` decided runs
 * `right → left` finds a source handle called `right` here and a target handle called `left`
 * on the other node. They are drawn invisible: nothing can be connected until S.5
 * ([#151](https://github.com/NobuData/ouroboros/issues/151)), and a handle that cannot be
 * used is a handle that should not be seen.
 *
 * Memoised, as React Flow asks of custom nodes: the wrapper re-renders on every viewport
 * change, and twelve boxes re-rendering on every scroll frame is what 60fps is spent on.
 */

/** Which React Flow position each side is. */
const SIDE_POSITION: Readonly<Record<Side, Position>> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/**
 * The node.
 *
 * @param props React Flow's node props; `data.stage` is what is drawn.
 * @returns The box.
 */
export const StageNode = memo(function StageNode({ data }: NodeProps<StageNodeType>) {
  const { stage } = data;

  return (
    <div className="studio-node">
      {SIDES.map((side) => (
        <Fragment key={side}>
          <Handle className="studio-node__port" id={side} position={SIDE_POSITION[side]} type="target" />
          <Handle className="studio-node__port" id={side} position={SIDE_POSITION[side]} type="source" />
        </Fragment>
      ))}
      <span className="studio-node__kind">{STAGE_KIND_WORDS[stage.kind]}</span>
      <span className="studio-node__title">{stage.title}</span>
    </div>
  );
});
