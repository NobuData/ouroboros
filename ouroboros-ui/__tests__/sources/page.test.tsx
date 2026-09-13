import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { settingsEyebrow } from "@/app/settings/view";
import { ADD_READ_ONLY } from "@/app/sources/catalog";
import { readOnlyNote } from "@/app/sources/states";
import { ADD_SOURCE_LABEL, SOURCES_TITLE } from "@/app/sources/view";

import { membership, sessionUser } from "../helpers/login";
import { readings } from "../helpers/sources";

/**
 * The sources page's route ([#141](https://github.com/NobuData/ouroboros/issues/141)): the
 * gate is asked first, and what it returns is what the screen is given — the workspace's
 * name for the eyebrow, and whether this reader may write.
 */

const requireWorkspace = vi.fn();
const readSources = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/sources/data", () => ({ readSources: (access: unknown) => readSources(access) }));
vi.mock("@/app/sources/actions", () => ({
  readSourceCatalog: vi.fn(),
  addSource: vi.fn(),
  updateSourceConfig: vi.fn(),
  setSourceCredentials: vi.fn(),
  testSource: vi.fn(),
  syncSource: vi.fn(),
  readSourceStatus: vi.fn(),
  setSourceStatus: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/settings/sources",
}));

const Page = (await import("@/app/(app)/settings/sources/page")).default;

const ACCESS = {
  session: { user: sessionUser(), memberships: [membership()], tenantSuggestion: null },
  membership: membership(),
};

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(ACCESS);
  readSources.mockReset().mockResolvedValue(readings());
});

describe("the route", () => {
  it("asks the gate, hands the reader the workspace, and draws the screen for it", async () => {
    render(await Page());

    expect(requireWorkspace).toHaveBeenCalledOnce();
    expect(readSources).toHaveBeenCalledWith(ACCESS);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(SOURCES_TITLE);
    expect(screen.getByText(settingsEyebrow(membership().name))).toBeInTheDocument();
  });

  it("lets an owner write", async () => {
    render(await Page());

    expect(screen.getByRole("button", { name: ADD_SOURCE_LABEL })).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("holds a member to reading, and names the role", async () => {
    requireWorkspace.mockResolvedValue({
      ...ACCESS,
      membership: membership({ roles: ["member"] }),
    });

    render(await Page());

    expect(screen.getByRole("button", { name: ADD_SOURCE_LABEL })).toHaveAttribute("title", ADD_READ_ONLY);
    expect(screen.getByRole("note")).toHaveTextContent(readOnlyNote("member").head);
  });

  it("does not render at all when the gate redirects", async () => {
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(Page()).rejects.toThrow("NEXT_REDIRECT");
    expect(readSources).not.toHaveBeenCalled();
  });
});
