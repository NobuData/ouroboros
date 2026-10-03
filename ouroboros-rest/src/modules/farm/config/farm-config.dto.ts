/**
 * What the farm configuration routes accept (BV.5, [#514](https://github.com/NobuData/ouroboros/issues/514)):
 * a time-windowed pool assignment and a job hook, with V040's and V088's CHECKs restated as `422`s.
 *
 * Runners and pools are named as a person names them — `forge-02`, `pool-a` — because that is how
 * the Build Analyzer's suggestion and the farm page both say them; the service resolves the names
 * inside the session's workspace.
 */

import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  Validate,
} from "class-validator";

import { REPO_REF_MAX_LENGTH, REPO_REF_PATTERN } from "../../onboarding/onboarding.dto";
import { IsArgv } from "../dispatch/jobs.dto";

/** `HH:MM`, 24-hour, UTC. */
export const UTC_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** A runner's or pool's name, as V040 shapes them. */
const NAME_MAX_LENGTH = 128;

/** `POST /api/v1/farm/pool-windows` — a runner joins a pool for a window of the day. */
export class CreatePoolWindowBody {
  /** The runner, by name. */
  @IsString()
  @Length(1, NAME_MAX_LENGTH)
  runner!: string;

  /** The pool it joins during the window, by name. */
  @IsString()
  @Length(1, NAME_MAX_LENGTH)
  pool!: string;

  /** ISO weekdays the window applies on, 1 = Monday. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  daysOfWeek!: number[];

  /** When the window opens, `HH:MM` UTC. */
  @Matches(UTC_TIME_PATTERN, { message: "startsAt must be HH:MM, 24-hour, UTC" })
  startsAt!: string;

  /** When it closes, `HH:MM` UTC — later than `startsAt`: a window lies inside one day. */
  @Matches(UTC_TIME_PATTERN, { message: "endsAt must be HH:MM, 24-hour, UTC" })
  endsAt!: string;
}

/** `POST /api/v1/farm/job-hooks` — a job the farm submits on every matching merge. */
export class CreateJobHookBody {
  /** The repository whose merges fire it, `owner/name`. */
  @IsString()
  @Length(3, REPO_REF_MAX_LENGTH)
  @Matches(REPO_REF_PATTERN, { message: "repo must be owner/name, with no . or .. segment" })
  repo!: string;

  /** The pool the job runs in, by name. */
  @IsString()
  @Length(1, NAME_MAX_LENGTH)
  pool!: string;

  /** The event — `merge`, the one there is. */
  @IsIn(["merge"])
  event!: "merge";

  /** Only merges whose title contains this, case-insensitively; every merge when absent. */
  @IsOptional()
  @IsString()
  @Length(1, 256)
  @Matches(/\S/, { message: "titleContains must not be blank" })
  titleContains?: string;

  /** The short label the runners table prints. */
  @IsString()
  @Length(1, 128)
  @Matches(/\S/, { message: "label must not be blank" })
  label!: string;

  /** The job's one-line title. */
  @IsString()
  @Length(1, 512)
  @Matches(/\S/, { message: "title must not be blank" })
  title!: string;

  /** argv, as a build submission takes it. */
  @Validate(IsArgv)
  command!: string[];
}
