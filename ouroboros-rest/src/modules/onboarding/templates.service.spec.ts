/**
 * Step 3's rules ([#386](https://github.com/NobuData/ouroboros/issues/386), BB.3).
 *
 * The instantiation path is exercised through a **real** `WorkflowsService` over spies, so the
 * gate these tests stub is the one the studio's publish runs — which is the ticket's *no wizard
 * bypass* criterion, asserted rather than assumed. The source scan at the end is the other half:
 * no file of this module writes `workflows` or `workflow_versions` itself.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AppConfigService } from "../config/config.service";
import type { DatabaseService } from "../db/db.service";
import type { Workflow, WorkflowVersion } from "../db/schema";
import type { WorkflowPublishGate } from "../workflows/publish.gate";
import type { WorkflowStatsService } from "../workflows/stats.service";
import type { WorkflowsRepository } from "../workflows/workflows.repository";
import { WorkflowsService } from "../workflows/workflows.service";
import type { OnboardingRepository } from "./onboarding.repository";
import type { OnboardingService } from "./onboarding.service";
import type { InstantiatedWorkflowRow, TemplateTileRow } from "./templates.repository";
import type { TemplateTilesRepository } from "./templates.repository";
import { TemplateInstantiationService } from "./templates.service";

const WORKSPACE = "org-1";
const REPO = "Acme-Robotics/Helios-Firmware";
const PERSON = "user-1";
const AT = new Date("2026-09-29T10:00:00.000Z");
const WIZARD = { repo: "acme-robotics/helios-firmware" };
const DEFINITION = { dsl_version: "1.0", nodes: [] };

/** A template row, with whatever a test changes. */
function template(overrides: Partial<TemplateTileRow> = {}): TemplateTileRow {
  return {
    slug: "quick-fixes",
    version: 3,
    organization_id: null,
    name: "Quick fixes",
    description: "Small bugs and cleanups, fully hands-off.",
    stage_dots: ["analyze", "plan", "code"],
    effort_range: ["xs", "s", "m"],
    caption: "recommended first workflow",
    tier: "starter",
    definition: DEFINITION,
    threshold: null,
    unlocked: true,
    ...overrides,
  };
}

const OFFERED = [
  template(),
  template({ slug: "feature-builder", version: 1, name: "Feature builder", caption: null }),
  template({
    slug: "deep-refactor",
    version: 1,
    name: "Deep refactor",
    caption: null,
    tier: "advanced",
    threshold: 10,
    unlocked: false,
  }),
];

/** A live instantiated workflow. */
function instantiated(overrides: Partial<InstantiatedWorkflowRow> = {}): InstantiatedWorkflowRow {
  return {
    id: "w-quick",
    slug: "quick-fixes",
    name: "Quick fixes",
    current_version: 1,
    template_slug: "quick-fixes",
    template_version: 3,
    ...overrides,
  };
}

