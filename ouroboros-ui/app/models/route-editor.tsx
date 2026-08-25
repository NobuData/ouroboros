"use client";

import { useRouter } from "next/navigation";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  type BatchProblems,
  type ChainDraft,
  ROUTES_REFUSED,
  ROUTES_SAVED,
  type SavedRoute,
  addHop,
  addedHopId,
  moveHop,
  removeHop,
  sameChain,
  swapHop,
  toSaveInput,
} from "./chain";
import type { AliasCell } from "./matrix";
import { readRuleTargets } from "./rule-actions";
import { saveRoutes } from "./route-actions";
import type { RuleTargetsReading } from "./rules";

/**
 * The editing state behind **Save routes**
 * ([#202](https://github.com/NobuData/ouroboros/issues/202)) — the one state four surfaces
 * read: the matrix's cells and row marks, the inspector's chain, the dirty-state bar, and the
 * head's own **Save routes** action.
 *
 * A context rather than a prop, because the four are not in one subtree: the head is drawn
 * by `app/models/models-frame.tsx` above the matrix, and the bar sits between them. A count
 * threaded through the frame as a prop would make a Server Component carry client state it
 * cannot hold, and a second copy of the count in each surface would be four numbers that can
 * disagree about whether there is anything to save.
 *
 * ### What is held, and what is derived
 *
 * The state is **edits** — a draft per route that differs from the server's, and nothing for
 * a route nobody touched — over a **baseline** that is the server's own routes, handed in as
 * a prop and never modified. `app/models/chain.ts` says why at length; the consequence here
 * is that every derived fact is one line: `pending` is the number of edits, **Discard** is the
 * empty map, and a save that lands is the empty map followed by `router.refresh()`, which
 * re-reads the matrix so the resolution lines redraw from what the server now holds rather
 * than from what this browser sent.
 *
 * An edit that lands back on the baseline is dropped rather than stored — a hop dragged
 * away and back is not a change — so the count the bar prints is a count of routes that
 * would actually be written.
 *
 * ### The registry list is read once, on demand
 *
 * The swap and add menus are built from `GET /api/v1/routing/aliases`, read the first time a
 * menu opens rather than with the page — the same trade the rules card's builder makes, and
 * for the same reason: a member session has no menu and would pay for a list nothing draws.
 * It is held here rather than per menu so that eight hops' menus are one read.
 *
 * ### Read-only is a rendering mode
 *
 * `editable` is the reader's role, decided at the gate. When it is `false` every edit is a
 * no-op and `pending` is structurally zero — but the drafts are still served, because a
 * member's inspector draws the same chain an owner's does, without the controls. The gate
 * that **enforces** is the service's; `app/models/route-actions.ts` says what happens to a
 * member who reaches the write anyway.
 */

/** What every surface on the page may ask of the editor, and do to it. */
export interface RouteEditor {
  /** Whether this reader's role may change routes. `false` renders every surface read-only. */
  readonly editable: boolean;
  /** How many routes differ from what the server holds — what the bar counts and Save is enabled by. */
  readonly pending: number;
  /** Whether a save is in flight. Every control that would change the batch is inert while it is. */
  readonly saving: boolean;
  /** Why the last save did not land, or `null`. Cleared by the next edit, discard or save. */
  readonly failure: string | null;
  /** What is announced about the last save — {@link ROUTES_SAVED} — or `null`. */
  readonly notice: string | null;
  /** What the server refused about each route on the last save, keyed by task kind. */
  readonly problems: BatchProblems;
  /** The registry list, once read: every alias with its resolution line, or why not. `null` before the first read. */
  readonly registry: RuleTargetsReading | null;
  /**
   * One route as it currently stands — the edit if there is one, the server's route if not.
   *
   * @param kind The task kind.
   * @returns The draft, or `null` for a kind with no route.
   */
  readonly draft: (kind: string) => ChainDraft | null;
  /**
   * One route's unsaved edit, if it has one.
   *
   * @param kind The task kind.
   * @returns The edited draft, or `null` when the route is as the server holds it.
   */
  readonly edit: (kind: string) => ChainDraft | null;
  /** Move a hop within a route. `from` and `to` are indexes from 0; `to` is clamped. */
  readonly move: (kind: string, from: number, to: number) => void;
  /** Point a hop at another alias. */
  readonly swap: (kind: string, index: number, target: AliasCell) => void;
  /** Append a hop. */
  readonly add: (kind: string, target: AliasCell) => void;
  /** Remove a hop — when `app/models/chain.ts`'s `removalReason` allows it. */
  readonly remove: (kind: string, index: number) => void;
  /** Drop every edit, restoring the last saved state exactly. */
  readonly discard: () => void;
  /** Commit every edit in one batch. */
  readonly save: () => void;
  /** Read the registry list, once. Later calls are free. */
  readonly readRegistry: () => void;
}

/**
 * What a surface reads when no provider is above it: a read-only editor holding no routes.
 *
 * Exists so that a component using {@link useRouteEditor} renders sensibly in isolation —
 * a story, a test of the matrix alone — rather than throwing for want of a provider.
 */
const READ_ONLY: RouteEditor = {
  editable: false,
  pending: 0,
  saving: false,
  failure: null,
  notice: null,
  problems: {},
  registry: null,
  draft: () => null,
  edit: () => null,
  move: () => {},
  swap: () => {},
  add: () => {},
  remove: () => {},
  discard: () => {},
  save: () => {},
  readRegistry: () => {},
};

