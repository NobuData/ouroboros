import { Test } from "@nestjs/testing";

import { TICKET_SOURCE_KINDS } from "../db/schema";
import { NotImplementedError } from "../errors/error.envelope";
import { NO_CAPABILITIES, scriptedProvider, webhookProvider } from "./ticket-source.fixture";
import type { TicketSourceProvider } from "./ticket-source.provider";
import {
  TICKET_SOURCE_PROVIDERS,
  TICKET_SOURCE_REGISTRY_ERRORS,
  TicketSourceRegistry,
} from "./ticket-source.registry";

/**
 * The registry is a `Map` with two refusals and two boot-time checks
 * ([#139](https://github.com/NobuData/ouroboros/issues/139)), and the interesting cases are
 * all about what it refuses rather than what it looks up.
 *
 * **The empty registry is a case, not an omission.** This build registers nothing — Q.3
 * ([#140](https://github.com/NobuData/ouroboros/issues/140)) is the first provider — and the
 * behaviour of a registry in that state is what a developer will meet first, so it is asserted
 * here rather than left to be discovered.
 */

/**
 * A registry holding these providers.
 *
 * Built through Nest rather than by calling the constructor, because what is under test
 * includes *a boot that fails* — and a boot failure has to come out of the injector to be the
 * thing the class's header claims it is.
 *
 * @param providers - What to register.
 * @returns The registry.
 */
async function registryOf(
  providers: readonly TicketSourceProvider[],
): Promise<TicketSourceRegistry> {
  const module = await Test.createTestingModule({
    providers: [TicketSourceRegistry, { provide: TICKET_SOURCE_PROVIDERS, useValue: providers }],
  }).compile();

  return module.get(TicketSourceRegistry);
}

describe("TicketSourceRegistry", () => {
  it("resolves a provider by the kind V030 stores", async () => {
    const github = scriptedProvider({ kind: "github" });
    const registry = await registryOf([github]);

    expect(registry.find("github")).toBe(github);
    expect(registry.get("github")).toBe(github);
  });

  it("lists the kinds this build can reach, in the migration's order", async () => {
    // V030's declaration order rather than the injector's, so a catalog a page renders is
    // stable between builds. Registered back to front, so the assertion is about the sort
    // rather than about the input.
    const registry = await registryOf([
      scriptedProvider({ kind: "linear" }),
      scriptedProvider({ kind: "github" }),
    ]);

    expect(registry.kinds()).toStrictEqual(["github", "linear"]);
  });

  it("answers nothing for a kind this build has no provider for", async () => {
    // What the *loop* calls, and why: a source of an unsupported kind is skipped with a reason
    // rather than marked failed, because a missing provider is a property of the build rather
    // than of somebody's configuration.
    const registry = await registryOf([scriptedProvider({ kind: "github" })]);

    expect(registry.find("jira")).toBeUndefined();
  });

  it("refuses a request for an unregistered kind with a 501 naming what is available", async () => {
    // `501` rather than `404`: *this kind exists and this build has no provider for it* is a
    // different fact from *there is no such kind*, and the person who needs to tell them apart
    // is whoever is implementing the other half.
    const registry = await registryOf([scriptedProvider({ kind: "github" })]);

    expect.assertions(4);

    try {
      registry.get("jira");
    } catch (error) {
      expect(error).toBeInstanceOf(NotImplementedError);

      const domain = error as NotImplementedError;

      expect(domain.getStatus()).toBe(501);
      expect(domain.code).toBe(TICKET_SOURCE_REGISTRY_ERRORS.kindUnsupported);
      expect(domain.details).toStrictEqual({ kind: "jira", registered: ["github"] });
    }
  });

  it("is honest about every kind when nothing is registered, which is this build", async () => {
    // The state `ticket-sources.module.ts` ships in. A registry that threw at construction for
    // being empty would make a build that has the interface and not the implementations
    // unbootable, which is the opposite of what shipping an SPI first is for.
    const registry = await registryOf([]);

    expect(registry.kinds()).toStrictEqual([]);

    for (const kind of TICKET_SOURCE_KINDS) {
      expect(registry.find(kind)).toBeUndefined();
      expect(() => registry.get(kind)).toThrow(NotImplementedError);
    }
  });

  it("stops the process at boot when two providers claim one kind", async () => {
    // Rather than silently shadowing the first on whichever order the injector produced. A
    // boot failure is loud and a shadowed provider is a source syncing through code nobody
    // thinks is running.
    await expect(
      registryOf([scriptedProvider({ kind: "github" }), scriptedProvider({ kind: "github" })]),
    ).rejects.toThrow('Two providers are registered for ticket source kind "github"');
  });

  it("stops the process at boot when a provider claims webhooks and has no handler", async () => {
    // The half a type cannot catch. `WebhookCapableProvider` narrows the flag to `true`, so a
    // provider *with* the member cannot report `false`; nothing stops a provider *without* one
    // from reporting `true`, and `supportsWebhooks` would then narrow onto a member that is
    // not there.
    const liar: TicketSourceProvider = {
      ...scriptedProvider(),
      capabilities: () => ({ ...NO_CAPABILITIES, webhooks: true }),
    };

    await expect(registryOf([liar])).rejects.toThrow(
      'Provider "github" declares webhooks: true but its webhookHandler member says otherwise',
    );
  });

  it("stops the process at boot when a provider has a handler and denies webhooks", async () => {
    // The other direction, reachable only by defeating the type — which a provider compiled
    // against an older copy of this interface, or written in JavaScript, would do by accident.
    const liar = {
      ...scriptedProvider(),
      capabilities: () => NO_CAPABILITIES,
      webhookHandler: () => Promise.resolve({ tickets: [] }),
    } as unknown as TicketSourceProvider;

    await expect(registryOf([liar])).rejects.toThrow(
      'Provider "github" declares webhooks: false but its webhookHandler member says otherwise',
    );
  });

  it("accepts a provider whose flag and member agree", async () => {
    const registry = await registryOf([webhookProvider()]);

    expect(registry.webhookCapable("github").capabilities().webhooks).toBe(true);
  });

  it("refuses a webhook for a provider that only polls, with a 422", async () => {
    // A `422` rather than a `404`: the source exists and the route exists, and what is not
    // acceptable is asking *this* tracker to deliver one.
    const registry = await registryOf([scriptedProvider({ kind: "github" })]);

    expect.assertions(3);

    try {
      registry.webhookCapable("github");
    } catch (error) {
      const domain = error as NotImplementedError;

      expect(domain.getStatus()).toBe(422);
      expect(domain.code).toBe(TICKET_SOURCE_REGISTRY_ERRORS.kindNoWebhooks);
      expect(domain.details).toStrictEqual({ kind: "github" });
    }
  });

  it("refuses a webhook for an unregistered kind with the 501 rather than the 422", async () => {
    // The order of the two refusals: *we have no provider* is the more specific fact, and
    // answering `422` would tell somebody their tracker does not do webhooks when what is
    // true is that this build cannot reach it at all.
    const registry = await registryOf([]);

    expect(() => registry.webhookCapable("jira")).toThrow(NotImplementedError);
  });
});
