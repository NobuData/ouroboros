import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import { ApiError } from "@/app/api/errors";
// Types only, so this import is erased and nothing loads before the mocks below.
import type { AuditEventPage } from "@/app/api/audit";

import { clientAnswering, stubClient } from "../helpers/api";
import { seededTrail, trailPayload } from "../helpers/audit";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { audit } = await import("@/app/api/audit");

/**
 * The credential trail's read (#225).
 *
 * One `GET` with three optional filters, so what is worth holding is mostly about what this
 * module does *not* do — it names no workspace, it invents no default filter, and it hands
 * back what the service composed rather than recomposing it — plus the one property the
 * sheet's honesty rests on: **an absent fact survives the crossing as `null`.**
 */

/** The refusal a page behind the gate can still meet: a role that may not read the trail. */
const FORBIDDEN = {
  code: "forbidden",
  message: "Your role does not permit this.",
  details: { role: "member", required: ["owner", "admin"] },
};

describe("audit.events", () => {
  it("calls the trail endpoint and returns the body itself", async () => {
    const { client, requests } = clientAnswering(trailPayload());

    const page: AuditEventPage = await audit.events({}, client);

    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url).pathname).toBe("/api/v1/providers/audit");
    expect(page.items).toHaveLength(seededTrail().length);
    expect(page.total).toBe(seededTrail().length);
  });

  it("names no workspace, because the trail is the session's own", async () => {
    // There is no workspace in this path and this client sends no `X-Ouro-Tenant`
    // (`app/api/server.ts` says why), so the trail is scoped by the session.
    const { client, requests } = clientAnswering(trailPayload());

    await audit.events({}, client);

    expect(new URL(requests[0].url).search).toBe("");
    expect(requests[0].headers.get("X-Ouro-Tenant")).toBeNull();
  });

  it("sends only the filters it was given", async () => {
    const { client, requests } = clientAnswering(trailPayload([]));

    await audit.events({ action: "provider.revealed", limit: 50 }, client);

    const query = new URL(requests[0].url).searchParams;
    expect(query.get("action")).toBe("provider.revealed");
    expect(query.get("limit")).toBe("50");
    expect(query.has("connectionId")).toBe(false);
    expect(query.has("actorId")).toBe(false);
  });

  it("carries all three of the questions AD.4 names", async () => {
    const { client, requests } = clientAnswering(trailPayload([]));

    await audit.events(
      {
        connectionId: "5eed000c-0000-4000-8000-000000000001",
        actorId: "5eed0003-0000-4000-8000-000000000002",
        action: "provider.rotated",
      },
      client,
    );

    const query = new URL(requests[0].url).searchParams;
    expect(query.get("connectionId")).toBe("5eed000c-0000-4000-8000-000000000001");
    expect(query.get("actorId")).toBe("5eed0003-0000-4000-8000-000000000002");
    expect(query.get("action")).toBe("provider.rotated");
  });

  it("keeps an absent fact absent rather than filling it in", async () => {
    // The property the whole sheet is built on: a lease grant has no actor, and a refused add
    // has no connection. Neither may acquire one on the way across.
    const { client } = clientAnswering(
      trailPayload([
        {
          id: "5eed0015-0000-4000-8000-000000000013",
          occurredAt: "2026-08-24T15:23:00.000Z",
          actorId: null,
          actorName: null,
          action: "credential.lease_granted",
          subjectType: "run",
          subjectId: null,
          ip: null,
          detail: {},
        },
      ]),
    );

    const [event] = (await audit.events({}, client)).items;

    expect(event.actorId).toBeNull();
    expect(event.actorName).toBeNull();
    expect(event.subjectId).toBeNull();
    expect(event.ip).toBeNull();
  });

  it("answers an empty workspace with an empty page rather than a failure", async () => {
    // *Nothing has happened yet* and *the trail could not be read* are different facts, and
    // the sheet says something different for each.
    const { client } = clientAnswering(trailPayload([]));

    await expect(audit.events({}, client)).resolves.toMatchObject({ items: [], total: 0 });
  });

  it("rejects with what the service said when a role may not read it", async () => {
    const { client } = stubClient(() => ({ body: FORBIDDEN, status: 403 }));

    await expect(audit.events({}, client)).rejects.toBeInstanceOf(ApiError);
    await expect(audit.events({}, client)).rejects.toMatchObject({ code: "forbidden" });
  });
});
