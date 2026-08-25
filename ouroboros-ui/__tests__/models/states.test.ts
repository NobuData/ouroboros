import { describe, expect, it } from "vitest";

import {
  CONNECT_PROVIDER_NOTE,
  MATRIX_FAILED_NOTE,
  NO_PROVIDERS_NOTE,
  NO_PROVIDERS_TITLE,
  NO_ROUTES_NOTE,
  NO_ROUTES_TITLE,
  PROVIDERS_UNREAD_NOTE,
  READ_ONLY_BODY,
  ROUTING_FAILED_HEADLINE,
  SEED_ROUTES_REASON,
  STEP_WORD,
  connectedNote,
  foundationSteps,
  guidanceNote,
  guidanceTitle,
  readOnlyNote,
  routingState,
} from "@/app/models/states";

import { emptyMatrix, readings, seededProviders, unmeasuredMatrix } from "../helpers/models";

/**
 * The page's states (#205), decided as data.
 *
 * Every branch the screen takes is a value this module returns, so the acceptance criteria
 * — *no providers → no routes → populated*, *load failure and empty are distinct*, *the role
 * is explained* — are assertions on small objects here and rendering assertions in
 * `models-screen.test.tsx`.
 */

describe("routingState", () => {
  it("is failed when the matrix read was refused, whatever the strip said", () => {
    // A refused matrix has no answer to *is anything routed*, so the strip does not get a
    // vote — the page draws the banner and the seat, and the strip degrades or draws on its
    // own.
    expect(routingState(readings({ matrix: { ok: false, reason: "Down." } }))).toEqual({
      kind: "failed",
      reason: "Down.",
    });
    expect(
      routingState(
        readings({
          providers: { ok: true, value: [] },
          matrix: { ok: false, reason: "Down." },
        }),
      ),
    ).toEqual({ kind: "failed", reason: "Down." });
  });

  it("is populated the moment there is one task kind, routed or not", () => {
    expect(routingState(readings())).toEqual({ kind: "populated" });
    // Kinds with no usage are still kinds: the matrix draws them with em-dashes (M7).
    expect(routingState(readings({ matrix: { ok: true, value: unmeasuredMatrix() } }))).toEqual({
      kind: "populated",
    });
    // …and a kind with no route is a row with an empty cell, never guidance — hiding it would
    // hide the kind somebody came to configure.
    const unrouted = { ...unmeasuredMatrix(), taskKinds: unmeasuredMatrix().taskKinds.map((kind) => ({ ...kind, route: null })) };

    expect(routingState(readings({ matrix: { ok: true, value: unrouted } }))).toEqual({
      kind: "populated",
    });
  });

  it("is no-providers for the personal workspace's seed: nothing connected, nothing routed", () => {
    expect(
      routingState(
        readings({ providers: { ok: true, value: [] }, matrix: { ok: true, value: emptyMatrix() } }),
      ),
    ).toEqual({ kind: "no-providers" });
  });

  it("is no-routes once a provider is connected and nothing is routed, counting the connections", () => {
    expect(
      routingState(
        readings({
          providers: { ok: true, value: seededProviders().slice(0, 1) },
          matrix: { ok: true, value: emptyMatrix() },
        }),
      ),
    ).toEqual({ kind: "no-routes", connected: 1 });
    expect(routingState(readings({ matrix: { ok: true, value: emptyMatrix() } }))).toEqual({
      kind: "no-routes",
      connected: 5,
    });
  });

  it("is no-routes with an unknown count when the strip could not be read, rather than guessing none", () => {
    // *Nobody could ask* is not *nobody has connected one*. The strip's own honesty (M8),
    // carried into the page's state.
    expect(
      routingState(
        readings({
          providers: { ok: false, reason: "Down." },
          matrix: { ok: true, value: emptyMatrix() },
        }),
      ),
    ).toEqual({ kind: "no-routes", connected: null });
  });
});

describe("the guidance", () => {
  it("titles the two states differently, and says why for each", () => {
    expect(guidanceTitle({ kind: "no-providers" })).toBe(NO_PROVIDERS_TITLE);
    expect(guidanceNote({ kind: "no-providers" })).toBe(NO_PROVIDERS_NOTE);
    expect(guidanceTitle({ kind: "no-routes", connected: 1 })).toBe(NO_ROUTES_TITLE);
    expect(guidanceNote({ kind: "no-routes", connected: 1 })).toBe(NO_ROUTES_NOTE);
    expect(NO_PROVIDERS_TITLE).not.toBe(NO_ROUTES_TITLE);
  });

  it("draws both steps always, and marks the provider step as next for a workspace with none", () => {
    const steps = foundationSteps({ kind: "no-providers" });

    expect(steps.map((step) => [step.key, step.status])).toEqual([
      ["provider", "current"],
      ["routes", "pending"],
    ]);
    expect(steps[0]?.note).toBe(CONNECT_PROVIDER_NOTE);
  });

  it("ticks the provider step off with the count, and makes the routes step next", () => {
    const steps = foundationSteps({ kind: "no-routes", connected: 3 });

    expect(steps.map((step) => [step.key, step.status])).toEqual([
      ["provider", "done"],
      ["routes", "current"],
    ]);
    expect(steps[0]?.note).toBe("3 providers connected");
  });

  it("marks the provider step unknown, with the reason, when the strip could not be read", () => {
    const steps = foundationSteps({ kind: "no-routes", connected: null });

    expect(steps[0]?.status).toBe("unknown");
    expect(steps[0]?.note).toBe(PROVIDERS_UNREAD_NOTE);
    expect(steps[1]?.status).toBe("current");
  });

  it("counts providers in the singular and the plural", () => {
    expect(connectedNote(1)).toBe("1 provider connected");
    expect(connectedNote(2)).toBe("2 providers connected");
  });

  it("gives every status a word, so hue is never the only signal", () => {
    for (const status of ["done", "current", "pending", "unknown"] as const) {
      expect(STEP_WORD[status]).toMatch(/\S/);
    }
  });

  it("names the service, not an issue, as what the bootstrap is waiting on", () => {
    // No issue owns the endpoint yet; a number here would be a promise nobody has made. The
    // sentence says what is missing and where the eight kinds come from today.
    expect(SEED_ROUTES_REASON).toMatch(/task kinds/);
    expect(SEED_ROUTES_REASON).toMatch(/development seed/);
    expect(SEED_ROUTES_REASON).not.toMatch(/#\d/);
  });
});

describe("the read-only note", () => {
  it("names the role, with the article it takes", () => {
    expect(readOnlyNote("member").head).toBe("Viewing routing as a member.");
    expect(readOnlyNote("viewer").head).toBe("Viewing routing as a viewer.");
    // Total over the contract's four, even the two the screen never draws it for.
    expect(readOnlyNote("owner").head).toBe("Viewing routing as an owner.");
    expect(readOnlyNote("admin").head).toBe("Viewing routing as an admin.");
  });

  it("says who can edit, and that nothing here is editable", () => {
    expect(readOnlyNote("member").body).toBe(READ_ONLY_BODY);
    expect(READ_ONLY_BODY).toMatch(/owner or an admin/);
    expect(READ_ONLY_BODY).toMatch(/nothing here can be edited/);
  });
});

describe("the failed read", () => {
  it("has a headline that says the state in words, and a seat note that points up rather than repeating", () => {
    expect(ROUTING_FAILED_HEADLINE).toMatch(/could not be read/);
    expect(MATRIX_FAILED_NOTE).toMatch(/banner above/);
    expect(MATRIX_FAILED_NOTE).not.toMatch(/retry again|Retry\b/);
  });
});
