/**
 * The wizard's subsystems, in memory ([#385](https://github.com/NobuData/ouroboros/issues/385)).
 *
 * {@link FakeOnboarding} stands in for `OnboardingRepository`: it holds the facts each subsystem
 * would answer with and records every write, so a suite can run the real `OnboardingService` —
 * and, since BB.5 (#388), the real launcher and defaults services on top of it — without a
 * database, and assert what was and was not persisted.
 */

import { FIXTURE_USER } from "../auth/principal.fixture";
import type { OnboardingState, Organization, OrganizationRole } from "../db/schema";
import { runWithTenantContext, setTenantContext } from "../tenancy/tenant.context";
import type {
  GithubSourceRow,
  InstantiatedWorkflowRow,
  OnboardingChoices,
  OnboardingRepository,
  RepositoryRow,
  TemplateRow,
  TicketRow,
} from "./onboarding.repository";

export const ORG = "org-1";
export const REPO = "acme-robotics/helios-firmware";
export const TICKET_ID = "7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

/** `github_issues.id` of the mirrored `#488` — what BB.4's picker answers. */
export const ISSUE_ID = "5eed004e-0000-4000-8000-000000000488";

/** The choice columns a write may carry — and nothing else. */
export const CHOICE_COLUMNS = ["selected_template", "picked_ticket_id", "dismissed"];

/** A write the fake saw. */
export interface Write {
  method: "saveChoices" | "markCompleted" | "markBypassed";
  repo: string;
  columns: string[];
}

/** The subsystems' state, and the wizard's rows, in memory. */
export class FakeOnboarding {
  sources: GithubSourceRow[] = [];
  appInstalledFlag = false;
  repositoryRow: RepositoryRow | undefined;
  workflows: InstantiatedWorkflowRow[] = [];
  tickets: TicketRow[] = [];
  /** The repository's mirrored backlog: `github_issues.id` → number. */
  mirrored = new Map<string, number>();
  queued = new Set<number>();
  runs = new Set<number>();
  scanned = false;
  runsInOrganization = false;
  templateRows: TemplateRow[] = [
    { slug: "quick-fixes", version: 1, tier: "starter", organization_id: null },
    { slug: "deep-refactor", version: 1, tier: "advanced", organization_id: null },
  ];
  rows = new Map<string, OnboardingState>();
  writes: Write[] = [];

  private row(repo: string): OnboardingState {
    const existing = this.rows.get(repo);

    if (existing !== undefined) {
      return existing;
    }

    const created: OnboardingState = {
      id: `row-${this.rows.size + 1}`,
      organization_id: ORG,
      repo_ref: repo,
      selected_template: null,
      picked_ticket_id: null,
      dismissed: false,
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      bypassed_at: null,
      protected_paths_edited_at: null,
    };

    this.rows.set(repo, created);

    return created;
  }

