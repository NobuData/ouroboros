"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

import type { ModelOption, ModelParamFormField } from "@/app/api/registry";
import { REGISTRY_PATH, aliasPath } from "@/app/paths";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, SelectField, Tag, TextField } from "@/app/ui";

import {
  type ModelsReading,
  type ParamSchemaReading,
  readModelOptions,
  readParamSchema,
} from "./create-actions";
import {
  MAX_MODEL_ID_LENGTH,
  MAX_NAME_LENGTH,
  MODELS_LOADING,
  MODEL_HINT,
  MODEL_ID_HINT,
  MODEL_ID_LABEL,
  MODEL_LABEL,
  MODEL_NOT_DISCOVERED,
  MODEL_PLACEHOLDER,
  NAME_HINT,
  NAME_LABEL,
  PARAMS_LOADING,
  PARAMS_TITLE,
  PROVIDER_LABEL,
  nameError,
  nameProblem,
} from "./create";
import {
  DUPLICATE_HINT,
  DUPLICATE_LABEL,
  INSPECTOR_READ_ONLY,
  type InspectorDraft,
  type InspectorWrite,
  NO_PROVIDER_OPTION,
  PROVIDER_HINT_HREF,
  PROVIDER_HINT_LEAD,
  PROVIDER_HINT_LINK,
  REMOVE_CONFIRM,
  REMOVE_LABEL,
  REMOVE_NOTE,
  RESTRICTIONS_NOTE,
  RESTRICTIONS_TITLE,
  SAVE_LABEL,
  type SaveFailure,
  UNBOUND_BANNER,
  UNBOUND_BANNER_HREF,
  USED_BY_EMPTY,
  USED_BY_LABEL,
  USED_BY_LIST_LABEL,
  WRITE_LABELS,
  duplicateFailure,
  otherNames,
  providerOption,
  referenceHref,
  removeFailure,
  removeTitle,
  removeWhy,
  renameGuardNote,
  saveFailure,
  saveReason,
  unlistedNote,
  updateBody,
} from "./inspector";
import { duplicateAlias, removeAlias, saveAlias } from "./inspector-actions";
import { ParamFields } from "./param-fields";
import {
  type ParamValue,
  type ParamValues,
  paramFieldErrors,
  paramValues,
  paramsDocument,
  paramsNote,
} from "./params";
import { CANCEL_LABEL, FIX_IN_PROVIDERS, type TableRow } from "./table";
import type { ImportSource } from "./view";

import "./registry.css";

/**
 * Mockup 21's **EDIT — CODER-MAX** card — the alias inspector
 * ([#593](https://github.com/NobuData/ouroboros/issues/593)), and the surface on which
 * bring-your-own-key stops being an argument and becomes something a person does.
 *
 * Four hard behaviours meet in one small card, and each of them is a decision made somewhere
 * this file can be read against: what to send (`app/registry/inspector.ts`'s `updateBody`),
 * which controls exist (CH.2's schema, drawn by `app/registry/param-fields.tsx`), what a
 * refusal reads as (`saveFailure`), and what the foot may do (`saveReason`, `removeWhy`).
 *
 * ### Rebinding is one select and one press
 *
 * *Point coder-max at Bedrock tomorrow; zero workflow or route edits.* So the provider select
 * is an ordinary select with no warning around it, changing it **keeps the model id** — the
 * same model usually exists on the new connection, and one that has not been discovered there
 * is offered anyway with a line saying so — and the save carries the difference and nothing
 * else. The table row and the routing matrix agree immediately afterwards because the write is
 * followed by `router.refresh()`, which re-reads the page's server components: the row is the
 * registry's own payload, not a copy this card keeps in step.
 *
 * ### The fields are the model's, and this file names none of them
 *
 * Choosing a model reads CH.2's schema for `(connection, model)` and the controls are drawn
 * from it. Switching to a model with no thinking select loses the thinking and budget controls
 * because the answer has fewer fields, not because anything here knows what thinking is — and
 * the save then sends a `params` document with the same fields the reader could see, which is
 * why `updateBody` sweeps the parameters along with a rebind.
 *
 * ### Two reads, cached by what they answer
 *
 * The model list is keyed by connection and the schema by `(connection, model)`, so moving
 * between rows and back asks nothing again, and a rebind to a connection already looked at is
 * instant. A read still in flight for a question nobody is asking any more is discarded by its
 * effect's own cleanup — a Server Action's round trip cannot be cancelled, so what is available
 * is to ignore the answer.
 *
 * ### An unsaved edit survives the selection moving
 *
 * The drafts are held **by alias id**, so selecting another row and coming back finds the card
 * as it was left. Nothing is discarded silently and nothing has to be confirmed on the way out;
 * a successful save, duplicate or remove is what clears the alias's draft, because after those
 * the row itself is the truth.
 */

