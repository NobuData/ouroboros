/**
 * Every sentence the Repo Profile card says, and every decision it makes that is not a write
 * (BG.4, [#420](https://github.com/NobuData/ouroboros/issues/420)) — mockup 14's `detected` pill,
 * the profile rows, the **Environment** block and the warm-snapshot rows.
 *
 * **Framework-free and pure**, like `app/knowledge/facts.ts`.
 *
 * ### One detection truth, rendered in two places
 *
 * Decision **K7**: the card **composes** — Language, Build and Devcontainer are BB.1's detection
 * rows (#384) as the wizard's card prints them, and the protected paths are BA.1's policies
 * (#380). Nothing here scans, and nothing here edits either: each row's edit affordance belongs
 * to the surface that owns the data. Those surfaces — the wizard's detection card (BC.2, #391)
 * and the policies card's glob editor (BS.4, #494) — are not built, so the affordance is drawn
 * inert with that reason rather than as a local editor or a door to nowhere (design system
 * § 3.5). The mockup's Platform row has no detection row behind it today, and says so.
 *
 * ### The Environment block is the card's new content
 *
 * BE.4's recipe (#408) is the one thing here a person edits in place, because this is where
 * someone looks when the build breaks. The block is edited as text — one command per line, a
 * comment after ` # ` — checked before a round trip ({@link parseRecipeText}), and saved as the
 * repository's **next version**; the version line names who saved the one in force and when.
 *
 * ### No boot time is displayed before one is measured
 *
 * `boots in 38s (vs 6m cold)` is a measurement the prebuild tier (BD.4, #399) takes, and this
 * install has not taken it. The snapshot rows are one honest row saying so ({@link SNAPSHOT_HONEST});
 * #426 replaces it with the measured figure and the working controls. **No number is invented.**
 */

import type { RepoDetection, RepoDetectionRow } from "@/app/api/detection";
import type { EnabledRepo } from "@/app/api/enablement";
import type { EnvRecipe, EnvRecipeCommandBody } from "@/app/api/env-recipes";
import type { ErrorEnvelope } from "@/app/api/errors";
import type { Reading } from "@/app/api/reading";
import { coarseAgo } from "@/app/format";

import type { ChipSpec } from "./facts";
import { repoRef } from "./create";
import type { KnowledgeToast } from "./toast";

/* ------------------------------------------------------------------ the head */

/**
 * The card's title — the mockup's `REPO PROFILE — HELIOS-FIRMWARE`.
 *
 * @param repo The repository the card draws, or `null` with none enabled.
 * @returns The title.
 */
export function profileTitle(repo: EnabledRepo | null): string {
  return repo === null ? "Repo profile" : `Repo profile — ${repo.name}`;
}

/** The repository select's label, when more than one is enabled. */
export const REPO_SELECT_LABEL = "Repository";

/** The query parameter the page reads the card's repository from — `/knowledge?repo=owner/name`. */
export const REPO_PARAM = "repo";

/**
 * Which repository the card draws: the one the address names when it is enabled, else the first
 * enabled one.
 *
 * @param repos The enabled repositories.
 * @param requested What `?repo=` named, or nothing.
 * @returns The repository, or `null` with none enabled.
 */
export function chooseProfileRepo(repos: readonly EnabledRepo[], requested: string | undefined): EnabledRepo | null {
  const wanted = requested?.toLowerCase();
  const named = wanted === undefined ? undefined : repos.find((repo) => repoRef(repo).toLowerCase() === wanted);

  return named ?? repos[0] ?? null;
}

/**
 * The head's pill.
 *
 * @param detection The detection reading.
 * @returns `detected` with the filled dot when a scan exists; `not scanned` ringed when none does;
 *   `not read` in the error hue when the read failed.
 */
export function profileChip(detection: Reading<RepoDetection>): ChipSpec & { readonly dot: "filled" | "ring" } {
  if (!detection.ok) return { tone: "err", text: "not read", dot: "ring" };
  if (detection.value.scan === null) return { tone: "warn", text: "not scanned", dot: "ring" };

  return { tone: "ok", text: "detected", dot: "filled" };
}

/* ------------------------------------------------------------------ the states */

/** The card with no enabled repository. */
export const NO_REPOS_TITLE = "No repository is enabled.";
export const NO_REPOS_NOTE =
  "Enable one under Settings → Sources; this card then composes what detection found there and " +
  "the environment recipe the farm runs.";

/** The card when detection could not be read. */
export const PROFILE_UNREAD_TITLE = "Detection could not be read.";

/** The rows when the repository was never scanned. */
export const NOT_SCANNED_TITLE = "Not scanned yet.";
export const NOT_SCANNED_NOTE =
  "Detection runs from the Get Started wizard; this card draws its rows once a scan exists and " +
  "never scans on its own.";

/* ------------------------------------------------------------------ the rows */

