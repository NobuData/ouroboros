"use client";

import {
  Background,
  BackgroundVariant,
  type Connection as FlowConnection,
  ConnectionMode,
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
import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { WorkflowDefinition, WorkflowStageCatalog, WorkflowStageType } from "@/app/api/workflows";
import { Button } from "@/app/ui";

import {
  type Deletion,
  freePosition,
  stageTemplate,
  withAddedStage,
  withConnection,
  withInsertedStage,
} from "./edit";
import {
  type CanvasSelection,
  type EdgeRef,
  STAGE_BOX,
  STAGE_EDGE_TYPE,
  STAGE_NODE_TYPE,
  type Size,
  type StageEdge as StageEdgeType,
  type StageNode as StageNodeType,
  reconcileEdges,
  reconcileNodes,
  selectionOf,
  toEdges,
  toNodes,
  withHighlight,
  withPositions,
} from "./graph";
import { historyKey, isDeleteKey, isTypingTarget } from "./keys";
import { edgeProblem, insertProblem, stageProblem } from "./rules";
import { EdgeMarkers, StageEdge } from "./stage-edge";
import { StageMenu } from "./stage-menu";
import { StageNode } from "./stage-node";
import {
  ADD_STAGE_LABEL,
  ADD_STAGE_MENU_LABEL,
  AUTO_LAYOUT_EMPTY,
  AUTO_LAYOUT_LABEL,
  CANVAS_HINT,
  CANVAS_LABEL,
  CATALOG_UNREAD_REASON,
  HISTORY_LABEL,
  NOTHING_TO_REDO,
  NOTHING_TO_UNDO,
  REDO_LABEL,
  UNDO_LABEL,
  UNSAVED_NOTE,
  ZOOM_HOME_LABEL,
  ZOOM_IN_LABEL,
  ZOOM_LABEL,
  ZOOM_OUT_LABEL,
  connectionRefused,
  insertMenuLabel,
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
 * The nodes and edges are React state derived from the definition the canvas is handed
 * (`graph.ts`), and every change React Flow reports is applied to that state — which is what
 * *controlled* means here: the library draws what this component holds and asks before
 * changing it. Every edit the canvas makes — a settled move, a connection, an added or inserted
 * stage, an auto-layout — is computed as a new document from the one it was handed and passed up
 * through `onDefinitionChange`; the caller (`studio-editor.tsx`) records it in the draft's history
 * and hands the new draft back, and the canvas reconciles its nodes against it during render —
 * positions, data and names from the document, measurements and selection kept — so the canvas never
 * holds a second copy of the graph to drift from the draft.
 *
 * ### What the stages and edges look like
 *
 * Mockup 04's visual language (S.3, [#149](https://github.com/NobuData/ouroboros/issues/149)):
 * every stage is `stage-node.tsx` in its type's treatment, with its chips derived from its config,
 * and every connection is `stage-edge.tsx` — plain, loop or active, with the arrowhead and the
 * label pill that go with it. The arrowheads are defined once, here, for every edge to name.
 *
 * **Highlight mode** draws an execution path over the graph: every edge `highlight` names is drawn
 * in the mockup's active treatment. It takes the dry run's own `highlight_path`, so S.6's overlay
 * hands the answer through as it arrives; the path is applied over the edges at render and never
 * stored in them, so clearing it — which S.6 does on the first edit — is passing `null`.
 *
 * ### Editing (S.5, [#151](https://github.com/NobuData/ouroboros/issues/151))
 *
 * - **Add stage ▾** is the catalog R.3 serves (`stage-menu.tsx`) and drops the type's defaulted
 *   stage at the viewport's centre, nudged off any stage already there.
 * - **Connect by drag** from any side of a stage to another. The connection is judged by the DSL's
 *   structural rules (`rules.ts`) before it is made, and one that breaks a rule is refused with the
 *   rule's reason on the toolbar's notice line — never silently dropped.
 * - **Double-click an edge** opens the same menu to insert a stage into it, rewiring both sides
 *   (`edit.ts`'s `withInsertedStage`); a type that cannot sit between two stages says why.
 * - **Delete** (or Backspace) over a selection asks the caller to confirm (`onDeleteRequest`), because
 *   a stage takes its edges with it and a key press is an easy thing to make by accident.
 * - **Auto-layout** is dagre, layered left to right (`auto-layout.ts`, loaded when pressed).
 * - **Undo** and **Redo**, and ⌘Z/Ctrl+Z, ⇧⌘Z/Ctrl+Y, step through the caller's history.
 *
 * The edge's kind, label and condition, and a keyboard **Connect**, are the inspector's
 * (`inspector/edge-inspector.tsx`, `inspector/connect-row.tsx`), so every one of these is reachable
 * without a pointer. A reader who may not edit (`readOnlyReason`) sees each control inert with the
 * reason, and a Delete or a double-click says it on the notice line.
 *
 * ### Pan, zoom, select
 *
 * The mockup's hint is *⌥ drag to pan*, so a plain drag on the stage is a **selection** (the
 * rubber band) and panning is the modifier: **⌥** or **space** held with a drag, or the middle
 * or right mouse button. The wheel zooms, pinch zooms, and the toolbar steps through
 * `viewport.ts`'s ladder. A double-click does not zoom: on this canvas it inserts. React Flow's own
 * keyboard model is left on: Tab reaches each stage and each edge, Enter or space selects, the arrow
 * keys move a selected stage, Escape clears.
 *
 * ### Both themes from tokens
 *
 * Only the library's structural sheet is imported (`base.css`, not `style.css`), and every
 * colour it would fall back to is redefined on a token in `canvas.css` — `canvas-styles.test.ts`
 * holds the two lists equal. The library's own `colorMode` is left at its default, because the
 * tokens already switch with the palette and a second theme switch would be a second place a
 * theme is decided.
 */

/** Undo and redo, as the caller's history offers them. */
export interface CanvasHistory {
  /** Whether there is an edit to undo. */
  readonly canUndo: boolean;
  /** Whether there is an undone edit to redo. */
  readonly canRedo: boolean;
  /** Undo the last edit. */
  readonly onUndo: () => void;
  /** Redo the last undone edit. */
  readonly onRedo: () => void;
}

/** What the canvas takes. */
export interface StudioCanvasProps {
  /** The workflow's id — what its viewport is remembered under. */
  readonly workflowId: string;
  /**
   * The document the canvas draws: the draft (`app/workflows/view.ts`'s `canvasDefinition` at first,
   * then whatever the caller's history holds). A new document is reconciled into the canvas rather
   * than remounting it, so the reader keeps their selection and place.
   */
  readonly definition: WorkflowDefinition;
  /**
   * The execution path to draw, as the dry run's `highlight_path` names it — every edge the walk
   * took, by its ordered pair. `null` or absent draws none.
   */
  readonly highlight?: readonly EdgeRef[] | null;
  /**
   * A stage asked for from outside the canvas — a publish finding, a dry-run step (S.6,
   * [#152](https://github.com/NobuData/ouroboros/issues/152)). Each new request selects the stage,
   * reports the selection as a click would, and brings the stage into view; `nonce` makes asking for
   * the same stage twice a second request.
   */
  readonly focus?: { readonly id: string; readonly nonce: number } | null;
  /**
   * What the toolbar says about saving, from the caller's autosave — `null` for nothing to say. Absent,
   * the canvas says {@link UNSAVED_NOTE} once it has been edited, because nothing behind it saves.
   */
  readonly saveNote?: string | null;
  /**
   * Told the document an edit on the canvas produced — a settled move, a connection, an added or
   * inserted stage, an auto-layout. The caller is expected to hand it back as `definition`.
   */
  readonly onDefinitionChange?: (definition: WorkflowDefinition) => void;
  /**
   * Told what is selected, each time that changes — including once at mount, with nothing.
   * The inspector is the caller this exists for.
   */
  readonly onSelectionChange?: (selection: CanvasSelection) => void;
  /** Told what a Delete over the canvas would remove, for the caller to confirm and apply. */
  readonly onDeleteRequest?: (deletion: Deletion) => void;
  /** The stage catalog — Add stage's menu — or `null` when it could not be read. */
  readonly catalog?: WorkflowStageCatalog | null;
  /** Undo and redo. Absent draws both inert. */
  readonly history?: CanvasHistory;
  /**
   * Why the reader may not change the workflow, or `undefined` when they may. Set, it makes every
   * structural edit inert with this reason. Moving a stage is not one — it changes nothing a run reads.
   */
  readonly readOnlyReason?: string;
  /**
   * Where the viewport is remembered. Defaults to the browser's `localStorage`, guarded; a
   * suite passes its own.
   */
  readonly storage?: Storage;
}

/** The one node type, registered once so React Flow does not re-register it on every render. */
const NODE_TYPES = { [STAGE_NODE_TYPE]: StageNode };

/** The one edge type, registered once for the same reason. */
const EDGE_TYPES = { [STAGE_EDGE_TYPE]: StageEdge };

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

/** The margin an auto-layout's fit leaves around the graph, as a share of the stage. */
const FIT_PADDING = 0.08;

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
  highlight = null,
  focus = null,
  saveNote,
  onDefinitionChange,
  onSelectionChange,
  onDeleteRequest,
  catalog = null,
  history,
  readOnlyReason,
  storage,
}: StudioCanvasProps) {
  const [nodes, setNodes] = useState<StageNodeType[]>(() => toNodes(definition));
  const [edges, setEdges] = useState<StageEdgeType[]>(() => toEdges(definition));
  // The document the nodes were last built from. When the caller hands down a different one — an
  // edit recorded, an inspector Apply, an undo — the nodes and edges are reconciled during render
  // (React's *adjusting state when a prop changes*), so the canvas follows the draft without
  // remounting under the reader.
  const [heldDefinition, setHeldDefinition] = useState(definition);
  if (heldDefinition !== definition) {
    setHeldDefinition(definition);
    setNodes((current) => reconcileNodes(current, definition));
    setEdges((current) => reconcileEdges(current, definition));
  }
  // The document the canvas opened on, so *not saved* follows an edit made anywhere.
  const [openedOn] = useState(definition);
  // The nodes as of the last change, for the next change to build on. React Flow can report
  // two batches of changes between two renders — a measurement and a selection, say — and a
  // handler that read `nodes` from its render would apply the second batch to the state the
  // first one had already replaced. Brought up to date after every commit as well, so a node a
  // reconcile added or removed is in it.
  const nodesRef = useRef(nodes);
  useLayoutEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const [edited, setEdited] = useState(false);
  const [selection, setSelection] = useState<CanvasSelection>(null);
  const [zoom, setZoom] = useState(HOME_VIEWPORT.zoom);
  const [menuOpen, setMenuOpen] = useState(false);
  const [insertOn, setInsertOn] = useState<EdgeRef | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Set by Auto-layout, read once the laid-out nodes have committed, so the fit sees them.
  const fitPending = useRef(false);
  const { setViewport, zoomTo, getZoom, screenToFlowPosition, fitView, setCenter } = useReactFlow<
    StageNodeType,
    StageEdgeType
  >();

  // A stage asked for from outside is selected during render, the way a new document is reconciled —
  // React Flow then reports the selection through `onSelectionChange` as it reports a click's.
  const [heldFocus, setHeldFocus] = useState(focus);
  if (heldFocus !== focus) {
    setHeldFocus(focus);
    if (focus !== null) {
      setNodes((current) =>
        current.map((node) =>
          node.selected === (node.id === focus.id) ? node : { ...node, selected: node.id === focus.id },
        ),
      );
      setEdges((current) => current.map((edge) => (edge.selected === true ? { ...edge, selected: false } : edge)));
      const target = nodes.find((node) => node.id === focus.id);
      if (target !== undefined) setSelection({ kind: "node", id: focus.id, stage: target.data.stage });
    }
  }

  // …and brought into view once it has committed, and handed to the caller, once per request.
  const focusHandled = useRef<number | null>(null);
  useEffect(() => {
    if (focus === null || focusHandled.current === focus.nonce) return;
    focusHandled.current = focus.nonce;

    const target = nodesRef.current.find((node) => node.id === focus.id);
    if (target === undefined) return;

    onSelectionChange?.({ kind: "node", id: focus.id, stage: target.data.stage });

    const width = target.measured?.width ?? STAGE_BOX.width;
    const height = target.measured?.height ?? STAGE_BOX.height;
    void setCenter(target.position.x + width / 2, target.position.y + height / 2, { zoom: getZoom() });
  }, [focus, getZoom, onSelectionChange, setCenter]);

  const addReason = readOnlyReason ?? (catalog === null ? CATALOG_UNREAD_REASON : undefined);

  // The edges as drawn: the state, with the execution path laid over it. Derived rather than
  // stored, so the path never reaches the edges a selection change is applied to.
  const drawnEdges = useMemo(() => withHighlight(edges, highlight), [edges, highlight]);

  /**
   * Hand an edit up — unless it changed nothing, which is how a move that landed where it started,
   * or a layout already in force, adds no step to undo.
   *
   * @param next The document the edit produced.
   */
  const edit = useCallback(
    (next: WorkflowDefinition) => {
      if (next === definition) return;
      setEdited(true);
      setNotice(null);
      onDefinitionChange?.(next);
    },
    [definition, onDefinitionChange],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<StageNodeType>[]) => {
      const next = applyNodeChanges(changes, nodesRef.current);
      nodesRef.current = next;
      setNodes(next);

      if (changes.some(isSettledMove)) edit(withPositions(definition, next));
    },
    [definition, edit],
  );

  const onEdgesChange = useCallback((changes: EdgeChange<StageEdgeType>[]) => {
    // Only a selection can change on an edge here — connecting is `onConnect`'s, deleting is the
    // caller's after it confirms — so a functional update is all this needs.
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  const onConnect = useCallback(
    ({ source, target }: FlowConnection) => {
      // The handles are not connectable on a read-only canvas; this is the second lock on the door.
      if (readOnlyReason !== undefined) {
        setNotice(readOnlyReason);
        return;
      }

      const ref = { from: source, to: target };
      const problem = edgeProblem(definition, { ...ref, kind: "default" });
      if (problem !== null) {
        setNotice(connectionRefused(problem));
        return;
      }

      edit(withConnection(definition, ref, { kind: "default", label: null }));
    },
    [definition, edit, readOnlyReason],
  );

  const onEdgeDoubleClick = useCallback(
    (_event: ReactMouseEvent, edge: StageEdgeType) => {
      if (addReason !== undefined) {
        setNotice(addReason);
        return;
      }

      setInsertOn({ from: edge.source, to: edge.target });
      setMenuOpen(true);
    },
    [addReason],
  );

  const onMenuOpenChange = useCallback((open: boolean) => {
    setMenuOpen(open);
    if (!open) setInsertOn(null);
  }, []);

  const pickStage = useCallback(
    (type: WorkflowStageType) => {
      const template = stageTemplate(type);

      if (insertOn !== null) {
        const inserted = withInsertedStage(definition, insertOn, template);
        if (inserted !== null) edit(inserted.definition);
        return;
      }

      // The stage's centre goes where the viewport's is, so a stage is added where the reader is looking.
      const box = stageRef.current?.getBoundingClientRect();
      const centre = screenToFlowPosition({
        x: (box?.left ?? 0) + (box?.width ?? 0) / 2,
        y: (box?.top ?? 0) + (box?.height ?? 0) / 2,
      });
      const at = freePosition(definition, { x: centre.x - STAGE_BOX.width / 2, y: centre.y - STAGE_BOX.height / 2 });

      edit(withAddedStage(definition, template, at).definition);
    },
    [definition, edit, insertOn, screenToFlowPosition],
  );

  const autoLayout = useCallback(async () => {
    // Loaded when pressed: dagre is weight only an Auto-layout needs.
    const { withLayout } = await import("./auto-layout");
    const measured = new Map<string, Size>(
      nodesRef.current.flatMap((node): [string, Size][] =>
        node.measured?.width === undefined || node.measured.height === undefined
          ? []
          : [[node.id, { width: node.measured.width, height: node.measured.height }]],
      ),
    );
    const next = withLayout(definition, measured);
    if (next === definition) return;

    fitPending.current = true;
    edit(next);
  }, [definition, edit]);

  // After an auto-layout commits, bring the whole graph into view: a layered layout of a graph built
  // in place is usually wider than the stage.
  useEffect(() => {
    if (!fitPending.current) return;
    fitPending.current = false;
    void fitView({ padding: FIT_PADDING, maxZoom: HOME_VIEWPORT.zoom, minZoom: MIN_ZOOM });
  }, [nodes, fitView]);

  const onSelection = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams<StageNodeType, StageEdgeType>) => {
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

  /**
   * Delete over the stage: ask the caller to confirm removing what is selected.
   *
   * @param event The key press, from anywhere on the stage.
   */
  const onStageKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isDeleteKey(event) || isTypingTarget(event.target)) return;

    const deletion: Deletion = {
      stages: nodesRef.current.filter((node) => node.selected === true).map((node) => node.id),
      edges: edges.filter((edge) => edge.selected === true).map((edge) => ({ from: edge.source, to: edge.target })),
    };
    if (deletion.stages.length + deletion.edges.length === 0) return;

    event.preventDefault();
    if (readOnlyReason !== undefined) {
      setNotice(readOnlyReason);
      return;
    }
    onDeleteRequest?.(deletion);
  };

  /**
   * Undo and redo from anywhere on the canvas — the stage or its toolbar — but never from a field.
   *
   * @param event The key press.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (history === undefined || isTypingTarget(event.target)) return;

    const action = historyKey(event);
    if (action === "undo" && history.canUndo) {
      event.preventDefault();
      history.onUndo();
    } else if (action === "redo" && history.canRedo) {
      event.preventDefault();
      history.onRedo();
    }
  };

  /**
   * A stage's title, for the insert menu's name.
   *
   * @param id The stage.
   * @returns Its title, or its id when the canvas does not hold it.
   */
  const titleOf = (id: string) => nodes.find((node) => node.id === id)?.data.stage.title ?? id;

  const status = selectionSentence(selection, nodes.length);
  const unsaved = edited || definition !== openedOn;
  const note = saveNote === undefined ? (unsaved ? UNSAVED_NOTE : null) : saveNote;

  return (
    <section aria-label={CANVAS_LABEL} className="studio-canvas" onKeyDown={onKeyDown}>
      <div className="studio-canvas__stage" onKeyDown={onStageKeyDown} ref={stageRef}>
        <EdgeMarkers />
        <ReactFlow<StageNodeType, StageEdgeType>
          connectionMode={ConnectionMode.Loose}
          defaultMarkerColor={null}
          defaultViewport={HOME_VIEWPORT}
          deleteKeyCode={null}
          edges={drawnEdges}
          edgesFocusable
          edgesReconnectable={false}
          edgeTypes={EDGE_TYPES}
          maxZoom={MAX_ZOOM}
          minZoom={MIN_ZOOM}
          nodeExtent={STAGE_EXTENT}
          nodes={nodes}
          nodesConnectable={readOnlyReason === undefined}
          nodesFocusable
          nodeTypes={NODE_TYPES}
          onConnect={onConnect}
          onEdgeDoubleClick={onEdgeDoubleClick}
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
          zoomOnDoubleClick={false}
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
        <Button
          onClick={() => void autoLayout()}
          reason={readOnlyReason ?? (nodes.length === 0 ? AUTO_LAYOUT_EMPTY : undefined)}
          size="sm"
          tone="ghost"
        >
          {AUTO_LAYOUT_LABEL}
        </Button>
        <StageMenu
          label={ADD_STAGE_LABEL}
          menuLabel={insertOn === null ? ADD_STAGE_MENU_LABEL : insertMenuLabel(titleOf(insertOn.from), titleOf(insertOn.to))}
          onOpenChange={onMenuOpenChange}
          onPick={pickStage}
          open={menuOpen}
          placement="up"
          problemFor={(type) => (insertOn === null ? stageProblem(definition, type) : insertProblem(definition, type))}
          reason={addReason}
          types={catalog?.nodeTypes ?? []}
        />
        <div aria-label={HISTORY_LABEL} className="studio-canvas__history" role="group">
          <Button
            onClick={history?.onUndo}
            reason={history?.canUndo === true ? undefined : NOTHING_TO_UNDO}
            size="sm"
            tone="ghost"
          >
            {UNDO_LABEL}
          </Button>
          <Button
            onClick={history?.onRedo}
            reason={history?.canRedo === true ? undefined : NOTHING_TO_REDO}
            size="sm"
            tone="ghost"
          >
            {REDO_LABEL}
          </Button>
        </div>
        {/* The selection, said out loud: the keyboard's confirmation of what Enter did. */}
        <p className="studio-canvas__status" role="status">
          {status}
        </p>
        {note !== null && <p className="studio-canvas__unsaved">{note}</p>}
        <span className="studio-canvas__hint">{CANVAS_HINT}</span>
        {/* An edit refused, with the rule it would have broken — never a silent no. */}
        {notice !== null && (
          <p className="studio-canvas__notice" role="alert">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
