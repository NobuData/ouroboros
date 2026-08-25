"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";

import { aliasPath } from "@/app/paths";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, SelectField, TextField } from "@/app/ui";

import {
  type CreateOutcome,
  type ModelsReading,
  type ParamSchemaReading,
  createAlias,
  readModelOptions,
  readParamSchema,
} from "./create-actions";
import {
  CREATE_CANCEL,
  CREATE_NOTE,
  CREATE_SUBMIT,
  CREATE_TITLE,
  CREATING,
  type CreateFailure,
  type CreateMode,
  DEFAULT_MODE,
  MAX_MODEL_ID_LENGTH,
  MAX_NAME_LENGTH,
  MODELS_LOADING,
  MODEL_HINT,
  MODEL_ID_HINT,
  MODEL_ID_LABEL,
  MODEL_LABEL,
  MODEL_NOT_DISCOVERED,
  MODEL_PLACEHOLDER,
  MODE_LATER_HINT,
  MODE_LATER_LABEL,
  MODE_LEGEND,
  MODE_NOW_HINT,
  MODE_NOW_LABEL,
  NAME_HINT,
  NAME_LABEL,
  NO_PROVIDERS_YET,
  PARAMS_LOADING,
  PARAMS_TITLE,
  PROVIDER_HINT,
  PROVIDER_LABEL,
  PROVIDER_PLACEHOLDER,
  UNBOUND_HREF,
  UNBOUND_LINK,
  UNBOUND_NOTICE,
  createBody,
  createFailure,
  nameError,
  nameProblem,
  submitReason,
} from "./create";
import { ParamFields } from "./param-fields";
import {
  type ParamValue,
  type ParamValues,
  paramDefaults,
  paramFieldErrors,
  paramsDocument,
  paramsNote,
} from "./params";
import { NEW_ALIAS_LABEL, type ImportSource, newAliasReason } from "./view";

import "./registry.css";

/**
 * Mockup 21's **+ New alias** — the head's primary action and the dialog behind it
 * ([#594](https://github.com/NobuData/ouroboros/issues/594)).
 *
 * The mockup draws the button and stops there. What this ticket adds is the state the drawing
 * only implies: mockup 21's own table has a `gpt5-experiments` row with **no provider**, and
 * before this dialog existed there was no way to make one through the product. So the dialog
 * has a mode, and the second mode is the point of it.
 *
 * ### One dialog, two modes, one request
 *
 * *Bind now* asks for a connection, then one of that connection's models, then whatever that
 * model can be tuned with. *Bind later* asks for a model id and says plainly what the row will
 * look like — dimmed, switched off, `✗ no key — connect a provider` — with the link that fixes
 * it. Both compose **one** `POST /registry/aliases` body (`create.ts`'s `createBody`): the
 * contract takes the connection as optional, so the toggle changes what goes into the body
 * rather than which endpoint is called.
 *
 * ### Three reads, each caused by a choice
 *
 * The connections arrive as a prop — the page has already read them for the import menu, so
 * opening this costs nothing. Choosing one reads its models; choosing a model reads that
 * model's parameter schema. Each read is guarded by a token so a slow answer to a superseded
 * question is discarded rather than drawn: a reader who picks Anthropic, changes their mind and
 * picks Ollama must not end up with Anthropic's models under Ollama's name.
 *
 * ### The name is checked as it is typed, and the service still decides
 *
 * `nameProblem` compares against the aliases the table already read, so the ordinary collision
 * is caught with no round trip; `model_alias_name_taken` is what actually decides, and
 * `createFailure` puts it under the same box. A reader never learns about a taken name from
 * anywhere but the name field.
 *
 * ### On success the row is on the page, selected
 *
 * The dialog closes and the route is navigated to `?alias=<name>` — `app/paths.ts`'s
 * `aliasPath` — so the server re-reads the registry, the new row is in the table, and the
 * inspector's seat is already open on it. That is the ticket's own criterion, and it is why
 * this does not stop on a *created* step: the confirmation is the row itself.
 */

/** What the action needs to be told. */
export interface NewAliasProps {
  /**
   * Whether this reader's role may create aliases — `app/api/membership.ts`'s `mayAdminister`,
   * decided at the gate. `false` renders the button inert with the reason and the dialog can
   * never open; the gate that *enforces* is the service's (`create-actions.ts`).
   */
  readonly mayAdminister: boolean;
  /**
   * The workspace's connections, as the page read them for the import menu.
   *
   * Empty for a workspace that has connected none **and** for one whose provider read failed:
   * the two are different facts on the import control, and identical here — either way there is
   * nothing to bind to, and *bind later* is the mode that still works.
   */
  readonly sources: readonly ImportSource[];
  /** Every alias name this workspace has, for the live uniqueness check. */
  readonly aliasNames: readonly string[];
}

