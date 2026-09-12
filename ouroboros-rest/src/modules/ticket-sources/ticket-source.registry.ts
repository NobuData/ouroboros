/**
 * The provider registry — one lookup by `kind`, and the two refusals it is allowed to make.
 *
 * Q.2 ([#139](https://github.com/NobuData/ouroboros/issues/139)), roadmap decision **P5**.
 * This is the seam the decision is about: the sync loop asks *this* for a provider and never
 * imports one, and `.dependency-cruiser.cjs` is what makes that a build failure rather than a
 * review comment.
 *
 * ---------------------------------------------------------------------------
 * **It ships registered with nothing, and that is the honest state of this build.**
 *
 * Q.3 ([#140](https://github.com/NobuData/ouroboros/issues/140)) adds GitHub by adding one line
 * to `ticket-sources.module.ts`; Q.5 ([#142](https://github.com/NobuData/ouroboros/issues/142))
 * adds the in-memory fake beside it, and T.2–T.4 add Jira, Linear and GitLab the same way. Until
 * they do, {@link TicketSourceRegistry.get} answers `501` for every kind — which is exactly what
 * this build can truthfully say about a `jira` row: V030 accepts it, `R__dev_seed_sources.sql`
 * seeds one, and nothing here knows how to reach it yet. `ModelProviderRegistry` shipped with
 * one adapter and five honest `501`s for the same reason, and AD.1's `VAULT_SECRET_STORES`
 * shipped empty before that.
 *
 * **The loop does not call {@link TicketSourceRegistry.get}.** It calls {@link find}, and a
 * source whose kind resolves to nothing is *skipped* with a reason rather than marked failed —
 * see `ticket-sources.service.ts`. A missing provider is a property of the build, not of
 * somebody's configuration, and flipping a seeded row to `error` on every boot of a build that
 * has not shipped Jira yet would be blaming a workspace for a release schedule.
 *
 * ---------------------------------------------------------------------------
 * **Why `501` and not `404` for an unregistered kind.**
 *
 * `error.envelope.ts` makes the argument and `provider.registry.ts` repeats it: a `404` is
 * indistinguishable from a caller with the path wrong. *This kind exists and this build has no
 * provider for it* is a different fact from *there is no such kind*, and the person who needs to
 * tell them apart is whoever is implementing the other half.
 *
 * ---------------------------------------------------------------------------
 * **Two misuses this class refuses at construction rather than at a call site.**
 *
 * A duplicate `kind` throws while Nest is building the module, so a second provider claiming
 * `github` stops the process at boot instead of silently shadowing the first on whichever order
 * the injector happened to produce. And a provider whose
 * {@link TicketSourceCapabilities.webhooks} disagrees with its `webhookHandler` throws too —
 * {@link supportsWebhooks} trusts the flag, so a flag that lies is a `webhookHandler` that is
 * either unreachable or missing, and both are worth failing a boot over. The second is the one
 * a type cannot catch: {@link WebhookCapableProvider} narrows the flag to `true`, which stops a
 * webhook-capable provider from reporting `false`, and nothing stops a provider with no member
 * from reporting `true`.
 */

import { Inject, Injectable } from "@nestjs/common";

import { TICKET_SOURCE_KINDS, type TicketSourceKind } from "../db/schema";
import { InvalidRequestError, NotImplementedError } from "../errors/error.envelope";
import {
  supportsWebhooks,
  type TicketSourceProvider,
  type WebhookCapableProvider,
} from "./ticket-source.provider";

/**
 * The DI token the registered providers are injected under.
 *
 * A `Symbol` rather than a string, for the reason every multi-provider token in this service is
 * one: a string token is a value two modules can coin independently and be surprised by, and
 * this one is bound in exactly one place — `ticket-sources.module.ts`.
 */
export const TICKET_SOURCE_PROVIDERS = Symbol("TICKET_SOURCE_PROVIDERS");

/**
 * The codes the registry refuses with.
 *
 * `as const` so each value is its own literal type. Neither is published in `openapi.yaml` yet,
 * and that is deliberate rather than an omission: this module declares no controller — the
 * routes that surface these are Q.4's ([#141](https://github.com/NobuData/ouroboros/issues/141))
 * — and a code published against no operation is a code a client cannot look up.
 * `provider.registry.ts` makes the same choice.
 */
export const TICKET_SOURCE_REGISTRY_ERRORS = {
  /** `501` — a real kind, with no provider in this build. */
  kindUnsupported: "ticket_source_kind_unsupported",
  /** `422` — a real provider, asked for a capability it does not declare. */
  kindNoWebhooks: "ticket_source_kind_no_webhooks",
} as const;

/** One of {@link TICKET_SOURCE_REGISTRY_ERRORS}' values. */
export type TicketSourceRegistryErrorCode =
  (typeof TICKET_SOURCE_REGISTRY_ERRORS)[keyof typeof TICKET_SOURCE_REGISTRY_ERRORS];

/**
 * `501` — this build has no provider for that kind.
 *
 * @param kind - The kind that was asked for.
 * @param registered - The kinds that do have one, in V030's declaration order. In `details` so
 *   a caller can see what *is* available without reading the module list — which, while the
 *   catalog is as incomplete as it is today, is most of the value of the refusal.
 * @returns The error to throw.
 */
export function ticketSourceKindUnsupported(
  kind: string,
  registered: readonly TicketSourceKind[],
): NotImplementedError {
  return new NotImplementedError(
    TICKET_SOURCE_REGISTRY_ERRORS.kindUnsupported,
    "This build has no provider for that ticket source kind.",
    { kind, registered: [...registered] },
  );
}

