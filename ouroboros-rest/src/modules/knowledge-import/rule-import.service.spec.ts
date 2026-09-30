/**
 * `RuleImportService` ([#413](https://github.com/NobuData/ouroboros/issues/413)) — preview and
 * apply over an in-memory workspace: everything gated, preview equal to apply, re-import a no-op,
 * the delta of a changed file, the stale check, atomicity, audit, and the host's refusals.
 */

import { KNOWLEDGE_IMPORTED_EVENT } from "../audit/audit.events";
import { ConflictError, type DomainError } from "../errors/error.envelope";
import { DETECTION_ERRORS } from "../detection/detection.errors";
import { sourceMissing } from "../detection/detection.errors";
import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import { MAX_IMPORT_FACTS, RULE_IMPORT_ERRORS } from "./rule-import.errors";
import { CLAUDE_MD, CURSORRULES, IMPORT_REPO } from "./rule-import.fixture";
import { RuleImportService } from "./rule-import.service";
import {
  FixtureReader,
  IMPORT_ACTOR,
  IMPORT_WORKSPACE,
  ImportWorld,
  RecordingAudit,
} from "./rule-import.store.fixture";

/** When the suite applies. */
const NOW = new Date("2026-09-29T09:00:00Z");

/**
 * A service over a fresh world.
 *
 * @param files - The repository's files.
 * @returns The service and its world.
 */
function build(
  files: Record<string, string> = { "CLAUDE.md": CLAUDE_MD, ".cursorrules": CURSORRULES },
) {
  const world = new ImportWorld();
  const reader = new FixtureReader(files);
  const audit = new RecordingAudit();
  const service = new RuleImportService(
    world.store(),
    world.skills(),
    world.facts(),
    world.database(),
    reader,
    audit,
  );

  return { world, reader, audit, service };
}

/**
 * Preview, then apply with the preview's fingerprint.
 *
 * @param service - The service.
 * @returns Both answers.
 */
async function previewAndApply(service: RuleImportService) {
  const preview = await service.preview(IMPORT_WORKSPACE, IMPORT_REPO);
  const result = await service.apply(
    IMPORT_WORKSPACE,
    IMPORT_REPO,
    preview.fingerprint,
    IMPORT_ACTOR,
    NOW,
  );

  return { preview, result };
}

/**
 * The error a promise rejects with.
 *
 * @param promise - The call.
 * @returns The error.
 */
async function refusal(promise: Promise<unknown>): Promise<DomainError> {
  return promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error as DomainError,
  );
}

