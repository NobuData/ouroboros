/**
 * What a routing-management request may contain, as `class-validator` classes
 * ([#195](https://github.com/NobuData/ouroboros/issues/195)).
 *
 * **These decorators restate V016's CHECKs, deliberately** — the same argument
 * `pricing/pricing.dto.ts` and `provider-connections/provider-connections.dto.ts` both make.
 * The database is still the authority: `route_hops_note_present`, `routes_max_cost_positive`
 * and `route_hops_position_positive` are what actually stop a blank note or a cap of zero
 * being stored. Restating them here changes only *who says no and how* — without it a
 * trimmed-to-empty note is a constraint violation surfacing as `500 internal_error`, and with
 * it, it is a `422` naming the field.
 *
 * ---------------------------------------------------------------------------
 * **`when` and `then` are validated as *objects* here and as *grammar* by PostgreSQL, and
 * that split is V018's instruction rather than an omission.**
 *
 * V018 exposes `ouroboros.escalation_rule_when_valid()` and
 * `ouroboros.escalation_rule_then_valid()` as ordinary functions, and says why:
 *
 *   > reachable on its own so Z.2's API validates a submitted rule with this definition
 *   > instead of a TypeScript copy of it.
 *
 * A copy would be a second grammar — one that agrees on the day it is written and drifts the
 * first time either is widened, with the divergence surfacing as a rule this service accepted
 * and the database refused, or worse, the reverse. So these two fields carry `@IsObject()` and
 * nothing else, and `management.service.ts` asks the database. The `422` is the same either
 * way; what differs is that there is one definition of what a rule is.
 *
 * ---------------------------------------------------------------------------
 * **A route save is a `PUT` and its body is the whole route**, which is why
 * {@link RoutePolicyDto}'s three policy fields are required rather than optional and why two
 * of them admit an explicit `null`. `PATCH` distinguishes *do not change this* from *clear
 * this* and needs the null to say the second; a `PUT` does not have the first case at all, so
 * the null means only one thing here — **off**, for the floor, and **no cap**, for the cost.
 * Making them optional would reintroduce a distinction this verb does not have, and would let
 * a client clear a floor by forgetting to send it.
 */

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";

/**
 * The shape `task_kinds.name` and `model_aliases.alias` both carry — lower-case kebab.
 *
 * V016 and V015 constrain both columns to it, so a name outside this shape names something
 * neither table could hold. Checked here so that is a `422` rather than a round trip that
 * ends in a `404`.
 */
export const ROUTING_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** What a client is told when a name is not one. Written once, used by every name field. */
export const ROUTING_NAME_MESSAGE =
  "must be lower-case letters, digits and single hyphens — the shape a task kind and an alias have";

/** The longest a task kind or an alias may be — V015's and V016's own bound. */
export const MAX_ROUTING_NAME_LENGTH = 64;

/** A hop note that is neither blank nor padded — V016's `btrim(note) = note and note <> ''`. */
export const HOP_NOTE_PATTERN = /^\S(?:.*\S)?$/s;

/** What a client is told when a note is blank or padded. */
export const HOP_NOTE_MESSAGE = "must not be blank or carry leading or trailing whitespace";

/** The longest hop note V016 will store. */
export const MAX_HOP_NOTE_LENGTH = 200;

/**
 * The longest chain one route may have — **twenty**.
 *
 * V016 bounds neither the chain nor the floor, and it is right not to: density and ordering
 * are what it is about. This is an API bound rather than a domain rule, and it exists for
 * `provider-connections`' `MAX_CONFIG_FIELDS` reason — without one, a body is a way to make
 * this service write an unbounded number of rows in a single transaction. Twenty is
 * comfortably above the mockup's longest chain (three) and above any chain a workspace with
 * five providers could fill.
 */
export const MAX_CHAIN_LENGTH = 20;

/**
 * How many routes one **Save routes** may commit — **sixty-four**.
 *
 * Eight times the mockup's eight task kinds, so a workspace that has grown its matrix still
 * saves it in one press, and low enough that one request cannot ask this service to hold an
 * arbitrary matrix in memory and rewrite every chain in it.
 */
export const MAX_ROUTES_PER_SAVE = 64;

/**
 * The largest `max_cost_cents_per_run` the column can hold — `integer`'s maximum.
 *
 * Bounded here rather than left to PostgreSQL because an out-of-range `integer` is a `22003`
 * from the driver, and the client that sent a cap of ten billion deserves to be told which
 * field was out of range rather than reading `internal_error`.
 */
export const MAX_COST_CENTS_PER_RUN = 2_147_483_647;

/** The largest `escalation_rules.sort_order` the column can hold, for {@link MAX_COST_CENTS_PER_RUN}'s reason. */
export const MAX_RULE_SORT_ORDER = 2_147_483_647;

