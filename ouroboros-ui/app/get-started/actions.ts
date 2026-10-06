"use server";

/**
 * The wizard's writes (BC.1, [#390](https://github.com/NobuData/ouroboros/issues/390)) — each one
 * a call the service guards (BB.2, #385; BB.5, #388), so a refusal comes back as the service's
 * own stated reason and the action bar shows it.
 *
 * Every argument is re-validated here: a Server Action is a public endpoint, and the repository
 * a caller passes is only ever used once it is shaped like one.
 */

import { redirect } from "next/navigation";

import { requireWorkspace } from "@/app/api/access";
import { type RepoDetection, type RepoDetectionRescan, detection } from "@/app/api/detection";
import { readEnablement } from "@/app/api/enablement";
import { isApiError } from "@/app/api/errors";
import {
  type Onboarding,
  type OnboardingLaunchReceipt,
  type OnboardingTemplateSelection,
  onboarding,
} from "@/app/api/onboarding";
import { orgPolicy } from "@/app/api/org-policy";
import { orgs } from "@/app/api/orgs";
import { attempt } from "@/app/api/reading";
import { repos } from "@/app/api/repos";
import { sources } from "@/app/api/sources";
import { GLOBS_MAX, type GlobPreview } from "@/app/globs/glob";
import { ENABLED_FIELD } from "@/app/login/enablement";

import { DETECTION_WRITE_FAILED } from "./detection-view";
import { NOT_AN_ISSUE, isIssueId } from "./first-issue-view";
import { NOT_A_TEMPLATE, type TemplateFinding, findingsOf, isTemplateSlug } from "./templates-view";
import {
  GET_STARTED_PATH,
  NOT_A_REPOSITORY,
  REPO_PARAM,
  STEP_COUNT,
  WIZARD_WRITE_FAILED,
  coveredBy,
  getStartedPath,
  notCoveredReason,
  parseRepo,
} from "./view";

/** A write's outcome: what the service answered, or why not as a sentence. */
export type WizardWrite<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/**
 * A template selection's outcome (BC.3, #392): the selection, or the refusal — with the publish
 * gate's findings when the template's definition was what the service refused, so the tile can
 * draw the problem rather than a bare "no".
 */
export type TemplateSelectOutcome =
  | { readonly ok: true; readonly value: OnboardingTemplateSelection }
  | { readonly ok: false; readonly reason: string; readonly findings: readonly TemplateFinding[] };

/**
 * A refusal in the service's words, or a plain failure for anything that is not a refusal.
 *
 * @param error What the call threw.
 * @returns The sentence.
 * @throws Anything that is not an API error — a bug is not a refusal.
 */
function refusal(error: unknown): string {
  if (error instanceof NotCovered) return error.message;
  if (!isApiError(error)) throw error;

  return error.status >= 400 && error.status < 500 ? error.message : WIZARD_WRITE_FAILED;
}

/**
 * Run one guarded write.
 *
 * @param repo The repository the caller named.
 * @param write The write, given the validated repository.
 * @returns Its outcome.
 */
async function guarded<T>(repo: string, write: (repo: string) => Promise<T>): Promise<WizardWrite<T>> {
  const valid = parseRepo(repo);

  if (valid === null) return { ok: false, reason: NOT_A_REPOSITORY };

  try {
    return { ok: true, value: await write(valid) };
  } catch (error) {
    return { ok: false, reason: refusal(error) };
  }
}

/**
 * *Continue →* — complete a step through the service's guard, which re-derives it at the moment
 * of asking.
 *
 * @param repo The repository.
 * @param step The step, 1–3.
 * @returns The wizard after the guard answered yes, or its reason.
 */
export async function continueStep(repo: string, step: number): Promise<WizardWrite<Onboarding>> {
  if (!Number.isInteger(step) || step < 1 || step >= STEP_COUNT) {
    return { ok: false, reason: WIZARD_WRITE_FAILED };
  }

  return guarded(repo, (valid) => onboarding.completeStep(valid, step));
}

/**
 * *Run my first loop →* — queue the picked issue under the instantiated workflow (BB.5).
 *
 * With nothing stored yet, the first-issue card's suggestion is **stored first** (BC.4, #393 —
 * the user's decision on the ticket): the picker only suggests, the wizard stores a pick, and the
 * press is where the person commits to it. A refused store is the press's refusal; nothing is
 * launched.
 *
 * @param repo The repository.
 * @param pickIssueId The picker's `issueId` to store before launching, or null when a pick is
 *   stored already.
 * @returns The receipt, or the launch's stated refusal.
 */
export async function launchFirstLoop(
  repo: string,
  pickIssueId: string | null = null,
): Promise<WizardWrite<OnboardingLaunchReceipt>> {
  if (pickIssueId !== null && !isIssueId(pickIssueId)) return { ok: false, reason: NOT_AN_ISSUE };

  return guarded(repo, async (valid) => {
    if (pickIssueId !== null) await onboarding.update(valid, { pickedIssueId: pickIssueId });

    return onboarding.launch(valid);
  });
}

