import { describe, expect, it, vi } from "vitest";

import { artifactUrl } from "@/app/test-results/artifacts";

import { JUNIT_ARTIFACT_ID } from "../helpers/test-results";

/**
 * `GET /api/artifacts/{id}` — the artifacts card's open ↗, on the origin the browser can reach
 * (#341). The id is the path's and nothing else reaches the reader.
 */

vi.mock("server-only", () => ({}));

/** What the reader was asked for. */
const asked: string[] = [];

vi.mock("@/app/api/artifact-file", () => ({
  readArtifactFile: (id: string) => {
    asked.push(id);

    return Promise.resolve(new Response("file", { status: 200 }));
  },
}));

const route = await import("@/app/api/artifacts/[id]/route");

describe("the artifact route", () => {
  it("is where the card's links point", () => {
    expect(artifactUrl(JUNIT_ARTIFACT_ID)).toBe(`/api/artifacts/${JUNIT_ARTIFACT_ID}`);
  });

  it("reads the path's artifact, and nothing the query names", async () => {
    const response = await route.GET(new Request(`http://ui.test${artifactUrl(JUNIT_ARTIFACT_ID)}?id=other`), {
      params: Promise.resolve({ id: JUNIT_ARTIFACT_ID }),
    });

    expect(asked).toEqual([JUNIT_ARTIFACT_ID]);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("file");
  });
});
