import { describe, expect, it } from "vitest";

import type { Membership } from "@/app/api/membership";
import type { Session } from "@/app/api/session";
import { WORKSPACE_PARAM, enablementPath, loginView } from "@/app/login/view";
import { LOGIN_PATH } from "@/app/paths";

/**
 * Which of the login screen's five outcomes a request lands on.
 *
 * The whole reason this decision is a pure function is so that each of the five is a case
 * here rather than a route to drive: the screen has one URL, and "signed in but no workspace
 * chosen" and "signed in and settled" differ only in the request. Every combination that can
 * reach it is below, including the two that a hand-typed URL produces.
 */

/**
 * One membership, with the fields a case cares about overridden.
 *
 * @param over What this case is about.
 * @returns A complete membership.
 */
function membership(over: Partial<Membership> = {}): Membership {
  return {
    tenantId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
    slug: "acme-robotics",
    displayName: "Acme Robotics",
    status: "active",
    role: "owner",
    ...over,
  };
}

/**
 * A session carrying the given memberships.
 *
 * @param memberships What this person belongs to.
 * @param suggestion The workspace their email domain points at, if any.
 * @returns A complete session.
 */
function session(
  memberships: readonly Membership[],
  suggestion: Session["tenantSuggestion"] = null,
): Session {
  return {
    user: {
      id: "5eed0003-0000-4000-8000-000000000001",
      email: "ken@acme-robotics.dev",
      displayName: "Ken Suenobu",
      avatarUrl: null,
      createdAt: "2026-08-11T10:20:23.114Z",
      updatedAt: "2026-08-11T10:20:23.114Z",
    },
    memberships: [...memberships],
    tenantSuggestion: suggestion,
  };
}

describe("loginView, with nobody signed in", () => {
  it("shows step 1 whatever else the request carries", () => {
    for (const workspace of [undefined, "acme-robotics", "anything"]) {
      expect(loginView({ session: null, membership: undefined, workspace })).toEqual({
        step: "sign-in",
      });
    }
  });
});

describe("loginView, signed in with somewhere to go", () => {
  const acme = membership();

  it("asks which workspace when none has been chosen", () => {
    const view = loginView({
      session: session([acme]),
      membership: undefined,
      workspace: undefined,
    });

    expect(view).toEqual({ step: "choose", memberships: [acme] });
  });

  it("offers only the live workspaces to choose between", () => {
    const held = membership({ slug: "held", tenantId: "2", status: "suspended" });
    const view = loginView({
      session: session([acme, held]),
      membership: undefined,
      workspace: undefined,
    });

    expect(view).toEqual({ step: "choose", memberships: [acme] });
  });

  it("sends a settled visitor to the dashboard rather than drawing anything", () => {
    // "Authenticated users skip to the dashboard" — the outcome is an instruction to the
    // route, which is why it carries no data.
    const view = loginView({
      session: session([acme]),
      membership: acme,
      workspace: undefined,
    });

    expect(view).toEqual({ step: "dashboard" });
  });

  it("shows the enablement step when the URL asks for the workspace already chosen", () => {
    const view = loginView({
      session: session([acme]),
      membership: acme,
      workspace: acme.slug,
    });

    expect(view).toEqual({ step: "enable", membership: acme });
  });

  it("sends a request back to the choice when the URL names a different workspace", () => {
    // Switching workspace is a choice, and a choice is a POST — a GET must not silently
    // re-point the cookie.
    const labs = membership({ slug: "acme-labs", tenantId: "2" });
    const view = loginView({
      session: session([acme, labs]),
      membership: acme,
      workspace: labs.slug,
    });

    expect(view).toEqual({ step: "choose", memberships: [acme, labs] });
  });

  it("ignores a parameter that names nothing, and treats the visit as an arrival", () => {
    const view = loginView({
      session: session([acme]),
      membership: acme,
      workspace: "not-a-workspace-of-theirs",
    });

    expect(view).toEqual({ step: "dashboard" });
  });
});

describe("loginView, signed in with nowhere to go", () => {
  it("explains rather than offering an empty list", () => {
    const view = loginView({
      session: session([]),
      membership: undefined,
      workspace: undefined,
    });

    expect(view).toEqual({ step: "no-workspace", suggestion: null, memberships: [] });
  });

  it("carries the suggestion the contract supplies for a first-run screen", () => {
    const suggestion = {
      tenantId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
      slug: "acme-robotics",
      displayName: "Acme Robotics",
    };
    const view = loginView({
      session: session([], suggestion),
      membership: undefined,
      workspace: undefined,
    });

    expect(view).toEqual({ step: "no-workspace", suggestion, memberships: [] });
  });

  it("carries the memberships that exist but are not live, so their status can be shown", () => {
    // "You belong to nothing" and "the one thing you belong to is suspended" are different
    // facts, and only one of them is a reason to talk to somebody.
    const held = membership({ status: "suspended" });
    const view = loginView({
      session: session([held]),
      membership: undefined,
      workspace: undefined,
    });

    expect(view).toEqual({ step: "no-workspace", suggestion: null, memberships: [held] });
  });

  it("does not offer a suspended workspace even when the URL asks for it by name", () => {
    const held = membership({ status: "suspended" });
    const view = loginView({
      session: session([held]),
      membership: undefined,
      workspace: held.slug,
    });

    expect(view.step).toBe("no-workspace");
  });
});

describe("enablementPath", () => {
  it("names the workspace on the login route, under the parameter the view reads", () => {
    expect(enablementPath("acme-robotics")).toBe(
      `${LOGIN_PATH}?${WORKSPACE_PARAM}=acme-robotics`,
    );
  });

  it("escapes the slug, so the redirect cannot be talked into carrying a second parameter", () => {
    expect(enablementPath("a&b=c")).toBe(`${LOGIN_PATH}?${WORKSPACE_PARAM}=a%26b%3Dc`);
  });
});
