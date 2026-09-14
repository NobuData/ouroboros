"use client";

import {
  Background,
  BackgroundVariant,
  type CoordinateExtent,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  type Viewport,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
} from "@xyflow/react";
import { useCallback, useRef, useState } from "react";

import type { WorkflowDefinition } from "@/app/api/workflows";
import { Button } from "@/app/ui";

import {
  type CanvasSelection,
  STAGE_NODE_TYPE,
  type StageEdge,
  type StageNode as StageNodeType,
  selectionOf,
  toEdges,
  toNodes,
  withPositions,
} from "./graph";
import { StageNode } from "./stage-node";
import {
  ADD_STAGE_LABEL,
  ADD_STAGE_SOON,
  AUTO_LAYOUT_LABEL,
  AUTO_LAYOUT_SOON,
  CANVAS_HINT,
  CANVAS_LABEL,
  UNSAVED_NOTE,
  ZOOM_HOME_LABEL,
  ZOOM_IN_LABEL,
  ZOOM_LABEL,
  ZOOM_OUT_LABEL,
  selectionSentence,
} from "./view";
import {
  HOME_VIEWPORT,
  MAX_ZOOM,
  MIN_ZOOM,
  nextZoom,
  readViewport,
  storeViewport,
  zoomPercent,
} from "./viewport";

import "@xyflow/react/dist/base.css";
import "./canvas.css";

/**
 * The workflow canvas (S.2, [#148](https://github.com/NobuData/ouroboros/issues/148)) —
 * `docs/mockups/04-workflow-builder.html`'s `.canvas-card`: the dot-grid stage with the
 * definition's stages and connections on it, and the toolbar beneath — on React Flow, which is
 * decision **P2**, the studio's one documented exception to the no-framework rule
 * (`README.md` § Workflow Studio records it with its cost).
 *
 * ### Controlled, and bound to the document
 *
 * The nodes and edges are React state derived from the definition the canvas opened on
 * (`graph.ts`), and every change React Flow reports is applied to that state — which is what
 * *controlled* means here: the library draws what this component holds and asks before
 * changing it. When a move settles (a drag ends, an arrow key lands), the positions are
 * written back into the document and the result is handed up through `onDefinitionChange`.
 * That is the ticket's *dragging a node updates the draft definition*; S.6
 * ([#152](https://github.com/NobuData/ouroboros/issues/152)) is what will autosave it, and
 * until then the toolbar says so.
 *
 * **The document a canvas opened on is the document it draws.** A different document is a
 * different canvas — the screen keys this component by workflow id, so switching workflows
 * remounts it — rather than a prop the component watches, because a canvas that re-derived its
 * nodes whenever its `definition` changed would throw away a reader's selection and measured
 * layout on every autosave round trip. S.6 keys by the draft's etag when it reloads one.
 *
 * ### What is switched off, and why
 *
 * Nothing here connects, adds or deletes: `nodesConnectable` is off, the delete key is unbound,
 * and the toolbar's **Auto-layout** and **Add stage** are drawn inert with #151 as their reason.
 * A foundation that cannot persist an edit should not offer one it would then lose, and the
 * moves it does allow are the ones a reader can see are unsaved.
 *
 * ### Pan, zoom, select
 *
 * The mockup's hint is *⌥ drag to pan*, so a plain drag on the stage is a **selection** (the
 * rubber band) and panning is the modifier: **⌥** or **space** held with a drag, or the middle
 * or right mouse button. The wheel zooms, pinch zooms, and the toolbar steps through
 * `viewport.ts`'s ladder. React Flow's own keyboard model is left on: Tab reaches each stage and
 * each edge, Enter or space selects, the arrow keys move a selected stage, Escape clears — the
 * ticket's *keyboard navigation baseline*.
 *
 * ### Both themes from tokens
 *
 * Only the library's structural sheet is imported (`base.css`, not `style.css`), and every
 * colour it would fall back to is redefined on a token in `canvas.css` — `canvas-styles.test.ts`
 * holds the two lists equal. The library's own `colorMode` is left at its default, because the
 * tokens already switch with the palette and a second theme switch would be a second place a
 * theme is decided.
 */

