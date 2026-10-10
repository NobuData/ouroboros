import { describe, expect, it, vi } from "vitest";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import {
  STARTED_ID,
  estimate,
  investigationDetail,
  seededKinds,
  seededTools,
  startedInvestigation,
} from "../helpers/research";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { research } = await import("@/app/api/research");

/**
 * The research facade (#628): each call reaches the operation the contract describes, names no
 * workspace, and hands the body back untouched.
 */

describe("the catalogs", () => {
  it("read the kinds and the tools from their own routes", async () => {
    const kinds = clientAnswering({ kinds: seededKinds() });
    expect(await research.kinds(kinds.client)).toEqual({ kinds: seededKinds() });
    expect(kinds.requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/research/kinds`);
    expect(kinds.requests[0]?.method).toBe("GET");

    const tools = clientAnswering({ tools: seededTools() });
    expect(await research.tools(tools.client)).toEqual({ tools: seededTools() });
    expect(tools.requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/research/tools`);
  });

  it("names no workspace — the workspace is the session's", async () => {
    const { client, requests } = clientAnswering({ kinds: [] });

    await research.kinds(client);

    expect(requests[0]?.url).not.toMatch(/org|tenant|workspace/);
    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
  });
});

describe("research.settings", () => {
  it("reads who may start", async () => {
    const { client, requests } = clientAnswering({ startRole: "admin" });

    expect(await research.settings(client)).toEqual({ startRole: "admin" });
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/research/settings`);
  });
});

describe("research.estimate", () => {
  it("posts the composer's choices and returns the estimate itself", async () => {
    const { client, requests } = clientAnswering(estimate());
    const body = { kind: "gap_analysis", depth: "deep_dive" as const, tools: ["web", "code"] };

    expect(await research.estimate(body, client)).toEqual(estimate());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/research/estimates`);
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual(body);
  });
});

describe("the lifecycle", () => {
  it("starts with the composer's payload", async () => {
    const { client, requests } = clientAnswering(startedInvestigation(), 201);
    const body = { question: "Why?", kind: "gap_analysis", depth: "quick" as const, tools: ["web"] };

    expect(await research.start(body, client)).toEqual(startedInvestigation());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/research/investigations`);
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual(body);
  });

  it("reads one investigation by id", async () => {
    const { client, requests } = clientAnswering(investigationDetail());

    expect(await research.investigation(STARTED_ID, client)).toEqual(investigationDetail());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/research/investigations/${STARTED_ID}`);
    expect(requests[0]?.method).toBe("GET");
  });

  it("cancels by id, with no body", async () => {
    const answer = { state: "cancelling", investigation: investigationDetail({ status: "running" }) };
    const { client, requests } = clientAnswering(answer);

    expect(await research.cancel(STARTED_ID, client)).toEqual(answer);
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/research/investigations/${STARTED_ID}/cancel`);
    expect(requests[0]?.method).toBe("POST");
  });
});
