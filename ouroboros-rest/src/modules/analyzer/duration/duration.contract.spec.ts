import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../../openapi/specification";
import { annotatedRun, changePoint, resolvedEvidence } from "./duration.fixture";
import {
  changePointResource,
  durationChartResource,
  emptyDurationChart,
} from "./duration.resources";

/**
 * `GET /api/v1/analyzer/duration` answers what `openapi.yaml` documents (BW.2, #517) — an
 * annotated chart, a finding that carries only what V081 requires, and the empty chart, held to the
 * `DurationChart` schema the UI's client is generated from.
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

describe("the duration chart read, against its documented schema", () => {
  it("documents an annotated chart as sent — resolved and unresolved evidence alike", () => {
    const body = durationChartResource(
      annotatedRun(),
      [
        {
          day: "2026-06-21",
          dimension: "zephyr build",
          value: 341_500,
          samples: [341_000, 342_000],
        },
        { day: "2026-06-22", dimension: "zephyr build", value: 212_000, samples: [212_000] },
      ],
      [changePoint()],
      resolvedEvidence(),
    );
    const validate = validator("DurationChart");

    expect(validate(body) ? null : validate.errors).toBeNull();
    expect(body.changePoints[0].evidence.map((entry) => entry.surface)).toEqual([
      "pull_request",
      "workflow",
      "farm",
      null,
    ]);
  });

  it("documents a finding that carries only V081's required keys", () => {
    const body = changePointResource(
      changePoint({
        analyzer_version: 2,
        data: {
          date: "2026-07-30",
          metric: "build.duration_median",
          delta_seconds: 40,
          candidates: [
            {
              label: "no recorded change within ±3 days",
              score: 0,
              ref: { kind: "build", id: "5eed0061-0000-4000-8000-000000000655" },
              event_kind: null,
            },
          ],
        },
        confidence_basis: { method: "change_point v2" },
      }),
      resolvedEvidence(),
    );
    const validate = validator("ChangePoint");

    expect(validate(body) ? null : validate.errors).toBeNull();
    expect(body).toMatchObject({ attributionWindowDays: null, beforeMedianSeconds: null });
  });

  it("documents the empty chart", () => {
    const validate = validator("DurationChart");
    const body = emptyDurationChart("acme-robotics/helios-firmware");

    expect(validate(body) ? null : validate.errors).toBeNull();
  });
});
