"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type { Reading } from "@/app/api/reading";
import type { SkillList, SkillStats, SkillSummary } from "@/app/api/skills";
import { WORKFLOWS_PATH } from "@/app/paths";
import { Button, Card, CardHead, Chip, type Column, EmptyState, Table, Tag, Toggle, cx } from "@/app/ui";

import {
  CAPTION_LEAD,
  CAPTION_LINK,
  CAPTION_TAIL,
  COLUMN_ON,
  COLUMN_SCOPE,
  COLUMN_SKILL,
  COLUMN_UPDATED,
  COLUMN_USED_BY,
  DRAFT_PILL,
  MEMBER_REGENERATE_REASON,
  NO_REPO_REASON,
  NO_SKILLS_NOTE,
  NO_SKILLS_TITLE,
  OPEN_IN_EDITOR,
  REGENERATE_GLYPH,
  REGENERATING,
  SKILLS_TABLE_NAME,
  SKILLS_UNREAD_TITLE,
  STUDIO_NOTE,
  type SortKey,
  type SortState,
  activeCount,
  editorAffordance,
  nextSort,
  regenerateFailure,
  regenerateName,
  regenerateToast,
  scopeLabel,
  scopeNote,
  sortDirection,
  sortSkills,
  switchFailure,
  switchState,
  updated,
  usedBy,
} from "./skills";
import { regenerateRepoMap, setSkillEnabled } from "./skills-actions";
import type { KnowledgeToast } from "./toast";
import { SKILLS_REGION_ID, SKILLS_TITLE } from "./view";

import "./knowledge.css";

/**
 * Mockup 14's skills card (BG.2, [#418](https://github.com/NobuData/ouroboros/issues/418)):
 * the head with its active count and **Open in editor →**, the five-column table, the caption.
 *
 * The decisions are `app/knowledge/skills.ts`'s; what is here is state and wiring:
 *
 * - **Every switch is a real call.** A press calls `setSkillEnabled`, and the row takes the
 *   skill the service answered with — so the row updates from the write, not from the press.
 *   The required row's switch is drawn locked and makes the same call, which the service
 *   refuses; the refusal's sentence lands in the row as an alert the switch is described by.
 *   That is the issue's ask: the lock is the API's, and the page merely shows it.
 * - **The generated row regenerates.** Its `↻` calls the generator for the row's repository and
 *   leaves the report as the page's toast; the page re-reads, so the tag's last-generation note
 *   is the new version's.
 * - **The editor door is closed, and says why.** A press on a row's name reveals the reason the
 *   code view cannot open it yet, with the overwrite warning on the generated row — the sentence
 *   the door will lead with on the day it opens.
 * - **Sorting is the reader's**, by any column but the switches, through the table primitive's
 *   sortable headings.
 *
 * Read-only for a member: the switches keep their real state, inert with the reason, and the
 * regenerate is inert likewise. The gates that enforce are the service's.
 */

/** What the card is told. */
export interface SkillsTableProps {
  /** The workspace's skills, or why they could not be read. */
  readonly skills: Reading<SkillList>;
  /** The Used-by figures, or why they could not be read. */
  readonly stats: Reading<SkillStats>;
  /** The instant the page was read, ISO 8601 — what every relative age is measured from. */
  readonly readAt: string;
  /** Whether this reader is an `owner` or an `admin`. */
  readonly mayAdminister: boolean;
  /** Called with the toast a regenerate leaves. */
  readonly onToast: (toast: KnowledgeToast) => void;
}

/** One row's transient state: the skill as last written, and the last refusal it was shown. */
interface RowState {
  /** The skill the service answered a switch with, replacing the page's read until it re-reads. */
  readonly skill?: SkillSummary;
  /** A refused switch's sentence, cleared by the next press. */
  readonly failure?: string;
  /** Whether the row's editor door has been pressed, which reveals why it is closed. */
  readonly doorPressed?: boolean;
}

/**
 * The card.
 *
 * @param props See {@link SkillsTableProps}.
 * @returns The card, with the table in it — or, in its place, why there is none.
 */
