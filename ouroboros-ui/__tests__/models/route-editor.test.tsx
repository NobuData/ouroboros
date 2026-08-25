import { act, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ROUTES_FORBIDDEN,
  ROUTES_REFUSED,
  ROUTES_SAVED,
  savedRoutes,
} from "@/app/models/chain";
import { TARGETS_UNAVAILABLE, ruleTarget } from "@/app/models/rules";

import { seededAliases, seededTaskKinds } from "../helpers/models";

/**
 * The route editor's state (#202) — the one state the head, the bar, the matrix and the chain
 * read.
 *
 * Driven through the hook rather than through a surface, because what is being held is the
 * bookkeeping every surface relies on: that *N routes changed* is a count of routes that would
 * be written, that **Discard** is the empty set, that a save that lands leaves nothing behind
 * and asks the route to re-read, and that a refusal stays a draft with its problems on it.
 */

/** What the writes answer, per case. */
const saveRoutes = vi.fn();
const readRuleTargets = vi.fn();

/** What tells the server's own render that a route moved. */
const refresh = vi.fn();

vi.mock("@/app/models/route-actions", () => ({ saveRoutes: (routes: unknown) => saveRoutes(routes) }));
vi.mock("@/app/models/rule-actions", () => ({
  readRuleTargets: () => readRuleTargets(),
  setRuleEnabled: vi.fn(),
  addRule: vi.fn(),
  removeRule: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { RouteEditorProvider, useRouteEditor } = await import("@/app/models/route-editor");

/** The seeded routes, as the screen hands them to the provider. */
const ROUTES = savedRoutes(seededTaskKinds());

/** A registry alias as the menu offers it. */
const CODER_STD = { alias: "coder-std", resolution: "claude-sonnet-5 · Anthropic Claude" };

/**
 * The editor, under a provider.
 *
 * @param editable Whether the reader may edit. Defaults to yes.
 * @returns The hook's result.
 */
function editor(editable = true) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RouteEditorProvider editable={editable} routes={ROUTES}>
      {children}
    </RouteEditorProvider>
  );

  return renderHook(() => useRouteEditor(), { wrapper });
}

/**
 * A write this suite finishes itself.
 *
 * @returns The promise to answer with, and the function that answers it.
 */
function deferred<T>(): { promise: Promise<T>; answer: (value: T) => void } {
  let answer!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    answer = resolve;
  });

  return { promise, answer };
}

beforeEach(() => {
  saveRoutes.mockReset().mockResolvedValue({ ok: true, revisionId: "rev-1" });
  readRuleTargets.mockReset().mockResolvedValue({ ok: true, aliases: seededAliases().map(ruleTarget) });
  refresh.mockReset();
});

describe("without a provider", () => {
  it("is a read-only editor holding nothing, so a surface renders in isolation", () => {
    const { result } = renderHook(() => useRouteEditor());

    expect(result.current.editable).toBe(false);
    expect(result.current.pending).toBe(0);
    expect(result.current.draft("implement")).toBeNull();
    act(() => {
      result.current.move("implement", 0, 1);
    });
    expect(result.current.pending).toBe(0);
  });
});

