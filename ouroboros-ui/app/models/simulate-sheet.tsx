"use client";

import { type ChangeEvent, type FormEvent, useId, useState } from "react";

import { moneyOfCents } from "@/app/format";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, type ButtonSize, Chip, SelectField, TextField, cx } from "@/app/ui";

import type { Resolution, RoutingSimulationRequest } from "@/app/api/routing";

import { useRouteEditor } from "./route-editor";
import { DIFF_KINDS, DIFF_KIND_LABELS, EFFORT_LABELS, EFFORT_LEVELS } from "./rules";
import { simulateRoute } from "./simulate-actions";
import {
  CHAIN_HEADING,
  CLOSE,
  COST_HEADING,
  DECISION_WORD,
  DIFF_LABEL,
  EFFORT_LABEL,
  FLOOR_HEADING,
  LABELS_HINT,
  LABELS_LABEL,
  LOCAL_ALLOWED,
  LOCAL_HEADING,
  LOCAL_NOT_ALLOWED,
  NOT_CLASSIFIED,
  NOT_SIZED,
  NO_CAP,
  NO_RULES_MATCHED,
  RULES_HEADING,
  RUN_SIMULATION,
  SIMULATE_NOTE,
  SIMULATE_TITLE,
  SIMULATING,
  type SimulationDraft,
  type SimulationReading,
  TASK_KIND_LABEL,
  VOTES_HEADING,
  composeSimulation,
  hopResolution,
  initialSimulation,
  outcomeLabel,
  ruleWord,
  unsavedNote,
} from "./simulation";
import { simulateReason } from "./view";

import "./models.css";

/**
 * Mockup 06's **Simulate routing** — the head's action, the inspector's, and the sheet both
 * open ([#203](https://github.com/NobuData/ouroboros/issues/203)).
 *
 * The sheet is where this page earns trust or loses it. A simulator that printed a chain would
 * be a toy; what is useful is the reasoning — *this rule fired, this hop was dropped because
 * its provider is paused, this run would fail rather than cross your floor* — and Z.1
 * ([#194](https://github.com/NobuData/ouroboros/issues/194)) already composes exactly those
 * sentences. So this file **renders and never narrates**: every explanation on the panel is
 * the resolution's own string, and the only decisions made here are which inputs to offer and
 * how to lay the answer out. `app/models/simulation.ts` holds the former; this holds the
 * latter.
 *
 * ### One sheet, two doors
 *
 * The head's **Simulate routing** opens it on the matrix's first kind; the inspector's
 * **Simulate this route** opens it on the selected one. Both are {@link SimulateButton}, each
 * with a sheet of its own — the sheet is closed while the selection moves, and a second
 * instance is cheaper than a shared open-state threaded through the page.
 *
 * ### A `fail_run` is the answer, not an error
 *
 * The contract is emphatic and so is this panel: `outcome: "fail_run"` arrives as a `200`
 * with a reason, and it is drawn in the same place a resolved chain is drawn, under the same
 * heading, with the failure's own sentence as the first thing said — a designed outcome, the
 * one the floor switch exists to produce. Only a refusal — a kind with no route, a context the
 * service would not read — is drawn as a failure of the *question*, in the error hue.
 *
 * ### The answer is about the routes as saved
 *
 * The endpoint resolves what the server holds, and a run would too. A reader who has moved a
 * hop or flipped a switch and not yet saved is told so above the form, in one sentence,
 * rather than being left to wonder why the answer ignores the change on their screen.
 */

/** What the button takes. */
export interface SimulateButtonProps {
  /**
   * The workspace's task kinds, in the matrix's order — the task-kind select's options.
   *
   * Handed down rather than read, because the page already holds them; and their count is
   * what decides whether the button acts at all (`simulateReason`).
   */
  readonly taskKinds: readonly string[];
  /** The route to open on, or `null` for the matrix's first. */
  readonly kind?: string | null;
  /** The button's label. Defaults to the mockup's head action. */
  readonly label?: string;
  /** The button's size. */
  readonly size?: ButtonSize;
}

/**
 * The button, and the sheet it opens.
 *
 * @param props See {@link SimulateButtonProps}.
 * @returns The ghost button, and the sheet while it is open.
 */
