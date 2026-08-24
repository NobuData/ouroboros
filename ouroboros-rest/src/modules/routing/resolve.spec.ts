import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FLOOR_CODES, HOP_CODES, RESOLUTION_FAILURE_CODES, RULE_CODES } from "./explanations";
import { RESOLUTION_VERSION, type Resolution } from "./resolution";
import { resolve } from "./resolve";
import {
  aliasNamed,
  ALIASES,
  CONNECTIONS,
  DOCS_HOPS,
  DOCS_ROUTE,
  IMPLEMENT_HOPS,
  resolutionInput,
  REVIEW_HOPS,
  REVIEW_ROUTE,
  routedWith,
  RULES,
  withHealth,
} from "./routing.fixture";

/**
 * The matrix the ticket asks for: rules × health × floor × local policy × cost, over one pure
 * function and one workspace.
 *
 * Every case starts from `routing.fixture.ts` — mockup 06 as the seed writes it — and changes
 * one thing, so a failure reads as *this variable did that* rather than as a diff of two
 * hand-built worlds.
 *
 * Three properties are asserted over and over rather than once, because each of them is a way
 * the product's central promise fails quietly:
 *
 *   * **a dropped hop is still in the chain.** The mockup's inspector draws it struck through
 *     with a reason beside it, so a resolution that filtered it out would have destroyed the
 *     explanation before anything could render it;
 *   * **a refusal is a refusal.** A floor breach must not come back as a chain that starts
 *     three hops down, which is the difference between *degrades gracefully* and *degrades
 *     silently*; and
 *   * **every decision carries a sentence.** Asserted as exact strings, because the
 *     acceptance criterion is that a client renders them *without post-processing* — and a
 *     test that only checked a sentence was non-empty would let the wording become a
 *     placeholder nobody notices until it is on a screen.
 */

/** The hops the executor would actually try. */
function kept(resolution: Resolution): readonly string[] {
  return resolution.chain.filter((hop) => hop.decision === "kept").map((hop) => hop.alias);
}

/** The hops that were dropped, with the reason each carries. */
function dropped(resolution: Resolution): readonly [string, string][] {
  return resolution.chain
    .filter((hop) => hop.decision === "dropped")
    .map((hop) => [hop.alias, hop.code]);
}

describe("resolving the mockup's own route", () => {
  it("returns the inspector's three hops, in order, all kept", () => {
    const resolution = resolve(resolutionInput());

    expect(resolution.outcome).toBe("resolved");
    expect(kept(resolution)).toEqual(["coder-max", "coder-fallback", "local-docs"]);
    expect(dropped(resolution)).toEqual([]);
  });

  it("resolves each hop to the model and provider the inspector prints", () => {
    const [primary, fallback, local] = resolve(resolutionInput()).chain;

    expect(primary.modelId).toBe("claude-fable-5");
    expect(primary.provider?.displayName).toBe("Anthropic Claude");
    expect(fallback.modelId).toBe("gpt-5-codex");
    expect(fallback.provider?.displayName).toBe("GitHub Copilot");
    expect(local.modelId).toBe("qwen3-coder:32b");
    expect(local.provider?.displayName).toBe("Ollama · workstation");
  });

  it("carries the operator's notes through unchanged, and composes no note of its own", () => {
    // The mockup's hop 2 and hop 3 print sentences somebody wrote; hop 1 prints one the page
    // composes from a position, a status and a latency. Keeping the two in separate fields is
    // what lets the inspector render the first and the simulate panel render the second.
    const [primary, fallback, local] = resolve(resolutionInput()).chain;

    expect(primary.note).toBeNull();
    expect(fallback.note).toBe("Fallback on 5xx / timeouts");
    expect(local.note).toBe("Offline mode — keeps the loop turning without a network");
  });

  it("explains every kept hop as the inspector's meta line", () => {
    const resolution = resolve(resolutionInput());

    expect(resolution.chain.map((hop) => hop.explanation)).toEqual([
      "Primary · healthy · 42ms",
      "Fallback 1 · healthy · elevated latency",
      "Fallback 2 · healthy",
    ]);
  });

  it("attaches the route's cost cap and stamps the version", () => {
    const resolution = resolve(resolutionInput());

    expect(resolution.maxCostCents).toBe(250);
    expect(resolution.resolutionVersion).toBe(RESOLUTION_VERSION);
    expect(resolution.resolutionVersion).toBe("r1");
  });

  it("records the floor even though no floor is set", () => {
    const resolution = resolve(resolutionInput());

    expect(resolution.floor).toEqual({
      hopIndex: null,
      code: FLOOR_CODES.none,
      explanation: "No floor is set — this route may degrade to the end of its chain.",
    });
  });

  it("lists no rules when nothing about the work has been stated", () => {
    // An unstated fact satisfies no condition — see `context.ts`. A context of `{}` firing
    // `effort ≥ L` would put every unsized run on the most expensive model in the workspace.
    expect(resolve(resolutionInput()).rules).toEqual([]);
  });
});

