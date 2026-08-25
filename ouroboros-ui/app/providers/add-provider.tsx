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

import type { ProviderCatalogEntry } from "@/app/api/providers";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, SchemaFields, Tag, TextField } from "@/app/ui";

import { type CatalogReading, addProvider, readCatalog } from "./add-actions";
import {
  ADDED_TITLE,
  ADD_DIALOG_NOTE,
  ADD_DIALOG_TITLE,
  ADD_PROVIDER_READ_ONLY,
  type AddFailure,
  BACK_TO_CATALOG,
  BASE_URL_FIELD,
  BROWSE_CATALOG_LABEL,
  CANCEL,
  CATALOG_EMPTY,
  CATALOG_LIST_LABEL,
  CATALOG_LOADING,
  COMING_SOON_LABEL,
  CONNECT,
  CONNECTING,
  CONNECT_ANYWAY,
  type CatalogTile,
  DONE,
  type ExistingConnection,
  NAME_FIELD,
  NAME_HINT,
  NAME_LABEL,
  NAME_MAX_LENGTH,
  addFailure,
  addedNote,
  catalogTiles,
  configOf,
  duplicateKey,
  duplicateOf,
  duplicateWarning,
  labelOf,
} from "./catalog";
import { ADD_PROVIDER_LABEL } from "./view";

import "./providers.css";

/**
 * Mockup 07's add-provider flow — the two openers, the catalog dialog, and the form behind
 * each tile ([#231](https://github.com/NobuData/ouroboros/issues/231)).
 *
 * The head's **+ Add provider** and the dashed card's **Browse catalog** open *the same
 * dialog*, and they sit in different parts of a Server Component's tree — so the dialog and
 * its state live in one place, {@link AddProviderFlow}, and the openers reach it through a
 * context. The page wraps its frame in the flow once and places an opener wherever the
 * mockup draws one; `ShellOverlay` hands focus back to whichever button opened it, because it
 * reads the opener at open time rather than being told.
 *
 * ### Three steps, one dialog
 *
 * **The catalog** — tiles drawn from what `readCatalog` answered, by `catalog.ts`'s
 * `catalogTiles`: one per live kind in the service's order, then the `coming soon` ones, which
 * are plain list items and not buttons. The read starts in the press that opens the dialog,
 * so its first paint is already *Reading the catalog…* — the pattern the audit sheet and the
 * rule builder set.
 *
 * **The form** — the entry's `title` as the heading, a **Name** for the card's heading (the
 * one field the adapter's schema does not declare, because it is a fact about the connection
 * rather than a provider setting), and then `SchemaFields` over the entry's `fields`. There is
 * no per-kind markup in this file, and the test that proves it feeds the dialog a kind it has
 * never seen.
 *
 * **Done** — the connection's name and what happens next. It is a step rather than a closed
 * dialog because somebody has just handed over a key and deserves a sentence saying it took;
 * **Done** closes and refreshes the route, so the grid (AE.2,
 * [#228](https://github.com/NobuData/ouroboros/issues/228)) re-reads and the new card is on
 * the page behind the dialog.
 *
 * ### A refusal keeps the form open, with the adapter's sentence under the field
 *
 * The inputs are uncontrolled, so a submission the service refused leaves every value where
 * the reader left it. `addFailure` turns the envelope into one line under the form and the
 * fields it is about — *key rejected (401)* under the key row — and nothing was stored, which
 * the line says.
 *
 * ### The duplicate warning is a second press, not a gate
 *
 * A submission of the same kind at the same endpoint as an existing connection is stopped
 * once, with the warning and the control relabelled **Connect anyway**; the same form
 * submitted again proceeds. It is keyed to what was warned about, so a reader who changes
 * the address after the warning is judged afresh rather than waved through.
 */

/** What the openers need from the flow. */
interface Flow {
  /** Open the dialog on its catalog step. */
  readonly open: () => void;
  /** Whether this reader may connect a provider at all. */
  readonly mayAdminister: boolean;
}

const AddProviderContext = createContext<Flow | null>(null);

/**
 * The flow an opener sits in.
 *
 * @returns The flow.
 * @throws {Error} When rendered outside {@link AddProviderFlow} — a misuse worth failing
 *   loudly, because the alternative is a button that does nothing and says nothing.
 */
function useFlow(): Flow {
  const flow = useContext(AddProviderContext);

  if (flow === null) {
    throw new Error("An add-provider opener must be rendered inside <AddProviderFlow>.");
  }

  return flow;
}

