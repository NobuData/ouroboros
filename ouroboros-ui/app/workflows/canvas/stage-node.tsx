"use client";

import { Handle, type NodeProps, Position } from "@xyflow/react";
import { Fragment, memo } from "react";

import { SIDES, type Side, type StageKind, type StageNode as StageNodeType } from "./graph";
import { isPill, stageChips, stageRole } from "./treatment";
import { STAGE_GLYPHS } from "./view";

/**
 * The node every stage is drawn as (S.2, [#148](https://github.com/NobuData/ouroboros/issues/148);
 * treatments S.3, [#149](https://github.com/NobuData/ouroboros/issues/149)): mockup 04's `.node`
 * in its five treatments — the trigger's accent top, the violet model stage, the warn-hued infra
 * stage, the octagonal flow node and the green terminal — and the mini pill *Back to queue* is
 * drawn as.
 *
 * ### What it prints, and where each word comes from
 *
 * The **type line** is the type's glyph and the stage's role (`treatment.ts`'s `stageRole`), the
 * **title** is the document's, and the **chip row** is derived from the stage's `config` on every
 * render (`stageChips`) — never stored, so an edit to a stage's skill is an edit to its chip with
 * nothing else to write. The runner chip carries the mockup's dot, in the infra hue. Which
 * treatment a node takes is its type's class; the octagon, the rails, the hues and the `.sel`
 * glow on the selected node are all `canvas.css`'s, on tokens, so both palettes are the sheet's.
 *
 * ### Eight handles, four sides
 *
 * React Flow attaches an edge to a handle of the edge's *type* — a source handle at one end, a
 * target handle at the other — and looks the handle up by id within that type. So each side
 * carries one of each, both named for the side, and an edge that `graph.ts` decided runs
 * `right → left` finds a source handle called `right` here and a target handle called `left`
 * on the other node. They are drawn invisible until the pointer is over the stage on a canvas that
 * can connect (S.5, [#151](https://github.com/NobuData/ouroboros/issues/151)): a drag from any side
 * draws a connection, and eight dots on every stage would be noise on a graph that is mostly read. The canvas connects in React Flow's *loose* mode, so a drag may end
 * on either handle of a side.
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
 * Each type's box, as whole class lists — literal strings rather than a composed one, so every
 * class this component can render is one a reader (and a search) finds as written.
 */
const NODE_CLASS: Readonly<Record<StageKind, string>> = {
  trigger: "studio-node studio-node--trigger",
  llm: "studio-node studio-node--llm",
  infra: "studio-node studio-node--infra",
  flow: "studio-node studio-node--flow",
  term: "studio-node studio-node--term",
};

/** The mockup's `.node.term.mini`. */
const PILL_CLASS = "studio-node studio-node--term studio-node--pill";

/**
 * The eight connection points.
 *
 * @param props.connectable Whether a connection may be drawn from or to them — React Flow's
 *   `isConnectable` for the node, which follows the canvas's `nodesConnectable`. A handle does not
 *   read it by itself, so a read-only canvas that did not pass it on would still connect on a click.
 * @returns A source and a target handle on each side.
 */
function Ports({ connectable }: Readonly<{ connectable: boolean }>) {
  return SIDES.map((side) => (
    <Fragment key={side}>
      <Handle
        className="studio-node__port"
        id={side}
        isConnectable={connectable}
        position={SIDE_POSITION[side]}
        type="target"
      />
      <Handle
        className="studio-node__port"
        id={side}
        isConnectable={connectable}
        position={SIDE_POSITION[side]}
        type="source"
      />
    </Fragment>
  ));
}

/**
 * The node.
 *
 * @param props React Flow's node props; `data.stage` is what is drawn, and `data.trigger` is the
 *   document's root trigger on the trigger node.
 * @returns The box — or, for *Back to queue*, the pill.
 */
export const StageNode = memo(function StageNode({ data, isConnectable }: NodeProps<StageNodeType>) {
  const { stage, trigger } = data;

  if (isPill(stage)) {
    // The mockup's mini pill: a dot in the terminal's hue and the title, and nothing to chip.
    return (
      <div className={PILL_CLASS}>
        <Ports connectable={isConnectable} />
        <span aria-hidden="true" className="studio-node__dot" />
        <span className="studio-node__title">{stage.title}</span>
      </div>
    );
  }

  const chips = stageChips(stage, trigger);

  return (
    <div className={NODE_CLASS[stage.kind]}>
      <Ports connectable={isConnectable} />
      <span className="studio-node__kind">
        <span aria-hidden="true" className="studio-node__glyph">
          {STAGE_GLYPHS[stage.kind]}
        </span>
        {stageRole(stage)}
      </span>
      <span className="studio-node__title">{stage.title}</span>
      {chips.length > 0 && (
        <span className="studio-node__chips">
          {chips.map((chip) => (
            // The title carries the whole chip where a long skill name is cut to the node's width.
            <span className="studio-node__chip" data-chip={chip.kind} key={chip.kind} title={chip.text}>
              {chip.kind === "runner" && <span aria-hidden="true" className="studio-node__chip-dot" />}
              {chip.text}
            </span>
          ))}
        </span>
      )}
    </div>
  );
});
