"use client";

import { useRouter } from "next/navigation";
import {
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Reading } from "@/app/api/reading";
import type {
  CodeDiagnostic,
  CodeSymbol,
  WorkflowCode,
  WorkflowCodeConfig,
  WorkflowCodeTree,
} from "@/app/api/workflows";
import { workflowCodePath } from "@/app/paths";
import { Card, Chip, EmptyState, cx } from "@/app/ui";

import type { DraftConflict } from "../autosave";
import { useUnsavedBuffer } from "../mode-guard";
import { saveCode } from "./code-actions";
import type { AnchoredDiagnostics, RevealRequest } from "./code-diagnostics";
import { CodeEditor } from "./code-editor";
import { useCodeFlows } from "./code-flows-context";
import { stageRevealOf } from "./code-findings";
import { type AnchoredOutline, type OutlineRow, outlineRows, stageReveal } from "./code-panel";
import { CodePanel, CodePanelToggle } from "./code-panel-view";
import { type CodeSaveState, type CodeSaveStatus, codeSaveNote, isSaveKey } from "./code-save";
import { ConflictDialog, DiagnosticsStrip, DivergedPanel, SaveFailedBanner } from "./code-save-surfaces";
import { codeSessionStore, useCodeSession } from "./code-session";
import { CURSOR_START, codeSync, cursorPosition, draftLabel } from "./code-status";
import { CodeStatusBar } from "./code-status-bar";
import {
  type CodeSession,
  EMPTY_SESSION,
  addTab,
  adoptRead,
  arrive,
  bufferText,
  closeTab,
  discardBuffer,
  editBuffer,
  isCloseFocusedTabKey,
  isCloseTabKey,
  isDiverged,
  isModified,
  markSaved,
  openTab,
  rebaseBuffer,
  retainPaths,
  tabKeyTarget,
} from "./code-tabs";
import { type TreeFile, buildTree, treeMove, visibleRows } from "./code-tree";
import {
  CONFIG_FAILED_TITLE,
  CONFIG_FILE_PATH,
  CONFIG_SOURCE,
  EXPLORER_LABEL,
  type ExplorerReadings,
  FILE_LABEL,
  FILE_READ_ONLY_NOTE,
  MODIFIED_NOTE,
  NOTHING_OPEN_NOTE,
  NOTHING_OPEN_TITLE,
  PAUSED_NOTE,
  type PanelReadings,
  READ_ONLY_BADGE,
  TABS_LABEL,
  TREE_FAILED_TITLE,
  TREE_LABEL,
  baseName,
  closeTabLabel,
  explorerHead,
  fileSource,
  slugOfPath,
  workflowFilePath,
} from "./code-view";
import { hoverAt } from "./hover";
import { indexSymbols } from "./symbols";
import { type SaveCodeCall, useCodeSave } from "./use-code-save";

import "./code-workbench.css";

