import { Logger } from "@nestjs/common";

import { FactsService } from "../facts/facts.service";
import { PROPOSER_REGISTRY, STEER_PROPOSER } from "./proposers.registry";
import { FactProposersService } from "./proposers.service";
import {
  CLASSIFICATION_ID,
  K_MSGQ_NOTE,
  ORDINARY_STEER_ID,
  OTHER_ORG,
  PROPOSER_ORG,
  PR_ID,
  ProposerWorld,
  REMEMBERED_STEER_ID,
  RUN_ID,
  WAIVER_ID,
} from "./proposers.store.fixture";
import {
  ProposerContractViolation,
  type FactCandidate,
  type ProposalOutcome,
  type ProposerDefinition,
} from "./proposers.types";

/**
 * BF.3's service (#412) over the real `FactsService` and an in-memory world keeping V071's and
 * V074's rules: promote → dedupe (any status, recorded) → propose, never confirm.
 */

const K_MSGQ_FACT = "Team prefers `k_msgq` over `k_fifo` in ISR paths";

/**
 * @param outcome - An outcome.
 * @param kind - The outcome it must be.
 * @returns It, narrowed.
 */
function expectOutcome<K extends ProposalOutcome["outcome"]>(
  outcome: ProposalOutcome,
  kind: K,
): Extract<ProposalOutcome, { outcome: K }> {
  expect(outcome.outcome).toBe(kind);
  return outcome as Extract<ProposalOutcome, { outcome: K }>;
}

