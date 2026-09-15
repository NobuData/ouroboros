import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import { codeValidation, workflowCode } from "../helpers/workflow-code";

// The facade sits on the server-side client — see `server.test.ts` for what each of these answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { workflows } = await import("@/app/api/workflows");

/**
 * The code view's **Validate** on V.6's contract (#174).
 *
 * What the call must get right on the wire: a `POST` to the workflow's code validation that sends nothing
 * but the slug — the service validates the stored draft, so there is no text to send and nothing to guard —
 * and a refusal that arrives as the service's `ApiError`, so the page can say the engine could not check it.
 */

describe("workflows.validateCode", () => {
  it("posts to the workflow's code validation with no body, and answers the verdict", async () => {
    const validation = codeValidation();
    const { client, requests } = clientAnswering(validation);

    await expect(workflows.validateCode("standard-fix", client)).resolves.toEqual(validation);

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toBe(`${STUB_BASE_URL}/api/v1/workflows/standard-fix/code/validate`);
    expect(requests[0].headers.get("If-Match")).toBeNull();
    expect(await requests[0].text()).toBe("");
  });

  it("restores the file's always-null outline reference, as the read does", async () => {
    const { outlineRef, ...served } = workflowCode({ etag: "etag-2" });
    const { client } = clientAnswering(codeValidation({ file: served as ReturnType<typeof workflowCode> }));

    await expect(workflows.validateCode("standard-fix", client)).resolves.toMatchObject({
      file: { outlineRef, etag: "etag-2" },
    });
  });

  it("rejects with the service's refusal when the engine could not check the file", async () => {
    const { client } = clientAnswering(
      { code: "engine_unavailable", message: "The engine could not validate the definition.", details: {} },
      502,
    );

    const refused = workflows.validateCode("standard-fix", client);

    await expect(refused).rejects.toBeInstanceOf(ApiError);
    await expect(refused).rejects.toMatchObject({ status: 502, code: "engine_unavailable" });
  });
});
