/**
 * Merged schema → resource, for the registry's param surface — the same seam
 * `pricing/resources.ts` and `settings/resources.ts` keep.
 *
 * What is decided here rather than at every future call site is small and worth naming:
 *
 * **1. The schemas cross the wire as JSON Schema, unchanged.** No renaming into camelCase, no
 * flattening into a field list. `$schema`, `type`, `properties`, `minimum`, `enum` are a
 * vocabulary every client already has a library for, and CI.3
 * ([#593](https://github.com/NobuData/ouroboros/issues/593)) renders fields from it with zero
 * special-casing — which is impossible if this layer invents a dialect of its own on the way
 * out. The `x-ouroboros-sources` annotation rides along because that is what `x-` prefixes are
 * for.
 *
 * **2. The rendered fields are served beside them.** `param.forms.ts` already derives which
 * widget each field gets and what its bounds are, and that derivation is a decision this side
 * should make once — the same argument `provider.forms.ts` makes for the connection form. A
 * client that wants the schema has it; a client that wants a form has one; and the two cannot
 * disagree, because the second is computed from the first in one place.
 *
 * **3. `reason` is a code and never a sentence this product wrote for a UI.** The schema's own
 * `description` carries the prose. A server that shipped the inspector's copy would be a server
 * somebody has to redeploy to change a wording.
 */

import { toParamFields, type ParamFormField } from "../providers/param.forms";
import type { ModelParamSchema, ParamSource } from "../providers/provider.params";
import type { MergedParamSchema, NoParamsReason } from "./params.merge";

/** One half of the answer — a schema and the fields it renders as. */
export interface ParamSectionResource {
  /**
   * The schema itself, as JSON Schema.
   *
   * Published rather than translated — see this file's header. A client may hand it to a
   * generic validator and get the same answer the server will give it, which is what makes the
   * inspector's *before you save* check and the server's `422` the same rule.
   */
  readonly schema: ModelParamSchema;
  /**
   * The same schema as an ordered field list, ready to draw.
   *
   * Empty exactly when the schema declares no properties, which is the fixed-catalog and
   * unbound case — and where a client renders the schema's `description` instead.
   */
  readonly fields: readonly ParamFormField[];
}

/**
 * `GET /api/v1/registry/param-schema`'s body.
 *
 * Two sections rather than one, mirroring the two columns a write lands in: a `422` from
 * `params.validation.ts` names `params.thinking` or `restrictions.batch_ok`, and a client maps
 * either back to a field of the section it came from without a lookup table.
 */
export interface ParamSchemaResource {
  /** Which model this answer is about, echoed so a stale response is recognisable as one. */
  readonly modelId: string;
  /** The connection it was asked on, or null when the question was about an unbound alias. */
  readonly connectionId: string | null;
  /** The tunables the model supports. */
  readonly params: ParamSectionResource;
  /** The two registry flags, on every answer — see {@link MergedParamSchema.restrictions}. */
  readonly restrictions: ParamSectionResource;
  /**
   * Why {@link params} offers nothing, or null when it offers something.
   *
   * Never a sentence — see this file's header, and read `params.schema.description` for the
   * one this service would write.
   */
  readonly reason: NoParamsReason | null;
  /**
   * Every source that shaped any field, in precedence order.
   *
   * `["adapter", "discovery", "registry"]` on a bound alias whose provider published a context
   * length. A client can say *some of these bounds are catalogued* once above the form rather
   * than reading every field's own annotation to find out.
   */
  readonly sources: readonly ParamSource[];
}

/**
 * The resource for one merged schema.
 *
 * @param merged - What `params.merge.ts` produced.
 * @param connectionId - The connection the question was asked on, or null.
 * @param modelId - The model it was asked about.
 * @returns The body, with each section's fields derived from its own schema so the two cannot
 *   disagree.
 */
export function toParamSchemaResource(
  merged: MergedParamSchema,
  connectionId: string | null,
  modelId: string,
): ParamSchemaResource {
  return {
    modelId,
    connectionId,
    params: toSection(merged.params),
    restrictions: toSection(merged.restrictions),
    reason: merged.reason,
    sources: merged.sources,
  };
}

/**
 * One section — a schema and its fields.
 *
 * @param schema - The section's schema.
 * @returns The section.
 */
function toSection(schema: ModelParamSchema): ParamSectionResource {
  return { schema, fields: toParamFields(schema) };
}
