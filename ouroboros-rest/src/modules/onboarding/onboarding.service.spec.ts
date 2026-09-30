/**
 * The onboarding rules ([#385](https://github.com/NobuData/ouroboros/issues/385)), against an
 * in-memory repository that holds the subsystems' facts and records every write — which is how
 * "no step status is persisted" is asserted across a full traversal.
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
import { covers, normaliseRepo, OnboardingService, ticketRepository } from "./onboarding.service";

const ORG = "org-1";
const REPO = "acme-robotics/helios-firmware";
const TICKET_ID = "7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

/** The choice columns a write may carry — and nothing else. */
const CHOICE_COLUMNS = ["selected_template", "picked_ticket_id", "dismissed"];

/** A write the fake saw. */
interface Write {
  method: "saveChoices" | "markCompleted" | "markBypassed";
  repo: string;
  columns: string[];
}

/** The subsystems' state, and the wizard's rows, in memory. */
class FakeOnboarding {
  sources: GithubSourceRow[] = [];
  appInstalledFlag = false;
  repositoryRow: RepositoryRow | undefined;
  workflows: InstantiatedWorkflowRow[] = [];
  tickets: TicketRow[] = [];
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
}

/** A healthy GitHub source covering the repository. */
const SOURCE: GithubSourceRow = {
  display_name: "GitHub · acme-robotics",
  status: "active",
  status_reason: null,
  config: { login: "acme-robotics", repos: ["helios-firmware"] },
};

