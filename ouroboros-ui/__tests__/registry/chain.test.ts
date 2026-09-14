import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ALIAS_DISABLED,
  ALIAS_UNBOUND,
  CHAIN_CAPTION,
  CHAIN_TITLE,
  DROPPED,
  GOVERNANCE_ENFORCED,
  KEPT,
  NOT_IN_CHAIN,
  ROUTES_UNREAD,
  SIMULATED_LABEL,
  UNROUTED_NOTE,
  WHY_GOVERNANCE,
  WHY_KEYS,
  WHY_SWAP,
  WHY_TITLE,
  chainKey,
  chainTag,
  chainView,
  keyLabel,
  primaryTaskKind,
  providerLabel,
  resolvedLabel,
  routeFor,
  routeLookups,
  runLabel,
  taskArgument,
  unroutedReasons,
  whyRows,
} from "@/app/registry/chain";
import { NO_PROVIDER, tableRows } from "@/app/registry/table";

import { FLOOR_BREACHED, failRunExample, seededTaskKinds } from "../helpers/models";
import {
  COPILOT_DROPPED,
  DISABLED_DROPPED,
  UNBOUND_DROPPED,
  analyzeSimulation,
  disabledSimulation,
  seededRegistry,
  seededSnapshot,
  unboundSimulation,
} from "../helpers/registry";

/**
 * The decisions behind mockup 21's two right-hand cards (#595), as functions over the dev
 * seed's own rows and run #482's stored resolution.
 *
 * The render suites (`why-card.test.tsx`, `chain-card.test.tsx`) show these drawn; what is held
 * here is what makes the cards honest: the copy is the mockup's, a run number comes from a
 * snapshot and from nothing else, a dropped hop keeps the resolution's own sentence, and an
 * alias nothing routes through says so.
 */

/** The mockup the cards are drawn from, read once. */
const MOCKUP = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "docs", "mockups", "21-model-registry.html"),
  "utf8",
);

/** The seeded rows, decided, by alias. */
const ROWS = new Map(tableRows(seededRegistry()).map((row) => [row.alias, row]));

/**
 * One seeded row.
 *
 * @param alias Which.
 * @returns The row.
 */
function row(alias: string) {
  const found = ROWS.get(alias);
  if (found === undefined) throw new Error(`no seeded row ${alias}`);
  return found;
}

describe("the why-aliases card's copy", () => {
  it("is the mockup's three rows, verbatim and in order", () => {
    expect(whyRows(true)).toEqual([WHY_SWAP, WHY_KEYS, WHY_GOVERNANCE]);

    for (const { title, body } of whyRows(true)) {
      expect(MOCKUP, title).toContain(`<strong>${title}</strong>`);
      expect(MOCKUP, body).toContain(`<p>${body}</p>`);
    }
  });

  it("titles the card as the mockup does, which the card head uppercases", () => {
    expect(MOCKUP).toContain(WHY_TITLE.toUpperCase());
  });

  it("holds the governance row back while publish-time rejection is not live", () => {
    // A present-tense claim about behaviour that has not shipped is not softened — it is not
    // shown at all.
    expect(whyRows(false)).toEqual([WHY_SWAP, WHY_KEYS]);
    expect(whyRows(false)).not.toContain(WHY_GOVERNANCE);
  });

  it("shows it by default, because CH.6 (#589) shipped the publish gate", () => {
    expect(GOVERNANCE_ENFORCED).toBe(true);
    expect(whyRows()).toContain(WHY_GOVERNANCE);
  });
});

describe("which task kind an alias is simulated for", () => {
  it("is the first route, in the matrix's order, with the alias as its primary", () => {
    // `coder-max` is the primary of plan, implement and review; plan sorts first.
    expect(primaryTaskKind(seededTaskKinds(), "coder-max")).toBe("plan");
    // `local-docs` is a fallback of analyze and implement but the primary of docs — primary wins.
    expect(primaryTaskKind(seededTaskKinds(), "local-docs")).toBe("docs");
    expect(primaryTaskKind(seededTaskKinds(), "coder-fallback")).toBe("test-gen");
  });

  it("falls back to the first route naming the alias anywhere, for a fallback-only alias", () => {
    const withoutAnalyze = seededTaskKinds().filter((kind) => kind.name !== "analyze");

    // With analyze gone, `coder-std` is only ever a fallback; plan's chain names it second.
    expect(primaryTaskKind(withoutAnalyze, "coder-std")).toBe("plan");
  });

  it("is null for an alias no route names", () => {
    expect(primaryTaskKind(seededTaskKinds(), "gpt5-experiments")).toBeNull();
    expect(primaryTaskKind(seededTaskKinds(), "second-opinion")).toBeNull();
  });

  it("skips a task kind with no route rather than failing on it", () => {
    const [first, ...rest] = seededTaskKinds();

    expect(primaryTaskKind([{ ...first, route: null }, ...rest], "coder-std")).toBe("plan");
  });
});

