/**
 * `POST /v0/copilot-workflow` — one turn of the Workflow Copilot, as this service sends and reads it
 * (CD.1, [#559](https://github.com/NobuData/ouroboros/issues/559)).
 *
 * The engine runs the *model turn* and this service runs the *loop*, so what crosses this seam is
 * exactly a transcript in and a stream of events out. The request is written in the engine's
 * `snake_case` by {@link copilotTurnRequestBody}; each streamed line is parsed by
 * {@link engineCopilotEventSchema} into this service's names, and a line outside the contract is
 * `engine_unavailable` like every other contract break (`engine.client.ts`).
 */

import { z } from "zod";

import { ENGINE_API_VERSION } from "./engine.contract";

/** The route, relative to `OURO_ENGINE_URL`. */
export const ENGINE_COPILOT_ROUTE = `${ENGINE_API_VERSION}/copilot-workflow`;

/**
 * How long one turn may take. A model turn is slow and streams while it runs; the deadline is for
 * a gateway that stopped answering, not for a long reply.
 */
export const COPILOT_TURN_TIMEOUT_MS = 180_000;

/** One stage type of the catalog, as the engine is told about it. */
export interface EngineCatalogEntry {
  readonly type: "trigger" | "llm" | "infra" | "flow" | "term";
  readonly label: string;
  readonly summary: string;
}

/** One guard the enforcement planes honour. */
export interface EngineGuardEntry {
  readonly name: string;
  readonly description: string;
}

/** What grounds a turn. */
export interface EngineCopilotContext {
  /** The draft as stored, or `null` before the first operation. */
  readonly draft: unknown;
  /** The draft's revision label — `v0.3`. */
  readonly draftLabel: string;
  readonly catalog: readonly EngineCatalogEntry[];
  readonly skills: readonly string[];
  readonly tasks: readonly string[];
  readonly guards: readonly EngineGuardEntry[];
}

/** A call a previous copilot reply made. */
export interface EngineToolCall {
  readonly id: string;
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
}

/** One entry of the transcript. */
export type EngineTranscriptEntry =
  | { readonly role: "user"; readonly text: string }
  | {
      readonly role: "copilot";
      readonly text: string;
      readonly toolCalls: readonly EngineToolCall[];
    }
  | {
      readonly role: "tool";
      readonly callId: string;
      readonly ok: boolean;
      readonly content: string;
    };

/** The turn. */
export interface EngineCopilotTurnRequest {
  /** The routing alias the `copilot-workflow` kind resolved to. */
  readonly alias: string;
  /** The session the invocation is attributed to. */
  readonly session: string;
  readonly resolutionVersion: string | null;
  readonly costCapCents: number | null;
  readonly context: EngineCopilotContext;
  readonly transcript: readonly EngineTranscriptEntry[];
}

/**
 * The turn, in the engine's spelling.
 *
 * @param request - The turn, in this service's names.
 * @returns The body to serialise.
 */
export function copilotTurnRequestBody(request: EngineCopilotTurnRequest): Record<string, unknown> {
  return {
    alias: request.alias,
    session: request.session,
    resolution_version: request.resolutionVersion,
    cost_cap_cents: request.costCapCents,
    context: {
      draft: request.context.draft,
      draft_label: request.context.draftLabel,
      catalog: request.context.catalog,
      skills: request.context.skills,
      tasks: request.context.tasks,
      guards: request.context.guards,
    },
    transcript: request.transcript.map((entry) => {
      switch (entry.role) {
        case "user":
          return { role: "user", text: entry.text };
        case "copilot":
          return { role: "copilot", text: entry.text, tool_calls: entry.toolCalls };
        default:
          return { role: "tool", call_id: entry.callId, ok: entry.ok, content: entry.content };
      }
    }),
  };
}

/** One line of the stream, in this service's names. */
export type EngineCopilotEvent =
  | { readonly kind: "delta"; readonly text: string }
  | {
      readonly kind: "tool_call";
      readonly id: string;
      readonly tool: string;
      /** The validated arguments, or `null` when the call did not validate. */
      readonly arguments: Record<string, unknown> | null;
      /** Why it did not validate, written for the model, or `null`. */
      readonly error: string | null;
    }
  | {
      readonly kind: "usage";
      readonly inputTokens: number;
      readonly outputTokens: number;
      /** Null when nothing prices the model — unpriced, never free. */
      readonly costCents: number | null;
      readonly model: string;
      readonly connection: string;
    }
  | { readonly kind: "error"; readonly code: string; readonly message: string }
  | { readonly kind: "done"; readonly finishReason: string };

/** One line of the stream, parsed and translated. */
export const engineCopilotEventSchema: z.ZodType<EngineCopilotEvent> = z.union([
  z
    .object({ kind: z.literal("delta"), text: z.string() })
    .transform((line) => ({ kind: "delta" as const, text: line.text })),
  z
    .object({
      kind: z.literal("tool_call"),
      id: z.string().min(1),
      tool: z.string().min(1),
      arguments: z.record(z.string(), z.unknown()).nullable().default(null),
      error: z.string().nullable().default(null),
    })
    .transform((line) => ({
      kind: "tool_call" as const,
      id: line.id,
      tool: line.tool,
      arguments: line.arguments,
      error: line.error,
    })),
  z
    .object({
      kind: z.literal("usage"),
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      cost_cents: z.number().nonnegative().nullable().default(null),
      model: z.string(),
      connection: z.string(),
    })
    .transform((line) => ({
      kind: "usage" as const,
      inputTokens: line.input_tokens,
      outputTokens: line.output_tokens,
      costCents: line.cost_cents,
      model: line.model,
      connection: line.connection,
    })),
  z
    .object({ kind: z.literal("error"), code: z.string().min(1), message: z.string() })
    .transform((line) => ({ kind: "error" as const, code: line.code, message: line.message })),
  z
    .object({ kind: z.literal("done"), finish_reason: z.string() })
    .transform((line) => ({ kind: "done" as const, finishReason: line.finish_reason })),
]);
