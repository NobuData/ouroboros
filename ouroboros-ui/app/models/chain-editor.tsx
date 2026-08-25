"use client";

import { type DragEvent, useEffect, useRef, useState } from "react";

import { Button, Chip, EmptyState, cx } from "@/app/ui";

import { AliasMenu } from "./alias-menu";
import {
  ADD_HOP,
  ADD_MENU_LABEL,
  AT_BOTTOM_REASON,
  AT_TOP_REASON,
  type ChainDraft,
  DRAG_HINT,
  type DraftHop,
  type HopTarget,
  NO_ROUTE_NOTE,
  SAVING,
  addAnnouncement,
  moveAnnouncement,
  moveDownLabel,
  moveUpLabel,
  problemLines,
  removalReason,
  removeAnnouncement,
  removeLabel,
  swapAnnouncement,
  swapLabel,
  swapMenuLabel,
} from "./chain";
import {
  HEALTH_UNREAD,
  type HopHealth,
  type HopHealthIndex,
  hopHealth,
  hopHealthTitle,
  hopMetaLine,
} from "./inspector";
import { type RouteEditor, useRouteEditor } from "./route-editor";

import "./models.css";

/**
 * The selected route's chain, in the inspector's seat — drawn for everybody, editable for a
 * role that may ([#202](https://github.com/NobuData/ouroboros/issues/202)).
 *
 * Mockup 06's **ROUTE — implement-primary** card draws the chain as a numbered rail: the
 * index in a violet ring, a line down to the next hop, the alias pill, the resolution after an
 * arrow, the health dot, and the hop-meta line beneath. That is what this draws, from the
 * editor's draft of the route — and for an owner or admin, the controls the ticket adds to
 * each hop: a drag handle, move-up and move-down, the swap menu on the pill, and remove; plus
 * **+ Add hop** under the chain. The policy switches under the chain are
 * `app/models/route-policy.tsx`'s (AA.4, [#203](https://github.com/NobuData/ouroboros/issues/203)).
 *
 * ### The dot is the strip's, and the line under a hop is the operator's or the health's
 *
 * Since AA.4 each hop wears the health of the connection its alias is bound to, looked up in
 * the page's own strip read — `app/models/inspector.ts` says why it is a lookup rather than a
 * status of the hop's own, and why `unknown` is a ring. Its `title` is the last-checked detail
 * the strip's chip carries. The line beneath is the operator's note where there is one, and
 * the hop's health line — `Primary · healthy · 42ms`, the shape Z.1's kept-hop sentence takes
 * — where there is not, because a hop with nothing to say about itself still has a role and a
 * state.
 *
 * ### Every drag has a keyboard path, and the path is the same edit
 *
 * Dragging a hop's ⠿ onto another hop and pressing its move button both call the editor's
 * `move` with the same two indexes, so there is one reorder and two ways to ask for it — not a
 * drag that reorders and a button that approximates it. The move buttons are the accessible
 * path: they are real buttons with names that say which hop and which way, the one at either
 * end is inert *with its reason* rather than missing, and after a move **focus stays on the
 * button the reader pressed**, on the hop that moved, so a reader can press it again without
 * finding it. That last part is not free: React moves the hop's element in the DOM to reorder
 * it, and a browser blurs an element that is moved, so the focus is put back by name after the
 * render rather than trusted to survive.
 *
 * Every move, swap, add and remove is announced in a live region, in a sentence that carries
 * the position and the count — which is what a reader who cannot see the rail needs to know
 * whether the hop is now the primary or the last resort.
 *
 * ### The drag is hand-rolled, and the ticket asked for the decision to be recorded
 *
 * Native HTML drag and drop, in about thirty lines: `draggable` on the handle, `dragover`
 * and `drop` on the hops. It is a list of at most a handful of items, in one direction, with
 * a keyboard alternative that had to exist anyway — which is the case a drag library is *not*
 * for. `@dnd-kit` would have cost the page its sensors, its collision detection and its
 * context for a reorder the keyboard does in two buttons; the bundle delta of this choice is
 * zero bytes of dependency, and the issue records the measured figure.
 *
 * ### A refused edit is refused at the control, with its reason
 *
 * The remove button is inert — `aria-disabled`, with the sentence as its title and printed
 * beside it — when removing would empty the chain or breach the route's floor. That is
 * `app/models/chain.ts`'s `removalReason`, decided before the press; the server decides it
 * again, and its answer lands under the chain as the same list the matrix row prints.
 */

