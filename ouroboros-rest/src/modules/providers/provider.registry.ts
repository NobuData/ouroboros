/**
 * The adapter registry — one lookup by `kind`, and the two refusals it is allowed to make.
 *
 * AC.1 ([#216](https://github.com/NobuData/ouroboros/issues/216)), roadmap decision **P1**.
 * This is the seam decision P1 is about: core services — AD.2's credential lifecycle
 * ([#223](https://github.com/NobuData/ouroboros/issues/223)), Z.3's health service
 * ([#196](https://github.com/NobuData/ouroboros/issues/196)), the discovery scheduler — ask
 * *this* for an adapter and never import one. `.dependency-cruiser.cjs` is what makes that a
 * build failure rather than a review comment.
 *
 * ---------------------------------------------------------------------------
 * **It is registered with no adapters, and that is accurate rather than a stub.**
 *
 * AC.2–AC.5 ([#217](https://github.com/NobuData/ouroboros/issues/217),
 * [#218](https://github.com/NobuData/ouroboros/issues/218),
 * [#219](https://github.com/NobuData/ouroboros/issues/219),
 * [#220](https://github.com/NobuData/ouroboros/issues/220)) each add one line to
 * `providers.module.ts`. Until they do, {@link ModelProviderRegistry.get} answers `501` for
 * every kind — which is exactly what this build can honestly say about `anthropic`: V015
 * accepts the row, and nothing here knows how to reach it yet. AD.1's
 * ([#222](https://github.com/NobuData/ouroboros/issues/222)) `VAULT_SECRET_STORES` shipped
 * empty for the same reason and grew the same way.
 *
 * ---------------------------------------------------------------------------
 * **Why `501` and not `404` for an unregistered kind.**
 *
 * `error.envelope.ts` makes the argument for AD.3 and it is the same one here: a `404` is
 * indistinguishable from a caller with the path wrong. *This kind exists and this build has no
 * adapter for it* is a different fact from *there is no such kind*, and the person who needs to
 * tell them apart is whoever is implementing the other half.
 *
 * ---------------------------------------------------------------------------
 * **Two misuses this class refuses at construction rather than at a call site.**
 *
 * A duplicate `kind` throws while Nest is building the module, so a second adapter claiming
 * `ollama` stops the process at boot instead of silently shadowing the first one on whichever
 * order the injector happened to produce. And an adapter whose {@link ProviderCapabilities.pull}
 * disagrees with its `pullModel` throws too — {@link supportsPull} trusts the flag, so a flag
 * that lies is a `pullModel` that is either unreachable or missing, and both are worth failing
 * a boot over. `provider.registry.spec.ts` covers each.
 */

import { Inject, Injectable } from "@nestjs/common";

import { InvalidRequestError, NotImplementedError } from "../errors/error.envelope";
import { PROVIDER_CONNECTION_KINDS, type ProviderConnectionKind } from "../db/schema";
import {
  supportsPull,
  type ModelProviderAdapter,
  type PullCapableAdapter,
} from "./provider.adapter";

/**
 * The DI token the registered adapters are injected under.
 *
 * A `Symbol` rather than a string, for the reason every multi-provider token in this service
 * is one: a string token is a value two modules can coin independently and be surprised by,
 * and this one is bound in exactly one place — `providers.module.ts`.
 */
export const MODEL_PROVIDER_ADAPTERS = Symbol("MODEL_PROVIDER_ADAPTERS");

/**
 * The codes the registry refuses with.
 *
 * `as const` so each value is its own literal type. Neither is published in `openapi.yaml`
 * yet, and that is deliberate rather than an omission: this module declares no controller —
 * the routes that surface these are AD.2's and AE.4's
 * ([#230](https://github.com/NobuData/ouroboros/issues/230)) — and a code published against no
 * operation is a code a client cannot look up. `registry.errors.ts` makes the same choice for
 * `provider_connection_in_use`.
 */
export const PROVIDER_REGISTRY_ERRORS = {
  /** `501` — a real kind, with no adapter in this build. */
  kindUnsupported: "provider_kind_unsupported",
  /** `422` — a real adapter, asked for a capability it does not declare. */
  kindCannotPull: "provider_kind_cannot_pull",
} as const;

/** One of {@link PROVIDER_REGISTRY_ERRORS}' values. */
export type ProviderRegistryErrorCode =
  (typeof PROVIDER_REGISTRY_ERRORS)[keyof typeof PROVIDER_REGISTRY_ERRORS];

/**
 * `501` — this build has no adapter for that kind.
 *
 * @param kind - The kind that was asked for.
 * @param registered - The kinds that do have one, sorted. In `details` so a caller — most
 *   often a developer, since this is reachable only while the catalog is incomplete — can see
 *   what *is* available without reading the module list.
 * @returns The error to throw.
 */
export function providerKindUnsupported(
  kind: string,
  registered: readonly ProviderConnectionKind[],
): NotImplementedError {
  return new NotImplementedError(
    PROVIDER_REGISTRY_ERRORS.kindUnsupported,
    "This build has no adapter for that provider kind.",
    { kind, registered: [...registered] },
  );
}

