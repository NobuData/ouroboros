/**
 * `ouroboros-engine`'s `/v0` contract, mirrored — the shapes, the routes, and the header.
 *
 * The engine publishes a versioned contract and this service is its only caller
 * (`docs/ARCHITECTURE.md` § 5.2). Mirroring it *here* rather than inside the client is what
 * makes the mirror reviewable: this file and
 * [`ouroboros-engine/openapi.yaml`](../../../../ouroboros-engine/openapi.yaml) can be read
 * side by side, and nothing else in this service needs to know what the engine's JSON looks
 * like.
 *
 * Three decisions about how it is mirrored:
 *
 *   * **The wire is parsed, not asserted.** Every response goes through a zod schema before
 *     a caller sees it, so an engine that answered with something else — a proxy's error
 *     page, an older build, a field that changed type — is a `502` at the boundary rather
 *     than an `undefined` several layers into a handler. A cast would have compiled and been
 *     wrong at exactly the moment it mattered.
 *   * **Unknown fields are ignored rather than refused.** `/v0` is unstable by definition
 *     and its compatibility rule says a field may be *added* to a response; a client that
 *     rejected one would turn every forward-compatible engine release into an outage here.
 *     zod's default is to strip, which is that rule spelled correctly, and the fields this
 *     service actually reads are the ones below.
 *   * **The naming convention changes at this boundary.** The engine speaks `snake_case`
 *     because it is Python; this service and its own API speak `camelCase`. The translation
 *     happens once, in the schemas' `transform`, so no NestJS code below this file carries
 *     `uptime_seconds` and no reader has to remember which side of the boundary they are on.
 */

import { z } from "zod";

/**
 * The header the shared secret travels on.
 *
 * Written the way `ouroboros-engine/src/ouroboros_engine/core/security.py` writes it, and
 * the value is `OURO_ENGINE_SHARED_SECRET` — the same variable on both sides.
 */
export const INTERNAL_KEY_HEADER = "X-Ouro-Internal-Key";

/** The engine's versioned prefix. A breaking change to the contract is a new one. */
export const ENGINE_API_VERSION = "v0";

/** `GET` — which build is answering, and for how long it has been. */
export const ENGINE_STATUS_ROUTE = `${ENGINE_API_VERSION}/status`;

/** `POST` — the contract exemplar: a task, handed straight back. */
export const ENGINE_ECHO_ROUTE = `${ENGINE_API_VERSION}/tasks/echo`;

/**
 * Resolve a route against the engine's base URL.
 *
 * Resolved against a base with a trailing slash rather than concatenated, so a base URL
 * that carries a path — an engine behind a reverse proxy on `/engine`, which is a
 * deployment decision this service does not get to make — keeps it. `new URL("v0/status",
 * "http://host/engine")` would drop the `/engine`; `new URL("v0/status",
 * "http://host/engine/")` does not.
 *
 * @param baseUrl - `OURO_ENGINE_URL`, already validated as an absolute `http(s)` URL by the
 *   configuration schema.
 * @param route - A route relative to it, without a leading slash — one of the constants
 *   above, or `health.ENGINE_HEALTH_ROUTE`.
 * @returns The absolute URL to call.
 */
export function engineRouteUrl(baseUrl: string, route: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(route, base).toString();
}

/** What `GET /v0/status` answers, in this service's names. */
export interface EngineStatus {
  /** The engine's distribution name — constant across deployments. */
  service: string;
  /** The installed version of the build that answered. */
  version: string;
  /** Seconds since that process built its application. */
  uptimeSeconds: number;
}

/** A task for `POST /v0/tasks/echo`, in this service's names. */
export interface EchoTask {
  /** Which kind of task this is, as the engine's registry would name it. */
  taskKind: string;
  /** The task's own arguments. Opaque to this service — it brokers, it does not read. */
  payload: Record<string, unknown>;
}

/** What `POST /v0/tasks/echo` answers, in this service's names. */
export interface EchoResult {
  /** Always `true`: a task the engine did not accept is an error, not a `false`. */
  accepted: true;
  /** The task as the engine parsed it — what it understood, not what was sent. */
  echo: EchoTask;
  /** The installed version of the build that accepted it. */
  engineVersion: string;
}

