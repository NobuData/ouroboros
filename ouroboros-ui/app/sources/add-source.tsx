"use client";

import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  useTransition,
} from "react";

import type { TicketSourceCatalogEntry } from "@/app/api/sources";
import { COMING_SOON_LABEL } from "@/app/catalog-tiles";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, SchemaFields, Tag, TextField } from "@/app/ui";

import { type CatalogReading, addSource, readSourceCatalog } from "./actions";
import {
  ADD,
  ADDED_TITLE,
  ADDING,
  ADD_DIALOG_NOTE,
  ADD_DIALOG_TITLE,
  ADD_READ_ONLY,
  type AddFailure,
  BACK_TO_CATALOG,
  CANCEL,
  CATALOG_EMPTY,
  CATALOG_LIST_LABEL,
  CATALOG_LOADING,
  type CatalogTile,
  DONE,
  NAME_FIELD,
  NAME_HINT,
  NAME_LABEL,
  NAME_MAX_LENGTH,
  V2_LABEL,
  addFailure,
  addedNote,
  arrivesNote,
  catalogTiles,
  configOf,
} from "./catalog";
import { ADD_SOURCE_LABEL, labelOf } from "./view";

import "./sources.css";

/**
 * The add-source flow — the head's opener, the kind picker, the form behind each tile, and a
 * done step ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * The same shape as `app/providers/add-provider.tsx`, because it makes the same claim about a
 * different registry: the picker draws one tile per kind the service can connect, the form
 * behind a tile is the provider's own, and there is no per-kind markup in this file. The
 * test that proves it feeds the dialog a kind it has never seen.
 *
 * ### Three steps, one dialog
 *
 * **The catalog** — tiles drawn from what `readSourceCatalog` answered, by `catalog.ts`'s
 * `catalogTiles`: one per live kind in the service's order, then the *coming soon* ones, which
 * are plain list items rather than buttons and carry the version they arrive in. The read
 * starts in the press that opens the dialog, so its first paint is *Reading the catalog…*.
 *
 * **The form** — the entry's `title` as the heading, a **Name** for the row's heading (the one
 * field the provider's schema does not declare, because it is a fact about the source rather
 * than a tracker setting), and then `SchemaFields` over the entry's `fields` — the `list`
 * widget included, which is the one a repository list needs.
 *
 * **Done** — the source's name and what happens next: test it, then sync it. A step rather
 * than a closed dialog because the reader has just handed over a token and deserves a
 * sentence saying it took; **Done** closes and refreshes the route, so the new row is on the
 * page behind the dialog.
 *
 * ### A refusal keeps the form open, with the service's sentence under the field
 *
 * The inputs are uncontrolled, so a submission the service refused leaves every value where
 * the reader left it. `addFailure` turns the envelope into one line under the form and the
 * fields it is about, and nothing was stored, which the line says.
 */

/** What the opener needs from the flow. */
interface Flow {
  /** Open the dialog on its catalog step. */
  readonly open: () => void;
  /** Whether this reader may add a source at all. */
  readonly mayAdminister: boolean;
}

const AddSourceContext = createContext<Flow | null>(null);

/**
 * The flow an opener sits in.
 *
 * @returns The flow.
 * @throws {Error} When rendered outside {@link AddSourceFlow}.
 */
function useFlow(): Flow {
  const flow = useContext(AddSourceContext);

  if (flow === null) {
    throw new Error("An add-source opener must be rendered inside <AddSourceFlow>.");
  }

  return flow;
}

/** What the flow takes. */
export interface AddSourceFlowProps {
  /**
   * Whether this reader may add a source — `app/api/membership.ts`'s `mayAdminister`, decided
   * once by the route. When false, the opener is inert with the reason and the dialog can
   * never open; the gate that *enforces* is the service's (`actions.ts`).
   */
  readonly mayAdminister: boolean;
  /** The page, with an opener somewhere in it. */
  readonly children: ReactNode;
}

/**
 * The dialog, and the context its opener reaches it through.
 *
 * @param props See {@link AddSourceFlowProps}.
 * @returns The children, and the dialog while it is open.
 */
