"use client";

import { SelectField, TextField } from "@/app/ui";

import { ErrorLine, ToggleRow, describedBy } from "./controls";
import {
  CHECK_NAMES_HINT,
  type ConfigRecord,
  type FieldMessages,
  type GenericField,
  JSON_NOTE,
  type JsonSchema,
  LIST_HINT,
  NO_CONDITION,
  NO_OPTIONS_NOTE,
  OPERATOR_LABEL,
  PREDICATE_LABEL,
  VALUES_LABEL,
  VALUE_LABEL,
  branchSchema,
  fieldLabel,
  generatedDefaults,
  genericFields,
  isRecord,
  propertySchema,
  requiredProperties,
  schemaChoices,
  splitList,
  withValue,
} from "./inspector";

/**
 * The inspector's forms for every node type but the model stage (S.4,
 * [#150](https://github.com/NobuData/ouroboros/issues/150)): a flow node's predicate builder, a
 * terminal's action and options, and the form generated for anything else — an infra stage, and
 * any type the catalog serves that this build has never heard of.
 */

/** What every form here takes. */
export interface ConfigFormProps {
  /** The prefix every control's id is built from. */
  readonly idPrefix: string;
  /** The draft config. */
  readonly config: ConfigRecord;
  /** Told the new draft config. */
  readonly onChange: (config: ConfigRecord) => void;
  /** The type's config schema, with its `$defs`. */
  readonly schema: JsonSchema;
  /** What stops the draft from being applied. */
  readonly errors: FieldMessages;
  /** Why the reader may not edit, or `undefined` when they may. */
  readonly readOnlyReason: string | undefined;
}

/**
 * A form generated from an object schema — one control per property.
 *
 * Optional text left empty is removed from the config rather than stored as `""`, because the DSL
 * reads an absent optional field as *the default*, and an empty string as a value.
 *
 * @param props See {@link ConfigFormProps}, plus `path`, where in the config the object lives.
 * @returns The fields.
 */
export function GeneratedForm({
  idPrefix,
  config,
  onChange,
  schema,
  errors,
  readOnlyReason,
  path = [],
  root = schema,
}: ConfigFormProps & Readonly<{ path?: readonly string[]; root?: JsonSchema }>) {
  const fields = genericFields(schema, root);
  const value = path.length === 0 ? config : (readNested(config, path) ?? {});

  return (
    <>
      {fields.map((field) => (
        <GeneratedControl
          error={errors[[...path, field.name].join(".")]}
          field={field}
          id={`${idPrefix}-${[...path, field.name].join("-")}`}
          key={field.name}
          onChange={(next) => onChange(withValue(config, [...path, field.name], next))}
          readOnlyReason={readOnlyReason}
          value={value[field.name]}
        />
      ))}
    </>
  );
}

/**
 * The object at a path, when it is one.
 *
 * @param config The config.
 * @param path The keys.
 * @returns The object, or `undefined`.
 */
function readNested(config: ConfigRecord, path: readonly string[]): ConfigRecord | undefined {
  let current: unknown = config;
  for (const key of path) current = isRecord(current) ? current[key] : undefined;
  return isRecord(current) ? current : undefined;
}

/**
 * One generated control.
 *
 * @param props.field The field.
 * @param props.id The control's id.
 * @param props.value Its value.
 * @param props.onChange Told the new value, or `undefined` to remove it.
 * @param props.error What is wrong, or `undefined`.
 * @param props.readOnlyReason Why the reader may not edit.
 * @returns The control.
 */
