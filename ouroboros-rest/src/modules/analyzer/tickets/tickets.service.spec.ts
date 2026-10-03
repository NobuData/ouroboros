import type { BatchesService } from "../../planning/batches.service";
import type { BatchResource } from "../../planning/planning.resources";
import { resolvedEvidence } from "../duration/duration.fixture";
import type { EvidenceRepository } from "../evidence/evidence.repository";
import type { ComposedRun, SuggestionsRepository } from "../suggestions/suggestions.repository";
import {
  BATCH_ID,
  BUILD_ID,
  HELIOS,
  seededBatch,
  undraftedRow,
  WAIVER_ID,
} from "./tickets.fixture";
import type { TicketsRepository, UndraftedTicketRow } from "./tickets.repository";
import { TicketsService } from "./tickets.service";

/**
 * The drafted-tickets card's read (BW.4, #519) over stand-ins: batches come from planning's own
 * service, the workspace scopes every read, and only the references the card answers are
 * resolved. Which suggestions are current is the statements', and the integration suite's to
 * prove.
 */

/** The workspace asking. */
const ORG = "org-acme";

/** The analysis that composed the fixtures' suggestions. */
const RUN: ComposedRun = {
  id: "5eed0065-0000-4000-8000-000000000002",
  finished_at: new Date("2026-08-08T10:41:00Z"),
};

/** How the stand-ins answer. */
interface World {
  /** The newest ended analysis that composed a suggestion; `null` for none yet. */
  run?: ComposedRun | null;
  undrafted?: UndraftedTicketRow[];
  batches?: BatchResource[];
}

/**
 * The service over stand-ins.
 *
 * @param world - What they answer.
 * @returns The service and the stand-ins, to assert what was asked of them.
 */
function build(world: World = {}) {
  const stored = world.batches ?? [];
  const reads = {
    undrafted: jest.fn(() => Promise.resolve(world.undrafted ?? [])),
    batchIds: jest.fn(() => Promise.resolve(stored.map((batch) => batch.id))),
  };
  const suggestions = {
    composedRun: jest.fn(() =>
      Promise.resolve(world.run === null ? undefined : (world.run ?? RUN)),
    ),
  };
  const batches = {
    read: jest.fn((_org: string, id: string) => {
      const found = stored.find((batch) => batch.id === id);

      return found === undefined
        ? Promise.reject(new Error(`no batch ${id}`))
        : Promise.resolve(found);
    }),
  };
  const evidence = {
    resolve: jest.fn(() =>
      Promise.resolve(
        resolvedEvidence({ builds: [{ id: BUILD_ID, number: 412, label: "zephyr build" }] }),
      ),
    ),
  };

  return {
    service: new TicketsService(
      reads as unknown as TicketsRepository,
      suggestions as unknown as SuggestionsRepository,
      batches as unknown as BatchesService,
      evidence as unknown as EvidenceRepository,
    ),
    reads,
    suggestions,
    batches,
    evidence,
  };
}

describe("reading the drafted-tickets card", () => {
  it("answers an empty card for a repository no analysis has composed a ticket for", async () => {
    const { service, batches } = build();

    await expect(service.list(ORG, HELIOS)).resolves.toEqual({
      repo: HELIOS,
      undrafted: [],
      batches: [],
    });
    expect(batches.read).not.toHaveBeenCalled();
  });

  it("reads nothing before an analysis has ended having composed a suggestion", async () => {
    const { service, suggestions, reads, batches, evidence } = build({
      run: null,
      undrafted: [undraftedRow()],
      batches: [seededBatch()],
    });

    await expect(service.list(ORG, HELIOS)).resolves.toEqual({
      repo: HELIOS,
      undrafted: [],
      batches: [],
    });
    expect(suggestions.composedRun).toHaveBeenCalledWith(ORG, HELIOS);
    expect(reads.undrafted).not.toHaveBeenCalled();
    expect(reads.batchIds).not.toHaveBeenCalled();
    expect(batches.read).not.toHaveBeenCalled();
    expect(evidence.resolve).not.toHaveBeenCalled();
  });

  it("reads each batch through planning's own service, in the asker's workspace", async () => {
    const { service, reads, batches } = build({ batches: [seededBatch()] });
    const card = await service.list(ORG, HELIOS);

    expect(reads.undrafted).toHaveBeenCalledWith(ORG, HELIOS);
    expect(reads.batchIds).toHaveBeenCalledWith(ORG, HELIOS);
    expect(batches.read).toHaveBeenCalledTimes(1);
    expect(batches.read).toHaveBeenCalledWith(ORG, BATCH_ID);
    expect(card.batches[0].batch.planner).toBe("analyzer-v1");
    expect(card.batches[0].drafts.map((entry) => entry.localKey)).toEqual([
      "BA-1",
      "BA-2",
      "BA-3",
      "BA-4",
    ]);
  });

  it("resolves the suggestions' and the bodies' references in one workspace-scoped read", async () => {
    const { service, evidence } = build({
      undrafted: [undraftedRow()],
      batches: [seededBatch()],
    });
    const card = await service.list(ORG, HELIOS);

    expect(evidence.resolve).toHaveBeenCalledTimes(1);
    expect(evidence.resolve).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ builds: [BUILD_ID], waivers: [WAIVER_ID], merges: [] }),
    );
    expect(card.undrafted[0].evidence[0]).toMatchObject({ label: "#412 · zephyr build" });
    expect(card.batches[0].drafts[0].evidence[0]).toMatchObject({ surface: "farm" });
  });

  it("does not answer a card with a batch missing — a failed batch read fails the read", async () => {
    const { service, reads } = build();
    reads.batchIds.mockResolvedValueOnce(["5eed006a-0000-4000-8000-00000000dead"]);

    await expect(service.list(ORG, HELIOS)).rejects.toThrow("no batch");
  });
});
