import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { epicLinks, planningEpic, planningTicket } from "../helpers/planning";

/**
 * The gantt's and the epic editor's server hops (#286). Each forwards what its caller composed, and a
 * refusal comes back as a value so the card and the sheet stay on screen.
 */

const updateEpic = vi.fn();
const createEpic = vi.fn();
const epicLinksRead = vi.fn();
const linkTickets = vi.fn();
const unlinkTickets = vi.fn();
const searchTickets = vi.fn();

vi.mock("@/app/api/planning", () => ({
  planning: {
    updateEpic: (id: unknown, body: unknown) => updateEpic(id, body),
    createEpic: (body: unknown) => createEpic(body),
    epicLinks: (id: unknown) => epicLinksRead(id),
    linkTickets: (id: unknown, ids: unknown) => linkTickets(id, ids),
    unlinkTickets: (id: unknown, ids: unknown) => unlinkTickets(id, ids),
    searchTickets: (term: unknown) => searchTickets(term),
  },
}));

const actions = await import("@/app/planning/gantt-actions");

const EPIC = "5eed0280-0000-4000-8000-00000000ee01";
const TICKET = "5eed0280-0000-4000-8000-0000000071c1";

/** The service refusing a role below admin. */
const forbidden = () => new ApiError(403, "forbidden", "Admins only.");

beforeEach(() => {
  for (const mock of [updateEpic, createEpic, epicLinksRead, linkTickets, unlinkTickets, searchTickets]) mock.mockReset();
});

describe("updateEpic", () => {
  it("forwards the patch and answers the stored lane", async () => {
    updateEpic.mockResolvedValue(planningEpic({ endMonth: "2026-10" }));

    await expect(actions.updateEpic(EPIC, { endMonth: "2026-10", startMonth: "2026-07" })).resolves.toEqual({
      ok: true,
      value: planningEpic({ endMonth: "2026-10" }),
    });
    expect(updateEpic).toHaveBeenCalledExactlyOnceWith(EPIC, { endMonth: "2026-10", startMonth: "2026-07" });
  });

  it("answers a refusal as a value", async () => {
    updateEpic.mockRejectedValue(forbidden());

    await expect(actions.updateEpic(EPIC, { name: "x" })).resolves.toEqual({
      ok: false,
      refusal: { code: "forbidden", message: "Admins only.", details: {} },
    });
  });

  it("lets anything that is not an API error travel — the redirect signal above all", async () => {
    updateEpic.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(actions.updateEpic(EPIC, { name: "x" })).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("addEpic, readEpicLinks and searchTickets", () => {
  it("forward to their operations", async () => {
    createEpic.mockResolvedValue(planningEpic());
    epicLinksRead.mockResolvedValue(epicLinks());
    searchTickets.mockResolvedValue({ items: [planningTicket()] });

    await expect(actions.addEpic({ name: "OTA hardening" })).resolves.toEqual({ ok: true, value: planningEpic() });
    await expect(actions.readEpicLinks(EPIC)).resolves.toEqual({ ok: true, value: epicLinks() });
    await expect(actions.searchTickets("#548")).resolves.toEqual({ ok: true, value: { items: [planningTicket()] } });
    expect(createEpic).toHaveBeenCalledWith({ name: "OTA hardening" });
    expect(epicLinksRead).toHaveBeenCalledWith(EPIC);
    expect(searchTickets).toHaveBeenCalledWith("#548");
  });
});

describe("setTicketLinked", () => {
  it("links one ticket, then re-reads the lane's lists", async () => {
    linkTickets.mockResolvedValue(planningEpic({ chips: { issues: 13, done: 8 } }));
    epicLinksRead.mockResolvedValue(epicLinks());

    await expect(actions.setTicketLinked(EPIC, TICKET, true)).resolves.toEqual({
      ok: true,
      value: { epic: planningEpic({ chips: { issues: 13, done: 8 } }), links: epicLinks() },
    });
    expect(linkTickets).toHaveBeenCalledExactlyOnceWith(EPIC, [TICKET]);
    expect(unlinkTickets).not.toHaveBeenCalled();
  });

  it("unlinks, and keeps the write's answer when the re-read is refused", async () => {
    unlinkTickets.mockResolvedValue(planningEpic({ chips: { issues: 11, done: 8 } }));
    epicLinksRead.mockRejectedValue(new ApiError(500, "internal_error", "Failed."));

    await expect(actions.setTicketLinked(EPIC, TICKET, false)).resolves.toEqual({
      ok: true,
      value: { epic: planningEpic({ chips: { issues: 11, done: 8 } }), links: null },
    });
    expect(unlinkTickets).toHaveBeenCalledExactlyOnceWith(EPIC, [TICKET]);
  });

  it("answers the write's refusal and reads nothing", async () => {
    linkTickets.mockRejectedValue(forbidden());

    await expect(actions.setTicketLinked(EPIC, TICKET, true)).resolves.toMatchObject({ ok: false });
    expect(epicLinksRead).not.toHaveBeenCalled();
  });
});
