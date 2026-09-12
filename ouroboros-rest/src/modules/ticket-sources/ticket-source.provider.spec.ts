import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TICKET_STATES } from "../db/schema";
import { TicketSourceError } from "./ticket-source.errors";
import {
  NO_CAPABILITIES,
  githubTicket,
  jiraTicket,
  page,
  scriptedProvider,
  webhookProvider,
} from "./ticket-source.fixture";
import { supportsWebhooks, type TicketSourceProvider } from "./ticket-source.provider";

/**
 * The SPI is an interface, so most of what it claims is checked by the compiler. What a suite
 * can add is the three things a type cannot say
 * ([#139](https://github.com/NobuData/ouroboros/issues/139)):
 *
 *   * **The optional member is unreachable without the flag.** Q.2 declares `webhookHandler`
 *     *"optional, declared through `capabilities()`"*, and the way that is kept is a
 *     sub-interface plus {@link supportsWebhooks}. The cases below are the run-time half; the
 *     compile-time half is the `@ts-expect-error` a few lines down, which fails the build if
 *     the member ever becomes reachable without the guard.
 *   * **The canonical shape carries no tracker.** Decision **P6** as an assertion over the
 *     interface's own source: a field named for one tracker here would put that tracker's
 *     assumption into every provider that ever implements this.
 *   * **The two shapes really are the same shape.** A GitHub-flavoured ticket and a
 *     Jira-flavoured one satisfy the same type with the same fields populated differently,
 *     which is the whole of what *canonical* means and the thing that would quietly stop being
 *     true if the interface grew a field only one tracker can fill.
 */

/** The interface's own source, with this repository's issue links removed — see the errors spec. */
const SOURCE = readFileSync(join(__dirname, "ticket-source.provider.ts"), "utf8").replaceAll(
  /https:\/\/github\.com\/NobuData\/\S*/g,
  "",
);

describe("the TicketSourceProvider SPI", () => {
  it("declares the five members the issue enumerates and no sixth", () => {
    // The issue's list: capabilities, validateConfig, fullSync, incrementalSync, mapTicket —
    // plus the optional webhookHandler on the sub-interface, and `kind` as the registry key.
    // Asserted against a conforming double rather than against the type, because the useful
    // failure is *an implementation that no longer satisfies the contract*.
    const provider: TicketSourceProvider = scriptedProvider();

    expect(typeof provider.kind).toBe("string");
    expect(typeof provider.capabilities).toBe("function");
    expect(typeof provider.validateConfig).toBe("function");
    expect(typeof provider.fullSync).toBe("function");
    expect(typeof provider.incrementalSync).toBe("function");
    expect(typeof provider.mapTicket).toBe("function");
    expect((provider as unknown as Record<string, unknown>).webhookHandler).toBeUndefined();
  });

  it("answers all three capability flags, so none can be merely unmentioned", () => {
    const capabilities = scriptedProvider().capabilities();

    expect(Object.keys(capabilities).sort()).toStrictEqual([
      "bidirectionalWrites",
      "labels",
      "webhooks",
    ]);
  });

  it("names no tracker in the canonical shape", () => {
    // Decision P6, as a property of the interface: `githubRepoId`, `number` and a `gh_` prefix
    // are exactly the four columns V030 removed, and a field here named for one of them would
    // put them back one provider at a time. The code below the header is what is searched, for
    // the errors spec's reason — the header cites Q.3 and the v2 providers by name.
    const body = SOURCE.slice(SOURCE.indexOf("export interface TicketSourceCapabilities"));

    for (const shaped of ["githubRepo", "ghUrl", "issueNumber", "projectKey", "teamId"]) {
      expect(body).not.toContain(shaped);
    }
  });

  it("collapses every tracker's states onto the two V030 stores", () => {
    // The one mapping decision the interface *forces* rather than accommodates. A wider
    // vocabulary would be a filter whose options changed with the tracker, and the union here
    // is the same one the column's CHECK carries.
    for (const ticket of [githubTicket(), jiraTicket()]) {
      expect(TICKET_STATES).toContain(ticket.state);
    }
  });
});

describe("the canonical ticket", () => {
  it("is one shape for a GitHub issue and a Jira ticket alike", () => {
    // What *canonical* means, checked the only way it can be: the same keys, populated
    // differently. A field only one tracker can fill would show up here as a key the other's
    // fixture had to invent a value for.
    expect(Object.keys(githubTicket()).sort()).toStrictEqual(Object.keys(jiraTicket()).sort());
  });

  it("separates the identity from the display form, which GitHub is the case that hides", () => {
    // `485` and `#485` differ by one character, so a model derived from GitHub alone would
    // have had one column. Jira is where the two really come apart — `10042` is what the API
    // takes and `PROJ-142` is what a person reads — and V030 split the columns for it.
    const github = githubTicket();
    const jira = jiraTicket();

    expect(github.externalKey).not.toBe(github.externalId);
    expect(jira.externalKey).not.toBe(jira.externalId);
    expect(jira.externalKey).not.toContain(jira.externalId);
  });

  it("lets a ticket carry no repository at all", () => {
    // The acceptance criterion V030 asserts in SQL, asserted here about the shape a provider
    // returns: a Jira ticket has no repository, and nothing in the canonical model asks it to
    // pretend otherwise.
    expect(JSON.stringify(jiraTicket().meta)).not.toContain("repo");
  });

  it("lets a body and an author be absent without inventing a value for either", () => {
    // `''` and *no description* are different facts, and so are *no attribution* and an empty
    // name. V030 makes both columns nullable for that reason.
    const bodiless = jiraTicket();

    expect(bodiless.body).toBeNull();
    expect(githubTicket({ author: null }).author).toBeNull();
  });
});