/**
 * The first-issue card's *↻ another* and *or pick your own* (BC.4, #393) — store a candidate as
 * the wizard's pick, named by the picker's `issueId`, which the service resolves to the issue's
 * canonical ticket (BB.5). Any contributor; the service refuses a viewer and an issue outside
 * this repository's backlog in its own words.
 *
 * @param repo The repository.
 * @param issueId The candidate's `issueId`.
 * @returns The wizard re-derived with the pick, or why not.
 */
export async function pickFirstIssue(repo: string, issueId: string): Promise<WizardWrite<Onboarding>> {
  if (!isIssueId(issueId)) return { ok: false, reason: NOT_AN_ISSUE };

  return guarded(repo, (valid) => onboarding.update(valid, { pickedIssueId: issueId }));
}

/**
 * *I've done this before* — mark the wizard bypassed and answer where to go. Imports nothing.
 *
 * @param repo The repository.
 * @returns The settings path, or why not.
 */
export async function skipWizard(repo: string): Promise<WizardWrite<string>> {
  return guarded(repo, async (valid) => (await onboarding.skip(valid)).settingsPath);
}

/**
 * The dashboard banner's *Dismiss* — stop offering the wizard. Open to every member.
 *
 * @param repo The repository whose wizard is dismissed.
 * @returns Whether the service still offers it, or why not.
 */
export async function dismissWizard(repo: string): Promise<WizardWrite<boolean>> {
  return guarded(repo, async (valid) => (await onboarding.update(valid, { dismissed: true })).surfacing.offer);
}

/**
 * Step 2's write, shared by the action bar's *Enable {repo} →* and the picker's switch (BC.6,
 * #395): make both of the flags the service requires true — recording the account and the
 * repository first when the mirror does not hold them yet, which is the tenancy API's own
 * upsert (`PATCH …/repos/{name}` is *"also how one first comes to be known"*) — then start the
 * detection scan, which is what step 2's result line means by *auto-detected below*.
 *
 * **Only a repository a GitHub source names.** The wizard enables what a source can read and
 * nothing else — the detector's own `coversRepo` rule, restated here — so a hand-made request
 * for a repository no source covers is refused before any write, in a sentence that says what
 * to do first.
 *
 * **The scan is best effort.** A debounce (`409 detection_rescan_too_soon`) or a source that
 * cannot probe (`409 detection_source_missing`) is the detection card's to explain — it polls
 * its own state and draws its own re-scan — so neither undoes an enablement that succeeded.
 *
 * @param tenantId The workspace.
 * @param valid The repository, already shaped like one.
 * @returns When both flags are true and the scan has been asked for.
 * @throws {NotCovered} For a repository no GitHub source of the workspace names.
 * @throws {ApiError} A write the service refused — `403` below admin, above all.
 */
async function turnOnRepository(tenantId: string, valid: string): Promise<void> {
  const [login, name] = valid.split("/") as [string, string];
  const [listed, listing] = await Promise.all([readEnablement(tenantId), sources.list()]);

  if (!coveredBy(listing.items, valid)) throw new NotCovered(notCoveredReason(valid));

  const account = listed.orgs.find(({ org }) => org.login.toLowerCase() === login.toLowerCase());
  const found = account?.repos.find((one) => one.name.toLowerCase() === name.toLowerCase());
  const owner = account?.org.login ?? login.toLowerCase();

  if (account === undefined) await orgs.record(tenantId, owner, true);
  else if (!account.org.enabled) await orgs.setEnabled(tenantId, owner, true);

  if (found === undefined || !found.enabled) {
    await repos.setEnabled(tenantId, owner, found?.name ?? name.toLowerCase(), true);
  }

  await attempt(() => detection.scan(valid));
}

/**
 * *Enable {repo} →* — step 2 from the action bar: turn on the repository and its account,
 * recording them first when needed, and start the scan ({@link turnOnRepository}). Owner or
 * admin; the service refuses anyone else, in its own words.
 *
 * @param repo The repository.
 * @returns The wizard re-derived after the change, or why not.
 */
export async function enableRepository(repo: string): Promise<WizardWrite<Onboarding>> {
  const { membership } = await requireWorkspace();

  return guarded(repo, async (valid) => {
    await turnOnRepository(membership.id, valid);

    return onboarding.read(valid);
  });
}

/**
 * The picker's switch (BC.6, #395) — the login screen's enablement switch, submitting the
 * repository and the state to move *to*. On: {@link turnOnRepository}. Off: the repository's
 * own flag only, so the account's other repositories keep their state. Then the wizard for that
 * repository is rendered afresh, which is where the rail re-derives step 2.
 *
 * A Server Action is a public endpoint: a request not shaped like the form sends nobody
 * anywhere it should not — a malformed repository goes back to the wizard, and a flag that is
 * not exactly `true` or `false` is an error rather than a guess at its direction.
 *
 * @param formData The submitted form: `repo` (`owner/name`) and `enabled` (`"true"` | `"false"`).
 * @returns Never resolves normally — it redirects to the repository's wizard.
 * @throws {Error} For a flag that is neither `"true"` nor `"false"`.
 * @throws {ApiError} A write the service refused — rendered by the route's error boundary, as
 *   the login screen's switches are; the picker draws the switch read-only for anyone the
 *   service would refuse, so reaching this is a hand-made request.
 */