  asRepository(): OnboardingRepository {
    return {
      state: (_org: string, repo: string) => Promise.resolve(this.rows.get(repo)),
      saveChoices: (_org: string, repo: string, choices: OnboardingChoices) => {
        this.writes.push({ method: "saveChoices", repo, columns: Object.keys(choices) });
        Object.assign(this.row(repo), choices);

        return Promise.resolve(this.row(repo));
      },
      markCompleted: (_org: string, repo: string) => {
        this.writes.push({ method: "markCompleted", repo, columns: ["completed_at"] });
        this.row(repo).completed_at ??= new Date();

        return Promise.resolve(this.row(repo));
      },
      markBypassed: (_org: string, repo: string) => {
        this.writes.push({ method: "markBypassed", repo, columns: ["bypassed_at"] });
        this.row(repo).bypassed_at ??= new Date();

        return Promise.resolve(this.row(repo));
      },
      anyWizardFinished: () =>
        Promise.resolve(
          [...this.rows.values()].some(
            (row) => row.completed_at !== null || row.dismissed || row.bypassed_at !== null,
          ),
        ),
      githubSources: () => Promise.resolve(this.sources),
      appInstalled: () => Promise.resolve(this.appInstalledFlag),
      repository: () => Promise.resolve(this.repositoryRow),
      instantiatedWorkflow: (_org: string, slug: string) =>
        Promise.resolve(this.workflows.find((workflow) => workflow.template_slug === slug)),
      ticket: (_org: string, id: string) =>
        Promise.resolve(this.tickets.find((ticket) => ticket.id === id)),
      mirroredIssue: (_org: string, _repo: string, issueId: string) => {
        const number = this.mirrored.get(issueId);

        return Promise.resolve(number === undefined ? undefined : { number });
      },
      ticketOfIssue: (_org: string, owner: string, name: string, issue: number) =>
        Promise.resolve(
          this.tickets.find(
            (ticket) =>
              ticket.kind === "github" &&
              ticket.external_id === String(issue) &&
              JSON.stringify(ticket.meta) === JSON.stringify({ github: { owner, repo: name } }),
          ),
        ),
      reachedLoop: (_org: string, _repo: string, issue: number) =>
        Promise.resolve({ queued: this.queued.has(issue), run: this.runs.has(issue) }),
      hasRuns: () => Promise.resolve(this.runsInOrganization),
      latestScan: () =>
        Promise.resolve(
          this.scanned
            ? { scan_seq: 1, scanned_at: new Date("2026-09-29T09:00:00Z"), duration_ms: 38000 }
            : undefined,
        ),
      templates: () => Promise.resolve(this.templateRows),
    } as unknown as OnboardingRepository;
  }

  /**
   * Put the wizard where mockup 13's action bar reads *Run my first loop*: a healthy source, the
   * repository enabled, `quick-fixes` instantiated and `#488` picked — steps 1–3 done, step 4 todo.
   *
   * @returns This fake, for chaining.
   */
  readyToLaunch(): this {
    this.sources = [SOURCE];
    this.repositoryRow = { id: "repo-1", enabled: true, account_enabled: true };
    this.workflows = [{ slug: "quick-fixes", template_slug: "quick-fixes", template_version: 1 }];
    this.tickets = [TICKET];
    this.mirrored.set(ISSUE_ID, 488);
    this.rows.set(REPO, {
      ...emptyRow(),
      selected_template: "quick-fixes",
      picked_ticket_id: TICKET_ID,
    });

    return this;
  }
}

/** A healthy GitHub source covering the repository. */
export const SOURCE: GithubSourceRow = {
  display_name: "GitHub · acme-robotics",
  status: "active",
  status_reason: null,
  config: { login: "acme-robotics", repos: ["helios-firmware"] },
};

/** The mockup's first pick — #488, an issue of the repository. */
export const TICKET: TicketRow = {
  id: TICKET_ID,
  external_id: "488",
  external_key: "#488",
  title: "docs: fix typo in README",
  meta: { github: { owner: "acme-robotics", repo: "helios-firmware" } },
  kind: "github",
};

/**
 * Run as a member holding `role` in the workspace.
 *
 * @param role - The role.
 * @param work - What to run.
 * @returns What it returned.
 */
export function as<T>(role: OrganizationRole, work: () => Promise<T>): Promise<T> {
  return runWithTenantContext(() => {
    setTenantContext({
      user: FIXTURE_USER,
      membership: { tenant: { id: ORG } as Organization, roles: [role] },
    });

    return work();
  });
}

/**
 * An onboarding row with no choices.
 *
 * @returns The row.
 */
export function emptyRow(): OnboardingState {
  return {
    id: "row-x",
    organization_id: ORG,
    repo_ref: REPO,
    selected_template: null,
    picked_ticket_id: null,
    dismissed: false,
    completed_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    bypassed_at: null,
    protected_paths_edited_at: null,
  };
}