/** What the editor takes. */
export interface ChainEditorProps {
  /** The selected route's task kind. */
  readonly kind: string;
  /**
   * A token that, when it changes, moves focus into the chain — the matrix's ⠿ shortcut.
   *
   * A number rather than a boolean so that pressing the shortcut twice on the same row moves
   * focus twice; the value itself means nothing.
   */
  readonly focusToken?: number;
  /**
   * The strip, indexed by connection — what the health dots are drawn from
   * (`app/models/inspector.ts`'s `hopHealthIndex`).
   *
   * Defaults to *not read*, which draws every dot as a ring with a hover saying so: a chain
   * rendered without a strip — a test, a story — says nothing it cannot know.
   */
  readonly health?: HopHealthIndex;
}

/** Which of a hop's controls focus is put back on after a move. */
type Control = "up" | "down";

/**
 * The chain.
 *
 * @param props See {@link ChainEditorProps}.
 * @returns The rail, the controls for a role that may edit, and the foot.
 */
export function ChainEditor({ kind, focusToken = 0, health = HEALTH_UNREAD }: ChainEditorProps) {
  const editor = useRouteEditor();
  const draft = editor.draft(kind);

  const root = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  /** Where focus goes after the next render — the control a move was made with. */
  const pendingFocus = useRef<{ readonly id: string; readonly control: Control } | null>(null);

  // Focus follows the hop it was on. The element moved in the DOM, and a moved element is
  // blurred, so the control is found again by the hop's id and focused after the render.
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;

    pendingFocus.current = null;
    control(root.current, target.id, target.control)?.focus();
  });

  // The matrix's ⠿ shortcut: focus lands on the first hop's first control.
  useEffect(() => {
    if (focusToken === 0) return;

    root.current?.querySelector<HTMLElement>("[data-control]")?.focus();
  }, [focusToken]);

  if (draft === null) {
    return <EmptyState fill note={NO_ROUTE_NOTE} title={kind} />;
  }

  const count = draft.hops.length;

  /**
   * Move a hop, by either path, and say so.
   *
   * @param from The hop's index.
   * @param to Where it goes. Clamped by the editor; the announcement clamps the same way.
   */
  function move(from: number, to: number): void {
    const hop = draft?.hops[from];
    if (hop === undefined || from === to) return;

    editor.move(kind, from, to);
    setAnnouncement(moveAnnouncement(hop.alias, Math.min(Math.max(to, 0), count - 1) + 1, count));
  }

  /**
   * Move a hop with a button, keeping focus on that button.
   *
   * @param hop The hop.
   * @param index Its index.
   * @param direction Which way.
   */
  function press(hop: DraftHop, index: number, direction: Control): void {
    pendingFocus.current = { id: hop.id, control: direction };
    move(index, direction === "up" ? index - 1 : index + 1);
  }

  /**
   * Drop a dragged hop onto this one.
   *
   * @param index The hop dropped onto.
   * @param event The drop.
   */
  function drop(index: number, event: DragEvent<HTMLLIElement>): void {
    if (dragging === null) return;

    event.preventDefault();
    move(dragging, index);
    setDragging(null);
    setOver(null);
  }

  return (
    <div className="models-chain-editor" ref={root}>
      <ol aria-label="Chain" className="models-chain">
        {draft.hops.map((hop, index) => {
          // Looked up once per hop: the dot and the line beneath it read the same answer.
          const wellbeing = hopHealth(hop.providerId, health);

          return (
            <li
              className={cx(
                "models-chain__hop",
                dragging === index && "models-chain__hop--dragging",
                over === index && dragging !== index && "models-chain__hop--over",
              )}
              data-hop-id={hop.id}
              key={hop.id}
              onDragLeave={() => {
                if (over === index) setOver(null);
              }}
              onDragOver={(event) => {
                if (dragging === null) return;
                // The default refuses the drop; preventing it is what makes this hop a target.
                event.preventDefault();
                if (over !== index) setOver(index);
              }}
              onDrop={(event) => {
                drop(index, event);
              }}
            >
              <div aria-hidden className="models-chain__rail">
                <span className="models-chain__idx">{index + 1}</span>
                {index < count - 1 && <span className="models-chain__line" />}
              </div>

              <div className="models-chain__body">
                <div className="models-chain__row">
                  {editor.editable && (
                    <span
                      aria-hidden
                      className="models-chain__handle"
                      draggable
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      onDragStart={(event) => {
                        carry(event, hop.alias);
                        setDragging(index);
                      }}
                      title={DRAG_HINT}
                    >
                      ⠿
                    </span>
                  )}

                  <HopAlias
                    editor={editor}
                    hop={hop}
                    index={index}
                    onSwap={(to) => {
                      editor.swap(kind, index, to);
                      setAnnouncement(swapAnnouncement(index + 1, hop.alias, to.alias));
                    }}
                  />

                  <span className="models-chain__resolution">→ {hop.resolution}</span>

                  <HealthDot health={wellbeing} />
                </div>

                <div className="models-chain__meta">{hopMetaLine(hop, index + 1, wellbeing)}</div>

                {editor.editable && (
                  <HopControls
                    draft={draft}
                    hop={hop}
                    index={index}
                    onMove={(direction) => {
                      press(hop, index, direction);
                    }}
                    onRemove={() => {
                      editor.remove(kind, index);
                      setAnnouncement(removeAnnouncement(hop.alias, count - 1));
                    }}
                    saving={editor.saving}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="models-chain__foot">
        {editor.editable && (
          <AliasMenu
            menuLabel={ADD_MENU_LABEL}
            onPick={(target) => {
              editor.add(kind, target);
              setAnnouncement(addAnnouncement(target.alias, count + 1));
            }}
            trigger={(props) => (
              <Button {...props} reason={editor.saving ? SAVING : undefined} size="sm" tone="ghost">
                {ADD_HOP}
              </Button>
            )}
          />
        )}

        <ChainProblems editor={editor} kind={kind} />
      </div>

      {/*
        Where every edit is said out loud. `role="status"`: an edit is what the reader asked
        for, not an interruption. Always mounted, so the first one is heard.
      */}
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </div>
  );
}

/**
 * The hop's health dot — mockup 06's `.dot` beside the resolution, in the strip's treatment
 * for the hop's connection.
 *
 * An image with a name rather than a decoration: the dot is the one place on the rail the
 * state is carried for a hop with a note, and a reader who cannot see the hue hears the word
 * and the last-checked detail. A ring, never a disc, for every state nobody reported.
 *
 * @param props.health The hop's health, decided.
 * @returns The dot.
 */
function HealthDot({ health }: Readonly<{ health: HopHealth }>) {
  const title = hopHealthTitle(health);

  return (
    <span
      aria-label={title}
      className={cx(
        "models-chain__dot",
        `models-chain__dot--${health.tone}`,
        health.dot === "ring" && "models-chain__dot--ring",
      )}
      role="img"
      title={title}
    />
  );
}

/**
 * The alias pill — the swap menu's trigger for a role that may edit, the pill alone for one
 * that may not.
 *
 * @param props.editor The editor.
 * @param props.hop The hop.
 * @param props.index Its index.
 * @param props.onSwap What to do with the alias picked.
 * @returns The pill, or the menu around it.
 */
function HopAlias({
  editor,
  hop,
  index,
  onSwap,
}: Readonly<{
  editor: RouteEditor;
  hop: DraftHop;
  index: number;
  onSwap: (to: HopTarget) => void;
}>) {
  // The primary in the model hue, the fallbacks in the quiet neutral — the matrix's own two
  // treatments, so the chain and the row it summarises read as one thing.
  const tone = index === 0 ? "model" : "neutral";

  if (!editor.editable) {
    return (
      <Chip mono tone={tone}>
        {hop.alias}
      </Chip>
    );
  }

  return (
    <AliasMenu
      current={hop.alias}
      label={swapLabel(index + 1, hop.alias)}
      menuLabel={swapMenuLabel(index + 1)}
      onPick={onSwap}
      trigger={(props) => (
        <button {...props} className="models-chain__swap" data-control="swap">
          <Chip mono tone={tone}>
            {hop.alias}
          </Chip>
          <span aria-hidden className="models-chain__caret">
            ▾
          </span>
        </button>
      )}
    />
  );
}

/**
 * One hop's three buttons — up, down, remove — each inert with its reason where the edit is
 * not one the chain can take.
 *
 * @param props.draft The route.
 * @param props.hop The hop.
 * @param props.index Its index.
 * @param props.onMove Move it.
 * @param props.onRemove Remove it.
 * @param props.saving Whether a save is in flight, which makes every edit inert.
 * @returns The controls.
 */
function HopControls({
  draft,
  hop,
  index,
  onMove,
  onRemove,
  saving,
}: Readonly<{
  draft: ChainDraft;
  hop: DraftHop;
  index: number;
  onMove: (direction: Control) => void;
  onRemove: () => void;
  saving: boolean;
}>) {
  const last = draft.hops.length - 1;
  const blocked = removalReason(draft, index);
  // Every edit is inert while the batch is in flight: an edit that raced the save would be
  // either lost or sent twice, and neither is what the reader pressed for.
  const hold = saving ? SAVING : undefined;

  return (
    <div className="models-chain__controls">
      <Button
        aria-label={moveUpLabel(hop.alias)}
        data-control="up"
        onClick={() => {
          onMove("up");
        }}
        reason={index === 0 ? AT_TOP_REASON : hold}
        size="sm"
      >
        ↑
      </Button>
      <Button
        aria-label={moveDownLabel(hop.alias)}
        data-control="down"
        onClick={() => {
          onMove("down");
        }}
        reason={index === last ? AT_BOTTOM_REASON : hold}
        size="sm"
      >
        ↓
      </Button>
      <Button
        aria-label={removeLabel(hop.alias)}
        data-control="remove"
        onClick={onRemove}
        reason={blocked ?? hold}
        size="sm"
        tone="ghost"
      >
        Remove
      </Button>

      {/*
        The reason, printed as well as carried: a title is what the house rule gives an inert
        control, and it is invisible to a keyboard reader on the control it explains. A
        removal that is blocked is the ticket's "explained inline at the point of the attempt",
        so the sentence is on the page.
      */}
      {blocked !== null && <p className="models-chain__blocked">{blocked}</p>}
    </div>
  );
}

/**
 * What the server refused about this route on the last save — the same lines the matrix row
 * prints, under the chain they are about.
 *
 * @param props.editor The editor.
 * @param props.kind The route.
 * @returns The list, or nothing.
 */
function ChainProblems({ editor, kind }: Readonly<{ editor: RouteEditor; kind: string }>) {
  const problems = editor.problems[kind];
  if (problems === undefined) return null;

  return (
    <ul className="models-chain__problems" role="alert">
      {problemLines(problems).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/**
 * Put the dragged hop's alias on the drag, where the environment has a drag to put it on.
 *
 * Some browsers refuse to start a drag that carries nothing, so the alias is carried; jsdom
 * dispatches a drag with no `dataTransfer` at all, which is why the guard exists rather than
 * because the product ever runs without one.
 *
 * @param event The drag start.
 * @param alias What the drag carries.
 */
function carry(event: DragEvent<HTMLSpanElement>, alias: string): void {
  const transfer: DataTransfer | null | undefined = event.dataTransfer;
  if (!transfer) return;

  transfer.effectAllowed = "move";
  transfer.setData("text/plain", alias);
}

/**
 * One hop's control, found by the hop's id.
 *
 * By iteration rather than an attribute selector, because a task kind is a workspace's own
 * string and an id built from one is not something to interpolate into a selector.
 *
 * @param root The editor's root, or `null` before it has mounted.
 * @param id The hop's id.
 * @param which Which control.
 * @returns The element, or `null`.
 */
function control(root: HTMLElement | null, id: string, which: Control): HTMLElement | null {
  const hops = root?.querySelectorAll<HTMLElement>("[data-hop-id]") ?? [];

  for (const hop of hops) {
    if (hop.dataset.hopId === id) {
      return hop.querySelector<HTMLElement>(`[data-control="${which}"]`);
    }
  }

  return null;
}
