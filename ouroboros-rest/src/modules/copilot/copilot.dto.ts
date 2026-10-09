/**
 * The bodies and parameters of the copilot's routes, validated before anything is read.
 *
 * Every class here is closed by the global validation pipe (`whitelist` + `forbidNonWhitelisted`),
 * so a misspelt property is a `422` naming it rather than a field silently dropped.
 */

import { IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from "class-validator";

/** `copilot_sessions_draft_name_format` — the workflow slug grammar, at most 64 characters. */
export const DRAFT_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The longest message a person may send in one exchange — the engine's own bound. */
export const MESSAGE_MAX_LENGTH = 20_000;

/** The longest chip an answer may name — the engine's `ask_user` bound on an option. */
export const OPTION_MAX_LENGTH = 200;

/** The path of every session route — `/workflows/{id}/copilot/sessions/{sessionId}/…`. */
export class CopilotSessionParams {
  /** The workflow — `workflows.id`. */
  @IsUUID()
  id!: string;

  /** The session — `copilot_sessions.id`. */
  @IsUUID()
  sessionId!: string;
}

/** The path of the answer route, which also names the reply that asked. */
export class CopilotMessageParams extends CopilotSessionParams {
  /** The copilot reply whose question is being answered — `copilot_messages.id`. */
  @IsUUID()
  messageId!: string;
}

/** The path of the workflow-level routes — `/workflows/{id}/copilot/…`. */
export class CopilotWorkflowParams {
  /** The workflow — `workflows.id`. */
  @IsUUID()
  id!: string;
}

/** The body of `POST /api/v1/workflows/{id}/copilot/sessions`. */
export class StartCopilotSessionBody {
  /**
   * The `draft: security-patch` tag the conversation card shows. Omitted, it is the workflow's
   * slug — which is what the tag usually matches anyway.
   */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Matches(DRAFT_NAME_PATTERN, {
    message: "draftName must be lower-case words separated by single hyphens",
  })
  draftName?: string;
}

/** The body of `POST …/sessions/{sessionId}/messages` — what the person typed. */
export class CopilotMessageBody {
  /** The message. Non-blank; the copilot answers it in a streamed reply. */
  @IsString()
  @Length(1, MESSAGE_MAX_LENGTH)
  text!: string;
}

/** The body of `POST …/messages/{messageId}/answers` — a chip the person chose. */
export class CopilotAnswerBody {
  /** Which of the reply's questions, by position from 0. */
  @IsInt()
  @Min(0)
  question!: number;

  /** The option chosen, verbatim — one the question offered. */
  @IsString()
  @Length(1, OPTION_MAX_LENGTH)
  selected!: string;
}