export function SimulateButton({
  taskKinds,
  kind = null,
  label = SIMULATE_TITLE,
  size,
}: SimulateButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
        reason={simulateReason(taskKinds.length)}
        size={size}
        tone="ghost"
      >
        {label}
      </Button>

      <SimulateSheet
        kind={kind}
        onClose={() => {
          setOpen(false);
        }}
        open={open}
        taskKinds={taskKinds}
      />
    </>
  );
}

/** What the sheet takes. */
export interface SimulateSheetProps {
  /** The workspace's task kinds, in the matrix's order. */
  readonly taskKinds: readonly string[];
  /** The route to open on, or `null` for the matrix's first. */
  readonly kind: string | null;
  /** Whether it is open. */
  readonly open: boolean;
  /** Called on Escape, the backdrop, or the close button. */
  readonly onClose: () => void;
}

/**
 * One option's value, checked against the list the select was built from — the rule builder's
 * own guard, for the same reason: the draft's fields are unions, and a cast at every
 * `onChange` would be a promise the event cannot keep.
 *
 * @param list The values the select offers.
 * @param value What the event carried.
 * @returns The value, typed, or `""` for one not in the list — which is the unset option.
 */
function pick<T extends string>(list: readonly T[], value: string): T | "" {
  return (list as readonly string[]).includes(value) ? (value as T) : "";
}

/**
 * The sheet.
 *
 * @param props See {@link SimulateSheetProps}.
 * @returns The dialog while open; nothing otherwise.
 */