describe("the preview", () => {
  it("counts and samples per file and kind, deduped included, and writes nothing", async () => {
    const { service, world, audit } = build();
    const preview = await service.preview(IMPORT_WORKSPACE, "Acme-Robotics/Helios-Firmware");

    expect(preview.repo).toBe(IMPORT_REPO);
    expect(preview.totals).toEqual({
      filesFound: 2,
      skillDrafts: 4,
      skillUpdates: 0,
      factCandidates: 13,
      dedupedSkills: 0,
      dedupedFacts: 2,
    });
    expect(
      preview.files.map((file) => [
        file.path,
        file.found,
        file.skills.planned,
        file.facts.planned,
        file.facts.deduped,
      ]),
    ).toEqual([
      ["CLAUDE.md", true, 3, 7, 0],
      ["AGENTS.md", false, 0, 0, 0],
      [".cursorrules", true, 1, 6, 2],
      [".github/copilot-instructions.md", false, 0, 0, 0],
    ]);
    expect(preview.files[0].skills.samples[0]).toEqual({
      action: "create",
      slug: "kconfig",
      name: "Kconfig",
      description:
        "Every feature is gated behind a Kconfig symbol, declared in the module that owns it.",
      section: "Kconfig",
    });
    expect(preview.files[0].facts.samples).toHaveLength(5);
    expect(preview.files[0].facts.samples[1]).toEqual({
      text: "Use `CONFIG_HELIOS_` as the prefix for every new symbol.",
      section: "Kconfig",
      provenance: {
        line: "imported from CLAUDE.md",
        refs: [{ kind: "import", file: "CLAUDE.md", section: "Kconfig" }],
      },
    });
    expect(world.tables).toEqual({ skills: [], facts: [] });
    expect(audit.events).toEqual([]);
  });

  it("is an honest empty result for a repository with no rules files", async () => {
    const { service, reader } = build({});
    const preview = await service.preview(IMPORT_WORKSPACE, IMPORT_REPO);

    expect(reader.reads).toEqual([
      {
        repo: IMPORT_REPO,
        paths: ["CLAUDE.md", "AGENTS.md", ".cursorrules", ".github/copilot-instructions.md"],
      },
    ]);
    expect(preview.totals).toEqual({
      filesFound: 0,
      skillDrafts: 0,
      skillUpdates: 0,
      factCandidates: 0,
      dedupedSkills: 0,
      dedupedFacts: 0,
    });
    expect(preview.files.every((file) => !file.found && file.sizeBytes === 0)).toBe(true);
  });

  it("dedupes against the repository's and the workspace's facts, not another repository's", async () => {
    const { service, world } = build();

    world.addFact("Keep functions under 60 lines", IMPORT_REPO, "rejected");
    world.addFact("Name threads after their subsystem.", null);
    world.addFact("Document every public API in its header.", "acme-robotics/other");

    const preview = await service.preview(IMPORT_WORKSPACE, IMPORT_REPO);

    expect(preview.files[2].facts).toMatchObject({ planned: 4, deduped: 4 });
  });

  it("refuses a plan past the per-import cap", async () => {
    const bullets = Array.from(
      { length: MAX_IMPORT_FACTS + 1 },
      (_, i) => `- Use rule ${String(i)}.`,
    );
    const { service } = build({ ".cursorrules": bullets.join("\n") });
    const error = await refusal(service.preview(IMPORT_WORKSPACE, IMPORT_REPO));

    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toMatchObject({
      code: RULE_IMPORT_ERRORS.tooLarge,
      details: { facts: MAX_IMPORT_FACTS + 1 },
    });
  });

  it("marks a file the probe cut short", async () => {
    const { service, reader } = build();

    reader.readFiles = (_org, _repo, paths) =>
      Promise.resolve(
        new Map(
          paths.map((path) => [
            path,
            path === "CLAUDE.md" ? { path, content: CLAUDE_MD, size: 300 * 1024 } : null,
          ]),
        ),
      );

    const preview = await service.preview(IMPORT_WORKSPACE, IMPORT_REPO);

    expect(preview.files[0]).toMatchObject({ truncated: true, sizeBytes: 300 * 1024 });
  });
});

describe("the apply", () => {
  it("creates every skill as a draft, origin imported, scoped to the repository", async () => {
    const { service, world } = build();

    await previewAndApply(service);

    expect(world.tables.skills.map((skill) => skill.slug)).toEqual([
      "kconfig",
      "devicetree",
      "isr-safety",
      "cursorrules",
    ]);

    for (const skill of world.tables.skills) {
      expect(skill).toMatchObject({
        organizationId: IMPORT_WORKSPACE,
        origin: "imported",
        draft: true,
        scope: "repo",
        repoRef: IMPORT_REPO,
      });
      // One unpublished draft version — nothing a run could be handed.
      expect(skill.versions.map((version) => version.version)).toEqual([null]);
    }

    expect(world.tables.skills[0].versions[0].frontmatter).toEqual({
      name: "Kconfig",
      description:
        "Every feature is gated behind a Kconfig symbol, declared in the module that owns it.",
      scope: "repo",
      provenance: { source: "CLAUDE.md", section: "Kconfig" },
    });
    expect(world.tables.skills[3].versions[0].frontmatter).toMatchObject({
      provenance: { source: ".cursorrules" },
    });
  });

  it("creates every fact proposed, proposer import, with {file, section} provenance", async () => {
    const { service, world } = build();

    await previewAndApply(service);

    expect(world.tables.facts).toHaveLength(13);

    for (const fact of world.tables.facts) {
      expect(fact).toMatchObject({
        organizationId: IMPORT_WORKSPACE,
        repoRef: IMPORT_REPO,
        status: "proposed",
        proposer: "import",
        actorId: IMPORT_ACTOR,
      });
    }

    expect(world.tables.facts[0].provenance).toEqual({
      line: "imported from CLAUDE.md",
      refs: [{ kind: "import", file: "CLAUDE.md" }],
    });
    expect(world.tables.facts[1].provenance).toEqual({
      line: "imported from CLAUDE.md",
      refs: [{ kind: "import", file: "CLAUDE.md", section: "Kconfig" }],
    });
  });

  it("writes exactly what the preview showed", async () => {
    const { service, world } = build();
    const { preview, result } = await previewAndApply(service);
    const { created, ...shown } = result;

    expect(shown).toEqual(preview);
    expect(created.skills).toEqual(
      preview.files.flatMap((file) =>
        file.skills.samples.map((sample) => ({ slug: sample.slug, action: sample.action })),
      ),
    );
    expect(created.skills).toHaveLength(preview.totals.skillDrafts + preview.totals.skillUpdates);
    expect(created.facts).toHaveLength(preview.totals.factCandidates);
    expect(created.facts.map((fact) => fact.id)).toEqual(world.tables.facts.map((fact) => fact.id));
    expect(world.tables.facts.map((fact) => fact.text)).toEqual(
      created.facts.map((fact) => fact.text),
    );
  });

  it("audits the actor and what was created, once, after the write", async () => {
    const { service, audit } = build();
    const { preview } = await previewAndApply(service);

    expect(audit.events).toEqual([
      {
        organizationId: IMPORT_WORKSPACE,
        actorId: IMPORT_ACTOR,
        action: KNOWLEDGE_IMPORTED_EVENT,
        subjectType: "repository",
        subjectId: IMPORT_REPO,
        at: NOW,
        detail: {
          repo: IMPORT_REPO,
          fingerprint: preview.fingerprint,
          files_found: 2,
          skill_drafts: 4,
          skill_updates: 0,
          fact_candidates: 13,
          deduped_skills: 0,
          deduped_facts: 2,
          skill_slugs: "kconfig,devicetree,isr-safety,cursorrules",
        },
      },
    ]);
  });

  it("takes the repository's apply lock", async () => {
    const { service, world } = build();

    await previewAndApply(service);

    expect(world.locks).toEqual([`${IMPORT_WORKSPACE}:${IMPORT_REPO}`]);
  });
});

