"use server";

/**
 * The wizard's writes (BC.1, [#390](https://github.com/NobuData/ouroboros/issues/390)) — each one
 * a call the service guards (BB.2, #385; BB.5, #388), so a refusal comes back as the service's
 * own stated reason and the action bar shows it.
 *
 * Every argument is re-validated here: a Server Action is a public endpoint, and the repository
 * a caller passes is only ever used once it is shaped like one.
 */

import { requireWorkspace } from "@/app/api/access";
import { type RepoDetection, type RepoDetectionRescan, detection } from "@/app/api/detection";
import { readEnablement } from "@/app/api/enablement";
import { isApiError } from "@/app/api/errors";
import { type Onboarding, type OnboardingLaunchReceipt, onboarding } from "@/app/api/onboarding";
import { orgPolicy } from "@/app/api/org-policy";
import { orgs } from "@/app/api/orgs";
import { repos } from "@/app/api/repos";
import { GLOBS_MAX, type GlobPreview } from "@/app/globs/glob";

import { DETECTION_WRITE_FAILED } from "./detection-view";
import { NOT_A_REPOSITORY, STEP_COUNT, WIZARD_WRITE_FAILED, parseRepo } from "./view";

/** A write's outcome: what the service answered, or why not as a sentence. */
export type WizardWrite<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/**
 * A refusal in the service's words, or a plain failure for anything that is not a refusal.
 *
 * @param error What the call threw.
 * @returns The sentence.
 * @throws Anything that is not an API error — a bug is not a refusal.
 */
function refusal(error: unknown): string {
  if (error instanceof NotMirrored) return error.message;
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
 * @param repo The repository.
 * @returns The receipt, or the launch's stated refusal.
 */
export async function launchFirstLoop(repo: string): Promise<WizardWrite<OnboardingLaunchReceipt>> {
  return guarded(repo, (valid) => onboarding.launch(valid));
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
 * *Enable {repo} →* — step 2: turn on the repository, and its GitHub account when that is off
 * too, so both of the flags the service requires are true. Owner or admin; the service refuses
 * anyone else, in its own words.
 *
 * @param repo The repository.
 * @returns The wizard re-derived after the change, or why not.
 */
export async function enableRepository(repo: string): Promise<WizardWrite<Onboarding>> {
  const { membership } = await requireWorkspace();

  return guarded(repo, async (valid) => {
    const [login, name] = valid.split("/") as [string, string];
    const listed = await readEnablement(membership.id);
    const account = listed.orgs.find(({ org }) => org.login.toLowerCase() === login.toLowerCase());
    const found = account?.repos.find((one) => one.name.toLowerCase() === name.toLowerCase());

    if (account === undefined || found === undefined) {
      // The same sentence the service derives for step 2, rather than a write that would 404.
      return Promise.reject(notMirrored(valid));
    }

    if (!account.org.enabled) await orgs.setEnabled(membership.id, account.org.login, true);
    if (!found.enabled) await repos.setEnabled(membership.id, account.org.login, found.name, true);

    return onboarding.read(valid);
  });
}

/** A repository this workspace's GitHub accounts do not hold — refused before any write. */
class NotMirrored extends Error {}

/**
 * The refusal for a repository nothing mirrors.
 *
 * @param repo The repository.
 * @returns The error, carrying the service's sentence for step 2.
 */
function notMirrored(repo: string): Error {
  return new NotMirrored(`${repo} is not a repository of this workspace's GitHub accounts.`);
}

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