export function SkillsTable({ skills, stats, readAt, mayAdminister, onToast }: SkillsTableProps) {
  const router = useRouter();
  const ids = useId();
  const now = new Date(readAt);

  const [sort, setSort] = useState<SortState | null>(null);
  const [rows, setRows] = useState<Readonly<Record<string, RowState>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateRefusal, setRegenerateRefusal] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /**
   * Hold one row's transient state.
   *
   * @param slug The row.
   * @param patch What changed.
   */
  function patchRow(slug: string, patch: RowState): void {
    setRows((current) => ({ ...current, [slug]: { ...current[slug], ...patch } }));
  }

  /**
   * Move a switch — the ordinary row's and the locked row's alike, because the lock is the
   * service's to enforce.
   *
   * @param skill The row's skill.
   */
  function press(skill: SkillSummary): void {
    if (busy !== null) return;

    setBusy(skill.slug);
    patchRow(skill.slug, { failure: undefined });

    startTransition(async () => {
      const outcome = await setSkillEnabled(skill.slug, !skill.enabled);

      if (outcome.ok) {
        patchRow(skill.slug, { skill: outcome.value });
        router.refresh();
      } else {
        patchRow(skill.slug, { failure: switchFailure(outcome.refusal) });
      }

      setBusy(null);
    });
  }

  /**
   * Regenerate the generated row's repository.
   *
   * @param repo The repository, `owner/name`.
   */
  function regenerate(repo: string): void {
    if (regenerating) return;

    setRegenerating(true);
    setRegenerateRefusal(null);

    startTransition(async () => {
      const outcome = await regenerateRepoMap({ repo });

      if (outcome.ok) {
        onToast(regenerateToast(outcome.value, new Date()));
        router.refresh();
      } else {
        setRegenerateRefusal(regenerateFailure(outcome.refusal));
      }

      setRegenerating(false);
    });
  }

  /**
   * A sortable heading's sort, for the column.
   *
   * @param key The column.
   * @returns What the table primitive needs.
   */
  function sortable(key: SortKey) {
    return { direction: sortDirection(sort, key), onSort: () => { setSort(nextSort(sort, key)); } };
  }

  const columns: readonly Column<SkillSummary>[] = [
    {
      key: "skill",
      header: COLUMN_SKILL,
      sort: sortable("skill"),
      cell: (skill) => <NameCell ids={ids} onPress={() => { patchRow(skill.slug, { doorPressed: true }); }} pressed={rows[skill.slug]?.doorPressed === true} skill={skill} />,
    },
    {
      key: "scope",
      header: COLUMN_SCOPE,
      sort: sortable("scope"),
      cell: (skill) => <Tag title={scopeNote(skill)}>{scopeLabel(skill.scope)}</Tag>,
    },
    {
      key: "usedBy",
      header: COLUMN_USED_BY,
      mono: true,
      sort: sortable("usedBy"),
      cell: (skill) => <UsedByCell figure={usedBy(skill, stats)} />,
    },
    {
      key: "updated",
      header: COLUMN_UPDATED,
      mono: true,
      sort: sortable("updated"),
      cell: (skill) => (
        <UpdatedCell
          ids={ids}
          mayAdminister={mayAdminister}
          now={now}
          onRegenerate={regenerate}
          refusal={regenerateRefusal}
          regenerating={regenerating}
          skill={skill}
        />
      ),
    },
    {
      key: "on",
      header: COLUMN_ON,
      className: "knowledge-skills__col--on",
      cell: (skill) => (
        <SwitchCell
          failure={rows[skill.slug]?.failure ?? null}
          ids={ids}
          mayAdminister={mayAdminister}
          onPress={() => { press(skill); }}
          skill={skill}
        />
      ),
    },
  ];

  const list = skills.ok ? skills.value : null;
  const drawn = list === null ? [] : sortSkills(list.skills.map((skill) => rows[skill.slug]?.skill ?? skill), sort, stats);

  return (
    <Card aria-labelledby={`${SKILLS_REGION_ID}-title`} as="section">
      <CardHead
        beside={list !== null && <Chip>{activeCount(list)}</Chip>}
        title={SKILLS_TITLE}
        titleId={`${SKILLS_REGION_ID}-title`}
        trailing={
          <Button href={WORKFLOWS_PATH} size="sm" title={STUDIO_NOTE} tone="ghost">
            {OPEN_IN_EDITOR}
          </Button>
        }
      />

      {list === null ? (
        <EmptyState note={skills.ok ? undefined : skills.reason} title={SKILLS_UNREAD_TITLE} variant="flush" />
      ) : list.skills.length === 0 ? (
        <EmptyState note={NO_SKILLS_NOTE} title={NO_SKILLS_TITLE} variant="flush" />
      ) : (
        <Table
          caption={SKILLS_TABLE_NAME}
          captionHidden
          columns={columns}
          rowClassName={(skill) => skill.draft && "knowledge-skills__row--draft"}
          rowKey={(skill) => skill.slug}
          rows={drawn}
        />
      )}

      <p className="knowledge-skills__caption">
        {CAPTION_LEAD}
        <a className="knowledge-skills__caption-link" href={WORKFLOWS_PATH} title={STUDIO_NOTE}>
          {CAPTION_LINK}
        </a>
        {CAPTION_TAIL}
      </p>
    </Card>
  );
}

