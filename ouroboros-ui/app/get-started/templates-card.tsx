"use client";

import Link from "next/link";
import { useId, useState } from "react";

import type {
  OnboardingInstantiatedWorkflow,
  OnboardingStep,
  OnboardingTemplateSelection,
  OnboardingTemplateTile,
  OnboardingTemplateTiles,
} from "@/app/api/onboarding";
import type { Reading } from "@/app/api/reading";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { Card, CardHead, Chip, EffortChip, Tag } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import { selectTemplate } from "./actions";
import { ReselectDialog } from "./reselect-dialog";
import {
  type TemplatesPollOptions,
  createTemplatesPoll,
  templatesEndpoint,
} from "./templates-poll";
import {
  ADMIN_REASON,
  FOOTER_AFTER,
  FOOTER_BEFORE,
  FOOTER_LINK,
  GRID_LABEL,
  INVALID_NOTHING_CREATED,
  NO_TEMPLATES,
  OPEN_IN_STUDIO,
  SELECTED_MARK,
  SELECTING,
  STUDIO_LINK,
  TEMPLATES_TITLE,
  TILE_STUDIO_LINK,
  type TemplateFinding,
  captionOf,
  effortOf,
  findingLine,
  invalidLine,
  isLocked,
  lockedReason,
  previousWorkflow,
  stagesSentence,
  stepPill,
  successLine,
  withSelection,
} from "./templates-view";
import type { Abilities } from "./view";

/** What {@link TemplatesCard} takes. */
export interface TemplatesCardProps {
  /** The repository. */
  readonly repo: string;
  /** The first paint's read of the tiles. */
  readonly initial: Reading<OnboardingTemplateTiles> | null;
  /** Step 3's status on the rail — the head's pill. */
  readonly stepStatus: OnboardingStep["status"] | null;
  /** What the person may do: owners and admins select, since a selection publishes. */
  readonly abilities: Abilities;
  /** Called after a selection went through — the rail re-derives step 3 from the workflow. */
  readonly onChanged?: () => void;
  /** Test seams for the card's poll. */
  readonly poll?: TemplatesPollOptions;
}

/** What the card says under its head after a press. */
type Status =
  | {
      readonly tone: "ok";
      readonly text: string;
      readonly workflow: OnboardingInstantiatedWorkflow;
    }
  | {
      readonly tone: "refused";
      readonly text: string;
      readonly tile: OnboardingTemplateTile | null;
      readonly findings: readonly TemplateFinding[];
    };

/**
 * One tile — a button that selects the template, with the mockup's name, description, stage
 * dots, effort chips and caption; the selected treatment with its `✓ selected` mark; and the
 * locked treatment carrying the **computed** unlock line, its state and reason exposed to
 * assistive technology rather than only dimmed.
 *
 * @param props.tile The tile.
 * @param props.held Why the tile cannot be pressed right now, or undefined.
 * @param props.busy Whether this tile's selection is in flight.
 * @param props.describedBy The id of the reason every tile shares — the role's, or the press in
 *   flight — or undefined.
 * @param props.onPress Selects the tile.
 * @returns The tile.
 */
