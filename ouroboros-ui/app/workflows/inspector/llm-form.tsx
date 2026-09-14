"use client";

import type { Reading } from "@/app/api/reading";
import type { RoutingTaskKind } from "@/app/api/routing";
import { Chip, SelectField, TextField, cx } from "@/app/ui";

import { ErrorLine, Segmented, ToggleRow, WarningLine, describedBy } from "./controls";
import {
  ALIAS_LABEL,
  BUDGET_HINT,
  BUDGET_LABEL,
  type ConfigRecord,
  DECLARED_NOTE,
  type FieldMessages,
  type JsonSchema,
  type KnownNames,
  LIMITS_LABEL,
  MODE_LABEL,
  MODE_WORDS,
  NO_ROUTE_NOTE,
  PERMISSIONS_LABEL,
  PERMISSION_WORDS,
  PIN_LABEL,
  PROMPT_LABEL,
  type PaletteVariables,
  RECOMMENDED,
  RETRIES_LABEL,
  ROUTES_UNREAD_NOTE,
  ROUTING_FIELD,
  ROUTING_LABEL,
  SKILL_HINT,
  SKILL_LABEL,
  TASK_LABEL,
  fieldLabel,
  inheritLabel,
  inheritedModel,
  isRecord,
  parseTokenBudget,
  propertySchema,
  readValue,
  schemaBounds,
  schemaChoices,
  withValue,
} from "./inspector";
import { PromptEditor } from "./prompt-editor";

/** What the model-stage form takes. */
export interface LlmFormProps {
  /** The prefix every control's id is built from. */
  readonly idPrefix: string;
  /** The stage's id — the task a new inherited route defaults to. */
  readonly stageId: string;
  /** The draft config. */
  readonly config: ConfigRecord;
  /** Told the new draft config. */
  readonly onChange: (config: ConfigRecord) => void;
  /** The `llm` config schema, with its `$defs`. */
  readonly schema: JsonSchema;
  /** What the workspace lists. */
  readonly known: KnownNames;
  /** The routing matrix's task kinds, or `null` when they were not read. */
  readonly routes: Reading<readonly RoutingTaskKind[]> | null;
  /** The token-budget field's text. */
  readonly budget: string;
  /** Told the token-budget field's new text. */
  readonly onBudget: (text: string) => void;
  /** What the palette offers. */
  readonly variables: PaletteVariables;
  /** What stops the draft from being applied. */
  readonly errors: FieldMessages;
  /** Names the workspace does not list. */
  readonly warnings: FieldMessages;
  /** Why the reader may not edit, or `undefined` when they may. */
  readonly readOnlyReason: string | undefined;
}

/**
 * The mockup's model-stage panel — **Mode**, **Skill**, **Prompt template**, **Model routing**,
 * **Limits** and **Permissions**, in its order (S.4,
 * [#150](https://github.com/NobuData/ouroboros/issues/150)).
 *
 * The choices and bounds are the catalog schema's: the mode segment offers the schema's `mode`
 * enum, the routing radios are its `oneOf`, and the limits' ranges are its `minimum`/`maximum`.
 * The skill and task fields accept any name and *suggest* the workspace's (decision **P7**).
 *
 * @param props See {@link LlmFormProps}.
 * @returns The form.
 */
export function LlmForm(props: LlmFormProps) {
  const { idPrefix, config, onChange, schema, errors, readOnlyReason } = props;
  const mode = typeof config.mode === "string" ? config.mode : "";
  const modes = schemaChoices(propertySchema(schema, "mode", schema), schema);

  const setMode = (next: string) => {
    // A direct prompt names no skill — the schema forbids one — so switching drops it; switching
    // back starts from the first suggestion.
    const base = next === "skill" ? withValue(config, ["skill"], config.skill ?? props.known.skills[0] ?? "") : withValue(config, ["skill"], undefined);
    onChange(withValue(base, ["mode"], next));
  };

  return (
    <>
      <Segmented
        legend={MODE_LABEL}
        name={`${idPrefix}-mode`}
        onChange={setMode}
        options={modes.map((value) => ({ value, label: MODE_WORDS[value] ?? fieldLabel(value) }))}
        value={mode}
      />

      {mode === "skill" && <SkillField {...props} />}

      <PromptEditor
        disabled={readOnlyReason !== undefined}
        error={errors.prompt_template}
        id={`${idPrefix}-prompt`}
        label={PROMPT_LABEL}
        onChange={(text) => onChange(withValue(config, ["prompt_template"], text))}
        value={typeof config.prompt_template === "string" ? config.prompt_template : ""}
        variables={props.variables}
      />

      <Routing {...props} />
      <Limits {...props} />
      <Permissions {...props} />
    </>
  );
}

