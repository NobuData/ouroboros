/**
 * Composition → resource, for the registry's read model
 * ([#588](https://github.com/NobuData/ouroboros/issues/588)) — the same seam
 * `registry/aliases.resources.ts` and `pricing/resources.ts` keep, for the same two reasons.
 *
 * The inputs are five subsystems' own shapes (CH.1's alias resource, CH.2's chips, CH.3's
 * price, Z.3's health as `alias.health.ts` derived it, CG.3's references); the resources are
 * the contract's — camelCase, ISO 8601, and exactly what `openapi.yaml` promises. Three
 * decisions are made here rather than at every call site.
 *
 * ---------------------------------------------------------------------------
 * **1. Every cell is served composed, and none is re-derived by a client.**
 *
 * The chips, the price's `display`, the health note and the monogram are all *derived* values,
 * and every one of them is derived exactly once — here, from the row the same payload carries.
 * That is the discipline CH.2's `params.chips.ts` states for the chips and CH.3's `price.ts`
 * states for the money, applied to the whole row: three surfaces consume this payload (the
 * table #592, the inspector prefill #593 and routing's swap menus, the amended Z.2 #195), and
 * a rule re-implemented in any of them is a cell that disagrees with the other two.
 *
 * A client is still free to render from the structured fields beside each rendering — a
 * localised page would want to. What it must not have to invent is the value for *there is
 * nothing here*, which is why `chips` is an empty list rather than a dash and `price.display`
 * carries the `—` itself.
 *
 * ---------------------------------------------------------------------------
 * **2. `usedBy` is served beside `references`, and the two cannot disagree.**
 *
 * CH.1 publishes the referrer list alone and has a client count it, precisely so the `Used by`
 * column and the inspector's chips are one fact (decision **R5**). This payload carries the
 * count as well, because the ticket asks for *"#581's count and the chip-level referrer list
 * for the inspector"* — and it is safe here for the reason CH.1's argument was about: both are
 * produced by {@link toRegistryAliasResource} from **one array**, in one expression, so there
 * is no second derivation to drift. It is `references.length` and is documented as such.
 *
 * ---------------------------------------------------------------------------
 * **3. The monogram is computed server-side, exactly as a workspace's is.**
 *
 * `tenancy/resources.ts` computes `AR` for *Acme Robotics* rather than making the browser do
 * it, and the same argument applies to `AN` for Anthropic: the letters are a *vocabulary*
 * shared by mockup 07's cards (AE.2, [#228](https://github.com/NobuData/ouroboros/issues/228))
 * and mockup 21's provider cell, and a vocabulary held in two places is one that disagrees the
 * day a seventh kind is added. {@link PROVIDER_MONOGRAMS} is total over V015's kinds, so that
 * seventh kind is a compile error here rather than a blank square in a table.
 */

import type { ModelPriceResource } from "../pricing/resources";
import type { AliasReferenceResource, ModelAliasResource } from "../registry/aliases.resources";
import { paramChips } from "../registry/params.chips";
import type { ProviderConnectionKind } from "../db/schema";
import { monogramOf } from "../tenancy/resources";
import type { AliasHealth, AliasHealthState } from "./alias.health";

/**
 * The two letters each provider kind is drawn with — mockup 07's own, shared with mockup 21's
 * provider cell.
 *
 * `custom` is `null` and means *derive it from the connection's display name*: the mockup draws
 * no square for a kind it does not know about, and two custom connections should be tellable
 * apart by their names rather than both reading `CU`. That is the same fallback AE.2's card
 * takes, stated here once so the two surfaces cannot pick different letters for one row.
 *
 * `satisfies` makes the record **total** over V015's kinds — a seventh kind added to
 * `db/schema.ts` without a monogram written for it does not compile.
 */
export const PROVIDER_MONOGRAMS = {
  anthropic: "AN",
  openai_compatible: "VL",
  ollama: "OL",
  copilot: "GH",
  cursor: "CU",
  custom: null,
} as const satisfies Record<ProviderConnectionKind, string | null>;

/** The binding, as the table's provider cell and the inspector's provider line draw it. */
export interface RegistryBindingResource {
  /** `provider_connections.id` — what a rebind addresses and what a swap menu keys on. */
  readonly id: string;
  /** Which adapter reaches it. */
  readonly kind: ProviderConnectionKind;
  /** What mockup 07's card calls it — the cell's text beside the square. */
  readonly displayName: string;
  /** The square's letters — `AN`, `GH`, `CU`, `OL`, `VL`. Never empty for a kind V015 knows. */
  readonly monogram: string;
  /**
   * `••••Xq4A` — the inspector's *key sk-ant-…Xq4A*, or **null**.
   *
   * Null means one of two things and a client renders both the same way: the provider stores no
   * credential at all — an Ollama daemon, an unauthenticated OpenAI-compatible endpoint — or
   * this deployment could not open the one it has. See `registry-read.service.ts` for why the
   * second is a null rather than a failed page.
   *
   * It is the same string `GET /api/v1/providers` publishes, from the same `masking.ts`, and it
   * cannot be un-masked: the characters it hides never cross the wire.
   */
  readonly mask: string | null;
}

