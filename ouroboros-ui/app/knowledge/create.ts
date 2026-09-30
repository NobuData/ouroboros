/**
 * Every decision the **+ New skill** dialog makes, and every sentence it says
 * (BG.1, [#417](https://github.com/NobuData/ouroboros/issues/417)).
 *
 * **Framework-free and pure**, like `app/planning/create.ts` beside it. The dialog is
 * `app/knowledge/new-skill.tsx` and its server hop is `app/knowledge/create-actions.ts`.
 *
 * ---------------------------------------------------------------------------
 * ### The dialog collects only what cannot be inferred
 *
 * A skill is markdown with frontmatter, and there is already an editor for exactly that: the
 * code-view frame. So this asks for the name, the slug, a one-line description and the scope — the
 * frontmatter the service requires and the address it will file the draft under — and composes a
 * document from them. Everything else is written in the editor.
 *
 * ### The slug follows the name until the reader takes it over
 *
 * The service derives a slug from the name (`slugify` below is its rule), so the box fills itself
 * as the name is typed. Once the reader edits the slug it is theirs, and a later change to the name
 * leaves it alone: a slug is an address, and an address that changes under the reader's hand is a
 * different kind of surprise from one that is suggested.
 *
 * ### A collision is surfaced before creation
 *
 * The page read the workspace's skills, so a slug already in use is refused under the box while it
 * is typed rather than by a `409` after a round trip. Slugs are unique per workspace regardless of
 * case, so the comparison lowers both sides. The `409` is still handled — two administrators can
 * type the same slug in the same minute — and lands on the same box.
 *
 * ### Nothing created here is enabled
 *
 * A created skill has no version: it is a draft until published, and a draft is never injected. The
 * toast the dialog leaves says so, and says where the editor is — which today is X.2
 * ([#181](https://github.com/NobuData/ouroboros/issues/181)), not yet built, so the toast names
 * it rather than pretending a door.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import type { EnabledRepo } from "@/app/api/enablement";
// Types only: `app/api/skills.ts` is server-only, and this module is imported by the dialog.
import type { CreateSkillBody, SkillList } from "@/app/api/skills";

import type { KnowledgeToast } from "./toast";

/* ------------------------------------------------------------------ the contract's bounds */

/** The service's slug rule — lower-case words separated by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The contract's ceiling on a slug. */
export const SLUG_MAX_LENGTH = 64;

/** The contract's ceiling on a skill's name (`SKILL_NAME_MAX_LENGTH`). */
export const NAME_MAX_LENGTH = 120;

/** The contract's ceiling on a skill's description (`SKILL_DESCRIPTION_MAX_LENGTH`). */
export const DESCRIPTION_MAX_LENGTH = 300;

/** The two scopes this dialog offers. A workflow-scoped skill is filed from the studio, not here. */
export type SkillFormScope = "org" | "repo";

/* ------------------------------------------------------------------ the form */

/** What the dialog holds: four boxes and a scope, as typed. */
export interface SkillForm {
  /** The skill's name — `Power budget checks`. Required. */
  readonly name: string;
  /** Its slug — `power-budget-checks`. Required; follows the name until edited. */
  readonly slug: string;
  /** Whether the reader has edited the slug, which stops it following the name. */
  readonly slugEdited: boolean;
  /** One line on what it is for. Required — the frontmatter requires it. */
  readonly description: string;
  /** Where it applies. */
  readonly scope: SkillFormScope;
  /** The repository a `repo` scope names — `owner/name` — or `""`. */
  readonly repoRef: string;
}

/**
 * The form a dialog opens on.
 *
 * @param repos The enabled repositories the page read, or none. The first is the `repo` scope's
 *   opening referent, so a reader who switches scope is not looking at an empty select.
 * @returns The opening values.
 */
export function openingForm(repos: readonly EnabledRepo[]): SkillForm {
  return {
    name: "",
    slug: "",
    slugEdited: false,
    description: "",
    scope: "org",
    repoRef: repos.length > 0 ? repoRef(repos[0]!) : "",
  };
}

/**
 * The `owner/name` a repository is imported from and a repo-scoped skill names.
 *
 * @param repo One enabled repository.
 * @returns Its reference.
 */
export function repoRef(repo: EnabledRepo): string {
  return `${repo.login}/${repo.name}`;
}

