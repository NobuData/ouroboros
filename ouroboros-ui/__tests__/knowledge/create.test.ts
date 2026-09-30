import { describe, expect, it } from "vitest";

import {
  CREATE_DOCUMENT_INVALID,
  CREATE_FAILED,
  CREATE_INVALID,
  CREATE_READ_ONLY,
  CREATE_SCOPE_INVALID,
  CREATE_SLUG_TAKEN,
  DESCRIPTION_MAX_LENGTH,
  NAME_MAX_LENGTH,
  NEEDS_DESCRIPTION,
  NEEDS_NAME,
  NEEDS_REPO,
  NEEDS_SLUG,
  SLUG_LONG,
  SLUG_MAX_LENGTH,
  SLUG_SHAPE,
  SLUG_TAKEN,
  STARTER_BODY,
  type SkillForm,
  createBody,
  createFailure,
  createdToast,
  formProblems,
  openingForm,
  repoRef,
  skillDocument,
  slugError,
  slugProblem,
  slugTaken,
  slugify,
  submitReason,
  textError,
  textProblem,
  typeName,
  typeSlug,
} from "@/app/knowledge/create";

import { seededRepos, seededSkills } from "../helpers/knowledge";

/**
 * The **+ New skill** dialog's judgements (#417): the slug follows the name until edited, a
 * collision is refused before creation, the document carries the frontmatter the service requires,
 * and every refusal is one sentence ending on the fact that nothing was created.
 */

/** A form that passes. */
function passing(over: Partial<SkillForm> = {}): SkillForm {
  return {
    name: "Power budget checks",
    slug: "power-budget-checks",
    slugEdited: false,
    description: "Flag changes that raise idle current above 120 µA",
    scope: "org",
    repoRef: "",
    ...over,
  };
}

describe("the opening form", () => {
  it("is empty, org-wide, and names the first enabled repository for a later switch to repo", () => {
    expect(openingForm(seededRepos())).toEqual({
      name: "",
      slug: "",
      slugEdited: false,
      description: "",
      scope: "org",
      repoRef: "acme-robotics/helios-firmware",
    });
    expect(openingForm([]).repoRef).toBe("");
  });

  it("spells a repository as owner/name", () => {
    expect(repoRef(seededRepos()[1]!)).toBe("acme-robotics/helios-tools");
  });
});

describe("slugify, the service's rule", () => {
  it("lowers, hyphenates every run of anything else, and trims the ends", () => {
    expect(slugify("Power budget checks")).toBe("power-budget-checks");
    expect(slugify("  PR — Etiquette!! ")).toBe("pr-etiquette");
    expect(slugify("HIL/safety v2")).toBe("hil-safety-v2");
  });

  it("yields nothing for a name with no letters or digits", () => {
    expect(slugify("—")).toBe("");
  });

  it("cuts at the contract's length without leaving a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(SLUG_MAX_LENGTH - 1)} b`);

    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug).not.toMatch(/-$/);
  });
});

describe("the slug follows the name", () => {
  it("until the reader edits it", () => {
    let form = openingForm([]);

    form = typeName(form, "Power budget");
    expect(form.slug).toBe("power-budget");

    form = typeName(form, "Power budget checks");
    expect(form.slug).toBe("power-budget-checks");

    form = typeSlug(form, "power-checks");
    form = typeName(form, "Power budget checks, revised");
    expect(form.slug).toBe("power-checks");
    expect(form.slugEdited).toBe(true);
  });
});

describe("what is wrong", () => {
  it("with a required text: empty, or over its ceiling", () => {
    expect(textProblem("  ", NAME_MAX_LENGTH)).toBe("empty");
    expect(textProblem("x".repeat(NAME_MAX_LENGTH + 1), NAME_MAX_LENGTH)).toBe("long");
    expect(textProblem("Fine", DESCRIPTION_MAX_LENGTH)).toBeNull();
  });

  it("with a slug: empty, the wrong shape, too long, or taken", () => {
    expect(slugProblem("", null)).toBe("empty");
    expect(slugProblem("Power Budget", null)).toBe("shape");
    expect(slugProblem("a--b", null)).toBe("shape");
    expect(slugProblem("a".repeat(SLUG_MAX_LENGTH + 1), null)).toBe("long");
    expect(slugProblem("zephyr-conventions", seededSkills())).toBe("taken");
    expect(slugProblem("brand-new", seededSkills())).toBeNull();
  });

  it("finds a taken slug regardless of case, and nothing taken when the list was not read", () => {
    expect(slugTaken("Zephyr-Conventions", seededSkills())).toBe(true);
    expect(slugTaken("zephyr-conventions", null)).toBe(false);
  });

  it("with the scope: repo chosen and no repository to name", () => {
    expect(formProblems(passing({ scope: "repo", repoRef: "" }), null).scope).toBe("repo-missing");
    expect(formProblems(passing({ scope: "repo", repoRef: "acme-robotics/helios-firmware" }), null).scope).toBeNull();
  });
});