/**
 * `422` — that provider does not handle webhooks.
 *
 * A `422` rather than a `404`: the source exists and the route exists, and what is not
 * acceptable is asking *this* tracker to deliver one. In practice it means somebody pointed a
 * webhook at a source whose provider only polls, which is a configuration a person can fix.
 *
 * @param kind - The kind that was asked.
 * @returns The error to throw.
 */
export function ticketSourceKindNoWebhooks(kind: TicketSourceKind): InvalidRequestError {
  return new InvalidRequestError(
    TICKET_SOURCE_REGISTRY_ERRORS.kindNoWebhooks,
    "This ticket source kind does not accept webhook deliveries.",
    { kind },
  );
}

@Injectable()
export class TicketSourceRegistry {
  /** The providers, by kind. Built once at construction and never added to. */
  private readonly byKind: ReadonlyMap<TicketSourceKind, TicketSourceProvider>;

  /**
   * @param providers - Every registered provider, from {@link TICKET_SOURCE_PROVIDERS}.
   *   Injected as a list rather than read from a module-level array, so the set is the module's
   *   `providers` declaration and a test can register whichever providers it needs.
   * @throws {Error} When two providers claim the same kind, or when one's `webhooks` flag
   *   disagrees with its `webhookHandler`. Both are programming errors, and both stop the
   *   process at boot — see this class's header.
   */
  constructor(@Inject(TICKET_SOURCE_PROVIDERS) providers: readonly TicketSourceProvider[]) {
    const byKind = new Map<TicketSourceKind, TicketSourceProvider>();

    for (const provider of providers) {
      if (byKind.has(provider.kind)) {
        throw new Error(`Two providers are registered for ticket source kind "${provider.kind}"`);
      }

      // The flag is what `supportsWebhooks` narrows on, so a flag that disagrees with the
      // member is either an unreachable `webhookHandler` or a `TypeError` waiting at a call
      // site the compiler was told is safe. Checked here rather than only in Q.5's conformance
      // kit, because a provider registered by somebody else's module never runs the kit.
      const declaresWebhooks = provider.capabilities().webhooks;

      if (declaresWebhooks !== (typeof webhookMemberOf(provider) === "function")) {
        throw new Error(
          `Provider "${provider.kind}" declares webhooks: ${declaresWebhooks.toString()} ` +
            "but its webhookHandler member says otherwise",
        );
      }

      byKind.set(provider.kind, provider);
    }

    this.byKind = byKind;
  }

  /**
   * The kinds this build can reach.
   *
   * What Q.4's add-source picker renders as available — the rest of V030's five are its
   * *"coming soon"* tiles — and what {@link ticketSourceKindUnsupported} names in its details.
   *
   * @returns The kinds, in V030's declaration order so the catalog is stable between builds. An
   *   injector's ordering is not something a page's ordering should depend on.
   */
  kinds(): TicketSourceKind[] {
    return TICKET_SOURCE_KINDS.filter((kind) => this.byKind.has(kind));
  }

  /**
   * The provider for one kind, if this build has one.
   *
   * **What the sync loop calls.** The honest shape for a lookup, and the reason it is the
   * loop's entry point rather than {@link get}: a source of a kind this build does not carry is
   * skipped with a reason, not failed — see this class's header.
   *
   * @param kind - The source's kind.
   * @returns The provider, or `undefined`.
   */
  find(kind: TicketSourceKind): TicketSourceProvider | undefined {
    return this.byKind.get(kind);
  }

  /**
   * The provider for one kind.
   *
   * What a **request** calls — Q.4's test-connection and manual-sync routes, which have
   * somebody waiting on an answer and need a refusal rather than a silence.
   *
   * @param kind - The source's kind.
   * @returns The provider.
   * @throws {NotImplementedError} `ticket_source_kind_unsupported` when nothing is registered
   *   for it. Not `undefined`: every caller of this method got the kind from a row, and each
   *   would otherwise invent the same refusal.
   */
  get(kind: TicketSourceKind): TicketSourceProvider {
    const provider = this.byKind.get(kind);

    if (provider === undefined) {
      throw ticketSourceKindUnsupported(kind, this.kinds());
    }

    return provider;
  }

  /**
   * The provider for one kind, narrowed to one that accepts webhooks.
   *
   * The only supported way to reach `webhookHandler` from a kind. A caller holding a
   * {@link TicketSourceProvider} uses {@link supportsWebhooks} instead; both go through the
   * capability flag, so there is no path to the member that skips the check.
   *
   * @param kind - The source's kind.
   * @returns The provider, typed with `webhookHandler`.
   * @throws {NotImplementedError} `ticket_source_kind_unsupported` when nothing is registered.
   * @throws {InvalidRequestError} `ticket_source_kind_no_webhooks` when the provider does not
   *   declare the capability.
   */
  webhookCapable(kind: TicketSourceKind): WebhookCapableProvider {
    const provider = this.get(kind);

    if (!supportsWebhooks(provider)) {
      throw ticketSourceKindNoWebhooks(kind);
    }

    return provider;
  }
}

/**
 * A provider's `webhookHandler`, read without the type system's help.
 *
 * The registry's consistency check needs to know whether the member is *there*, which is
 * precisely the question {@link TicketSourceProvider} is designed to make unaskable — so this
 * is the one place that looks past the interface, in one expression, with the cast named.
 *
 * @param provider - Any provider.
 * @returns Whatever is at `webhookHandler`, which for a conforming polling-only provider is
 *   `undefined`.
 */
function webhookMemberOf(provider: TicketSourceProvider): unknown {
  return (provider as Partial<WebhookCapableProvider>).webhookHandler;
}
