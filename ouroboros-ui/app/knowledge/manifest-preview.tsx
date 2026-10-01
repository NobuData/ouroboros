"use client";

import { useId, useRef, useState, useTransition } from "react";

import type { ContextConsumer, ContextManifest } from "@/app/api/context";
import type { EnabledRepo } from "@/app/api/enablement";
import type { FactList } from "@/app/api/facts";
import type { Reading } from "@/app/api/reading";
import type { SkillList } from "@/app/api/skills";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Chip, SelectField, Tag } from "@/app/ui";

import { codeSpans } from "./facts";
import {
  ABSENT_HEADING,
  CONSUMERS,
  DEFAULT_CONSUMER,
  FACTS_HEADING,
  HASH_NOTE,
  NO_FACTS_RESOLVED,
  NO_WORKFLOW,
  ON_TRIGGER_TAG,
  OVER_BUDGET_NOTE,
  PREVIEW_ACTION,
  PREVIEW_CLOSE,
  PREVIEW_CONSUMER_LABEL,
  PREVIEW_LOADING,
  PREVIEW_NOTE,
  PREVIEW_NOTHING,
  PREVIEW_REPO_LABEL,
  PREVIEW_TITLE,
  PREVIEW_WORKFLOW_HINT,
  PREVIEW_WORKFLOW_LABEL,
  type PreviewView,
  REQUIRED_BADGE,
  SKILLS_HEADING,
  TRIMMED_HEADING,
  TRIM_POLICY,
  UNOVERRIDABLE_NOTE,
  WORKSPACE_WIDE,
  counting,
  isConsumer,
  previewAnnouncement,
  previewFailure,
  previewView,
  repoChoices,
  trimChip,
  workflowChoices,
} from "./preview";
import { previewContext } from "./preview-actions";

import "./knowledge.css";

/**
 * **Preview injection ▾** — the scope card's action, and the dialog that answers *exactly what
 * would be injected* (BG.5, [#421](https://github.com/NobuData/ouroboros/issues/421)).
 *
 * The decisions are `app/knowledge/preview.ts`'s; what is here is state and wiring:
 *
 * - **The manifest is the service's.** The read starts in the same press that opens the dialog
 *   (the ticket picker's rule, `run-on-issue.tsx`), on the scope the ladder calls current and the
 *   run-stage consumer; changing the repository, the workflow or the consumer asks again. Each
 *   answer is BF.5's manifest (#414), arranged and never recomputed.
 * - **The newest question wins.** A slow answer to an earlier choice is dropped rather than drawn
 *   over a later one, so what is on screen is always the manifest for the selects as they stand.
 * - **A change is heard.** One polite live region says what the manifest holds once it lands.
 *
 * Open to every reader: the preview writes nothing, so there is no role it is inert for.
 */

/** What the action is told. */
export interface ManifestPreviewProps {
  /** The workspace's skills as the page read them — what explains an absence. */
  readonly skills: Reading<SkillList>;
  /** The workspace's facts as the page read them — what names a trimmed fact. */
  readonly facts: Reading<FactList>;
  /** The enabled repositories — the repository select's choices. */
  readonly repos: Reading<readonly EnabledRepo[]>;
  /** The repository the dialog opens on, `owner/name` — the ladder's current scope; `null` for the whole workspace. */
  readonly repo: string | null;
}

/** What the dialog is showing. */
type PreviewState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "shown"; readonly manifest: ContextManifest };

/**
 * The action, and its dialog.
 *
 * @param props See {@link ManifestPreviewProps}.
 * @returns The button, with the dialog beside it while it is open.
 */