/**
 * The service's slug rule, restated so the box can follow the name.
 *
 * Lower-cased, every run of anything but a letter or a digit becomes one hyphen, hyphens at the
 * ends are dropped, and the result is cut at the contract's length. A name with no letters or
 * digits yields `""`, which the form then refuses as empty.
 *
 * @param name The name as typed.
 * @returns The slug, or `""`.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * Hold a typed name, and let the slug follow it while it still may.
 *
 * @param form The form.
 * @param name What is in the name box.
 * @returns The form with the name, and the slug re-derived unless the reader owns it.
 */
export function typeName(form: SkillForm, name: string): SkillForm {
  return { ...form, name, slug: form.slugEdited ? form.slug : slugify(name) };
}

/**
 * Hold a typed slug, which is the reader's from now on.
 *
 * @param form The form.
 * @param slug What is in the slug box.
 * @returns The form with the slug, marked as edited.
 */
export function typeSlug(form: SkillForm, slug: string): SkillForm {
  return { ...form, slug, slugEdited: true };
}

/* ------------------------------------------------------------------ what is wrong */

/** What is wrong with a required text box. */
export type TextProblem = "empty" | "long" | null;

/** What is wrong with the slug box. */
export type SlugProblem =
  /** Nothing typed and nothing derivable. */
  | "empty"
  /** Not lower-case words separated by single hyphens. */
  | "shape"
  /** Over the contract's length. */
  | "long"
  /** A skill of this workspace already has it. */
  | "taken"
  | null;

/** What is wrong with the scope's referent. */
export type ScopeProblem =
  /** `repo` chosen and no repository to name. */
  | "repo-missing"
  | null;

/** Everything wrong with a form, per box. */
export interface FormProblems {
  readonly name: TextProblem;
  readonly slug: SlugProblem;
  readonly description: TextProblem;
  readonly scope: ScopeProblem;
}

/**
 * What is wrong with a required text.
 *
 * @param value What is in the box. This trims.
 * @param max The contract's ceiling.
 * @returns The problem, or `null`.
 */
export function textProblem(value: string, max: number): TextProblem {
  const trimmed = value.trim();

  if (trimmed === "") return "empty";
  if (trimmed.length > max) return "long";

  return null;
}

/**
 * Whether a slug is already a skill's in this workspace — regardless of case, which is the
 * service's uniqueness rule too.
 *
 * @param slug The slug as typed.
 * @param existing The workspace's skills, or `null` when the list could not be read — in which
 *   case nothing is known to be taken and the `409` is the only check.
 * @returns `true` when a skill has it.
 */
export function slugTaken(slug: string, existing: SkillList | null): boolean {
  if (existing === null) return false;

  const wanted = slug.trim().toLowerCase();

  return existing.skills.some((skill) => skill.slug.toLowerCase() === wanted);
}

/**
 * What is wrong with the slug.
 *
 * @param slug What is in the box. This trims.
 * @param existing The workspace's skills, or `null` when unread.
 * @returns The problem, or `null`.
 */
export function slugProblem(slug: string, existing: SkillList | null): SlugProblem {
  const trimmed = slug.trim();

  if (trimmed === "") return "empty";
  if (trimmed.length > SLUG_MAX_LENGTH) return "long";
  if (!SLUG_PATTERN.test(trimmed)) return "shape";
  if (slugTaken(trimmed, existing)) return "taken";

  return null;
}

/**
 * Everything wrong with a form.
 *
 * @param form The form.
 * @param existing The workspace's skills, or `null` when unread.
 * @returns The problems, per box.
 */
export function formProblems(form: SkillForm, existing: SkillList | null): FormProblems {
  return {
    name: textProblem(form.name, NAME_MAX_LENGTH),
    slug: slugProblem(form.slug, existing),
    description: textProblem(form.description, DESCRIPTION_MAX_LENGTH),
    scope: form.scope === "repo" && form.repoRef === "" ? "repo-missing" : null,
  };
}

/** Why the submit is held: the name first, then the slug, the description, the scope. */
export const NEEDS_NAME = "Name the skill first.";

/** …the slug. */
export const NEEDS_SLUG = "Give the skill a slug it can be filed under.";

/** …the description. */
export const NEEDS_DESCRIPTION = "Say in one line what the skill is for.";

/** …the referent. */
export const NEEDS_REPO = "A repo-scoped skill needs a repository to apply to.";

/**
 * Why the submit is held, or `undefined` when it is not.
 *
 * @param problems Everything wrong with the form.
 * @returns The reason, or `undefined`.
 */
