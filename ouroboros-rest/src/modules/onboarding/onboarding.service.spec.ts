/**
 * The onboarding rules ([#385](https://github.com/NobuData/ouroboros/issues/385)), against an
 * in-memory repository that holds the subsystems' facts and records every write — which is how
 * "no step status is persisted" is asserted across a full traversal.
 */

import type { GithubSourceRow, TicketRow } from "./onboarding.repository";
import {
  as,
  CHOICE_COLUMNS,
  emptyRow,
  FakeOnboarding,
  ISSUE_ID,
  ORG,
  REPO,
  SOURCE,
  TICKET,
  TICKET_ID,
} from "./onboarding.fixture";
import {
  covers,
  coveringSource,
  issueNumberIn,
  normaliseRepo,
  OnboardingService,
  ticketRepository,
} from "./onboarding.service";

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

  describe("a pick named by the picker's issue id (BB.5, #388)", () => {
    beforeEach(() => {
      fake.repositoryRow = { id: "repo-1", enabled: true, account_enabled: true };
      fake.mirrored.set(ISSUE_ID, 488);
      fake.tickets = [TICKET];
    });

    it("stores the issue's canonical ticket as the pick", async () => {
      const resource = await as("member", () =>
        service.update(ORG, REPO, { pickedIssueId: ISSUE_ID }),
      );

      expect(resource.choices.pickedTicketId).toBe(TICKET_ID);
      expect(resource.refs.pickedTicket).toMatchObject({ externalKey: "#488", source: "github" });
      // Still one kind of pick: the write is the ticket column, and nothing else.
      expect(fake.writes).toEqual([
        { method: "saveChoices", repo: REPO, columns: ["picked_ticket_id"] },
      ]);
    });

    it("clears the pick with null", async () => {
      fake.rows.set(REPO, { ...emptyRow(), picked_ticket_id: TICKET_ID });

      const resource = await as("member", () => service.update(ORG, REPO, { pickedIssueId: null }));

      expect(resource.choices.pickedTicketId).toBeNull();
    });

    it("answers 404 for an issue the repository's backlog does not hold", async () => {
      const unknown = "00000000-0000-4000-8000-000000000001";

      await expect(
        as("member", () => service.update(ORG, REPO, { pickedIssueId: unknown })),
      ).rejects.toMatchObject({
        response: { code: "onboarding_issue_not_found", details: { issueId: unknown } },
      });
      expect(fake.writes).toEqual([]);
    });

    it("answers 404 when the workspace does not mirror the repository at all", async () => {
      fake.repositoryRow = undefined;

      await expect(
        as("member", () => service.update(ORG, REPO, { pickedIssueId: ISSUE_ID })),
      ).rejects.toMatchObject({ response: { code: "onboarding_issue_not_found" } });
    });

    it("answers 422 when no GitHub source has read the issue into a ticket yet", async () => {
      fake.tickets = [];

      await expect(
        as("member", () => service.update(ORG, REPO, { pickedIssueId: ISSUE_ID })),
      ).rejects.toMatchObject({
        status: 422,
        response: {
          code: "onboarding_issue_ticket_missing",
          details: { issueId: ISSUE_ID, issueNumber: 488, repo: REPO },
        },
      });
      expect(fake.writes).toEqual([]);
    });

    it("refuses a pick named twice, whichever values the two carry", async () => {
      await expect(
        as("member", () =>
          service.update(ORG, REPO, { pickedTicketId: TICKET_ID, pickedIssueId: ISSUE_ID }),
        ),
      ).rejects.toMatchObject({ status: 422, response: { code: "onboarding_pick_ambiguous" } });
      await expect(
        as("member", () =>
          service.update(ORG, REPO, { pickedTicketId: null, pickedIssueId: null }),
        ),
      ).rejects.toMatchObject({ response: { code: "onboarding_pick_ambiguous" } });
      expect(fake.writes).toEqual([]);
    });

    it("refuses a viewer's pick by issue id", async () => {
      await expect(
        as("viewer", () => service.update(ORG, REPO, { pickedIssueId: ISSUE_ID })),
      ).rejects.toMatchObject({ response: { code: "forbidden" } });
      expect(fake.writes).toEqual([]);
    });
  });

  describe("the snapshot the launcher composes (BB.5, #388)", () => {
    it("carries the rows the rail was derived from", async () => {
      fake.readyToLaunch();

      const snapshot = await service.snapshot(ORG, "Acme-Robotics/Helios-Firmware");

      expect(snapshot.resource).toEqual(await service.read(ORG, REPO));
      expect(snapshot.source).toMatchObject({ login: "acme-robotics", appInstalled: false });
      expect(snapshot.repository).toEqual({ id: "repo-1", enabled: true, account_enabled: true });
      expect(snapshot.workflow).toMatchObject({ slug: "quick-fixes" });
      expect(snapshot.ticket).toEqual(TICKET);
      expect(snapshot.issueNumber).toBe(488);
    });

    it("carries no issue number for a pick that is another repository's", async () => {
      fake.readyToLaunch();
      fake.tickets = [{ ...TICKET, meta: { github: { owner: "acme-robotics", repo: "other" } } }];

      const snapshot = await service.snapshot(ORG, REPO);

      expect(snapshot.ticket).toBeDefined();
      expect(snapshot.issueNumber).toBeUndefined();
    });

    it("is empty-handed for a repository nobody has onboarded", async () => {
      const snapshot = await service.snapshot(ORG, REPO);

      expect(snapshot).toMatchObject({
        source: null,
        repository: undefined,
        workflow: undefined,
        ticket: undefined,
        issueNumber: undefined,
      });
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

    it("answers the rule with no repository named — the dashboard's banner (#390)", async () => {
      expect(await service.surfacing(ORG)).toEqual({ offer: true, reason: "fresh_organization" });

      fake.runsInOrganization = true;

      expect(await service.surfacing(ORG)).toEqual({
        offer: false,
        reason: "organization_has_runs",
      });
    });

    it("stops offering once any repository's wizard is dismissed — and agrees with the per-repo read", async () => {
      await service.update(ORG, REPO, { dismissed: true });

      expect(await service.surfacing(ORG)).toEqual(
        (await service.read(ORG, "acme-robotics/other")).surfacing,
      );
      expect(await service.surfacing(ORG)).toEqual({ offer: false, reason: "wizard_finished" });
    });
  });
});

