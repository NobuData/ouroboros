import { describe, expect, it } from "vitest";

import {
  addedBy,
  approvedToast,
  deniedAgo,
  deniedToast,
  denyTitle,
  githubHandle,
  preapprovedToast,
  removedToast,
  signedInAgo,
} from "@/app/accounts/admin";
import {
  DENIED_LEAD,
  DENIED_TITLE,
  PENDING_LEAD,
  PENDING_TITLE,
  heldCopy,
  signedInAs,
} from "@/app/accounts/pending";

import { READ_AT } from "../helpers/accounts";

/**
 * Account approval's words: the waiting page's two titles are the user's own, and the accounts
 * page's sentences are built the same way everywhere they appear.
 */

const NOW = new Date(READ_AT);

describe("the waiting page's words", () => {
  it("are the user's own titles, word for word", () => {
    expect(PENDING_TITLE).toBe("Your account is waiting for approval");
    expect(DENIED_TITLE).toBe("Your account was not approved");
  });

  it("say an administrator was asked while pending, and to contact one once denied", () => {
    expect(heldCopy("pending")).toEqual({ title: PENDING_TITLE, lead: PENDING_LEAD });
    expect(PENDING_LEAD).toMatch(/administrator has been asked/);
    expect(heldCopy("denied")).toEqual({ title: DENIED_TITLE, lead: DENIED_LEAD });
    expect(DENIED_LEAD).toMatch(/Contact your administrator/);
  });

  it("name the account on hold", () => {
    expect(signedInAs("priya@contractor.dev")).toBe("Signed in as priya@contractor.dev");
  });
});

describe("the accounts page's words", () => {
  it("ask the deny question with the email in it", () => {
    expect(denyTitle("priya@contractor.dev")).toBe("Deny priya@contractor.dev?");
  });

  it("say when somebody first signed in, relative to the read", () => {
    expect(signedInAgo("2026-10-13T12:00:00.000Z", NOW)).toBe("signed in 3d ago");
  });

  it("say when and by whom an account was denied, and leave the who out when nobody is named", () => {
    expect(deniedAgo("2026-10-15T12:00:00.000Z", "ken@a.dev", "2026-10-01T00:00:00Z", NOW)).toBe(
      "denied 1d ago by ken@a.dev",
    );
    expect(deniedAgo(null, null, "2026-10-14T12:00:00.000Z", NOW)).toBe("denied 2d ago");
  });

  it("say who added a pre-approved email", () => {
    expect(addedBy("ken@a.dev", "2026-10-16T11:00:00.000Z", NOW)).toBe("added by ken@a.dev · 1h ago");
  });

  it("draw a GitHub login with its at sign, and nothing for none", () => {
    expect(githubHandle("priya-r")).toBe("@priya-r");
    expect(githubHandle(null)).toBeNull();
    expect(githubHandle("")).toBeNull();
  });

  it("toast each write", () => {
    expect(approvedToast("a@x.dev")).toBe("Approved a@x.dev.");
    expect(deniedToast("a@x.dev")).toBe("Denied a@x.dev.");
    expect(preapprovedToast("a@x.dev", false)).toBe("Pre-approved a@x.dev.");
    expect(preapprovedToast("a@x.dev", true)).toBe(
      "Pre-approved a@x.dev and approved their waiting account.",
    );
    expect(removedToast("a@x.dev")).toBe("Removed a@x.dev from the pre-approved list.");
  });

});