/** What the inspector takes. */
export interface AliasInspectorProps {
  /** The selected row — the alias's whole state, as CH.5 served it. */
  readonly row: TableRow;
  /** The workspace's connections, for the provider select. */
  readonly sources: readonly ImportSource[];
  /** Every alias name this workspace has, for the live uniqueness check. */
  readonly aliasNames: readonly string[];
  /**
   * Whether this reader's role may write. `false` draws the whole card readable with every
   * input and button inert and its reason attached; the gate that *enforces* is the service's
   * (`inspector-actions.ts`).
   */
  readonly mayAdminister: boolean;
}

/**
 * What the card holds for one alias while it is being edited.
 *
 * Control values rather than a document: a box halfway through `4000` is not the number `4000`,
 * and the typing happens once on the way out (`app/registry/params.ts`).
 */
interface AliasEdit {
  /** What the name box holds. */
  readonly alias: string;
  /** What the provider select holds, or `null` for *no provider*. */
  readonly connectionId: string | null;
  /** What the model control holds. */
  readonly modelId: string;
  /**
   * The model the parameter schema is being asked about.
   *
   * Separate from {@link AliasEdit.modelId} because a **typed** model settles on blur: a read
   * fired per keystroke would ask about `c`, `cl`, `cla`… and answer about none of them. A model
   * chosen from the select settles immediately, since one press is one decision.
   */
  readonly probe: string;
  /** What each parameter control holds. */
  readonly params: ParamValues;
  /** …and each restriction control. */
  readonly restrictions: ParamValues;
  /**
   * The schema the two above were filled from — `<connection>|<model>|<answered?>`.
   *
   * What makes the prefill a *render-time* decision rather than an effect: when the current key
   * differs from this one the controls are re-seeded from the row, and when it matches they are
   * the reader's. So a schema arriving replaces an empty form with a filled one in the same
   * commit, and a reader who has typed into it keeps what they typed.
   */
  readonly seeded: string;
}

/**
 * The alias inspector.
 *
 * @param props See {@link AliasInspectorProps}.
 * @returns The card's contents — its frame is `app/registry/registry-table.tsx`'s
 *   `InspectorSeat`, which is also what draws the *no alias selected* state.
 */
