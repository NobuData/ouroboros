import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import { seededSkill, seededSkills, seededStats } from "../helpers/knowledge";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { skills } = await import("@/app/api/skills");

/**
 * The skills facade (#417, #418): each operation calls its endpoint with the session alone, and
 * the required lock comes back as the `ApiError` the table's locked switch is built on.
 */

describe("skills.list", () => {
  it("lists the workspace's skills, naming no workspace", async () => {
    const { client, requests } = clientAnswering(seededSkills());

    expect(await skills.list(client)).toEqual(seededSkills());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/skills`);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers.get("x-ouro-tenant")).toBeNull();
  });
});

describe("skills.stats", () => {
  it("reads the Used-by figures over the service's default window", async () => {
    const { client, requests } = clientAnswering(seededStats());

    expect(await skills.stats(client)).toEqual(seededStats());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/skills/stats`);
    expect(requests[0]?.method).toBe("GET");
  });
});

describe("skills.update", () => {
  it("patches one skill by slug with what changed, and answers the skill after", async () => {
    const after = { ...seededSkill("zephyr-conventions"), enabled: false };
    const { client, requests } = clientAnswering(after);

    expect(await skills.update("zephyr-conventions", { enabled: false }, client)).toEqual(after);
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/skills/zephyr-conventions`);
    expect(requests[0]?.method).toBe("PATCH");
    expect(await requests[0]?.json()).toEqual({ enabled: false });
  });

  it("answers the required lock as the service's error, reason and all", async () => {
    const { client } = clientAnswering(
      {
        code: "skill_required_locked",
        message: "required by policy — cannot disable",
        details: { slug: "hil-safety", reason: "required_by_policy" },
      },
      403,
    );

    const error = await skills.update("hil-safety", { enabled: false }, client).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 403,
      code: "skill_required_locked",
      message: "required by policy — cannot disable",
      details: { reason: "required_by_policy" },
    });
  });
});

describe("skills.create", () => {
  it("posts the document", async () => {
    const detail = { skill: seededSkill("power-budget-checks"), version: null, draft: null, draftEtag: "none" };
    const { client, requests } = clientAnswering(detail, 201);

    expect(await skills.create({ text: "---\nname: x\n---\n" }, client)).toEqual(detail);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/skills`);
  });
});