/**
 * The code view's workbench (V.3, [#171](https://github.com/NobuData/ouroboros/issues/171)) —
 * `docs/mockups/05-workflow-code.html`'s `.ide` frame: the explorer beside the tab strip, over the
 * open file.
 *
 * ### The explorer is what exists (decision C6)
 *
 * Its rows are U.3's `GET …/code-tree`, grouped by `code-tree.ts`: the `workflows/` group with one
 * `.loop.ts` per workflow on the rail — a paused one with the rail's err-dot — and
 * `ouroboros.config.ts` with its read-only badge. There is no `skills/` or `lib/` row, because no
 * file under either is served; X.2 ([#181](https://github.com/NobuData/ouroboros/issues/181)) adds
 * them by serving one. The head names the **workspace**, not mockup 05's `helios-firmware`: that
 * is a repository, and the files here belong to the workspace, not to any one repository.
 *
 * ### A workflow's file is its route
 *
 * Opening another workflow — from a row or a tab — navigates to its code route, so a deep link is
 * always the file in the pane and the page head always names it. The configuration has no route:
 * it is read with the page and opens in the pane in place, in the read-only editor variant.
 *
 * ### Tabs and buffers outlive the page (per browser session)
 *
 * The tabs, the open one and every file's unsaved text are one session (`code-tabs.ts`), held per
 * workspace by `code-session.ts` above any single page. So an edit to `standard-fix` survives a
 * detour to `hotfix-p0` and back, and a reload. The modified-dot is exactly *this file has a buffer
 * that differs from what it was typed over*: set by the edit, cleared the moment the text is back —
 * by typing, by a read that caught up, or by a successful save.
 *
 * ### The route's file saves as it is typed (V.4, [#172](https://github.com/NobuData/ouroboros/issues/172))
 *
 * Every edit goes to the buffer first, then to the save loop (`use-code-save.ts`), which writes it once
 * typing rests — or at once on **⌘S** / **Ctrl+S**. What each answer does here:
 *
 * - **Saved** — the buffer is measured from the text that was sent (`markSaved`), so the dot clears if
 *   nothing was typed meanwhile and stays if something was. The editor's text is never replaced.
 * - **Did not parse** — the draft is untouched and the text stays; the diagnostics are drawn in the
 *   editor and counted in the strip under it, whose message jumps to its place. While they stand, the
 *   mode guard holds the buffer, so switching to Visual asks first — and dropping it is then true.
 * - **Changed elsewhere** — the conflict dialog: *Reload theirs* drops the buffer and reads the draft;
 *   *Keep mine* reads the draft and keeps the buffer beside it.
 * - **Did not arrive** — DASH-I.7's banner with the real reason, retried on its own.
 *
 * The route's screen keys the workbench by the file's etag, so every fresh read starts a fresh loop. A
 * fresh read over a buffer typed on a draft that has since moved is **diverged** (`isDiverged`): nothing
 * saves it until the person chooses, with the difference open in front of them.
 *
 * ### The right panel (V.5, [#173](https://github.com/NobuData/ouroboros/issues/173))
 *
 * Beside the route's file, while its tab is open: Loop Checks, the Types card for the symbol at the
 * editor's cursor, and the outline (`code-panel-view.tsx`). The outline is the file's span map, kept
 * with the text it was counted in — the read's, then each save's — so a jump is placed in the text on
 * screen the way a diagnostic is. Below 1000px the panel is hidden, and a toggle over the file shows it.
 *
 * ### The status bar, Validate and Publish (V.6, [#174](https://github.com/NobuData/ouroboros/issues/174))
 *
 * Under the route's file, the status bar says where the save loop stands against the visual editor's draft,
 * which version the draft would publish as, and where the cursor is (`code-status.ts`). The head's
 * **Validate** and **Publish** reach this file through the page's flows (`code-flows-session.tsx`): the
 * workbench hands them a bench — write what is waiting, say what the page holds, put the cursor on a stage —
 * and draws what they found. A validation's rows replace Loop Checks, and its findings, or a refused
 * publish's, are drawn in the editor while the page still holds the draft they were found in. A parse error
 * of the page's own save takes precedence, because it is about the text on the screen.
 *
 * ### The keyboard
 *
 * The tree is the WAI-ARIA tree pattern (arrows, Home, End, Enter). The strip is the tabs pattern:
 * one tab stop, Left and Right to move, Enter or Space to open, Delete to close the focused tab.
 * **Alt+W** closes the open tab from anywhere in the workbench — ⌘W and Ctrl+W belong to the
 * browser. A close button is for the pointer, and is hidden from assistive technology, which is
 * told the two shortcuts on the tab itself.
 */

/** What the workbench takes. */
export interface CodeWorkbenchProps {
  /** The workspace's id — whose session this is. */
  readonly scope: string;
  /** The workspace's display name, for the explorer's head. */
  readonly workspaceName: string;
  /** The file list and the configuration, each read or explained. */
  readonly explorer: ExplorerReadings;
  /** The route's workflow, or `null` when the rail does not hold the URL's slug. */
  readonly slug: string | null;
  /** The route's file, when it could be read. */
  readonly file: WorkflowCode | null;
  /** Whether this reader may type into the route's file. */
  readonly editable: boolean;
  /**
   * What the pane shows for the route in place of a file — the unprojectable draft, the refused
   * read, the missing workflow. Unused when `file` is set.
   */
  readonly seat: ReactNode;
  /** The save. Defaults to the `saveCode` Server Action; a suite passes a stand-in. */
  readonly save?: SaveCodeCall;
  /** The right panel's reads, or `null` (the default) for a route with no file to explain. */
  readonly panel?: PanelReadings | null;
}

