import { describe, expect, it } from "vitest";

import {
  AT_BOTTOM_REASON,
  AT_TOP_REASON,
  LAST_HOP_REASON,
  ROUTES_REFUSED,
  addAnnouncement,
  addHop,
  addedHopId,
  batchProblems,
  cellAt,
  dirtyBarLabel,
  editChainHint,
  editedRow,
  floorDefault,
  floorReason,
  moveAnnouncement,
  moveDownLabel,
  moveHop,
  moveUpLabel,
  problemLines,
  removalReason,
  removeAnnouncement,
  removeHop,
  removeLabel,
  sameChain,
  savedRoute,
  savedRoutes,
  setAllowLocal,
  setFloor,
  setMaxCost,
  swapAnnouncement,
  swapHop,
  swapLabel,
  swapMenuLabel,
  toSaveInput,
  type ChainDraft,
} from "@/app/models/chain";
import { matrixRows } from "@/app/models/matrix";

import { seededRules, seededTaskKinds } from "../helpers/models";

/**
 * Chain editing's decisions (#202), as functions over the dev seed's own routes.
 *
 * Every state the ticket has to get right is a function here: what *2 routes changed* counts,
 * what **Discard** restores to, which edits are refused before they are made, and how a
 * refused batch is read back onto the rows it names. None of it needs a render, so none of it
 * is tested through one.
 */

/** The seeded `implement` route — the one three-hop chain, and the one with a cost cap. */
function implement(): ChainDraft {
  const route = savedRoute(seededTaskKinds()[3]);
  if (route === null) throw new Error("the seed routes implement");
  return route;
}

/** A registry alias as the swap menu offers it — the cell, and the connection it runs on. */
const CODER_STD = {
  alias: "coder-std",
  resolution: "claude-sonnet-5 · Anthropic Claude",
  providerId: "5eed000c-0000-4000-8000-000000000001",
};

describe("the baseline", () => {
  it("reads a route's hops in position order, with the matrix's own resolution lines", () => {
    const draft = implement();

    expect(draft.kind).toBe("implement");
    expect(draft.tag).toBe("implement-primary");
    expect(draft.hops.map((hop) => hop.alias)).toEqual(["coder-max", "coder-fallback", "local-docs"]);
    expect(draft.hops[0].resolution).toBe("claude-fable-5 · Anthropic Claude");
    expect(draft.hops[1].note).toBe("Fallback on 5xx / timeouts");
    expect(draft.hops[0].note).toBeNull();
  });

  it("carries the policy triple unchanged, because a PUT has no leave-this-alone case", () => {
    const draft = implement();

    expect(draft.allowLocalFallback).toBe(true);
    expect(draft.floorHopIndex).toBeNull();
    expect(draft.maxCostCentsPerRun).toBe(250);
  });

  it("orders by position rather than by array index", () => {
    // The index would be right for every payload the service sends today and wrong the
    // moment one arrived in another order — and which hop is the primary is the one fact this
    // editor must not get wrong.
    const kind = seededTaskKinds()[3];
    const shuffled = { ...kind, route: { ...kind.route!, hops: [...kind.route!.hops].reverse() } };

    expect(savedRoute(shuffled)?.hops.map((hop) => hop.alias)).toEqual(["coder-max", "coder-fallback", "local-docs"]);
  });

  it("gives every hop an id from its saved position, so the server and the browser agree", () => {
    expect(implement().hops.map((hop) => hop.id)).toEqual(["implement:1", "implement:2", "implement:3"]);
  });

  it("answers null for a kind with no route, and leaves it out of the list", () => {
    const kinds = seededTaskKinds();
    const unrouted = { ...kinds[0], route: null };

    expect(savedRoute(unrouted)).toBeNull();
    expect(savedRoutes([unrouted, ...kinds.slice(1)]).map((route) => route.kind)).not.toContain("analyze");
    expect(savedRoutes(kinds)).toHaveLength(8);
  });

  it("keeps an added hop's id apart from every saved one", () => {
    expect(addedHopId("implement", 1)).toBe("implement:+1");
    expect(implement().hops.map((hop) => hop.id)).not.toContain(addedHopId("implement", 1));
  });
});