/**
 * The skill field: any name, the workspace's suggested.
 *
 * @param props See {@link LlmFormProps}.
 * @returns The field and its warning.
 */
function SkillField({ idPrefix, config, onChange, known, errors, warnings }: LlmFormProps) {
  const id = `${idPrefix}-skill`;
  const listId = `${id}-suggestions`;
  const warningId = `${id}-warning`;

  return (
    <div className="studio-inspector__field">
      <TextField
        aria-describedby={describedBy([warningId, warnings.skill !== undefined])}
        autoComplete="off"
        error={errors.skill}
        hint={SKILL_HINT}
        id={id}
        label={SKILL_LABEL}
        list={listId}
        mono
        onChange={(event) => onChange(withValue(config, ["skill"], event.target.value))}
        value={typeof config.skill === "string" ? config.skill : ""}
      />
      <datalist id={listId}>
        {known.skills.map((skill) => (
          <option key={skill} value={skill} />
        ))}
      </datalist>
      <WarningLine id={warningId} message={warnings.skill} />
    </div>
  );
}

/**
 * The mockup's two routing radios: inherit the route for a task, or pin a registry alias.
 *
 * @param props See {@link LlmFormProps}.
 * @returns The section.
 */
function Routing({ idPrefix, stageId, config, onChange, known, routes, errors, warnings }: LlmFormProps) {
  const routing = isRecord(config.routing) ? config.routing : {};
  const task = typeof routing.inherit_task === "string" ? routing.inherit_task : null;
  const alias = isRecord(routing.pinned_model) && typeof routing.pinned_model.alias === "string"
    ? routing.pinned_model.alias
    : null;
  const inherit = task !== null;
  const pinned = !inherit && alias !== null;
  const name = `${idPrefix}-routing`;
  const errorId = `${name}-error`;
  const warningId = `${name}-warning`;
  const description = describedBy(
    [errorId, errors[ROUTING_FIELD] !== undefined],
    [warningId, warnings[ROUTING_FIELD] !== undefined],
  );

  const chooseInherit = () => {
    const suggested = known.taskRoutes.includes(stageId) ? stageId : (known.taskRoutes[0] ?? stageId);
    onChange(withValue(config, ["routing"], { inherit_task: suggested }));
  };
  const choosePin = () => {
    onChange(withValue(config, ["routing"], { pinned_model: { alias: known.aliases?.[0] ?? "" } }));
  };

  const model = task === null || routes === null || !routes.ok ? null : inheritedModel(routes.value, task);

  return (
    <fieldset aria-describedby={description} className="studio-inspector__group">
      <legend className="studio-inspector__section">{ROUTING_LABEL}</legend>

      <div className={cx("studio-inspector__radio-row", inherit && "studio-inspector__radio-row--checked")}>
        <input
          checked={inherit}
          className="studio-inspector__radio"
          id={`${name}-inherit`}
          name={name}
          onChange={chooseInherit}
          type="radio"
        />
        <div className="studio-inspector__radio-body">
          <label className="studio-inspector__radio-label" htmlFor={`${name}-inherit`}>
            {inheritLabel(task ?? stageId)} <span className="studio-inspector__faint">{RECOMMENDED}</span>
          </label>
          {inherit && (
            <>
              <TextField
                autoComplete="off"
                id={`${name}-task`}
                label={TASK_LABEL}
                list={`${name}-tasks`}
                mono
                onChange={(event) => onChange(withValue(config, ["routing"], { inherit_task: event.target.value }))}
                value={task}
              />
              <datalist id={`${name}-tasks`}>
                {known.taskRoutes.map((route) => (
                  <option key={route} value={route} />
                ))}
              </datalist>
              {routes !== null && !routes.ok ? (
                <p className="studio-inspector__note">{ROUTES_UNREAD_NOTE}</p>
              ) : model === null ? (
                <p className="studio-inspector__note">{NO_ROUTE_NOTE}</p>
              ) : (
                <span className="studio-inspector__model">
                  <Chip mono tone="model">
                    {model}
                  </Chip>
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <div className={cx("studio-inspector__radio-row", pinned && "studio-inspector__radio-row--checked")}>
        <input
          checked={pinned}
          className="studio-inspector__radio"
          id={`${name}-pin`}
          name={name}
          onChange={choosePin}
          type="radio"
        />
        <div className="studio-inspector__radio-body">
          <label className="studio-inspector__radio-label" htmlFor={`${name}-pin`}>
            {PIN_LABEL}
          </label>
          {pinned && (
            <AliasField
              alias={alias}
              aliases={known.aliases}
              id={`${name}-alias`}
              onChange={(next) => onChange(withValue(config, ["routing"], { pinned_model: { alias: next } }))}
            />
          )}
        </div>
      </div>

      <ErrorLine id={errorId} message={errors[ROUTING_FIELD]} />
      <WarningLine id={warningId} message={warnings[ROUTING_FIELD]} />
    </fieldset>
  );
}

/**
 * The pinned alias: a select over the registry when it was read — with the stored alias kept as an
 * option even when the registry does not list it, so opening a stage never silently changes it —
 * and a text field when it was not.
 *
 * @param props.id The control's id.
 * @param props.alias The pinned alias.
 * @param props.aliases The registry's aliases, or `null` when they were not read.
 * @param props.onChange Told the new alias.
 * @returns The field.
 */
function AliasField({
  id,
  alias,
  aliases,
  onChange,
}: Readonly<{ id: string; alias: string; aliases: readonly string[] | null; onChange: (alias: string) => void }>) {
  if (aliases === null) {
    return (
      <TextField id={id} label={ALIAS_LABEL} mono onChange={(event) => onChange(event.target.value)} value={alias} />
    );
  }

  const options = aliases.includes(alias) || alias === "" ? aliases : [alias, ...aliases];

  return (
    <SelectField id={id} label={ALIAS_LABEL} onChange={(event) => onChange(event.target.value)} value={alias}>
      {alias === "" && <option value="">—</option>}
      {options.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </SelectField>
  );
}

/**
 * The mockup's `.num-row`: max retries and the token budget, which accepts `400k`.
 *
 * @param props See {@link LlmFormProps}.
 * @returns The section.
 */
function Limits({ idPrefix, config, onChange, schema, budget, onBudget, errors }: LlmFormProps) {
  const limits = propertySchema(schema, "limits", schema);
  const retries = schemaBounds(propertySchema(limits, "max_retries", schema), schema);
  const stored = readValue(config, ["limits", "max_retries"]);

  return (
    <div className="studio-inspector__block">
      <p className="studio-inspector__section">{LIMITS_LABEL}</p>
      <div className="studio-inspector__pair">
        <TextField
          error={errors["limits.max_retries"]}
          id={`${idPrefix}-retries`}
          inputMode="numeric"
          label={RETRIES_LABEL}
          max={retries.maximum ?? undefined}
          min={retries.minimum ?? undefined}
          mono
          onChange={(event) => {
            const text = event.target.value.trim();
            onChange(withValue(config, ["limits", "max_retries"], /^\d+$/.test(text) ? Number(text) : text));
          }}
          type="number"
          value={typeof stored === "number" || typeof stored === "string" ? String(stored) : ""}
        />
        <TextField
          error={errors["limits.token_budget"]}
          hint={BUDGET_HINT}
          id={`${idPrefix}-budget`}
          label={BUDGET_LABEL}
          mono
          onChange={(event) => {
            onBudget(event.target.value);
            const parsed = parseTokenBudget(event.target.value);
            if (parsed !== null) onChange(withValue(config, ["limits", "token_budget"], parsed));
          }}
          value={budget}
        />
      </div>
    </div>
  );
}

/**
 * The permission toggles, and decision **P9**'s note that they are declarations.
 *
 * @param props See {@link LlmFormProps}.
 * @returns The section.
 */
function Permissions({ idPrefix, config, onChange, schema, readOnlyReason }: LlmFormProps) {
  const properties = propertySchema(schema, "permissions", schema).properties;
  const names = isRecord(properties) ? Object.keys(properties) : [];
  const noteId = `${idPrefix}-declared`;

  return (
    <div className="studio-inspector__block">
      <p className="studio-inspector__section">{PERMISSIONS_LABEL}</p>
      {names.map((name) => {
        const checked = readValue(config, ["permissions", name]) === true;
        return (
          <ToggleRow
            checked={checked}
            describedBy={noteId}
            key={name}
            label={PERMISSION_WORDS[name] ?? fieldLabel(name)}
            onToggle={() => onChange(withValue(config, ["permissions", name], !checked))}
            reason={readOnlyReason}
          />
        );
      })}
      <p className="studio-inspector__declared" id={noteId}>
        <span aria-hidden="true">ⓘ </span>
        {DECLARED_NOTE}
      </p>
    </div>
  );
}