export async function setRepositoryEnabled(formData: FormData): Promise<void> {
  const repo = parseRepo(text(formData, REPO_PARAM));
  const flag = text(formData, ENABLED_FIELD);

  if (repo === null) redirect(GET_STARTED_PATH);
  if (flag !== "true" && flag !== "false") {
    throw new Error(`The ${ENABLED_FIELD} field must be exactly "true" or "false".`);
  }

  const { membership } = await requireWorkspace();

  if (flag === "true") {
    await turnOnRepository(membership.id, repo);
  } else {
    const [login, name] = repo.split("/") as [string, string];
    const listed = await readEnablement(membership.id);
    const account = listed.orgs.find(({ org }) => org.login.toLowerCase() === login.toLowerCase());
    const found = account?.repos.find((one) => one.name.toLowerCase() === name.toLowerCase());

    if (account !== undefined && found?.enabled === true) {
      await repos.setEnabled(membership.id, account.org.login, found.name, false);
    }
  }

  redirect(getStartedPath(repo));
}

/**
 * Read one text field.
 *
 * @param formData The submitted form.
 * @param name The field.
 * @returns Its value, or undefined when absent or not text.
 */
function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);

  return typeof value === "string" ? value : undefined;
}

/** A repository no GitHub source of the workspace names — refused before any write. */
class NotCovered extends Error {}

/**
 * The detection card's *Re-scan* (BC.2, #391) — start a scan, or join the one running. The
 * service debounces it (`409 detection_rescan_too_soon`, in its words); any contributor.
 *
 * @param repo The repository.
 * @returns The scan's progress, or the service's stated refusal.
 */
export async function rescanRepository(repo: string): Promise<WizardWrite<RepoDetectionRescan>> {
  return guarded(repo, (valid) => detection.scan(valid));
}

/**
 * Whether what a caller passed is a list of at most {@link GLOBS_MAX} strings — the shape the
 * service takes; the grammar of each is the service's to judge, in its own words.
 *
 * @param globs What was passed.
 * @returns True for such a list.
 */
function isGlobList(globs: unknown): globs is readonly string[] {
  return Array.isArray(globs) && globs.length <= GLOBS_MAX && globs.every((glob) => typeof glob === "string");
}

/**
 * The protected-paths row's *Save* (BC.2, #391) — replace the repository's list, which run
 * guardrails then refuse. Owner or admin; the service refuses anyone else, and names every glob
 * it cannot enforce (`422 detection_glob_invalid`).
 *
 * @param repo The repository.
 * @param globs The whole list.
 * @returns The card re-read with the list as stored, or why not.
 */
export async function saveProtectedPaths(repo: string, globs: readonly string[]): Promise<WizardWrite<RepoDetection>> {
  if (!isGlobList(globs)) return { ok: false, reason: DETECTION_WRITE_FAILED };

  return guarded(repo, (valid) => detection.editProtectedPaths(valid, globs));
}

/** What the match preview says when the service gave no reason. */
const PATH_PREVIEW_FAILED = "The match preview could not be read. The patterns themselves are unaffected.";

/**
 * What a list of protected-path globs matches in the wizard's repository — the guardrails' own
 * matcher over its tree (`POST /api/v1/policies/path-preview`), kept to this one repository.
 *
 * @param repo The repository.
 * @param globs The globs.
 * @returns The preview, or why there is none.
 */
export async function previewProtectedPaths(repo: string, globs: readonly string[]): Promise<GlobPreview> {
  const valid = parseRepo(repo);

  if (valid === null || !isGlobList(globs)) return { ok: false, reason: PATH_PREVIEW_FAILED };

  try {
    const { repositories } = await orgPolicy.pathPreview(globs);

    return {
      ok: true,
      repositories: repositories.filter((one) => one.repository.toLowerCase() === valid.toLowerCase()),
    };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: error.status >= 400 && error.status < 500 ? error.message : PATH_PREVIEW_FAILED };
  }
}

/**
 * A template tile's press (BC.3, #392) — instantiate a published workflow from the template, or
 * reuse the live one already made from it, and make it the repository's choice. Owner or admin;
 * the service refuses anyone else and a locked tier in its own words, and a definition its
 * publish gate refused comes back with the gate's findings (`422 onboarding_template_invalid`),
 * nothing created.
 *
 * @param repo The repository.
 * @param slug The template.
 * @returns The selection, or why not — with findings when the definition was the reason.
 */
export async function selectTemplate(repo: string, slug: string): Promise<TemplateSelectOutcome> {
  if (!isTemplateSlug(slug)) return { ok: false, reason: NOT_A_TEMPLATE, findings: [] };

  const valid = parseRepo(repo);

  if (valid === null) return { ok: false, reason: NOT_A_REPOSITORY, findings: [] };

  try {
    return { ok: true, value: await onboarding.selectTemplate(valid, slug) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      reason: refusal(error),
      findings: error.code === "onboarding_template_invalid" ? findingsOf(error.details) : [],
    };
  }
}
