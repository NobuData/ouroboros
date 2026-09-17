/**
 * The planning API's request shapes — AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)).
 *
 * Every bound here is the tighter of two contracts: the engine's `/v0/plan` request (AL.1, #277)
 * for what is sent to the planner, and V034/V036's CHECKs for what is stored. A body the database
 * would refuse is a `422` naming the field, never a `500` naming a constraint.
 *
 * `@IsOptional` passes both `null` and an absent key. On a create, both mean *none*; on a `PATCH`,
 * an absent key is *leave it alone* while `null` clears a nullable field (a body, a month range, a
 * roadmap name) — the services read the two apart with `=== undefined`.
 */

import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Validate,
} from "class-validator";

import { EPIC_STATUSES, EPIC_TINTS, type EpicStatus, type EpicTint } from "../db/schema";
import {
  PLAN_LOCAL_KEY_PREFIX_PATTERN,
  PLAN_MAX_NARRATIVE_LENGTH,
  PLAN_MAX_OUTLINE_LENGTH,
} from "../engine/engine.contract";
import { IsTrimmed } from "../provider-connections/provider-connections.dto";

/** The longest local key `ticket_drafts_local_key_present` stores. */
export const MAX_LOCAL_KEY_LENGTH = 64;

/** The longest draft title `ticket_drafts_title_present` stores. */
export const MAX_DRAFT_TITLE_LENGTH = 512;

/** The longest draft body `ticket_drafts_body_bounded` stores. */
export const MAX_DRAFT_BODY_LENGTH = 262_144;

/** The most blockers one draft may name — the plan contract's `dependencies` bound. */
export const MAX_DRAFT_DEPENDENCIES = 64;

/** The longest milestone name `draft_batches_target_milestone_present` stores. */
export const MAX_MILESTONE_LENGTH = 255;

/** The longest epic name `planning_epics_name_present` stores. */
export const MAX_EPIC_NAME_LENGTH = 200;

/** The longest roadmap window `planning_epics_roadmap_window_present` stores. */
export const MAX_ROADMAP_WINDOW_LENGTH = 64;

/** The most epics one reorder may name. A workspace's roadmap is lanes, not a backlog. */
export const MAX_REORDERED_EPICS = 500;

/** The most tickets one link or unlink may name. */
export const MAX_LINKED_TICKETS = 100;

/** A local key as a route or a dependency list carries it — any non-blank key a batch stores. */
export const LOCAL_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A month, as the API spells it: `2026-07`. Stored as the first of that month. */
export const MONTH_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/** The prefix a batch's local keys carry when the request names none — mockup 09's `OTA`. */
export const DEFAULT_LOCAL_KEY_PREFIX = "OTA";

/** `POST /planning/batches` — mockup 09's **Draft tickets ⟳**. */
export class CreateBatchBody {
  /** The outcome — *Describe the outcome, not the tasks*. */
  @Validate(IsTrimmed)
  @Length(1, PLAN_MAX_NARRATIVE_LENGTH)
  @IsString()
  prompt!: string;

  /** The markdown outline, or null / absent for narrative-only input. */
  @IsOptional()
  @Validate(IsTrimmed)
  @Length(1, PLAN_MAX_OUTLINE_LENGTH)
  @IsString()
  outline?: string | null;

  /** The WF-Q source the batch will be pushed to — the tracker segment. */
  @IsUUID()
  targetSourceId!: string;

  /** The **Milestone ▾** value, or null / absent for none. */
  @IsOptional()
  @Validate(IsTrimmed)
  @Length(1, MAX_MILESTONE_LENGTH)
  @IsString()
  milestone?: string | null;

  /** The planning epic the drafts belong to, or null / absent. */
  @IsOptional()
  @IsUUID()
  epicId?: string | null;

  /** **Auto-size with estimator** — defaults on, as the card draws it. */
  @IsOptional()
  @IsBoolean()
  autoSize?: boolean;

  /** **Queue XS/S tickets immediately** — defaults off. */
  @IsOptional()
  @IsBoolean()
  queueSmall?: boolean;

  /** What the batch's local keys are prefixed with. Defaults to {@link DEFAULT_LOCAL_KEY_PREFIX}. */
  @IsOptional()
  @Matches(PLAN_LOCAL_KEY_PREFIX_PATTERN, {
    message:
      "localKeyPrefix must be an upper-case letter followed by up to 11 upper-case letters or digits",
  })
  localKeyPrefix?: string;
}

