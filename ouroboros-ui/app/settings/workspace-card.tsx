"use client";

import { type ReactNode, useId, useState } from "react";

import type { RetentionSettings, WorkspaceSettings } from "@/app/api/settings-workspace";
import { Card, CardHead, SelectField, Tag, TextField, cx } from "@/app/ui";

import { useSettingsAccess, useSettingsSection } from "./save-provider";
import { SectionMarks } from "./settings-seat";
import { sectionTitleId, settingsSection } from "./view";
import {
  ADVANCED_LABEL,
  CLASS_LABELS,
  CORE_CLASSES,
  type CoreClass,
  DOMAIN_LABEL,
  FIELD_LABELS,
  NAME_LABEL,
  NO_DOMAIN,
  PER_CLASS_OPTION,
  REGION_LABEL,
  RESIDENCY_LINK,
  RETENTION_HINT,
  RETENTION_LABEL,
  SSO_ENFORCED_TAG,
  TRAINING_LABEL,
  type FieldEdits,
  type WorkspaceCardValues,
  classEdit,
  classHint,
  daysLabel,
  domainChangeNote,
  effectiveTiers,
  loopDayOptions,
  loopDaysEdit,
  reasonSentence,
  regionReason,
  selectValue,
  sweepNote,
  tierOf,
  trainingSentence,
  validateWorkspace,
  workspaceBaseline,
  workspacePatches,
} from "./workspace";
import { saveWorkspaceCard } from "./workspace-actions";

import "./settings.css";

/**
 * The Workspace card — mockup 17's `c-5` card, in its deployment-truth variants
 * (BS.2, [#492](https://github.com/NobuData/ouroboros/issues/492), decision **S6**).
 *
 * Name, tenant domain, data region, data retention (the select and the advanced per-class
 * editor) and the training-data row. The rules are `app/settings/workspace.ts`'s; this draws
 * them.
 *
 * ### Nothing on it is a dead control
 *
 * A field the reader may change is an input that joins the page's dirty batch. A field they may
 * not — because of their role, or because it describes this deployment rather than a setting of
 * it — is its value as text, with the sentence that says why. So on a self-hosted install the
 * region is a sentence with a link to the security model, not a dropdown, and training data is
 * *"Off — this deployment never trains on your data"*, not a locked switch with a plan's name on
 * it.
 *
 * ### Saving
 *
 * Name, domain and every tier batch through **Save changes** as one section; the write is
 * `saveWorkspaceCard`, which sends the workspace and retention requests in order. The domain says
 * what changing it does as soon as it is changed, before anything is sent, and the retention
 * select says that saving deletes nothing and when the next sweep applies the change.
 *
 * @param props.settings The workspace card as read.
 * @param props.retention The retention tiers as read.
 * @param props.readAt When the page was read — what the sweep times are measured from.
 * @returns The card.
 */
