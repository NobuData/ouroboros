/** What an onboarding request may contain ([#385](https://github.com/NobuData/ouroboros/issues/385)). */

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  CompleteStepDto,
  FirstIssueAlternativesQuery,
  OnboardingRepoQuery,
  PatchOnboardingDto,
  SelectTemplateDto,
} from "./onboarding.dto";

/** The properties a body fails on. */
async function failing<T extends object>(type: new () => T, body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(type, body));

  return errors.map((error) => error.property);
}

describe("the repo query", () => {
  it.each(["acme-robotics/helios-firmware", "Acme/Helios", "group/sub/project", "a/.b"])(
    "accepts %s",
    async (repo) => {
      await expect(failing(OnboardingRepoQuery, { repo })).resolves.toEqual([]);
    },
  );

  it.each([
    "",
    "helios-firmware",
    "../x",
    "a/..",
    "a/./b",
    "a b/c",
    "a/b/",
    `a/${"x".repeat(260)}`,
  ])("refuses %j", async (repo) => {
    await expect(failing(OnboardingRepoQuery, { repo })).resolves.toEqual(["repo"]);
  });

  it("requires the repository", async () => {
    await expect(failing(OnboardingRepoQuery, {})).resolves.toEqual(["repo"]);
  });
});

describe("the PATCH body", () => {
  it("accepts an empty body, and nulls that clear a pick", async () => {
    await expect(failing(PatchOnboardingDto, {})).resolves.toEqual([]);
    await expect(
      failing(PatchOnboardingDto, { selectedTemplate: null, pickedTicketId: null }),
    ).resolves.toEqual([]);
  });

  it("accepts a full pick", async () => {
    await expect(
      failing(PatchOnboardingDto, {
        selectedTemplate: "quick-fixes",
        pickedTicketId: "7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
        dismissed: true,
      }),
    ).resolves.toEqual([]);
  });

  it.each([
    [{ selectedTemplate: "Quick Fixes" }, "selectedTemplate"],
    [{ selectedTemplate: 3 }, "selectedTemplate"],
    [{ pickedTicketId: "488" }, "pickedTicketId"],
    [{ dismissed: null }, "dismissed"],
    [{ dismissed: "true" }, "dismissed"],
  ])("refuses %j", async (body, field) => {
    await expect(failing(PatchOnboardingDto, body)).resolves.toEqual([field]);
  });
});

describe("the complete-step body", () => {
  it.each([1, 2, 3, 4])("accepts step %i", async (step) => {
    await expect(failing(CompleteStepDto, { step })).resolves.toEqual([]);
  });

  it.each([0, 5, 2.5, "three", null])("refuses %j", async (step) => {
    await expect(failing(CompleteStepDto, { step })).resolves.toEqual(["step"]);
  });
});

describe("the select-template body (#386)", () => {
  it.each(["quick-fixes", "deep-refactor", "a"])("accepts %s", async (slug) => {
    await expect(failing(SelectTemplateDto, { slug })).resolves.toEqual([]);
  });

  it.each([undefined, null, "", "Quick Fixes", "-quick", 7])("refuses %j", async (slug) => {
    await expect(failing(SelectTemplateDto, { slug })).resolves.toEqual(["slug"]);
  });
});

describe("the first-issue alternatives query (#387)", () => {
  const REPO = "acme-robotics/helios-firmware";

  it.each([undefined, 1, 10, 50, "7"])("accepts a limit of %j", async (limit) => {
    await expect(failing(FirstIssueAlternativesQuery, { repo: REPO, limit })).resolves.toEqual([]);
  });

  it("converts a query-string limit to a number", () => {
    expect(plainToInstance(FirstIssueAlternativesQuery, { repo: REPO, limit: "7" }).limit).toBe(7);
  });

  it.each([0, 51, -1, 2.5, "many"])("refuses a limit of %j", async (limit) => {
    await expect(failing(FirstIssueAlternativesQuery, { repo: REPO, limit })).resolves.toEqual([
      "limit",
    ]);
  });

  it("still requires the repository", async () => {
    await expect(failing(FirstIssueAlternativesQuery, { limit: 5 })).resolves.toEqual(["repo"]);
  });
});
