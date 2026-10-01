/**
 * Every sentence the knowledge frame says, and every decision it makes that is not a write
 * (BG.1, [#417](https://github.com/NobuData/ouroboros/issues/417)) — mockup 14's `/knowledge`.
 *
 * **Framework-free and pure**, like `app/planning/view.ts`: the screen (`knowledge-screen.tsx`),
 * the skeleton and the tests read from here, so the copy is written once and the head the reader
 * sees is the head the suite asserts.
 *
 * ### The head is the mockup's, verbatim
 *
 * The eyebrow, the heading and the subline are `docs/mockups/14-knowledge.html`'s to the character.
 * The subline is a promise about a division of labour — *skills you write, facts the loop learns
 * (and you approve)* — and the two head actions are the two ways knowledge enters the system, so
 * the frame's job is to make both feel like the low-risk acts they are.
 *
 * ### Two actions, both for administrators — and hidden, not inert, for everyone else
 *
 * Creating a skill and importing rules files are `owner` or `admin` writes. Where other frames draw
 * a member's write switched off with its reason, this one **does not draw them at all**: the issue
 * asks that members see neither action, and a note under the head says why the head is short. The
 * service's `403` is what enforces it; the note is presentation.
 */

import type { RepoDetection } from "@/app/api/detection";
import type { EnabledRepo } from "@/app/api/enablement";
import type { EnvRecipe } from "@/app/api/env-recipes";
import type { Role } from "@/app/api/membership";
import type { PlaybookList } from "@/app/api/playbooks";
import type { Reading } from "@/app/api/reading";
import type { RepoMapStatusList } from "@/app/api/repo-map";
import type { FactList } from "@/app/api/facts";
import type { SkillList, SkillStats } from "@/app/api/skills";

/* ------------------------------------------------------------------ the head */

/** The eyebrow. */
export const KNOWLEDGE_EYEBROW = "Knowledge";

/** The heading. */
export const KNOWLEDGE_TITLE = "Teach the loop once. Every run remembers.";

/** The subline. */
export const KNOWLEDGE_SUBLINE =
  "Skills you write, facts the loop learns (and you approve), and playbooks you can aim at any " +
  "issue. Scoped per repo or org-wide.";

/** The ghost action — the import flow's door. */
export const IMPORT_LABEL = "Import CLAUDE.md / .cursorrules";

/** The primary action — the create dialog's door. */
export const NEW_SKILL_LABEL = "+ New skill";

/* ------------------------------------------------------------------ who may act */

/** What a read-only reader is told, in two parts, so the head's brevity explains itself. */
export interface ReadOnlyNote {
  /** The lead — who is reading. */
  readonly head: string;
  /** The rule the frame keeps. */
  readonly body: string;
}

/** The sentence every read-only reader gets, whatever their role is called. */
export const READ_ONLY_BODY =
  "Skills are written and rules files are imported by an owner or an admin. Everything here can " +
  "be read; the two head actions are not drawn for other roles.";

/**
 * The article a role takes — *an owner*, *a member*.
 *
 * @param role The role.
 * @returns `an` before a vowel, `a` otherwise.
 */
function article(role: Role): string {
  return /^[aeiou]/i.test(role) ? "an" : "a";
}

/**
 * Explain the role rather than leaving a head with no actions to explain itself.
 *
 * @param role The reader's strongest role, from `primaryRole`.
 * @returns The two parts.
 */
export function readOnlyNote(role: Role): ReadOnlyNote {
  return { head: `Viewing knowledge as ${article(role)} ${role}.`, body: READ_ONLY_BODY };
}

/* ------------------------------------------------------------------ the regions */

/**
 * The anchor the post-import toast's *draft skills* link lands on — the skills table's seat, which
 * BG.2 ([#418](https://github.com/NobuData/ouroboros/issues/418)) fills with the table whose draft
 * rows it names. Declared here so the toast and the table cannot disagree about the address.
 */
export const SKILLS_REGION_ID = "skills-drafts";

