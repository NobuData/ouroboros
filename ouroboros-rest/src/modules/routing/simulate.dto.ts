/**
 * What a simulation request may contain — the `{taskKind, ctx}` of Z.4
 * ([#197](https://github.com/NobuData/ouroboros/issues/197)).
 *
 * **This is the only file in the simulate surface that decides anything**, and what it decides
 * is whether a body is a question `resolve()` can be asked. Everything past it is Z.1's
 * function, unchanged and uncopied — which is the ticket's structural criterion rather than a
 * comment about it.
 *
 * ---------------------------------------------------------------------------
 * **`ctx` mirrors `context.ts`, and the mirroring is bounded by V018's grammar rather than by
 * taste.**
 *
 * A rule's `"when"` may ask about three things — `effort_gte`, `label` and `diff_kind` — and
 * the column's own `escalation_rule_when_valid()` closes that list. A context carrying a
 * fourth fact would be carrying something no rule could ever read, so the DTO declares
 * exactly the four fields {@link ResolutionContext} does and `forbidNonWhitelisted` refuses
 * the fifth. That is what stops a client from believing a `{priority: "high"}` it invented is
 * being honoured — the same argument `registry/registry.dto.ts` makes for its query string.
 *
 * The two vocabularies are imported from `db/schema.ts` rather than written out again, for
 * `context.ts`'s reason: two lists of five sizes are one vocabulary only for as long as
 * nobody edits one of them.
 *
 * ---------------------------------------------------------------------------
 * **Every `ctx` field is optional and none of them admits `null`.**
 *
 * Optional, because a resolution asked with no context at all is a legitimate question — it is
 * what `route.task("docs")` looks like before anything has been sized or labelled — and it
 * means *no escalation rule fires*, not *every rule fires*.
 *
 * Not nullable, because `null` is a client saying something a context cannot mean. `context.ts`
 * is written so an unstated fact never satisfies a condition about it, and a `null` reaching
 * it would take the same path an absent field does while carrying a type the interface does
 * not declare. {@link present} refuses it by name instead, so the answer is a `422` naming the
 * field rather than a value that quietly behaves as though it were not sent.
 */

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";

import { DIFF_KINDS, QUEUE_EFFORTS, type DiffKind, type QueueEffort } from "../db/schema";
import type { ResolutionContext } from "./context";
import {
  MAX_ROUTING_NAME_LENGTH,
  present,
  ROUTING_NAME_MESSAGE,
  ROUTING_NAME_PATTERN,
} from "./routing.dto";

/**
 * The longest a context label may be — **one hundred**, which is V018's own bound.
 *
 * A context's label is compared against a rule's, and `escalation_rule_when_valid()` refuses a
 * rule label longer than this. Accepting a longer one here would accept a label that could
 * never match any rule the database will store.
 */
export const MAX_LABEL_LENGTH = 100;

/**
 * A label that is neither blank nor padded — V018's `label <> '' and btrim(label) = label`.
 *
 * The same shape for the same reason: labels are compared **whole and case-sensitively**
 * (see `context.ts`), so a padded label is a label that matches nothing, and a client that
 * sent one deserves to be told rather than to watch a security rule silently not fire.
 */
export const LABEL_PATTERN = /^\S(?:.*\S)?$/;

/** What a client is told when a label is blank or padded. */
export const LABEL_MESSAGE = "must not be blank or carry leading or trailing whitespace";

/**
 * How many labels one context may carry — **fifty**.
 *
 * An API bound rather than a domain rule, and it exists for `routing.dto.ts`'s
 * `MAX_CHAIN_LENGTH` reason: without one, a body is a way to make this service compare an
 * unbounded array against every rule in the workspace. Fifty is well above what GitHub's own
 * label picker puts on an issue, and low enough that one request cannot ask for arbitrary
 * work.
 */
export const MAX_CONTEXT_LABELS = 50;