/** `GET /v0/status`, as it arrives. */
export const engineStatusSchema = z
  .object({
    service: z.string(),
    version: z.string(),
    uptime_seconds: z.number(),
  })
  .transform((body): EngineStatus => ({
    service: body.service,
    version: body.version,
    uptimeSeconds: body.uptime_seconds,
  }));

/** The task shape, in both directions — it is the request body and the `echo` in the answer. */
const echoTaskSchema = z
  .object({
    task_kind: z.string(),
    payload: z.record(z.string(), z.unknown()),
  })
  .transform((body): EchoTask => ({ taskKind: body.task_kind, payload: body.payload }));

/** `POST /v0/tasks/echo`, as it arrives. */
export const echoResultSchema = z
  .object({
    // The engine documents this as `const: true`, so anything else is an engine this
    // client does not understand rather than a task that was declined.
    accepted: z.literal(true),
    echo: echoTaskSchema,
    engine_version: z.string(),
  })
  .transform((body): EchoResult => ({
    accepted: body.accepted,
    echo: body.echo,
    engineVersion: body.engine_version,
  }));

/**
 * A task, as the engine's request body.
 *
 * The only place this service writes `snake_case`, and the counterpart of the schemas
 * above — so the translation is in one file in both directions.
 *
 * @param task - The task to send.
 * @returns The body to serialise.
 */
export function echoRequestBody(task: EchoTask): Record<string, unknown> {
  return { task_kind: task.taskKind, payload: task.payload };
}

/** `POST` — size one issue. The estimation pipeline's first engine call (#105). */
export const ENGINE_ESTIMATE_ROUTE = `${ENGINE_API_VERSION}/estimate`;

/**
 * How much work an issue is, as the engine answers and as `issue_estimates` stores.
 *
 * A closed set on three sides — the engine's `enum`, the column's CHECK, and the effort chip
 * the backlog table renders — so mirroring it as an enum here is where a disagreement is
 * caught first and most cheaply. Widening it is a coordinated change to all three, in that
 * order, and not something a release does to one of them alone.
 */
export const ESTIMATE_EFFORTS = ["xs", "s", "m", "l", "xl"] as const;

/** One of {@link ESTIMATE_EFFORTS}. */
export type Effort = (typeof ESTIMATE_EFFORTS)[number];

/** How likely the change is to break something. Closed on the same three sides as effort. */
export const ESTIMATE_RISKS = ["low", "medium", "high"] as const;

/** One of {@link ESTIMATE_RISKS}. */
export type Risk = (typeof ESTIMATE_RISKS)[number];

/** The issue to size, as much of it as an estimator reads. */
export interface IssueContext {
  /** The issue's number within its repository — GitHub's, not a database id. */
  number: number;
  /** The issue title, as GitHub holds it. */
  title: string;
  /** The description in full, or `null` for an issue opened without one. */
  body: string | null;
  /** GitHub's label *names* — the heuristic estimator's strongest signal. */
  labels: string[];
  /** `owner/name`. */
  repo: string;
}

/**
 * The vocabularies this installation has, which the engine is told rather than assumed to
 * know.
 *
 * Roadmap decisions **K5** and **K6**: a workflow tag and a routed model are opaque strings
 * the engine ascribes no meaning to, and the set of them is *this* service's. So they travel
 * with every request, and an estimate naming anything outside them is refused inside the
 * engine before it is answered — which is why nothing here has to re-check the answer.
 */
export interface EstimationContext {
  /** Every workflow tag that exists, as the tag chip renders one. At least one. */
  workflowTags: string[];
  /** Models an estimate may route to, keyed by the class of work each is the default for. */
  modelDefaults: Record<string, string>;
}

/** A request to size one issue. */
export interface EstimateRequest {
  /** The issue to size. */
  issue: IssueContext;
  /** The vocabularies an answer may use. */
  context: EstimationContext;
}

/** The *AI Work Breakdown* panel's numbers — `issue_estimates.breakdown`, exactly. */
export interface EstimateBreakdown {
  /** Paths the work is believed to touch. Empty is a real answer, never a promise. */
  files: string[];
  /** What the *work* is expected to cost in model tokens — not what the estimate cost. */
  estTokens: number;
  /** The optimistic end of the wall-clock range, in minutes. */
  cycleMin: number;
  /** The pessimistic end, in minutes. */
  cycleMax: number;
  /** The single number the queue plans with, in minutes. Not confined to the range above. */
  estMinutes: number;
}