export function AliasInspector({ row, sources, aliasNames, mayAdminister }: AliasInspectorProps) {
  const router = useRouter();
  const fields = useId();
  const whyId = `${fields}-why`;

  const [edits, setEdits] = useState<Readonly<Record<string, AliasEdit>>>({});
  const [models, setModels] = useState<Readonly<Record<string, ModelsReading>>>({});
  const [schemas, setSchemas] = useState<Readonly<Record<string, ParamSchemaReading>>>({});
  const [failure, setFailure] = useState<{ id: string; value: SaveFailure } | null>(null);
  const [refusal, setRefusal] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState<InspectorWrite | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startWriting] = useTransition();

  const bound = row.provider?.id ?? null;
  const edit = edits[row.id] ?? opened(row);
  const connectionId = edit.connectionId;
  const probe = edit.probe.trim();
  const schemaKey = `${connectionId ?? ""}|${probe}`;

  /**
   * Read the chosen connection's models, once per connection.
   *
   * The cache is the guard: a connection already answered is not asked again, which is what
   * makes arrowing through the table free after the first visit to each provider. `models` is a
   * dependency so a landed answer re-runs the effect, which then finds its own entry and stops.
   */
  useEffect(() => {
    if (connectionId === null || models[connectionId] !== undefined) return;

    let live = true;

    void readModelOptions(connectionId).then((answer) => {
      if (live) setModels((held) => ({ ...held, [connectionId]: answer }));
    });

    return () => { live = false; };
  }, [connectionId, models]);

  /**
   * Read what the settled model can be tuned with, once per `(connection, model)`.
   *
   * Asked for an **unbound** alias too, with no connection: the contract answers an empty params
   * section saying why and the registry restrictions in full, which is exactly what that card
   * should show — the policy flags are true whether or not anything is on the other end.
   */
  useEffect(() => {
    if (probe === "" || schemas[schemaKey] !== undefined) return;

    let live = true;

    void readParamSchema(probe, connectionId).then((answer) => {
      if (live) setSchemas((held) => ({ ...held, [schemaKey]: answer }));
    });

    return () => { live = false; };
  }, [connectionId, probe, schemaKey, schemas]);

  const schema = schemas[schemaKey] ?? null;
  const paramFields = schema?.ok ? schema.schema.params.fields : [];
  const restrictionFields = schema?.ok ? schema.schema.restrictions.fields : [];
  const seedKey = `${schemaKey}|${schema === null ? "-" : "+"}`;
  const fresh = edit.seeded !== seedKey;

  // Re-seeded during render rather than in an effect, so the controls are never painted empty
  // for one frame after their schema lands — React's own *adjusting state when a prop changes*,
  // in the form where the "prop" is a read this component made.
  const values = fresh ? paramValues(paramFields, row.params) : edit.params;
  const policy = fresh ? paramValues(restrictionFields, row.restrictions) : edit.restrictions;

  const draft: InspectorDraft = {
    alias: edit.alias,
    connectionId,
    modelId: edit.modelId,
    params: paramsDocument(paramFields, values),
    restrictions: paramsDocument(restrictionFields, policy),
  };

  // The same five facts as the row has them — both sides through `paramsDocument`, so a stored
  // value the current schema cannot represent is absent from each and never reads as a change.
  const stored: InspectorDraft = {
    alias: row.alias,
    connectionId: bound,
    modelId: row.modelId,
    params: paramsDocument(paramFields, paramValues(paramFields, row.params)),
    restrictions: paramsDocument(
      restrictionFields,
      paramValues(restrictionFields, row.restrictions),
    ),
  };

  const problem = nameProblem(edit.alias, otherNames(aliasNames, row.alias));
  const shownFailure = failure?.id === row.id ? failure.value : null;
  const shownRefusal = refusal?.id === row.id ? refusal.value : null;
  const why = removeWhy(row.references.length);
  const guard = renameGuardNote(row.references.length);
  const reading = connectionId === null ? null : (models[connectionId] ?? null);
  const listed = reading !== null && reading.ok ? reading.models : [];

  const readOnly = mayAdminister ? undefined : INSPECTOR_READ_ONLY;
  const working = pending ? WRITE_LABELS[busy ?? "save"] : undefined;
  const saveBlocked =
    working ?? saveReason(draft, stored, problem, row.references, mayAdminister);
  const removeBlocked = readOnly ?? working ?? why ?? undefined;

  /**
   * Hold a change to this alias's draft.
   *
   * Every control goes through here, so the seed key travels with the value: the moment a reader
   * touches anything, the draft stops being *what the row says* and starts being theirs.
   *
   * @param moved What moved.
   */
  function change(moved: Partial<AliasEdit>): void {
    setEdits((held) => ({
      ...held,
      [row.id]: { ...edit, params: values, restrictions: policy, seeded: seedKey, ...moved },
    }));
  }

  /** Forget this alias's draft — what a successful write does, because the row is now the truth. */
  function settle(): void {
    setEdits((held) => {
      const rest = { ...held };

      delete rest[row.id];

      return rest;
    });
  }

  /**
   * Run one of the card's three writes.
   *
   * One transition for all three: they are mutually exclusive presses, and a second press while
   * one is in flight is refused rather than queued — React 19 does not make a state change after
   * an `await` inside an action part of the transition, so a guard on the press is what keeps a
   * double-click from sending a second `PATCH`.
   *
   * Which write is in flight is recorded **before** the transition and never cleared inside it,
   * for the same reason: a `setBusy(null)` after the `await` would commit a scheduler turn
   * before `isPending` flips, and the line would spend that turn saying the wrong thing. Once
   * the transition ends, `pending` is what silences it and the stale value is not read.
   *
   * @param kind Which write, for the line that says so.
   * @param work What to do.
   */
  function write(kind: InspectorWrite, work: () => Promise<void>): void {
    if (pending) return;

    setBusy(kind);
    setFailure(null);
    setRefusal(null);
    startWriting(work);
  }

  /**
   * Send the difference.
   *
   * @param event The submit.
   */
  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (saveBlocked !== undefined) return;

    write("save", async () => {
      const outcome = await saveAlias(row.id, updateBody(draft, stored));

      if (!outcome.ok) {
        setFailure({
          id: row.id,
          value: saveFailure(
            outcome.refusal,
            paramFieldErrors(outcome.refusal.details, "params"),
            paramFieldErrors(outcome.refusal.details, "restrictions"),
          ),
        });

        return;
      }

      settle();

      // The name may have changed, and the URL carries the name. Navigating re-reads the
      // registry, so the table row, the health cell and the routing matrix all agree with the
      // card at the same moment rather than one refresh apart.
      router.replace(aliasPath(outcome.alias));
      router.refresh();
    });
  }

  /** Copy the alias, and select the copy. */
  function duplicate(): void {
    write("duplicate", async () => {
      const outcome = await duplicateAlias(row.id);

      if (!outcome.ok) {
        setRefusal({ id: row.id, value: duplicateFailure(outcome.refusal) });
        return;
      }

      router.replace(aliasPath(outcome.alias));
      router.refresh();
    });
  }

  /** Remove the alias, and leave the inspector on nothing. */
  function remove(): void {
    setConfirming(false);

    write("remove", async () => {
      const outcome = await removeAlias(row.id);

      if (!outcome.ok) {
        setRefusal({ id: row.id, value: removeFailure(outcome.refusal) });
        return;
      }

      settle();

      // Nothing to select: the row is gone, so the URL stops naming it and the seat goes back
      // to its empty state rather than to a name the table no longer has.
      router.replace(REGISTRY_PATH);
      router.refresh();
    });
  }

  return (
    <div className="registry-inspector">
      {row.provider === null && (
        <p className="registry-inspector__unbound">
          {UNBOUND_BANNER}{" "}
          <Link className="registry-inspector__unbound-link" href={UNBOUND_BANNER_HREF}>
            {FIX_IN_PROVIDERS}
          </Link>
        </p>
      )}

      <form className="registry-inspector__form" onSubmit={submit}>
        <TextField
          autoComplete="off"
          disabled={!mayAdminister}
          error={shownFailure?.alias ?? nameError(problem)}
          hint={NAME_HINT}
          id={`${fields}-alias`}
          label={NAME_LABEL}
          maxLength={MAX_NAME_LENGTH}
          mono
          name="alias"
          onChange={(event) => { change({ alias: event.currentTarget.value }); }}
          spellCheck={false}
          value={edit.alias}
        />

        {/*
          The rename guard, said before the field is touched. Not the field's `error` — nothing
          is wrong with an alias that still holds its own name — and not the field's `hint`
          either, because the mockup's hint is the *rule about names* and this is a fact about
          this one.
        */}
        {guard !== null && <p className="registry-inspector__guard">{guard}</p>}

        <SelectField
          disabled={!mayAdminister}
          error={shownFailure?.connectionId}
          hint={
            <>
              {PROVIDER_HINT_LEAD}
              <Link className="registry-inspector__hint-link" href={PROVIDER_HINT_HREF}>
                {PROVIDER_HINT_LINK}
              </Link>
            </>
          }
          id={`${fields}-connection`}
          label={PROVIDER_LABEL}
          name="connectionId"
          onChange={(event) => {
            // The model travels: `claude-fable-5` on one Anthropic connection is
            // `claude-fable-5` on the next, and a rebind that emptied the box would make the
            // product's simplest story two decisions instead of one.
            change({ connectionId: event.currentTarget.value || null });
          }}
          value={connectionId ?? ""}
        >
          {/*
            Offered only where it is a real position: an alias that has a provider is not
            unbound here, and the way to stop using one is Remove.
          */}
          {bound === null && <option value="">{NO_PROVIDER_OPTION}</option>}
          {providerOptions(sources, row).map((source) => (
            <option key={source.id} value={source.id}>
              {providerOption(source)}
            </option>
          ))}
        </SelectField>

        <ModelField
          error={shownFailure?.modelId}
          idPrefix={fields}
          listed={listed}
          mayAdminister={mayAdminister}
          modelId={edit.modelId}
          onSettle={(id) => { change({ modelId: id, probe: id }); }}
          onType={(id) => { change({ modelId: id }); }}
          reading={reading}
          unbound={connectionId === null}
        />

        <ParamSection
          errors={shownFailure?.params}
          idPrefix={`${fields}-param`}
          note={schema?.ok === true ? paramsNote(schema.schema.params, schema.schema.reason) : null}
          onChange={(name, value) => { change({ params: { ...values, [name]: value } }); }}
          fields={paramFields}
          reason={readOnly}
          schema={schema}
          title={PARAMS_TITLE}
          values={values}
        />

        <ParamSection
          errors={shownFailure?.restrictions}
          idPrefix={`${fields}-restriction`}
          note={RESTRICTIONS_NOTE}
          onChange={(name, value) => {
            change({ restrictions: { ...policy, [name]: value } });
          }}
          fields={restrictionFields}
          reason={readOnly}
          schema={schema}
          title={RESTRICTIONS_TITLE}
          values={policy}
        />

        <section className="registry-inspector__used">
          <h3 className="registry-inspector__used-label">{USED_BY_LABEL}</h3>
          {row.references.length === 0 ? (
            <p className="registry-inspector__note">{USED_BY_EMPTY}</p>
          ) : (
            <ul aria-label={USED_BY_LIST_LABEL} className="registry-inspector__chips">
              {row.references.map((reference) => {
                const href = referenceHref(reference);

                return (
                  <li key={reference.refId}>
                    {href === null ? (
                      // A kind whose surface this build does not have. A chip that navigated
                      // nowhere would be worse than one that plainly does not.
                      <Tag>{reference.label}</Tag>
                    ) : (
                      <Link className="registry-inspector__chip-link" href={href}>
                        <Tag>{reference.label}</Tag>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {shownFailure !== null && (
          <p className="registry-inspector__failure" role="alert">
            {shownFailure.message}
          </p>
        )}

        {shownRefusal !== null && (
          <p className="registry-inspector__failure" role="alert">
            {shownRefusal}
          </p>
        )}

        {working !== undefined && (
          <p className="registry-inspector__note" role="status">
            {working}
          </p>
        )}

        <div className="registry-inspector__foot">
          <Button reason={saveBlocked} tone="primary" type="submit">
            {SAVE_LABEL}
          </Button>
          <Button
            onClick={duplicate}
            reason={readOnly ?? working}
            // `Button` prefers a caller's `title` over its own `reason`, so the hint is offered
            // only where there is no reason for it to hide.
            title={mayAdminister ? DUPLICATE_HINT : undefined}
            tone="ghost"
            type="button"
          >
            {DUPLICATE_LABEL}
          </Button>
          <Button
            aria-describedby={why === null ? undefined : whyId}
            onClick={() => { setConfirming(true); }}
            reason={removeBlocked}
            tone="danger"
            type="button"
          >
            {REMOVE_LABEL}
          </Button>

          {/*
            The mockup's mono why-line: a permanent, explanatory state of the button rather than
            an error after a press, naming the count from the row's own references.
          */}
          {why !== null && (
            <p className="registry-inspector__why" id={whyId}>
              {why}
            </p>
          )}
        </div>
      </form>

      <ShellOverlay
        label={removeTitle(row.alias)}
        onClose={() => { setConfirming(false); }}
        open={confirming}
      >
        <div className="registry-inspector__confirm">
          <h2 className="shell-overlay__title">{removeTitle(row.alias)}</h2>
          <p className="shell-overlay__note">{REMOVE_NOTE}</p>
          <div className="registry-inspector__confirm-actions">
            <Button onClick={remove} tone="danger" type="button">
              {REMOVE_CONFIRM}
            </Button>
            <Button onClick={() => { setConfirming(false); }} tone="ghost" type="button">
              {CANCEL_LABEL}
            </Button>
          </div>
        </div>
      </ShellOverlay>
    </div>
  );
}

/**
 * The draft an alias opens on: what the row says, with nothing seeded yet.
 *
 * `seeded` is deliberately a value no key can equal, so the first render after a schema lands
 * fills the controls from the row rather than leaving them at the empty object.
 *
 * @param row The selected row.
 * @returns The draft.
 */
function opened(row: TableRow): AliasEdit {
  return {
    alias: row.alias,
    connectionId: row.provider?.id ?? null,
    modelId: row.modelId,
    probe: row.modelId,
    params: {},
    restrictions: {},
    seeded: "",
  };
}

/**
 * The connections the provider select offers.
 *
 * The workspace's list, and — when the alias's own connection is not in it — that connection
 * ahead of them. A select whose value names no option renders blank, and a card that showed
 * *no provider* for an alias that has one would be reporting the page's failed provider read as
 * a fact about the alias.
 *
 * @param sources The workspace's connections, as the page read them.
 * @param row The selected row.
 * @returns The options, in the service's order.
 */
function providerOptions(
  sources: readonly ImportSource[],
  row: TableRow,
): readonly ImportSource[] {
  const binding = row.provider;

  if (binding === null || sources.some((source) => source.id === binding.id)) return sources;

  return [{ id: binding.id, name: binding.name, mask: binding.mask }, ...sources];
}

/**
 * The model field — a select over what discovery reported, or a box when there is nothing to
 * select from.
 *
 * Three shapes, and each is an honest answer rather than a stage of one:
 *
 * - **A box**, for an unbound alias: there is no connection to list from, so the model id is
 *   typed as the provider spells it, exactly as the create dialog's *bind later* mode does.
 * - **A box with the connection's own explanation**, when discovery has reported nothing or the
 *   listing was refused. An empty list is not a failure — the contract says the alias may still
 *   name the model and answers `model_not_discovered` as a warning.
 * - **A select**, otherwise — with the held model ahead of the list when the list does not
 *   contain it, which is what makes a rebind keep the model instead of silently dropping it.
 *
 * @param props.reading What the connection's models read as, or `null` while the read is out.
 * @param props.listed The models it answered with.
 * @param props.modelId What the control holds.
 * @param props.unbound Whether the alias has no connection at all.
 * @param props.error What the last refusal said about this field.
 * @param props.mayAdminister Whether this reader may change it.
 * @param props.idPrefix The prefix every control's id is built from.
 * @param props.onSettle Called with a model settled on — one press of the select, or a typed box
 *   the reader has left.
 * @param props.onType Called with every keystroke in a typed box.
 * @returns The control.
 */
function ModelField({
  reading,
  listed,
  modelId,
  unbound,
  error,
  mayAdminister,
  idPrefix,
  onSettle,
  onType,
}: Readonly<{
  reading: ModelsReading | null;
  listed: readonly ModelOption[];
  modelId: string;
  unbound: boolean;
  error?: string;
  mayAdminister: boolean;
  idPrefix: string;
  onSettle: (id: string) => void;
  onType: (id: string) => void;
}>) {
  if (!unbound && reading === null) {
    return (
      <p className="registry-inspector__note" role="status">
        {MODELS_LOADING}
      </p>
    );
  }

  if (unbound || listed.length === 0) {
    const refused = reading !== null && !reading.ok ? reading.reason : null;

    return (
      <TextField
        autoComplete="off"
        disabled={!mayAdminister}
        error={error}
        hint={unbound ? MODEL_ID_HINT : (refused ?? MODEL_NOT_DISCOVERED)}
        id={`${idPrefix}-model`}
        label={unbound ? MODEL_ID_LABEL : MODEL_LABEL}
        maxLength={MAX_MODEL_ID_LENGTH}
        mono
        name="modelId"
        // The schema is read when the reader **leaves** the box, not as they type it.
        onBlur={(event) => { onSettle(event.currentTarget.value); }}
        onChange={(event) => { onType(event.currentTarget.value); }}
        spellCheck={false}
        value={modelId}
      />
    );
  }

  const unlisted = modelId !== "" && !listed.some((option) => option.modelId === modelId);

  return (
    <SelectField
      disabled={!mayAdminister}
      error={error}
      hint={
        unlisted ? (
          <>
            {MODEL_HINT} · {unlistedNote(modelId)}
          </>
        ) : (
          MODEL_HINT
        )
      }
      id={`${idPrefix}-model`}
      label={MODEL_LABEL}
      name="modelId"
      onChange={(event) => { onSettle(event.currentTarget.value); }}
      value={modelId}
    >
      <option value="">{MODEL_PLACEHOLDER}</option>
      {unlisted && <option value={modelId}>{modelId}</option>}
      {listed.map((option) => (
        <option key={option.modelId} value={option.modelId}>
          {option.display}
        </option>
      ))}
    </SelectField>
  );
}

/**
 * One of the card's two schema-drawn sections: the model's parameters, or the registry's own
 * restrictions.
 *
 * One component for both, because they are **one dialect** — CH.2 answers them in the same
 * shape so one renderer draws both, and a `422` naming `params.thinking` or
 * `restrictions.batch_ok` maps back to a field of the section it came from without a lookup
 * table.
 *
 * @param props.title What the section is headed.
 * @param props.schema What the read answered, or `null` while it is on its way.
 * @param props.fields The section's fields.
 * @param props.values What its controls hold.
 * @param props.note What to say instead of controls, when there are none.
 * @param props.errors What the service said about which of its fields.
 * @param props.reason Why this reader may not change them, or `undefined`.
 * @param props.idPrefix The prefix every control's id is built from.
 * @param props.onChange Called with a field's name and its new value.
 * @returns The section.
 */
function ParamSection({
  title,
  schema,
  fields,
  values,
  note,
  errors,
  reason,
  idPrefix,
  onChange,
}: Readonly<{
  title: string;
  schema: ParamSchemaReading | null;
  fields: readonly ModelParamFormField[];
  values: ParamValues;
  note: string | null;
  errors?: Readonly<Record<string, readonly string[]>>;
  reason?: string;
  idPrefix: string;
  onChange: (name: string, value: ParamValue) => void;
}>) {
  return (
    <section className="registry-inspector__section">
      <h3 className="registry-inspector__subtitle">{title}</h3>

      {schema === null ? (
        <p className="registry-inspector__note" role="status">
          {PARAMS_LOADING}
        </p>
      ) : !schema.ok ? (
        <p className="registry-inspector__note" role="status">
          {schema.reason}
        </p>
      ) : (
        <>
          {note !== null && <p className="registry-inspector__note">{note}</p>}
          <ParamFields
            errors={errors}
            fields={fields}
            idPrefix={idPrefix}
            onChange={onChange}
            reason={reason}
            values={values}
          />
        </>
      )}
    </section>
  );
}