/**
 * The longest a repository name may be — **one hundred and forty**, GitHub's own ceiling for
 * `owner/name` (39 + 1 + 100).
 *
 * A length and nothing more. Nothing reads `repo` yet — AB.5
 * ([#211](https://github.com/NobuData/ouroboros/issues/211)) is what will — so a pattern here
 * would be this file inventing a shape that ticket has not chosen, and refusing contexts a
 * consumer with the repository in hand today is right to send.
 */
export const MAX_REPO_LENGTH = 140;

/**
 * What is known about the work being simulated — `ctx`, as a body sends it.
 *
 * `implements ResolutionContext` deliberately: the DTO is what a client may send and the
 * interface is what `resolve()` reads, and this is the one line that makes a field added to
 * one and not the other fail to compile rather than to arrive unvalidated.
 */
export class SimulationContextDto implements ResolutionContext {
  /**
   * How big the work was sized, on V009's five-size scale.
   *
   * Absent for work nothing has estimated, which is the ordinary state of an issue that has
   * not been through the estimator yet — and an absent size is *unknown*, never *small*: see
   * `context.ts` on why a rule reading `effort_gte: "l"` does not fire on it.
   */
  @ValidateIf(present)
  @IsIn(QUEUE_EFFORTS, { message: `effort must be one of ${QUEUE_EFFORTS.join(", ")}` })
  effort?: QueueEffort;

  /**
   * The issue's labels, as GitHub spells them.
   *
   * Compared case-sensitively and whole, because GitHub's own labels are: `security` and
   * `Security` are two labels a repository may genuinely have.
   */
  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(MAX_CONTEXT_LABELS)
  @IsString({ each: true })
  @Matches(LABEL_PATTERN, { each: true, message: `each label ${LABEL_MESSAGE}` })
  @MaxLength(MAX_LABEL_LENGTH, { each: true })
  labels?: string[];

  /** How the change was classified, when something classified it. */
  @ValidateIf(present)
  @IsIn(DIFF_KINDS, { message: `diffKind must be one of ${DIFF_KINDS.join(", ")}` })
  diffKind?: DiffKind;

  /**
   * The repository the work belongs to.
   *
   * Carried and read by nothing today — see {@link MAX_REPO_LENGTH}. Accepted now so that a
   * consumer holding the repository sends it now, rather than every caller of `resolve` being
   * amended on the day AB.5 lands.
   */
  @ValidateIf(present)
  @IsString()
  @MaxLength(MAX_REPO_LENGTH)
  repo?: string;
}

/**
 * The body of `POST /api/v1/routing/simulate`.
 *
 * The ticket's `{taskKind, ctx}`, and nothing else. There is no `organizationId`: the workspace
 * is the session's, as everywhere in `/api/v1`, and a body that could name one would be a body
 * that could simulate somebody else's routes.
 */
export class SimulateRoutingDto {
  /**
   * `task_kinds.name` — the matrix row being asked about.
   *
   * Checked for *shape* here and for *existence in this workspace* by the resolution service,
   * which is the split every name in this API makes: a name outside V016's shape names
   * something no row could hold, and answering that with a `422` costs no round trip.
   */
  @IsString()
  @Matches(ROUTING_NAME_PATTERN, { message: `taskKind ${ROUTING_NAME_MESSAGE}` })
  @MaxLength(MAX_ROUTING_NAME_LENGTH)
  taskKind!: string;

  /**
   * What is known about the work, or absent for the question asked with nothing known.
   *
   * `@IsObject()` before `@ValidateNested()` because without it a `ctx` of `"large"` reaches
   * the nested validator as a string, which has none of the declared properties and therefore
   * passes — a body refused for the wrong reason is still a body accepted for the wrong shape.
   */
  @ValidateIf(present)
  @IsObject()
  @ValidateNested()
  @Type(() => SimulationContextDto)
  ctx?: SimulationContextDto;
}