/**
 * The anchor the toast's *facts awaiting review* link lands on — the learned-facts card's seat,
 * which BG.3 ([#419](https://github.com/NobuData/ouroboros/issues/419)) fills with the card whose
 * awaiting queue it names.
 */
export const FACTS_REGION_ID = "facts-awaiting";

/**
 * The playbooks card's seat — the right column's first card, which BG.4
 * ([#420](https://github.com/NobuData/ouroboros/issues/420)) fills.
 */
export const PLAYBOOKS_REGION_ID = "playbooks";

/** The repo-profile card's seat — the right column's second card, BG.4's as well. */
export const PROFILE_REGION_ID = "repo-profile";

/**
 * The scope card's seat — the right column's third card, which BG.5
 * ([#421](https://github.com/NobuData/ouroboros/issues/421)) fills with the ladder.
 */
export const SCOPE_REGION_ID = "scope";

/** The skills region's title — the mockup's card head. */
export const SKILLS_TITLE = "Skills";

/** The facts region's title — the mockup's card head. */
export const FACTS_TITLE = "Learned by the loop";

/** The playbooks region's title — the mockup's card head. */
export const PLAYBOOKS_TITLE = "Playbooks";

/** The scope region's title — the mockup's card head. */
export const SCOPE_TITLE = "Scope";

/**
 * What the repo-profile card reads, for the repository it draws — decision **K7**: detection's
 * rows and protected paths (#384, #380) composed, and the environment recipe (#408).
 */
export interface ProfileReadings {
  /**
   * The repository the card draws — the one `?repo=` names when it is enabled, else the first
   * enabled one — or `null` when none is enabled, in which case the two readings below carry that
   * reason and the card draws its no-repository state.
   */
  readonly repo: EnabledRepo | null;
  /** The newest scan, its rows and the protected paths, or why they could not be read. */
  readonly detection: Reading<RepoDetection>;
  /**
   * The environment recipe in force — `null` for a repository that has none, which is a state
   * and not a failure — or why it could not be read.
   */
  readonly recipe: Reading<EnvRecipe | null>;
}

/** Where a ticket a fact cites is — its key and its tracker page. */
export interface TicketLink {
  /** The key the meta line prints — `#552`. */
  readonly label: string;
  /** The ticket on its tracker. */
  readonly href: string;
}

/**
 * What the frame reads, and why not for what it could not.
 *
 * Each is its own `Reading`, so a refused one degrades its own concern — the slug check without
 * the list, the import without a repository to name — and nothing else.
 */
export interface KnowledgeReadings {
  /** Every skill of the workspace — the table's rows, and what the create dialog checks a slug against. */
  readonly skills: Reading<SkillList>;
  /** The Used-by column's figures, over the service's stated window (BG.2, #418). */
  readonly stats: Reading<SkillStats>;
  /** Every learned fact and every status's count — the facts card's rows (BG.3, #419). */
  readonly facts: Reading<FactList>;
  /**
   * The tickets the facts' provenance cites, resolved to where each one is — keyed by the ref's
   * id. A ticket that could not be read is absent, and its ref is drawn as text rather than as a
   * link to nowhere.
   */
  readonly tickets: Readonly<Record<string, TicketLink>>;
  /** The enabled repositories — what the import sheet offers, and a repo-scoped skill's referent. */
  readonly repos: Reading<readonly EnabledRepo[]>;
  /** Every playbook of the workspace, each with its counted run count — the playbooks card's rows (BG.4, #420). */
  readonly playbooks: Reading<PlaybookList>;
  /** What the repo-profile card composes, for the one repository it draws (BG.4, #420). */
  readonly profile: ProfileReadings;
  /**
   * Where each enabled repository's `repo-map` stands — generated, pending its first generation,
   * or failed at it (BG.6, #422). The skills card draws the last two, which have no row.
   */
  readonly maps: Reading<RepoMapStatusList>;
  /**
   * The instant the page was read, ISO 8601 — what every relative age in the table is measured
   * from. Passed down rather than each row reading a clock, so a server render and its
   * hydration agree about every `2d ago`.
   */
  readonly readAt: string;
}