describe("the three seeded escalation rules", () => {
  it("fires the effort rule at L and merges its params over the alias's", () => {
    const resolution = resolve(resolutionInput({ context: { effort: "l" } }));
    const [applied] = resolution.rules;

    expect(applied.applied).toBe(true);
    expect(applied.code).toBe(RULE_CODES.paramsMerged);
    expect(applied.display).toBe("effort ≥ L → implement uses coder-max (max thinking)");
    expect(applied.explanation).toBe(
      "Applied — coder-max is already the primary, and the rule's parameters " +
        "were merged over the alias's.",
    );
    expect(resolution.chain[0].params).toEqual({ thinking: "max" });
  });

  it("fires it at every size above L and at none below", () => {
    for (const effort of ["l", "xl"] as const) {
      expect(resolve(resolutionInput({ context: { effort } })).rules).toHaveLength(1);
    }

    for (const effort of ["xs", "s", "m"] as const) {
      expect(resolve(resolutionInput({ context: { effort } })).rules).toEqual([]);
    }
  });

  it("fires the security rule on review and attaches the vote", () => {
    const resolution = resolve(
      resolutionInput({
        route: REVIEW_ROUTE,
        hops: REVIEW_HOPS,
        context: { labels: ["security", "backend"] },
      }),
    );
    const [applied] = resolution.rules;

    expect(applied.applied).toBe(true);
    expect(applied.code).toBe(RULE_CODES.voteAdded);
    expect(applied.explanation).toBe(
      "Applied — a second-opinion vote was added for the executor to obtain.",
    );
    expect(resolution.votes).toEqual([
      {
        alias: "second-opinion",
        modelId: "composer-2",
        params: {},
        ruleId: RULES[1].id,
        provider: {
          id: CONNECTIONS.cursor,
          kind: "cursor",
          displayName: "Cursor",
          baseUrl: null,
          status: "unknown",
          latencyMs: null,
          detail: null,
        },
      },
    ]);
  });

  it("fires the docs-only rule and filters the whole chain to local providers", () => {
    const resolution = resolve(resolutionInput({ context: { diffKind: "docs_only" } }));
    const [applied] = resolution.rules;

    expect(applied.applied).toBe(true);
    expect(applied.code).toBe(RULE_CODES.routedLocal);
    expect(kept(resolution)).toEqual(["local-docs"]);
    expect(dropped(resolution)).toEqual([
      ["coder-max", HOP_CODES.notLocal],
      ["coder-fallback", HOP_CODES.notLocal],
    ]);
    expect(resolution.chain[0].explanation).toBe(
      "Primary dropped — an escalation rule routes this run to local providers, " +
        "and Anthropic Claude is not one.",
    );
  });

  it("reports a rule that matched but modifies another kind, rather than hiding it", () => {
    // *My rule matched and nothing happened* is the 3am question, and a rules array that
    // listed only the applied ones would have no answer to it.
    const resolution = resolve(resolutionInput({ context: { labels: ["security"] } }));
    const [matched] = resolution.rules;

    expect(matched.applied).toBe(false);
    expect(matched.code).toBe(RULE_CODES.otherTaskKind);
    expect(matched.explanation).toBe(
      "Not applied — this rule modifies review, and this resolution is for implement.",
    );
    expect(resolution.votes).toEqual([]);
  });

  it("applies every matching rule, in sort_order", () => {
    const resolution = resolve(
      resolutionInput({ context: { effort: "xl", labels: ["security"], diffKind: "docs_only" } }),
    );

    expect(resolution.rules.map((rule) => rule.sortOrder)).toEqual([1, 2, 3]);
    expect(resolution.rules.map((rule) => rule.code)).toEqual([
      RULE_CODES.paramsMerged,
      RULE_CODES.otherTaskKind,
      RULE_CODES.routedLocal,
    ]);
  });
});