const RouteEditorContext = createContext<RouteEditor>(READ_ONLY);

/**
 * The editor, from the nearest provider.
 *
 * @returns The editor, or the read-only one when no provider is above the caller.
 */
export function useRouteEditor(): RouteEditor {
  return useContext(RouteEditorContext);
}

/** What the provider takes. */
export interface RouteEditorProviderProps {
  /**
   * The server's routes — the baseline every edit is measured against.
   *
   * Formed on the server by `app/models/chain.ts`'s `savedRoutes`, so the contract's shapes
   * stay out of the browser bundle and the provider is handed exactly what it holds.
   */
  readonly routes: readonly SavedRoute[];
  /** Whether this reader's role may change routes — `app/api/membership.ts`'s `mayAdminister`. */
  readonly editable: boolean;
  /** The page. */
  readonly children: ReactNode;
}

/**
 * The provider.
 *
 * @param props See {@link RouteEditorProviderProps}.
 * @returns The children, with the editor above them.
 */
export function RouteEditorProvider({ routes, editable, children }: RouteEditorProviderProps) {
  const router = useRouter();
  const baseline = useMemo(() => new Map(routes.map((route) => [route.kind, route])), [routes]);

  const [edits, setEdits] = useState<ReadonlyMap<string, ChainDraft>>(() => new Map());
  const [problems, setProblems] = useState<BatchProblems>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [registry, setRegistry] = useState<RuleTargetsReading | null>(null);
  const [saving, startSaving] = useTransition();

  /** The next id for a hop added in this browser — never reused, however many are added. */
  const serial = useRef(0);
  /** Whether a registry read is in flight, so two menus opened at once make one request. */
  const reading = useRef(false);

  /**
   * Apply one change to one route.
   *
   * The map holds only differences: a change that lands back on the baseline removes the
   * entry rather than storing a draft equal to it. A refusal from the last save is about the
   * batch that was sent, and an edit to the route makes it a different batch — so the route's
   * problems are cleared, and the bar's sentence with them.
   *
   * @param kind The task kind.
   * @param change The edit, over the route as it currently stands.
   */
  const edit = useCallback(
    (kind: string, change: (draft: ChainDraft) => ChainDraft): void => {
      if (!editable || saving) return;

      const saved = baseline.get(kind);
      if (saved === undefined) return;

      setEdits((previous) => {
        const current = previous.get(kind) ?? saved;
        const next = change(current);
        if (next === current) return previous;

        const map = new Map(previous);
        if (sameChain(next, saved)) {
          map.delete(kind);
        } else {
          map.set(kind, next);
        }

        return map;
      });
      setProblems((previous) => {
        if (!(kind in previous)) return previous;

        return Object.fromEntries(Object.entries(previous).filter(([other]) => other !== kind));
      });
      setFailure(null);
      setNotice(null);
    },
    [baseline, editable, saving],
  );

  const discard = useCallback((): void => {
    if (saving) return;

    setEdits(new Map());
    setProblems({});
    setFailure(null);
    setNotice(null);
  }, [saving]);

  const save = useCallback((): void => {
    if (!editable || saving || edits.size === 0) return;

    const batch = [...edits.values()].map(toSaveInput);

    setFailure(null);
    setNotice(null);
    setProblems({});

    startSaving(async () => {
      const outcome = await saveRoutes(batch);

      if (outcome.ok) {
        // The edits leave with the fresh read rather than being kept as a copy of what was
        // sent: what the matrix shows after a save is what the server holds and nothing else.
        setEdits(new Map());
        setNotice(ROUTES_SAVED);
        router.refresh();
        return;
      }

      if (outcome.kind === "refused") {
        setProblems(outcome.problems);
        setFailure(ROUTES_REFUSED);
        return;
      }

      setFailure(outcome.reason);
    });
  }, [editable, saving, edits, router]);

  const readRegistry = useCallback((): void => {
    // A list already read is not read again; a read that failed is, so the next menu opened
    // is a retry rather than the same sentence for the rest of the page's life.
    if (reading.current || registry?.ok === true) return;

    reading.current = true;
    setRegistry(null);

    void readRuleTargets().then((result) => {
      reading.current = false;
      setRegistry(result);
    });
  }, [registry]);

  const editor = useMemo<RouteEditor>(
    () => ({
      editable,
      pending: edits.size,
      saving,
      failure,
      notice,
      problems,
      registry,
      draft: (kind) => edits.get(kind) ?? baseline.get(kind) ?? null,
      edit: (kind) => edits.get(kind) ?? null,
      move: (kind, from, to) => {
        edit(kind, (draft) => moveHop(draft, from, to));
      },
      swap: (kind, index, target) => {
        edit(kind, (draft) => swapHop(draft, index, target));
      },
      add: (kind, target) => {
        serial.current += 1;
        const id = addedHopId(kind, serial.current);
        edit(kind, (draft) => addHop(draft, target, id));
      },
      remove: (kind, index) => {
        edit(kind, (draft) => {
          const removal = removeHop(draft, index);
          return removal.ok ? removal.draft : draft;
        });
      },
      discard,
      save,
      readRegistry,
    }),
    [
      editable,
      edits,
      saving,
      failure,
      notice,
      problems,
      registry,
      baseline,
      edit,
      discard,
      save,
      readRegistry,
    ],
  );

  return <RouteEditorContext.Provider value={editor}>{children}</RouteEditorContext.Provider>;
}