/** Where the estimate came from — `issue_estimates.trace`, minus the clock the writer owns. */
export interface EstimateTrace {
  /** What produced it: `heuristic-v0` today, a model id when #123 lands. Never empty. */
  estimator: string;
  /** What producing the estimate cost in model tokens. `0` for a rule engine. */
  tokensUsed: number;
  /** What the answer was reached from, one line each. */
  signals: string[];
}

/**
 * One version of an `issue_estimates` row, as the engine answers it.
 *
 * The response mirrors that table field for field, so the orchestration that persists it
 * ([#107](https://github.com/NobuData/ouroboros/issues/107)) writes an answer rather than
 * translating one. The columns with no field here are this side's: the row's id, the issue it
 * belongs to, its version, its `created_at`, and `trace.sized_at` — the engine does not own
 * the clock, and a timestamp in a response body is one two services can disagree about.
 */
export interface Estimate {
  /** How much work it is. */
  effort: Effort;
  /** How much the estimator trusts its own answer, 0-100. A low one routes to needs_human. */
  confidence: number;
  /** Which workflow should run it — always one of the tags the request offered. */
  suggestedWorkflow: string;
  /** Which model it should run on — always one of the defaults the request offered. */
  routedModel: string;
  /** The breakdown panel's numbers. */
  breakdown: EstimateBreakdown;
  /** How likely the change is to break something. */
  risk: Risk;
  /** The sentence under the meter, saying why. Never empty. */
  riskNote: string;
  /** What produced the estimate, and from what. */
  trace: EstimateTrace;
}

/** The breakdown, as it arrives. */
const estimateBreakdownSchema = z
  .object({
    files: z.array(z.string()),
    est_tokens: z.number(),
    cycle_min: z.number(),
    cycle_max: z.number(),
    est_minutes: z.number(),
  })
  .transform((body): EstimateBreakdown => ({
    files: body.files,
    estTokens: body.est_tokens,
    cycleMin: body.cycle_min,
    cycleMax: body.cycle_max,
    estMinutes: body.est_minutes,
  }));

/** The trace, as it arrives. */
const estimateTraceSchema = z
  .object({
    // Non-empty rather than merely present: roadmap decision **K10** says an estimate that
    // cannot say what produced it does not get to exist, and `issue_estimates` enforces the
    // same thing with a `not null`. An empty string would satisfy that column and mean
    // nothing, so it is refused here — one hop earlier than the database would.
    estimator: z.string().min(1),
    tokens_used: z.number(),
    signals: z.array(z.string()),
  })
  .transform((body): EstimateTrace => ({
    estimator: body.estimator,
    tokensUsed: body.tokens_used,
    signals: body.signals,
  }));

/**
 * `POST /v0/estimate`, as it arrives.
 *
 * **A `202` is not parsed here, and that is on purpose.** The engine specifies a
 * `202`-plus-poll escalation for the LLM estimator
 * ([#123](https://github.com/NobuData/ouroboros/issues/123)) and cannot answer one yet, so a
 * `202` reaching this schema would fail to parse and become a `502` — the right answer for a
 * response this service does not yet know how to follow. The poll arrives with the estimator
 * that needs it, as a second schema beside this one; nothing about this one changes.
 */
export const estimateSchema = z
  .object({
    effort: z.enum(ESTIMATE_EFFORTS),
    confidence: z.number(),
    suggested_workflow: z.string(),
    routed_model: z.string(),
    breakdown: estimateBreakdownSchema,
    risk: z.enum(ESTIMATE_RISKS),
    risk_note: z.string(),
    trace: estimateTraceSchema,
  })
  .transform((body): Estimate => ({
    effort: body.effort,
    confidence: body.confidence,
    suggestedWorkflow: body.suggested_workflow,
    routedModel: body.routed_model,
    breakdown: body.breakdown,
    risk: body.risk,
    riskNote: body.risk_note,
    trace: body.trace,
  }));

/**
 * A sizing request, as the engine's request body.
 *
 * The counterpart of {@link estimateSchema} and the other half of this file's one rule about
 * naming: `camelCase` above this line, `snake_case` below it, and the translation nowhere
 * else.
 *
 * @param request - The issue to size and the vocabularies an answer may use.
 * @returns The body to serialise.
 */