describe("moving a hop", () => {
  it("moves the hop to the index asked for and keeps the rest in order", () => {
    const moved = moveHop(implement(), 2, 0);

    expect(moved.hops.map((hop) => hop.alias)).toEqual(["local-docs", "coder-max", "coder-fallback"]);
  });

  it("keeps the hop's id and note, because it is the same hop at a new place", () => {
    const moved = moveHop(implement(), 1, 2);

    expect(moved.hops[2].id).toBe("implement:2");
    expect(moved.hops[2].note).toBe("Fallback on 5xx / timeouts");
  });

  it("clamps a move past either end rather than losing the hop", () => {
    const draft = implement();

    expect(moveHop(draft, 0, -1)).toBe(draft);
    expect(moveHop(draft, 2, 9).hops.map((hop) => hop.alias)).toEqual(draft.hops.map((hop) => hop.alias));
    expect(moveHop(draft, 1, 9).hops.map((hop) => hop.alias)).toEqual(["coder-max", "local-docs", "coder-fallback"]);
  });

  it("is the same draft for a move that goes nowhere or names no hop", () => {
    const draft = implement();

    expect(moveHop(draft, 1, 1)).toBe(draft);
    expect(moveHop(draft, 5, 0)).toBe(draft);
  });
});

describe("swapping a hop's alias", () => {
  it("changes what the hop names, what it resolves to and where it runs, and nothing else about it", () => {
    const swapped = swapHop(implement(), 1, CODER_STD);

    expect(swapped.hops[1].alias).toBe("coder-std");
    expect(swapped.hops[1].resolution).toBe(CODER_STD.resolution);
    expect(swapped.hops[1].providerId).toBe("5eed000c-0000-4000-8000-000000000001");
    expect(swapped.hops[1].id).toBe("implement:2");
    expect(swapped.hops[1].note).toBe("Fallback on 5xx / timeouts");
  });

  it("is the same draft for the alias the hop already names, or a hop it does not have", () => {
    const draft = implement();

    expect(swapHop(draft, 0, { alias: "coder-max", resolution: "whatever", providerId: null })).toBe(draft);
    expect(swapHop(draft, 7, CODER_STD)).toBe(draft);
  });
});

describe("adding a hop", () => {
  it("appends it as the last resort, with no note", () => {
    const added = addHop(implement(), CODER_STD, addedHopId("implement", 1));

    expect(added.hops).toHaveLength(4);
    expect(added.hops[3]).toEqual({
      id: "implement:+1",
      alias: "coder-std",
      resolution: CODER_STD.resolution,
      note: null,
      providerId: CODER_STD.providerId,
    });
  });
});

describe("removing a hop", () => {
  it("removes the hop asked for", () => {
    const removal = removeHop(implement(), 1);

    expect(removal.ok).toBe(true);
    if (removal.ok) expect(removal.draft.hops.map((hop) => hop.alias)).toEqual(["coder-max", "local-docs"]);
  });

  it("refuses to empty the chain, and says so", () => {
    // `RoutePolicy.hops` is never empty: an empty array could not be stored by anything.
    const one = { ...implement(), hops: implement().hops.slice(0, 1) };

    expect(removalReason(one, 0)).toBe(LAST_HOP_REASON);
    expect(removeHop(one, 0)).toEqual({ ok: false, reason: LAST_HOP_REASON });
  });

  it("refuses to shorten the chain below the route's floor, naming the floor", () => {
    // Measured against the chain in the same body — which is the chain this draft would send.
    const floored = { ...implement(), floorHopIndex: 3 };

    expect(removalReason(floored, 0)).toBe(floorReason(3));
    expect(removalReason(floored, 2)).toBe(floorReason(3));
    expect(floorReason(3)).toMatch(/hop 3/);
    expect(floorReason(1)).toMatch(/1 hop\b/);
  });

  it("allows a removal that leaves the floor reachable", () => {
    const floored = { ...implement(), floorHopIndex: 2 };

    expect(removalReason(floored, 2)).toBeNull();
    expect(removeHop(floored, 2).ok).toBe(true);
  });

  it("answers the same draft, not a refusal, for a hop the chain does not have", () => {
    const draft = implement();

    expect(removalReason(draft, 9)).toBeNull();
    expect(removeHop(draft, 9)).toEqual({ ok: true, draft });
  });
});