export function SimulateSheet({ taskKinds, kind, open, onClose }: SimulateSheetProps) {
  const editor = useRouteEditor();
  const [draft, setDraft] = useState<SimulationDraft>(() => initialSimulation(taskKinds, kind));
  const [answer, setAnswer] = useState<SimulationReading | null>(null);
  // Whether a question is on its way. Held as plain state rather than `useTransition`'s
  // flag, so the answer and the control's return land in one render, with nothing left to
  // wait on — the rule builder's flag guards a submit; this one is *drawn*.
  const [pending, setPending] = useState(false);
  const id = useId();

  /**
   * Ask, and draw what comes back.
   *
   * The last answer is cleared while the question travels: a stale chain under a new
   * question would be an answer to something the reader is no longer asking.
   *
   * @param request The question.
   */
  async function ask(request: RoutingSimulationRequest): Promise<void> {
    setPending(true);
    setAnswer(null);

    try {
      setAnswer(await simulateRoute(request));
    } finally {
      setPending(false);
    }
  }

  /**
   * Submit the form.
   *
   * @param event The form's submit.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (pending) return;

    void ask(composeSimulation(draft));
  }

  return (
    <ShellOverlay label={SIMULATE_TITLE} onClose={onClose} open={open}>
      <h2 className="shell-overlay__title">{SIMULATE_TITLE}</h2>
      <p className="shell-overlay__note">{SIMULATE_NOTE}</p>

      {editor.pending > 0 && (
        <p className="models-simulate__unsaved" role="status">
          {unsavedNote(editor.pending)}
        </p>
      )}

      <form className="models-simulate" onSubmit={submit}>
        <div className="models-simulate__fields">
          <SelectField
            id={`${id}-kind`}
            label={TASK_KIND_LABEL}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setDraft({ ...draft, taskKind: event.target.value });
            }}
            value={draft.taskKind}
          >
            {taskKinds.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </SelectField>

          <SelectField
            id={`${id}-effort`}
            label={EFFORT_LABEL}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setDraft({ ...draft, effort: pick(EFFORT_LEVELS, event.target.value) });
            }}
            value={draft.effort}
          >
            <option value="">{NOT_SIZED}</option>
            {EFFORT_LEVELS.map((level) => (
              <option key={level} value={level}>
                {EFFORT_LABELS[level]}
              </option>
            ))}
          </SelectField>

          <TextField
            hint={LABELS_HINT}
            id={`${id}-labels`}
            label={LABELS_LABEL}
            mono
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setDraft({ ...draft, labels: event.target.value });
            }}
            value={draft.labels}
          />

          <SelectField
            id={`${id}-diff`}
            label={DIFF_LABEL}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setDraft({ ...draft, diffKind: pick(DIFF_KINDS, event.target.value) });
            }}
            value={draft.diffKind}
          >
            <option value="">{NOT_CLASSIFIED}</option>
            {DIFF_KINDS.map((diff) => (
              <option key={diff} value={diff}>
                {DIFF_KIND_LABELS[diff]}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="models-simulate__actions">
          <Button reason={pending ? SIMULATING : undefined} tone="primary" type="submit">
            {pending ? SIMULATING : RUN_SIMULATION}
          </Button>
          <Button onClick={onClose} tone="ghost" type="button">
            {CLOSE}
          </Button>
        </div>
      </form>

      {answer !== null &&
        (answer.ok ? (
          <ResolutionView resolution={answer.resolution} />
        ) : (
          <p className="models-simulate__refused" role="alert">
            {answer.reason}
          </p>
        ))}
    </ShellOverlay>
  );
}

/**
 * The answer: the outcome, the chain with every hop's reason, the rules that matched, the
 * votes, and the policy the resolution ran under — every sentence the resolution's own.
 *
 * @param props.resolution The resolution.
 * @returns The answer.
 */
function ResolutionView({ resolution }: Readonly<{ resolution: Resolution }>) {
  const failed = resolution.outcome === "fail_run";
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={cx("models-simulate__answer", failed && "models-simulate__answer--failed")}
    >
      <h3 className="models-simulate__outcome" id={headingId}>
        <Chip dot="filled" tone={failed ? "err" : "ok"}>
          {outcomeLabel(resolution.outcome)}
        </Chip>
        <span className="models-simulate__tag">{resolution.routeTag}</span>
      </h3>

      {/*
        The reason the run fails, first and verbatim. `role="status"` rather than an alert:
        this is the answer the reader asked for, not an interruption — the whole point of the
        floor is that a run stops *and says so*, and this is where it says so.
      */}
      {resolution.failure !== null && (
        <p className="models-simulate__failure" role="status">
          {resolution.failure.explanation}
        </p>
      )}

      <h4 className="models-simulate__heading">{CHAIN_HEADING}</h4>
      <ol aria-label={CHAIN_HEADING} className="models-simulate__chain">
        {resolution.chain.map((hop) => {
          const dropped = hop.decision === "dropped";

          return (
            <li
              className={cx("models-simulate__hop", dropped && "models-simulate__hop--dropped")}
              key={hop.index}
            >
              <span aria-hidden className="models-simulate__idx">
                {hop.index}
              </span>
              <span className="models-simulate__hop-row">
                <Chip mono tone={dropped ? "neutral" : "model"}>
                  {hop.alias}
                </Chip>
                <span className="models-simulate__resolution">→ {hopResolution(hop)}</span>
                <span className="models-simulate__decision">{DECISION_WORD[hop.decision]}</span>
              </span>
              <span className="models-simulate__explanation">{hop.explanation}</span>
            </li>
          );
        })}
      </ol>

      <h4 className="models-simulate__heading">{RULES_HEADING}</h4>
      {resolution.rules.length === 0 ? (
        <p className="models-simulate__none">{NO_RULES_MATCHED}</p>
      ) : (
        <ul aria-label={RULES_HEADING} className="models-simulate__rules">
          {resolution.rules.map((rule) => (
            <li
              className={cx("models-simulate__rule", rule.applied && "models-simulate__rule--applied")}
              key={rule.id}
            >
              <span className="models-simulate__hop-row">
                <span className="models-simulate__sentence">{rule.display}</span>
                <Chip tone={rule.applied ? "ok" : "neutral"}>{ruleWord(rule.applied)}</Chip>
              </span>
              <span className="models-simulate__explanation">{rule.explanation}</span>
            </li>
          ))}
        </ul>
      )}

      {resolution.votes.length > 0 && (
        <>
          <h4 className="models-simulate__heading">{VOTES_HEADING}</h4>
          <ul aria-label={VOTES_HEADING} className="models-simulate__votes">
            {resolution.votes.map((vote) => (
              <li className="models-simulate__hop-row" key={`${vote.ruleId}:${vote.alias}`}>
                <Chip mono tone="model">
                  {vote.alias}
                </Chip>
                <span className="models-simulate__resolution">→ {hopResolution(vote)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <dl className="models-simulate__policy">
        <dt>{FLOOR_HEADING}</dt>
        <dd>{resolution.floor.explanation}</dd>
        <dt>{COST_HEADING}</dt>
        <dd className="models-simulate__figure">
          {resolution.maxCostCents === null ? NO_CAP : moneyOfCents(resolution.maxCostCents)}
        </dd>
        <dt>{LOCAL_HEADING}</dt>
        <dd>{resolution.allowLocalFallback ? LOCAL_ALLOWED : LOCAL_NOT_ALLOWED}</dd>
      </dl>
    </section>
  );
}
