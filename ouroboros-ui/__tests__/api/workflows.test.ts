import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { clientAnswering } from "../helpers/api";
import { UNPROJECTABLE_REFUSAL, workflowCode } from "../helpers/workflow-code";
import { seededRail, workflowDetail } from "../helpers/workflows";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { WORKFLOW_CODE_UNPROJECTABLE, workflows } = await import("@/app/api/workflows");

/**
 * The studio's share of P.3's contract (#134, consumed by #147): the rail, one workflow, and
 * **+ New workflow**.
 *
 * Two `GET`s and a `POST`, so most of what is worth holding is about what this module does
 * *not* do — it names no workspace, it asks for no version, it makes no second request for a
 * caption the first one already carried, and it hands back what the service composed rather
 * than recomposing it — and about the one property the page's honesty rests on: **a served
 * null survives the crossing as `null`**, never as a zero the head would then print.
 */

/** The refusal a screen behind the gate can still meet: a session acting in no workspace. */
const NO_ORGANIZATION = {
  code: "organization_required",
  message: "Choose a workspace before opening the studio.",
  details: {},
};

/** The seeded `standard-fix`'s id. */
const STANDARD_FIX = "5eed001b-0000-4000-8000-000000000001";

describe("workflows.list", () => {
  it("calls the rail endpoint and unwraps the entries", async () => {
    const { client, requests } = clientAnswering({ workflows: seededRail() });

    const entries = await workflows.list(client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/workflows");
    expect(requests[0]?.method).toBe("GET");
    // The envelope is `{workflows: [...]}`; the screen wants the entries. Unwrapping here rather
    // than in the reader is what keeps the reader free of the contract's shape.
    expect(entries).toEqual(seededRail());
  });

  it("reads the rail in one request and asks for nothing else", async () => {
    // Every caption and usage figure the rail draws is in this one payload, composed by P.4.
    const { client, requests } = clientAnswering({ workflows: seededRail() });

    await workflows.list(client);

    expect(requests).toHaveLength(1);
  });

  it("names no workspace, because the workspace is the session's", async () => {
    // There is no workspace in this path and this application sends no `X-Ouro-Tenant`
    // (`app/api/server.ts` says why) — the service resolves it from the session cookie.
    const { client, requests } = clientAnswering({ workflows: seededRail() });

    await workflows.list(client);

    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
  });

  it("hands back an empty rail as an empty array, not as a failure", async () => {
    // The studio's empty state is an answer the service gives, and the reader must be able to
    // tell it from a refusal.
    const { client } = clientAnswering({ workflows: [] });

    await expect(workflows.list(client)).resolves.toEqual([]);
  });

  it("carries a served null across as null, never as a zero", async () => {
    // The honesty rule as a type: `usagePercent: null` is *no runs to divide by* and
    // `stageCount: null` is *nothing published*, and a client that defaulted either would
    // print a number nobody measured.
    const entry = {
      ...seededRail()[0]!,
      currentVersion: null,
      stageCount: null,
      terminal: null,
      caption: "not published",
      usagePercent: null,
      usageCaption: "no runs yet",
    };
    const { client } = clientAnswering({ workflows: [entry] });

    const [served] = await workflows.list(client);

    expect(served?.usagePercent).toBeNull();
    expect(served?.stageCount).toBeNull();
    expect(served?.currentVersion).toBeNull();
    expect(served?.caption).toBe("not published");
  });

  it("rejects with the contract's envelope when the service refuses", async () => {
    const { client } = clientAnswering(NO_ORGANIZATION, 400);

    const failure = await workflows.list(client).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(400);
    expect((failure as ApiError).code).toBe("organization_required");
    expect((failure as ApiError).message).toBe(NO_ORGANIZATION.message);
  });
});

describe("workflows.read", () => {
  it("reads one workflow by its id, in the path", async () => {
    const { client, requests } = clientAnswering(workflowDetail());

    const detail = await workflows.read(STANDARD_FIX, client);

    expect(requests[0]?.url).toBe(`http://rest.test:4000/api/v1/workflows/${STANDARD_FIX}`);
    expect(requests[0]?.method).toBe("GET");
    expect(detail).toEqual(workflowDetail());
  });

  it("asks for no version, so what it reads is the one in force", async () => {
    // The frame describes what *runs*; browsing history is S.6's, and a `?version=` here
    // would make this module decide something the studio has not asked it to.
    const { client, requests } = clientAnswering(workflowDetail());

    await workflows.read(STANDARD_FIX, client);

    expect(new URL(requests[0]!.url).search).toBe("");
  });

  it("hands back a workflow that has published nothing with its version null", async () => {
    // The state **+ New workflow** leaves behind, and not an error: the canvas opens on the
    // draft.
    const unpublished = workflowDetail({ currentVersion: null, version: null });
    const { client } = clientAnswering(unpublished);

    const detail = await workflows.read(STANDARD_FIX, client);

    expect(detail.version).toBeNull();
    expect(detail.currentVersion).toBeNull();
  });

  it("rejects with the service's not-found, which discloses nothing", async () => {
    // A well-formed id belonging to another workspace answers the same `404` an id that names
    // nothing does — the contract's own rule, kept as-is here.
    const { client } = clientAnswering(
      {
        code: "workflow_not_found",
        message: "No such workflow.",
        details: { workflowId: STANDARD_FIX },
      },
      404,
    );

    const failure = await workflows.read(STANDARD_FIX, client).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(404);
    expect((failure as ApiError).code).toBe("workflow_not_found");
    expect((failure as ApiError).details).toEqual({ workflowId: STANDARD_FIX });
  });
});

describe("workflows.create", () => {
  it("posts the name and the slug, and hands back the workflow as stored", async () => {
    const created = workflowDetail({
      id: "5eed001b-0000-4000-8000-000000000006",
      slug: "hotfix-p1",
      name: "Hotfix P1",
      currentVersion: null,
      version: null,
      draft: { etag: "none", definition: {}, updatedAt: "2026-09-13T12:00:00.000Z" },
    });
    const { client, requests } = clientAnswering(created, 201);

    const detail = await workflows.create({ name: "Hotfix P1", slug: "hotfix-p1" }, client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/workflows");
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual({ name: "Hotfix P1", slug: "hotfix-p1" });
    expect(detail).toEqual(created);
  });

  it("sends exactly the body it was given — no definition, no status, no version", async () => {
    // The blank canvas is the contract's own default, and a client restating it would be a
    // second place for the shape of *blank* to drift.
    const { client, requests } = clientAnswering(workflowDetail(), 201);

    await workflows.create({ name: "Hotfix P1", slug: "hotfix-p1" }, client);

    expect(Object.keys((await requests[0]!.json()) as object).sort()).toEqual(["name", "slug"]);
  });

  it("rejects with the slug-taken refusal, naming the slug", async () => {
    const { client } = clientAnswering(
      {
        code: "workflow_slug_taken",
        message: "A workflow with that name already exists in this workspace.",
        details: { slug: "standard-fix" },
      },
      409,
    );

    const failure = await workflows
      .create({ name: "Standard Fix", slug: "standard-fix" }, client)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(409);
    expect((failure as ApiError).code).toBe("workflow_slug_taken");
    expect((failure as ApiError).details).toEqual({ slug: "standard-fix" });
  });

  it("rejects with the role refusal for a member, having written nothing", async () => {
    const { client } = clientAnswering(
      { code: "forbidden", message: "Creating a workflow is owner or admin.", details: {} },
      403,
    );

    const failure = await workflows
      .create({ name: "Hotfix P1", slug: "hotfix-p1" }, client)
      .catch((error: unknown) => error);

    expect((failure as ApiError).status).toBe(403);
    expect((failure as ApiError).code).toBe("forbidden");
  });
});

describe("workflows.code", () => {
  it("reads one workflow's file by its slug, in the path", async () => {
    // U.3's endpoint takes the slug, unlike `read`, which takes the id.
    const { client, requests } = clientAnswering(workflowCode());

    const file = await workflows.code("standard-fix", client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/workflows/standard-fix/code");
    expect(requests[0]?.method).toBe("GET");
    expect(file).toEqual(workflowCode());
  });

  it("asks for no version, so the file is the draft's — the one the canvas edits", async () => {
    const { client, requests } = clientAnswering(workflowCode());

    const file = await workflows.code("standard-fix", client);

    expect(new URL(requests[0]!.url).search).toBe("");
    // Decision C3 as data: the file's etag is the draft slot's, the token the canvas holds.
    expect(file.etag).toBe(workflowDetail().draft.etag);
  });

  it("encodes the slug, so a value from a URL cannot become another route", async () => {
    const { client, requests } = clientAnswering(workflowCode());

    await workflows.code("a b", client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/workflows/a%20b/code");
  });

  it("rejects a draft with no spelling as code with its code and the validator's findings", async () => {
    const { client } = clientAnswering(UNPROJECTABLE_REFUSAL, 409);

    const failure = await workflows.code("hotfix-p1", client).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(409);
    expect((failure as ApiError).code).toBe(WORKFLOW_CODE_UNPROJECTABLE);
    expect((failure as ApiError).details).toEqual(UNPROJECTABLE_REFUSAL.details);
  });
});