describe("the fact proposers", () => {
  let world: ProposerWorld;
  let service: FactProposersService;

  beforeEach(() => {
    world = new ProposerWorld();
    service = world.service();
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe("a correction note", () => {
    it("becomes the mockup's k_msgq fact, awaiting review, citing run #1847 resolvably", async () => {
      world.withCorrectionNote();

      const outcome = expectOutcome(
        await service.proposeFrom(PROPOSER_ORG, {
          kind: "correction_note",
          id: CLASSIFICATION_ID,
        }),
        "proposed",
      );
      const fact = world.facts.find(outcome.factId);

      expect(fact).toMatchObject({
        text: K_MSGQ_FACT,
        status: "proposed",
        proposer: "correction_note",
        status_changed_by: null,
        repo_ref: "acme-robotics/helios-firmware",
      });
      // Resolvable: the store refuses a ref that is not a row of the workspace, as V071/V074 do.
      expect(fact.provenance).toEqual({
        line: "from correction note (run #1847)",
        refs: [
          { kind: "run", id: RUN_ID },
          { kind: "pull_request", id: PR_ID },
          { kind: "classification", id: CLASSIFICATION_ID },
        ],
      });
    });

    it("keeps its inline-code spans verbatim in the stored text", async () => {
      world.withCorrectionNote({ note: "keep   `K_NO_WAIT`  in the  `tel_msgq` put path." });

      const outcome = expectOutcome(
        await service.proposeFrom(PROPOSER_ORG, { kind: "correction_note", id: CLASSIFICATION_ID }),
        "proposed",
      );

      expect(world.facts.find(outcome.factId).text).toBe(
        "Keep `K_NO_WAIT` in the `tel_msgq` put path",
      );
    });

    it("is proposed once — a second pass answers already_proposed and writes nothing", async () => {
      world.withCorrectionNote();
      const first = expectOutcome(
        await service.proposeFrom(PROPOSER_ORG, { kind: "correction_note", id: CLASSIFICATION_ID }),
        "proposed",
      );

      const second = await service.proposeFrom(PROPOSER_ORG, {
        kind: "correction_note",
        id: CLASSIFICATION_ID,
      });

      expect(second).toEqual({
        outcome: "already_proposed",
        source: { kind: "classification", id: CLASSIFICATION_ID },
        factId: first.factId,
      });
      expect(world.facts.facts).toHaveLength(1);
      expect(world.suppressionRows).toHaveLength(0);
    });

    it("reads another workspace's classification as absent", async () => {
      world.withCorrectionNote();

      expect(
        await service.proposeFrom(OTHER_ORG, { kind: "correction_note", id: CLASSIFICATION_ID }),
      ).toEqual({
        outcome: "skipped",
        source: { kind: "classification", id: CLASSIFICATION_ID },
        reason: "source_not_found",
      });
      expect(world.facts.facts).toHaveLength(0);
    });
  });

  describe("dedupe", () => {
    it("suppresses a repeat of an existing fact and records the suppression", async () => {
      const existing = world.facts.seed(PROPOSER_ORG, "confirmed", {
        text: "team prefers k_msgq over k_fifo in ISR paths.",
        repo_ref: "acme-robotics/helios-firmware",
      });
      world.withCorrectionNote();

      const outcome = expectOutcome(
        await service.proposeFrom(PROPOSER_ORG, { kind: "correction_note", id: CLASSIFICATION_ID }),
        "suppressed",
      );

      expect(outcome.matchedFactId).toBe(existing.id);
      expect(world.facts.facts).toHaveLength(1);
      expect(world.suppressionRows).toEqual([
        expect.objectContaining({
          organization_id: PROPOSER_ORG,
          proposer: "correction_note",
          proposer_version: 1,
          text: K_MSGQ_FACT,
          // The shared key (BF.4's) folds inline markup, underscores included.
          normalized_text: "team prefers kmsgq over kfifo in isr paths",
          matched_fact_id: existing.id,
          source_key: `classification:${CLASSIFICATION_ID}`,
        }),
      ]);
    });

    it("suppresses against a previously rejected fact — a rejection does not come back", async () => {
      const rejected = world.facts.seed(PROPOSER_ORG, "rejected", { text: K_MSGQ_FACT });
      world.withCorrectionNote();

      const outcome = expectOutcome(
        await service.proposeFrom(PROPOSER_ORG, { kind: "correction_note", id: CLASSIFICATION_ID }),
        "suppressed",
      );

      expect(outcome.matchedFactId).toBe(rejected.id);
      expect(world.facts.find(rejected.id).status).toBe("rejected");
    });

    it.each(["expired", "stale", "proposed"] as const)(
      "suppresses against a %s fact too",
      async (status) => {
        world.facts.seed(PROPOSER_ORG, status, { text: K_MSGQ_FACT });
        world.withCorrectionNote();

        expectOutcome(
          await service.proposeFrom(PROPOSER_ORG, {
            kind: "correction_note",
            id: CLASSIFICATION_ID,
          }),
          "suppressed",
        );
      },
    );

    it("records one suppression per source and fact, however often it runs", async () => {
      world.facts.seed(PROPOSER_ORG, "rejected", { text: K_MSGQ_FACT });
      world.withCorrectionNote();
      const ref = { kind: "correction_note" as const, id: CLASSIFICATION_ID };

      const first = expectOutcome(await service.proposeFrom(PROPOSER_ORG, ref), "suppressed");
      const second = expectOutcome(await service.proposeFrom(PROPOSER_ORG, ref), "suppressed");

      expect(second.suppressionId).toBe(first.suppressionId);
      expect(world.suppressionRows).toHaveLength(1);
    });

    it("does not match another repository's fact", async () => {
      world.facts.seed(PROPOSER_ORG, "confirmed", {
        text: K_MSGQ_FACT,
        repo_ref: "acme-robotics/other-firmware",
      });
      world.withCorrectionNote();

      expectOutcome(
        await service.proposeFrom(PROPOSER_ORG, { kind: "correction_note", id: CLASSIFICATION_ID }),
        "proposed",
      );
    });

    it("does not match another workspace's fact", async () => {
      world.facts.seed(OTHER_ORG, "confirmed", { text: K_MSGQ_FACT });
      world.withCorrectionNote();

      expectOutcome(
        await service.proposeFrom(PROPOSER_ORG, { kind: "correction_note", id: CLASSIFICATION_ID }),
        "proposed",
      );
    });
  });

  describe("a waiver", () => {
    it("becomes an environment-class fact citing its gate and PR", async () => {
      world.withWaiver("The HIL rig's power supply browns out under load; ignore brown-out cases.");

      const outcome = expectOutcome(
        await service.proposeFrom(PROPOSER_ORG, { kind: "waiver", id: WAIVER_ID }),
        "proposed",
      );

      expect(outcome.candidate.category).toBe("environment");
      expect(world.facts.find(outcome.factId)).toMatchObject({
        status: "proposed",
        proposer: "waiver",
        text: "The HIL rig's power supply browns out under load",
      });
      expect(outcome.candidate.provenance.refs.map((ref) => ref.kind)).toEqual([
        "run",
        "pull_request",
        "gate",
        "waiver",
      ]);
    });
  });

  describe("a steer", () => {
    it("without remember this produces nothing", async () => {
      world.withSteer(ORDINARY_STEER_ID, "Retry the flash with the slower clock.", false);

      expect(
        await service.proposeFrom(PROPOSER_ORG, { kind: "steer", id: ORDINARY_STEER_ID }),
      ).toEqual({
        outcome: "skipped",
        source: { kind: "steer", id: ORDINARY_STEER_ID },
        reason: "not_remembered",
      });
      expect(world.facts.facts).toHaveLength(0);
      expect(world.suppressionRows).toHaveLength(0);
    });

    it("with remember this produces a candidate", async () => {
      world.withSteer(
        REMEMBERED_STEER_ID,
        "Always run `west update` before the first build.",
        true,
      );

      const outcome = expectOutcome(
        await service.proposeFrom(PROPOSER_ORG, { kind: "steer", id: REMEMBERED_STEER_ID }),
        "proposed",
      );

      expect(world.facts.find(outcome.factId)).toMatchObject({
        status: "proposed",
        proposer: "steer",
        text: "Always run `west update` before the first build",
      });
    });
  });

  describe("no proposer path lands anything but proposed", () => {
    it("writes through FactsService.propose only, with no actor, for every registry entry", async () => {
      const facts = world.factsService();
      const propose = jest.spyOn(facts, "propose");
      const lifecycle = (["confirm", "reject", "reconfirm", "expire", "relearn"] as const).map(
        (method) => jest.spyOn(facts, method),
      );
      service = world.service(facts);
      world
        .withCorrectionNote()
        .withWaiver("The CI runner lacks the ARM toolchain.")
        .withSteer(REMEMBERED_STEER_ID, "Keep PID gains in `config/control.yaml`.", true);

      const outcomes = await service.backfillRun(PROPOSER_ORG, RUN_ID);

      expect(outcomes.map((outcome) => outcome.outcome)).toEqual([
        "proposed",
        "proposed",
        "proposed",
      ]);
      expect(propose).toHaveBeenCalledTimes(3);
      for (const [, input, actor] of propose.mock.calls) {
        expect(Object.keys(input).sort()).toEqual(["proposer", "provenance", "repoRef", "text"]);
        expect(actor).toBeNull();
      }
      for (const method of lifecycle) expect(method).not.toHaveBeenCalled();
      expect(world.facts.facts.map((fact) => fact.status)).toEqual([
        "proposed",
        "proposed",
        "proposed",
      ]);
      expect(world.facts.transitions.map((row) => row.to_status)).toEqual([
        "proposed",
        "proposed",
        "proposed",
      ]);
    });

    it("refuses a rogue proposer that returns a status, and writes nothing", async () => {
      const rogue: ProposerDefinition<null> = {
        ...STEER_PROPOSER,
        propose: () => ({
          kind: "candidate",
          candidate: {
            text: "Confirm me without review",
            repoRef: null,
            proposer: "steer",
            proposerVersion: 1,
            category: "instruction",
            confidence: null,
            provenance: { line: "rogue", refs: [] },
            source: { kind: "steer", id: REMEMBERED_STEER_ID },
            status: "confirmed",
          } as FactCandidate,
        }),
      };

      await expect(
        service.propose(PROPOSER_ORG, rogue, null, { kind: "steer", id: REMEMBERED_STEER_ID }),
      ).rejects.toThrow(ProposerContractViolation);
      expect(world.facts.facts).toHaveLength(0);
    });
  });

  describe("adding a proposer", () => {
    it("needs only a registry entry — the lifecycle service is untouched", async () => {
      // A proposer nobody has written yet, run through the same generic path.
      const incident: ProposerDefinition<{ note: string }> = {
        kind: "correction_note",
        version: 1,
        trigger: "an incident review is closed",
        source: "incident notes",
        extraction: "the note verbatim",
        provenanceShape: ["run"],
        propose: (source) => ({
          kind: "candidate",
          candidate: {
            text: source.note,
            repoRef: null,
            proposer: "correction_note",
            proposerVersion: 1,
            category: "convention",
            confidence: null,
            provenance: { line: "from incident review", refs: [{ kind: "run", id: RUN_ID }] },
            source: { kind: "classification", id: "incident-1" },
          },
        }),
      };

      const outcome = expectOutcome(
        await service.propose(
          PROPOSER_ORG,
          incident,
          { note: "Power-cycle the rig after a brown-out" },
          { kind: "classification", id: "incident-1" },
        ),
        "proposed",
      );

      expect(world.facts.find(outcome.factId).status).toBe("proposed");
      expect(Object.getOwnPropertyNames(FactsService.prototype)).toContain("propose");
    });
  });

  describe("the source observer", () => {
    it("never throws — a proposer failure is logged, not the source writer's error", async () => {
      const facts = world.factsService();
      jest.spyOn(facts, "propose").mockRejectedValue(new Error("database gone"));
      service = world.service(facts);
      world.withCorrectionNote();

      await expect(
        service.sourceWritten(PROPOSER_ORG, { kind: "correction_note", id: CLASSIFICATION_ID }),
      ).resolves.toBeUndefined();
      expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it("proposes on a report", async () => {
      world.withCorrectionNote();

      await service.sourceWritten(PROPOSER_ORG, { kind: "correction_note", id: CLASSIFICATION_ID });

      expect(world.facts.facts.map((fact) => fact.text)).toEqual([K_MSGQ_FACT]);
    });
  });

  describe("the backfill", () => {
    it("runs every source of a run, oldest first, and is idempotent", async () => {
      world
        .withCorrectionNote()
        .withWaiver("Rig 2's chamber is out for calibration.")
        .withSteer(REMEMBERED_STEER_ID, "Always run `west update` first.", true);

      const first = await service.backfillRun(PROPOSER_ORG, RUN_ID);
      const second = await service.backfillRun(PROPOSER_ORG, RUN_ID);

      expect(first.map((outcome) => [outcome.outcome, outcome.source.kind])).toEqual([
        ["proposed", "classification"],
        ["proposed", "waiver"],
        ["proposed", "steer"],
      ]);
      expect(second.map((outcome) => outcome.outcome)).toEqual([
        "already_proposed",
        "already_proposed",
        "already_proposed",
      ]);
      expect(world.facts.facts).toHaveLength(3);
    });

    it("answers 404 run_not_found for another workspace's run", async () => {
      await expect(service.backfillRun(OTHER_ORG, RUN_ID)).rejects.toMatchObject({
        code: "run_not_found",
      });
    });
  });

  describe("the suppressions read", () => {
    it("serves them newest first, bounded", async () => {
      world.facts.seed(PROPOSER_ORG, "rejected", { text: K_MSGQ_FACT });
      world.withCorrectionNote();
      await service.proposeFrom(PROPOSER_ORG, { kind: "correction_note", id: CLASSIFICATION_ID });

      const [suppression] = await service.suppressions(PROPOSER_ORG, 500);

      expect(suppression).toMatchObject({
        proposer: "correction_note",
        proposerVersion: 1,
        text: K_MSGQ_FACT,
        sourceKey: `classification:${CLASSIFICATION_ID}`,
        provenance: { line: "from correction note (run #1847)" },
      });
      expect(await service.suppressions(OTHER_ORG, 10)).toEqual([]);
    });
  });

  it("registers every loadable kind", () => {
    expect(PROPOSER_REGISTRY.correction_note.kind).toBe("correction_note");
    expect(K_MSGQ_NOTE.startsWith(K_MSGQ_FACT)).toBe(true);
  });
});