/** Everything the service is built from. */
function harness(options: { workflows?: InstantiatedWorkflowRow[]; override?: number } = {}) {
  const state = { transactions: 0 };
  const tiles = {
    mergedLoops: jest.fn().mockResolvedValue(3),
    templates: jest.fn().mockResolvedValue(OFFERED),
    instantiatedWorkflows: jest.fn().mockResolvedValue(options.workflows ?? []),
  } as unknown as jest.Mocked<TemplateTilesRepository>;
  const onboarding = {
    state: jest.fn().mockResolvedValue({ selected_template: "quick-fixes" }),
    saveChoices: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<OnboardingRepository>;
  const wizard = {
    read: jest.fn().mockResolvedValue(WIZARD),
  } as unknown as jest.Mocked<OnboardingService>;
  const workflowsRepository = {
    slugFamily: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation((_org: string, input: { slug: string; name: string }) =>
      Promise.resolve({
        workflow: {
          id: "w-new",
          organization_id: WORKSPACE,
          slug: input.slug,
          name: input.name,
          status: "active",
          current_version: null,
          template_slug: "quick-fixes",
          template_version: 3,
          draft_rev: 0,
          provenance_summary: { canvas: 0, code: 0, copilot: 0, suggestion: 0 },
          created_at: AT,
          updated_at: AT,
        } satisfies Workflow,
        draft: {},
      }),
    ),
    publish: jest.fn().mockResolvedValue({
      id: "v1",
      workflow_id: "w-new",
      version: 1,
      definition: DEFINITION,
      published_at: AT,
      published_by: PERSON,
      change_note: "Instantiated from quick-fixes@v3.",
      edited_in: null,
      created_at: AT,
      updated_at: AT,
    } satisfies WorkflowVersion),
  } as unknown as jest.Mocked<WorkflowsRepository>;
  const gate = {
    check: jest.fn().mockResolvedValue({ findings: [], engineConsulted: true }),
  } as unknown as jest.Mocked<WorkflowPublishGate>;
  const database = {
    transaction: jest.fn(async (work: (trx: unknown) => Promise<unknown>) => {
      state.transactions += 1;
      return work({});
    }),
  } as unknown as DatabaseService;
  const workflows = new WorkflowsService(
    workflowsRepository,
    {} as WorkflowStatsService,
    gate,
    database,
  );
  const config = { onboardingUnlockThreshold: options.override } as AppConfigService;
  const service = new TemplateInstantiationService(tiles, onboarding, wizard, workflows, config);

  return {
    service,
    tiles,
    onboarding,
    wizard,
    workflowsRepository,
    gate,
    get transactions() {
      return state.transactions;
    },
  };
}

/** The envelope a call refuses with. */
async function refusal(
  call: Promise<unknown>,
): Promise<{ code: string; details: Record<string, unknown> }> {
  return call.then(
    () => {
      throw new Error("expected this call to be refused, and it resolved");
    },
    (error: unknown) =>
      (
        error as { getResponse(): { code: string; details: Record<string, unknown> } }
      ).getResponse(),
  );
}

describe("the tiles", () => {
  it("evaluates every gate against one merged count and the operator's override", async () => {
    const run = harness({ override: 5 });

    const tiles = await run.service.list(WORKSPACE, REPO);

    expect(run.tiles.templates).toHaveBeenCalledWith(WORKSPACE, 3, 5);
    expect(tiles.mergedLoops).toBe(3);
    expect(tiles.tiles.map((tile) => tile.slug)).toEqual([
      "quick-fixes",
      "feature-builder",
      "deep-refactor",
    ]);
  });

  it("marks the repository's active choice and links the studio", async () => {
    const tiles = await harness({ workflows: [instantiated()] }).service.list(WORKSPACE, REPO);

    expect(tiles).toMatchObject({
      repo: "acme-robotics/helios-firmware",
      selectedTemplate: "quick-fixes",
      studioPath: "/workflows",
    });
    expect(tiles.tiles[0]).toMatchObject({
      selected: true,
      workflow: { slug: "quick-fixes", studioPath: "/workflows/quick-fixes" },
    });
  });

  it("carries the locked tier's computed progress", async () => {
    const tiles = await harness().service.list(WORKSPACE, REPO);

    expect(tiles.tiles[2].unlock).toMatchObject({
      locked: true,
      progress: "3 of 10 merged loops",
    });
  });

  it("reads a repository nobody has onboarded as no choice", async () => {
    const run = harness();
    run.onboarding.state.mockResolvedValue(undefined);

    await expect(run.service.list(WORKSPACE, REPO)).resolves.toMatchObject({
      selectedTemplate: null,
    });
  });
});

describe("selecting a template", () => {
  it("instantiates it as a published v1 recording the template's slug and version", async () => {
    const run = harness();

    const selection = await run.service.select(WORKSPACE, REPO, "quick-fixes", PERSON);

    expect(run.workflowsRepository.create).toHaveBeenCalledWith(
      WORKSPACE,
      expect.objectContaining({
        slug: "quick-fixes",
        definition: DEFINITION,
        template: { slug: "quick-fixes", version: 3 },
      }),
      expect.anything(),
    );
    expect(run.workflowsRepository.publish).toHaveBeenCalledWith(
      "w-new",
      expect.objectContaining({ publishedBy: PERSON, definition: DEFINITION }),
      expect.anything(),
    );
    expect(selection).toEqual({
      created: true,
      workflow: {
        id: "w-new",
        slug: "quick-fixes",
        name: "Quick fixes",
        currentVersion: 1,
        templateSlug: "quick-fixes",
        templateVersion: 3,
        studioPath: "/workflows/quick-fixes",
      },
      kept: [],
      onboarding: WIZARD,
    });
  });

  it("makes the template the repository's active choice", async () => {
    const run = harness();

    await run.service.select(WORKSPACE, REPO, "quick-fixes", PERSON);

    expect(run.onboarding.saveChoices).toHaveBeenCalledWith(
      WORKSPACE,
      "acme-robotics/helios-firmware",
      { selected_template: "quick-fixes" },
    );
    expect(run.wizard.read).toHaveBeenCalledWith(WORKSPACE, "acme-robotics/helios-firmware");
  });

  it("runs the studio's publish gate over the definition — no wizard bypass", async () => {
    const run = harness();

    await run.service.select(WORKSPACE, REPO, "quick-fixes", PERSON);

    expect(run.gate.check).toHaveBeenCalledWith(WORKSPACE, DEFINITION);
  });

  it("surfaces a refused definition as a designed error and leaves nothing behind", async () => {
    const findings = [
      { source: "dsl" as const, code: "structure.no_terminal", message: "No terminal.", node: "x" },
    ];
    const run = harness();
    run.gate.check.mockResolvedValue({ findings, engineConsulted: false });

    const envelope = await refusal(run.service.select(WORKSPACE, REPO, "quick-fixes", PERSON));

    expect(envelope).toMatchObject({
      code: "onboarding_template_invalid",
      details: { slug: "quick-fixes", version: 3, findings },
    });
    expect(run.transactions).toBe(0);
    expect(run.workflowsRepository.create).not.toHaveBeenCalled();
    expect(run.onboarding.saveChoices).not.toHaveBeenCalled();
  });

  it("resolves a slug collision through the suffix flow", async () => {
    const run = harness();
    run.workflowsRepository.slugFamily.mockResolvedValue(["quick-fixes"]);

    const selection = await run.service.select(WORKSPACE, REPO, "quick-fixes", PERSON);

    expect(selection.workflow).toMatchObject({
      slug: "quick-fixes-2",
      name: "Quick fixes (2)",
      studioPath: "/workflows/quick-fixes-2",
    });
  });

  it("re-selection keeps the previous template's workflow and reports it", async () => {
    const previous = instantiated();
    const run = harness({ workflows: [previous] });

    const selection = await run.service.select(WORKSPACE, REPO, "feature-builder", PERSON);

    expect(selection.created).toBe(true);
    expect(selection.kept).toEqual([
      expect.objectContaining({ id: "w-quick", slug: "quick-fixes", templateSlug: "quick-fixes" }),
    ]);
    expect(run.onboarding.saveChoices).toHaveBeenCalledWith(WORKSPACE, expect.any(String), {
      selected_template: "feature-builder",
    });
  });

  it("reuses a template's live workflow rather than copying it again", async () => {
    const run = harness({ workflows: [instantiated()] });

    const selection = await run.service.select(WORKSPACE, REPO, "quick-fixes", PERSON);

    expect(selection.created).toBe(false);
    expect(selection.workflow.id).toBe("w-quick");
    expect(selection.kept).toEqual([]);
    expect(run.gate.check).not.toHaveBeenCalled();
    expect(run.workflowsRepository.create).not.toHaveBeenCalled();
  });

  it("refuses a locked tier with its progress, and creates nothing", async () => {
    const run = harness();

    const envelope = await refusal(run.service.select(WORKSPACE, REPO, "deep-refactor", PERSON));

    expect(envelope).toMatchObject({
      code: "onboarding_template_locked",
      details: { mergedLoops: 3, threshold: 10, progress: "3 of 10 merged loops" },
    });
    expect(run.workflowsRepository.create).not.toHaveBeenCalled();
  });

  it("instantiates an advanced tier once the evaluation opens it", async () => {
    const run = harness();
    run.tiles.templates.mockResolvedValue([
      template({ slug: "deep-refactor", tier: "advanced", threshold: 0, unlocked: true }),
    ]);

    await expect(
      run.service.select(WORKSPACE, REPO, "deep-refactor", PERSON),
    ).resolves.toMatchObject({ created: true });
  });

  it("refuses a slug the workspace is not offered, listing the offered ones", async () => {
    const envelope = await refusal(harness().service.select(WORKSPACE, REPO, "nope", PERSON));

    expect(envelope).toMatchObject({
      code: "onboarding_template_unknown",
      details: { offered: ["quick-fixes", "feature-builder", "deep-refactor"] },
    });
  });

  it("lets any other failure through as it came", async () => {
    const run = harness();
    run.workflowsRepository.publish.mockRejectedValue(new Error("connection reset"));

    await expect(run.service.select(WORKSPACE, REPO, "quick-fixes", PERSON)).rejects.toThrow(
      "connection reset",
    );
    expect(run.onboarding.saveChoices).not.toHaveBeenCalled();
  });

  it("copies the version it was given, so a later template version changes nothing made", async () => {
    // The definition is handed to the lifecycle by value from this one row; a v4 published
    // afterwards is a new row, and V068 forbids revising v3.
    const run = harness();

    await run.service.select(WORKSPACE, REPO, "quick-fixes", PERSON);

    expect(run.workflowsRepository.create).toHaveBeenCalledWith(
      WORKSPACE,
      expect.objectContaining({ template: { slug: "quick-fixes", version: 3 } }),
      expect.anything(),
    );
  });
});

describe("the module's own writes", () => {
  it("never writes workflows or workflow_versions — instantiation has one door", () => {
    const sources = readdirSync(__dirname).filter(
      (file) => file.endsWith(".ts") && !file.includes(".spec.") && !file.includes("-spec."),
    );
    const writes =
      /insertInto\("workflow(s|_versions)"\)|updateTable\("workflow(s|_versions)"\)|insert\s+into\s+ouroboros\.workflow(s|_versions)\b/i;

    for (const file of sources) {
      expect({ file, writes: writes.test(readFileSync(join(__dirname, file), "utf8")) }).toEqual({
        file,
        writes: false,
      });
    }
  });
});