/**
 * Whether a field was sent at all — the condition every optional rule field is validated
 * under.
 *
 * Deliberately **not** `@IsOptional()`, which treats `null` as absent and would let a body
 * carrying a `when` of `null` through as *leave this alone*. A rule has no clearable parts —
 * `when` and `then` are `not null` columns, `enabled` is a switch with two positions — so an
 * explicit `null` is a request nothing can honour, and being told so beats being silently
 * ignored.
 *
 * @param _body - The object being validated. Unused; the value is what decides.
 * @param value - What the field carries.
 * @returns Whether the validators below should run.
 */
function present(_body: object, value: unknown): boolean {
  return value !== undefined;
}

/**
 * One hop of a chain, as a client sends it.
 *
 * **There is no `position`.** The array's order *is* the chain's order — the mockup's hint is
 * *"drag ⠿ to reorder fallback chains"*, and a client that dragged hop 3 above hop 2 should
 * send the array it now draws rather than compute two new numbers for it. Positions are
 * assigned server-side from the index, which is also what makes V016's density rule
 * unbreakable from here: a dense array cannot produce a sparse chain.
 *
 * **And there is no model id** — decision **M1**. A hop names an alias, and the raw provider
 * model string lives in `model_aliases.model_id` and nowhere else.
 */
export class RouteHopDto {
  /**
   * `model_aliases.alias` — `coder-max`, `local-docs`.
   *
   * Checked for *shape* here and for *existence in this workspace* by the service, which is
   * the split every name field in this API makes: a name this workspace does not have is a
   * `422` naming the field, and it takes a statement to discover.
   */
  @IsString()
  @Matches(ROUTING_NAME_PATTERN, { message: `alias ${ROUTING_NAME_MESSAGE}` })
  @MaxLength(MAX_ROUTING_NAME_LENGTH)
  alias!: string;

  /**
   * The inspector's hop-meta line — *"Fallback on 5xx / timeouts"*. Absent or `null` for a
   * hop nobody wrote one for, which is most of them.
   *
   * `@IsOptional()` treats both the same way on purpose: on a `PUT` there is no *leave this
   * alone*, so an omitted note and an explicit `null` are one state — the hop has no note.
   */
  @IsOptional()
  @IsString()
  @Matches(HOP_NOTE_PATTERN, { message: `note ${HOP_NOTE_MESSAGE}` })
  @MaxLength(MAX_HOP_NOTE_LENGTH)
  note?: string | null;
}

/**
 * One route's chain and its policy triple — the inspector, as a body.
 *
 * Extended rather than repeated by {@link SaveRouteDto}, so the single-route `PUT` and the
 * batch cannot come to disagree about what a route save contains.
 */
export class RoutePolicyDto {
  /**
   * The chain, primary first.
   *
   * `@ArrayMinSize(1)` is the ticket's *empty chain* → `422`, and it is here rather than in
   * the service because it is a fact about the request rather than about the workspace:
   * V016's `route_chain_intact()` refuses a route with no hops, so an empty array could never
   * be stored by anything.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CHAIN_LENGTH)
  @ValidateNested({ each: true })
  @Type(() => RouteHopDto)
  hops!: RouteHopDto[];

  /** Mockup 06's **Allow fallback to local models** switch. A switch has two positions, so there is no null. */
  @IsBoolean()
  allowLocalFallback!: boolean;

  /**
   * Mockup 06's **Fail run instead of degrading below fallback N**, as the hop number it is
   * really about — or `null` for the switch being off.
   *
   * Required, and `null` is how *off* is said: see this file's header on why a `PUT` has no
   * omitted-means-unchanged case. That it is not deeper than the chain **sent with it** is
   * the service's check, because the chain is in the same body and the answer has to be
   * about the route as it will be rather than as it was.
   */
  @ValidateIf((body: RoutePolicyDto) => body.floorHopIndex !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_CHAIN_LENGTH)
  floorHopIndex!: number | null;

  /**
   * Mockup 06's **Max cost per run**, in **integer cents** — `$2.50` is `250`. `null` for no
   * cap.
   *
   * Cents rather than a float for V012's reason, restated by V016: money in a float is a
   * rounding error waiting to be discovered by an invoice. `@Min(1)` is
   * `routes_max_cost_positive` — a cap of zero is not a cap, it is a route that can never
   * run, and `null` is how *no cap* is said.
   */
  @ValidateIf((body: RoutePolicyDto) => body.maxCostCentsPerRun !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_COST_CENTS_PER_RUN)
  maxCostCentsPerRun!: number | null;
}

/** One entry of a batch — a route, plus the task kind that says which one. */
export class SaveRouteDto extends RoutePolicyDto {
  /**
   * `task_kinds.name` — the matrix row this entry edits.
   *
   * In the body rather than in a path because a batch commits many at once. The single-route
   * `PUT` takes it from the path instead and builds the same object, so there is one save.
   */
  @IsString()
  @Matches(ROUTING_NAME_PATTERN, { message: `taskKind ${ROUTING_NAME_MESSAGE}` })
  @MaxLength(MAX_ROUTING_NAME_LENGTH)
  taskKind!: string;
}