describe("a use_alias rule whose alias is not the primary", () => {
  /** The effort rule, pointed at an alias that is deeper in the chain or not in it at all. */
  function pointedAt(alias: string) {
    return [
      { ...RULES[0], then: { use_alias: { task_kind: "implement", alias, params: {} } } },
    ] as const;
  }

  it("moves an alias already in the chain to the front, without losing a hop", () => {
    const resolution = resolve(
      resolutionInput({ rules: pointedAt("local-docs"), context: { effort: "l" } }),
    );

    expect(resolution.rules[0].code).toBe(RULE_CODES.swapped);
    expect(kept(resolution)).toEqual(["local-docs", "coder-max", "coder-fallback"]);
  });

  it("prepends an alias the chain does not contain, and keeps every hop below it", () => {
    const resolution = resolve(
      resolutionInput({ rules: pointedAt("coder-std"), context: { effort: "l" } }),
    );

    expect(resolution.rules[0].code).toBe(RULE_CODES.prepended);
    expect(kept(resolution)).toEqual(["coder-std", "coder-max", "coder-fallback", "local-docs"]);
  });

  it("gives a prepended hop no stored position, so it can never be below a floor", () => {
    // The floor is a statement about the chain an operator saw. A rule that prepends must not
    // renumber it — see `resolve.ts`.
    const resolution = resolve(
      routedWith({ floorHopIndex: 1 }, { rules: pointedAt("coder-std"), context: { effort: "l" } }),
    );

    expect(resolution.chain[0].position).toBeNull();
    expect(kept(resolution)).toEqual(["coder-std", "coder-max"]);
  });

  it("does not apply a rule naming an alias this workspace has not bound", () => {
    const unbound = { ...aliasNamed("coder-std"), alias: "gpt5-experiments", binding: null };
    const resolution = resolve(
      resolutionInput({
        aliases: [...ALIASES, unbound],
        rules: pointedAt("gpt5-experiments"),
        context: { effort: "l" },
      }),
    );

    expect(resolution.rules[0].applied).toBe(false);
    expect(resolution.rules[0].code).toBe(RULE_CODES.aliasUnresolvable);
    expect(resolution.rules[0].explanation).toBe(
      "Not applied — this workspace has no alias named gpt5-experiments " +
        "bound to a provider connection.",
    );
    expect(kept(resolution)).toEqual(["coder-max", "coder-fallback", "local-docs"]);
  });
});

describe("health", () => {
  it("drops a hop whose provider an operator paused, and says who paused what", () => {
    const resolution = resolve(withHealth({ anthropic: "paused" }));

    expect(kept(resolution)).toEqual(["coder-fallback", "local-docs"]);
    expect(resolution.chain[0].explanation).toBe(
      "Primary dropped — Anthropic Claude is paused by an operator.",
    );
  });

  it("drops a hop whose provider a check found unusable, and quotes the detail", () => {
    const resolution = resolve(withHealth({ copilot: "error" }));

    expect(kept(resolution)).toEqual(["coder-max", "local-docs"]);
    expect(resolution.chain[1].explanation).toBe(
      "Fallback 1 dropped — GitHub Copilot is unreachable (elevated latency).",
    );
  });

  it("keeps a hop nothing has checked, and says so rather than calling it healthy", () => {
    // Decision M8. `unknown` is a state, not a placeholder, and it is not evidence a provider
    // is down — so the hop stays and the sentence is honest about why.
    const resolution = resolve(withHealth({ anthropic: "unknown" }));

    expect(kept(resolution)).toContain("coder-max");
    expect(resolution.chain[0].code).toBe(HOP_CODES.unchecked);
    expect(resolution.chain[0].explanation).toBe("Primary · not checked yet");
  });

  it("treats a connection with no snapshot at all as unchecked", () => {
    expect(resolve(resolutionInput({ health: [] })).chain[0].code).toBe(HOP_CODES.unchecked);
  });

  it("degrades gracefully — the chain shortens and every loss is stated", () => {
    const resolution = resolve(withHealth({ anthropic: "error", copilot: "error" }));

    expect(resolution.outcome).toBe("resolved");
    expect(kept(resolution)).toEqual(["local-docs"]);
    expect(resolution.chain).toHaveLength(3);
    expect(dropped(resolution)).toEqual([
      ["coder-max", HOP_CODES.unreachable],
      ["coder-fallback", HOP_CODES.unreachable],
    ]);
  });

  it("fails the run when every provider is down, rather than guessing", () => {
    const resolution = resolve(
      withHealth({ anthropic: "error", copilot: "error", ollama: "paused" }),
    );

    expect(resolution.outcome).toBe("fail_run");
    expect(resolution.failure).toEqual({
      code: RESOLUTION_FAILURE_CODES.noEligibleHop,
      explanation: "No hop in implement-primary is usable, so this run fails rather than guessing.",
    });
    expect(kept(resolution)).toEqual([]);
    expect(resolution.chain).toHaveLength(3);
  });
});