describe("why the submit is held", () => {
  it("names the first problem, in the form's order", () => {
    expect(submitReason(formProblems(passing({ name: "" }), null))).toBe(NEEDS_NAME);
    expect(submitReason(formProblems(passing({ slug: "" }), null))).toBe(NEEDS_SLUG);
    expect(submitReason(formProblems(passing({ description: "" }), null))).toBe(NEEDS_DESCRIPTION);
    expect(submitReason(formProblems(passing({ scope: "repo", repoRef: "" }), null))).toBe(NEEDS_REPO);
    expect(submitReason(formProblems(passing(), null))).toBeUndefined();
  });

  it("holds on a collision the page can already see", () => {
    expect(submitReason(formProblems(passing({ slug: "commit-style" }), seededSkills()))).toBe(NEEDS_SLUG);
  });
});

describe("what the boxes say", () => {
  it("flags only a text over its ceiling — an empty box is the submit's to explain", () => {
    expect(textError("empty", "Too long.")).toBeUndefined();
    expect(textError("long", "Too long.")).toBe("Too long.");
  });

  it("explains the slug's shape, its length, and a collision", () => {
    expect(slugError("empty")).toBeUndefined();
    expect(slugError("shape")).toBe(SLUG_SHAPE);
    expect(slugError("long")).toBe(SLUG_LONG);
    expect(slugError("taken")).toBe(SLUG_TAKEN);
  });
});

describe("the document", () => {
  it("carries the frontmatter the service requires, quoted, then the starter body", () => {
    expect(skillDocument(passing({ name: 'Power: "budget"' }))).toBe(
      [
        "---",
        'name: "Power: \\"budget\\""',
        'description: "Flag changes that raise idle current above 120 µA"',
        "scope: org",
        "---",
        "",
        STARTER_BODY,
        "",
      ].join("\n"),
    );
  });

  it("is sent with the slug shown and the scope, and a repository only for a repo scope", () => {
    expect(createBody(passing())).toEqual({
      text: skillDocument(passing()),
      slug: "power-budget-checks",
      scope: "org",
    });
    expect(createBody(passing({ scope: "repo", repoRef: "acme-robotics/helios-firmware" }))).toMatchObject({
      scope: "repo",
      repoRef: "acme-robotics/helios-firmware",
    });
  });
});

describe("what a refusal says", () => {
  it("is one sentence per code, ending on the fact that nothing was created", () => {
    expect(createFailure({ code: "forbidden", message: "", details: {} })).toEqual({ message: CREATE_READ_ONLY });
    expect(createFailure({ code: "skill_slug_taken", message: "", details: {} })).toEqual({
      message: CREATE_SLUG_TAKEN,
      slug: SLUG_TAKEN,
    });
    expect(createFailure({ code: "skill_document_invalid", message: "", details: {} })).toEqual({
      message: CREATE_DOCUMENT_INVALID,
    });
    expect(createFailure({ code: "skill_scope_invalid", message: "", details: {} })).toEqual({
      message: CREATE_SCOPE_INVALID,
    });
    expect(createFailure({ code: "validation_failed", message: "", details: {} })).toEqual({ message: CREATE_INVALID });
  });

  it("follows the product's line with the service's own sentence for anything else", () => {
    expect(createFailure({ code: "internal_error", message: "The service failed.", details: {} })).toEqual({
      message: `${CREATE_FAILED} The service failed.`,
    });
  });
});

describe("the toast", () => {
  it("names the draft, says it is not enabled, and names #181 as where the editor arrives", () => {
    const toast = createdToast("power-budget-checks");

    expect(toast.text).toContain("power-budget-checks");
    expect(toast.text).toContain("not enabled");
    expect(toast.text).toContain("#181");
    expect(toast.links).toEqual([]);
  });
});