describe("re-importing", () => {
  it("is a no-op when nothing changed", async () => {
    const { service, world } = build();

    await previewAndApply(service);

    const before = structuredClone(world.tables);
    const { preview, result } = await previewAndApply(service);

    expect(preview.totals).toEqual({
      filesFound: 2,
      skillDrafts: 0,
      skillUpdates: 0,
      factCandidates: 0,
      dedupedSkills: 4,
      dedupedFacts: 15,
    });
    expect(result.created).toEqual({ skills: [], facts: [] });
    expect(world.tables).toEqual(before);
  });

  it("surfaces only the delta of a changed file — a draft version and the new fact", async () => {
    const { service, world, reader } = build();

    await previewAndApply(service);

    // A person promotes `kconfig`: published v1, out of draft, enabled.
    const kconfig = world.tables.skills[0];

    kconfig.draft = false;
    kconfig.versions[0].version = 1;

    reader.files["CLAUDE.md"] = CLAUDE_MD.replace(
      "- Never enable `CONFIG_ASSERT` in release builds.",
      "- Never enable `CONFIG_ASSERT` in release builds.\n- Mark every symbol `depends on`.",
    );

    const { result } = await previewAndApply(service);

    expect(result.totals).toMatchObject({ skillDrafts: 0, skillUpdates: 1, factCandidates: 1 });
    expect(result.created.skills).toEqual([{ slug: "kconfig", action: "update" }]);
    expect(result.created.facts.map((fact) => fact.text)).toEqual([
      "Mark every symbol `depends on`.",
    ]);

    // Still gated: the published version in force is untouched; the change waits as a draft.
    const after = world.tables.skills[0];

    expect(after.versions.map((version) => version.version)).toEqual([1, null]);
    expect(after.versions[0].body).not.toContain("depends on");
    expect(after.versions[1].body).toContain("depends on");
    expect(world.tables.facts.at(-1)).toMatchObject({ status: "proposed", proposer: "import" });
  });

  it("overwrites an imported skill's pending draft rather than adding a second", async () => {
    const { service, world, reader } = build();

    await previewAndApply(service);
    reader.files["CLAUDE.md"] = CLAUDE_MD.replace("never block", "not block");
    await previewAndApply(service);

    const isr = world.tables.skills[2];

    expect(isr.versions).toHaveLength(1);
    expect(isr.versions[0].body).toContain("not block");
  });
});