/** `PATCH /planning/batches/:batch/drafts/:key` — select, edit, or re-wire one draft. */
export class PatchDraftBody {
  /** The checkbox. */
  @IsOptional()
  @IsBoolean()
  selected?: boolean;

  /** A new title — marks the draft `edited`. */
  @IsOptional()
  @Validate(IsTrimmed)
  @Length(1, MAX_DRAFT_TITLE_LENGTH)
  @IsString()
  title?: string;

  /** A new body, or null to clear it — marks the draft `edited`. */
  @IsOptional()
  @MaxLength(MAX_DRAFT_BODY_LENGTH)
  @IsString()
  body?: string | null;

  /**
   * The local keys this draft is **blocked by**, replacing its current set — the direction the
   * plan contract and GitHub's `blocked_by` both take. `[]` clears it.
   */
  @IsOptional()
  @Matches(LOCAL_KEY_PATTERN, { each: true })
  @MaxLength(MAX_LOCAL_KEY_LENGTH, { each: true })
  @IsString({ each: true })
  @ArrayUnique()
  @ArrayMaxSize(MAX_DRAFT_DEPENDENCIES)
  @IsArray()
  dependencies?: string[];
}

/** A route addressing one batch. */
export class BatchParams {
  @IsUUID()
  batch!: string;
}

/** A route addressing one draft of one batch, by local key. */
export class DraftParams extends BatchParams {
  @Matches(LOCAL_KEY_PATTERN)
  @Length(1, MAX_LOCAL_KEY_LENGTH)
  key!: string;
}

/** A route addressing one planning epic. */
export class EpicParams {
  @IsUUID()
  epic!: string;
}

/** A route addressing one ticket source. */
export class PlanningSourceParams {
  @IsUUID()
  source!: string;
}

/** The fields an epic's create and edit share — every one optional here. */
class EpicFields {
  /** The lane's tint token. */
  @IsOptional()
  @IsIn(EPIC_TINTS)
  tint?: EpicTint;

  /** `active`, `proposed`, `done` or `unscoped`. */
  @IsOptional()
  @IsIn(EPIC_STATUSES)
  status?: EpicStatus;

  /** The first month, `2026-07`, or null. Paired with {@link endMonth}. */
  @IsOptional()
  @Matches(MONTH_PATTERN, { message: "startMonth must be a month, YYYY-MM" })
  startMonth?: string | null;

  /** The last month, `2026-09`, or null. Paired with {@link startMonth}. */
  @IsOptional()
  @Matches(MONTH_PATTERN, { message: "endMonth must be a month, YYYY-MM" })
  endMonth?: string | null;

  /** The roadmap head the lane belongs to — `Helios 2.1` — or null. */
  @IsOptional()
  @Validate(IsTrimmed)
  @Length(1, MAX_EPIC_NAME_LENGTH)
  @IsString()
  roadmapName?: string | null;

  /** The roadmap's window tag — `Q3–Q4 2026` — or null. */
  @IsOptional()
  @Validate(IsTrimmed)
  @Length(1, MAX_ROADMAP_WINDOW_LENGTH)
  @IsString()
  roadmapWindow?: string | null;
}

/** `POST /planning/epics`. */
export class CreateEpicBody extends EpicFields {
  /** The lane's name. */
  @Validate(IsTrimmed)
  @Length(1, MAX_EPIC_NAME_LENGTH)
  @IsString()
  name!: string;
}

/** `PATCH /planning/epics/:epic` — only what is sent changes. */
export class UpdateEpicBody extends EpicFields {
  /** A new name. */
  @IsOptional()
  @Validate(IsTrimmed)
  @Length(1, MAX_EPIC_NAME_LENGTH)
  @IsString()
  name?: string;
}

/** `PUT /planning/epics/order` — every epic of the workspace, top lane first. */
export class ReorderEpicsBody {
  @IsUUID(undefined, { each: true })
  @ArrayUnique()
  @ArrayMaxSize(MAX_REORDERED_EPICS)
  @ArrayMinSize(1)
  @IsArray()
  epicIds!: string[];
}

/** `POST` / `DELETE /planning/epics/:epic/tickets` — the tickets to link or unlink. */
export class EpicTicketsBody {
  @IsUUID(undefined, { each: true })
  @ArrayUnique()
  @ArrayMaxSize(MAX_LINKED_TICKETS)
  @ArrayMinSize(1)
  @IsArray()
  ticketIds!: string[];
}