/**
 * The head's primary action, and its dialog.
 *
 * @param props See {@link NewAliasProps}.
 * @returns The button, with the dialog beside it while it is open.
 */
export function NewAlias({ mayAdminister, sources, aliasNames }: NewAliasProps) {
  const router = useRouter();
  const fields = useId();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<CreateMode>(DEFAULT_MODE);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [modelId, setModelId] = useState("");
  const [params, setParams] = useState<ParamValues>({});
  const [models, setModels] = useState<ModelsReading | null>(null);
  const [schema, setSchema] = useState<ParamSchemaReading | null>(null);
  const [failure, setFailure] = useState<CreateFailure | null>(null);

  const [reading, startReading] = useTransition();
  const [saving, startSaving] = useTransition();

  /**
   * Which question the in-flight reads are answering.
   *
   * A counter rather than an `AbortController`: a Server Action's round trip cannot be
   * cancelled from the browser, so what is available is to *ignore* an answer to a question
   * nobody is asking any more. One counter for both reads, because choosing a provider
   * supersedes an outstanding schema read as surely as it does an outstanding model read.
   */
  const question = useRef(0);

  const problem = nameProblem(name, aliasNames);
  const draft = { alias: name, mode, connectionId, modelId, params: paramsOf(params, schema) };

  /** Open the dialog on an empty form. Everything is reset here rather than on close, so a
   * dialog dismissed halfway and reopened starts clean and reads afresh. */
  function openDialog(): void {
    question.current += 1;
    setOpen(true);
    setName("");
    setMode(DEFAULT_MODE);
    setConnectionId(null);
    setModelId("");
    setParams({});
    setModels(null);
    setSchema(null);
    setFailure(null);
  }

  /** Close without writing. Nothing is refreshed: nothing happened. */
  function close(): void {
    question.current += 1;
    setOpen(false);
  }

  /**
   * Move the mode toggle.
   *
   * The model belongs to the binding, so changing the mode clears the model, its parameters and
   * the schema behind them — a `thinking` left over from a bound draft would be refused for an
   * unbound alias, and turning a change of mind into a `422` is exactly what this avoids.
   *
   * @param next Which mode.
   */
  function chooseMode(next: CreateMode): void {
    question.current += 1;
    setMode(next);
    setConnectionId(null);
    setModelId("");
    setParams({});
    setModels(null);
    setSchema(null);
    setFailure(null);
  }

  /**
   * Choose the connection, and list its models.
   *
   * @param id The connection, or `null` for the blank option.
   */
  function chooseProvider(id: string | null): void {
    const token = (question.current += 1);

    setConnectionId(id);
    setModelId("");
    setParams({});
    setModels(null);
    setSchema(null);
    setFailure(null);

    if (id === null) return;

    startReading(async () => {
      const answer = await readModelOptions(id);

      if (question.current === token) setModels(answer);
    });
  }

  /**
   * Hold a model id, and forget whatever the previous one could be tuned with.
   *
   * State only — no read. The two are separate because *what is in the box* and *which model to
   * ask about* are not the same moment for a typed model: a read fired on every keystroke would
   * spend fourteen round trips learning about `c`, `cl`, `cla`… and answer about none of them.
   *
   * @param id The model id.
   */
  function setModel(id: string): void {
    // A schema read still in flight is about the previous model; its answer is discarded.
    question.current += 1;

    setModelId(id);
    setParams({});
    setSchema(null);
    setFailure(null);
  }

  /**
   * Read what a model can be tuned with.
   *
   * @param id The model id to ask about.
   */
  function loadSchema(id: string): void {
    const token = (question.current += 1);

    // Nothing to ask about an empty box, and nothing to ask at all in the *bind later* mode: an
    // unbound alias accepts no parameters, which the contract answers with an empty section
    // rather than a refusal — but asking would still be a round trip for a form with no
    // controls in it.
    if (id.trim() === "" || mode === "later" || connectionId === null) return;

    startReading(async () => {
      const answer = await readParamSchema(id.trim(), connectionId);

      if (question.current !== token) return;

      setSchema(answer);
      setParams(answer.ok ? paramDefaults(answer.schema.params.fields) : {});
    });
  }

  /**
   * Choose a model from the live list: one press, one read.
   *
   * @param id The model id the select now holds.
   */
  function chooseModel(id: string): void {
    setModel(id);
    loadSchema(id);
  }

  /**
   * Send the body.
   *
   * @param event The submit.
   */
  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (saving || submitReason(draft, problem) !== undefined) return;

    setFailure(null);

    startSaving(async () => {
      const outcome: CreateOutcome = await createAlias(createBody(draft));

      if (!outcome.ok) {
        setFailure(createFailure(outcome.refusal, paramFieldErrors(outcome.refusal.details, "params")));
        return;
      }

      setOpen(false);

      // The row, on the page behind the dialog, selected. The navigation is what re-reads the
      // registry — a different `?alias=` is a different URL and cannot be answered from the
      // router's cache — and the refresh after it is for the one case the navigation is a
      // no-op: a reader who linked to `?alias=opus-5` before `opus-5` existed and then created
      // it.
      router.replace(aliasPath(outcome.alias));
      router.refresh();
    });
  }

  const blocked = submitReason(draft, problem);

  return (
    <>
      <Button
        onClick={openDialog}
        reason={newAliasReason(mayAdminister)}
        tone="primary"
        type="button"
      >
        {NEW_ALIAS_LABEL}
      </Button>

      <ShellOverlay label={CREATE_TITLE} onClose={close} open={open}>
        <h2 className="shell-overlay__title">{CREATE_TITLE}</h2>
        <p className="shell-overlay__note">{CREATE_NOTE}</p>

        <form className="registry-create" onSubmit={submit}>
          <TextField
            autoComplete="off"
            error={failure?.alias ?? nameError(problem)}
            hint={NAME_HINT}
            id={`${fields}-alias`}
            label={NAME_LABEL}
            maxLength={MAX_NAME_LENGTH}
            mono
            name="alias"
            onChange={(event) => { setName(event.currentTarget.value); }}
            required
            spellCheck={false}
            value={name}
          />

          <ModeToggle mode={mode} name={`${fields}-mode`} onChange={chooseMode} />

          {mode === "now" ? (
            <BindNow
              connectionId={connectionId}
              failure={failure}
              idPrefix={fields}
              modelId={modelId}
              models={models}
              onModel={chooseModel}
              onParam={(key, value) => { setParams((held) => ({ ...held, [key]: value })); }}
              onType={setModel}
              onProvider={chooseProvider}
              params={params}
              reading={reading}
              schema={schema}
              sources={sources}
            />
          ) : (
            <BindLater
              failure={failure}
              idPrefix={fields}
              modelId={modelId}
              onModel={setModel}
            />
          )}

          {failure !== null && (
            <p className="registry-create__failure" role="alert">
              {failure.message}
            </p>
          )}

          {saving && (
            <p className="registry-create__state" role="status">
              {CREATING}
            </p>
          )}

          <div className="registry-create__actions">
            <Button reason={saving ? CREATING : blocked} tone="primary" type="submit">
              {CREATE_SUBMIT}
            </Button>
            <Button onClick={close} tone="ghost" type="button">
              {CREATE_CANCEL}
            </Button>
          </div>
        </form>
      </ShellOverlay>
    </>
  );
}