describe("supportsWebhooks", () => {
  it("is false for a provider that only polls", () => {
    expect(supportsWebhooks(scriptedProvider())).toBe(false);
  });

  it("narrows a webhook-capable provider to one with the member", () => {
    const provider: TicketSourceProvider = webhookProvider();

    expect(supportsWebhooks(provider)).toBe(true);

    if (supportsWebhooks(provider)) {
      // The narrowing is the point: without it there is no way to reach the member at all.
      // This line not compiling would be the acceptance criterion failing.
      expect(typeof provider.webhookHandler).toBe("function");
    }
  });

  it("does not let the member be reached without the guard", () => {
    const provider: TicketSourceProvider = webhookProvider();

    // @ts-expect-error — `webhookHandler` is not on `TicketSourceProvider`, which is what makes
    // *"declared through capabilities()"* a compile error rather than a run-time one. If this
    // stops erroring, the sub-interface has stopped gating anything.
    expect(provider.webhookHandler).toBeDefined();
  });

  it("trusts the flag rather than the presence of the method", () => {
    // A provider is entitled to say what it can do, and an inherited or half-finished member
    // must not be callable because it happens to exist. The registry is what refuses this pair
    // at boot; what is asserted here is that the guard itself reads the flag.
    const lying: TicketSourceProvider = {
      ...scriptedProvider(),
      capabilities: () => NO_CAPABILITIES,

      ...{ webhookHandler: () => Promise.resolve({ tickets: [] }) },
    };

    expect(supportsWebhooks(lying)).toBe(false);
  });
});

describe("a webhook handler", () => {
  it("refuses an unsigned delivery as auth, because a signature is a credential", () => {
    // The SPI says a provider verifies its own signature and throws `auth` when it cannot: a
    // shared helper would be five schemes in one function with a `switch` on the kind, which
    // is the branch the SPI exists to remove.
    return expect(webhookProvider().webhookHandler({}, null)).rejects.toMatchObject({
      errorClass: "auth",
    });
  });

  it("answers canonical tickets, so a delivery and a poll write through one upsert", () => {
    return expect(
      webhookProvider({ tickets: [githubTicket()] }).webhookHandler({}, "sha256=…"),
    ).resolves.toStrictEqual({ tickets: [githubTicket()] });
  });
});

describe("a page", () => {
  it("says whether there is more without the caller reading the cursor", () => {
    // The acceptance criterion this third field exists for: *"the loop stores what the provider
    // returns and never interprets it"*. A loop that inferred "more" from the cursor would be
    // interpreting it, and a loop that inferred it from the page length would be guessing at
    // somebody else's page size.
    const more = page([githubTicket()], { nextCursor: "2026-09-11T09:00:00Z", hasMore: true });

    expect(more.hasMore).toBe(true);
    expect(more.nextCursor).toBe("2026-09-11T09:00:00Z");
  });

  it("treats an empty page with no cursor as the ordinary answer", () => {
    // Most polls of most sources find nothing changed, and a provider with no watermark to
    // record returns null rather than `''` — which V030's CHECK refuses, because a cursor of
    // `''` is a poller that re-imports the whole backlog every pass.
    expect(page()).toStrictEqual({ tickets: [], nextCursor: null, hasMore: false });
  });
});

describe("a scripted provider", () => {
  it("records which member the caller reached for", () => {
    // The double's own contract, asserted once here so the loop's suite can rely on it.
    const provider = scriptedProvider({ pages: [page([githubTicket()])] });

    return provider
      .fullSync({ sourceId: "s", organizationId: "o", config: {}, credentials: null })
      .then((first) => {
        expect(first.tickets).toHaveLength(1);
        expect(provider.members).toStrictEqual(["fullSync"]);
        expect(provider.cursors).toStrictEqual([undefined]);
      });
  });

  it("throws what it was told to throw", () => {
    const provider = scriptedProvider({ fails: new TicketSourceError("rate_limit", "429") });

    return expect(
      provider.incrementalSync(
        { sourceId: "s", organizationId: "o", config: {}, credentials: null },
        "cursor",
      ),
    ).rejects.toMatchObject({ errorClass: "rate_limit" });
  });
});