/**
 * `422` — that provider does not pull models.
 *
 * A `422` rather than a `404`: the connection exists and the route exists, and what is not
 * acceptable is asking *this* provider to do it. In practice it means a card was rendered from
 * a stale capability set, which is a state AE.4 can recover from by refreshing.
 *
 * @param kind - The kind that was asked to pull.
 * @returns The error to throw.
 */
export function providerKindCannotPull(kind: ProviderConnectionKind): InvalidRequestError {
  return new InvalidRequestError(
    PROVIDER_REGISTRY_ERRORS.kindCannotPull,
    "This provider does not pull models onto a host.",
    { kind },
  );
}

@Injectable()
export class ModelProviderRegistry {
  /** The adapters, by kind. Built once at construction and never added to. */
  private readonly byKind: ReadonlyMap<ProviderConnectionKind, ModelProviderAdapter>;

  /**
   * @param adapters - Every registered adapter, from {@link MODEL_PROVIDER_ADAPTERS}. Injected
   *   as a list rather than looked up from a module-level array, so the set is the module's
   *   `providers` declaration and a test can register whichever adapters it needs.
   * @throws {Error} When two adapters claim the same kind, or when one's `pull` flag disagrees
   *   with its `pullModel`. Both are programming errors, and both stop the process at boot —
   *   see this class's header.
   */
  constructor(@Inject(MODEL_PROVIDER_ADAPTERS) adapters: readonly ModelProviderAdapter[]) {
    const byKind = new Map<ProviderConnectionKind, ModelProviderAdapter>();

    for (const adapter of adapters) {
      if (byKind.has(adapter.kind)) {
        throw new Error(`Two adapters are registered for provider kind "${adapter.kind}"`);
      }

      // The flag is what `supportsPull` narrows on, so a flag that disagrees with the member is
      // either an unreachable `pullModel` or a `TypeError` waiting at a call site the compiler
      // was told is safe. Checked here rather than only in the conformance kit because an
      // adapter registered by somebody else's module never runs the kit.
      const declaresPull = adapter.capabilities().pull;

      if (declaresPull !== (typeof pullMemberOf(adapter) === "function")) {
        throw new Error(
          `Adapter "${adapter.kind}" declares pull: ${declaresPull.toString()} ` +
            "but its pullModel member says otherwise",
        );
      }

      byKind.set(adapter.kind, adapter);
    }

    this.byKind = byKind;
  }

  /**
   * The kinds this build can reach, sorted.
   *
   * What AE.5's ([#231](https://github.com/NobuData/ouroboros/issues/231)) **Browse catalog**
   * lists, and what {@link providerKindUnsupported} names in its details.
   *
   * @returns The kinds, in V015's declaration order so the catalog is stable between builds —
   *   an injector's ordering is not something a page's ordering should depend on.
   */
  kinds(): ProviderConnectionKind[] {
    return PROVIDER_CONNECTION_KINDS.filter((kind) => this.byKind.has(kind));
  }

  /**
   * The adapter for one kind, if this build has one.
   *
   * @param kind - The connection's kind.
   * @returns The adapter, or `undefined`. The honest shape for a lookup — {@link get} is what
   *   turns absence into a refusal, once, for the callers that need one.
   */
  find(kind: ProviderConnectionKind): ModelProviderAdapter | undefined {
    return this.byKind.get(kind);
  }

  /**
   * The adapter for one kind.
   *
   * @param kind - The connection's kind.
   * @returns The adapter.
   * @throws {NotImplementedError} `provider_kind_unsupported` when nothing is registered for
   *   it. Not `undefined`: every caller got the kind from a row or a request, and each would
   *   otherwise invent the same refusal — which is the argument `registry.service.ts` makes for
   *   `aliasNotFound`.
   */
  get(kind: ProviderConnectionKind): ModelProviderAdapter {
    const adapter = this.byKind.get(kind);

    if (adapter === undefined) {
      throw providerKindUnsupported(kind, this.kinds());
    }

    return adapter;
  }

  /**
   * The adapter for one kind, narrowed to one that pulls.
   *
   * The only supported way to reach `pullModel` from a kind. A caller with a
   * {@link ModelProviderAdapter} in hand uses {@link supportsPull} instead; both go through the
   * capability flag, so there is no path to the member that skips the check.
   *
   * @param kind - The connection's kind.
   * @returns The adapter, typed with `pullModel`.
   * @throws {NotImplementedError} `provider_kind_unsupported` when nothing is registered.
   * @throws {InvalidRequestError} `provider_kind_cannot_pull` when the adapter does not declare
   *   the capability.
   */
  pullCapable(kind: ProviderConnectionKind): PullCapableAdapter {
    const adapter = this.get(kind);

    if (!supportsPull(adapter)) {
      throw providerKindCannotPull(kind);
    }

    return adapter;
  }
}

/**
 * An adapter's `pullModel`, read without the type system's help.
 *
 * The registry's consistency check needs to know whether the member is *there*, which is
 * precisely the question {@link ModelProviderAdapter} is designed to make unaskable — so this
 * is the one place that looks past the interface, in one expression, with the cast named.
 *
 * @param adapter - Any adapter.
 * @returns Whatever is at `pullModel`, which for a conforming non-pulling adapter is
 *   `undefined`.
 */
function pullMemberOf(adapter: ModelProviderAdapter): unknown {
  return (adapter as Partial<PullCapableAdapter>).pullModel;
}