describe("what counts as a change", () => {
  it("is not a change to move a hop and move it back", () => {
    const draft = implement();
    const back = moveHop(moveHop(draft, 1, 2), 2, 1);

    expect(sameChain(back, draft)).toBe(true);
  });

  it("is a change to reorder, swap, add or remove", () => {
    const draft = implement();

    expect(sameChain(moveHop(draft, 1, 2), draft)).toBe(false);
    expect(sameChain(swapHop(draft, 0, CODER_STD), draft)).toBe(false);
    expect(sameChain(addHop(draft, CODER_STD, "x"), draft)).toBe(false);
    const removal = removeHop(draft, 2);
    if (removal.ok) expect(sameChain(removal.draft, draft)).toBe(false);
  });

  it("is a change to alter the policy, so AA.4's edits join the same batch", () => {
    const draft = implement();

    expect(sameChain({ ...draft, floorHopIndex: 2 }, draft)).toBe(false);
    expect(sameChain({ ...draft, allowLocalFallback: false }, draft)).toBe(false);
    expect(sameChain({ ...draft, maxCostCentsPerRun: null }, draft)).toBe(false);
  });

  it("ignores hop ids and resolution lines, which are the editor's own", () => {
    const draft = implement();
    const relabelled = { ...draft, hops: draft.hops.map((hop) => ({ ...hop, id: `${hop.id}!`, resolution: "moved" })) };

    expect(sameChain(relabelled, draft)).toBe(true);
  });
});

describe("the batch entry", () => {
  it("sends the chain as an array of alias and note, with no positions and no model ids", () => {
    const entry = toSaveInput(implement());

    expect(entry).toEqual({
      taskKind: "implement",
      hops: [
        { alias: "coder-max", note: null },
        { alias: "coder-fallback", note: "Fallback on 5xx / timeouts" },
        { alias: "local-docs", note: "Offline mode — keeps the loop turning without a network" },
      ],
      allowLocalFallback: true,
      floorHopIndex: null,
      maxCostCentsPerRun: 250,
    });
  });
});

describe("the matrix's cells", () => {
  it("draws the first two hops of a draft, and null where the chain does not reach", () => {
    const draft = implement();

    expect(cellAt(draft, 1)).toEqual({ alias: "coder-max", resolution: "claude-fable-5 · Anthropic Claude" });
    expect(cellAt(draft, 2)?.alias).toBe("coder-fallback");
    expect(cellAt(draft, 4)).toBeNull();
  });

  it("lays an edit over the server's row, and leaves an unedited row exactly as read", () => {
    const rows = matrixRows(seededTaskKinds(), seededRules());
    const row = rows[3];
    const edit = moveHop(implement(), 2, 0);

    const edited = editedRow(row, edit, undefined);
    expect(edited.changed).toBe(true);
    expect(edited.primary?.alias).toBe("local-docs");
    expect(edited.fallback?.alias).toBe("coder-max");
    // The figures and the escalation summaries are the server's either way.
    expect(edited.cost).toBe(row.cost);
    expect(edited.escalation).toEqual(row.escalation);

    const untouched = editedRow(row, null, undefined);
    expect(untouched.changed).toBe(false);
    expect(untouched.primary).toEqual(row.primary);
    expect(untouched.problems).toEqual([]);
  });

  it("prints the server's problems on the row, addressed for a person", () => {
    const rows = matrixRows(seededTaskKinds(), seededRules());

    const edited = editedRow(rows[3], null, { "hops.1.alias": ["No such alias."], floorHopIndex: ["Too deep."] });

    expect(edited.problems).toEqual(["Hop 2: No such alias.", "Floor: Too deep."]);
  });
});