export function WorkspaceCard({
  settings,
  retention,
  readAt,
}: Readonly<{ settings: WorkspaceSettings; retention: RetentionSettings; readAt: string }>) {
  const section = settingsSection("workspace");
  const titleId = sectionTitleId(section.id);
  const base = useId();
  const access = useSettingsAccess();
  const now = Date.parse(readAt);

  const baseline = workspaceBaseline(settings, retention);
  const fields = useSettingsSection<WorkspaceCardValues>({
    baseline,
    labels: FIELD_LABELS,
    validate: (draft) => validateWorkspace(draft, baseline, retention),
    commit: (_changes, draft) => saveWorkspaceCard(workspacePatches(draft, baseline)),
  });
  const { values } = fields;

  /** Whether the reader may operate a field the payload calls `editable`. */
  const operable = (editable: boolean): boolean => editable && access.mayEdit;
  const nameOperable = operable(settings.name.editable);
  const domainOperable = operable(settings.domain.editable);
  const retentionOperable = operable(retention.editable);

  /**
   * Set several fields at once — one control that moves more than one tier.
   *
   * @param edits The fields and their values.
   */
  function apply(edits: FieldEdits): void {
    for (const [field, value] of Object.entries(edits) as [keyof WorkspaceCardValues, string][]) {
      fields.set(field, value);
    }
  }

  const tiers = effectiveTiers(values, baseline);
  const shared = selectValue(tiers);
  const loopTier = tierOf(retention, "transcripts");
  const options = loopDayOptions(
    [baseline.loopDays, shared],
    loopTier?.floor ?? 7,
    loopTier?.ceiling ?? 365,
  );
  const sso = settings.domain.tags.includes("sso_enforced");
  const domainDirty = fields.isDirty("domain");

  /** An advanced field holding an error opens the editor, so focus can reach it. */
  const advancedError = CORE_CLASSES.some((dataClass) => fields.error(dataClass) !== undefined);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <Card aria-labelledby={titleId} as="section">
      <CardHead beside={<SectionMarks />} title={section.title} titleId={titleId} />

      <div className="settings-workspace">
        {nameOperable ? (
          <TextField
            error={fields.error("name")}
            id={fields.id("name")}
            label={NAME_LABEL}
            mono
            onChange={(event) => {
              fields.set("name", event.target.value);
            }}
            readOnly={!fields.editable}
            value={values.name}
          />
        ) : (
          <Fact id={`${base}-name`} label={NAME_LABEL} mono reason={reasonSentence(settings.name.reason)}>
            {settings.name.value}
          </Fact>
        )}

        {domainOperable ? (
          <div className="settings-workspace__domain">
            <TextField
              error={fields.error("domain")}
              hint={settings.domain.consequence}
              id={fields.id("domain")}
              label={
                <>
                  {DOMAIN_LABEL} {sso && <Tag>{SSO_ENFORCED_TAG}</Tag>}
                </>
              }
              mono
              onChange={(event) => {
                fields.set("domain", event.target.value);
              }}
              readOnly={!fields.editable}
              value={values.domain}
            />
            {domainDirty && (
              <p className="settings-workspace__consequence" role="note">
                {domainChangeNote(settings.domain.consequence, baseline.domain, values.domain)}
              </p>
            )}
          </div>
        ) : (
          <Fact
            beside={sso ? <Tag>{SSO_ENFORCED_TAG}</Tag> : undefined}
            id={`${base}-domain`}
            label={DOMAIN_LABEL}
            mono
            reason={reasonSentence(settings.domain.reason)}
          >
            {settings.domain.value ?? NO_DOMAIN}
          </Fact>
        )}

        <Fact
          id={`${base}-region`}
          label={REGION_LABEL}
          reason={
            <>
              {regionReason(settings.region.source)}{" "}
              <a
                className="settings-workspace__link"
                href={settings.region.docsUrl}
                rel="noreferrer"
                target="_blank"
              >
                {RESIDENCY_LINK}
              </a>
            </>
          }
        >
          {settings.region.label}
        </Fact>

        <div className="settings-workspace__retention">
          {retentionOperable ? (
            <SelectField
              error={fields.error("loopDays")}
              hint={RETENTION_HINT}
              id={fields.id("loopDays")}
              label={RETENTION_LABEL}
              disabled={!fields.editable}
              onChange={(event) => {
                apply(loopDaysEdit(event.target.value, baseline));
              }}
              value={shared}
            >
              {shared === "" && <option value="">{PER_CLASS_OPTION}</option>}
              {options.map((days) => (
                <option key={days} value={String(days)}>
                  {daysLabel(days)}
                </option>
              ))}
            </SelectField>
          ) : (
            <Fact
              id={`${base}-retention`}
              label={RETENTION_LABEL}
              reason={`${RETENTION_HINT}. ${reasonSentence(retention.reason)}`}
            >
              {shared === "" ? PER_CLASS_OPTION : daysLabel(shared)}
            </Fact>
          )}

          <p className="settings-workspace__note" role="note">
            {sweepNote(retention, now)}
          </p>

          <details
            className="settings-workspace__advanced"
            onToggle={(event) => {
              setAdvancedOpen(event.currentTarget.open);
            }}
            open={advancedOpen || advancedError}
          >
            <summary className="settings-workspace__summary">{ADVANCED_LABEL}</summary>
            <div className="settings-workspace__classes">
              {CORE_CLASSES.map((dataClass) => (
                <ClassTier
                  dataClass={dataClass}
                  error={fields.error(dataClass)}
                  id={retentionOperable ? fields.id(dataClass) : `${base}-${dataClass}`}
                  key={dataClass}
                  now={now}
                  onChange={(value) => {
                    apply(classEdit(dataClass, value, values, baseline));
                  }}
                  operable={retentionOperable}
                  readOnly={!fields.editable}
                  reason={reasonSentence(retention.reason)}
                  retention={retention}
                  value={tiers[dataClass]}
                />
              ))}
            </div>
          </details>
        </div>

        <Fact className="settings-workspace__training" id={`${base}-training`} label={TRAINING_LABEL}>
          {trainingSentence(settings.trainingData)}
        </Fact>

        {fields.refusal !== null && (
          <p className="settings-workspace__refusal" role="note">
            {fields.refusal}
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * One class in the advanced editor: an input within its bounds, or — for a reader who may not
 * change it — the value and why not.
 *
 * @param props.dataClass The class.
 * @param props.value Its days as they stand.
 * @param props.retention The tiers as read, for the class's bounds and sweep.
 * @param props.operable Whether the reader may change it.
 * @param props.readOnly Whether the input is inert for now (a save is in flight).
 * @param props.reason Why it cannot be changed, for a reader who may not.
 * @param props.error What the last save or check found wrong with it.
 * @param props.id The control's id.
 * @param props.now When the page was read, in ms.
 * @param props.onChange Called with the new days, as typed.
 * @returns The row, or nothing for a class the service did not list.
 */
function ClassTier({
  dataClass,
  value,
  retention,
  operable,
  readOnly,
  reason,
  error,
  id,
  now,
  onChange,
}: Readonly<{
  dataClass: CoreClass;
  value: string;
  retention: RetentionSettings;
  operable: boolean;
  readOnly: boolean;
  reason: string;
  error: string | undefined;
  id: string;
  now: number;
  onChange: (value: string) => void;
}>) {
  const tier = tierOf(retention, dataClass);
  if (tier === undefined) return null;

  const hint = classHint(tier, now);

  if (!operable) {
    return (
      <Fact id={id} label={CLASS_LABELS[dataClass]} reason={`${hint} ${reason}`}>
        {daysLabel(value)}
      </Fact>
    );
  }

  return (
    <TextField
      error={error}
      hint={hint}
      id={id}
      inputMode="numeric"
      label={`${CLASS_LABELS[dataClass]} (days)`}
      max={tier.ceiling}
      min={tier.floor}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      readOnly={readOnly}
      step={1}
      type="number"
      value={value}
    />
  );
}

/**
 * A value the reader cannot change, as text — the field's anatomy (label, value, hint) with the
 * reason where an input's hint would be.
 *
 * @param props.id The value's id; the label and reason derive theirs from it.
 * @param props.label What the value is.
 * @param props.children The value.
 * @param props.reason Why it cannot be changed here. Omitted only where the value itself says
 *   so — the training row's sentence is its own reason.
 * @param props.beside A tag beside the value.
 * @param props.mono Whether it is read character by character.
 * @param props.className Placement.
 * @returns The row.
 */
function Fact({
  id,
  label,
  children,
  reason,
  beside,
  mono = false,
  className,
}: Readonly<{
  id: string;
  label: string;
  children: ReactNode;
  reason?: ReactNode;
  beside?: ReactNode;
  mono?: boolean;
  className?: string;
}>) {
  return (
    <div className={cx("ou-field", "settings-workspace__fact", className)}>
      <span className="ou-field__label" id={`${id}-label`}>
        {label}
      </span>
      <p
        aria-describedby={reason === undefined ? undefined : `${id}-reason`}
        aria-labelledby={`${id}-label`}
        className="settings-workspace__value"
        id={id}
      >
        <span className={mono ? "settings-workspace__mono" : undefined}>{children}</span>
        {beside}
      </p>
      {reason !== undefined && (
        <p className="ou-field__hint" id={`${id}-reason`}>
          {reason}
        </p>
      )}
    </div>
  );
}