/**
 * The parameters as the body will carry them.
 *
 * Composed from the **schema** rather than from the held values alone, because a value held for
 * a field the current model does not have must not be sent: the field set is replaced whenever
 * the model is, and `paramsDocument` is what keeps the document to the controls that are
 * actually on the screen. A read that failed contributes nothing, which is the same answer as a
 * model with no parameters — and the right one, since the alias can be created without them.
 *
 * @param values What the controls hold.
 * @param schema The model's schema, or `null` when there is not one.
 * @returns The `params` document, `{}` when there is nothing to send.
 */
function paramsOf(
  values: ParamValues,
  schema: ParamSchemaReading | null,
): Readonly<Record<string, string | number | boolean>> {
  return schema === null || !schema.ok ? {} : paramsDocument(schema.schema.params.fields, values);
}

/**
 * The mode toggle: two radios, because they are two values of one setting and a reader may
 * change their mind before typing anything.
 *
 * A radio group rather than a switch labelled *bind later*: a switch is a control with an
 * *off* state, and neither of these is the absence of the other — one binds now, the other
 * binds later, and both create an alias.
 *
 * @param props.mode Which is chosen.
 * @param props.name The group's `name`, so the two radios are one control.
 * @param props.onChange Called with the mode chosen.
 * @returns The fieldset.
 */
