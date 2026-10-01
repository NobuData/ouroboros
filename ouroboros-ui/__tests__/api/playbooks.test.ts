import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import { SOURCE_RUN_ID, candidate, launchReceipt, playbook, playbookDraft, seededPlaybooks } from "../helpers/knowledge";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { playbooks } = await import("@/app/api/playbooks");

/**
 * The playbooks facade (#420): the list, the picker's candidates, the launch, a run's draft and the
 * create — each naming no workspace, each answering what the service holds.
 */

const RECIPE = playbook();

describe("playbooks.list", () => {
  it("lists every recipe, naming no workspace", async () => {
    const { client, requests } = clientAnswering(seededPlaybooks());

    expect(await playbooks.list(client)).toEqual(seededPlaybooks());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/knowledge/playbooks`);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers.get("x-ouro-tenant")).toBeNull();
  });
});

describe("playbooks.issues", () => {
  it("asks for the playbook's admitted issues, with the search when there is one", async () => {
    const { client, requests } = clientAnswering({ items: [candidate()] });

    expect(await playbooks.issues(RECIPE.id, "485", client)).toEqual({ items: [candidate()] });
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/knowledge/playbooks/${RECIPE.id}/issues?q=485`);
    expect(requests[0]?.method).toBe("GET");
  });

  it("sends no query for the head of the list", async () => {
    const { client, requests } = clientAnswering({ items: [] });

    await playbooks.issues(RECIPE.id, undefined, client);

    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/knowledge/playbooks/${RECIPE.id}/issues`);
  });
});

describe("playbooks.launch", () => {
  it("posts the issue and answers the receipt", async () => {
    const { client, requests } = clientAnswering(launchReceipt(), 201);

    expect(await playbooks.launch(RECIPE.id, candidate().id, client)).toEqual(launchReceipt());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/knowledge/playbooks/${RECIPE.id}/launch`);
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual({ issueId: candidate().id });
  });

  it("answers the queue's refusal as the service's error", async () => {
    const { client } = clientAnswering({ code: "queue_issues_conflict", message: "Already queued.", details: {} }, 409);

    const error = await playbooks.launch(RECIPE.id, candidate().id, client).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "queue_issues_conflict" });
  });
});

describe("playbooks.draftFromRun", () => {
  it("reads what the run would give, writing nothing", async () => {
    const { client, requests } = clientAnswering(playbookDraft());

    expect(await playbooks.draftFromRun(SOURCE_RUN_ID, client)).toEqual(playbookDraft());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/knowledge/playbooks/from-run/${SOURCE_RUN_ID}`);
    expect(requests[0]?.method).toBe("GET");
  });
});

describe("playbooks.createFromRun", () => {
  it("posts the body and answers the new playbook", async () => {
    const { client, requests } = clientAnswering(RECIPE, 201);
    const body = { runId: SOURCE_RUN_ID, name: "Flaky test hunt", issueFilter: { labels: ["flaky"] } };

    expect(await playbooks.createFromRun(body, client)).toEqual(RECIPE);
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/knowledge/playbooks/from-run`);
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual(body);
  });
});