/**
 * The body of `PUT /api/v1/routing/routes` — one press of **Save routes**.
 *
 * An object with one array rather than a bare array, for the reason every list response in
 * this API is an object: a top-level array has nowhere to grow a field, and the first thing a
 * batch commit wants is one (*"and mark this revision with a note"*).
 */
export class SaveRoutesDto {
  /**
   * The routes to commit, in any order.
   *
   * A task kind may appear once. Twice is a body that says two different things about one
   * row, and the service refuses it rather than letting the later entry silently win.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ROUTES_PER_SAVE)
  @ValidateNested({ each: true })
  @Type(() => SaveRouteDto)
  routes!: SaveRouteDto[];
}

/** The `{taskKind}` of the single-route save. */
export class TaskKindParams {
  /**
   * `task_kinds.name`.
   *
   * A shape check rather than a bare string, so a path segment that could not name a kind is
   * a `422` before a statement is issued.
   */
  @IsString()
  @Matches(ROUTING_NAME_PATTERN, { message: `taskKind ${ROUTING_NAME_MESSAGE}` })
  @MaxLength(MAX_ROUTING_NAME_LENGTH)
  taskKind!: string;
}

/** The `{id}` every rule operation below the collection takes. */
export class RuleParams {
  /**
   * `escalation_rules.id`.
   *
   * A uuid check rather than a bare string, so a path that could not name a row is a `422`
   * before a statement is issued — and so a caller cannot use this path to send arbitrary
   * text into a `where` clause's parameter, which costs a round trip to answer `404`.
   */
  @IsUUID()
  id!: string;
}

/**
 * The body of `POST /api/v1/routing/rules`.
 *
 * **There is no `display`, and its absence is the enforcement.** Decision **M5** says the
 * sentence is derived from the structure, and the pipe is configured `forbidNonWhitelisted`
 * — so a body carrying one is a `422 validation_failed` naming `display` rather than a value
 * this service quietly discards. Three layers say the same thing and none of them is
 * redundant: the DTO refuses the property, `EscalationRulesTable.display` is
 * `ColumnType<string, never, never>` so an insert naming it does not compile, and the column
 * is `generated always … stored` so PostgreSQL would refuse it anyway.
 */
export class CreateRuleDto {
  /**
   * The card's switch. Absent means **on** — V018 defaults it to `true`, and the only reason
   * to write a rule is to have it apply.
   */
  @ValidateIf(present)
  @IsBoolean()
  enabled?: boolean;

  /**
   * Where this rule evaluates; 1 is first. Absent means **appended** — one past the highest
   * this workspace holds.
   *
   * Appending rather than defaulting to 1 is what makes **+ Add rule** a button rather than a
   * decision: a new rule that silently claimed the first position would change what every
   * existing rule does.
   */
  @ValidateIf(present)
  @IsInt()
  @Min(1)
  @Max(MAX_RULE_SORT_ORDER)
  sortOrder?: number;

  /** The predicate — the WF-P8 grammar as routing scopes it. Grammar checked by the database; see the header. */
  @IsObject()
  when!: Record<string, unknown>;

  /** The route modification — exactly one of `use_alias`, `add_vote`, `route_local`. Likewise. */
  @IsObject()
  then!: Record<string, unknown>;
}

/**
 * The body of `PATCH /api/v1/routing/rules/{id}`.
 *
 * A `PATCH` rather than a `PUT`, and the mockup is the argument: the rules card's affordance
 * is a **switch**, and *turn this one off* should not require a client to resend a predicate
 * and an action it has no intention of changing — nor risk rewriting them from a stale copy.
 *
 * Every field is optional and **none of them admits `null`**: a rule has no clearable parts.
 * `when` and `then` are `not null` columns, `enabled` is a switch with two positions, and
 * `sort_order` is where the rule sits. An empty body is legal and changes nothing, which is
 * the honest answer to a request that asked for nothing.
 */
export class UpdateRuleDto {
  /** The card's switch. */
  @ValidateIf(present)
  @IsBoolean()
  enabled?: boolean;

  /** Where this rule evaluates; 1 is first. */
  @ValidateIf(present)
  @IsInt()
  @Min(1)
  @Max(MAX_RULE_SORT_ORDER)
  sortOrder?: number;

  /** The predicate, replaced whole. There is no patching *inside* a predicate: a condition removed and a condition never sent are the same request. */
  @ValidateIf(present)
  @IsObject()
  when?: Record<string, unknown>;

  /** The route modification, replaced whole, for the same reason. */
  @ValidateIf(present)
  @IsObject()
  then?: Record<string, unknown>;
}
