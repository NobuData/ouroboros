/**
 * The shapes the playbooks routes accept (BF.6,
 * [#415](https://github.com/NobuData/ouroboros/issues/415)).
 *
 * Bounds are V072's, copied from the checks they guard — the name and description lengths, the
 * override sets (reusing context assembly's {@link SkillOverridesBody}), the preset's sixteen notes
 * of 2 000 characters and sixty-four facts, the filter's thirty-two labels and repositories. Whether
 * an id is this workspace's is V072's trigger's question, answered `422
 * playbook_reference_unresolved` — never this file's.
 */

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

import { MAX_WORKFLOW_SLUG_LENGTH, WORKFLOW_SLUG_PATTERN } from "../backlog/queue.dto";
import { SkillOverridesBody } from "../context-assembly/context-assembly.dto";
import { REPO_REF_MAX_LENGTH, REPO_REF_PATTERN } from "../onboarding/onboarding.dto";
import { MAX_LIMIT } from "../tenancy/pagination";
import {
  MAX_FILTER_ENTRIES,
  MAX_PRESET_FACTS,
  MAX_STEER_NOTES,
  MAX_STEER_NOTE_LENGTH,
} from "./playbooks.derive";

/** V072's `playbooks_name_present`. */
export const MAX_PLAYBOOK_NAME_LENGTH = 120;

/** V072's `playbooks_description_present`. */
export const MAX_PLAYBOOK_DESCRIPTION_LENGTH = 300;

/** The picker's default page. */
export const DEFAULT_PICKER_LIMIT = 25;

/** A value that is not only whitespace. */
const NON_BLANK = /\S/;

/** V072's context preset. */
export class ContextPresetBody {
  /** The steer the human gave — 1–16 distinct notes of at most 2 000 characters. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_STEER_NOTES)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, MAX_STEER_NOTE_LENGTH, { each: true })
  @Matches(NON_BLANK, { each: true, message: "each steer note must not be blank" })
  steerNotes?: string[];

  /** Extra facts to inject — at most 64 distinct fact ids of this workspace. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PRESET_FACTS)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  factIds?: string[];
}

/** V072's issue filter. `{}` (or both halves empty) admits every issue and is stored as `null`. */
export class IssueFilterBody {
  /** An issue must carry at least one of these labels. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_ENTRIES)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  @Matches(NON_BLANK, { each: true, message: "each label must not be blank" })
  labels?: string[];

  /** An issue must live in one of these repositories, `owner/name`. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_ENTRIES)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(3, REPO_REF_MAX_LENGTH, { each: true })
  @Matches(REPO_REF_PATTERN, {
    each: true,
    message: "each repo must be owner/name, with no . or .. segment",
  })
  repos?: string[];
}

/** `POST /api/v1/knowledge/playbooks` — a hand-authored recipe. */
export class CreatePlaybookBody {
  @IsString()
  @Length(1, MAX_PLAYBOOK_NAME_LENGTH)
  @Matches(NON_BLANK, { message: "name must not be blank" })
  name!: string;

  @IsString()
  @Length(1, MAX_PLAYBOOK_DESCRIPTION_LENGTH)
  @Matches(NON_BLANK, { message: "description must not be blank" })
  description!: string;

  /** The workflow's slug. */
  @IsString()
  @Length(1, MAX_WORKFLOW_SLUG_LENGTH)
  @Matches(WORKFLOW_SLUG_PATTERN, { message: "workflow must be a workflow slug" })
  workflow!: string;

  /** A published version of it — the pin. */
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  workflowVersion!: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => SkillOverridesBody)
  skillOverrides?: SkillOverridesBody;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContextPresetBody)
  contextPreset?: ContextPresetBody;

  /** `null` or absent offers the playbook for every issue. */
  @IsOptional()
  @ValidateNested()
  @Type(() => IssueFilterBody)
  issueFilter?: IssueFilterBody | null;
}

/** `PATCH /api/v1/knowledge/playbooks/{id}` — every field optional; `issueFilter: null` clears. */
export class UpdatePlaybookBody {
  @IsOptional()
  @IsString()
  @Length(1, MAX_PLAYBOOK_NAME_LENGTH)
  @Matches(NON_BLANK, { message: "name must not be blank" })
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, MAX_PLAYBOOK_DESCRIPTION_LENGTH)
  @Matches(NON_BLANK, { message: "description must not be blank" })
  description?: string;

  /** Re-pin to another workflow; `workflowVersion` is then required. */
  @IsOptional()
  @IsString()
  @Length(1, MAX_WORKFLOW_SLUG_LENGTH)
  @Matches(WORKFLOW_SLUG_PATTERN, { message: "workflow must be a workflow slug" })
  workflow?: string;

  /** Re-pin — a published version of the (new or current) workflow. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  workflowVersion?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => SkillOverridesBody)
  skillOverrides?: SkillOverridesBody;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContextPresetBody)
  contextPreset?: ContextPresetBody;

  @IsOptional()
  @ValidateNested()
  @Type(() => IssueFilterBody)
  issueFilter?: IssueFilterBody | null;
}

/** `POST /api/v1/knowledge/playbooks/from-run` — **+ New playbook from a past run…**, named. */
export class CreatePlaybookFromRunBody {
  /** The terminal run to learn from. */
  @IsUUID()
  runId!: string;

  @IsString()
  @Length(1, MAX_PLAYBOOK_NAME_LENGTH)
  @Matches(NON_BLANK, { message: "name must not be blank" })
  name!: string;

  /** Omit to use the draft's suggested description. */
  @IsOptional()
  @IsString()
  @Length(1, MAX_PLAYBOOK_DESCRIPTION_LENGTH)
  @Matches(NON_BLANK, { message: "description must not be blank" })
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => IssueFilterBody)
  issueFilter?: IssueFilterBody | null;
}

/** `POST /api/v1/knowledge/playbooks/{id}/launch` — **Run on issue… ▾**. */
export class LaunchPlaybookBody {
  /** `github_issues.id`, as the picker lists it. */
  @IsUUID()
  issueId!: string;
}

/** `GET /api/v1/knowledge/playbooks/{id}/issues` — the picker. */
export class PlaybookIssuesQuery {
  /** A substring of the title, or an issue number (`485` or `#485`). */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;
}

/** `GET /api/v1/knowledge/playbooks/{id}/context` — the context a launch into a repo attaches. */
export class PlaybookContextQuery {
  /** `owner/name`; omit for the workspace-wide manifest. */
  @IsOptional()
  @IsString()
  @Length(3, REPO_REF_MAX_LENGTH)
  @Matches(REPO_REF_PATTERN, { message: "repo must be owner/name, with no . or .. segment" })
  repo?: string;
}

/** `:id` — a playbook. */
export class PlaybookIdParams {
  @IsUUID()
  id!: string;
}

/** `:runId` — a run. */
export class RunIdParams {
  @IsUUID()
  runId!: string;
}