/** What the canvas takes. */
export interface StudioCanvasProps {
  /** The workflow's id — what its viewport is remembered under. */
  readonly workflowId: string;
  /**
   * The document the canvas opens on: the draft when one is open, else the version in force,
   * else a blank document (`app/workflows/view.ts`'s `canvasDefinition`). Read once, at mount;
   * see the note above on why a new document is a new canvas.
   */
  readonly definition: WorkflowDefinition;
  /**
   * Told the document with the canvas's positions in it, each time a move settles. S.6's
   * autosave is the caller this exists for; the canvas keeps no copy of the draft beyond what
   * it needs to say *not saved*.
   */
  readonly onDefinitionChange?: (definition: WorkflowDefinition) => void;
  /**
   * Told what is selected, each time that changes — including once at mount, with nothing.
   * The inspector (S.4) is the caller this exists for.
   */
  readonly onSelectionChange?: (selection: CanvasSelection) => void;
  /**
   * Where the viewport is remembered. Defaults to the browser's `localStorage`, guarded; a
   * suite passes its own.
   */
  readonly storage?: Storage;
}

/** The one node type, registered once so React Flow does not re-register it on every render. */
const NODE_TYPES = { [STAGE_NODE_TYPE]: StageNode };

/**
 * The mouse buttons that pan without a modifier: the middle button and the right — never the
 * left, which selects. React Flow numbers them as `MouseEvent.button` does.
 */
const PAN_BUTTONS = [1, 2];

/**
 * The keys that turn a left-drag into a pan while held: **⌥** per the mockup's hint, and
 * **space**, which is React Flow's own default and what a reader of any other canvas expects.
 * React Flow matches `KeyboardEvent.key`, and the Option key reports itself as `Alt`.
 */
const PAN_KEYS = ["Alt", "Space"];

/**
 * How far a node may be dragged: the schema's own bounds on a position
 * (`schemas/workflow-dsl/v1.json`, `position.x` and `.y`), so a position the canvas produces is
 * always one the document accepts.
 */
const STAGE_EXTENT: CoordinateExtent = [
  [-100000, -100000],
  [100000, 100000],
];

/**
 * The mockup's `.stage` dot grid: `radial-gradient(… 1px, transparent 1px) 0 0 / 18px 18px` —
 * dots one pixel in radius on an 18px lattice. React Flow's `size` is a dot's diameter.
 */
const DOT_GRID_GAP = 18;
const DOT_SIZE = 2;

/**
 * Whether a node change is a move that has settled — a drag that ended, or a keyboard move,
 * which settles at once. A move still in progress reports `dragging: true` and is drawn but
 * not yet written back, so the document holds where a stage was put and never where it was on
 * the way there.
 *
 * @param change One of the changes React Flow reported.
 * @returns `true` for a settled position change.
 */
function isSettledMove(change: NodeChange<StageNodeType>): boolean {
  return change.type === "position" && change.dragging !== true;
}

/**
 * The canvas.
 *
 * @param props See {@link StudioCanvasProps}.
 * @returns The stage and its toolbar, inside the provider React Flow's hooks need.
 */