function Tile({
  tile,
  held,
  busy,
  describedBy,
  onPress,
}: Readonly<{
  tile: OnboardingTemplateTile;
  held: string | undefined;
  busy: boolean;
  describedBy: string | undefined;
  onPress: (tile: OnboardingTemplateTile) => void;
}>) {
  const lockNote = useId();
  const locked = isLocked(tile);
  const caption = captionOf(tile.caption);
  const efforts = tile.effortRange.map(effortOf).filter((effort) => effort !== null);
  const inert = held !== undefined || locked;

  return (
    <li
      className={cx(
        "tile",
        tile.selected && "tile--selected",
        locked && "tile--locked",
        busy && "tile--busy",
      )}
    >
      <button
        aria-describedby={locked ? lockNote : describedBy}
        aria-disabled={inert ? "true" : undefined}
        aria-pressed={tile.selected}
        className="tile__select"
        onClick={() => {
          if (!inert) onPress(tile);
        }}
        type="button"
      >
        {(tile.selected || busy) && (
          <span className="tile__pick">{busy ? SELECTING : SELECTED_MARK}</span>
        )}
        <span className="tile__name">{tile.name}</span>
        <span className="tile__desc">{tile.description}</span>
        <span className="sr-only">{stagesSentence(tile.stageDots)}</span>
        <span aria-hidden className="tile__dots">
          {tile.stageDots.map((stage, index) => (
            <span className="tile__stage" key={`${String(index)}-${stage}`}>
              {index > 0 && <span className="tile__arrow"> → </span>}
              <span className="tile__dot">●</span> {stage}
            </span>
          ))}
        </span>
        <span className="tile__foot">
          {efforts.map((effort) => (
            <EffortChip effort={effort} key={effort} />
          ))}
          {locked && tile.unlock !== null && (
            <Tag className="tile__unlock">{tile.unlock.progress}</Tag>
          )}
        </span>
        {caption !== null && <span className="tile__caption">{caption}</span>}
        {locked && tile.unlock !== null && (
          <span className="sr-only" id={lockNote}>
            {lockedReason(tile.unlock)}
          </span>
        )}
      </button>
      {tile.workflow !== null && (
        <Link className="tile__studio" href={tile.workflow.studioPath}>
          {TILE_STUDIO_LINK}
          <span className="sr-only"> ({tile.workflow.name})</span>
        </Link>
      )}
    </li>
  );
}

/**
 * The *"Choose a starting workflow"* card (BC.3, [#392](https://github.com/NobuData/ouroboros/issues/392),
 * mockup 13) — four tiles, a selection that creates a real workflow, and a locked tier that shows
 * how far the workspace actually is.
 *
 * **Live.** The tiles are re-read on the I.8 poll, so a locked tile opens by itself the moment
 * the workspace's merged loops cross the threshold — the gate is the service's computation.
 *
 * **A press publishes.** Selecting goes through BB.3's instantiation: the card shows the
 * progress, then the success state links the created (or reused) workflow in the Studio. A
 * definition the publish gate refused is drawn as a designed error naming each finding, and says
 * that nothing was created. Switching away from a tile whose workflow exists asks first, stating
 * that the workflow remains.
 *
 * @param props See {@link TemplatesCardProps}.
 * @returns The card.
 */
