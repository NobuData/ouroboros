import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../../openapi/specification";
import { resolvedEvidence } from "../duration/duration.fixture";
import { BUILD_ID, draft, HELIOS, seededBatch, undraftedRow, WAIVER_ID } from "./tickets.fixture";
import { ticketsResource } from "./tickets.resources";

/**
 * `GET /api/v1/analyzer/tickets` answers what `openapi.yaml` documents (BW.4, #519) — the seeded
 * batch, an un-drafted suggestion, a batch part-way through a push, a draft whose body states no
 * evidence, and the empty card — held to the `AnalysisTickets` schema the UI's client is generated
 * from.
 */

/**
 * A validator for one documented schema.
 *
 * @param name - The schema's name under `components/schemas`.
 * @returns The compiled validator.
 */
function validator(name: string) {
  const id = "https://ouroboros.build/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });
  return ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
}

/** What the fixtures' references name. */
const RESOLVED = resolvedEvidence({
  builds: [{ id: BUILD_ID, number: 412, label: "zephyr build" }],
  waivers: [
    {
      id: WAIVER_ID,
      run_id: "5eed0009-0000-4000-8000-000000000471",
      reason: "Thermal chamber booked until the 14th",
      pull_request_id: "5eed0050-0000-4000-8000-000000000471",
    },
  ],
});

describe("the drafted-tickets card's read, against its documented schema", () => {
  const validate = validator("AnalysisTickets");

  it("documents the seeded batch and an un-drafted suggestion as sent", () => {
    const body = ticketsResource(HELIOS, [undraftedRow()], [seededBatch()], RESOLVED);

    expect(validate(body) ? null : validate.errors).toBeNull();
    expect(body.batches[0].drafts.map((entry) => entry.evidence[0]?.surface)).toEqual([
      "farm",
      "farm",
      "pull_request",
      undefined,
    ]);
  });

  it("documents a batch part-way through a push — pushed, failed, unsized and unselected drafts", () => {
    const body = ticketsResource(
      HELIOS,
      [],
      [
        seededBatch({
          status: "pushing",
          drafts: [
            draft(1, {
              pushState: "pushed",
              pushedTicketId: "5eed0030-0000-4000-8000-000000000621",
              pushedTicket: {
                externalId: "621",
                externalKey: "#621",
                url: "https://github.com/acme-robotics/helios-firmware/issues/621",
              },
            }),
            draft(2, {
              pushState: "failed",
              pushError: { code: "provider_refused", message: "GitHub answered 502." },
            }),
            draft(3, { selected: false, estimate: null }),
            draft(4, { body: "Rewritten by hand.", provenance: "edited" }),
          ],
          summary: {
            draftCount: 4,
            selectedCount: 3,
            sizedCount: 3,
            allSized: true,
            estimators: ["heuristic-v0"],
            estMinutes: 1140,
            loopDays: 0.8,
            spend: { cents: 143, display: "$1.43", partial: true },
          },
        }),
      ],
      RESOLVED,
    );

    expect(validate(body) ? null : validate.errors).toBeNull();
    expect(body.batches[0].drafts[3]).toEqual({
      localKey: "BA-4",
      evidenceLine: null,
      evidence: [],
      evidenceTotal: 0,
    });
  });

  it("documents the empty card", () => {
    const body = ticketsResource(HELIOS, [], [], resolvedEvidence());

    expect(validate(body) ? null : validate.errors).toBeNull();
    expect(body).toEqual({ repo: HELIOS, undrafted: [], batches: [] });
  });

  it("refuses a field the document does not name", () => {
    const body = ticketsResource(HELIOS, [undraftedRow()], [], RESOLVED);

    expect(validate({ ...body, total: 1.5 })).toBe(false);
  });
});