describe("what is announced", () => {
  it("says where a moved hop landed, and out of how many", () => {
    expect(moveAnnouncement("coder-fallback", 1, 3)).toBe("coder-fallback moved to hop 1 of 3.");
  });

  it("says what a swapped hop names now, and what it named", () => {
    expect(swapAnnouncement(2, "coder-fallback", "coder-std")).toBe("Hop 2 now uses coder-std instead of coder-fallback.");
  });

  it("says where an added hop landed, and how many remain after a removal", () => {
    expect(addAnnouncement("coder-std", 4)).toBe("coder-std added as hop 4.");
    expect(removeAnnouncement("coder-std", 1)).toBe("coder-std removed. The chain has 1 hop.");
    expect(removeAnnouncement("coder-std", 2)).toBe("coder-std removed. The chain has 2 hops.");
  });
});

describe("a refused batch, read back", () => {
  it("keys the problems by task kind exactly as `details.routes` does", () => {
    const problems = batchProblems({
      routes: { implement: { "hops.0.alias": ["No such alias."] }, docs: { floorHopIndex: ["Too deep."] } },
    });

    expect(Object.keys(problems)).toEqual(["implement", "docs"]);
    expect(problems.implement["hops.0.alias"]).toEqual(["No such alias."]);
  });

  it("answers an empty map for details it does not recognise, rather than throwing", () => {
    // A 422 that arrived with a body nobody could read is still a 422; the bar says so in
    // its own sentence, and no row is marked for it.
    expect(batchProblems(undefined)).toEqual({});
    expect(batchProblems(null)).toEqual({});
    expect(batchProblems({})).toEqual({});
    expect(batchProblems({ routes: "implement" })).toEqual({});
    expect(batchProblems({ routes: { implement: "broken" } })).toEqual({});
    expect(batchProblems({ routes: { implement: { taskKind: "not a list" } } })).toEqual({});
    expect(batchProblems({ routes: { implement: { taskKind: [1, 2] } } })).toEqual({});
  });

  it("keeps only the messages that are strings, so one odd value does not drop a route's list", () => {
    const problems = batchProblems({ routes: { implement: { taskKind: ["Real.", 7] } } });

    expect(problems.implement.taskKind).toEqual(["Real."]);
  });

  it("addresses a hop by its position and the floor by its word, and passes every other message through", () => {
    expect(problemLines({ "hops.2.alias": ["A."], floorHopIndex: ["B."], taskKind: ["C."] })).toEqual([
      "Hop 3: A.",
      "Floor: B.",
      "C.",
    ]);
  });

  it("says in the bar that nothing was saved, and where to look", () => {
    expect(ROUTES_REFUSED).toMatch(/Nothing was saved/);
    expect(ROUTES_REFUSED).toMatch(/matrix/);
  });
});

describe("the copy", () => {
  it("counts routes in the bar, singular where the count is one", () => {
    expect(dirtyBarLabel(1)).toBe("1 route changed");
    expect(dirtyBarLabel(2)).toBe("2 routes changed");
  });

  it("names the hop in every control's accessible name, so eight controls are eight names", () => {
    expect(moveUpLabel("coder-max")).toBe("Move coder-max up");
    expect(moveDownLabel("coder-max")).toBe("Move coder-max down");
    expect(removeLabel("coder-max")).toBe("Remove coder-max");
    expect(swapLabel(2, "coder-fallback")).toBe("Swap hop 2: coder-fallback");
    expect(swapMenuLabel(2)).toBe("Aliases for hop 2");
    expect(editChainHint("implement")).toBe("Edit the implement chain");
  });

  it("explains an inert move control by where the hop already is", () => {
    expect(AT_TOP_REASON).toMatch(/primary/);
    expect(AT_BOTTOM_REASON).toMatch(/last/);
  });
});