/** One profile row, as the card draws it. */
export interface ProfileRow {
  /** The detection row key it reads, or the name it would read. */
  readonly key: string;
  /** The mockup's label — `Language`. */
  readonly label: string;
  /** The line the card prints. */
  readonly value: string;
  /** The row's verdict, or `absent` when the scan had no such row. */
  readonly tone: RepoDetectionRow["verdict"] | "absent";
  /** `detected` or `measured` — the label the value carries; `null` for an absent row. */
  readonly labelled: RepoDetectionRow["label"] | null;
}

/** What the mockup's Platform row says while no rule pack reports one. */
export const PLATFORM_ABSENT = "not detected — no rule pack reports a platform yet";

/** What a row absent from the scan says. */
export const ROW_ABSENT = "not detected";

/** The rows the card composes, in the mockup's order: the label, and the detection row key. */
const ROWS: readonly (readonly [label: string, key: string])[] = [
  ["Language", "language"],
  ["Platform", "custom:platform"],
  ["Build", "build"],
  ["Devcontainer", "devcontainer"],
];

/**
 * The profile rows, from the scan's rows.
 *
 * @param detection The detection — with a scan.
 * @returns The four rows; one the scan has no row for says so.
 */
export function profileRows(detection: RepoDetection): readonly ProfileRow[] {
  return ROWS.map(([label, key]) => {
    const row = detection.rows.find((one) => one.rowKey === key);

    if (row === undefined) {
      return { key, label, value: key === "custom:platform" ? PLATFORM_ABSENT : ROW_ABSENT, tone: "absent", labelled: null };
    }

    return { key, label, value: row.value, tone: row.verdict, labelled: row.label };
  });
}

/** The edit affordance on a detection row, and why it is inert. */
export const DETECTION_EDIT = "edit";
export const DETECTION_EDIT_REASON =
  "Detection rows are owned by the Get Started wizard's detection card (#391), which is not built " +
  "yet — re-scan there when it lands. This card draws detection's truth and never edits it.";

/** The protected-paths row. */
export const PROTECTED_PATHS_LABEL = "Protected paths";
export const NO_PROTECTED_PATHS = "none";
export const PROTECTED_EDIT = "edit";
export const PROTECTED_EDIT_REASON =
  "Protected paths are edited in Settings → Policies' glob editor (#494), which is not built yet. " +
  "This card draws the policy and never edits it.";

/**
 * Where a protected path came from, for its tooltip.
 *
 * @param source The policy's source.
 * @returns The phrase.
 */
export function protectedPathNote(source: RepoDetection["protectedPaths"][number]["source"]): string {
  return source === "edited" ? "edited by a person" : "suggested by a scan";
}

/* ------------------------------------------------------------------ the environment block */

/** The block's eyebrow. */
export const ENV_EYEBROW = "Environment";

/** The block's actions. */
export const ENV_EDIT = "Edit";
export const ENV_ADD = "Add environment recipe";
export const ENV_CANCEL = "Cancel";
export const ENV_SAVING = "Saving…";

/** Why a member's edit is inert. */
export const ENV_ADMIN_REASON = "Only an owner or an admin can edit the environment recipe.";

/** The block with no recipe. */
export const NO_RECIPE_TITLE = "No environment recipe yet.";
export const NO_RECIPE_NOTE =
  "The farm and execution run nothing before the first stage until one is written. Detection " +
  "seeds a draft for a west workspace; otherwise write it here.";

/** The block when the recipe could not be read. */
export const RECIPE_UNREAD_TITLE = "The environment recipe could not be read.";

/** Who consumes the block — what makes editing consequential. */
export const ENV_CONSUMERS_NOTE =
  "Run in this order by the build farm's container-pool setup, the prebuild tier and execution " +
  "workspace prep — each in a shell at the repository root, stopping at the first failure.";

/**
 * The version line — `v3 · edited by Ken, 9d ago`, `v1 · detected, 2mo ago`.
 *
 * @param recipe The recipe.
 * @param now The instant the page was read.
 * @returns The line.
 */
export function versionLine(recipe: EnvRecipe, now: Date): string {
  const age = coarseAgo(recipe.updatedAt, now);
  const by = recipe.source === "edited" && recipe.updatedBy !== null ? `edited by ${recipe.updatedBy.name}` : recipe.source;

  return `v${String(recipe.version)} · ${by}, ${age}`;
}

/**
 * The save's label — `Save as v4`.
 *
 * @param recipe The recipe in force, or `null` with none.
 * @returns The label.
 */
export function saveLabel(recipe: EnvRecipe | null): string {
  return `Save as v${String((recipe?.version ?? 0) + 1)}`;
}

/** What separates a command from its comment on a line. */
export const COMMENT_MARK = " # ";

/**
 * A command as one line — `west update --narrow -o=--depth=1 # shallow module fetch`.
 *
 * @param command The command.
 * @returns The line.
 */