describe("the page's route lookups", () => {
  it("names a routed alias's task kind and marks an unrouted one", () => {
    const lookups = routeLookups({ ok: true, value: seededTaskKinds() }, ["coder-max", "gpt5-experiments"]);

    expect(lookups).toEqual({
      "coder-max": { kind: "routed", taskKind: "plan" },
      "gpt5-experiments": { kind: "unrouted" },
    });
  });

  it("marks every alias unknown with the service's sentence when the routes were refused", () => {
    // Never `unrouted`: a claim that nothing routes through an alias nobody could check.
    const lookups = routeLookups({ ok: false, reason: "routing away" }, ["coder-max"]);

    expect(lookups).toEqual({ "coder-max": { kind: "unknown", reason: "routing away" } });
  });

  it("answers unknown for an alias the page computed nothing for", () => {
    expect(routeFor({}, "coder-max")).toEqual({ kind: "unknown", reason: ROUTES_UNREAD });
    expect(routeFor({ "coder-max": { kind: "unrouted" } }, "coder-max")).toEqual({ kind: "unrouted" });
  });
});

describe("the key an answer is held under", () => {
  const routed = { kind: "routed", taskKind: "plan" } as const;

  it("changes when the alias is switched off, so re-viewing it asks again", () => {
    const on = row("coder-std");

    expect(chainKey({ ...on, enabled: false }, routed)).not.toBe(chainKey(on, routed));
  });

  it("changes when the binding or the route changes", () => {
    const bound = row("coder-std");

    expect(chainKey({ ...bound, provider: null }, routed)).not.toBe(chainKey(bound, routed));
    expect(chainKey(bound, { kind: "unrouted" })).not.toBe(chainKey(bound, routed));
    expect(chainKey(bound, { kind: "routed", taskKind: "review" })).not.toBe(chainKey(bound, routed));
  });

  it("is the same for the same question", () => {
    expect(chainKey(row("coder-std"), routed)).toBe(chainKey(row("coder-std"), routed));
  });
});

describe("run #482, drawn for coder-max", () => {
  const view = chainView("coder-max", { kind: "snapshot", snapshot: seededSnapshot() });

  it("reproduces the mockup's rail, field for field", () => {
    expect(view).toEqual({
      tag: { kind: "run", label: "run #482" },
      taskKind: "implement",
      routeTag: "implement-primary",
      alias: "coder-max",
      hop: {
        dropped: false,
        provider: "Anthropic",
        keyLabel: "(key …Xq4A)",
        modelId: "claude-fable-5",
      },
      status: { tone: "ok", label: "resolved · 42ms" },
      explanation: null,
      failure: null,
    });
  });

  it("prints exactly the strings the mockup's card prints", () => {
    expect(MOCKUP).toContain(`<span class="tag">${runLabel(482)}</span>`);
    expect(MOCKUP).toContain(`${taskArgument("implement")}<span class="k">)</span>`);
    expect(MOCKUP).toContain(`Anthropic <span class="k">${keyLabel("Xq4A") ?? ""}</span>`);
    expect(MOCKUP).toContain(`${resolvedLabel(42)}</span>`);
    expect(MOCKUP).toContain(`<p class="chain-caption">${CHAIN_CAPTION}</p>`);
    expect(MOCKUP).toContain(CHAIN_TITLE.toUpperCase());
  });
});