/**
 * The name cell: the mono slug as the row's editor door, the draft pill beside it, the
 * description under it, and — once the door is pressed — why it is closed.
 *
 * The door is a button marked `aria-disabled` and described by its reason (and, on a generated
 * row, the overwrite warning), so assistive technology meets both before any press; the press
 * reveals the same sentences in the row for everyone else.
 *
 * @param props.skill The skill.
 * @param props.ids The card's id prefix.
 * @param props.pressed Whether the door has been pressed.
 * @param props.onPress Called on press.
 * @returns The cell.
 */
function NameCell({
  skill,
  ids,
  pressed,
  onPress,
}: Readonly<{ skill: SkillSummary; ids: string; pressed: boolean; onPress: () => void }>) {
  const door = editorAffordance(skill);
  const reasonId = `${ids}-${skill.slug}-door`;
  const warningId = `${ids}-${skill.slug}-overwrite`;

  return (
    <div className="knowledge-skills__name-cell">
      <div className="knowledge-skills__name-row">
        <button
          aria-describedby={door.warning === null ? reasonId : `${reasonId} ${warningId}`}
          aria-disabled="true"
          aria-label={door.label}
          className="knowledge-skills__name"
          onClick={onPress}
          title={door.warning === null ? door.reason : `${door.warning} ${door.reason}`}
          type="button"
        >
          {skill.slug}
        </button>
        {skill.draft && <Chip tone="warn">{DRAFT_PILL}</Chip>}
      </div>
      <div className="knowledge-skills__desc">{skill.description}</div>
      {/* The reason is in the tree from the start; it becomes visible once the door is pressed. */}
      <p className={cx("knowledge-skills__door", !pressed && "sr-only")} id={reasonId} role={pressed ? "status" : undefined}>
        {door.reason}
      </p>
      {door.warning !== null && (
        <p className={cx("knowledge-skills__door", "knowledge-skills__door--warn", !pressed && "sr-only")} id={warningId}>
          {door.warning}
        </p>
      )}
    </div>
  );
}

/**
 * The Used-by cell: the figure, with its footnote as a tooltip and in the accessibility tree.
 *
 * A real zero and a draft's `—` wear their own classes, so the sheet can draw a zero as a value
 * rather than as a gap — and the draft's as the inert thing it is.
 *
 * @param props.figure The cell, as `usedBy` decided it.
 * @returns The cell.
 */
function UsedByCell({ figure }: Readonly<{ figure: ReturnType<typeof usedBy> }>) {
  return (
    <span className="knowledge-skills__used">
      <span
        className={cx(
          "knowledge-skills__used-label",
          figure.zero && "knowledge-skills__used-label--zero",
          figure.inert && "knowledge-skills__used-label--inert",
        )}
      >
        {figure.label}
      </span>
      <span className="knowledge-skills__info" title={figure.note}>
        <span aria-hidden="true">ⓘ</span>
        <span className="sr-only">{figure.note}</span>
      </span>
    </span>
  );
}