export function TemplatesCard({
  repo,
  initial,
  stepStatus,
  abilities,
  onChanged,
  poll,
}: TemplatesCardProps) {
  const titleId = useId();
  const noteId = useId();
  const progressId = useId();
  const { snapshot, refresh } = useKeyedPoll(templatesEndpoint(repo), (endpoint) =>
    createTemplatesPoll(endpoint, poll),
  );
  const [applied, setApplied] = useState<{
    readonly over: OnboardingTemplateTiles | null;
    readonly selection: OnboardingTemplateSelection;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [confirming, setConfirming] = useState<{
    readonly next: OnboardingTemplateTile;
    readonly previous: OnboardingInstantiatedWorkflow;
  } | null>(null);

  const polled = snapshot.data ?? (initial?.ok === true ? initial.value : null);
  // A selection shows at once; the poll's next answer (a different object) takes over from it.
  const tiles =
    polled !== null && applied !== null && applied.over === polled
      ? withSelection(polled, applied.selection)
      : polled;
  const pill = stepPill(stepStatus);

  /**
   * Send the selection, then say what the service answered. Reached only through {@link press}
   * (which holds while one is in flight) or the dialog it opens, so this never races itself.
   */
  function select(tile: OnboardingTemplateTile): void {
    setBusy(tile.slug);
    setStatus(null);
    void selectTemplate(repo, tile.slug).then((outcome) => {
      setBusy(null);

      if (outcome.ok) {
        setApplied({ over: polled, selection: outcome.value });
        setStatus({
          tone: "ok",
          text: successLine(outcome.value),
          workflow: outcome.value.workflow,
        });
        refresh();
        onChanged?.();
      } else {
        setStatus({
          tone: "refused",
          text: outcome.findings.length > 0 ? invalidLine(tile) : outcome.reason,
          tile: outcome.findings.length > 0 ? tile : null,
          findings: outcome.findings,
        });
      }
    });
  }

  /** A press: ask first when a switch would leave a created workflow behind, else select. */
  function press(tile: OnboardingTemplateTile): void {
    if (tiles === null || busy !== null) return;

    const previous = previousWorkflow(tiles, tile);

    if (previous !== null) {
      setConfirming({ next: tile, previous });
    } else {
      select(tile);
    }
  }

  const head = (
    <CardHead
      beside={
        pill === null ? undefined : (
          <Chip dot={pill.tone === "accent" ? "pulse" : undefined} tone={pill.tone}>
            {pill.text}
          </Chip>
        )
      }
      title={TEMPLATES_TITLE}
      titleId={titleId}
      trailing={
        tiles === null ? undefined : (
          <Link className="tiles__studio" href={tiles.studioPath}>
            {STUDIO_LINK}
          </Link>
        )
      }
    />
  );

  if (tiles === null) {
    const failure = snapshot.error ?? (initial?.ok === false ? initial.reason : null);

    return (
      <Card aria-labelledby={titleId} as="section" className="tiles">
        {head}
        <p className="tiles__line" role={failure === null ? undefined : "alert"}>
          {failure ?? NO_TEMPLATES}
        </p>
      </Card>
    );
  }

  const held = !abilities.administer ? ADMIN_REASON : busy !== null ? SELECTING : undefined;

  return (
    <Card aria-labelledby={titleId} as="section" className="tiles">
      {head}

      {!abilities.administer && (
        <p className="tiles__note" id={noteId}>
          {ADMIN_REASON}
        </p>
      )}

      {status?.tone === "ok" && (
        <p className="tiles__status" role="status">
          {status.text}{" "}
          <Link className="tiles__status-link" href={status.workflow.studioPath}>
            {OPEN_IN_STUDIO}
          </Link>
        </p>
      )}

      {status?.tone === "refused" && (
        <div className="tiles__refusal" role="alert">
          <p className="tiles__refusal-line">{status.text}</p>
          {status.findings.length > 0 && (
            <>
              <ul aria-label="Validation findings" className="tiles__findings">
                {status.findings.map((finding) => (
                  <li className="tiles__finding" key={findingLine(finding)}>
                    {findingLine(finding)}
                  </li>
                ))}
              </ul>
              <p className="tiles__refusal-line">{INVALID_NOTHING_CREATED}</p>
            </>
          )}
        </div>
      )}

      {busy !== null && status === null && (
        <p className="tiles__status" id={progressId} role="status">
          {SELECTING}
        </p>
      )}

      {tiles.tiles.length === 0 ? (
        <p className="tiles__line">{NO_TEMPLATES}</p>
      ) : (
        <ul aria-label={GRID_LABEL} className="tiles__grid">
          {tiles.tiles.map((tile) => (
            <Tile
              busy={busy === tile.slug}
              describedBy={!abilities.administer ? noteId : busy !== null ? progressId : undefined}
              held={held}
              key={tile.slug}
              onPress={press}
              tile={tile}
            />
          ))}
        </ul>
      )}

      <p className="tiles__foot">
        {FOOTER_BEFORE}
        <Link className="tiles__foot-link" href={tiles.studioPath}>
          {FOOTER_LINK}
        </Link>
        {FOOTER_AFTER}
      </p>

      <ReselectDialog
        confirming={confirming}
        onClose={() => setConfirming(null)}
        onConfirm={(next) => {
          setConfirming(null);
          select(next);
        }}
      />
    </Card>
  );
}
