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
  const predicateSchema = propertySchema(schema, "predicate", schema);
  const predicateKinds = schemaChoices(propertySchema(predicateSchema, "kind", schema), schema);
  const predicate = isRecord(config.predicate) ? config.predicate : {};
  const kind = typeof predicate.kind === "string" ? predicate.kind : "";
  const branch = branchSchema(predicateSchema, "kind", kind, schema);
  const ops = schemaChoices(propertySchema(branch, "op", schema), schema);
  const valueChoices = schemaChoices(propertySchema(branch, "value", schema), schema);
  const valuesChoices = schemaChoices(propertySchema(branch, "values", schema), schema);
  const properties = isRecord(branch.properties) ? Object.keys(branch.properties) : [];

  const setPredicate = (next: ConfigRecord) => onChange(withValue(config, ["predicate"], next));

  const choosePredicateKind = (next: string) => {
    const nextBranch = branchSchema(predicateSchema, "kind", next, schema);
    const nextOps = schemaChoices(propertySchema(nextBranch, "op", schema), schema);
    const nextValues = schemaChoices(propertySchema(nextBranch, "value", schema), schema);
    setPredicate({
      kind: next,
      ...(nextOps.length > 0 ? { op: nextOps[0] } : {}),
      ...(nextValues.length > 0 ? { value: nextValues[0] } : {}),
      ...(requiredProperties(nextBranch, schema).includes("values") ? { values: [] } : {}),
    });
  };

  const valuesId = `${idPrefix}-values`;

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

      <fieldset className="studio-inspector__group">
        <legend className="studio-inspector__section">{PREDICATE_LABEL}</legend>

        <SelectField
          error={errors["predicate.kind"]}
          id={`${idPrefix}-predicate`}
          label={fieldLabel("tests")}
          onChange={(event) => choosePredicateKind(event.target.value)}
          value={kind}
        >
          {kind === "" && <option value="">—</option>}
          {predicateKinds.map((choice) => (
            <option key={choice} value={choice}>
              {fieldLabel(choice)}
            </option>
          ))}
        </SelectField>

        {ops.length > 0 && (
          <SelectField
            id={`${idPrefix}-op`}
            label={OPERATOR_LABEL}
            onChange={(event) => setPredicate({ ...predicate, op: event.target.value })}
            value={typeof predicate.op === "string" ? predicate.op : ""}
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
            id={`${idPrefix}-value`}
            label={VALUE_LABEL}
            onChange={(event) => setPredicate({ ...predicate, value: event.target.value })}
            value={typeof predicate.value === "string" ? predicate.value : ""}
          >
            {valueChoices.map((choice) => (
              <option key={choice} value={choice}>
                {choice.toUpperCase()}
              </option>
            ))}
          </SelectField>
        )}

        {properties.includes("values") && valuesChoices.length > 0 && (
          <fieldset aria-describedby={describedBy([`${valuesId}-error`, errors["predicate.values"] !== undefined])} className="studio-inspector__group">
            <legend className="studio-inspector__label">{VALUES_LABEL}</legend>
            {valuesChoices.map((choice) => {
              const values = Array.isArray(predicate.values) ? predicate.values : [];
              const checked = values.includes(choice);
              return (
                <label className="studio-inspector__check" key={choice}>
                  <input
                    checked={checked}
                    onChange={() =>
                      setPredicate({
                        ...predicate,
                        values: checked ? values.filter((entry) => entry !== choice) : [...values, choice],
                      })
                    }
                    type="checkbox"
                  />
                  {choice}
                </label>
              );
            })}
            <ErrorLine id={`${valuesId}-error`} message={errors["predicate.values"]} />
          </fieldset>
        )}

        {properties.includes("values") && valuesChoices.length === 0 && (
          <TextField
            error={errors["predicate.values"]}
            hint={LIST_HINT}
            id={valuesId}
            label={VALUES_LABEL}
            mono
            onChange={(event) => setPredicate({ ...predicate, values: [...splitList(event.target.value)] })}
            value={Array.isArray(predicate.values) ? predicate.values.join(", ") : ""}
          />
        )}

        {properties.includes("names") && (
          <TextField
            hint={CHECK_NAMES_HINT}
            id={`${idPrefix}-names`}
            label={fieldLabel("checks")}
            mono
            onChange={(event) => {
              const names = splitList(event.target.value);
              const { names: _dropped, ...rest } = predicate;
              void _dropped;
              setPredicate(names.length === 0 ? rest : { ...rest, names: [...names] });
            }}
            value={Array.isArray(predicate.names) ? predicate.names.join(", ") : ""}
          />
        )}
      </fieldset>
    </>
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