describe("a stale preview", () => {
  it("is refused when a file changed after the preview, and nothing is written", async () => {
    const { service, world, reader, audit } = build();
    const preview = await service.preview(IMPORT_WORKSPACE, IMPORT_REPO);

    reader.files[".cursorrules"] = `${CURSORRULES}\n- Use one more rule.`;

    const error = await refusal(
      service.apply(IMPORT_WORKSPACE, IMPORT_REPO, preview.fingerprint, IMPORT_ACTOR, NOW),
    );

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.getResponse()).toMatchObject({
      code: RULE_IMPORT_ERRORS.previewStale,
      details: { repo: IMPORT_REPO, expected: preview.fingerprint },
    });
    expect(world.tables).toEqual({ skills: [], facts: [] });
    expect(audit.events).toEqual([]);
  });

  it("is refused when the workspace changed after the preview", async () => {
    const { service, world } = build();
    const preview = await service.preview(IMPORT_WORKSPACE, IMPORT_REPO);

    world.addSkill("kconfig");

    const error = await refusal(
      service.apply(IMPORT_WORKSPACE, IMPORT_REPO, preview.fingerprint, IMPORT_ACTOR, NOW),
    );

    expect(error.getResponse()).toMatchObject({ code: RULE_IMPORT_ERRORS.previewStale });
    expect(world.tables.facts).toEqual([]);
  });

  it("is refused when a slug is taken between the read and the insert", async () => {
    const { world, reader, audit } = build();
    const store = world.store();
    const service = new RuleImportService(
      {
        // The baseline misses the slug a concurrent + New skill takes.
        baseline: async (org, repo, trx) => ({
          ...(await store.baseline(org, repo, trx)),
          slugs: new Set<string>(),
        }),
        lockRepo: store.lockRepo,
      },
      world.skills(),
      world.facts(),
      world.database(),
      reader,
      audit,
    );

    world.addSkill("devicetree");

    const preview = await service.preview(IMPORT_WORKSPACE, IMPORT_REPO);
    const error = await refusal(
      service.apply(IMPORT_WORKSPACE, IMPORT_REPO, preview.fingerprint, IMPORT_ACTOR, NOW),
    );

    expect(error.getResponse()).toMatchObject({
      code: RULE_IMPORT_ERRORS.previewStale,
      details: { actual: "slug_taken" },
    });
    expect(world.tables.skills.map((skill) => skill.slug)).toEqual(["devicetree"]);
  });
});

describe("a failure mid-apply", () => {
  it("writes nothing and audits nothing", async () => {
    const { service, world, audit } = build();

    world.failFactInsertAt = 3;

    await expect(previewAndApply(service)).rejects.toThrow("the connection dropped");
    expect(world.tables).toEqual({ skills: [], facts: [] });
    expect(audit.events).toEqual([]);
  });
});

describe("the host's refusals", () => {
  it("passes detection's source-missing refusal through", async () => {
    const { service, reader } = build();

    reader.failure = sourceMissing(IMPORT_REPO);

    const error = await refusal(service.preview(IMPORT_WORKSPACE, IMPORT_REPO));

    expect(error.getResponse()).toMatchObject({ code: DETECTION_ERRORS.sourceMissing });
  });

  it("answers a rate limit with 429", async () => {
    const { service, reader } = build();

    reader.failure = new TicketSourceError("rate_limit", "budget at the floor");

    const error = await refusal(service.preview(IMPORT_WORKSPACE, IMPORT_REPO));

    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toMatchObject({ code: RULE_IMPORT_ERRORS.rateLimited });
  });

  it("answers any other refusal with 502, naming its class and not the host's words", async () => {
    const { service, reader } = build();

    reader.failure = new TicketSourceError("upstream", "GitHub answered 502 with a secret");

    const error = await refusal(
      service.apply(IMPORT_WORKSPACE, IMPORT_REPO, "0".repeat(64), IMPORT_ACTOR),
    );

    expect(error.getStatus()).toBe(502);
    expect(error.getResponse()).toMatchObject({
      code: RULE_IMPORT_ERRORS.sourceFailed,
      details: { errorClass: "upstream" },
    });
    expect(JSON.stringify(error.getResponse())).not.toContain("secret");
  });

  it("lets anything else through untouched", async () => {
    const { service, reader } = build();

    reader.failure = new Error("boom");

    await expect(service.preview(IMPORT_WORKSPACE, IMPORT_REPO)).rejects.toThrow("boom");
  });
});
