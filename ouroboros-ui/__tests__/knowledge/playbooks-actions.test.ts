import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { SEEDED_COMPLETIONS } from "../helpers/dashboard";
import { SOURCE_RUN_ID, candidate, launchReceipt, playbook, playbookDraft } from "../helpers/knowledge";

/**
 * The playbooks card's server hops (#420). A Server Action is a POST endpoint anybody can reach,
 * so each call takes no workspace and no person, and every gate — the role, the queue's own
 * refusals — is the service's, answered back as a value.
 */

const issues = vi.fn();
const launch = vi.fn();
const draftFromRun = vi.fn();
const createFromRun = vi.fn();
const list = vi.fn();

vi.mock("@/app/api/playbooks", () => ({
  playbooks: {
    issues: (id: string, q?: string) => issues(id, q),
    launch: (id: string, issueId: string) => launch(id, issueId),
    draftFromRun: (runId: string) => draftFromRun(runId),
    createFromRun: (body: unknown) => createFromRun(body),
  },
}));
vi.mock("@/app/api/runs", () => ({ runs: { list: (family: string, limit: number) => list(family, limit) } }));

const { createPlaybookFromRun, draftPlaybook, launchPlaybook, listPlaybookIssues, listRecentRuns } = await import(
  "@/app/knowledge/playbooks-actions"
);

const RECIPE = playbook();

beforeEach(() => {
  issues.mockReset().mockResolvedValue({ items: [candidate()] });
  launch.mockReset().mockResolvedValue(launchReceipt());
  draftFromRun.mockReset().mockResolvedValue(playbookDraft());
  createFromRun.mockReset().mockResolvedValue(RECIPE);
  list.mockReset().mockResolvedValue({ items: [...SEEDED_COMPLETIONS], total: 4, limit: 25, offset: 0 });
});

describe("listPlaybookIssues", () => {
  it("asks for the head of the list with no search, and with a trimmed one", async () => {
    await listPlaybookIssues(RECIPE.id);
    await listPlaybookIssues(RECIPE.id, "  ");
    await listPlaybookIssues(RECIPE.id, " 485 ");

    expect(issues.mock.calls).toEqual([
      [RECIPE.id, undefined],
      [RECIPE.id, undefined],
      [RECIPE.id, "485"],
    ]);
  });

  it("answers the candidates, or the refusal as a value", async () => {
    await expect(listPlaybookIssues(RECIPE.id)).resolves.toEqual({ ok: true, value: { items: [candidate()] } });

    issues.mockRejectedValue(new ApiError(404, "playbook_not_found", "No such playbook.", { id: RECIPE.id }));
    await expect(listPlaybookIssues(RECIPE.id)).resolves.toEqual({
      ok: false,
      refusal: { code: "playbook_not_found", message: "No such playbook.", details: { id: RECIPE.id } },
    });
  });
});

describe("launchPlaybook", () => {
  it("posts the launch and answers the receipt", async () => {
    await expect(launchPlaybook(RECIPE.id, candidate().id)).resolves.toEqual({ ok: true, value: launchReceipt() });
    expect(launch).toHaveBeenCalledExactlyOnceWith(RECIPE.id, candidate().id);
  });

  it("answers the queue's refusal as a value — the gate is the service's", async () => {
    launch.mockRejectedValue(new ApiError(403, "forbidden", "Viewers read.", {}));

    await expect(launchPlaybook(RECIPE.id, candidate().id)).resolves.toMatchObject({ ok: false, refusal: { code: "forbidden" } });
  });

  it("lets anything that is not the service's refusal travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    launch.mockRejectedValue(redirect);

    await expect(launchPlaybook(RECIPE.id, candidate().id)).rejects.toBe(redirect);
  });
});

describe("the create-from-run hops", () => {
  it("lists the terminal family, bounded", async () => {
    const outcome = await listRecentRuns();

    expect(list).toHaveBeenCalledExactlyOnceWith("terminal", 25);
    expect(outcome).toMatchObject({ ok: true, value: { items: SEEDED_COMPLETIONS } });
  });

  it("reads the draft, writing nothing", async () => {
    await expect(draftPlaybook(SOURCE_RUN_ID)).resolves.toEqual({ ok: true, value: playbookDraft() });
    expect(draftFromRun).toHaveBeenCalledExactlyOnceWith(SOURCE_RUN_ID);
    expect(createFromRun).not.toHaveBeenCalled();
  });

  it("forwards the body as composed and answers the playbook, or the refusal", async () => {
    const body = { runId: SOURCE_RUN_ID, name: "Flaky test hunt" };

    await expect(createPlaybookFromRun(body)).resolves.toEqual({ ok: true, value: RECIPE });
    expect(createFromRun).toHaveBeenCalledExactlyOnceWith(body);

    createFromRun.mockRejectedValue(new ApiError(409, "playbook_name_taken", "Taken.", { name: "Flaky test hunt" }));
    await expect(createPlaybookFromRun(body)).resolves.toMatchObject({ ok: false, refusal: { code: "playbook_name_taken" } });
  });
});
