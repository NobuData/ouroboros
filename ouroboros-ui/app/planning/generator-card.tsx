"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { PlanningBatch, PlanningDraftPatch } from "@/app/api/planning";
import type { Reading } from "@/app/api/reading";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { PLANNING_PATH } from "@/app/paths";
import { Button, Card, CardHead, Chip, EmptyState, Tag, TextAreaField, Toggle } from "@/app/ui";

import { type BatchPollOptions, batchUrl, createBatchPoll } from "./batch-poll";
import { DraftRow } from "./draft-row";
import {
  ALL_SIZED_MARK,
  AUTO_SIZE_LABEL,
  BATCH_UNREAD,
  DRAFTING,
  DRAFT_LABEL,
  GENERATOR_IDS,
  GENERATOR_TITLE,
  GENERATOR_TITLE_ID,
  GUIDANCE_LABEL,
  type GeneratorForm,
  MAX_OUTLINE_LENGTH,
  MAX_PROMPT_LENGTH,
  NO_DRAFTS_NOTE,
  OUTLINE_GUIDANCE_ACTION,
  OUTLINE_HINT,
  OUTLINE_LABEL,
  OUTLINE_TOGGLE_LABEL,
  PARTIAL_SPEND_NOTE,
  PROMPT_LABEL,
  PUSHING,
  QUEUE_SMALL_LABEL,
  QUEUE_SMALL_NOTE,
  REGENERATE_LABEL,
  REGENERATING,
  RESUME_LABEL,
  type TrackerOption,
  allSized,
  batchHref,
  blocksNote,
  draftHeading,
  draftReason,
  editBody,
  editReason,
  estimatorTag,
  footerText,
  generateBody,
  initialTracker,
  isSelected,
  pushLabel,
  pushMode,
  pushOutcome,
  pushReason,
  regenerateReason,
  rowPush,
  rowSizing,
  selectReason,
  selectedCount,
  sizingProgress,
} from "./generator";
import { generateBatch, patchDraft, pushBatch, regenerateBatch } from "./generator-actions";
import { MilestoneField } from "./milestone-field";
import { TrackerSegment } from "./tracker-segment";

import "./planning.css";

/**
 * Mockup 09's **Generate tickets** card, `c-7` (AM.2, [#284](https://github.com/NobuData/ouroboros/issues/284)).
 *
 * The prompt and its collapsible structured outline, the tracker segment, the milestone, the two
 * switches and **Draft tickets ⟳**; then the draft list with its sizing pill, and the footer with
 * loop time, spend, **Regenerate** and **Push N tickets to <tracker> →**. Every judgement is
 * `generator.ts`'s; this component holds state and wires the flows.
 *
 * ### The batch the card draws is the newest one it has heard about
 *
 * A batch reaches the card three ways: the page's server read (a `?batch=` deep link), an action's
 * answer (generate, a checkbox, an edit, a push), and the poll (`batch-poll.ts`), which watches the
 * open batch while the estimator sizes it. Each is stamped with when it arrived and the newest wins,
 * so a checkbox's answer is not overwritten by a poll that left before it, and a sizing answer is
 * not hidden behind an older action's.
 *
 * ### Selections are live
 *
 * A click is drawn at once — the checkbox, the push button's count — and sent as a patch; the
 * pending value is dropped once the service's answer carries it, and put back with the refusal's
 * sentence when the service says no. The push button's count is always the checkboxes on screen.
 *
 * ### The address carries the batch
 *
 * Generating replaces the address with `/planning?batch=<id>` (no history entry), so a reload, a
 * shared link or another surface's deep link (#519's **Edit drafts**) opens the same batch. The
 * planner's `notes` are not stored by the service, so only the answer that carried them shows them.
 */

/** What the card takes. */
export interface GeneratorCardProps {
  /** The batch the address named, as the page read it — or `null` when it named none. */
  readonly batch: Reading<PlanningBatch> | null;
  /** The tracker segment (`generator.ts`'s `trackerOptions`). */
  readonly trackers: readonly TrackerOption[];
  /** Why the workspace's trackers could not be read, when they could not. */
  readonly trackersUnread: string | null;
  /** Whether the reader may push — `owner` or `admin`. */
  readonly mayAdminister: boolean;
  /** Whether the reader may draft and edit — `owner`, `admin` or `member`. */
  readonly mayContribute: boolean;
  /** Test seams for the batch poll; production passes none. */
  readonly pollOptions?: BatchPollOptions;
}