function GeneratedControl({
  field,
  id,
  value,
  onChange,
  error,
  readOnlyReason,
}: Readonly<{
  field: GenericField;
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
  error: string | undefined;
  readOnlyReason: string | undefined;
}>) {
  switch (field.widget) {
    case "select":
      return (
        <SelectField
          error={error}
          id={id}
          label={field.label}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
          value={typeof value === "string" ? value : ""}
        >
          {(!field.required || typeof value !== "string") && <option value="">—</option>}
          {field.choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </SelectField>
      );
    case "toggle":
      return (
        <ToggleRow
          checked={value === true}
          label={field.label}
          onToggle={() => onChange(value !== true)}
          reason={readOnlyReason}
        />
      );
    case "number":
      return (
        <TextField
          error={error}
          id={id}
          inputMode="numeric"
          label={field.label}
          max={field.bounds.maximum ?? undefined}
          min={field.bounds.minimum ?? undefined}
          mono
          onChange={(event) => {
            const text = event.target.value.trim();
            onChange(text === "" ? undefined : /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text);
          }}
          type="number"
          value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
        />
      );
    case "text":
      return (
        <TextField
          error={error}
          id={id}
          label={field.label}
          maxLength={field.bounds.maxLength ?? undefined}
          mono
          onChange={(event) =>
            onChange(event.target.value === "" && !field.required ? undefined : event.target.value)
          }
          value={typeof value === "string" ? value : ""}
        />
      );
    case "json":
      return (
        <div className="studio-inspector__field">
          <p className="studio-inspector__section">{field.label}</p>
          <pre className="studio-inspector__json">{JSON.stringify(value ?? null, null, 2)}</pre>
          <p className="studio-inspector__note">{JSON_NOTE}</p>
        </div>
      );
  }
}

/**
 * A flow node's form — its kind, and the structured predicate decision **P8** defines: what it
 * tests, the operator, and the value or values. Every choice is the schema's, read per predicate
 * kind from its `if`/`then` branches.
 *
 * @param props See {@link ConfigFormProps}.
 * @returns The form.
 */
export function FlowForm({ idPrefix, config, onChange, schema, errors }: ConfigFormProps) {
  const kinds = schemaChoices(propertySchema(schema, "kind", schema), schema);

  return (
    <>
      <SelectField
        id={`${idPrefix}-kind`}
        label={fieldLabel("kind")}
        onChange={(event) => onChange(withValue(config, ["kind"], event.target.value))}
        value={typeof config.kind === "string" ? config.kind : ""}
      >
        {kinds.map((choice) => (
          <option key={choice} value={choice}>
            {fieldLabel(choice)}
          </option>
        ))}
      </SelectField>

      <PredicateFields
        errors={errors}
        field="predicate"
        idPrefix={idPrefix}
        legend={PREDICATE_LABEL}
        onChange={(next) => onChange(withValue(config, ["predicate"], next))}
        predicate={isRecord(config.predicate) ? config.predicate : undefined}
        root={schema}
        schema={propertySchema(schema, "predicate", schema)}
      />
    </>
  );
}

/** What the predicate builder takes. */
export interface PredicateFieldsProps {
  /** The prefix every control's id is built from. */
  readonly idPrefix: string;
  /** The key its messages are filed under, and its ids' middle — `predicate`, `condition`. */
  readonly field: string;
  /** The group's legend. */
  readonly legend: string;
  /** The predicate, or `undefined` for none. */
  readonly predicate: ConfigRecord | undefined;
  /** Told the new predicate, or `undefined` when *No condition* is chosen. */
  readonly onChange: (predicate: ConfigRecord | undefined) => void;
  /** The predicate's schema. */
  readonly schema: JsonSchema;
  /** The document its references resolve against. */
  readonly root: JsonSchema;
  /** What stops the draft from being applied, as `<field>.kind` and `<field>.values`. */
  readonly errors: FieldMessages;
  /**
   * Whether *none* is a value — a loop edge's condition is optional (§ 6), a flow node's predicate
   * and a branch's condition are not.
   */
  readonly optional?: boolean;
}

/**
 * The structured predicate decision **P8** defines — what it tests, the operator, and the value or
 * values — every choice read per predicate kind from the schema's `if`/`then` branches. A flow node's
 * predicate (S.4) and an edge's condition (S.5, [#151](https://github.com/NobuData/ouroboros/issues/151))
 * are one grammar (§ 5), so they are one builder.
 *
 * @param props See {@link PredicateFieldsProps}.
 * @returns The group.
 */
export function PredicateFields({
  idPrefix,
  field,
  legend,
  predicate,
  onChange,
  schema,
  root,
  errors,
  optional = false,
}: PredicateFieldsProps) {
  const value = predicate ?? {};
  const predicateKinds = schemaChoices(propertySchema(schema, "kind", root), root);
  const kind = typeof value.kind === "string" ? value.kind : "";
  const branch = branchSchema(schema, "kind", kind, root);
  const ops = schemaChoices(propertySchema(branch, "op", root), root);
  const valueChoices = schemaChoices(propertySchema(branch, "value", root), root);
  const valuesChoices = schemaChoices(propertySchema(branch, "values", root), root);
  const properties = isRecord(branch.properties) ? Object.keys(branch.properties) : [];

  const chooseKind = (next: string) => {
    if (next === "") {
      onChange(undefined);
      return;
    }

    const nextBranch = branchSchema(schema, "kind", next, root);
    const nextOps = schemaChoices(propertySchema(nextBranch, "op", root), root);
    const nextValues = schemaChoices(propertySchema(nextBranch, "value", root), root);
    onChange({
      kind: next,
      ...(nextOps.length > 0 ? { op: nextOps[0] } : {}),
      ...(nextValues.length > 0 ? { value: nextValues[0] } : {}),
      ...(requiredProperties(nextBranch, root).includes("values") ? { values: [] } : {}),
    });
  };

  const id = `${idPrefix}-${field}`;
  const valuesId = `${id}-values`;
  const valuesError = errors[`${field}.values`];

  return (
    <fieldset className="studio-inspector__group">
      <legend className="studio-inspector__section">{legend}</legend>

      <SelectField
        error={errors[`${field}.kind`]}
        id={id}
        label={fieldLabel("tests")}
        onChange={(event) => chooseKind(event.target.value)}
        value={kind}
      >
        {(optional || kind === "") && <option value="">{optional ? NO_CONDITION : "—"}</option>}
        {predicateKinds.map((choice) => (
          <option key={choice} value={choice}>
            {fieldLabel(choice)}
          </option>
        ))}
      </SelectField>

      {ops.length > 0 && (
        <SelectField
          id={`${id}-op`}
          label={OPERATOR_LABEL}
          onChange={(event) => onChange({ ...value, op: event.target.value })}
          value={typeof value.op === "string" ? value.op : ""}
        >
          {ops.map((choice) => (
            <option key={choice} value={choice}>
              {choice.replaceAll("_", " ")}
            </option>
          ))}
        </SelectField>
      )}

      {valueChoices.length > 0 && (
        <SelectField
          id={`${id}-value`}
          label={VALUE_LABEL}
          onChange={(event) => onChange({ ...value, value: event.target.value })}
          value={typeof value.value === "string" ? value.value : ""}
        >
          {valueChoices.map((choice) => (
            <option key={choice} value={choice}>
              {choice.toUpperCase()}
            </option>
          ))}
        </SelectField>
      )}

      {properties.includes("values") && valuesChoices.length > 0 && (
        <fieldset aria-describedby={describedBy([`${valuesId}-error`, valuesError !== undefined])} className="studio-inspector__group">
          <legend className="studio-inspector__label">{VALUES_LABEL}</legend>
          {valuesChoices.map((choice) => {
            const values = Array.isArray(value.values) ? value.values : [];
            const checked = values.includes(choice);
            return (
              <label className="studio-inspector__check" key={choice}>
                <input
                  checked={checked}
                  onChange={() =>
                    onChange({
                      ...value,
                      values: checked ? values.filter((entry) => entry !== choice) : [...values, choice],
                    })
                  }
                  type="checkbox"
                />
                {choice}
              </label>
            );
          })}
          <ErrorLine id={`${valuesId}-error`} message={valuesError} />
        </fieldset>
      )}

      {properties.includes("values") && valuesChoices.length === 0 && (
        <TextField
          error={valuesError}
          hint={LIST_HINT}
          id={valuesId}
          label={VALUES_LABEL}
          mono
          onChange={(event) => onChange({ ...value, values: [...splitList(event.target.value)] })}
          value={Array.isArray(value.values) ? value.values.join(", ") : ""}
        />
      )}

      {properties.includes("names") && (
        <TextField
          hint={CHECK_NAMES_HINT}
          id={`${id}-names`}
          label={fieldLabel("checks")}
          mono
          onChange={(event) => {
            const names = splitList(event.target.value);
            const { names: _dropped, ...rest } = value;
            void _dropped;
            onChange(names.length === 0 ? rest : { ...rest, names: [...names] });
          }}
          value={Array.isArray(value.names) ? value.names.join(", ") : ""}
        />
      )}
    </fieldset>
  );
}

/**
 * A terminal's form — the action, and the options that action takes, generated from the schema's
 * branch for it. Changing the action replaces the options with the new action's defaults, because
 * the options are closed per action and the old ones would be refused.
 *
 * @param props See {@link ConfigFormProps}.
 * @returns The form.
 */
export function TermForm(props: ConfigFormProps) {
  const { idPrefix, config, onChange, schema } = props;
  const actions = schemaChoices(propertySchema(schema, "action", schema), schema);
  const action = typeof config.action === "string" ? config.action : "";
  const options = propertySchema(branchSchema(schema, "action", action, schema), "options", schema);
  const fields = genericFields(options, schema);

  const chooseAction = (next: string) => {
    const nextOptions = propertySchema(branchSchema(schema, "action", next, schema), "options", schema);
    onChange({ ...config, action: next, options: generatedDefaults(genericFields(nextOptions, schema)) });
  };

  return (
    <>
      <SelectField
        id={`${idPrefix}-action`}
        label={fieldLabel("action")}
        onChange={(event) => chooseAction(event.target.value)}
        value={action}
      >
        {action === "" && <option value="">—</option>}
        {actions.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </SelectField>

      {fields.length === 0 ? (
        <p className="studio-inspector__note">{NO_OPTIONS_NOTE}</p>
      ) : (
        <GeneratedForm {...props} path={["options"]} root={schema} schema={options} />
      )}
    </>
  );
}
