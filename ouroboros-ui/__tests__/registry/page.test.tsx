import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  IMPORT_LABEL,
  MEMBER_REASON,
  NEW_ALIAS_LABEL,
  REGISTRY_TITLE,
} from "@/app/registry/view";

import { membership, sessionUser } from "../helpers/login";
import { registryReadings } from "../helpers/registry";

/**
 * The registry page's route (#591) — the `#49` placeholder this segment was, replaced.
 *
 * It is a few lines, and this suite is about all of them: the gate is asked first, the reader
 * is given what it returned, the three things the page draws from — the readings, the
 * reader's role and the URL's alias — are the gate's, the reader's and the request's rather
 * than a screen's assumption. Everything else the page could be judged on is covered where it
 * is decided (`registry-screen.test.tsx`, `registry-table.test.tsx`, `view.test.ts`,
 * `data.test.ts`), which is why this file is short rather than a copy of any of them.
 *
 * The gate is replaced: it has its own suite (`__tests__/api/access.test.ts`), and driving it
 * through this route would test it a second time while testing the wiring not at all. So is
 * the reader, for the same reason.
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

/** What the reader answers with. */
const readRegistry = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/registry/data", () => ({ readRegistry: (access: unknown) => readRegistry(access) }));
// The table's switches write through a Server Action on the server-only client
// (`switch-actions.test.ts`).
vi.mock("@/app/registry/switch-actions", () => ({ setAliasEnabled: vi.fn() }));
// The two flows behind the head's actions write through Server Actions on the server-only
// client; the actions have their own suites (`create-actions.test.ts`, `import-actions.test.ts`).
vi.mock("@/app/registry/create-actions", () => ({
  createAlias: vi.fn(),
  readModelOptions: vi.fn(),
  readParamSchema: vi.fn(),
}));
vi.mock("@/app/registry/import-actions", () => ({
  importAliases: vi.fn(),
  readCandidates: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const Route = (await import("@/app/(app)/models/registry/page")).default;

/** What the gate hands back, in the seeded world — an owner of the seeded workspace. */
const ACCESS = {
  session: { user: sessionUser(), memberships: [membership()], tenantSuggestion: null },
  membership: membership(),
};

/**
 * The route, with the URL's query.
 *
 * @param query What `?alias=` and anything else carried. Defaults to nothing.
 * @returns The rendered page.
 */
function Page(query: Record<string, string | string[] | undefined> = {}) {
  return Route({ searchParams: Promise.resolve(query) });
}

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(ACCESS);
  readRegistry.mockReset().mockResolvedValue(registryReadings());
});

describe("the registry route", () => {
  it("asks the gate before it draws anything", async () => {
    // "Unauthenticated `(app)` routes redirect to the login screen" is true because of this
    // call, not because of a check in the layout — see `app/(app)/layout.tsx` for why.
    render(await Page());

    expect(requireWorkspace).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(REGISTRY_TITLE);
  });

  it("hands the reader the workspace the gate resolved", async () => {
    // The reader takes the gate's return as a precondition rather than as a source of values;
    // passing anything else would be passing a proof that had not been obtained.
    render(await Page());

    expect(readRegistry).toHaveBeenCalledWith(ACCESS);
  });

  it("draws the import menu over what the reader read", async () => {
    render(await Page());

    expect(screen.getByRole("button", { name: IMPORT_LABEL })).toHaveAttribute(
      "aria-haspopup",
      "menu",
    );
  });

  it("takes the reader's role from the membership the gate resolved", async () => {
    // The session/role context the ticket lists as its BA-D.5 dependency, arriving through the
    // same call every signed-in screen makes. An owner may create aliases, so the primary
    // action carries no reason at all and can be pressed.
    render(await Page());

    const create = screen.getByRole("button", { name: NEW_ALIAS_LABEL });

    expect(create).not.toHaveAttribute("aria-disabled");
    expect(create).not.toHaveAttribute("title");
  });

  it("switches both actions off for a membership that may not administer", async () => {
    // Not a constant that happens to match the seed: change the roles the gate resolves and
    // the page changes with them.
    requireWorkspace.mockResolvedValue({
      ...ACCESS,
      membership: membership({ roles: ["member"] }),
    });

    render(await Page());

    for (const label of [IMPORT_LABEL, NEW_ALIAS_LABEL]) {
      expect(screen.getByRole("button", { name: label }), label).toHaveAttribute(
        "title",
        MEMBER_REASON,
      );
    }
  });

  it("treats a viewer the same way, because neither may create an alias", async () => {
    requireWorkspace.mockResolvedValue({
      ...ACCESS,
      membership: membership({ roles: ["viewer"] }),
    });

    render(await Page());

    expect(screen.getByRole("button", { name: NEW_ALIAS_LABEL })).toHaveAttribute(
      "title",
      MEMBER_REASON,
    );
  });

  it("reads the selected alias out of the URL, so the first paint has the right row", async () => {
    // The other half of *a selected alias survives a reload*: read on the server, the same
    // arrangement the routing page makes for `?route=`.
    render(await Page({ alias: "coder-max" }));

    expect(screen.getByRole("row", { selected: true })).toHaveAttribute("data-row-key", "coder-max");
  });

  it("selects nothing when the URL carries no alias", async () => {
    render(await Page());

    expect(screen.queryByRole("row", { selected: true })).toBeNull();
  });

  it("draws nothing at all when the gate redirects instead of returning", async () => {
    // `redirect()` signals by throwing, so a request with no session or no chosen workspace
    // never reaches the screen — and never reaches the read either.
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(Page()).rejects.toThrow("NEXT_REDIRECT /login");
    expect(readRegistry).not.toHaveBeenCalled();
  });
});