export function commandLine(command: { readonly command: string; readonly comment: string | null }): string {
  return command.comment === null ? command.command : `${command.command}${COMMENT_MARK}${command.comment}`;
}

/**
 * The text the editor opens with — one command per line.
 *
 * @param recipe The recipe in force, or `null` with none.
 * @returns The text.
 */
export function recipeText(recipe: EnvRecipe | null): string {
  return recipe === null ? "" : recipe.commands.map(commandLine).join("\n");
}

/** The editor's field. */
export const ENV_TEXT_LABEL = "Commands, one per line";
export const ENV_TEXT_HINT =
  "Run in this order. Text after ' # ' on a line is a comment for people, never run. Blank lines are skipped.";

/** V073's bounds, mirrored so a refusal lands before a round trip. */
export const MAX_RECIPE_COMMANDS = 64;
export const MAX_COMMAND_LENGTH = 2000;
export const MAX_COMMENT_LENGTH = 300;

/** What the parse says is wrong. */
export const RECIPE_EMPTY = "Write at least one command.";
export const RECIPE_MANY = `At most ${String(MAX_RECIPE_COMMANDS)} commands.`;

/**
 * A line's complaint.
 *
 * @param line The line number, from one.
 * @param what What is wrong.
 * @returns The sentence.
 */
export function lineProblem(line: number, what: string): string {
  return `Line ${String(line)}: ${what}`;
}

/** What one line can be refused for. */
export const COMMAND_LONG = `a command is at most ${String(MAX_COMMAND_LENGTH)} characters.`;
export const COMMENT_LONG = `a comment is at most ${String(MAX_COMMENT_LENGTH)} characters.`;
export const COMMAND_BLANK = "a comment needs a command before it.";

/** The parse's answer: the commands, or the first problem. */
export type RecipeParse =
  | { readonly ok: true; readonly commands: readonly EnvRecipeCommandBody[] }
  | { readonly ok: false; readonly problem: string };

/**
 * Parse the editor's text into the commands a save sends.
 *
 * @param text The text.
 * @returns The commands in order, or the first problem — checked here so the round trip is made
 *   only with a block the service will take.
 */
export function parseRecipeText(text: string): RecipeParse {
  const commands: EnvRecipeCommandBody[] = [];
  const lines = text.split(/\r?\n/);

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("#")) return { ok: false, problem: lineProblem(index + 1, COMMAND_BLANK) };

    const at = line.indexOf(COMMENT_MARK);
    const command = (at === -1 ? line : line.slice(0, at)).trim();
    const comment = at === -1 ? "" : line.slice(at + COMMENT_MARK.length).trim();

    if (command === "") return { ok: false, problem: lineProblem(index + 1, COMMAND_BLANK) };
    if (command.length > MAX_COMMAND_LENGTH) return { ok: false, problem: lineProblem(index + 1, COMMAND_LONG) };
    if (comment.length > MAX_COMMENT_LENGTH) return { ok: false, problem: lineProblem(index + 1, COMMENT_LONG) };

    commands.push(comment === "" ? { command } : { command, comment });
  }

  if (commands.length === 0) return { ok: false, problem: RECIPE_EMPTY };
  if (commands.length > MAX_RECIPE_COMMANDS) return { ok: false, problem: RECIPE_MANY };

  return { ok: true, commands };
}

/**
 * What a refused save says.
 *
 * @param refusal The service's envelope.
 * @returns The sentence.
 */
export function saveFailure(refusal: ErrorEnvelope): string {
  if (refusal.code === "forbidden") return `Not saved: ${ENV_ADMIN_REASON}`;
  if (refusal.code === "env_recipe_version_conflict") {
    return "Not saved: someone else saved the next version first — the page is re-reading it.";
  }

  return `Not saved: ${refusal.message.replace(/\.$/, "")}.`;
}

/**
 * The toast a save leaves.
 *
 * @param recipe The version now in force.
 * @returns The toast.
 */
export function savedToast(recipe: EnvRecipe): KnowledgeToast {
  return {
    text: `Saved ${recipe.repo}'s environment recipe as v${String(recipe.version)} — ${String(recipe.commands.length)} ${recipe.commands.length === 1 ? "command" : "commands"}. The farm and execution run it from the next workspace they prepare.`,
    links: [],
  };
}

/* ------------------------------------------------------------------ the snapshot rows */

/** The row's label. */
export const SNAPSHOT_LABEL = "Warm snapshot";

/** The honest row — decision **K7**: no fabricated `38s`. */
export const SNAPSHOT_HONEST =
  "Prebuilds arrive with the build-farm tier (#399). No boot time has been measured for this " +
  "install, so none is shown.";

/** Where the mockup's rows come from, for the tooltip. */
export const SNAPSHOT_DETAIL =
  "#426 replaces this row with the measured boot time, the nightly re-snapshot switch and Rebuild snapshot now.";