describe("the same run, asked about a hop it did not resolve through", () => {
  it("draws coder-fallback struck, with the resolution's sentence verbatim", () => {
    const view = chainView("coder-fallback", { kind: "snapshot", snapshot: seededSnapshot() });

    expect(view.tag).toEqual({ kind: "run", label: "run #482" });
    expect(view.hop).toEqual({
      dropped: true,
      provider: "GitHub Copilot",
      keyLabel: null,
      modelId: "gpt-5-codex",
    });
    expect(view.status).toEqual({ tone: "err", label: DROPPED });
    expect(view.explanation).toBe(COPILOT_DROPPED);
  });

  it("draws a kept hop in reserve as kept, with its sentence, and never as resolved", () => {
    const view = chainView("local-docs", { kind: "snapshot", snapshot: seededSnapshot() });

    expect(view.status).toEqual({ tone: "neutral", label: KEPT });
    expect(view.explanation).toBe("Fallback 2 · healthy");
  });

  it("says a failed run failed, with the heading Simulate uses for the same outcome", () => {
    const failed = seededSnapshot({ outcome: "fail_run", resolvedHopIndex: null });

    expect(chainView("coder-max", { kind: "snapshot", snapshot: failed }).failure).toBe("The run fails");
  });

  it("prints no duration for an untimed resolution, rather than 0ms", () => {
    const untimed = seededSnapshot({ durationMs: null });

    expect(chainView("coder-max", { kind: "snapshot", snapshot: untimed }).status.label).toBe("resolved");
  });

  it("says the alias is not in the chain, rather than drawing another alias's hop", () => {
    const view = chainView("sizer", { kind: "snapshot", snapshot: seededSnapshot() });

    expect(view.hop).toBeNull();
    expect(view.status).toEqual({ tone: "err", label: NOT_IN_CHAIN });
  });
});

describe("a simulated chain", () => {
  it("carries the simulated label and never a run number", () => {
    const view = chainView("coder-std", { kind: "simulated", resolution: analyzeSimulation() });

    expect(view.tag).toEqual({ kind: "simulated", label: SIMULATED_LABEL });
    expect(JSON.stringify(view)).not.toMatch(/run #/);
    expect(SIMULATED_LABEL).toBe("simulated — live runs arrive with invocation");
  });

  it("resolves without a duration, because Simulate times nothing", () => {
    const view = chainView("coder-std", { kind: "simulated", resolution: analyzeSimulation() });

    expect(view.status).toEqual({ tone: "ok", label: "resolved" });
    // Simulate reports no key suffix, so none is printed.
    expect(view.hop?.keyLabel).toBeNull();
  });

  it("draws a switched-off alias as a dropped hop with who and when, verbatim", () => {
    const view = chainView("coder-std", { kind: "simulated", resolution: disabledSimulation() });

    expect(view.hop?.dropped).toBe(true);
    expect(view.status).toEqual({ tone: "err", label: DROPPED });
    expect(view.explanation).toBe(DISABLED_DROPPED);
  });

  it("draws an unbound alias with no provider and the unbound sentence", () => {
    const view = chainView("coder-std", { kind: "simulated", resolution: unboundSimulation() });

    expect(view.hop).toMatchObject({ dropped: true, provider: NO_PROVIDER, keyLabel: null });
    expect(view.explanation).toBe(UNBOUND_DROPPED);
  });

  it("carries a refused run's reason, verbatim", () => {
    const view = chainView("coder-max", { kind: "simulated", resolution: failRunExample() });

    expect(view.failure).toBe(FLOOR_BREACHED);
    expect(view.status.tone).toBe("err");
  });
});

describe("the tag", () => {
  it("is composed from a snapshot's run and from nothing else", () => {
    expect(chainTag({ kind: "snapshot", snapshot: seededSnapshot() })).toEqual({ kind: "run", label: "run #482" });
    expect(chainTag({ kind: "simulated", resolution: analyzeSimulation() })).toEqual({
      kind: "simulated",
      label: SIMULATED_LABEL,
    });
  });
});

describe("an alias nothing routes through", () => {
  it("gives the unbound reason first for an unbound alias", () => {
    expect(unroutedReasons(row("gpt5-experiments"))).toEqual([ALIAS_UNBOUND, UNROUTED_NOTE]);
    expect(ALIAS_UNBOUND).toBe("alias unbound — no provider");
  });

  it("gives the disabled reason for a bound alias that is switched off", () => {
    expect(unroutedReasons({ ...row("second-opinion"), enabled: false })).toEqual([ALIAS_DISABLED, UNROUTED_NOTE]);
  });

  it("gives only the routing reason for a healthy one", () => {
    expect(unroutedReasons(row("second-opinion"))).toEqual([UNROUTED_NOTE]);
  });
});

describe("the small presentations", () => {
  it("labels a provider by its kind, and falls back to its name for a kind with no label", () => {
    expect(providerLabel({ kind: "anthropic", displayName: "Anthropic Claude" })).toBe("Anthropic");
    expect(providerLabel({ kind: "bedrock", displayName: "AWS Bedrock" })).toBe("AWS Bedrock");
    expect(providerLabel(null)).toBe(NO_PROVIDER);
  });

  it("prints a zero duration as measured, and a missing suffix as nothing", () => {
    expect(resolvedLabel(0)).toBe("resolved · 0ms");
    expect(keyLabel(null)).toBeNull();
  });
});
