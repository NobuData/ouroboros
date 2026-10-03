import { resolvedEvidence } from "../duration/duration.fixture";
import { EVIDENCE_LIMIT } from "../suggestions/suggestions.resources";
import {
  BATCH_ID,
  BUILD_ID,
  composedBody,
  draft,
  HELIOS,
  seededBatch,
  undraftedRow,
  WAIVER_ID,
} from "./tickets.fixture";
import { answeredTicketRefs, ticketsResource } from "./tickets.resources";

/**
 * The drafted-tickets card's resource (BW.4, #519): a batch is answered as planning answers it,
 * and each draft's evidence is what its **body** says — resolved, capped, and gone when the body
 * no longer states it.
 */

/** What the fixtures' references name. */
const RESOLVED = resolvedEvidence({
  builds: [{ id: BUILD_ID, number: 412, label: "zephyr build" }],
  waivers: [
    {
      id: WAIVER_ID,
      run_id: "5eed0009-0000-4000-8000-000000000471",
      reason: "Thermal chamber booked until the 14th",
      pull_request_id: null,
    },
  ],
});

/** A uuid whose last twelve digits are a number — distinct references for the cap. */
function buildId(n: number): string {
  return `5eed0062-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

describe("the drafted-tickets card", () => {
  it("answers the seeded batch as planning does, with each draft's evidence read from its body", () => {
    const batch = seededBatch();
    const card = ticketsResource(HELIOS, [], [batch], RESOLVED);

    expect(card.repo).toBe(HELIOS);
    expect(card.undrafted).toEqual([]);
    expect(card.batches).toHaveLength(1);
    // The batch is planning's own answer, untouched — the checkbox, the estimate, the footer.
    expect(card.batches[0].batch).toBe(batch);
    expect(card.batches[0].drafts.map((entry) => [entry.localKey, entry.evidenceLine])).toEqual([
      ["BA-1", "7.2% of OTA suite failures share one fixture timeout signature (31 builds)"],
      ["BA-2", "cache-miss signature matches ccache issue #1412 in 118 builds"],
      ["BA-3", "3 verification waivers in 60 days cite missing thermal coverage"],
      ["BA-4", "0 of 1,284 builds toggled them; 4 caused config-drift warnings"],
    ]);
  });

  it("resolves each reference to the surface it opens on", () => {
    const card = ticketsResource(HELIOS, [], [seededBatch()], RESOLVED);
    const [ota, , chamber, kconfig] = card.batches[0].drafts;

    expect(ota.evidence).toEqual([
      expect.objectContaining({
        kind: "build",
        id: BUILD_ID,
        label: "#412 · zephyr build",
        surface: "farm",
      }),
    ]);
    expect(chamber.evidence).toEqual([
      expect.objectContaining({
        kind: "waiver",
        label: "Thermal chamber booked until the 14th",
        surface: "test_results",
        runId: "5eed0009-0000-4000-8000-000000000471",
      }),
    ]);
    // A body that lists none has none — and says so with a zero, not an absent field.
    expect(kconfig).toMatchObject({ evidence: [], evidenceTotal: 0 });
  });

  it("keeps a reference retention has removed, opening nothing", () => {
    const card = ticketsResource(HELIOS, [], [seededBatch()], resolvedEvidence());

    expect(card.batches[0].drafts[0].evidence).toEqual([
      expect.objectContaining({ kind: "build", id: BUILD_ID, label: null, surface: null }),
    ]);
  });

  it("answers the first references of a long list, and how many there are", () => {
    const refs = Array.from(
      { length: EVIDENCE_LIMIT + 7 },
      (_, n) => `build \`${buildId(n + 1)}\``,
    );
    const long = seededBatch({
      drafts: [draft(2, { body: composedBody("118 builds", refs, 22) })],
    });
    const [entry] = ticketsResource(HELIOS, [], [long], RESOLVED).batches[0].drafts;

    expect(entry.evidence).toHaveLength(EVIDENCE_LIMIT);
    expect(entry.evidenceTotal).toBe(EVIDENCE_LIMIT + 7);
    expect(entry.evidence[0].id).toBe(buildId(1));
    // …and only those are asked of the resolver.
    expect(answeredTicketRefs([], [long])).toHaveLength(EVIDENCE_LIMIT);
  });

  it("shows no evidence for a draft whose body somebody rewrote, or that has none", () => {
    const edited = seededBatch({
      drafts: [
        draft(1, { body: "Rewritten by hand — see the incident doc.", provenance: "edited" }),
        draft(2, { body: null }),
      ],
    });

    expect(ticketsResource(HELIOS, [], [edited], RESOLVED).batches[0].drafts).toEqual([
      { localKey: "BA-1", evidenceLine: null, evidence: [], evidenceTotal: 0 },
      { localKey: "BA-2", evidenceLine: null, evidence: [], evidenceTotal: 0 },
    ]);
  });

  it("answers an edit that kept the evidence — the card shows what a push will file", () => {
    const edited = seededBatch({
      drafts: [
        draft(1, {
          body: `Seen again on the 9th.\n\n${composedBody("8.0% of OTA suite failures (35 builds)", [`build \`${BUILD_ID}\``], 21)}`,
          provenance: "edited",
        }),
      ],
    });

    expect(ticketsResource(HELIOS, [], [edited], RESOLVED).batches[0].drafts[0]).toMatchObject({
      evidenceLine: "8.0% of OTA suite failures (35 builds)",
      evidenceTotal: 1,
    });
  });

  it("lists batches newest first, whatever order they were read in", () => {
    const older = seededBatch({
      id: "5eed006a-0000-4000-8000-000000000009",
      createdAt: "2026-08-01T06:00:00.000Z",
    });
    const newer = seededBatch({ createdAt: "2026-08-08T06:12:00.000Z" });
    const twin = seededBatch({
      id: "5eed006a-0000-4000-8000-000000000000",
      createdAt: "2026-08-08T06:12:00.000Z",
    });

    expect(
      ticketsResource(HELIOS, [], [older, newer, twin], RESOLVED).batches.map(
        (entry) => entry.batch.id,
      ),
    ).toEqual([
      "5eed006a-0000-4000-8000-000000000000",
      BATCH_ID,
      "5eed006a-0000-4000-8000-000000000009",
    ]);
  });
});

describe("a ticket suggestion nobody has drafted", () => {
  it("answers its line and the references its draft will list, in the draft's order", () => {
    const [entry] = ticketsResource(HELIOS, [undraftedRow()], [], RESOLVED).undrafted;

    expect(entry).toMatchObject({
      id: "5eed0067-0000-4000-8000-000000000025",
      title: "Pin the west manifest — nightly fetches drift between runners",
      evidenceLine: "9 builds in 30 days failed on a manifest revision another runner never saw",
      confidence: 77,
      evidenceTotal: 2,
    });
    // Stored waiver-then-build; a draft lists by kind, then id.
    expect(entry.evidence.map((ref) => ref.kind)).toEqual(["build", "waiver"]);
    expect(entry.evidence[0]).toMatchObject({ label: "#412 · zephyr build", surface: "farm" });
  });

  it("has none when its findings carried none, or stored something that is not a list", () => {
    const card = ticketsResource(
      HELIOS,
      [undraftedRow({ evidence_refs: [] }), undraftedRow({ id: "x", evidence_refs: null })],
      [],
      RESOLVED,
    );

    expect(card.undrafted.map((entry) => entry.evidenceTotal)).toEqual([0, 0]);
  });

  it("is capped like a draft's, and only the answered references are resolved", () => {
    const refs = Array.from({ length: EVIDENCE_LIMIT + 3 }, (_, n) => ({
      kind: "build",
      id: buildId(n + 1),
    }));
    const row = undraftedRow({ evidence_refs: refs });
    const [entry] = ticketsResource(HELIOS, [row], [], RESOLVED).undrafted;

    expect(entry.evidence).toHaveLength(EVIDENCE_LIMIT);
    expect(entry.evidenceTotal).toBe(EVIDENCE_LIMIT + 3);
    expect(answeredTicketRefs([row], [seededBatch()])).toHaveLength(EVIDENCE_LIMIT + 3);
  });
});
