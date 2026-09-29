/**
 * The onboarding wizard's rules ([#385](https://github.com/NobuData/ouroboros/issues/385), BB.2).
 *
 *   * **Ask each owner and compose; never remember** (decision **O1**). Every read gathers the
 *     subsystem facts through {@link OnboardingRepository} and derives the rail with
 *     `deriveRail`. Nothing here writes a step status — there is nowhere to write one.
 *   * **Choices are the wizard's**, stored per `(workspace, repository)`, so they survive
 *     sessions, devices and tabs, and a second repository has its own.
 *   * **Completion is guarded.** `completeStep` re-derives the rail and refuses — with the
 *     blocking step's stated reason — unless every step up to the one completed is done in
 *     reality. Only step 4 writes, and what it writes is the completion stamp.
 *   * **The import-skip is honest.** It stamps `bypassed_at`, points at the settings surface, and
 *     says `configurationImported: false`: the bundle import is BD.3 (#398).
 *   * **Anyone can dismiss.** A `PATCH` carrying only `dismissed` is open to every member; one
 *     that picks a template or a ticket needs a contributor (owner, admin or member).
 */

import { Injectable } from "@nestjs/common";

import { CONTRIBUTORS } from "../tenancy/roles.guard";
import { currentMembership } from "../tenancy/tenant.context";
import { forbidden } from "../tenancy/tenancy.errors";
import type { OnboardingState } from "../db/schema";
import {
  blockingStep,
  deriveRail,
  splitRepo,
  type OnboardingStepNumber,
  type PickedTicketFact,
  type SourceFact,
} from "./onboarding.derivation";
import type { PatchOnboardingDto } from "./onboarding.dto";
import { stepIncomplete, templateUnknown, ticketNotFound } from "./onboarding.errors";
import {
  OnboardingRepository,
  type GithubSourceRow,
  type OnboardingChoices,
  type TicketRow,
} from "./onboarding.repository";
import { surfacing } from "./onboarding.surfacing";
import {
  onboardingResource,
  SETTINGS_PATH,
  type OnboardingResource,
  type OnboardingSkipResource,
} from "./resources";

/** How a covering source is preferred when several list the repository: healthy first. */
const SOURCE_PREFERENCE: Readonly<Record<GithubSourceRow["status"], number>> = {
  active: 0,
  error: 1,
  paused: 2,
};

@Injectable()
export class OnboardingService {
  /**
   * @param onboarding - The statements: the wizard's own row, and each subsystem's question.
   */
  constructor(private readonly onboarding: OnboardingRepository) {}

  /**
   * The wizard for one repository — derived steps, stored choices, card references and the
   * surfacing decision.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, as the caller sent it; compared case-insensitively.
   * @returns The resource. Never a 404: a repository nobody has onboarded reads as no choices
   *   and a rail derived from whatever the subsystems hold.
   */
  async read(organizationId: string, repo: string): Promise<OnboardingResource> {
    return this.compose(organizationId, normaliseRepo(repo));
  }

  /**
   * Store the choices a `PATCH` carried and answer with the whole surface.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`.
   * @param patch - The validated body. An empty body changes nothing.
   * @returns The resource after the write.
   * @throws {ForbiddenError} `forbidden` — a viewer picking a template or a ticket.
   * @throws {InvalidRequestError} `onboarding_template_unknown` — a slug the workspace is not
   *   offered.
   * @throws {NotFoundError} `onboarding_ticket_not_found` — a ticket the workspace does not
   *   have, another workspace's included.
   */
  async update(
    organizationId: string,
    repo: string,
    patch: PatchOnboardingDto,
  ): Promise<OnboardingResource> {
    const ref = normaliseRepo(repo);
    const choices: OnboardingChoices = {};

    if (patch.selectedTemplate !== undefined || patch.pickedTicketId !== undefined) {
      requireContributor();
    }

    if (patch.selectedTemplate !== undefined) {
      if (patch.selectedTemplate !== null) {
        await this.requireOfferedTemplate(organizationId, patch.selectedTemplate);
      }

      choices.selected_template = patch.selectedTemplate;
    }

    if (patch.pickedTicketId !== undefined) {
      if (patch.pickedTicketId !== null) {
        const ticket = await this.onboarding.ticket(organizationId, patch.pickedTicketId);

        if (ticket === undefined) {
          throw ticketNotFound(patch.pickedTicketId);
        }
      }

      choices.picked_ticket_id = patch.pickedTicketId;
    }

    if (patch.dismissed !== undefined) {
      choices.dismissed = patch.dismissed;
    }

    if (Object.keys(choices).length > 0) {
      await this.onboarding.saveChoices(organizationId, ref, choices);
    }

    return this.compose(organizationId, ref);
  }