export function ManifestPreview({ skills, facts, repos, repo }: ManifestPreviewProps) {
  const ids = useId();
  /** The newest question's number: an answer to an older one is dropped. */
  const asked = useRef(0);

  const [open, setOpen] = useState(false);
  const [chosenRepo, setChosenRepo] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [consumer, setConsumer] = useState<ContextConsumer>(DEFAULT_CONSUMER);
  const [state, setState] = useState<PreviewState>({ kind: "loading" });
  const [, startTransition] = useTransition();

  /**
   * Ask the service for the manifest.
   *
   * @param forConsumer Who it is for.
   * @param forRepo The repository, or `""` for the whole workspace.
   * @param forWorkflow The workflow, or `""` for none.
   */
  function read(forConsumer: ContextConsumer, forRepo: string, forWorkflow: string): void {
    const question = (asked.current += 1);

    setState({ kind: "loading" });

    startTransition(async () => {
      const outcome = await previewContext(forConsumer, forRepo === "" ? null : forRepo, forWorkflow === "" ? null : forWorkflow);

      if (question !== asked.current) return;

      setState(
        outcome.ok
          ? { kind: "shown", manifest: outcome.value }
          : { kind: "failed", message: previewFailure(outcome.refusal) },
      );
    });
  }

  /** Open on the ladder's current scope and the run-stage consumer, and read in the same press. */
  function openPreview(): void {
    const opening = repo ?? "";

    setChosenRepo(opening);
    setWorkflow("");
    setConsumer(DEFAULT_CONSUMER);
    setOpen(true);
    read(DEFAULT_CONSUMER, opening, "");
  }

  /** Close, and drop whatever answer is still on its way. */
  function close(): void {
    asked.current += 1;
    setOpen(false);
  }

  const view = state.kind === "shown" ? previewView(state.manifest, skills, facts) : null;

  return (
    <>
      <Button onClick={openPreview} size="sm" tone="ghost">
        {PREVIEW_ACTION}
      </Button>

      <ShellOverlay label={PREVIEW_TITLE} onClose={close} open={open}>
        <h2 className="shell-overlay__title">{PREVIEW_TITLE}</h2>
        <p className="shell-overlay__note">{PREVIEW_NOTE}</p>

        <div className="knowledge-preview__choices">
          <SelectField
            id={`${ids}-repo`}
            label={PREVIEW_REPO_LABEL}
            onChange={(event) => {
              setChosenRepo(event.currentTarget.value);
              read(consumer, event.currentTarget.value, workflow);
            }}
            value={chosenRepo}
          >
            <option value="">{WORKSPACE_WIDE}</option>
            {repoChoices(repos).map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </SelectField>
          <SelectField
            hint={PREVIEW_WORKFLOW_HINT}
            id={`${ids}-workflow`}
            label={PREVIEW_WORKFLOW_LABEL}
            onChange={(event) => {
              setWorkflow(event.currentTarget.value);
              read(consumer, chosenRepo, event.currentTarget.value);
            }}
            value={workflow}
          >
            <option value="">{NO_WORKFLOW}</option>
            {workflowChoices(skills).map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </SelectField>
          <SelectField
            id={`${ids}-consumer`}
            label={PREVIEW_CONSUMER_LABEL}
            onChange={(event) => {
              const chosen = event.currentTarget.value;
              if (!isConsumer(chosen)) return;

              setConsumer(chosen);
              read(chosen, chosenRepo, workflow);
            }}
            value={consumer}
          >
            {CONSUMERS.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </SelectField>
        </div>

        {state.kind === "loading" && (
          <p className="knowledge-preview__state" role="status">
            {PREVIEW_LOADING}
          </p>
        )}
        {state.kind === "failed" && (
          <p className="knowledge-preview__refusal" role="alert">
            {state.message}
          </p>
        )}
        {view !== null && <Manifest view={view} />}

        {/* One live region for the dialog: what the manifest holds, once it lands. */}
        <p aria-live="polite" className="sr-only">
          {view === null ? "" : previewAnnouncement(view)}
        </p>

        <div className="knowledge-preview__actions">
          <Button onClick={close} tone="ghost" type="button">
            {PREVIEW_CLOSE}
          </Button>
        </div>
      </ShellOverlay>
    </>
  );
}

/**
 * One manifest, arranged: the estimate, the skills, the facts, the trims and the absences.
 *
 * @param props.view The view, as `previewView` arranged it.
 * @returns The sections.
 */
function Manifest({ view }: Readonly<{ view: PreviewView }>) {
  const ids = useId();
  const trim = trimChip(view);

  return (
    <div className="knowledge-preview__manifest">
      <p className="knowledge-preview__summary">
        <span className="knowledge-preview__budget">{view.budget}</span>
        {trim !== null && <Chip tone="warn">{trim}</Chip>}
        <span className="knowledge-preview__hash" title={HASH_NOTE}>
          {view.hash}
        </span>
      </p>
      {view.overBudget && <p className="knowledge-preview__over">{OVER_BUDGET_NOTE}</p>}
      {view.nothing && <p className="knowledge-preview__state">{PREVIEW_NOTHING}</p>}

      <section aria-labelledby={`${ids}-skills`} className="knowledge-preview__section">
        <h3 className="knowledge-preview__heading" id={`${ids}-skills`}>
          {counting(SKILLS_HEADING, view.skills.length)}
        </h3>
        {view.skillsEmpty !== null ? (
          <p className="knowledge-preview__empty">{view.skillsEmpty}</p>
        ) : (
          <ul className="knowledge-preview__list">
            {view.skills.map((skill) => (
              <li className="knowledge-preview__row" key={skill.key}>
                <span className="knowledge-preview__entry">
                  <span className="knowledge-preview__slug">{skill.label}</span>
                  {skill.required && (
                    <Chip title={UNOVERRIDABLE_NOTE} tone="warn">
                      {REQUIRED_BADGE}
                      <span className="sr-only"> — {UNOVERRIDABLE_NOTE}</span>
                    </Chip>
                  )}
                  <Tag>{skill.scope}</Tag>
                  {skill.trigger !== null && (
                    <Tag title={skill.trigger}>
                      {ON_TRIGGER_TAG}
                      <span className="sr-only"> — {skill.trigger}</span>
                    </Tag>
                  )}
                </span>
                <span className="knowledge-preview__tokens">{skill.tokens}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${ids}-facts`} className="knowledge-preview__section">
        <h3 className="knowledge-preview__heading" id={`${ids}-facts`}>
          {counting(FACTS_HEADING, view.facts.length)}
        </h3>
        {view.facts.length === 0 ? (
          <p className="knowledge-preview__empty">{NO_FACTS_RESOLVED}</p>
        ) : (
          <ul className="knowledge-preview__list">
            {view.facts.map((fact) => (
              <li className="knowledge-preview__row" key={fact.key}>
                <span className="knowledge-preview__entry">
                  <span className="knowledge-preview__fact">
                    {codeSpans(fact.text).map((part, index) =>
                      part.kind === "code" ? <code key={index}>{part.value}</code> : <span key={index}>{part.value}</span>,
                    )}
                  </span>
                  <Tag>{fact.scope}</Tag>
                </span>
                <span className="knowledge-preview__tokens">{fact.tokens}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {view.trimmed.length > 0 && (
        <section aria-labelledby={`${ids}-trimmed`} className="knowledge-preview__section knowledge-preview__section--trimmed">
          <h3 className="knowledge-preview__heading" id={`${ids}-trimmed`}>
            {counting(TRIMMED_HEADING, view.trimmed.length)}
          </h3>
          <p className="knowledge-preview__policy">{TRIM_POLICY}</p>
          <ul className="knowledge-preview__list">
            {view.trimmed.map((entry) => (
              <li className="knowledge-preview__row" key={entry.key}>
                <span className="knowledge-preview__entry">
                  {entry.slug ? (
                    <span className="knowledge-preview__slug">{entry.name}</span>
                  ) : (
                    <span className="knowledge-preview__fact">{entry.name}</span>
                  )}
                  <span className="knowledge-preview__why">
                    ({entry.tier}) — {entry.why}
                  </span>
                </span>
                <span className="knowledge-preview__tokens">{entry.tokens}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(view.absent.length > 0 || view.absentNote !== null) && (
        <section aria-labelledby={`${ids}-absent`} className="knowledge-preview__section">
          <h3 className="knowledge-preview__heading" id={`${ids}-absent`}>
            {counting(ABSENT_HEADING, view.absent.length)}
          </h3>
          {view.absentNote !== null && <p className="knowledge-preview__empty">{view.absentNote}</p>}
          {view.absent.length > 0 && (
            <ul className="knowledge-preview__list">
              {view.absent.map((entry) => (
                <li className="knowledge-preview__row" key={entry.key}>
                  <span className="knowledge-preview__entry">
                    <span className="knowledge-preview__slug knowledge-preview__slug--absent">{entry.slug}</span>
                    <Tag>{entry.scope}</Tag>
                    <span className="knowledge-preview__why">{entry.why}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