/** The `Health` cell — derived, never probed. See `alias.health.ts`. */
export interface AliasHealthResource {
  /** Which of the six states. Stable; what a client branches on and picks a dot for. */
  readonly state: AliasHealthState;
  /** The line under the dot, or null for `ok`, where there is nothing to explain. */
  readonly note: string | null;
  /** Mockup 21's *Fix in Providers →* target, or null when there is nowhere to send anybody. */
  readonly fix: string | null;
  /** When Z.3 last checked the provider, ISO 8601, or null when nothing has. */
  readonly checkedAt: string | null;
}

/** One row of mockup 21's allowed-models table, every cell composed. */
export interface RegistryAliasResource {
  /** `model_aliases.id` — what every CH.1 write addresses. */
  readonly id: string;
  /** The name routes use — the row's pill. */
  readonly alias: string;
  /** The **On** switch. Always false for an unbound alias (V019). */
  readonly enabled: boolean;
  /** Where it resolves, or null for mockup 21's `no provider` cell. */
  readonly binding: RegistryBindingResource | null;
  /** The raw model id — the only place in this payload one appears (decision **M1**). */
  readonly modelId: string;
  /** `model_aliases.params` as stored — what the inspector's fields prefill from. */
  readonly params: Record<string, unknown>;
  /** `model_aliases.restrictions` as stored. */
  readonly restrictions: Record<string, unknown>;
  /**
   * The `Params` cell, derived by CH.2 — `["max thinking", "400k budget"]`.
   *
   * Empty is the mockup's `—`, returned as an empty list rather than as a one-element list
   * holding a dash: that cell has its own markup, and a client should not have to recognise a
   * sentinel string to know it.
   */
  readonly chips: readonly string[];
  /** An operator's note, or null. Part of the inspector's state rather than the table's. */
  readonly notes: string | null;
  /** The `Health` cell. */
  readonly health: AliasHealthResource;
  /** The `$ per 1M in·out` cell, resolved and rendered by CH.3, provenance included. */
  readonly price: ModelPriceResource;
  /** How many things reference the alias — the `Used by` cell. Always `references.length`. */
  readonly usedBy: number;
  /** Those references, in chip order — what the inspector draws and what a `409` names. */
  readonly references: readonly AliasReferenceResource[];
}

/** The whole page, in one payload. */
export interface RegistryReadModelResource {
  /**
   * Every alias in the workspace, ordered by name, unbound ones included.
   *
   * Unpaged, for CH.1's reason: a workspace's registry is a handful of names, and a page over a
   * list that short would cost a client a second request to discover there was nothing more.
   */
  readonly aliases: readonly RegistryAliasResource[];
}

/**
 * The letters one connection is drawn with.
 *
 * @param kind - The connection's kind.
 * @param displayName - Its heading, which the letters are derived from for a kind the mockup
 *   does not draw. See {@link PROVIDER_MONOGRAMS}.
 * @returns Two upper-case characters, or fewer for a name that has fewer.
 */
export function monogramFor(kind: ProviderConnectionKind, displayName: string): string {
  return PROVIDER_MONOGRAMS[kind] ?? monogramOf(displayName);
}

/**
 * One health derivation as the contract publishes it.
 *
 * @param health - What `aliasHealth` decided.
 * @returns The resource, its instant in ISO 8601.
 */
export function toAliasHealthResource(health: AliasHealth): AliasHealthResource {
  return {
    state: health.state,
    note: health.note,
    fix: health.fix,
    checkedAt: health.checkedAt === null ? null : health.checkedAt.toISOString(),
  };
}

/**
 * One row as the contract publishes it.
 *
 * @param alias - CH.1's alias resource, which this payload composes onto rather than restates:
 *   the row, its binding and its references come from the one list `/registry/aliases` serves,
 *   so the two surfaces cannot describe one alias differently.
 * @param mask - The masked credential of the bound connection, or null. Passed in because
 *   deriving it needs the vault and this file reads nothing.
 * @param health - The health cell, already derived.
 * @param price - CH.3's answer for the alias's (kind, model) pair, already rendered.
 * @returns The row.
 */
export function toRegistryAliasResource(
  alias: ModelAliasResource,
  mask: string | null,
  health: AliasHealth,
  price: ModelPriceResource,
): RegistryAliasResource {
  return {
    id: alias.id,
    alias: alias.alias,
    enabled: alias.enabled,
    binding:
      alias.connection === null
        ? null
        : {
            id: alias.connection.id,
            kind: alias.connection.kind,
            displayName: alias.connection.displayName,
            monogram: monogramFor(alias.connection.kind, alias.connection.displayName),
            mask,
          },
    modelId: alias.modelId,
    params: alias.params,
    restrictions: alias.restrictions,
    chips: paramChips(alias.params, alias.restrictions),
    notes: alias.notes,
    health: toAliasHealthResource(health),
    price,
    // One array, counted and carried in the same expression — see this file's header,
    // decision 2. There is no second derivation for the column and the chips to drift apart.
    usedBy: alias.references.length,
    references: alias.references,
  };
}