function ModeToggle({
  mode,
  name,
  onChange,
}: Readonly<{ mode: CreateMode; name: string; onChange: (mode: CreateMode) => void }>) {
  return (
    <fieldset className="registry-create__modes">
      <legend className="registry-create__legend">{MODE_LEGEND}</legend>

      {(
        [
          { value: "now", label: MODE_NOW_LABEL, hint: MODE_NOW_HINT },
          { value: "later", label: MODE_LATER_LABEL, hint: MODE_LATER_HINT },
        ] as const
      ).map((choice) => (
        // The label is a sibling with a `for` rather than a wrapper around the input, because a
        // wrapping label takes its whole text as the control's accessible name — and the line
        // under each choice is a *description*, not part of what the control is called.
        <div className="registry-create__mode" key={choice.value}>
          <input
            aria-describedby={`${name}-${choice.value}-hint`}
            checked={mode === choice.value}
            className="registry-create__radio"
            id={`${name}-${choice.value}`}
            name={name}
            onChange={() => { onChange(choice.value); }}
            type="radio"
            value={choice.value}
          />
          <label className="registry-create__mode-label" htmlFor={`${name}-${choice.value}`}>
            {choice.label}
          </label>
          <span className="registry-create__mode-hint" id={`${name}-${choice.value}-hint`}>
            {choice.hint}
          </span>
        </div>
      ))}
    </fieldset>
  );
}

/**
 * The *bind now* fields: the provider, its models, and the model's parameters.
 *
 * @param props.sources The workspace's connections.
 * @param props.connectionId The chosen connection.
 * @param props.models What its models read as, or `null` before the read has been asked for.
 * @param props.modelId The chosen model.
 * @param props.schema What the model's parameters read as, or `null`.
 * @param props.params What the parameter controls hold.
 * @param props.reading Whether either read is in flight.
 * @param props.failure The last refusal, for the fields it named.
 * @param props.idPrefix The prefix every control's id is built from.
 * @param props.onProvider Called with the chosen connection.
 * @param props.onModel Called with a model that has been settled on — one press of the select,
 *   or a typed box the reader has left.
 * @param props.onType Called with every keystroke in a typed model box.
 * @param props.onParam Called with a parameter's name and its new value.
 * @returns The fields.
 */
function BindNow({
  sources,
  connectionId,
  models,
  modelId,
  schema,
  params,
  reading,
  failure,
  idPrefix,
  onProvider,
  onModel,
  onType,
  onParam,
}: Readonly<{
  sources: readonly ImportSource[];
  connectionId: string | null;
  models: ModelsReading | null;
  modelId: string;
  schema: ParamSchemaReading | null;
  params: ParamValues;
  reading: boolean;
  failure: CreateFailure | null;
  idPrefix: string;
  onProvider: (id: string | null) => void;
  onModel: (id: string) => void;
  onType: (id: string) => void;
  onParam: (name: string, value: ParamValue) => void;
}>) {
  return (
    <>
      <SelectField
        error={failure?.connectionId}
        hint={sources.length === 0 ? NO_PROVIDERS_YET : PROVIDER_HINT}
        id={`${idPrefix}-connection`}
        label={PROVIDER_LABEL}
        name="connectionId"
        onChange={(event) => { onProvider(event.currentTarget.value || null); }}
        value={connectionId ?? ""}
      >
        <option value="">{PROVIDER_PLACEHOLDER}</option>
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </SelectField>

      {connectionId !== null && (
        <ModelField
          error={failure?.modelId}
          idPrefix={idPrefix}
          modelId={modelId}
          models={models}
          onModel={onModel}
          onType={onType}
        />
      )}

      {modelId.trim() !== "" && (
        <ParamSection
          failure={failure}
          idPrefix={idPrefix}
          onParam={onParam}
          params={params}
          reading={reading}
          schema={schema}
        />
      )}
    </>
  );
}

/**
 * The model field — a select over what discovery reported, or a box when it reported nothing.
 *
 * An empty list is **not** a failure: the contract says an alias may still be created by typing
 * the model, answered with a `model_not_discovered` warning. So the control changes shape and
 * the hint says why, rather than the dialog refusing to go on.
 *
 * @param props.models What the read answered, or `null` while it is on its way.
 * @param props.modelId The chosen model.
 * @param props.error What the last refusal said about this field.
 * @param props.idPrefix The prefix every control's id is built from.
 * @param props.onModel Called once a model is settled on — a press of the select, or a typed
 *   box the reader has left.
 * @param props.onType Called with every keystroke in the typed form.
 * @returns The select, or the box.
 */