export function AddSourceFlow({ mayAdminister, children }: AddSourceFlowProps) {
  const router = useRouter();
  const [isOpen, setOpen] = useState(false);
  const [reading, setReading] = useState<CatalogReading | null>(null);
  const [entry, setEntry] = useState<TicketSourceCatalogEntry | null>(null);
  const [failure, setFailure] = useState<AddFailure | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Open on the catalog step, and start the read it needs. Every piece of state resets. */
  const open = useCallback(() => {
    setOpen(true);
    setReading(null);
    setEntry(null);
    setFailure(null);
    setAdded(null);

    startTransition(async () => {
      setReading(await readSourceCatalog());
    });
  }, []);

  const flow = useMemo<Flow>(() => ({ open, mayAdminister }), [open, mayAdminister]);

  /** Close. After a successful add the route is refreshed too, whichever way it was closed. */
  function close(): void {
    setOpen(false);
    if (added !== null) router.refresh();
  }

  /** Step from the catalog into a kind's form. */
  function choose(chosen: TicketSourceCatalogEntry): void {
    setEntry(chosen);
    setFailure(null);
  }

  /** Step back to the catalog. What was typed is discarded with the form. */
  function back(): void {
    setEntry(null);
    setFailure(null);
  }

  /**
   * Send what the form holds.
   *
   * @param event The submit.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (pending || entry === null) return;

    const data = new FormData(event.currentTarget);
    const valueOf = (name: string): string => {
      const value = data.get(name);

      return typeof value === "string" ? value : "";
    };
    const displayName = valueOf(NAME_FIELD).trim();
    const config = configOf(entry.fields, valueOf);

    setFailure(null);

    startTransition(async () => {
      const outcome = await addSource({ kind: entry.kind, displayName, config });

      if (!outcome.ok) {
        setFailure(addFailure(outcome.refusal));
        return;
      }

      setAdded(outcome.source.displayName);
    });
  }

  return (
    <AddSourceContext.Provider value={flow}>
      {children}

      <ShellOverlay label={ADD_DIALOG_TITLE} onClose={close} open={isOpen}>
        {added !== null ? (
          <DoneStep displayName={added} onDone={close} />
        ) : entry !== null ? (
          <FormStep
            entry={entry}
            failure={failure}
            onBack={back}
            onCancel={close}
            onSubmit={submit}
            pending={pending}
          />
        ) : (
          <CatalogStep onChoose={choose} pending={pending} reading={reading} />
        )}
      </ShellOverlay>
    </AddSourceContext.Provider>
  );
}

/**
 * The head's primary action.
 *
 * @returns The **+ Add source** button — inert, with the reason, for a reader who may not.
 */
export function AddSourceButton() {
  const { open, mayAdminister } = useFlow();

  return (
    <Button
      onClick={open}
      reason={mayAdminister ? undefined : ADD_READ_ONLY}
      tone="primary"
      type="button"
    >
      {ADD_SOURCE_LABEL}
    </Button>
  );
}

/**
 * The catalog step: the tiles, or what stands in for them.
 *
 * @param props.reading What the open read, or `null` while it is on its way.
 * @param props.pending Whether the read is still in flight.
 * @param props.onChoose Called with the entry behind a pressed tile.
 * @returns The heading, the note, and the tiles or a status line.
 */
function CatalogStep({
  reading,
  pending,
  onChoose,
}: Readonly<{
  reading: CatalogReading | null;
  pending: boolean;
  onChoose: (entry: TicketSourceCatalogEntry) => void;
}>) {
  return (
    <>
      <h2 className="shell-overlay__title">{ADD_DIALOG_TITLE}</h2>
      <p className="shell-overlay__note">{ADD_DIALOG_NOTE}</p>

      {pending || reading === null ? (
        <p className="sources-add__state" role="status">
          {CATALOG_LOADING}
        </p>
      ) : !reading.ok ? (
        <p className="sources-add__state" role="status">
          {reading.reason}
        </p>
      ) : (
        <TileList entries={reading.entries} onChoose={onChoose} />
      )}
    </>
  );
}

/**
 * The tiles, or the sentence for a build with nothing to offer *and* nothing promised.
 *
 * @param props.entries What the catalog answered.
 * @param props.onChoose Called with the entry behind a pressed tile.
 * @returns The list.
 */
function TileList({
  entries,
  onChoose,
}: Readonly<{
  entries: readonly TicketSourceCatalogEntry[];
  onChoose: (entry: TicketSourceCatalogEntry) => void;
}>) {
  const tiles = catalogTiles(entries);

  if (tiles.length === 0) {
    return (
      <p className="sources-add__state" role="status">
        {CATALOG_EMPTY}
      </p>
    );
  }

  return (
    <ul aria-label={CATALOG_LIST_LABEL} className="sources-catalog">
      {tiles.map((tile) => (
        <CatalogTileItem key={tile.kind} onChoose={onChoose} tile={tile} />
      ))}
    </ul>
  );
}

/**
 * One tile: a button for a live kind, a plain item for a promised one.
 *
 * The promised tile is deliberately not a disabled button. A disabled button is a control
 * that says *not now*; this is not a control at all, and the honest rendering of *not yet* is
 * a labelled item that nothing focuses and nothing presses — with the version it arrives in
 * and where it comes from, so *soon* answers *when?*. The issue is explicit that these tiles
 * *"must not imply working integrations"*, and a thing that cannot be pressed implies none.
 *
 * @param props.tile The tile.
 * @param props.onChoose Called with the entry behind a live tile.
 * @returns The list item.
 */
function CatalogTileItem({
  tile,
  onChoose,
}: Readonly<{ tile: CatalogTile; onChoose: (entry: TicketSourceCatalogEntry) => void }>) {
  if (!tile.live) {
    return (
      <li className="sources-catalog__tile sources-catalog__tile--soon">
        <span aria-hidden="true" className="sources-catalog__monogram">
          {tile.monogram}
        </span>
        <span className="sources-catalog__body">
          <span className="sources-catalog__label">
            {tile.label} <Tag>{COMING_SOON_LABEL}</Tag> <Tag>{V2_LABEL}</Tag>
          </span>
          <span className="sources-catalog__needs">{arrivesNote(tile.source)}</span>
        </span>
      </li>
    );
  }

  return (
    <li>
      <button className="sources-catalog__tile" onClick={() => onChoose(tile.entry)} type="button">
        <span aria-hidden="true" className="sources-catalog__monogram">
          {tile.monogram}
        </span>
        <span className="sources-catalog__body">
          <span className="sources-catalog__label">{tile.label}</span>
          <span className="sources-catalog__needs">{tile.needs}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * The form step: the entry's heading, the name, the provider's fields, and the controls.
 *
 * @param props.entry The chosen kind — its title and its fields.
 * @param props.failure What the last submission was refused with, if it was.
 * @param props.pending Whether a submission is in flight.
 * @param props.onSubmit The form's submit.
 * @param props.onBack Back to the catalog.
 * @param props.onCancel Close without writing.
 * @returns The form.
 */
function FormStep({
  entry,
  failure,
  pending,
  onSubmit,
  onBack,
  onCancel,
}: Readonly<{
  entry: TicketSourceCatalogEntry;
  failure: AddFailure | null;
  pending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
  onCancel: () => void;
}>) {
  const id = useId();
  const nameErrors = failure?.fields[NAME_FIELD];

  return (
    <>
      <h2 className="shell-overlay__title">{entry.title}</h2>

      <form className="sources-add" onSubmit={onSubmit}>
        <TextField
          autoComplete="off"
          defaultValue={labelOf(entry.kind)}
          error={nameErrors === undefined ? undefined : nameErrors.join(" ")}
          hint={NAME_HINT}
          id={`${id}-${NAME_FIELD}`}
          label={NAME_LABEL}
          maxLength={NAME_MAX_LENGTH}
          name={NAME_FIELD}
          required
        />

        <SchemaFields errors={failure?.fields} fields={entry.fields} idPrefix={id} />

        {failure !== null && (
          <p className="sources-add__failure" role="alert">
            {failure.message}
          </p>
        )}

        {pending && (
          <p className="sources-add__state" role="status">
            {ADDING}
          </p>
        )}

        <div className="sources-add__actions">
          <Button reason={pending ? ADDING : undefined} tone="primary" type="submit">
            {ADD}
          </Button>
          <Button onClick={onBack} tone="ghost" type="button">
            {BACK_TO_CATALOG}
          </Button>
          <Button onClick={onCancel} tone="ghost" type="button">
            {CANCEL}
          </Button>
        </div>
      </form>
    </>
  );
}

/**
 * The done step.
 *
 * @param props.displayName The heading the source was stored under.
 * @param props.onDone Close, and refresh the route.
 * @returns The heading, the note, and the one control.
 */
function DoneStep({ displayName, onDone }: Readonly<{ displayName: string; onDone: () => void }>) {
  return (
    <>
      <h2 className="shell-overlay__title">{ADDED_TITLE}</h2>
      <p className="shell-overlay__note" role="status">
        {addedNote(displayName)}
      </p>
      <div className="sources-add__actions">
        <Button onClick={onDone} tone="primary" type="button">
          {DONE}
        </Button>
      </div>
    </>
  );
}