  /**
   * Complete a step — refused unless it, and every step before it, is done in reality.
   *
   * Steps 1–3 write nothing: their state is derived, so "completing" one is the guard answering
   * yes and the rail being returned. Step 4 stamps `completed_at` (once; a repeat keeps the
   * first time).
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`.
   * @param step - The step being completed.
   * @returns The resource, after the stamp when step 4.
   * @throws {ConflictError} `onboarding_step_incomplete` — with the blocking step and its
   *   stated reason.
   */
  async completeStep(
    organizationId: string,
    repo: string,
    step: OnboardingStepNumber,
  ): Promise<OnboardingResource> {
    const ref = normaliseRepo(repo);
    const current = await this.compose(organizationId, ref);
    const blocking = blockingStep(current, step);

    if (blocking !== undefined) {
      throw stepIncomplete(step, blocking);
    }

    if (step !== 4) {
      return current;
    }

    await this.onboarding.markCompleted(organizationId, ref);

    return this.compose(organizationId, ref);
  }

  /**
   * The import-skip: mark the wizard bypassed and point at the settings surface.
   *
   * Imports nothing, and says so — `configurationImported` is `false` until BD.3 (#398).
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`.
   * @returns The resource after the stamp, the settings pointer and the honest flag.
   */
  async skip(organizationId: string, repo: string): Promise<OnboardingSkipResource> {
    const ref = normaliseRepo(repo);

    await this.onboarding.markBypassed(organizationId, ref);

    return {
      onboarding: await this.compose(organizationId, ref),
      settingsPath: SETTINGS_PATH,
      configurationImported: false,
    };
  }

  /**
   * Gather every fact and assemble the resource.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @returns The resource.
   */
  private async compose(organizationId: string, repo: string): Promise<OnboardingResource> {
    const [owner, name] = splitRepo(repo);
    const state = await this.onboarding.state(organizationId, repo);
    const source = await this.source(organizationId, owner, name);
    const repository = await this.onboarding.repository(organizationId, owner, name);
    const scan = await this.onboarding.latestScan(organizationId, repo);
    const templates = await this.onboarding.templates(organizationId);
    const selectedTemplate = state?.selected_template ?? null;
    const workflow =
      selectedTemplate === null
        ? undefined
        : await this.onboarding.instantiatedWorkflow(organizationId, selectedTemplate);
    const ticket = await this.pickedTicket(organizationId, state);
    const pickedTicket =
      ticket === undefined
        ? null
        : await this.ticketFact(organizationId, ticket, repo, repository?.id);

    const rail = deriveRail({
      repo,
      source,
      repository:
        repository === undefined
          ? null
          : { enabled: repository.enabled, accountEnabled: repository.account_enabled },
      scanned: scan !== undefined,
      selectedTemplate,
      workflow:
        workflow === undefined
          ? null
          : {
              slug: workflow.slug,
              templateSlug: workflow.template_slug,
              templateVersion: workflow.template_version,
            },
      pickedTicket,
      completed: state?.completed_at != null,
    });

    return onboardingResource({
      repo,
      rail,
      state,
      scan,
      templates,
      ticket,
      surfacing: surfacing({
        anyWizardFinished: await this.onboarding.anyWizardFinished(organizationId),
        hasRuns: await this.onboarding.hasRuns(organizationId),
      }),
    });
  }

  /**
   * The GitHub source that covers `owner/name`: its config names the account and lists the
   * repository. When several do, the healthiest wins — one active source is enough.
   *
   * @param organizationId - The workspace.
   * @param owner - The account, lower-case.
   * @param name - The repository, lower-case.
   * @returns The source as the derivation needs it, or null when none covers the repository.
   */
  private async source(
    organizationId: string,
    owner: string,
    name: string,
  ): Promise<SourceFact | null> {
    const covering = (await this.onboarding.githubSources(organizationId))
      .filter((row) => covers(row.config, owner, name))
      .sort((a, b) => SOURCE_PREFERENCE[a.status] - SOURCE_PREFERENCE[b.status]);
    const chosen = covering[0];

    if (chosen === undefined) {
      return null;
    }

    return {
      displayName: chosen.display_name,
      login: owner,
      status: chosen.status,
      statusReason: chosen.status_reason,
      appInstalled: await this.onboarding.appInstalled(organizationId, owner),
    };
  }

