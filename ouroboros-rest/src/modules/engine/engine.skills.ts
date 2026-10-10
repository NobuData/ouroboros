/**
 * `POST /v0/skills/run` — skill execution, as this service calls it (CM.5,
 * [#624](https://github.com/NobuData/ouroboros/issues/624)).
 *
 * A registry skill's body goes out with the input it works on, and a **validated** output comes
 * back: a roadmap for `create-roadmap`, one description per item for `create-issues`. The engine
 * holds no skill — what runs is the version this service resolved for the workspace.
 *
 * Two refusals are answered rather than thrown, because the pipeline tells its own caller which
 * one happened: the model could not be reached (`skill_model_failed`, whose reason is the
 * gateway's — `gateway_unavailable` until AF.2, #235), or it answered outside the contract twice
 * (`skill_output_invalid`).
 */

import { z } from "zod";

import { ENGINE_API_VERSION } from "./engine.contract";

/** The route, relative to `OURO_ENGINE_URL`. */
export const ENGINE_SKILLS_RUN_ROUTE = `${ENGINE_API_VERSION}/skills/run`;

/** How long one run may take: at most two model answers over a whole brief. */
export const ENGINE_SKILL_TIMEOUT_MS = 300_000;

/** The efforts a roadmap item may carry. */
export const SKILL_EFFORTS = ["xs", "s", "m", "l", "xl"] as const;

/** One run of one skill. */
export interface EngineSkillRunRequest {
  /** What the model calls are attributed to — the roadmap document's id. */
  readonly run: string;
  readonly skill: {
    readonly slug: string;
    /** The published version this service resolved. */
    readonly version: number;
    /** That version's procedure text. */
    readonly body: string;
  };
  /** Which validated shape to answer with. */
  readonly output: "roadmap" | "issue_bodies";
  /** What the procedure works on. */
  readonly input: Record<string, unknown>;
  /** The routing alias the calls go through. */
  readonly alias: string;
  /** The resolution the alias came from, when known. */
  readonly resolutionVersion: string | null;
  /** The most the run may spend, or null for no cap. */
  readonly costCapCents: number | null;
}

const itemSchema = z.object({
  key: z.string(),
  title: z.string(),
  mvp: z.boolean(),
  effort: z.enum(SKILL_EFFORTS).nullable(),
});

const milestoneSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    target_date: z.string().nullable(),
    items: z.array(itemSchema),
  })
  .transform(({ target_date, ...rest }) => ({ ...rest, targetDate: target_date }));

const roadmapSchema = z.object({ title: z.string(), milestones: z.array(milestoneSchema) });

const usageSchema = z
  .object({
    hop: z.number(),
    connection: z.string(),
    model: z.string(),
    input_tokens: z.number(),
    output_tokens: z.number(),
    cost_cents: z.number().nullable(),
  })
  .transform((usage) => ({
    hop: usage.hop,
    connection: usage.connection,
    model: usage.model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    costCents: usage.cost_cents,
  }));

/** A `200` from `POST /v0/skills/run`, in this service's names. */
export const skillRunResultSchema = z.object({
  skill: z.string(),
  version: z.number().int(),
  output: z.enum(["roadmap", "issue_bodies"]),
  roadmap: roadmapSchema.nullable(),
  issues: z.array(z.object({ key: z.string(), body: z.string() })).nullable(),
  attempts: z.number().int(),
  usage: z.array(usageSchema),
});

/** What a run produced. */
export type EngineSkillRunResult = z.infer<typeof skillRunResultSchema>;

/** A roadmap as `create-roadmap` answers it. */
export type EngineRoadmap = z.infer<typeof roadmapSchema>;

/** The two refusals this service passes on. */
export const SKILL_REFUSAL_CODES = ["skill_model_failed", "skill_output_invalid"] as const;

/** A refusal's envelope, read for the code and what explains it. */
export const skillRefusalSchema = z.object({
  code: z.enum(SKILL_REFUSAL_CODES),
  message: z.string(),
  details: z
    .object({ reason: z.string().optional(), problem: z.string().optional() })
    .passthrough()
    .optional(),
});

/** A refused run. */
export interface EngineSkillRefusal {
  readonly code: (typeof SKILL_REFUSAL_CODES)[number];
  /** The engine's sentence. */
  readonly message: string;
  /** The gateway's code for a failed call, or what was wrong with the answer; null when unsaid. */
  readonly reason: string | null;
}

/** A run's answer: the result, or which refusal. */
export type EngineSkillAnswer =
  | { readonly ok: true; readonly data: EngineSkillRunResult }
  | { readonly ok: false; readonly refusal: EngineSkillRefusal };

/**
 * A run as the wire spells it.
 *
 * @param request - The run, in this service's names.
 * @returns The body, in the engine's `snake_case`.
 */
export function skillRunRequestBody(request: EngineSkillRunRequest): Record<string, unknown> {
  return {
    run: request.run,
    skill: request.skill,
    output: request.output,
    input: request.input,
    alias: request.alias,
    resolution_version: request.resolutionVersion,
    cost_cap_cents: request.costCapCents,
  };
}
