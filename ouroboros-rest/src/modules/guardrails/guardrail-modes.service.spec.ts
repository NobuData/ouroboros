import { WORKSPACE_GUARDRAIL_MODES_CHANGED_EVENT } from "../audit/audit.events";
import type { DatabaseService } from "../db/db.service";
import type { GuardrailCheck, GuardrailMode } from "../db/schema";
import { completeModes, GuardrailModesService, modesDetail } from "./guardrail-modes.service";
import type { GuardrailsRepository } from "./guardrails.repository";

/**
 * `GET`/`PATCH /api/v1/settings/guardrails` behind the routes (AR.1, #315): a check never chosen
 * is `block`, a patch is partial, and only a mode that moved is stored and audited.
 */

const ORG = "org-acme";
const USER = "user-maya";
const NOW = Date.parse("2026-10-15T12:00:00.000Z");

/** The service over a stored map. */
function service(stored: Partial<Record<GuardrailCheck, GuardrailMode>> = {}) {
  const db = { tag: "db" };
  const repository = {
    modes: jest.fn().mockResolvedValue(stored),
    saveModes: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  return {
    db,
    repository,
    audit,
    subject: new GuardrailModesService(
      { db } as unknown as DatabaseService,
      repository as unknown as GuardrailsRepository,
      audit,
      () => NOW,
    ),
  };
}

describe("completeModes", () => {
  it("answers all four checks in the card's order, block where nothing is stored", () => {
    expect(Object.entries(completeModes({ secrets: "warn" }))).toEqual([
      ["allowed_paths", "block"],
      ["ci_config", "block"],
      ["secrets", "warn"],
      ["review_required", "block"],
    ]);
  });
});

describe("modesDetail", () => {
  it("flattens the map for the audit detail", () => {
    expect(modesDetail(completeModes({ review_required: "warn" }))).toBe(
      "allowed_paths=block,ci_config=block,secrets=block,review_required=warn",
    );
  });
});

describe("GuardrailModesService", () => {
  it("reads every check as block for a workspace that never chose", async () => {
    const { subject, repository, db } = service();

    await expect(subject.read(ORG)).resolves.toEqual({
      modes: {
        allowed_paths: "block",
        ci_config: "block",
        secrets: "block",
        review_required: "block",
      },
    });
    expect(repository.modes).toHaveBeenCalledWith(db, ORG);
  });

  it("reads a stored warn as warn", async () => {
    const { subject } = service({ secrets: "warn" });

    expect((await subject.read(ORG)).modes.secrets).toBe("warn");
  });

  it("stores only the checks a patch moved, audits before and after, and answers the whole map", async () => {
    const { subject, repository, audit, db } = service({ ci_config: "warn" });

    const answer = await subject.update(
      ORG,
      { secrets: "warn", ci_config: "warn", review_required: "block" },
      USER,
    );

    expect(answer).toEqual({
      modes: {
        allowed_paths: "block",
        ci_config: "warn",
        secrets: "warn",
        review_required: "block",
      },
    });
    // ci_config and review_required already had the asked mode: only secrets moved.
    expect(repository.saveModes).toHaveBeenCalledWith(db, ORG, { secrets: "warn" }, USER);
    expect(audit.record).toHaveBeenCalledWith({
      organizationId: ORG,
      actorId: USER,
      action: WORKSPACE_GUARDRAIL_MODES_CHANGED_EVENT,
      subjectType: "workspace",
      subjectId: ORG,
      at: new Date(NOW),
      detail: {
        changed: "secrets",
        before: "allowed_paths=block,ci_config=warn,secrets=block,review_required=block",
        after: "allowed_paths=block,ci_config=warn,secrets=warn,review_required=block",
      },
    });
  });

  it("names every check that moved, in the card's order", async () => {
    const { subject, audit } = service({ secrets: "warn" });

    await subject.update(ORG, { secrets: "block", allowed_paths: "warn" }, USER);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ changed: "allowed_paths,secrets" }) as unknown,
      }),
    );
  });

  it("writes nothing and audits nothing when no mode moved", async () => {
    const { subject, repository, audit } = service({ secrets: "warn" });

    await expect(subject.update(ORG, { secrets: "warn" }, USER)).resolves.toEqual({
      modes: completeModes({ secrets: "warn" }),
    });
    await subject.update(ORG, {}, USER);

    expect(repository.saveModes).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