export function estimateRequestBody(request: EstimateRequest): Record<string, unknown> {
  return {
    issue: {
      number: request.issue.number,
      title: request.issue.title,
      body: request.issue.body,
      labels: request.issue.labels,
      repo: request.issue.repo,
    },
    context: {
      workflow_tags: request.context.workflowTags,
      model_defaults: request.context.modelDefaults,
    },
  };
}

/**
 * `POST` — the engine's opinion on a workflow definition. R.2
 * ([#144](https://github.com/NobuData/ouroboros/issues/144)), and the second half of P.3's
 * publish gate ([#134](https://github.com/NobuData/ouroboros/issues/134)).
 *
 * Mirrored from `ouroboros-engine/openapi.yaml`'s `WorkflowValidateRequest` and
 * `WorkflowValidation`, like every other route in this file, and `engine.contract.spec.ts`
 * asserts the route and the fields read below. The engine publishes `POST
 * /v0/workflows/dry-run` beside it, mirrored after this route's shapes — the studio's dry-run
 * flow (S.6, [#152](https://github.com/NobuData/ouroboros/issues/152)) is its caller.
 */
export const ENGINE_WORKFLOW_VALIDATE_ROUTE = `${ENGINE_API_VERSION}/workflows/validate`;

/** The endpoints of the edge a finding anchors to, when it anchors to one. */
export interface EngineEdgeAnchor {
  /** The edge's `from`, verbatim — including when it names no node. */
  from: string;
  /** The edge's `to`, verbatim. */
  to: string;
}

/**
 * One thing the engine says is wrong with a definition, and where.
 *
 * Deliberately the shape `dsl.errors.ts`' `DslDiagnostic` has, minus the fields the engine
 * does not promise: the studio anchors a finding to a node by `node`, and a finding from
 * either validator has to be clickable the same way. What the two do **not** share is a
 * type — the engine's codes are its own vocabulary, and typing this as `DslErrorCode` would
 * be this service asserting something about another service's strings.
 */
export interface EngineFinding {
  /** Which rule broke, in the engine's vocabulary. Never empty. */
  code: string;
  /** What a person should read. */
  message: string;
  /** The node this anchors to, when it anchors to one. */
  node?: string;
  /** The edge this anchors to, when it anchors to one. */
  edge?: EngineEdgeAnchor;
  /** An RFC 6901 JSON Pointer to the offending value, when the engine reports one. */
  path?: string;
}

/** What `POST /v0/workflows/validate` answers, in this service's names. */
export interface EngineWorkflowValidation {
  /** Everything the engine found. Empty is the green verdict — there is no separate flag. */
  findings: EngineFinding[];
}

/** The edge anchor, as it arrives. */
const engineEdgeAnchorSchema = z
  .object({ from: z.string(), to: z.string() })
  .transform((body): EngineEdgeAnchor => ({ from: body.from, to: body.to }));

/**
 * One finding, as it arrives.
 *
 * `code` and `message` are required and everything else is optional, which is the engine's
 * `WorkflowFinding` read leniently — it always sends `path`, and leaves out `node_id` and `edge`
 * when a finding has no such anchor: a finding that anchors to nothing is a finding about the document,
 * and a validator that had to invent a node id to report one would anchor it to the wrong
 * place. `null` is admitted beside absence for each optional field, because a Python service
 * serialising a dataclass sends `null` for an unset field far more often than it omits it,
 * and refusing that would turn an ordinary answer into a `502`.
 */
const engineFindingSchema = z
  .object({
    code: z.string().min(1),
    message: z.string(),
    node_id: z.string().nullish(),
    edge: engineEdgeAnchorSchema.nullish(),
    path: z.string().nullish(),
  })
  .transform((body): EngineFinding => ({
    code: body.code,
    message: body.message,
    ...(body.node_id == null ? {} : { node: body.node_id }),
    ...(body.edge == null ? {} : { edge: body.edge }),
    ...(body.path == null ? {} : { path: body.path }),
  }));

/** `POST /v0/workflows/validate`, as it arrives. */
export const engineWorkflowValidationSchema = z
  .object({ findings: z.array(engineFindingSchema) })
  .transform((body): EngineWorkflowValidation => ({ findings: body.findings }));

