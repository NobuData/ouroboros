import { describe, expect, it } from "vitest";

import { accountMenuLabel, accountView } from "@/app/shell/account";

import { MENU_USER, menuWorkspaces } from "../helpers/account";

/**
 * What the account menu shows, decided from the browser's session and nothing else.
 *
 * The component around this is a menu — focus, keys, a submenu — and none of that has an
 * opinion about *what* is drawn. These are the opinions, and they are here because each one
 * has a case that a rendering test would state as a query selector rather than as a sentence:
 * a session still loading is not a signed-out one, a single workspace you are already in is
 * not a choice, and a pointer naming a workspace the listing does not hold is neither an
 * active workspace nor an error.
 */

/** The three seeded workspaces, and the one a fresh session acts in. */
const WORKSPACES = menuWorkspaces();
const ACTIVE = WORKSPACES[0];

/**
 * A signed-in reading, with whatever this case is about overridden.
 *
 * @param over The fields this case changes.
 * @returns The reading to decide from.
 */
function reading(over: Partial<Parameters<typeof accountView>[0]> = {}) {
  return {
    user: MENU_USER,
    activeOrganizationId: ACTIVE.id,
    organizations: WORKSPACES,
    pending: false,
    ...over,
  };
}

describe("while the session is still being read", () => {
  it("is pending rather than signed out", () => {
    // The distinction the whole type exists for: a menu that read *no answer yet* as *nobody*
    // would tell every reader they were signed out for as long as the first request takes.
    expect(accountView({ ...reading(), user: null, pending: true })).toEqual({
      state: "pending",
    });
  });

  it("is named without a claim about who is signed in", () => {
    expect(accountMenuLabel({ state: "pending" })).toBe("Account menu");
  });
});

describe("when the session answered nobody", () => {
  it("is signed out", () => {
    expect(accountView({ ...reading(), user: null, pending: false })).toEqual({
      state: "signed-out",
    });
  });

  it("says so in the control's name", () => {
    expect(accountMenuLabel({ state: "signed-out" })).toBe("Account menu — not signed in");
  });
});

describe("when somebody is signed in", () => {
  it("reports the person in the words the menu draws them in", () => {
    const view = accountView(reading());

    expect(view).toMatchObject({
      state: "signed-in",
      person: {
        name: "Ken Suenobu",
        email: "ken@acme-robotics.dev",
        avatarUrl: null,
      },
    });
  });

  it("falls back to the address when there is no name", () => {
    // The same fallback the login card's identity line makes, for the same reason: an
    // account with no display name still has to be called something.
    const view = accountView(reading({ user: { ...MENU_USER, name: "  " } }));

    expect(view).toMatchObject({ person: { name: "ken@acme-robotics.dev" } });
  });

  it("reads a blank picture as no picture", () => {
    // `<img src="">` re-requests the current page in every browser, so an empty string has to
    // become the monogram rather than an image element.
    const view = accountView(reading({ user: { ...MENU_USER, image: "   " } }));

    expect(view).toMatchObject({ person: { avatarUrl: null } });
  });

  it("carries the picture when the identity provider sent one", () => {
    const view = accountView(
      reading({ user: { ...MENU_USER, image: "https://avatars.test/ken.png" } }),
    );

    expect(view).toMatchObject({ person: { avatarUrl: "https://avatars.test/ken.png" } });
  });

  it("resolves the session's pointer against the listing", () => {
    const view = accountView(reading());

    expect(view).toMatchObject({ active: ACTIVE, workspaces: WORKSPACES });
  });

  it("names it in the control's name, so the menu need not be opened to answer it", () => {
    expect(accountMenuLabel(accountView(reading()))).toBe(
      "Account menu — Ken Suenobu, acme-robotics",
    );
  });
});

describe("the pointer is a reference, not a fact", () => {
  it("resolves to no workspace when the session is acting nowhere", () => {
    const view = accountView(reading({ activeOrganizationId: null }));

    expect(view).toMatchObject({ active: undefined, switchable: true });
  });

  it("resolves to no workspace when it names one the listing does not hold", () => {
    // A session pointing at a workspace somebody has since been removed from. The menu says
    // nothing about it rather than drawing a name it cannot check.
    const view = accountView(reading({ activeOrganizationId: "5eed0001-0000-4000-8000-00000000ffff" }));

    expect(view).toMatchObject({ active: undefined });
  });

  it("names only the person when there is no workspace to name", () => {
    expect(accountMenuLabel(accountView(reading({ activeOrganizationId: null })))).toBe(
      "Account menu — Ken Suenobu",
    );
  });
});

describe("whether there is anywhere to switch to", () => {
  it("is true when more than one workspace exists", () => {
    expect(accountView(reading())).toMatchObject({ switchable: true });
  });

  it("is false for the only workspace, which the session is already in", () => {
    // The honesty rule (§ 3.5) applied to a chooser: a control whose only option is the one
    // already chosen is a control that cannot be changed, and step 2 makes the same call.
    const view = accountView(reading({ organizations: [ACTIVE] }));

    expect(view).toMatchObject({ switchable: false, active: ACTIVE });
  });

  it("is true for a single workspace the session is not in, which can still be entered", () => {
    // The case that makes this a judgement rather than a length check.
    const view = accountView(reading({ organizations: [ACTIVE], activeOrganizationId: null }));

    expect(view).toMatchObject({ switchable: true, active: undefined });
  });

  it("is false while the listing has not arrived", () => {
    // The session answers before the listing does, and a switcher drawn over an empty list is
    // a submenu that opens onto nothing.
    const view = accountView(reading({ organizations: null }));

    expect(view).toMatchObject({ switchable: false, workspaces: [], active: undefined });
  });
});

describe("the role beside the address (#645)", () => {
  /** A signed-in view, narrowed — these cases are all about `person`, which only it has. */
  function signedInView(over: Partial<Parameters<typeof accountView>[0]> = {}) {
    const view = accountView(reading(over));
    if (view.state !== "signed-in") throw new Error(`expected signed-in, got ${view.state}`);
    return view;
  }

  it("is null while nothing has answered — never a guess", () => {
    // § 3.5: while the fetch is out the address stands alone. Both spellings of "not
    // known" read the same, because they are the same knowledge.
    expect(signedInView().person.role).toBeNull();
    expect(signedInView({ activeRole: null }).person.role).toBeNull();
  });

  it("is the plugin's word once it has answered", () => {
    expect(signedInView({ activeRole: "admin" }).person.role).toBe("admin");
  });

  it("collapses a multi-role membership to the strongest word", () => {
    // The plugin's addMember accepts an array and joins it, so the column can hold
    // "admin,member" — and somebody who is an admin and a member may do everything an
    // admin may. primaryRole's collapse, the same one the dashboard subline makes.
    expect(signedInView({ activeRole: "member, admin" }).person.role).toBe("admin");
  });

  it("reads only-unknown words as viewer, which is what primaryRole grants an empty list", () => {
    // The service granted *something*; the least is the only safe reading of words this
    // build does not know.
    expect(signedInView({ activeRole: "superuser" }).person.role).toBe("viewer");
  });

  it("names no role when the session acts nowhere, whatever the text says", () => {
    // A role is a role *in* somewhere. A stale answer arriving after a switch to acting
    // nowhere must not dress the identity block with it.
    expect(
      signedInView({ activeOrganizationId: null, activeRole: "owner" }).person.role,
    ).toBeNull();
  });
});