describe("the floor", () => {
  it("drops the hops below it and says which policy did", () => {
    const resolution = resolve(routedWith({ floorHopIndex: 2 }));

    expect(resolution.outcome).toBe("resolved");
    expect(kept(resolution)).toEqual(["coder-max", "coder-fallback"]);
    expect(resolution.chain[2].code).toBe(HOP_CODES.belowFloor);
    expect(resolution.chain[2].explanation).toBe(
      "Fallback 2 dropped — this route may not degrade below hop 2.",
    );
    expect(resolution.floor).toEqual({
      hopIndex: 2,
      code: FLOOR_CODES.held,
      explanation:
        "The floor is hop 2 — this route may not degrade below it, so 1 deeper hop was dropped.",
    });
  });

  it("fails the run rather than degrading below itself, and says why", () => {
    const resolution = resolve(
      routedWith({ floorHopIndex: 2 }, withHealth({ anthropic: "error", copilot: "error" })),
    );

    expect(resolution.outcome).toBe("fail_run");
    expect(resolution.failure).toEqual({
      code: RESOLUTION_FAILURE_CODES.floorBreached,
      explanation:
        "The floor is hop 2 — no hop at or above it is usable, so this run fails " +
        "rather than degrading below it.",
    });
    expect(resolution.floor.code).toBe(FLOOR_CODES.breached);
  });

  it("never answers a breach with a shorter chain", () => {
    // The whole of the policy. `local-docs` is healthy and would have served this run; the
    // route says fail instead, and a resolution that returned it would be the silence mockup
    // 06 promises never happens.
    const resolution = resolve(
      routedWith({ floorHopIndex: 2 }, withHealth({ anthropic: "error", copilot: "error" })),
    );

    expect(kept(resolution)).toEqual([]);
    expect(resolution.chain.map((hop) => hop.alias)).toEqual([
      "coder-max",
      "coder-fallback",
      "local-docs",
    ]);
  });

  it("does not blame the floor for a failure the floor did not cause", () => {
    // The floor is at the end of the chain, so nothing was dropped for being below it. An
    // operator told *the floor stopped this* would go and change a switch that was never the
    // problem.
    const resolution = resolve(
      routedWith(
        { floorHopIndex: 3 },
        withHealth({ anthropic: "error", copilot: "error", ollama: "error" }),
      ),
    );

    expect(resolution.failure?.code).toBe(RESOLUTION_FAILURE_CODES.noEligibleHop);
    expect(resolution.floor.code).toBe(FLOOR_CODES.held);
    expect(resolution.floor.explanation).toBe(
      "The floor is hop 3 — nothing in this chain sits below it.",
    );
  });

  it("pluralises the deeper hops it dropped", () => {
    const resolution = resolve(routedWith({ floorHopIndex: 1 }));

    expect(resolution.floor.explanation).toBe(
      "The floor is hop 1 — this route may not degrade below it, so 2 deeper hops were dropped.",
    );
  });
});

describe("allow_local_fallback", () => {
  it("drops local hops with a stated reason rather than omitting them", () => {
    const resolution = resolve(routedWith({ allowLocalFallback: false }));

    expect(resolution.outcome).toBe("resolved");
    expect(kept(resolution)).toEqual(["coder-max", "coder-fallback"]);
    expect(resolution.chain[2].code).toBe(HOP_CODES.localNotAllowed);
    expect(resolution.chain[2].explanation).toBe(
      "Fallback 2 dropped — this route does not allow local models, " +
        "and Ollama · workstation is one.",
    );
  });

  it("drops a local primary too, and echoes the policy that did it", () => {
    // The ticket's step 4 says *local hops*, not *local fallback hops*, and `docs-primary` is
    // the chain where the two readings differ: its hop 1 is Ollama. The switch is a statement
    // about which providers this route may use at all, so the primary goes with the rest —
    // explained, and with the policy echoed on the resolution so a client can render it.
    const resolution = resolve(
      resolutionInput({
        route: { ...DOCS_ROUTE, allowLocalFallback: false },
        hops: DOCS_HOPS,
      }),
    );

    expect(resolution.allowLocalFallback).toBe(false);
    expect(kept(resolution)).toEqual(["sizer"]);
    expect(resolution.chain[0].code).toBe(HOP_CODES.localNotAllowed);
  });

  it("fails the run when a route_local rule and a local ban leave nothing", () => {
    const resolution = resolve(
      routedWith({ allowLocalFallback: false }, { context: { diffKind: "docs_only" } }),
    );

    expect(resolution.outcome).toBe("fail_run");
    expect(resolution.failure?.code).toBe(RESOLUTION_FAILURE_CODES.noEligibleHop);
    expect(dropped(resolution)).toEqual([
      ["coder-max", HOP_CODES.notLocal],
      ["coder-fallback", HOP_CODES.notLocal],
      ["local-docs", HOP_CODES.localNotAllowed],
    ]);
  });
});