/**
 * A definition, as the engine's request body.
 *
 * @param definition - The document to validate, exactly as it is stored. Opaque to this
 *   function: what makes a document valid is the DSL's question and the engine's, and a
 *   gateway that reshaped it on the way would be asking about a different document than the
 *   one publishing is about to make immutable.
 * @returns The body to serialise.
 */
export function workflowValidateRequestBody(definition: unknown): Record<string, unknown> {
  return { definition };
}

/**
 * `POST` — the engine's simulation of one workflow for one ticket. R.2
 * ([#144](https://github.com/NobuData/ouroboros/issues/144)), called by the studio's **Dry run
 * with issue #485** (S.6, [#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * Mirrored from `ouroboros-engine/openapi.yaml`'s `WorkflowDryRunRequest` and `WorkflowDryRun`.
 * The simulator makes no model call and fetches nothing — the ticket is what this service sends —
 * so the request carries the three facts a predicate can test and the key every explanation names
 * the ticket by.
 */
export const ENGINE_WORKFLOW_DRY_RUN_ROUTE = `${ENGINE_API_VERSION}/workflows/dry-run`;

/** The trackers a dry-run ticket may come from — `ticket_sources.kind`'s vocabulary. */
export const DRY_RUN_SOURCES = ["github", "gitlab", "jira", "linear"] as const;

/** One of the four. */
export type DryRunSource = (typeof DRY_RUN_SOURCES)[number];

/** What the walk did with an edge: followed it, did not, or reported a loop it never walks. */
export const DRY_RUN_EDGE_OUTCOMES = ["taken", "not_taken", "loop"] as const;

/** One of the three. */
export type DryRunEdgeOutcome = (typeof DRY_RUN_EDGE_OUTCOMES)[number];

/** What the walk concluded about a stage it reached. */
export const DRY_RUN_STEP_VERDICTS = [
  "matched",
  "not_matched",
  "reached",
  "halted",
  "ended",
] as const;

/** One of the five. */
export type DryRunStepVerdict = (typeof DRY_RUN_STEP_VERDICTS)[number];

/** What the walk concluded about any stage — a step's verdict, or `not_reached`. */
export const DRY_RUN_NODE_VERDICTS = [...DRY_RUN_STEP_VERDICTS, "not_reached"] as const;

/** One of the six. */
export type DryRunNodeVerdict = (typeof DRY_RUN_NODE_VERDICTS)[number];

/** The ticket a dry run is about, in this service's names. */
export interface EngineDryRunTicket {
  /** The display form every explanation names it by — `#485`. */
  externalKey: string;
  /** Which tracker it came from. */
  source: DryRunSource;
  /** The tracker's label names, compared exactly as the tracker spells them. */
  labels: readonly string[];
  /** The estimate in force, or `null` for a ticket nobody has sized — stated, never omitted. */
  estimate: { effort: Effort } | null;
}

/** One predicate tested against the ticket. */
export interface EnginePredicateEvaluation {
  /** Whether it holds. */
  holds: boolean;
  /** `true` when it reads what only a run produces — check results — and `holds` is assumed. */
  assumed: boolean;
  /** Why, in one sentence. */
  explanation: string;
}

/** One edge out of a stage on the walk, and what the walk did with it. */
export interface EngineDryRunEdge {
  /** The stage it leaves. */
  from: string;
  /** The stage it arrives at. */
  to: string;
  /** Its kind, as the document says — `default`, `branch` or `loop`. */
  kind: string;
  /** What the canvas prints beside it, or `null`. */
  label: string | null;
  /** Whether the walk followed it. */
  outcome: DryRunEdgeOutcome;
  /** Why — for a branch not taken, the road not taken, explained. */
  explanation: string;
  /** Its condition tested against the ticket, or `null` when it has none. */
  evaluation: EnginePredicateEvaluation | null;
  /** For a loop, the retry bound of the stage it returns to; `null` otherwise, or when undeclared. */
  maxRetries: number | null;
}

/** One stage the walk reached, in the order it reached them. */
export interface EngineDryRunStep {
  /** The stage's id. */
  nodeId: string;
  /** Which of the DSL's node types it is. */
  type: string;
  /** What the canvas prints as its name. */
  title: string;
  /** What the walk concluded. */
  verdict: DryRunStepVerdict;
  /** What the stage would do or require, said without doing it. */
  annotation: string;
  /** The trigger's conditions or a fork's predicate, tested; `null` for any other stage. */
  evaluation: EnginePredicateEvaluation | null;
  /** Every edge out of the stage, in document order, each with its outcome. */
  edges: EngineDryRunEdge[];
}

