import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../../openapi/specification";
import type { ChangeRow, CompetitorRow, WatchRow } from "./competitors.repository";
import {
  changeResource,
  competitorResource,
  summaryResource,
  watchResource,
} from "./competitors.resources";

/**
 * The registry's answers are what `openapi.yaml` documents (CL.3, #616) — held to the schemas the
 * UI's client is generated from.
 */

function validator(name: string) {
  const id = "https://ouroboros.build/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });
  return ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
}

const AT = new Date("2026-10-01T06:12:00Z");

const rival: CompetitorRow = {
  id: "5eed0094-0000-4000-8000-000000000001",
  organizationId: "org-acme",
  name: "Skylink",
  meta: {
    site: "https://skylink.example.com",
    aliases: ["Skylink Robotics"],
    notes: "Leader in docks.",
  },
  createdAt: AT,
};

const watch: WatchRow = {
  id: "5eed0094-0000-4000-8000-000000000011",
  competitorId: rival.id,
  sourceKind: "release_notes",
  url: "https://skylink.example.com/releases",
  selector: "main .release-list",
  cadence: "daily",
  enabled: true,
  renderRequired: true,
  lastSnapshotAt: AT,
  nextCheckAt: AT,
  lastCheckedAt: AT,
  lastSuccessAt: null,
  lastOutcome: "render_required",
  lastNote:
    "the page renders its content with JavaScript — it needs the render tier, arriving in v2",
  createdAt: AT,
};

const change: ChangeRow = {
  snapshotId: "5eed0094-0000-4000-8000-000000000102",
  previousSnapshotId: "5eed0094-0000-4000-8000-000000000101",
  watchId: watch.id,
  competitorId: rival.id,
  competitorName: "Skylink",
  sourceKind: "release_notes",
  url: watch.url,
  selector: watch.selector,
  contentHash: `sha256:${"a".repeat(64)}`,
  diff: "+ 6.2 — Gust-adaptive final approach",
  takenAt: AT,
};

describe("the competitor registry contract", () => {
  it("documents a rival with a marked watch, and one never checked", () => {
    const valid = validator("Competitor");
    const fresh: WatchRow = {
      ...watch,
      renderRequired: false,
      lastOutcome: null,
      lastNote: null,
      lastCheckedAt: null,
      nextCheckAt: null,
      lastSnapshotAt: null,
    };

    expect(valid(competitorResource(rival, [watch, fresh]))).toBe(true);
    expect(valid(competitorResource({ ...rival, meta: {} }, []))).toBe(true);
  });

  it("documents the list with its summary", () => {
    const valid = validator("CompetitorList");

    expect(
      valid({
        items: [competitorResource(rival, [watch])],
        summary: summaryResource({
          rivalsWatched: 4,
          watchesEnabled: 5,
          sourceKinds: ["release_notes", "changelog", "filings"],
          subLine: "4 rivals watched · release notes, changelogs, filings",
        }),
      }),
    ).toBe(true);
  });

  it("documents a watch and a change feed page", () => {
    expect(validator("CompetitorWatch")(watchResource(watch))).toBe(true);
    expect(
      validator("CompetitorChangeFeed")({
        items: [changeResource(change)],
        nextBefore: AT.toISOString(),
      }),
    ).toBe(true);
  });
});