/** What the flow takes. */
export interface AddProviderFlowProps {
  /**
   * Whether this reader may connect a provider — `app/api/membership.ts`'s `mayAdminister`,
   * decided once by the route. When false, every opener is inert with the reason and the
   * dialog can never open; the gate that *enforces* is the service's (`add-actions.ts`).
   */
  readonly mayAdminister: boolean;
  /** The page, with openers somewhere in it. */
  readonly children: ReactNode;
}

/** What the dialog remembers once a duplicate has been pointed out. */
interface Warning {
  readonly key: string;
  readonly connection: ExistingConnection;
}

/**
 * The dialog, and the context its openers reach it through.
 *
 * @param props See {@link AddProviderFlowProps}.
 * @returns The children, and the dialog while it is open.
 */
export function AddProviderFlow({ mayAdminister, children }: AddProviderFlowProps) {
  const router = useRouter();
  const [isOpen, setOpen] = useState(false);
  const [reading, setReading] = useState<CatalogReading | null>(null);
  const [entry, setEntry] = useState<ProviderCatalogEntry | null>(null);
  const [failure, setFailure] = useState<AddFailure | null>(null);
  const [warning, setWarning] = useState<Warning | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Open on the catalog step, and start the read it needs.
   *
   * Every piece of state is reset here rather than on close, so a dialog dismissed
   * mid-form and reopened starts from the catalog — and so the read is fresh each time,
   * because what the workspace has connected may have changed in between.
   */
  const open = useCallback(() => {
    setOpen(true);
    setReading(null);
    setEntry(null);
    setFailure(null);
    setWarning(null);
    setAdded(null);

    startTransition(async () => {
      setReading(await readCatalog());
    });
  }, []);

  const flow = useMemo<Flow>(() => ({ open, mayAdminister }), [open, mayAdminister]);

  /** Close. After a successful add the route is refreshed too, whichever way it was closed. */
  function close(): void {
    setOpen(false);
    if (added !== null) router.refresh();
  }

  /** Step from the catalog into a kind's form. */
  function choose(chosen: ProviderCatalogEntry): void {
    setEntry(chosen);
    setFailure(null);
    setWarning(null);
  }

  /** Step back to the catalog. What was typed is discarded with the form. */
  function back(): void {
    setEntry(null);
    setFailure(null);
    setWarning(null);
  }

  /**
   * Send what the form holds.
   *
   * Read from the form rather than from state, because the inputs are uncontrolled — see
   * `app/ui/schema-form.tsx`. The duplicate check runs before the provider is asked, and
   * stops the submission once.
   *
   * @param event The submit.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (pending || entry === null || reading === null || !reading.ok) return;

    const data = new FormData(event.currentTarget);
    const valueOf = (name: string): string => {
      const value = data.get(name);

      return typeof value === "string" ? value : "";
    };
    const displayName = valueOf(NAME_FIELD).trim();
    const config = configOf(entry.fields, valueOf);
    const baseUrl = config[BASE_URL_FIELD] ?? null;
    const key = duplicateKey(entry.kind, baseUrl);
    const duplicate = duplicateOf(reading.existing, entry.kind, baseUrl);

    if (duplicate !== null && warning?.key !== key) {
      setWarning({ key, connection: duplicate });
      return;
    }

    setFailure(null);

    startTransition(async () => {
      const outcome = await addProvider({ kind: entry.kind, displayName, config });

      if (!outcome.ok) {
        setFailure(addFailure(outcome.refusal, entry.fields));
        return;
      }

      setAdded(outcome.connection.displayName);
    });
  }

  return (
    <AddProviderContext.Provider value={flow}>
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
            warning={warning}
          />
        ) : (
          <CatalogStep onChoose={choose} pending={pending} reading={reading} />
        )}
      </ShellOverlay>
    </AddProviderContext.Provider>
  );
}

/**
 * The head's primary action.
 *
 * @returns The **+ Add provider** button — inert, with the reason, for a reader who may not.
 */
export function AddProviderButton() {
  const { open, mayAdminister } = useFlow();

  return (
    <Button
      onClick={open}
      reason={mayAdminister ? undefined : ADD_PROVIDER_READ_ONLY}
      tone="primary"
      type="button"
    >
      {ADD_PROVIDER_LABEL}
    </Button>
  );
}

/**
 * The dashed card's action.
 *
 * @returns The **Browse catalog** button — the mockup's ghost treatment, and the same dialog.
 */
export function BrowseCatalogButton() {
  const { open, mayAdminister } = useFlow();

  return (
    <Button
      onClick={open}
      reason={mayAdminister ? undefined : ADD_PROVIDER_READ_ONLY}
      tone="ghost"
      type="button"
    >
      {BROWSE_CATALOG_LABEL}
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
  onChoose: (entry: ProviderCatalogEntry) => void;
}>) {
  return (
    <>
      <h2 className="shell-overlay__title">{ADD_DIALOG_TITLE}</h2>
      <p className="shell-overlay__note">{ADD_DIALOG_NOTE}</p>

      {pending || reading === null ? (
        <p className="providers-add__state" role="status">
          {CATALOG_LOADING}
        </p>
      ) : !reading.ok ? (
        <p className="providers-add__state" role="status">
          {reading.reason}
        </p>
      ) : reading.entries.length === 0 ? (
        <p className="providers-add__state" role="status">
          {CATALOG_EMPTY}
        </p>
      ) : (
        <ul aria-label={CATALOG_LIST_LABEL} className="providers-catalog">
          {catalogTiles(reading.entries).map((tile) => (
            <CatalogTileItem key={tile.kind} onChoose={onChoose} tile={tile} />
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * One tile: a button for a live kind, a plain item for a promised one.
 *
 * The promised tile is deliberately not a disabled button. A disabled button is a control
 * that says *not now*; this is not a control at all, and the honest rendering of *not yet* is
 * a labelled item that nothing focuses and nothing presses — with where it comes from, so
 * *soon* answers *when?*.
 *
 * @param props.tile The tile.
 * @param props.onChoose Called with the entry behind a live tile.
 * @returns The list item.
 */
function CatalogTileItem({
  tile,
  onChoose,
}: Readonly<{ tile: CatalogTile; onChoose: (entry: ProviderCatalogEntry) => void }>) {
  if (!tile.live) {
    return (
      <li className="providers-catalog__tile providers-catalog__tile--soon">
        <span aria-hidden="true" className="providers-catalog__monogram">
          {tile.monogram}
        </span>
        <span className="providers-catalog__body">
          <span className="providers-catalog__label">
            {tile.label} <Tag>{COMING_SOON_LABEL}</Tag>
          </span>
          <span className="providers-catalog__needs">Arrives with {tile.source}</span>
        </span>
      </li>
    );
  }

  return (
    <li>
      <button
        className="providers-catalog__tile"
        onClick={() => onChoose(tile.entry)}
        type="button"
      >
        <span aria-hidden="true" className="providers-catalog__monogram">
          {tile.monogram}
        </span>
        <span className="providers-catalog__body">
          <span className="providers-catalog__label">{tile.label}</span>
          <span className="providers-catalog__needs">{tile.needs}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * The form step: the entry's heading, the name, the adapter's fields, and the controls.
 *
 * @param props.entry The chosen kind — its title and its fields.
 * @param props.failure What the last submission was refused with, if it was.
 * @param props.warning The duplicate that was pointed out, if one was.
 * @param props.pending Whether a submission is in flight.
 * @param props.onSubmit The form's submit.
 * @param props.onBack Back to the catalog.
 * @param props.onCancel Close without writing.
 * @returns The form.
 */
function FormStep({
  entry,
  failure,
  warning,
  pending,
  onSubmit,
  onBack,
  onCancel,
}: Readonly<{
  entry: ProviderCatalogEntry;
  failure: AddFailure | null;
  warning: Warning | null;
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

      <form className="providers-add" onSubmit={onSubmit}>
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

        {warning !== null && (
          <p className="providers-add__warning" role="alert">
            {duplicateWarning(warning.connection)}
          </p>
        )}

        {failure !== null && (
          <p className="providers-add__failure" role="alert">
            {failure.message}
          </p>
        )}

        {pending && (
          <p className="providers-add__state" role="status">
            {CONNECTING}
          </p>
        )}

        <div className="providers-add__actions">
          <Button reason={pending ? CONNECTING : undefined} tone="primary" type="submit">
            {warning === null ? CONNECT : CONNECT_ANYWAY}
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
 * @param props.displayName The heading the connection was stored under.
 * @param props.onDone Close, and refresh the route.
 * @returns The heading, the note, and the one control.
 */
function DoneStep({
  displayName,
  onDone,
}: Readonly<{ displayName: string; onDone: () => void }>) {
  return (
    <>
      <h2 className="shell-overlay__title">{ADDED_TITLE}</h2>
      <p className="shell-overlay__note" role="status">
        {addedNote(displayName)}
      </p>
      <div className="providers-add__actions">
        <Button onClick={onDone} tone="primary" type="button">
          {DONE}
        </Button>
      </div>
    </>
  );
}