describe("the connection a hop runs on (#203)", () => {
  it("is read from the saved hop's provider, and null for an alias bound to none", () => {
    const draft = implement();

    expect(draft.hops.map((hop) => hop.providerId)).toEqual([
      "5eed000c-0000-4000-8000-000000000001",
      "5eed000c-0000-4000-8000-000000000003",
      "5eed000c-0000-4000-8000-000000000005",
    ]);

    const [kind] = seededTaskKinds();
    const unbound = savedRoute({
      ...kind,
      route: kind.route === null ? null : { ...kind.route, hops: kind.route.hops.map((hop) => ({ ...hop, provider: null })) },
    });

    expect(unbound?.hops.map((hop) => hop.providerId)).toEqual([null, null]);
  });

  it("is not sent — nothing about where an alias runs is the client's to say", () => {
    const entry = toSaveInput(implement());

    expect(JSON.stringify(entry)).not.toContain("providerId");
  });
});

describe("the policy edits (#203)", () => {
  it("move the local-fallback switch, and are the same draft for the position it already holds", () => {
    const draft = implement();

    expect(setAllowLocal(draft, false).allowLocalFallback).toBe(false);
    expect(setAllowLocal(draft, true)).toBe(draft);
  });

  it("set the floor one above the last resort when the switch is turned on", () => {
    // The deepest floor that still refuses something: on the seeded three-hop chain, hop 2 —
    // mockup 06's own *fallback 2*.
    const draft = implement();

    expect(floorDefault(draft)).toBe(2);
    expect(floorDefault({ ...draft, hops: draft.hops.slice(0, 2) })).toBe(1);
    expect(floorDefault({ ...draft, hops: draft.hops.slice(0, 1) })).toBe(1);
  });

  it("move the floor within the chain, or switch it off with null", () => {
    const draft = implement();

    expect(setFloor(draft, 2).floorHopIndex).toBe(2);
    expect(setFloor(setFloor(draft, 2), null).floorHopIndex).toBeNull();
    expect(setFloor(draft, null)).toBe(draft);
  });

  it("refuse a floor the chain does not have, as the contract would", () => {
    const draft = implement();

    expect(setFloor(draft, 0)).toBe(draft);
    expect(setFloor(draft, 4)).toBe(draft);
    expect(setFloor(draft, 1.5)).toBe(draft);
  });

  it("move the cap in whole cents, or remove it with null", () => {
    const draft = implement();

    expect(setMaxCost(draft, 300).maxCostCentsPerRun).toBe(300);
    expect(setMaxCost(draft, null).maxCostCentsPerRun).toBeNull();
    expect(setMaxCost(draft, 250)).toBe(draft);
  });

  it("refuse a cap that is not a positive whole number of cents", () => {
    // The contract's own rule: `@IsInt() @Min(1)`, and *a cap of zero is a route that can
    // never run*.
    const draft = implement();

    expect(setMaxCost(draft, 0)).toBe(draft);
    expect(setMaxCost(draft, -1)).toBe(draft);
    expect(setMaxCost(draft, 2.5)).toBe(draft);
  });

  it("are the edits that join the batch — a policy edit is a changed route, and undone it is not", () => {
    const draft = implement();

    expect(sameChain(setAllowLocal(draft, false), draft)).toBe(false);
    expect(sameChain(setFloor(draft, 2), draft)).toBe(false);
    expect(sameChain(setMaxCost(draft, null), draft)).toBe(false);
    expect(sameChain(setFloor(setFloor(draft, 2), null), draft)).toBe(true);
    expect(toSaveInput(setFloor(draft, 2)).floorHopIndex).toBe(2);
  });
});