function ModelField({
  models,
  modelId,
  error,
  idPrefix,
  onModel,
  onType,
}: Readonly<{
  models: ModelsReading | null;
  modelId: string;
  error?: string;
  idPrefix: string;
  onModel: (id: string) => void;
  onType: (id: string) => void;
}>) {
  // `null` is *the read has not answered yet* and nothing else — it is set on every provider
  // change before the read starts — so there is no second flag to consult.
  if (models === null) {
    return (
      <p className="registry-create__state" role="status">
        {MODELS_LOADING}
      </p>
    );
  }

  const listed = models.ok ? models.models : [];

  if (listed.length === 0) {
    return (
      <TextField
        autoComplete="off"
        error={error}
        hint={models.ok ? MODEL_NOT_DISCOVERED : models.reason}
        id={`${idPrefix}-model`}
        label={MODEL_LABEL}
        maxLength={MAX_MODEL_ID_LENGTH}
        mono
        name="modelId"
        // The parameters are read when the reader **leaves** the box, not as they type it: a
        // read per keystroke would ask about `c`, `cl`, `cla`… and answer about none of them.
        onBlur={(event) => { onModel(event.currentTarget.value); }}
        onChange={(event) => { onType(event.currentTarget.value); }}
        required
        spellCheck={false}
        value={modelId}
      />
    );
  }

  return (
    <SelectField
      error={error}
      hint={MODEL_HINT}
      id={`${idPrefix}-model`}
      label={MODEL_LABEL}
      name="modelId"
      onChange={(event) => { onModel(event.currentTarget.value); }}
      value={modelId}
    >
      <option value="">{MODEL_PLACEHOLDER}</option>
      {listed.map((option) => (
        <option key={option.modelId} value={option.modelId}>
          {option.display}
        </option>
      ))}
    </SelectField>
  );
}

/**
 * The parameter section: the model's controls, or the sentence that explains why there are
 * none.
 *
 * @param props.schema What the read answered, or `null` while it is on its way.
 * @param props.params What the controls hold.
 * @param props.reading Whether the read is in flight.
 * @param props.failure The last refusal, for the parameters it named.
 * @param props.idPrefix The prefix every control's id is built from.
 * @param props.onParam Called with a parameter's name and its new value.
 * @returns The section.
 */
function ParamSection({
  schema,
  params,
  reading,
  failure,
  idPrefix,
  onParam,
}: Readonly<{
  schema: ParamSchemaReading | null;
  params: ParamValues;
  reading: boolean;
  failure: CreateFailure | null;
  idPrefix: string;
  onParam: (name: string, value: ParamValue) => void;
}>) {
  if (schema === null) {
    return reading ? (
      <p className="registry-create__state" role="status">
        {PARAMS_LOADING}
      </p>
    ) : null;
  }

  if (!schema.ok) {
    return (
      <p className="registry-create__state" role="status">
        {schema.reason}
      </p>
    );
  }

  const note = paramsNote(schema.schema.params, schema.schema.reason);

  return (
    <section className="registry-create__params">
      <h3 className="registry-create__subtitle">{PARAMS_TITLE}</h3>
      {note !== null ? (
        <p className="registry-create__state">{note}</p>
      ) : (
        <ParamFields
          errors={failure?.params}
          fields={schema.schema.params.fields}
          idPrefix={`${idPrefix}-param`}
          onChange={onParam}
          values={params}
        />
      )}
    </section>
  );
}

/**
 * The *bind later* fields: the model id, and what the row will look like.
 *
 * The notice is the honest half of the promise. The row this creates is mockup 21's orphan —
 * dimmed, switch off, `✗ no key — connect a provider` — and saying so *before* the create is
 * what makes that row read as a state somebody chose rather than as something that went wrong.
 *
 * @param props.modelId What is in the box.
 * @param props.failure The last refusal, for the field it named.
 * @param props.idPrefix The prefix every control's id is built from.
 * @param props.onModel Called with what was typed.
 * @returns The field and the notice.
 */
function BindLater({
  modelId,
  failure,
  idPrefix,
  onModel,
}: Readonly<{
  modelId: string;
  failure: CreateFailure | null;
  idPrefix: string;
  onModel: (id: string) => void;
}>) {
  return (
    <>
      <TextField
        autoComplete="off"
        error={failure?.modelId}
        hint={MODEL_ID_HINT}
        id={`${idPrefix}-model`}
        label={MODEL_ID_LABEL}
        maxLength={MAX_MODEL_ID_LENGTH}
        mono
        name="modelId"
        onChange={(event) => { onModel(event.currentTarget.value); }}
        required
        spellCheck={false}
        value={modelId}
      />

      <p className="registry-create__unbound">
        {UNBOUND_NOTICE}{" "}
        <Link className="registry-create__unbound-link" href={UNBOUND_HREF}>
          {UNBOUND_LINK}
        </Link>
      </p>
    </>
  );
}
