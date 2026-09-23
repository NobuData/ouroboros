import { describe, expect, it, vi } from "vitest";

import { SEEDED_RUN_ID } from "../helpers/runs";

/** `GET /api/runs/{id}/transcript.jsonl` (#310): the path's id, and whatever the reader answered. */

vi.mock("server-only", () => ({}));

const readRunTranscript = vi.fn<(id: string) => Promise<Response>>(() =>
  Promise.resolve(new Response("{}\n", { status: 200 })),
);

vi.mock("@/app/api/run-transcript", () => ({ readRunTranscript: (id: string) => readRunTranscript(id) }));

const { GET } = await import("@/app/api/runs/[id]/transcript.jsonl/route");

describe("the route", () => {
  it("reads the run the path names and answers with the reader's response", async () => {
    const response = await GET(new Request(`http://ui.test/api/runs/${SEEDED_RUN_ID}/transcript.jsonl?id=other`), {
      params: Promise.resolve({ id: SEEDED_RUN_ID }),
    });

    expect(readRunTranscript).toHaveBeenCalledExactlyOnceWith(SEEDED_RUN_ID);
    expect(await response.text()).toBe("{}\n");
  });
});