export function StudioCanvas(props: StudioCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

/**
 * The canvas proper, inside the provider.
 *
 * @param props See {@link StudioCanvasProps}.
 * @returns The stage and its toolbar.
 */
function Canvas({
  workflowId,
  definition,
  onDefinitionChange,
  onSelectionChange,
  storage,
}: StudioCanvasProps) {
  const [nodes, setNodes] = useState<StageNodeType[]>(() => toNodes(definition));
  const [edges, setEdges] = useState<StageEdge[]>(() => toEdges(definition));
  // The nodes as of the last change, for the next change to build on. React Flow can report
  // two batches of changes between two renders — a measurement and a selection, say — and a
  // handler that read `nodes` from its render would apply the second batch to the state the
  // first one had already replaced.
  const nodesRef = useRef(nodes);
  const [edited, setEdited] = useState(false);
  const [selection, setSelection] = useState<CanvasSelection>(null);
  const [zoom, setZoom] = useState(HOME_VIEWPORT.zoom);
  const { setViewport, zoomTo, getZoom } = useReactFlow<StageNodeType, StageEdge>();

  const onNodesChange = useCallback(
    (changes: NodeChange<StageNodeType>[]) => {
      const next = applyNodeChanges(changes, nodesRef.current);
      nodesRef.current = next;
      setNodes(next);

      if (changes.some(isSettledMove)) {
        const draft = withPositions(definition, next);
        if (draft !== definition) {
          setEdited(true);
          onDefinitionChange?.(draft);
        }
      }
    },
    [definition, onDefinitionChange],
  );

  const onEdgesChange = useCallback((changes: EdgeChange<StageEdge>[]) => {
    // Only a selection can change on an edge here — nothing connects, reconnects or deletes —
    // so the edges never reach the document and a functional update is all this needs.
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  const onSelection = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams<StageNodeType, StageEdge>) => {
      const next = selectionOf(selectedNodes, selectedEdges);
      setSelection(next);
      onSelectionChange?.(next);
    },
    [onSelectionChange],
  );

  const onInit = useCallback(() => {
    // Where this reader left this workflow, applied once the viewport exists. Read here rather
    // than as `defaultViewport` so the server and the browser render one transform and the
    // stored place is applied after hydration — storage is the browser's alone.
    const stored = readViewport(workflowId, storage);
    if (stored !== null) void setViewport(stored);
  }, [workflowId, storage, setViewport]);

  const onMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      storeViewport(workflowId, viewport, storage);
    },
    [workflowId, storage],
  );

  const onViewportChange = useCallback((viewport: Viewport) => {
    setZoom(viewport.zoom);
  }, []);

  const zoomOut = useCallback(() => void zoomTo(nextZoom(getZoom(), -1)), [zoomTo, getZoom]);
  const zoomIn = useCallback(() => void zoomTo(nextZoom(getZoom(), 1)), [zoomTo, getZoom]);
  const zoomHome = useCallback(() => void setViewport(HOME_VIEWPORT), [setViewport]);

  const status = selectionSentence(selection, nodes.length);

  return (
    <section aria-label={CANVAS_LABEL} className="studio-canvas">
      <div className="studio-canvas__stage">
        <ReactFlow<StageNodeType, StageEdge>
          defaultMarkerColor={null}
          defaultViewport={HOME_VIEWPORT}
          deleteKeyCode={null}
          edges={edges}
          edgesFocusable
          edgesReconnectable={false}
          maxZoom={MAX_ZOOM}
          minZoom={MIN_ZOOM}
          nodeExtent={STAGE_EXTENT}
          nodes={nodes}
          nodesConnectable={false}
          nodesFocusable
          nodeTypes={NODE_TYPES}
          onEdgesChange={onEdgesChange}
          onInit={onInit}
          onMoveEnd={onMoveEnd}
          onNodesChange={onNodesChange}
          onSelectionChange={onSelection}
          onViewportChange={onViewportChange}
          panActivationKeyCode={PAN_KEYS}
          panOnDrag={PAN_BUTTONS}
          selectionMode={SelectionMode.Partial}
          selectionOnDrag
        >
          <Background gap={DOT_GRID_GAP} size={DOT_SIZE} variant={BackgroundVariant.Dots} />
        </ReactFlow>
      </div>

      <div className="studio-canvas__toolbar">
        <div aria-label={ZOOM_LABEL} className="studio-canvas__zoom" role="group">
          <button aria-label={ZOOM_OUT_LABEL} className="studio-canvas__zoom-step" onClick={zoomOut} type="button">
            −
          </button>
          <button aria-label={ZOOM_HOME_LABEL} className="studio-canvas__zoom-level" onClick={zoomHome} type="button">
            {zoomPercent(zoom)}
          </button>
          <button aria-label={ZOOM_IN_LABEL} className="studio-canvas__zoom-step" onClick={zoomIn} type="button">
            +
          </button>
        </div>
        <Button reason={AUTO_LAYOUT_SOON} size="sm" tone="ghost">
          {AUTO_LAYOUT_LABEL}
        </Button>
        <Button reason={ADD_STAGE_SOON} size="sm">
          {ADD_STAGE_LABEL}
        </Button>
        {/* The selection, said out loud: the inspector's stand-in, and the keyboard's confirmation. */}
        <p className="studio-canvas__status" role="status">
          {status}
        </p>
        {edited && <p className="studio-canvas__unsaved">{UNSAVED_NOTE}</p>}
        <span className="studio-canvas__hint">{CANVAS_HINT}</span>
      </div>
    </section>
  );
}