/** What the walk concluded about one stage, walked or not. */
export interface EngineNodeVerdict {
  /** The stage's id. */
  nodeId: string;
  /** The verdict. */
  verdict: DryRunNodeVerdict;
  /** Why. */
  explanation: string;
}

/** What `POST /v0/workflows/dry-run` answers, in this service's names. */
export interface EngineWorkflowDryRun {
  /** The definition's errors. Non-empty means nothing was walked and the three lists are empty. */
  findings: EngineFinding[];
  /** The ordered walk. */
  steps: EngineDryRunStep[];
  /** One verdict per stage, in document order. */
  verdicts: EngineNodeVerdict[];
  /** Every edge the walk took, in the order it took them — what the canvas paints. */
  highlightPath: EngineEdgeAnchor[];
}

/** A predicate evaluation, as it arrives. */
const enginePredicateEvaluationSchema = z
  .object({ holds: z.boolean(), assumed: z.boolean(), explanation: z.string() })
  .transform((body): EnginePredicateEvaluation => ({
    holds: body.holds,
    assumed: body.assumed,
    explanation: body.explanation,
  }));

/** One edge of a step, as it arrives. */
const engineDryRunEdgeSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    kind: z.string(),
    label: z.string().nullable(),
    outcome: z.enum(DRY_RUN_EDGE_OUTCOMES),
    explanation: z.string(),
    evaluation: enginePredicateEvaluationSchema.nullable(),
    max_retries: z.number().int().min(0).nullable(),
  })
  .transform((body): EngineDryRunEdge => ({
    from: body.from,
    to: body.to,
    kind: body.kind,
    label: body.label,
    outcome: body.outcome,
    explanation: body.explanation,
    evaluation: body.evaluation,
    maxRetries: body.max_retries,
  }));

/** One step, as it arrives. */
const engineDryRunStepSchema = z
  .object({
    node_id: z.string(),
    type: z.string(),
    title: z.string(),
    verdict: z.enum(DRY_RUN_STEP_VERDICTS),
    annotation: z.string(),
    evaluation: enginePredicateEvaluationSchema.nullable(),
    edges: z.array(engineDryRunEdgeSchema),
  })
  .transform((body): EngineDryRunStep => ({
    nodeId: body.node_id,
    type: body.type,
    title: body.title,
    verdict: body.verdict,
    annotation: body.annotation,
    evaluation: body.evaluation,
    edges: body.edges,
  }));

/** One node verdict, as it arrives. */
const engineNodeVerdictSchema = z
  .object({
    node_id: z.string(),
    verdict: z.enum(DRY_RUN_NODE_VERDICTS),
    explanation: z.string(),
  })
  .transform((body): EngineNodeVerdict => ({
    nodeId: body.node_id,
    verdict: body.verdict,
    explanation: body.explanation,
  }));

/** `POST /v0/workflows/dry-run`, as it arrives. */
export const engineWorkflowDryRunSchema = z
  .object({
    findings: z.array(engineFindingSchema),
    steps: z.array(engineDryRunStepSchema),
    verdicts: z.array(engineNodeVerdictSchema),
    highlight_path: z.array(engineEdgeAnchorSchema),
  })
  .transform((body): EngineWorkflowDryRun => ({
    findings: body.findings,
    steps: body.steps,
    verdicts: body.verdicts,
    highlightPath: body.highlight_path,
  }));

/**
 * A definition and a ticket, as the engine's request body.
 *
 * @param definition - The document to walk, exactly as it is stored — never reshaped, for
 *   {@link workflowValidateRequestBody}'s reason.
 * @param ticket - The ticket, in this service's names.
 * @returns The body to serialise, in the engine's.
 */
export function workflowDryRunRequestBody(
  definition: unknown,
  ticket: EngineDryRunTicket,
): Record<string, unknown> {
  return {
    definition,
    ticket: {
      external_key: ticket.externalKey,
      source: ticket.source,
      labels: [...ticket.labels],
      estimate: ticket.estimate === null ? null : { effort: ticket.estimate.effort },
    },
  };
}