describe("an unbound alias in a chain", () => {
  it("is dropped with a reason rather than vanishing from the chain", () => {
    // V019's unbound state — a name created ahead of its key. `registry`'s alias list
    // inner-joins the connection and would simply not return this row; a chain that lost a hop
    // that way would arrive shorter than the operator configured it.
    const hops = [
      { position: 1, note: null, target: { ...aliasNamed("coder-max"), binding: null } },
      ...IMPLEMENT_HOPS.slice(1),
    ];
    const resolution = resolve(resolutionInput({ hops }));

    expect(resolution.chain).toHaveLength(3);
    expect(resolution.chain[0].code).toBe(HOP_CODES.unbound);
    expect(resolution.chain[0].provider).toBeNull();
    expect(resolution.chain[0].explanation).toBe(
      "Primary dropped — the alias coder-max is not bound to a provider connection.",
    );
    expect(kept(resolution)).toEqual(["coder-fallback", "local-docs"]);
  });
});

describe("determinism", () => {
  it("answers identically, byte for byte, for identical inputs", () => {
    // `JSON.stringify` rather than a deep-equality matcher, because key order is part of what
    // a consumer pins and a deep-equality matcher does not see it.
    const context = { effort: "l", labels: ["security"], diffKind: "docs_only" } as const;

    expect(JSON.stringify(resolve(resolutionInput({ context })))).toBe(
      JSON.stringify(resolve(resolutionInput({ context }))),
    );
  });

  it("sorts every params object, so a merged one serialises like an untouched one", () => {
    const rules = [
      {
        ...RULES[0],
        then: {
          use_alias: {
            task_kind: "implement",
            alias: "coder-max",
            params: { token_budget: 4000, thinking: "max", context_clamp: 200_000 },
          },
        },
      },
    ];
    const resolution = resolve(resolutionInput({ rules, context: { effort: "l" } }));

    expect(Object.keys(resolution.chain[0].params)).toEqual([
      "context_clamp",
      "thinking",
      "token_budget",
    ]);
  });

  it("is unchanged by the one context field nothing reads yet", () => {
    // AB.5 (#211) is what will read `repo`. Until it does, a resolution that differed on it
    // would mean something in here had quietly started branching on it.
    expect(JSON.stringify(resolve(resolutionInput({ context: { repo: "acme/robotics" } })))).toBe(
      JSON.stringify(resolve(resolutionInput())),
    );
  });

  it("is a synchronous function of its arguments", () => {
    // The ticket's last criterion, at the level a type cannot state it: a value rather than a
    // promise is a function that had nothing to wait for.
    expect(resolve(resolutionInput())).not.toBeInstanceOf(Promise);
  });
});

describe("the purity rule, asserted rather than promised", () => {
  /** The files `resolve()` is built out of — the whole of what runs inside the pure core. */
  const CORE = [
    "context.ts",
    "explanations.ts",
    "inputs.ts",
    "locality.ts",
    "resolution.ts",
    "resolve.ts",
    "rules.ts",
  ];

  it.each(CORE)("performs no I/O and reads no clock in %s", (file) => {
    // A probe rather than an inspection, and it is the criterion *the function performs no
    // network I/O* stated as something CI runs. A resolver that grew a health check would be
    // a resolver whose answer depended on when it was asked, which is also what breaks
    // determinism — so the clock is in this list beside the socket.
    const source = readFileSync(join(__dirname, file), "utf8");
    const code = source.replaceAll(/\/\*\*[\s\S]*?\*\//g, "").replaceAll(/\/\/.*$/gm, "");

    for (const forbidden of ["fetch(", "node:http", "Date.now", "new Date(", "Math.random"]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it("imports nothing that could reach a database or a network", () => {
    // The import list is the other half: a pure function stays pure by not being handed
    // anything impure, and `DatabaseService` or a probe client appearing in one of these
    // files is how that would stop being true.
    for (const file of CORE) {
      const source = readFileSync(join(__dirname, file), "utf8");

      for (const forbidden of [
        "db.service",
        "@nestjs/common",
        "probe.client",
        "routing.repository",
      ]) {
        expect(source).not.toContain(`from "${forbidden}`);
      }
    }
  });
});