export function submitReason(problems: FormProblems): string | undefined {
  if (problems.name !== null) return NEEDS_NAME;
  if (problems.slug !== null) return NEEDS_SLUG;
  if (problems.description !== null) return NEEDS_DESCRIPTION;
  if (problems.scope !== null) return NEEDS_REPO;

  return undefined;
}

/** What a name over the ceiling is told. */
export const NAME_LONG = `A name is at most ${String(NAME_MAX_LENGTH)} characters.`;

/** What a description over the ceiling is told. */
export const DESCRIPTION_LONG = `A description is at most ${String(DESCRIPTION_MAX_LENGTH)} characters.`;

/** What a slug of the wrong shape is told. */
export const SLUG_SHAPE = "Lower-case letters and digits, words separated by single hyphens.";

/** What a slug over the ceiling is told. */
export const SLUG_LONG = `A slug is at most ${String(SLUG_MAX_LENGTH)} characters.`;

/** What a slug already in use is told — before creation, and again on the service's `409`. */
export const SLUG_TAKEN = "A skill in this workspace already has this slug.";

/**
 * The sentence under a text box, or nothing. An empty box is held by the submit's reason rather than
 * flagged in red before anything has been typed.
 *
 * @param problem What is wrong with it.
 * @param long What to say when it is over its ceiling.
 * @returns The sentence, or `undefined`.
 */
export function textError(problem: TextProblem, long: string): string | undefined {
  return problem === "long" ? long : undefined;
}

/**
 * The sentence under the slug box, or nothing.
 *
 * @param problem What is wrong with it.
 * @returns The sentence, or `undefined`.
 */
