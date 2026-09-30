import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { skillSummary } from "../helpers/knowledge";

/**
 * The **+ New skill** dialog's server hop (#417). A Server Action is a POST endpoint anybody can
 * reach, so the call takes no workspace and no person, and the role gate is the service's.
 */

/** What the API answers, per case. */
const create = vi.fn();

vi.mock("@/app/api/skills", () => ({
  skills: { create: (body: unknown) => create(body) },
}));

const { createSkill } = await import("@/app/knowledge/create-actions");

/** A body the dialog composes. */
const BODY = { text: "---\nname: \"Power budget checks\"\n---\n", slug: "power-budget-checks", scope: "org" as const };

beforeEach(() => {
  create.mockReset().mockResolvedValue({
    skill: skillSummary({ slug: "power-budget-checks", name: "Power budget checks", draft: true }),
    version: null,
    draft: null,
    draftEtag: "none",
  });
});

describe("createSkill", () => {
  it("forwards the body as the dialog composed it, and nothing else", async () => {
    await createSkill(BODY);

    expect(create).toHaveBeenCalledExactlyOnceWith(BODY);
  });

  it("answers with the stored skill's slug and name", async () => {
    await expect(createSkill(BODY)).resolves.toEqual({ ok: true, slug: "power-budget-checks", name: "Power budget checks" });
  });

  it("answers a refusal as a value, so the dialog stays open over the page", async () => {
    create.mockRejectedValue(new ApiError(409, "skill_slug_taken", "Taken.", { slug: "power-budget-checks" }));

    await expect(createSkill(BODY)).resolves.toEqual({
      ok: false,
      refusal: { code: "skill_slug_taken", message: "Taken.", details: { slug: "power-budget-checks" } },
    });
  });

  it("lets anything that is not the service's refusal travel — the redirect signal above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    create.mockRejectedValue(redirect);

    await expect(createSkill(BODY)).rejects.toBe(redirect);
  });
});
