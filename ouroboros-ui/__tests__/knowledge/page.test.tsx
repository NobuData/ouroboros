import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/app/api/membership";
import { CONFIRM, VIEWER_REASON } from "@/app/knowledge/facts";
import { LAUNCH_VIEWER_REASON } from "@/app/knowledge/playbooks";
import { IMPORT_LABEL, KNOWLEDGE_TITLE, NEW_SKILL_LABEL, readOnlyNote } from "@/app/knowledge/view";

import { knowledgeReadings } from "../helpers/knowledge";
import { membership, sessionUser } from "../helpers/login";

/**
 * The knowledge route (#417): the gate is asked first, what it returns is what the reader is given,
 * and the role it resolved decides whether the two head actions are drawn at all.
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

/** What the reader answers with. */
const readKnowledge = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/knowledge/data", () => ({
  readKnowledge: (access: unknown, now: unknown, repo?: string) => readKnowledge(access, now, repo),
}));
vi.mock("@/app/knowledge/create-actions", () => ({ createSkill: vi.fn() }));
vi.mock("@/app/knowledge/import-actions", () => ({ previewImport: vi.fn(), applyImport: vi.fn() }));
vi.mock("@/app/knowledge/skills-actions", () => ({ setSkillEnabled: vi.fn(), regenerateRepoMap: vi.fn() }));
vi.mock("@/app/knowledge/facts-actions", () => ({ decideFact: vi.fn(), proposeFact: vi.fn() }));
vi.mock("@/app/knowledge/playbooks-actions", () => ({
  listPlaybookIssues: vi.fn(),
  launchPlaybook: vi.fn(),
  listRecentRuns: vi.fn(),
  draftPlaybook: vi.fn(),
  createPlaybookFromRun: vi.fn(),
}));
vi.mock("@/app/knowledge/profile-actions", () => ({ saveEnvRecipe: vi.fn() }));
vi.mock("@/app/knowledge/preview-actions", () => ({ previewContext: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const Page = (await import("@/app/(app)/knowledge/page")).default;

/**
 * What the gate hands back, for a reader holding these roles.
 *
 * @param roles The roles. Defaults to the seed's owner.
 * @returns The workspace.
 */
function access(roles: Role[] = ["owner"]) {
  return {
    session: { user: sessionUser(), memberships: [membership({ roles })], tenantSuggestion: null },
    membership: membership({ roles }),
  };
}

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(access());
  readKnowledge.mockReset().mockResolvedValue(knowledgeReadings());
});

describe("the knowledge route", () => {
  it("renders the frame for the workspace the gate returned", async () => {
    render(await Page());

    expect(readKnowledge).toHaveBeenCalledExactlyOnceWith(access(), expect.any(Date), undefined);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(KNOWLEDGE_TITLE);
  });

  it("hands the address's ?repo= to the reader for the profile card (#420)", async () => {
    render(await Page({ searchParams: Promise.resolve({ repo: "acme-robotics/helios-tools" }) }));

    expect(readKnowledge).toHaveBeenCalledExactlyOnceWith(access(), expect.any(Date), "acme-robotics/helios-tools");
  });

  it("ignores a repeated ?repo=, reading for the first enabled repository", async () => {
    render(await Page({ searchParams: Promise.resolve({ repo: ["a/b", "c/d"] }) }));

    expect(readKnowledge).toHaveBeenCalledExactlyOnceWith(access(), expect.any(Date), undefined);
  });

  it("names the scope ladder's Org step with the workspace's slug (#421)", async () => {
    requireWorkspace.mockResolvedValue({ ...access(), membership: membership({ slug: "nobu-data" }) });
    render(await Page());

    expect(screen.getByRole("button", { name: /^Org nobu-data/ })).toBeInTheDocument();
  });

  it("draws both actions for an owner or an admin", async () => {
    for (const roles of [["owner"], ["admin"], ["member", "admin"]] as Role[][]) {
      requireWorkspace.mockResolvedValue(access(roles));
      const { unmount } = render(await Page());

      expect(screen.getByRole("button", { name: NEW_SKILL_LABEL })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: IMPORT_LABEL })).toBeInTheDocument();
      unmount();
    }
  });

  it("draws neither action for a member or a viewer, with the note naming their role", async () => {
    for (const role of ["member", "viewer"] as const) {
      requireWorkspace.mockResolvedValue(access([role]));
      const { unmount } = render(await Page());

      expect(screen.queryByRole("button", { name: NEW_SKILL_LABEL })).toBeNull();
      expect(screen.queryByRole("button", { name: IMPORT_LABEL })).toBeNull();
      expect(screen.getByRole("note")).toHaveTextContent(readOnlyNote(role).head);
      unmount();
    }
  });

  it("lets an owner, an admin or a member run a playbook, and draws a viewer's Run on issue inert (#420)", async () => {
    for (const role of ["owner", "admin", "member"] as const) {
      requireWorkspace.mockResolvedValue(access([role]));
      const { unmount } = render(await Page());

      for (const button of screen.getAllByRole("button", { name: /^Run on issue:/ })) {
        expect(button).not.toHaveAttribute("aria-disabled");
      }
      unmount();
    }

    requireWorkspace.mockResolvedValue(access(["viewer"]));
    render(await Page());

    for (const button of screen.getAllByRole("button", { name: /^Run on issue:/ })) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAttribute("title", LAUNCH_VIEWER_REASON);
    }
  });

  it("lets an owner, an admin or a member decide a fact, and draws a viewer's Confirm inert with the reason", async () => {
    for (const role of ["owner", "admin", "member"] as const) {
      requireWorkspace.mockResolvedValue(access([role]));
      const { unmount } = render(await Page());

      for (const button of screen.getAllByRole("button", { name: new RegExp(`^${CONFIRM}:`) })) {
        expect(button).not.toHaveAttribute("aria-disabled");
      }
      unmount();
    }

    requireWorkspace.mockResolvedValue(access(["viewer"]));
    render(await Page());

    for (const button of screen.getAllByRole("button", { name: new RegExp(`^${CONFIRM}:`) })) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAttribute("title", VIEWER_REASON);
    }
  });

  it("lets the gate's redirect travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    requireWorkspace.mockRejectedValue(redirect);

    await expect(Page()).rejects.toBe(redirect);
    expect(readKnowledge).not.toHaveBeenCalled();
  });
});