/** A batch, and when the card heard about it (epoch ms). */
interface Heard {
  readonly batch: PlanningBatch;
  readonly at: number;
}

/**
 * The form a card opens on.
 *
 * @param batch The open batch, if any.
 * @param trackers The segment.
 * @returns The prompt, outline, tracker, milestone and switches — the batch's own when one is open.
 */
function openingForm(batch: PlanningBatch | null, trackers: readonly TrackerOption[]): GeneratorForm {
  return {
    prompt: batch?.prompt ?? "",
    outline: batch?.outline ?? "",
    sourceId: initialTracker(trackers, batch?.targetSourceId ?? null),
    milestone:
      batch?.milestone == null ? { mode: "none" } : { mode: "existing", name: batch.milestone },
    autoSize: batch?.autoSize ?? true,
    queueSmall: batch?.queueSmall ?? false,
  };
}

/**
 * The card.
 *
 * @param props See {@link GeneratorCardProps}.
 * @returns The card.
 */
export function GeneratorCard({
  batch: read,
  trackers,
  trackersUnread,
  mayAdminister,
  mayContribute,
  pollOptions,
}: GeneratorCardProps) {
  const router = useRouter();
  const outlineField = GENERATOR_IDS.outline;
  const queueNote = GENERATOR_IDS.queueNote;

  const opened = read?.ok === true ? read.value : null;

  const [form, setForm] = useState<GeneratorForm>(() => openingForm(opened, trackers));
  const [outlineOpen, setOutlineOpen] = useState(() => (opened?.outline ?? "") !== "");
  const [batchId, setBatchId] = useState<string | null>(opened?.id ?? null);
  // Stamped 0 so the first poll answer, whenever it lands, is newer than the server's read.
  const [heard, setHeard] = useState<Heard | null>(() => (opened === null ? null : { batch: opened, at: 0 }));
  const [notes, setNotes] = useState<readonly string[]>([]);
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<readonly string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [outlineFocusRequest, setOutlineFocusRequest] = useState(0);
  const outlineRegion = useRef<HTMLDivElement>(null);

  const { snapshot, refresh } = useKeyedPoll(batchId, (id) => createBatchPoll(batchUrl(id), pollOptions));

  const batch = newest(batchId, heard, snapshot.data, snapshot.updatedAt);
  const pushing = busy === PUSHING;

  // While a push runs its drafts land one by one; ask closely so each row's state appears as it does.
  useEffect(() => {
    if (!pushing) return;

    const timer = setInterval(refresh, 2000);

    return () => {
      clearInterval(timer);
    };
  }, [pushing, refresh]);

  // The guidance's **Write an outline** opens the field, and focus follows once it is drawn.
  useEffect(() => {
    if (outlineFocusRequest === 0) return;

    outlineRegion.current?.querySelector("textarea")?.focus();
  }, [outlineFocusRequest]);

  /**
   * Take a batch an action answered with.
   *
   * @param next The batch.
   */
  function hear(next: PlanningBatch): void {
    setHeard({ batch: next, at: Date.now() });
    // An answer already in the air left before this write; asking now drops it on arrival.
    refresh();
  }

  /**
   * Change part of the form.
   *
   * @param change The fields that change.
   */
  function update(change: Partial<GeneratorForm>): void {
    setForm((current) => ({ ...current, ...change }));
  }

  /** **Draft tickets ⟳** — generate a new batch from the form. */
  async function draft(): Promise<void> {
    setBusy(DRAFTING);
    setFailure(null);
    setOutcome([]);

    const answer = await generateBatch(generateBody(form));

    setBusy(null);

    if (!answer.ok) {
      setFailure(answer.refusal.message);
      return;
    }

    setNotes(answer.value.notes);
    setPending(new Map());
    setEditing(null);
    setBatchId(answer.value.id);
    setHeard({ batch: answer.value, at: Date.now() });
    router.replace(batchHref(PLANNING_PATH, answer.value.id), { scroll: false });
  }

  /**
   * **Regenerate** — re-plan the open batch's unpushed drafts.
   *
   * @param open The open batch.
   */
  async function regenerate(open: PlanningBatch): Promise<void> {
    setBusy(REGENERATING);
    setFailure(null);
    setOutcome([]);

    const answer = await regenerateBatch(open.id);

    setBusy(null);

    if (!answer.ok) {
      setFailure(answer.refusal.message);
      return;
    }

    setNotes(answer.value.notes);
    setPending(new Map());
    setEditing(null);
    hear(answer.value);
  }

  /**
   * Send one draft's patch.
   *
   * @param open The open batch.
   * @param key The draft's local key.
   * @param body What changes.
   * @returns Whether the service accepted it.
   */
  async function patch(open: PlanningBatch, key: string, body: PlanningDraftPatch): Promise<boolean> {
    setFailure(null);

    const answer = await patchDraft(open.id, key, body);

    if (!answer.ok) {
      setFailure(answer.refusal.message);
      return false;
    }

    hear(answer.value);
    return true;
  }

  /**
   * A checkbox click — drawn at once, then sent.
   *
   * @param open The open batch.
   * @param key The draft's local key.
   * @param selected The new state.
   */
  async function select(open: PlanningBatch, key: string, selected: boolean): Promise<void> {
    setPending((current) => new Map(current).set(key, selected));

    await patch(open, key, { selected });

    // Dropped only if no later click on the same row replaced it — that click's answer settles it.
    setPending((current) => {
      if (current.get(key) !== selected) return current;

      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }

  /**
   * **Push N tickets →** or **Resume push**.
   *
   * @param open The open batch.
   * @param resume Whether this is a resume.
   * @param tracker The tracker's name, for the outcome's sentences.
   */
  async function push(open: PlanningBatch, resume: boolean, tracker: string): Promise<void> {
    setBusy(PUSHING);
    setFailure(null);
    setOutcome([]);
    setEditing(null);

    const answer = await pushBatch(open.id, resume);

    setBusy(null);

    if (!answer.ok) {
      setFailure(answer.refusal.message);
      refresh();
      return;
    }

    if (answer.value.batch === null) refresh();
    else hear(answer.value.batch);

    setOutcome(pushOutcome(answer.value.result, tracker));
  }

  /** The guidance's action: open the outline and move focus into it. */
  function writeOutline(): void {
    setOutlineOpen(true);
    setOutlineFocusRequest((request) => request + 1);
  }

  const tag = estimatorTag(batch);
  const blockedDraft = draftReason(form, mayContribute, busy);
  const inertForm = mayContribute ? undefined : blockedDraft;

  return (
    <Card aria-labelledby={GENERATOR_TITLE_ID} as="section" className="planning-gen">
      <CardHead
        title={GENERATOR_TITLE}
        titleId={GENERATOR_TITLE_ID}
        trailing={tag === null ? undefined : <Tag>{tag}</Tag>}
      />

      {read?.ok === false && (
        <p className="planning-gen__notice" role="status">
          {`${BATCH_UNREAD} ${read.reason}`}
        </p>
      )}

      <TextAreaField
        disabled={!mayContribute}
        hint={inertForm}
        id={GENERATOR_IDS.prompt}
        label={PROMPT_LABEL}
        maxLength={MAX_PROMPT_LENGTH}
        onChange={(event) => { update({ prompt: event.currentTarget.value }); }}
        rows={4}
        value={form.prompt}
      />

      <button
        aria-controls={outlineField}
        aria-expanded={outlineOpen}
        className="planning-gen__disclosure"
        onClick={() => { setOutlineOpen((open) => !open); }}
        type="button"
      >
        <span aria-hidden className="planning-gen__caret">
          {outlineOpen ? "▾" : "▸"}
        </span>
        {OUTLINE_TOGGLE_LABEL}
      </button>

      <div className="planning-gen__outline" hidden={!outlineOpen} id={outlineField} ref={outlineRegion}>
        <TextAreaField
          disabled={!mayContribute}
          hint={OUTLINE_HINT}
          id={GENERATOR_IDS.outlineText}
          label={OUTLINE_LABEL}
          maxLength={MAX_OUTLINE_LENGTH}
          mono
          onChange={(event) => { update({ outline: event.currentTarget.value }); }}
          rows={6}
          value={form.outline}
        />
      </div>

      {notes.length > 0 && (
        <aside aria-label={GUIDANCE_LABEL} className="planning-gen__guidance">
          <ul className="planning-gen__notes">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          {form.outline.trim() === "" && (
            <Button aria-controls={outlineField} onClick={writeOutline} size="sm" tone="ghost">
              {OUTLINE_GUIDANCE_ACTION}
            </Button>
          )}
        </aside>
      )}

      {trackersUnread !== null && (
        <p className="planning-gen__notice" role="status">
          {trackersUnread}
        </p>
      )}

      <div className="planning-gen__controls">
        <TrackerSegment
          onChange={(sourceId) => { update({ sourceId, milestone: { mode: "none" } }); }}
          options={trackers}
          reason={inertForm ?? busy ?? undefined}
          value={form.sourceId}
        />
        <MilestoneField
          id={GENERATOR_IDS.milestone}
          onChange={(milestone) => { update({ milestone }); }}
          reason={inertForm}
          sourceId={form.sourceId}
          value={form.milestone}
        />
        <span className="planning-gen__switch">
          <Toggle
            checked={form.autoSize}
            label={AUTO_SIZE_LABEL}
            onClick={() => { update({ autoSize: !form.autoSize }); }}
            reason={inertForm}
          />
          <span aria-hidden className="planning-gen__switch-label">
            {AUTO_SIZE_LABEL}
          </span>
        </span>
        <span className="planning-gen__switch">
          <Toggle
            checked={form.queueSmall}
            describedBy={queueNote}
            label={QUEUE_SMALL_LABEL}
            onClick={() => { update({ queueSmall: !form.queueSmall }); }}
            reason={inertForm}
          />
          <span aria-hidden className="planning-gen__switch-label">
            {QUEUE_SMALL_LABEL}
          </span>
        </span>
        <Button
          className="planning-gen__draft"
          onClick={() => void draft()}
          reason={blockedDraft}
          tone="primary"
        >
          {DRAFT_LABEL}
        </Button>
      </div>
      <p className="planning-gen__note" id={queueNote}>
        {QUEUE_SMALL_NOTE}
      </p>

      <hr className="planning-gen__divider" />

      {batch === null ? (
        <EmptyState note={NO_DRAFTS_NOTE} />
      ) : (
        <DraftSection
          batch={batch}
          busy={busy}
          editing={editing}
          mayAdminister={mayAdminister}
          mayContribute={mayContribute}
          onEditing={setEditing}
          onPatch={(key, body) => patch(batch, key, body)}
          onPush={(resume, tracker) => void push(batch, resume, tracker)}
          onRegenerate={() => void regenerate(batch)}
          onSelect={(key, selected) => void select(batch, key, selected)}
          pending={pending}
          pushing={pushing}
          trackers={trackers}
        />
      )}

      {failure !== null && (
        <p className="planning-gen__failure" role="alert">
          {failure}
        </p>
      )}

      {busy !== null && (
        <p className="planning-gen__state" role="status">
          {busy}
        </p>
      )}

      {outcome.length > 0 && (
        <ul aria-live="polite" className="planning-gen__outcome">
          {outcome.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * The batch the card draws: whichever of the action's answer and the poll's is newer.
 *
 * @param batchId The open batch.
 * @param heard The last batch an action or the server answered, with when.
 * @param polled The poll's last payload.
 * @param polledAt When the poll's payload was confirmed.
 * @returns The newest batch for `batchId`, or `null` when none is known.
 */
function newest(
  batchId: string | null,
  heard: Heard | null,
  polled: PlanningBatch | null,
  polledAt: number | null,
): PlanningBatch | null {
  if (batchId === null) return null;

  const fromAction = heard !== null && heard.batch.id === batchId ? heard : null;
  const fromPoll = polled !== null && polled.id === batchId && polledAt !== null ? polled : null;

  if (fromPoll === null) return fromAction?.batch ?? null;
  if (fromAction === null) return fromPoll;

  return (polledAt ?? 0) > fromAction.at ? fromPoll : fromAction.batch;
}

/**
 * The draft list and the footer beneath it.
 *
 * @param props.batch The open batch.
 * @param props.trackers The segment — the batch's tracker is looked up in it.
 * @param props.pending Checkbox clicks not yet confirmed.
 * @param props.busy What the card is doing, if anything.
 * @param props.pushing Whether a push is in flight.
 * @param props.editing Which row's editor is open.
 * @param props.mayAdminister Whether the reader may push.
 * @param props.mayContribute Whether the reader may draft and edit.
 * @param props.onSelect A checkbox click.
 * @param props.onEditing Open or close a row's editor.
 * @param props.onPatch Save an edit.
 * @param props.onRegenerate **Regenerate**.
 * @param props.onPush **Push** or **Resume push**.
 * @returns The section.
 */
function DraftSection({
  batch,
  trackers,
  pending,
  busy,
  pushing,
  editing,
  mayAdminister,
  mayContribute,
  onSelect,
  onEditing,
  onPatch,
  onRegenerate,
  onPush,
}: Readonly<{
  batch: PlanningBatch;
  trackers: readonly TrackerOption[];
  pending: ReadonlyMap<string, boolean>;
  busy: string | null;
  pushing: boolean;
  editing: string | null;
  mayAdminister: boolean;
  mayContribute: boolean;
  onSelect: (key: string, selected: boolean) => void;
  onEditing: (key: string | null) => void;
  onPatch: (key: string, body: PlanningDraftPatch) => Promise<boolean>;
  onRegenerate: () => void;
  onPush: (resume: boolean, tracker: string) => void;
}>) {
  const { drafts } = batch;
  const tracker = trackers.find((option) => option.sourceId === batch.targetSourceId);
  const trackerName = tracker?.pushName ?? "the tracker";
  const count = selectedCount(drafts, pending);
  const mode = pushMode(drafts, pending);
  const blockedPush = pushReason({ mode, count, tracker, mayAdminister, busy });
  const sized = allSized(drafts);

  return (
    <div className="planning-gen__drafts">
      <div className="planning-gen__drafts-head">
        <h3 className="planning-gen__drafts-title">{draftHeading(drafts.length)}</h3>
        {sized ? (
          <Chip tone="ok">{ALL_SIZED_MARK}</Chip>
        ) : (
          <Chip dot="ring">{sizingProgress(drafts)}</Chip>
        )}
      </div>

      <ul aria-label={draftHeading(drafts.length)} className="planning-gen__rows">
        {drafts.map((draft) => {
          const selected = isSelected(draft, pending);

          return (
            <DraftRow
              blocks={blocksNote(draft, drafts)}
              draft={draft}
              editReason={editReason(draft, batch, mayContribute, pushing)}
              editing={editing === draft.localKey}
              key={draft.id}
              onEditing={(open) => { onEditing(open ? draft.localKey : null); }}
              onSave={(title, body) => onPatch(draft.localKey, editBody(title, body))}
              onSelect={(next) => { onSelect(draft.localKey, next); }}
              push={rowPush(draft, selected, pushing)}
              selectReason={selectReason(batch, mayContribute, pushing)}
              selected={selected}
              sizing={rowSizing(draft, batch.autoSize)}
            />
          );
        })}
      </ul>

      <div className="planning-gen__footer">
        <span
          className="planning-gen__total"
          title={batch.summary.spend?.partial === true ? PARTIAL_SPEND_NOTE : undefined}
        >
          {footerText(batch)}
        </span>
        <Button
          onClick={onRegenerate}
          reason={regenerateReason(batch, mayContribute, busy)}
          size="sm"
          tone="ghost"
        >
          {REGENERATE_LABEL}
        </Button>
        <Button
          onClick={() => { onPush(mode === "resume", trackerName); }}
          reason={blockedPush}
          size="sm"
          tone="primary"
        >
          {mode === "resume" ? RESUME_LABEL : pushLabel(count, trackerName)}
        </Button>
      </div>
    </div>
  );
}
