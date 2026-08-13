import { describe, expect, it } from "vitest";

import type { Membership } from "@/app/api/membership";
import type { Session } from "@/app/api/identity";
import { loginView } from "@/app/login/view";

import { membership, sessionUser } from "../helpers/login";

/**
 * Which of the login screen's four outcomes a request lands on.
 *
 * The whole reason this decision is a pure function is so that each of the four is a case
 * here rather than a route to drive: the screen has one URL, and "signed in, asked where the
 * loop runs" and "signed in and settled" differ only in the request.
 *
 * **The question the third input answers changed in
 * [#719](https://github.com/NobuData/ouroboros/issues/719), and it is what most of these
 * cases are about.** The active workspace was the `ouro_tenant` cookie, so *no cookie* meant
 * *has not chosen yet* and step 2 was what an absent value rendered. The workspace is on the
 * session now, and `ouroboros-rest` stamps one at session creation — so every signed-in
 * request names a workspace, including the first one after a sign-in, and a screen reading
 * the pointer as evidence of a choice would send everybody past the question it exists to
 * ask. `settled` is the fact the pointer no longer carries.
 */

/**
 * A session carrying the given memberships.
 *
 * @param memberships What this person belongs to.
 * @param over `activeOrganizationId`, `membershipTotal` or a suggestion, when a case is
 *   about one. The pointer defaults to the first membership, which is what a freshly
 *   created session carries.
 * @returns A complete session.
 */
function session(
  memberships: readonly Membership[],
  over: Partial<Pick<Session, "activeOrganizationId" | "membershipTotal" | "tenantSuggestion">> = {},
): Session {
  return {
    user: sessionUser(),
    memberships: [...memberships],
    membershipTotal: memberships.length,
    activeOrganizationId: memberships[0]?.id ?? null,
    tenantSuggestion: null,
    ...over,
  };
}

describe("loginView, with nobody signed in", () => {
  it("shows step 1 whatever else the request carries", () => {
    for (const workspace of [undefined, "acme-robotics", "anything"]) {
      for (const settled of [false, true]) {
        expect(loginView({ session: null, workspace, settled })).toEqual({ step: "sign-in" });
      }
    }
  });
});

describe("loginView, signed in with somewhere to go", () => {
  const acme = membership();
  const labs = membership({ id: "2", slug: "acme-labs" });

  it("asks where the loop runs when this browser has not been asked", () => {
    // The state a sign-in lands in. The session already names a workspace — it is stamped
    // at creation — so the pointer cannot be what tells these two states apart.
    const view = loginView({
      session: session([acme, labs]),
      workspace: undefined,
      settled: false,
    });

    expect(view).toEqual({
      step: "choose",
      memberships: [acme, labs],
      active: acme,
      total: 2,
    });
  });

  it("draws every workspace on the one card, which is what the mockup has", () => {
    const view = loginView({
      session: session([acme, labs]),
      workspace: undefined,
      settled: false,
    });

    expect(view.step === "choose" && view.memberships).toHaveLength(2);
  });

  it("opens on the workspace the session is acting in", () => {
    const view = loginView({
      session: session([acme, labs], { activeOrganizationId: labs.id }),
      workspace: undefined,
      settled: false,
    });

    expect(view.step === "choose" && view.active).toBe(labs);
  });

  it("opens on the first row when the session is acting nowhere", () => {
    // A card that opened on nothing would make **Enter mission control →** a press that
    // submits no workspace and lands back here.
    const view = loginView({
      session: session([acme, labs], { activeOrganizationId: null }),
      workspace: undefined,
      settled: false,
    });

    expect(view.step === "choose" && view.active).toBe(acme);
  });

  it("carries the listing's total so the card can say what it left out", () => {
    const view = loginView({
      session: session([acme], { membershipTotal: 340 }),
      workspace: undefined,
      settled: false,
    });

    expect(view.step === "choose" && view.total).toBe(340);
  });

  it("sends a settled visitor to the dashboard rather than drawing anything", () => {
    // "Authenticated users skip to the dashboard" — the outcome is an instruction to the
    // route, which is why it carries no data.
    const view = loginView({ session: session([acme]), workspace: undefined, settled: true });

    expect(view).toEqual({ step: "dashboard" });
  });

  it("keeps a settled visitor here when the URL asks for step 2 by name", () => {
    // The marker is what makes changing where the loop runs possible at all: without it,
    // the request that would render the question is the request that redirects past it.
    const view = loginView({ session: session([acme, labs]), workspace: labs.slug, settled: true });

    expect(view).toEqual({
      step: "choose",
      memberships: [acme, labs],
      active: labs,
      total: 2,
    });
  });

  it("opens on the workspace the URL names, over the one the session is acting in", () => {
    const view = loginView({
      session: session([acme, labs], { activeOrganizationId: acme.id }),
      workspace: labs.slug,
      settled: true,
    });

    expect(view.step === "choose" && view.active).toBe(labs);
  });

  it("ignores a parameter that names nothing, and treats the visit as an arrival", () => {
    // A hand-typed slug is not a way to be shown a workspace: it either names one this
    // person belongs to, or it is not a marker at all.
    const view = loginView({
      session: session([acme]),
      workspace: "not-a-workspace-of-theirs",
      settled: true,
    });

    expect(view).toEqual({ step: "dashboard" });
  });

  it("asks again rather than redirecting when the session points somewhere they have left", () => {
    // Both halves of the dashboard rule are load-bearing: `requireWorkspace()` would send
    // such a request straight back here, and the two screens would bounce it between them.
    const view = loginView({
      session: session([acme], { activeOrganizationId: "5eed0001-0000-4000-8000-00000000dead" }),
      workspace: undefined,
      settled: true,
    });

    expect(view).toMatchObject({ step: "choose", active: acme });
  });
});

describe("loginView, signed in with nowhere to go", () => {
  it("explains rather than offering an empty list", () => {
    const view = loginView({ session: session([]), workspace: undefined, settled: false });

    expect(view).toEqual({ step: "no-workspace", suggestion: null });
  });

  it("explains even for a settled browser, because there is nowhere to send it", () => {
    const view = loginView({ session: session([]), workspace: undefined, settled: true });

    expect(view).toEqual({ step: "no-workspace", suggestion: null });
  });

  it("carries the suggestion the contract supplies for a first-run screen", () => {
    const suggestion = {
      tenantId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
      slug: "acme-robotics",
      displayName: "Acme Robotics",
    };
    const view = loginView({
      session: session([], { tenantSuggestion: suggestion }),
      workspace: undefined,
      settled: false,
    });

    expect(view).toEqual({ step: "no-workspace", suggestion });
  });
});