/**
 * The Updated cell: the version and its age; or the required tag; or the generated tag with its
 * last-generation note and the regenerate action.
 *
 * @param props.skill The skill.
 * @param props.now The instant the page was read.
 * @param props.ids The card's id prefix.
 * @param props.mayAdminister Whether the regenerate may be pressed.
 * @param props.regenerating Whether a regenerate is in flight.
 * @param props.refusal The last regenerate's refusal, or `null`.
 * @param props.onRegenerate Called with the repository to regenerate.
 * @returns The cell.
 */
function UpdatedCell({
  skill,
  now,
  ids,
  mayAdminister,
  regenerating,
  refusal,
  onRegenerate,
}: Readonly<{
  skill: SkillSummary;
  now: Date;
  ids: string;
  mayAdminister: boolean;
  regenerating: boolean;
  refusal: string | null;
  onRegenerate: (repo: string) => void;
}>) {
  const cell = updated(skill, now);

  if (cell.kind === "required") {
    return (
      <span className="knowledge-skills__required" id={`${ids}-${skill.slug}-required`}>
        <Chip title={cell.note} tone="warn">
          {cell.tag}
          <span className="sr-only"> — {cell.note}</span>
        </Chip>
      </span>
    );
  }

  if (cell.kind === "generated") {
    const repo = skill.repoRef;
    const reason = !mayAdminister ? MEMBER_REGENERATE_REASON : repo === null ? NO_REPO_REASON : undefined;

    return (
      <span className="knowledge-skills__generated">
        <Tag title={cell.note}>
          {cell.tag}
          <span className="sr-only"> — {cell.note}</span>
        </Tag>
        <Button
          aria-label={regenerateName(skill.slug)}
          className="knowledge-skills__regenerate"
          onClick={repo === null ? undefined : () => { onRegenerate(repo); }}
          reason={regenerating ? REGENERATING : reason}
          size="sm"
          tone="ghost"
        >
          <span aria-hidden="true">{regenerating ? "…" : REGENERATE_GLYPH}</span>
        </Button>
        {refusal !== null && (
          <span className="knowledge-skills__refusal" role="alert">
            {refusal}
          </span>
        )}
      </span>
    );
  }

  return <span className={cx(cell.kind === "unpublished" && "knowledge-skills__unpublished")}>{cell.text}</span>;
}

/**
 * The switch cell: the switch in the state `switchState` decided, and the refusal under it when
 * a press was refused — an alert the switch is described by, so the reason reaches assistive
 * technology as it reaches the eye.
 *
 * @param props.skill The skill.
 * @param props.ids The card's id prefix.
 * @param props.mayAdminister Whether the reader may switch.
 * @param props.failure The last refusal's sentence, or `null`.
 * @param props.onPress Called on press — for the ordinary switch and the locked one alike.
 * @returns The cell.
 */
function SwitchCell({
  skill,
  ids,
  mayAdminister,
  failure,
  onPress,
}: Readonly<{
  skill: SkillSummary;
  ids: string;
  mayAdminister: boolean;
  failure: string | null;
  onPress: () => void;
}>) {
  const state = switchState(skill, mayAdminister);
  const failureId = `${ids}-${skill.slug}-refused`;
  const requiredId = `${ids}-${skill.slug}-required`;
  const describedBy = [state.kind === "locked" && requiredId, failure !== null && failureId]
    .filter((id): id is string => typeof id === "string")
    .join(" ");

  return (
    <span className="knowledge-skills__switch">
      {state.kind === "readonly" ? (
        <Toggle checked={skill.enabled} label={state.label} reason={state.reason} />
      ) : (
        <Toggle
          checked={skill.enabled}
          describedBy={describedBy === "" ? undefined : describedBy}
          label={state.label}
          locked={state.kind === "locked"}
          onClick={onPress}
        />
      )}
      {failure !== null && (
        <span className="knowledge-skills__refusal" id={failureId} role="alert">
          {failure}
        </span>
      )}
    </span>
  );
}