/** Where the editor's cursor is, with the text it is in. */
interface Cursor {
  readonly text: string;
  readonly pos: number;
}

/** A conflict waiting for an answer, and when it was found. */
interface OpenConflict {
  readonly found: DraftConflict;
  readonly at: Date;
}

/**
 * The workbench.
 *
 * @param props See {@link CodeWorkbenchProps}.
 * @returns The card: explorer, tab strip and pane.
 */
export function CodeWorkbench({
  scope,
  workspaceName,
  explorer,
  slug,
  file,
  editable,
  seat,
  save = saveCode,
  panel = null,
}: CodeWorkbenchProps) {
  const router = useRouter();
  const ids = useId();
  const store = useMemo(() => codeSessionStore(scope), [scope]);
  const routePath = slug === null ? null : workflowFilePath(slug);
  const serverSession = useMemo(() => arrive(EMPTY_SESSION, routePath), [routePath]);
  const session = useCodeSession(store, serverSession);

  // Primitives, so the effects below run when what they are about changes and not on every render.
  const known = explorer.tree.ok ? explorer.tree.value.files.map((entry) => entry.path).join("\n") : null;
  const read = file?.text ?? null;
  const readEtag = file?.etag ?? null;
  const writable = editable && file !== null;

  const [diagnostics, setDiagnostics] = useState<AnchoredDiagnostics | null>(null);
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const [conflict, setConflict] = useState<OpenConflict | null>(null);
  // The draft's etag as this page last knew it: the read's, then each save's. A first edit's buffer is
  // typed under it, and a buffer typed under anything else over other text is diverged.
  const [etag, setEtag] = useState(readEtag);
  // The outline's span map and the text it counts — the read's, then each save's (V.5).
  const [outline, setOutline] = useState<AnchoredOutline | null>(
    file === null ? null : { anchor: file.text, spans: file.spans },
  );
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const symbolIndex = useMemo(() => (panel?.symbols.ok === true ? indexSymbols(panel.symbols.value) : null), [panel]);
  const stages = useMemo(() => (outline === null ? [] : outlineRows(outline)), [outline]);
  const cursorSymbol: CodeSymbol | null =
    symbolIndex === null || cursor === null ? null : (hoverAt(symbolIndex, cursor.text, cursor.pos)?.symbol ?? null);

  // Decided from the session on every render rather than held: it ends by itself when the buffer is
  // dropped or measured from the draft as it is now, and this page's own saves move `etag` with the buffer.
  const diverged =
    writable && routePath !== null && read !== null && etag !== null && isDiverged(session, routePath, read, etag);

  const saving = useCodeSave({
    slug: file?.slug ?? "",
    etag: readEtag ?? "",
    stored: read ?? "",
    enabled: writable,
    save,
    onSaved: (saved, sent) => {
      setEtag(saved.etag);
      setOutline({ anchor: saved.text, spans: saved.spans });
      if (file !== null) store.update((current) => markSaved(current, file.path, sent, saved.etag));
      setDiagnostics(null);
    },
    onInvalid: (items, sent) => setDiagnostics({ anchor: sent, items }),
    onConflict: (found) => {
      setDiagnostics(null);
      setConflict({ found, at: new Date() });
    },
    onReverted: () => setDiagnostics(null),
  });
  const { schedule, flush, cancel } = saving;

  // V.6 (#174): the page's Validate and Publish, and what they draw back here.
  const flows = useCodeFlows();
  const register = flows?.register;
  const hasFile = file !== null;
  // What the bench reads when the flows ask, so they see what the page holds now without registering again.
  const held = useRef({ outline, etag, diverged });
  useLayoutEffect(() => {
    held.current = { outline, etag, diverged };
  });

  useLayoutEffect(() => {
    if (register === undefined || !hasFile) return;

    register({
      // A kept text waiting beside a draft that moved is saved by nothing until the person chooses.
      flush: () => (held.current.diverged ? Promise.resolve<CodeSaveState>("conflict") : flush()),
      snapshot: () => ({ outline: held.current.outline, etag: held.current.etag }),
      reveal: (node) => {
        const current = held.current.outline;
        const request = current === null ? null : stageRevealOf(current, node);
        if (request !== null) setReveal(request);
      },
    });
    return () => register(null);
  }, [register, hasFile, flush]);

  // Findings a validation or a refused publish drew — only over the draft they were found in. Once a save
  // moves the etag they describe another text, and the checks panel says its rows predate the save instead.
  const checked = flows?.checked ?? null;
  const findings = useMemo<AnchoredDiagnostics | null>(
    () => (checked !== null && checked.etag === etag ? { anchor: checked.anchor, items: checked.items } : null),
    [checked, etag],
  );
  const validation = flows?.validation ?? null;
  const readings = useMemo<PanelReadings | null>(
    () =>
      panel !== null && validation !== null && validation.checks.slug === file?.slug
        ? { ...panel, checks: { ok: true, value: validation.checks } }
        : panel,
    [panel, validation, file?.slug],
  );

  // Forget tabs and buffers of files the project no longer has. Not when the list could not be
  // read: an unread list is not an empty project.
  useLayoutEffect(() => {
    if (known === null) return;
    const paths = new Set(known.split("\n"));
    store.update((current) => retainPaths(current, paths));
  }, [store, known]);

  // Arriving on a route opens its file. Layout effects, so the stored session is in place before
  // the first paint after hydration.
  useLayoutEffect(() => {
    store.update((current) => arrive(current, routePath));
  }, [store, routePath]);

  // A read that caught up with a buffer — a save made elsewhere — retires it and its dot.
  useLayoutEffect(() => {
    if (routePath === null || read === null) return;
    store.update((current) => adoptRead(current, routePath, read));
  }, [store, routePath, read]);

  // A read over a buffer that is not diverged — on arrival, or once the person has chosen — is written, so
  // a buffer left by an earlier page is parsed and saved again rather than sitting unsaved behind its dot.
  useEffect(() => {
    if (!writable || diverged || routePath === null || read === null) return;

    const current = store.get();
    if (isModified(current, routePath)) schedule(bufferText(current, routePath, read));
  }, [writable, diverged, store, routePath, read, schedule]);

  // While the file does not parse, a switch to Visual asks first — and confirming drops the buffer.
  useUnsavedBuffer(
    writable && diagnostics !== null
      ? {
          surface: "code",
          discard: () => {
            cancel();
            if (routePath !== null) store.update((current) => discardBuffer(current, routePath));
          },
        }
      : null,
  );

  /**
   * Open a file: in place for the route's own file and the configuration; by navigating to its
   * route for any other workflow, whose tab is added now and opened on arrival.
   *
   * @param path The file.
   */
  function show(path: string): void {
    if (path === CONFIG_FILE_PATH || path === routePath) {
      store.update((current) => openTab(current, path));
      return;
    }

    const target = slugOfPath(path);
    if (target === null) return;

    store.update((current) => addTab(current, path));
    router.push(workflowCodePath(target));
  }

  /**
   * Close a tab, and follow the tab that takes its place when that is another workflow's file.
   *
   * @param path The file.
   */
  function close(path: string): void {
    const wasActive = store.get().active === path;
    store.update((current) => closeTab(current, path));

    const next = store.get().active;
    if (!wasActive || next === null || next === CONFIG_FILE_PATH || next === routePath) return;

    const target = slugOfPath(next);
    if (target !== null) router.push(workflowCodePath(target));
  }

  /**
   * Record an edit to the route's file, and hand it to the save loop — unless the buffer is diverged,
   * which nothing saves until the person has chosen.
   *
   * @param text The editor's whole text.
   */
  function edit(text: string): void {
    if (file === null) return;
    store.update((current) => editBuffer(current, file.path, file.text, text, etag));
    if (!diverged) schedule(text);
  }

  /** ⌘S: write the route's file now, whatever the debounce was waiting for. */
  function saveNow(): void {
    if (!writable || diverged || file === null) return;

    schedule(bufferText(store.get(), file.path, file.text));
    void flush();
  }

  /**
   * Put the cursor on a diagnostic's place in the file.
   *
   * @param item The diagnostic.
   */
  function revealDiagnostic(item: CodeDiagnostic): void {
    if (diagnostics !== null) setReveal({ anchor: diagnostics.anchor, range: item.range });
  }

  /**
   * Put the cursor on an outline row's stage.
   *
   * @param row The row.
   */
  function jumpToStage(row: OutlineRow): void {
    if (outline !== null) setReveal(stageReveal(outline, row));
  }

  /** *Reload theirs*: drop the buffer, and read the draft again when the loop stopped on a conflict. */
  function reloadTheirs(): void {
    if (file === null) return;

    const stopped = saving.status.state === "conflict";
    cancel();
    store.update((current) => discardBuffer(current, file.path));
    setConflict(null);
    setDiagnostics(null);
    // A diverged panel is already over a fresh read; a conflict is over the read the page started from.
    if (stopped) router.refresh();
  }

  /** *Keep mine*: keep the buffer, and read the draft so it can be shown beside it. */
  function keepMine(): void {
    setConflict(null);
    router.refresh();
  }

  /**
   * *Save mine over theirs*: measure the buffer from the draft as it is read now — which ends the
   * divergence — and write it under that read's etag, which is the one the save loop holds.
   */
  function saveMine(): void {
    if (file === null) return;

    store.update((current) => rebaseBuffer(current, file.path, file.text, file.etag));
    schedule(bufferText(store.get(), file.path, file.text));
  }

  /** Alt+W closes the open tab and ⌘S saves, from anywhere inside. */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (isSaveKey(event)) {
      // Always the page's, never the browser's *Save page as…*, while the keyboard is in the workbench.
      event.preventDefault();
      saveNow();
      return;
    }

    if (session.active === null || !isCloseTabKey(event)) return;

    event.preventDefault();
    close(session.active);
  }

  const panelId = `${ids}-panel`;
  const rightPanelId = `${ids}-right-panel`;
  const tabId = (index: number) => `${ids}-tab-${index}`;
  const activeIndex = session.active === null ? -1 : session.tabs.indexOf(session.active);
  // The panel and the status bar are about the route's file, so they stand only while it is in the pane.
  const routeShown = file !== null && session.active === routePath;

  const route =
    file === null ? (
      seat
    ) : (
      <RouteFile
        diagnostics={writable ? diagnostics : null}
        diverged={writable && diverged}
        editable={editable}
        file={file}
        findings={findings}
        onCursor={(pos, text) => setCursor({ pos, text })}
        onEdit={edit}
        onReloadTheirs={reloadTheirs}
        onRetry={() => void flush()}
        onReveal={revealDiagnostic}
        onSaveMine={saveMine}
        reveal={reveal}
        status={saving.status}
        text={editable ? bufferText(session, file.path, file.text) : file.text}
        toggle={
          routeShown && readings !== null ? (
            <CodePanelToggle
              controls={rightPanelId}
              onToggle={() => setPanelOpen((current) => !current)}
              open={panelOpen}
            />
          ) : null
        }
      />
    );

  return (
    <Card aria-label={FILE_LABEL} as="section" className="code-workbench">
      <div className="code-workbench__body" onKeyDown={onKeyDown}>
        <Explorer
          activePath={session.active}
          onOpen={show}
          tree={explorer.tree}
          workspaceName={workspaceName}
        />

        <div className="code-workbench__editor">
          <Tabs onClose={close} onShow={show} panelId={panelId} session={session} tabId={tabId} />

          <div
            aria-labelledby={activeIndex < 0 ? undefined : tabId(activeIndex)}
            className="code-workbench__pane"
            id={panelId}
            role={activeIndex < 0 ? undefined : "tabpanel"}
          >
            <Pane
              active={session.active}
              config={explorer.config}
              route={route}
              routePath={routePath}
              seat={seat}
            />
          </div>
        </div>

        {routeShown && readings !== null && (
          <CodePanel
            etag={etag}
            id={rightPanelId}
            onJump={jumpToStage}
            open={panelOpen}
            outline={stages}
            readings={readings}
            symbol={cursorSymbol}
          />
        )}
      </div>

      {routeShown && (
        <CodeStatusBar
          cursor={cursor === null ? CURSOR_START : cursorPosition(cursor.text, cursor.pos)}
          // A file printed from the version in force is a draft once anything has been written over it.
          draft={draftLabel(
            flows?.currentVersion ?? file.currentVersion,
            saving.status.state === "idle" ? file.version : null,
          )}
          sync={writable ? codeSync(saving.status, diverged) : "synced"}
        />
      )}

      <ConflictDialog
        at={conflict?.at ?? new Date()}
        conflict={conflict?.found ?? null}
        onKeepMine={keepMine}
        onReloadTheirs={reloadTheirs}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ the explorer */

/**
 * Mockup 05's `.ft`: the head, then the tree — or why it could not be read.
 *
 * @param props.workspaceName The workspace's display name.
 * @param props.tree The file list.
 * @param props.activePath The file in the pane, whose row takes the accent inset treatment.
 * @param props.onOpen Open a file.
 * @returns The explorer.
 */
function Explorer({
  workspaceName,
  tree,
  activePath,
  onOpen,
}: Readonly<{
  workspaceName: string;
  tree: Reading<WorkflowCodeTree>;
  activePath: string | null;
  onOpen: (path: string) => void;
}>) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const items = useRef(new Map<string, HTMLLIElement>());

  const entries = useMemo(() => (tree.ok ? buildTree(tree.value.files) : []), [tree]);
  const rows = useMemo(() => visibleRows(entries, collapsed), [entries, collapsed]);

  // One tab stop: the row the keyboard was last on while it is visible, else the open file's, else
  // the first.
  const stop =
    focus !== null && rows.some((row) => row.id === focus)
      ? focus
      : (rows.find((row) => row.id === activePath)?.id ?? rows[0]?.id ?? null);

  /**
   * Keep a row's element, so the keyboard can be moved to it.
   *
   * @param id The row.
   * @returns The ref callback.
   */
  function register(id: string) {
    return (element: HTMLLIElement | null) => {
      if (element === null) items.current.delete(id);
      else items.current.set(id, element);
    };
  }

  /**
   * Open or close a directory.
   *
   * @param id The directory's row.
   */
  function toggle(id: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function onFocus(event: FocusEvent<HTMLUListElement>): void {
    const id = event.target.dataset.treeId;
    if (id !== undefined) setFocus(id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    if (stop === null) return;

    const move = treeMove(event, rows, stop);
    if (move === null) return;

    event.preventDefault();
    switch (move.kind) {
      case "focus":
        setFocus(move.id);
        items.current.get(move.id)?.focus();
        return;
      case "toggle":
        toggle(move.id);
        return;
      case "open":
        onOpen(move.id);
        return;
    }
  }

  return (
    <aside aria-label={EXPLORER_LABEL} className="code-tree">
      <p className="code-tree__head">{explorerHead(workspaceName)}</p>

      {tree.ok ? (
        <ul aria-label={TREE_LABEL} className="code-tree__list" onFocus={onFocus} onKeyDown={onKeyDown} role="tree">
          {entries.map((entry) => {
            if (entry.kind === "file") {
              return (
                <FileItem
                  active={entry.id === activePath}
                  entry={entry}
                  key={entry.id}
                  level={1}
                  onOpen={onOpen}
                  register={register}
                  tabStop={entry.id === stop}
                />
              );
            }

            const expanded = !collapsed.has(entry.id);
            return (
              <li
                aria-expanded={expanded}
                aria-label={entry.name}
                aria-level={1}
                // A directory is never the open file; the tree pattern asks every item to say so.
                aria-selected={false}
                className="code-tree__item"
                data-tree-id={entry.id}
                key={entry.id}
                ref={register(entry.id)}
                role="treeitem"
                tabIndex={entry.id === stop ? 0 : -1}
              >
                <span className="code-tree__row code-tree__row--directory" onClick={() => toggle(entry.id)}>
                  <span aria-hidden className="code-tree__twisty">
                    {expanded ? "▾" : "▸"}
                  </span>
                  {entry.name}
                </span>
                {expanded && (
                  <ul className="code-tree__group" role="group">
                    {entry.files.map((child) => (
                      <FileItem
                        active={child.id === activePath}
                        entry={child}
                        key={child.id}
                        level={2}
                        onOpen={onOpen}
                        register={register}
                        tabStop={child.id === stop}
                      />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState className="code-tree__failed" note={tree.reason} title={TREE_FAILED_TITLE} variant="flush" />
      )}
    </aside>
  );
}

/**
 * One file's row — mockup 05's `.ft-row`.
 *
 * @param props.entry The file.
 * @param props.level Its depth: 1 at the top of the project, 2 inside a directory.
 * @param props.active Whether it is the file in the pane.
 * @param props.tabStop Whether it is the tree's one tab stop.
 * @param props.register Keeps its element for the keyboard.
 * @param props.onOpen Open it.
 * @returns The row.
 */
function FileItem({
  entry,
  level,
  active,
  tabStop,
  register,
  onOpen,
}: Readonly<{
  entry: TreeFile;
  level: 1 | 2;
  active: boolean;
  tabStop: boolean;
  register: (id: string) => (element: HTMLLIElement | null) => void;
  onOpen: (path: string) => void;
}>) {
  const { file } = entry;

  return (
    <li
      aria-level={level}
      aria-selected={active}
      className="code-tree__item"
      data-tree-id={entry.id}
      ref={register(entry.id)}
      role="treeitem"
      tabIndex={tabStop ? 0 : -1}
    >
      <span className={cx("code-tree__row", active && "code-tree__row--active")} onClick={() => onOpen(entry.id)}>
        {level === 1 && <span aria-hidden className="code-tree__twisty" />}
        <span className="code-tree__name">{entry.name}</span>
        {file.status === "paused" && (
          <>
            <span aria-hidden className="code-tree__dot" />
            <span className="sr-only">, {PAUSED_NOTE}</span>
          </>
        )}
        {file.readOnly && <Chip className="code-tree__badge">{READ_ONLY_BADGE}</Chip>}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ the tab strip */

/**
 * Mockup 05's `.tabs`, or nothing when every tab is closed.
 *
 * @param props.session The session.
 * @param props.panelId The pane's id, which the open tab controls.
 * @param props.tabId Each tab's id, by position.
 * @param props.onShow Open a tab's file.
 * @param props.onClose Close a tab.
 * @returns The strip.
 */
function Tabs({
  session,
  panelId,
  tabId,
  onShow,
  onClose,
}: Readonly<{
  session: CodeSession;
  panelId: string;
  tabId: (index: number) => string;
  onShow: (path: string) => void;
  onClose: (path: string) => void;
}>) {
  const [focus, setFocus] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const { tabs } = session;

  if (tabs.length === 0) return null;

  // One tab stop: the tab the keyboard was last on while it is open, else the open one, else the first.
  const stop = focus !== null && tabs.includes(focus) ? focus : (session.active ?? tabs[0]);

  /**
   * Move the keyboard to a tab.
   *
   * @param path The tab.
   */
  function moveTo(path: string): void {
    setFocus(path);
    buttons.current.get(path)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const path = (event.target as HTMLElement).dataset.tabPath;
    if (path === undefined) return;

    if (isCloseFocusedTabKey(event)) {
      event.preventDefault();
      const index = tabs.indexOf(path);
      const neighbour = tabs[index + 1] ?? tabs[index - 1];
      onClose(path);
      if (neighbour !== undefined) moveTo(neighbour);
      return;
    }

    const target = tabKeyTarget(event, tabs, path);
    if (target === null) return;

    event.preventDefault();
    moveTo(target);
  }

  return (
    <div aria-label={TABS_LABEL} className="code-tabs" onKeyDown={onKeyDown} role="tablist">
      {tabs.map((path, index) => {
        const on = path === session.active;
        const modified = isModified(session, path);

        return (
          <div className={cx("code-tab", on && "code-tab--active")} key={path} role="presentation">
            <button
              aria-controls={on ? panelId : undefined}
              aria-keyshortcuts="Delete Alt+W"
              aria-selected={on}
              className="code-tab__select"
              data-tab-path={path}
              id={tabId(index)}
              onClick={() => onShow(path)}
              ref={(element) => {
                if (element === null) buttons.current.delete(path);
                else buttons.current.set(path, element);
              }}
              role="tab"
              tabIndex={path === stop ? 0 : -1}
              title={path}
              type="button"
            >
              {modified && <span aria-hidden className="code-tab__modified" />}
              {baseName(path)}
              {modified && <span className="sr-only">, {MODIFIED_NOTE}</span>}
            </button>
            <button
              aria-hidden
              className="code-tab__close"
              onClick={() => onClose(path)}
              tabIndex={-1}
              title={closeTabLabel(path)}
              type="button"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ the pane */

/**
 * What the pane holds for the open tab.
 *
 * @param props.active The open tab.
 * @param props.routePath The route's file, or `null` when the URL's workflow does not exist.
 * @param props.route What the route's file draws — its editor and save surfaces, or its seat.
 * @param props.seat What stands in for the route's file when there is none.
 * @param props.config The configuration read.
 * @returns The configuration, the route's file or its seat, or the nothing-open panel.
 */
function Pane({
  active,
  routePath,
  route,
  seat,
  config,
}: Readonly<{
  active: string | null;
  routePath: string | null;
  route: ReactNode;
  seat: ReactNode;
  config: Reading<WorkflowCodeConfig>;
}>) {
  if (active === CONFIG_FILE_PATH) return <ConfigPane config={config} />;

  // `null === null` included: a route whose workflow is missing shows its seat while nothing is open.
  if (active === routePath) return route;

  return routePath === null ? seat : <EmptyState fill note={NOTHING_OPEN_NOTE} title={NOTHING_OPEN_TITLE} />;
}

/**
 * The route's file: where it came from and where its save stands, then the failure banner or the
 * diverged panel when there is one, the editor, and the diagnostics strip while the file does not parse.
 *
 * @param props.file The file as the page read it.
 * @param props.editable Whether the reader may type into it.
 * @param props.text What the editor holds — the buffer's text, or the read.
 * @param props.status Where the save stands.
 * @param props.diverged Whether the buffer waits for the person's choice.
 * @param props.diagnostics The last refused save's diagnostics, or `null`.
 * @param props.findings What a validation or a refused publish found in this draft, or `null` — drawn in the
 *   editor when there are no parse diagnostics, which are about the text on the screen.
 * @param props.reveal The last jump asked for, or `null`.
 * @param props.onEdit Record an edit.
 * @param props.onReveal Jump to a diagnostic.
 * @param props.onRetry Try a failed write again now.
 * @param props.onSaveMine Write the buffer over the draft as it is now.
 * @param props.onReloadTheirs Drop the buffer.
 * @param props.onCursor Hear where the editor's cursor is.
 * @param props.toggle The narrow viewport's right-panel toggle, or `null` when there is no panel.
 * @returns The pane's content.
 */
function RouteFile({
  file,
  editable,
  text,
  status,
  diverged,
  diagnostics,
  findings,
  reveal,
  onEdit,
  onReveal,
  onRetry,
  onSaveMine,
  onReloadTheirs,
  onCursor,
  toggle,
}: Readonly<{
  file: WorkflowCode;
  editable: boolean;
  text: string;
  status: CodeSaveStatus;
  diverged: boolean;
  diagnostics: AnchoredDiagnostics | null;
  findings: AnchoredDiagnostics | null;
  reveal: RevealRequest | null;
  onEdit: (text: string) => void;
  onReveal: (item: CodeDiagnostic) => void;
  onRetry: () => void;
  onSaveMine: () => void;
  onReloadTheirs: () => void;
  onCursor: (pos: number, text: string) => void;
  toggle: ReactNode;
}>) {
  return (
    <>
      {toggle}
      <p className="code-workbench__meta">
        {fileSource(file)} · {editable ? codeSaveNote(status, diverged) : FILE_READ_ONLY_NOTE}
      </p>

      {editable && status.reason !== null && (
        <SaveFailedBanner onRetry={onRetry} reason={status.reason} retrying={status.state === "saving"} />
      )}
      {diverged && (
        <DivergedPanel mine={text} onReloadTheirs={onReloadTheirs} onSaveMine={onSaveMine} theirs={file.text} />
      )}

      <CodeEditor
        diagnostics={diagnostics ?? findings}
        key={file.path}
        label={file.path}
        onChange={editable ? onEdit : undefined}
        onCursor={onCursor}
        readOnly={!editable}
        reveal={reveal}
        text={text}
      />

      {diagnostics !== null && <DiagnosticsStrip items={diagnostics.items} onReveal={onReveal} />}
    </>
  );
}

/**
 * `ouroboros.config.ts` in the read-only editor, or why it could not be read.
 *
 * @param props.config The read.
 * @returns The pane's content.
 */
function ConfigPane({ config }: Readonly<{ config: Reading<WorkflowCodeConfig> }>) {
  if (!config.ok) return <EmptyState fill note={config.reason} title={CONFIG_FAILED_TITLE} />;

  return (
    <>
      <p className="code-workbench__meta">{CONFIG_SOURCE}</p>
      <CodeEditor key={config.value.path} label={config.value.path} readOnly text={config.value.text} />
    </>
  );
}