export function slugError(problem: SlugProblem): string | undefined {
  switch (problem) {
    case "shape":
      return SLUG_SHAPE;
    case "long":
      return SLUG_LONG;
    case "taken":
      return SLUG_TAKEN;
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ the document */

/** The body a fresh skill opens with in the editor — a prompt, not guidance the loop would act on. */
export const STARTER_BODY =
  "Describe what the loop should know or do when this skill is loaded. Headings, lists and code " +
  "blocks are all read; the frontmatter above is what the registry indexes.";

/**
 * The skill's document — frontmatter the service requires, then the starter body.
 *
 * Every frontmatter value is JSON-quoted, which YAML reads as a double-quoted string: a name with
 * a colon or a quote in it stays one value rather than becoming a second key.
 *
 * @param form A form that {@link submitReason} passed.
 * @returns The markdown.
 */
export function skillDocument(form: SkillForm): string {
  return [
    "---",
    `name: ${JSON.stringify(form.name.trim())}`,
    `description: ${JSON.stringify(form.description.trim())}`,
    `scope: ${form.scope}`,
    "---",
    "",
    STARTER_BODY,
    "",
  ].join("\n");
}

/**
 * The request body for a form that {@link submitReason} passed.
 *
 * The slug is sent rather than left to the service to derive, because the dialog has shown it.
 * The scope is sent twice — in the body and in the frontmatter — because the service refuses a
 * document whose frontmatter declares another scope than the one asked for.
 *
 * @param form The form.
 * @returns The body.
 */
export function createBody(form: SkillForm): CreateSkillBody {
  return {
    text: skillDocument(form),
    slug: form.slug.trim(),
    scope: form.scope,
    ...(form.scope === "repo" ? { repoRef: form.repoRef } : {}),
  };
}

/* ------------------------------------------------------------------ what a refusal says */

/** What the dialog draws for a refused create: one sentence, and the box it is about. */
export interface CreateFailure {
  /** The sentence under the form. */
  readonly message: string;
  /** What is wrong with the slug, if the refusal was about it. */
  readonly slug?: string;
}

/** The `code` for a role that may read skills and not change them. */
export const FORBIDDEN_CODE = "forbidden";

/** The `code` the service answers a slug in use with. */
export const SLUG_TAKEN_CODE = "skill_slug_taken";

/** The `code` for a document that does not read. */
export const DOCUMENT_INVALID_CODE = "skill_document_invalid";

/** The `code` for a referent missing, superfluous or not this workspace's. */
export const SCOPE_INVALID_CODE = "skill_scope_invalid";

/** The `code` for a body whose own shape is wrong. */
export const VALIDATION_FAILED_CODE = "validation_failed";

/** The clause every refusal ends on, because it is the fact a reader most needs. */
export const NOTHING_CREATED = "Nothing was created.";

/** What a member who reached the write anyway is told. */
export const CREATE_READ_ONLY = `Skills are written by workspace owners and admins. ${NOTHING_CREATED}`;

/** What a slug the service found in use is told. */
export const CREATE_SLUG_TAKEN = `That slug was taken since the page was read. ${NOTHING_CREATED}`;

/** What a document the service could not read is told. */
export const CREATE_DOCUMENT_INVALID = `The skill's document did not read as a skill. ${NOTHING_CREATED}`;

/** What a scope the service refused is told. */
export const CREATE_SCOPE_INVALID = `That repository is not one this workspace has enabled. ${NOTHING_CREATED}`;

/** What a body the service found malformed is told. */
export const CREATE_INVALID = `That could not be saved as it stands. ${NOTHING_CREATED}`;

/** What any other refusal is told, with the service's own sentence after it. */
export const CREATE_FAILED = `The skill could not be created. ${NOTHING_CREATED}`;

/**
 * The service's refusal, as the dialog draws it.
 *
 * @param refusal The service's envelope, as `create-actions.ts` handed it back.
 * @returns What to draw.
 */
export function createFailure(refusal: ErrorEnvelope): CreateFailure {
  switch (refusal.code) {
    case FORBIDDEN_CODE:
      return { message: CREATE_READ_ONLY };
    case SLUG_TAKEN_CODE:
      return { message: CREATE_SLUG_TAKEN, slug: SLUG_TAKEN };
    case DOCUMENT_INVALID_CODE:
      return { message: CREATE_DOCUMENT_INVALID };
    case SCOPE_INVALID_CODE:
      return { message: CREATE_SCOPE_INVALID };
    case VALIDATION_FAILED_CODE:
      return { message: CREATE_INVALID };
    default:
      // The service's sentence is written for a caller rather than a reader, so it follows the
      // product's line rather than replacing it.
      return { message: `${CREATE_FAILED} ${refusal.message}` };
  }
}

/* ------------------------------------------------------------------ what the dialog says */

/** The dialog's heading, and its accessible name. */
export const CREATE_TITLE = "New skill";

/** The note under the heading — what the dialog makes, and what it does not. */
export const CREATE_NOTE =
  "A skill is markdown with frontmatter. This files a draft under a slug and scope; the writing " +
  "happens in the editor. Nothing is enabled until the draft is published.";

/** The name box. */
export const NAME_LABEL = "Name";

/** …and its hint. */
export const NAME_HINT = "e.g. Power budget checks";

/** The slug box. */
export const SLUG_LABEL = "Slug";

/** …and its hint. */
export const SLUG_HINT = "follows the name until you edit it · e.g. power-budget-checks";

/** The description box. */
export const DESCRIPTION_LABEL = "Description";

/** …and its hint. */
export const DESCRIPTION_HINT = "one line · e.g. Flag changes that raise idle current above 120 µA";

/** The scope select. */
export const SCOPE_LABEL = "Scope";

/** The `org` option. */
export const SCOPE_ORG_LABEL = "Org-wide — every repository in this workspace";

/** The `repo` option. */
export const SCOPE_REPO_LABEL = "Repo — one repository";

/** The repository select. */
export const REPO_LABEL = "Repository";

/** The repository select's hint when there is nothing to choose. */
export const REPO_NONE_HINT = "No repository is enabled in this workspace yet, so a skill is org-wide.";

/** The repository select's hint when the list could not be read. */
export const REPO_UNREAD_HINT = "The enabled repositories could not be read, so a skill is org-wide.";

/** The dialog's primary control. */
export const CREATE_SUBMIT = "Create draft";

/** …and what it says while the write is in flight. */
export const CREATING = "Creating the draft…";

/** The way out without writing anything. */
export const CREATE_CANCEL = "Cancel";

/* ------------------------------------------------------------------ what the toast says */

/**
 * The toast a create leaves under the head — the draft's address, the fact that nothing is
 * enabled, and where the editor is.
 *
 * The editor is X.2 ([#181](https://github.com/NobuData/ouroboros/issues/181)), which is where the
 * code-view frame learns to open `skills/<slug>.skill.md`. It is not built, and the design
 * system's honesty rule (§ 3.5) says a surface that is not ready is *labelled*, never dead — so the
 * toast names the issue rather than linking to a tree row that opens nothing.
 *
 * @param slug The created skill's slug.
 * @returns The toast.
 */
export function createdToast(slug: string): KnowledgeToast {
  return {
    text:
      `Draft skill ${slug} created. It is not enabled: a skill is injected only once published. ` +
      "Editing it in the code-view editor arrives with #181.",
    links: [],
  };
}