/** The mockup's first pick — #488, an issue of the repository. */
const TICKET: TicketRow = {
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
function as<T>(role: OrganizationRole, work: () => Promise<T>): Promise<T> {
  return runWithTenantContext(() => {
    setTenantContext({
      user: FIXTURE_USER,
      membership: { tenant: { id: ORG } as Organization, roles: [role] },
    });

    return work();
  });
}

describe("the onboarding service", () => {
  let fake: FakeOnboarding;
  let adoptDefault: jest.Mock<Promise<boolean>, [string]>;
  let service: OnboardingService;

  beforeEach(() => {
    fake = new FakeOnboarding();
    adoptDefault = jest.fn<Promise<boolean>, [string]>().mockResolvedValue(true);
    service = new OnboardingService(fake.asRepository(), { adoptDefault });
  });

  describe("reads", () => {
    it("answers a repository nobody has onboarded with a derived rail and no choices", async () => {
      const resource = await service.read(ORG, REPO);

      expect(resource.repo).toBe(REPO);
      expect(resource.steps.map((step) => step.status)).toEqual(["active", "todo", "todo", "todo"]);
      expect(resource.choices.selectedTemplate).toBeNull();
      expect(resource.surfacing).toEqual({ offer: true, reason: "fresh_organization" });
      expect(fake.writes).toEqual([]);
    });

    it("compares the repository case-insensitively", async () => {
      fake.sources = [SOURCE];

      const resource = await service.read(ORG, "Acme-Robotics/Helios-Firmware");

      expect(resource.repo).toBe(REPO);
      expect(resource.steps[0].status).toBe("done");
    });

    it("prefers a healthy source when several cover the repository", async () => {
      fake.sources = [{ ...SOURCE, display_name: "old", status: "paused" }, SOURCE];

      expect((await service.read(ORG, REPO)).steps[0].status).toBe("done");
    });

    it("says App installed only when the account records it", async () => {
      fake.sources = [SOURCE];
      fake.appInstalledFlag = true;

      expect((await service.read(ORG, REPO)).steps[0].evidence).toBe(
        "acme-robotics · GitHub App installed",
      );
    });

    it("does not count a ticket of another repository as the first run", async () => {
      fake.tickets = [{ ...TICKET, meta: { github: { owner: "acme-robotics", repo: "other" } } }];
      fake.rows.set(REPO, { ...emptyRow(), picked_ticket_id: TICKET_ID });
      fake.repositoryRow = { id: "repo-1", enabled: true, account_enabled: true };
      fake.queued.add(488);

      const resource = await service.read(ORG, REPO);

      expect(resource.steps[3].status).not.toBe("done");
      expect(resource.steps[3].reason).toBe(
        "#488 is not an issue of acme-robotics/helios-firmware, so it cannot be its first run.",
      );
    });
  });

  describe("a full traversal", () => {
    it("persists choices only — never a step status — and regresses on disconnect", async () => {
      await as("member", async () => {
        // Step 1 and 2: done by their subsystems, not by the wizard.
        fake.sources = [SOURCE];
        fake.repositoryRow = { id: "repo-1", enabled: true, account_enabled: true };
        await service.completeStep(ORG, REPO, 1);
        await service.completeStep(ORG, REPO, 2);

        // Step 3: pick, instantiate (BB.3's job — simulated), complete.
        await service.update(ORG, REPO, { selectedTemplate: "quick-fixes" });
        fake.workflows = [
          { slug: "quick-fixes", template_slug: "quick-fixes", template_version: 1 },
        ];
        await service.completeStep(ORG, REPO, 3);

        // Step 4: pick, queue (BB.5's job — simulated), complete.
        fake.tickets = [TICKET];
        await service.update(ORG, REPO, { pickedTicketId: TICKET_ID });
        fake.queued.add(488);
        const done = await service.completeStep(ORG, REPO, 4);

        expect(done.steps.map((step) => step.status)).toEqual(["done", "done", "done", "done"]);
        expect(done.choices.completedAt).not.toBeNull();
      });

      // Completion turns the dry-run policy on when unset (BA.3, #382) — once, at step 4 only.
      expect(adoptDefault.mock.calls).toEqual([[ORG]]);

      // Every write, across the whole traversal, touched choice columns or the completion stamp.
      expect(fake.writes.map((write) => write.method)).toEqual([
        "saveChoices",
        "saveChoices",
        "markCompleted",
      ]);
      for (const write of fake.writes.filter((w) => w.method === "saveChoices")) {
        expect(CHOICE_COLUMNS).toEqual(expect.arrayContaining(write.columns));
      }

      // A teammate pauses the source. The next read — with no wizard write — regresses step 1.
      const writesBefore = fake.writes.length;
      fake.sources = [{ ...SOURCE, status: "paused" }];

      const after = await service.read(ORG, REPO);

      expect(after.steps[0]).toMatchObject({ status: "todo", regressed: true });
      expect(after.steps[0].reason).toContain("is paused");
      expect(fake.writes).toHaveLength(writesBefore);
    });
  });

  describe("the completion guard", () => {
    it("refuses step 3 without an instantiated workflow, with a stated reason", async () => {
      fake.sources = [SOURCE];
      fake.repositoryRow = { id: "repo-1", enabled: true, account_enabled: true };
      fake.rows.set(REPO, { ...emptyRow(), selected_template: "quick-fixes" });

      await expect(service.completeStep(ORG, REPO, 3)).rejects.toMatchObject({
        response: {
          code: "onboarding_step_incomplete",
          message: "No workflow has been created from the quick-fixes template yet.",
          details: { step: 3, blockingStep: 3 },
        },
      });
      expect(fake.writes).toEqual([]);
    });

    it("refuses step 4 without a queued run", async () => {
      fake.sources = [SOURCE];
      fake.repositoryRow = { id: "repo-1", enabled: true, account_enabled: true };
      fake.workflows = [{ slug: "quick-fixes", template_slug: "quick-fixes", template_version: 1 }];
      fake.tickets = [TICKET];
      fake.rows.set(REPO, {
        ...emptyRow(),
        selected_template: "quick-fixes",
        picked_ticket_id: TICKET_ID,
      });

      await expect(service.completeStep(ORG, REPO, 4)).rejects.toMatchObject({
        response: { details: { blockingStep: 4, reason: "#488 has not been queued yet." } },
      });
      expect(fake.writes).toEqual([]);
    });

    it("writes nothing when completing steps 1 to 3", async () => {
      fake.sources = [SOURCE];

      await service.completeStep(ORG, REPO, 1);

      expect(fake.writes).toEqual([]);
      expect(adoptDefault).not.toHaveBeenCalled();
    });

    it("never touches the dry-run policy when step 4 is refused", async () => {
      fake.sources = [SOURCE];

      await expect(service.completeStep(ORG, REPO, 4)).rejects.toMatchObject({
        response: { code: "onboarding_step_incomplete" },
      });
      expect(adoptDefault).not.toHaveBeenCalled();
    });
  });

  describe("choices", () => {
    it("refuses a template the workspace is not offered", async () => {
      await expect(
        as("member", () => service.update(ORG, REPO, { selectedTemplate: "nope" })),
      ).rejects.toMatchObject({
        response: {
          code: "onboarding_template_unknown",
          details: { offered: ["quick-fixes", "deep-refactor"] },
        },
      });
    });

    it("refuses a ticket the workspace does not have — another workspace's included", async () => {
      await expect(
        as("member", () => service.update(ORG, REPO, { pickedTicketId: TICKET_ID })),
      ).rejects.toMatchObject({ response: { code: "onboarding_ticket_not_found" } });
      expect(fake.writes).toEqual([]);
    });

    it("clears a pick with null", async () => {
      fake.rows.set(REPO, { ...emptyRow(), selected_template: "quick-fixes" });

      const resource = await as("member", () =>
        service.update(ORG, REPO, { selectedTemplate: null }),
      );

      expect(resource.choices.selectedTemplate).toBeNull();
    });

    it("writes nothing for an empty body", async () => {
      await as("viewer", () => service.update(ORG, REPO, {}));

      expect(fake.writes).toEqual([]);
    });

    it("lets a viewer dismiss, and dismissal sticks for the surfacing rule", async () => {
      const resource = await as("viewer", () => service.update(ORG, REPO, { dismissed: true }));

      expect(resource.choices.dismissed).toBe(true);
      expect(resource.surfacing).toEqual({ offer: false, reason: "wizard_finished" });
    });

    it("refuses a viewer's pick", async () => {
      await expect(
        as("viewer", () => service.update(ORG, REPO, { selectedTemplate: "quick-fixes" })),
      ).rejects.toMatchObject({
        response: { code: "forbidden", details: { role: "viewer" } },
      });
      await expect(
        as("viewer", () => service.update(ORG, REPO, { dismissed: true, pickedTicketId: null })),
      ).rejects.toMatchObject({ response: { code: "forbidden" } });
      expect(fake.writes).toEqual([]);
    });

    it("keeps a second repository's wizard independent", async () => {
      await as("member", () => service.update(ORG, REPO, { selectedTemplate: "quick-fixes" }));

      const second = await service.read(ORG, "acme-robotics/helios-console");

      expect(second.choices.selectedTemplate).toBeNull();
      expect((await service.read(ORG, REPO)).choices.selectedTemplate).toBe("quick-fixes");
    });
  });

  describe("the import-skip", () => {
    it("marks the wizard bypassed and does not claim to have imported anything", async () => {
      const result = await service.skip(ORG, REPO);

      expect(result.configurationImported).toBe(false);
      expect(result.settingsPath).toBe("/settings");
      expect(result.onboarding.choices.bypassedAt).not.toBeNull();
      expect(result.onboarding.choices.dismissed).toBe(false);
      expect(result.onboarding.surfacing.reason).toBe("wizard_finished");
      expect(fake.writes).toEqual([
        { method: "markBypassed", repo: REPO, columns: ["bypassed_at"] },
      ]);
    });
  });

  describe("surfacing", () => {
    it("does not offer the wizard to an organization that has had runs", async () => {
      fake.runsInOrganization = true;

      expect((await service.read(ORG, REPO)).surfacing).toEqual({
        offer: false,
        reason: "organization_has_runs",
      });
    });
  });
});

describe("the helpers", () => {
  it("normalises a repository to lower case", () => {
    expect(normaliseRepo("Acme/Helios")).toBe("acme/helios");
  });

  it("reads coverage from a GitHub source's config, and none from an unreadable one", () => {
    const config = { login: "Acme-Robotics", repos: ["Helios-Firmware"] };

    expect(covers(config, "acme-robotics", "helios-firmware")).toBe(true);
    expect(covers(config, "acme-robotics", "helios-console")).toBe(false);
    expect(covers(config, "other", "helios-firmware")).toBe(false);
    expect(covers({ nonsense: true }, "acme-robotics", "helios-firmware")).toBe(false);
    expect(covers(null, "acme-robotics", "helios-firmware")).toBe(false);
    expect(
      covers(
        { login: "acme-robotics", repos: [1, "helios-firmware"] },
        "acme-robotics",
        "helios-firmware",
      ),
    ).toBe(true);
  });

  it("reads a ticket's repository from its GitHub meta", () => {
    expect(ticketRepository({ github: { owner: "Acme", repo: "Helios" } })).toBe("acme/helios");
    expect(ticketRepository({})).toBeNull();
    expect(ticketRepository(null)).toBeNull();
    expect(ticketRepository({ github: { owner: 1, repo: "x" } })).toBeNull();
  });
});

/** An onboarding row with no choices. */
function emptyRow(): OnboardingState {
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
  };
}