describe("the helpers", () => {
  it("normalises a repository to lower case", () => {
    expect(normaliseRepo("Acme/Helios")).toBe("acme/helios");
  });

  it("chooses the healthiest source covering a repository, and none when nothing covers it", () => {
    const paused: GithubSourceRow = { ...SOURCE, display_name: "paused", status: "paused" };
    const failing: GithubSourceRow = { ...SOURCE, display_name: "failing", status: "error" };
    const elsewhere: GithubSourceRow = { ...SOURCE, config: { login: "acme-robotics", repos: [] } };

    expect(coveringSource([paused, failing, SOURCE], "acme-robotics", "helios-firmware")).toBe(
      SOURCE,
    );
    expect(coveringSource([paused, failing], "acme-robotics", "helios-firmware")).toBe(failing);
    expect(coveringSource([elsewhere], "acme-robotics", "helios-firmware")).toBeUndefined();
  });

  it("reads a ticket's issue number only when it is a GitHub issue of the repository", () => {
    const jira: TicketRow = { ...TICKET, kind: "jira" };
    const elsewhere: TicketRow = { ...TICKET, meta: { github: { owner: "acme", repo: "x" } } };
    const keyed: TicketRow = { ...TICKET, external_id: "HEL-142" };

    expect(issueNumberIn(TICKET, REPO)).toBe(488);
    expect(issueNumberIn(jira, REPO)).toBeUndefined();
    expect(issueNumberIn(elsewhere, REPO)).toBeUndefined();
    expect(issueNumberIn(keyed, REPO)).toBeUndefined();
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