  /**
   * The picked ticket, when there is one and it still exists in this workspace.
   *
   * @param organizationId - The workspace.
   * @param state - The wizard's row.
   * @returns The ticket, or undefined.
   */
  private async pickedTicket(
    organizationId: string,
    state: OnboardingState | undefined,
  ): Promise<TicketRow | undefined> {
    const id = state?.picked_ticket_id ?? null;

    return id === null ? undefined : this.onboarding.ticket(organizationId, id);
  }

  /**
   * Step 4's facts: is the picked ticket an issue of this repository, and has it reached the
   * loop?
   *
   * @param organizationId - The workspace.
   * @param ticket - The picked ticket.
   * @param repo - `owner/name`, lower-case.
   * @param repositoryId - The mirrored repository's id, when the workspace has one.
   * @returns The fact.
   */
  private async ticketFact(
    organizationId: string,
    ticket: TicketRow,
    repo: string,
    repositoryId: string | undefined,
  ): Promise<PickedTicketFact> {
    const issueNumber = Number.parseInt(ticket.external_id, 10);
    const inRepository =
      ticket.kind === "github" &&
      ticketRepository(ticket.meta) === repo &&
      repositoryId !== undefined &&
      Number.isSafeInteger(issueNumber);

    if (!inRepository || repositoryId === undefined) {
      return { externalKey: ticket.external_key, inRepository: false, queued: false, run: false };
    }

    const reached = await this.onboarding.reachedLoop(organizationId, repositoryId, issueNumber);

    return { externalKey: ticket.external_key, inRepository: true, ...reached };
  }

  /**
   * Refuse a template slug the workspace is not offered.
   *
   * @param organizationId - The workspace.
   * @param slug - The slug picked.
   * @throws {InvalidRequestError} `onboarding_template_unknown`.
   */
  private async requireOfferedTemplate(organizationId: string, slug: string): Promise<void> {
    const offered = (await this.onboarding.templates(organizationId)).map((row) => row.slug);

    if (!offered.includes(slug)) {
      throw templateUnknown(slug, offered);
    }
  }
}

/**
 * Lower-case a repository reference: GitHub accounts and repositories are case-insensitive, and
 * the mirror stores both lower-case, so one repository has one wizard however it is typed.
 *
 * @param repo - `owner/name`, validated by the DTO.
 * @returns The reference, lower-case.
 */
export function normaliseRepo(repo: string): string {
  return repo.toLowerCase();
}

/**
 * Whether a GitHub source's config covers `owner/name` — its `login` names the account and its
 * `repos` list the repository (the `github` kind's `{ login, repos[] }`, Q.3).
 *
 * Read here rather than through the provider's parser: providers sit behind the
 * `TicketSourceProvider` SPI and nothing outside `ticket-sources/` may import one
 * (`.dependency-cruiser.cjs`). Only the two fields are read, and a config without them covers
 * nothing — the sources screen is where it gets repaired, not here.
 *
 * @param config - `ticket_sources.config`.
 * @param owner - The account, lower-case.
 * @param name - The repository, lower-case.
 * @returns True when the config names the account and lists the repository.
 */
export function covers(config: unknown, owner: string, name: string): boolean {
  if (typeof config !== "object" || config === null) {
    return false;
  }

  const { login, repos } = config as { login?: unknown; repos?: unknown };

  return (
    typeof login === "string" &&
    login.toLowerCase() === owner &&
    Array.isArray(repos) &&
    repos.some((repo) => typeof repo === "string" && repo.toLowerCase() === name)
  );
}

/**
 * The repository a GitHub ticket belongs to, from the `meta.github` the mapper wrote.
 *
 * @param meta - `tickets.meta`.
 * @returns `owner/name`, lower-case, or null when the meta carries none.
 */
export function ticketRepository(meta: unknown): string | null {
  if (typeof meta !== "object" || meta === null) {
    return null;
  }

  const github = (meta as { github?: unknown }).github;

  if (typeof github !== "object" || github === null) {
    return null;
  }

  const { owner, repo } = github as { owner?: unknown; repo?: unknown };

  if (typeof owner !== "string" || typeof repo !== "string") {
    return null;
  }

  return `${owner}/${repo}`.toLowerCase();
}

/**
 * Refuse a caller below contributor — the rule for picking a template or a ticket.
 *
 * @throws {ForbiddenError} `forbidden`, naming the held role and the roles that suffice.
 */
function requireContributor(): void {
  const roles = currentMembership()?.roles ?? [];

  if (!roles.some((held) => CONTRIBUTORS.includes(held))) {
    throw forbidden(roles.join(","), CONTRIBUTORS);
  }
}
