/**
 * The dialect a research tool's `configSchema()` is written in — the one two SPIs already
 * settled on, reused rather than reinvented.
 *
 * CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)). A tool's workspace settings
 * are keys, endpoints and scope: strings, a masked credential, and sometimes a list (the domains
 * a web search may read, the repositories code mining covers). That is exactly the ticket-source
 * dialect (`ticket-sources/ticket-source.config.ts`, Q.4 #141): the model-provider string
 * dialect (`providers/provider.config.ts`, AC.1 #216) plus a list of strings. Reusing it means
 * the enable flow (#629) renders a tool's form with the components that already render a source
 * and a provider form — no tool-specific UI code, the AE.5 (#231) discipline — and the gate,
 * the widget derivation and the submission split are those modules' functions, called here.
 *
 * The credential is the field marked `x-ouroboros-secret`. It never enters the stored
 * configuration: {@link partitionToolSubmission} splits it off for the vault, and an adapter
 * receives it only as `ToolCallContext.secret`, for one call.
 */

import {
  partitionSourceSubmission,
  sourceConfigViolations,
  sourceSchemaViolations,
  toSourceFormFields,
  type TicketSourceConfigSchema,
  type TicketSourceConfigValue,
  type TicketSourceConfigViolations,
  type TicketSourceFormField,
  type TicketSourceSubmissionParts,
} from "../../ticket-sources/ticket-source.config";

/** A research tool's config schema — the ticket-source dialect. */
export type ResearchToolConfigSchema = TicketSourceConfigSchema;

/** One stored configuration value — a string, or a list of strings. */
export type ResearchToolConfigValue = TicketSourceConfigValue;

/** A workspace's stored configuration of one tool. Never contains the credential. */
export type ResearchToolConfig = Readonly<Record<string, ResearchToolConfigValue>>;

/** One field of the rendered enable form. */
export type ResearchToolFormField = TicketSourceFormField;

/**
 * Everything wrong with a tool's schema — empty when the enable form can render it.
 *
 * @param schema - What `configSchema()` answered. `unknown`, because the interesting caller is
 *   the conformance kit judging somebody else's adapter.
 * @returns The violations, in the order found.
 */
export function toolSchemaViolations(schema: unknown): string[] {
  return sourceSchemaViolations(schema);
}

/**
 * The enable form's fields, in schema order.
 *
 * @param schema - A schema with no {@link toolSchemaViolations}.
 * @returns One field per property — the same function the source form uses.
 */
export function toToolFormFields(schema: ResearchToolConfigSchema): ResearchToolFormField[] {
  return toSourceFormFields(schema);
}

/**
 * Everything wrong with a submitted configuration, keyed by field.
 *
 * @param schema - The tool's schema.
 * @param values - What was submitted.
 * @returns The complaints; empty when acceptable.
 */
export function toolConfigViolations(
  schema: ResearchToolConfigSchema,
  values: Readonly<Record<string, unknown>>,
): TicketSourceConfigViolations {
  return sourceConfigViolations(schema, values);
}

/**
 * A submission split into the stored configuration and the credential for the vault.
 *
 * @param schema - The tool's schema.
 * @param values - The submission.
 * @returns `{config, secret}` — the config never holds the credential.
 */
export function partitionToolSubmission(
  schema: ResearchToolConfigSchema,
  values: Readonly<Record<string, unknown>>,
): TicketSourceSubmissionParts {
  return partitionSourceSubmission(schema, values);
}