describe("the drafts", () => {
  it("serves every route the server holds, and null for a kind it does not", () => {
    const { result } = editor();

    expect(result.current.draft("implement")?.hops.map((hop) => hop.alias)).toEqual([
      "coder-max",
      "coder-fallback",
      "local-docs",
    ]);
    expect(result.current.draft("deploy")).toBeNull();
    expect(result.current.edit("implement")).toBeNull();
  });

  it("counts a route once it differs from the server, and stops counting when it does not", () => {
    const { result } = editor();

    act(() => {
      result.current.move("implement", 1, 2);
    });
    expect(result.current.pending).toBe(1);
    expect(result.current.edit("implement")?.hops.map((hop) => hop.alias)).toEqual([
      "coder-max",
      "local-docs",
      "coder-fallback",
    ]);

    // Moved back: not a change, so not counted.
    act(() => {
      result.current.move("implement", 2, 1);
    });
    expect(result.current.pending).toBe(0);
    expect(result.current.edit("implement")).toBeNull();
  });

  it("counts routes, not edits — three edits to one route are one route changed", () => {
    const { result } = editor();

    act(() => {
      result.current.move("implement", 0, 2);
      result.current.swap("implement", 0, CODER_STD);
      result.current.add("implement", CODER_STD);
    });

    expect(result.current.pending).toBe(1);
    expect(result.current.draft("implement")?.hops).toHaveLength(4);
  });

  it("counts two routes as two", () => {
    const { result } = editor();

    act(() => {
      result.current.move("implement", 0, 1);
      result.current.move("plan", 0, 1);
    });

    expect(result.current.pending).toBe(2);
  });

  it("gives added hops ids that never repeat, however many are added", () => {
    const { result } = editor();

    act(() => {
      result.current.add("implement", CODER_STD);
      result.current.add("plan", CODER_STD);
      result.current.add("implement", CODER_STD);
    });

    const ids = [
      ...(result.current.draft("implement")?.hops ?? []),
      ...(result.current.draft("plan")?.hops ?? []),
    ].map((hop) => hop.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("refuses a removal that would empty the chain or breach the floor, leaving the draft as it was", () => {
    const { result } = editor();

    act(() => {
      result.current.remove("analyze", 0);
      result.current.remove("analyze", 0);
    });

    // Two hops, one removed, the last refused.
    expect(result.current.draft("analyze")?.hops).toHaveLength(1);
  });

  it("ignores an edit to a kind with no route", () => {
    const { result } = editor();

    act(() => {
      result.current.move("deploy", 0, 1);
    });

    expect(result.current.pending).toBe(0);
  });
});

describe("Discard", () => {
  it("restores the last saved state exactly, and forgets what the last save said", async () => {
    const { result } = editor();
    saveRoutes.mockResolvedValue({ ok: false, kind: "refused", problems: { implement: { taskKind: ["No."] } } });

    act(() => {
      result.current.move("implement", 0, 2);
      result.current.swap("plan", 0, CODER_STD);
    });
    await act(async () => {
      result.current.save();
    });
    expect(result.current.failure).toBe(ROUTES_REFUSED);

    act(() => {
      result.current.discard();
    });

    expect(result.current.pending).toBe(0);
    expect(result.current.draft("implement")).toEqual(ROUTES[3]);
    expect(result.current.draft("plan")).toEqual(ROUTES[2]);
    expect(result.current.problems).toEqual({});
    expect(result.current.failure).toBeNull();
  });
});

describe("Save routes", () => {
  it("sends the changed routes and only those, as batch entries", async () => {
    const { result } = editor();

    act(() => {
      result.current.move("implement", 0, 1);
    });
    await act(async () => {
      result.current.save();
    });

    expect(saveRoutes).toHaveBeenCalledOnce();
    const batch = saveRoutes.mock.calls[0][0] as { taskKind: string; hops: { alias: string }[] }[];
    expect(batch).toHaveLength(1);
    expect(batch[0].taskKind).toBe("implement");
    expect(batch[0].hops.map((hop) => hop.alias)).toEqual(["coder-fallback", "coder-max", "local-docs"]);
  });

  it("does nothing while there is nothing to save, or for a role that may not", async () => {
    const clean = editor();
    await act(async () => {
      clean.result.current.save();
    });

    const member = editor(false);
    act(() => {
      member.result.current.move("implement", 0, 1);
    });
    await act(async () => {
      member.result.current.save();
    });

    expect(saveRoutes).not.toHaveBeenCalled();
    expect(member.result.current.pending).toBe(0);
  });

  it("leaves nothing behind when it lands, says so, and asks the route to re-read", async () => {
    // The edits leave with the fresh read rather than being kept as a copy of what was sent:
    // what the matrix shows after a save is what the server holds.
    const { result } = editor();

    act(() => {
      result.current.move("implement", 0, 1);
    });
    await act(async () => {
      result.current.save();
    });

    expect(result.current.pending).toBe(0);
    expect(result.current.notice).toBe(ROUTES_SAVED);
    expect(result.current.failure).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("is saving while the batch is in flight, and holds every edit until it answers", async () => {
    const { promise, answer } = deferred<{ ok: true; revisionId: string }>();
    saveRoutes.mockReturnValue(promise);
    const { result } = editor();

    act(() => {
      result.current.move("implement", 0, 1);
    });
    act(() => {
      result.current.save();
    });

    expect(result.current.saving).toBe(true);
    act(() => {
      result.current.move("plan", 0, 1);
      result.current.discard();
    });
    expect(result.current.pending).toBe(1);

    await act(async () => {
      answer({ ok: true, revisionId: "rev-2" });
      await promise;
    });

    expect(result.current.saving).toBe(false);
    expect(result.current.pending).toBe(0);
  });

  it("keeps the drafts and marks the routes the server refused, saying nothing was saved", async () => {
    saveRoutes.mockResolvedValue({
      ok: false,
      kind: "refused",
      problems: { implement: { "hops.0.alias": ["No such alias."] } },
    });
    const { result } = editor();

    act(() => {
      result.current.move("implement", 0, 1);
    });
    await act(async () => {
      result.current.save();
    });

    expect(result.current.pending).toBe(1);
    expect(result.current.problems).toEqual({ implement: { "hops.0.alias": ["No such alias."] } });
    expect(result.current.failure).toBe(ROUTES_REFUSED);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears a route's problems the moment it is edited again, because that is a different batch", async () => {
    saveRoutes.mockResolvedValue({
      ok: false,
      kind: "refused",
      problems: { implement: { taskKind: ["No."] }, plan: { taskKind: ["No."] } },
    });
    const { result } = editor();

    act(() => {
      result.current.move("implement", 0, 1);
      result.current.move("plan", 0, 1);
    });
    await act(async () => {
      result.current.save();
    });
    act(() => {
      result.current.swap("implement", 0, CODER_STD);
    });

    expect(Object.keys(result.current.problems)).toEqual(["plan"]);
    expect(result.current.failure).toBeNull();
  });

  it("prints the reason for a save that failed outright, and keeps the drafts", async () => {
    saveRoutes.mockResolvedValue({ ok: false, kind: "failed", reason: ROUTES_FORBIDDEN });
    const { result } = editor();

    act(() => {
      result.current.move("implement", 0, 1);
    });
    await act(async () => {
      result.current.save();
    });

    expect(result.current.failure).toBe(ROUTES_FORBIDDEN);
    expect(result.current.pending).toBe(1);
  });
});

describe("the registry list", () => {
  it("is read once, however many menus ask", async () => {
    const { result } = editor();

    await act(async () => {
      result.current.readRegistry();
      result.current.readRegistry();
    });
    await act(async () => {
      result.current.readRegistry();
    });

    expect(readRuleTargets).toHaveBeenCalledOnce();
    expect(result.current.registry?.ok).toBe(true);
    if (result.current.registry?.ok) {
      expect(result.current.registry.aliases.map((alias) => alias.alias)).toContain("gpt5-experiments");
    }
  });

  it("is read again after a read that failed, so the next menu is a retry", async () => {
    readRuleTargets.mockResolvedValueOnce({ ok: false, reason: TARGETS_UNAVAILABLE });
    const { result } = editor();

    await act(async () => {
      result.current.readRegistry();
    });
    expect(result.current.registry).toEqual({ ok: false, reason: TARGETS_UNAVAILABLE });

    await act(async () => {
      result.current.readRegistry();
    });

    expect(readRuleTargets).toHaveBeenCalledTimes(2);
    expect(result.current.registry?.ok).toBe(true);
  });
});

describe("a role that may not edit", () => {
  it("serves the same chains and refuses every edit", () => {
    const { result } = editor(false);

    expect(result.current.editable).toBe(false);
    expect(result.current.draft("implement")?.hops).toHaveLength(3);

    act(() => {
      result.current.move("implement", 0, 1);
      result.current.swap("implement", 0, CODER_STD);
      result.current.add("implement", CODER_STD);
      result.current.remove("implement", 0);
    });

    expect(result.current.pending).toBe(0);
    expect(result.current.draft("implement")).toEqual(ROUTES[3]);
  });
});
