import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { NOT_AN_ISSUE } from "@/app/get-started/first-issue-view";
import { NOT_A_REPOSITORY, WIZARD_WRITE_FAILED } from "@/app/get-started/view";

import { membership } from "../helpers/login";
import { ISSUE_488, ISSUE_491, REPO, launchReceipt, scanProgress, seededCard, templateSelection, wizard } from "../helpers/onboarding";
import { source, sourcePage } from "../helpers/sources";

/** The wizard's writes (#390): each guarded by the service, a refusal carried in its words. */

const completeStep = vi.fn();
const launch = vi.fn();
const skip = vi.fn();
const update = vi.fn();
const read = vi.fn();
const readEnablement = vi.fn();
const setOrg = vi.fn();
const setRepo = vi.fn();
const scan = vi.fn();
const editProtectedPaths = vi.fn();
const pathPreview = vi.fn();
const selectTemplateCall = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => Promise.resolve({ membership: membership() }) }));
vi.mock("@/app/api/onboarding", () => ({
  onboarding: {
    completeStep: (repo: string, step: number) => completeStep(repo, step),
    launch: (repo: string) => launch(repo),
    skip: (repo: string) => skip(repo),
    update: (repo: string, patch: unknown) => update(repo, patch),
    read: (repo: string) => read(repo),
    selectTemplate: (repo: string, slug: string) => selectTemplateCall(repo, slug),
  },
}));
vi.mock("@/app/api/detection", () => ({
  detection: {
    scan: (repo: string) => scan(repo),
    editProtectedPaths: (repo: string, globs: readonly string[]) => editProtectedPaths(repo, globs),
  },
}));
vi.mock("@/app/api/org-policy", () => ({ orgPolicy: { pathPreview: (globs: readonly string[]) => pathPreview(globs) } }));
vi.mock("@/app/api/enablement", () => ({ readEnablement: (tenant: string) => readEnablement(tenant) }));
vi.mock("@/app/api/orgs", () => ({
  orgs: { setEnabled: (...args: unknown[]) => setOrg(...args), record: (...args: unknown[]) => recordOrg(...args) },
}));
vi.mock("@/app/api/repos", () => ({ repos: { setEnabled: (...args: unknown[]) => setRepo(...args) } }));
vi.mock("@/app/api/sources", () => ({ sources: { list: () => listSources() } }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirect(path);
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

const recordOrg = vi.fn();
const listSources = vi.fn();
const redirect = vi.fn();

const {
  continueStep,
  dismissWizard,
  enableRepository,
  launchFirstLoop,
  pickFirstIssue,
  previewProtectedPaths,
  rescanRepository,
  saveProtectedPaths,
  selectTemplate,
  setRepositoryEnabled,
  skipWizard,
} = await import("@/app/get-started/actions");

/** An enablement list with the seeded account and repository. */
function enablement(orgEnabled: boolean, repoEnabled: boolean) {
  return {
    orgTotal: 1,
    orgs: [
      {
        org: { login: "acme-robotics", enabled: orgEnabled },
        repos: [{ name: "helios-firmware", enabled: repoEnabled }],
        repoTotal: 1,
      },
    ],
  };
}

beforeEach(() => {
  for (const mock of [
    completeStep,
    launch,
    skip,
    update,
    read,
    readEnablement,
    setOrg,
    setRepo,
    scan,
    editProtectedPaths,
    pathPreview,
    selectTemplateCall,
  ]) {
    mock.mockReset();
  }
  completeStep.mockResolvedValue(wizard());
  launch.mockResolvedValue(launchReceipt());
  skip.mockResolvedValue({ onboarding: wizard(), settingsPath: "/settings", configurationImported: false });
  update.mockResolvedValue(wizard({ surfacing: { offer: false, reason: "wizard_finished" } }));
  read.mockResolvedValue(wizard());
  setOrg.mockResolvedValue({});
  setRepo.mockResolvedValue({});
  for (const mock of [recordOrg, listSources, redirect]) mock.mockReset();
  recordOrg.mockResolvedValue({});
  listSources.mockResolvedValue(sourcePage([source()]));
  scan.mockResolvedValue(scanProgress());
});

describe("the wizard's writes", () => {
  it("continues a step through the service's guard", async () => {
    expect(await continueStep(REPO, 3)).toEqual({ ok: true, value: wizard() });
    expect(completeStep).toHaveBeenCalledWith(REPO, 3);
  });

  it("carries the guard's refusal in its own words", async () => {
    completeStep.mockRejectedValue(new ApiError(409, "onboarding_step_incomplete", "No workflow has been created from the quick-fixes template yet."));

    expect(await continueStep(REPO, 3)).toEqual({
      ok: false,
      reason: "No workflow has been created from the quick-fixes template yet.",
    });
  });

  it("refuses a step outside 1–3 without asking — step 4 is the launch", async () => {
    for (const step of [0, 4, 2.5, Number.NaN]) {
      expect(await continueStep(REPO, step)).toEqual({ ok: false, reason: WIZARD_WRITE_FAILED });
    }
    expect(completeStep).not.toHaveBeenCalled();
  });

  it("refuses a repository that is not one, before any call", async () => {
    for (const write of [() => continueStep("x", 1), () => launchFirstLoop("../etc"), () => skipWizard(""), () => dismissWizard("a/b/c")]) {
      expect(await write()).toEqual({ ok: false, reason: NOT_A_REPOSITORY });
    }
    expect(launch).not.toHaveBeenCalled();
    expect(skip).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("says a plain failure for the service's own failure, never its internals", async () => {
    launch.mockRejectedValue(new ApiError(500, "internal_error", "boom"));

    expect(await launchFirstLoop(REPO)).toEqual({ ok: false, reason: WIZARD_WRITE_FAILED });
  });

  it("lets a bug through rather than dress it as a refusal", async () => {
    launch.mockRejectedValue(new TypeError("undefined is not a function"));

    await expect(launchFirstLoop(REPO)).rejects.toThrow(TypeError);
  });

  it("launches, skips to the settings path the service names, and dismisses", async () => {
    expect(await launchFirstLoop(REPO)).toEqual({ ok: true, value: launchReceipt() });
    expect(await skipWizard(REPO)).toEqual({ ok: true, value: "/settings" });
    expect(await dismissWizard(REPO)).toEqual({ ok: true, value: false });
    expect(update).toHaveBeenCalledWith(REPO, { dismissed: true });
  });
});

describe("the first-issue card's writes (#393)", () => {
  it("stores a pick by the picker's id, scoped to the repository", async () => {
    expect(await pickFirstIssue(REPO, ISSUE_491)).toEqual({ ok: true, value: wizard({ surfacing: { offer: false, reason: "wizard_finished" } }) });
    expect(update).toHaveBeenCalledExactlyOnceWith(REPO, { pickedIssueId: ISSUE_491 });
  });

  it("refuses an id that is not one, and a repository that is not one, asking nothing", async () => {
    expect(await pickFirstIssue(REPO, "issue-491")).toEqual({ ok: false, reason: NOT_AN_ISSUE });
    expect(await pickFirstIssue("nope", ISSUE_491)).toEqual({ ok: false, reason: NOT_A_REPOSITORY });
    expect(await launchFirstLoop(REPO, "488")).toEqual({ ok: false, reason: NOT_AN_ISSUE });
    expect(update).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it("carries the service's refusal of a pick in its words", async () => {
    update.mockRejectedValue(new ApiError(404, "onboarding_issue_not_found", "#491 is not an issue of this repository's backlog."));

    expect(await pickFirstIssue(REPO, ISSUE_491)).toEqual({ ok: false, reason: "#491 is not an issue of this repository's backlog." });
  });

  it("stores the suggestion before the launch when the wizard stores no pick", async () => {
    const order: string[] = [];
    update.mockImplementation(() => {
      order.push("update");
      return Promise.resolve(wizard());
    });
    launch.mockImplementation(() => {
      order.push("launch");
      return Promise.resolve(launchReceipt());
    });

    expect(await launchFirstLoop(REPO, ISSUE_488)).toEqual({ ok: true, value: launchReceipt() });
    expect(update).toHaveBeenCalledExactlyOnceWith(REPO, { pickedIssueId: ISSUE_488 });
    expect(order).toEqual(["update", "launch"]);
  });

  it("launches nothing when the store is refused", async () => {
    update.mockRejectedValue(new ApiError(403, "forbidden", "Viewers cannot pick."));

    expect(await launchFirstLoop(REPO, ISSUE_488)).toEqual({ ok: false, reason: "Viewers cannot pick." });
    expect(launch).not.toHaveBeenCalled();
  });

  it("stores nothing when a pick is stored already", async () => {
    expect(await launchFirstLoop(REPO)).toEqual({ ok: true, value: launchReceipt() });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("enabling the repository (step 2)", () => {
  it("turns on the repository — and its account when that is off too — starts the scan, then re-reads the wizard", async () => {
    readEnablement.mockResolvedValue(enablement(false, false));

    expect(await enableRepository(REPO)).toEqual({ ok: true, value: wizard() });
    expect(setOrg).toHaveBeenCalledWith(membership().id, "acme-robotics", true);
    expect(setRepo).toHaveBeenCalledWith(membership().id, "acme-robotics", "helios-firmware", true);
    expect(scan).toHaveBeenCalledWith(REPO);
    expect(recordOrg).not.toHaveBeenCalled();
  });

  it("writes only what is off", async () => {
    readEnablement.mockResolvedValue(enablement(true, false));

    await enableRepository("Acme-Robotics/Helios-Firmware");

    expect(setOrg).not.toHaveBeenCalled();
    expect(setRepo).toHaveBeenCalledOnce();
  });

  it("records the account and the repository first when the mirror does not hold them yet (#395)", async () => {
    readEnablement.mockResolvedValue({ orgTotal: 0, orgs: [] });

    expect(await enableRepository(REPO)).toEqual({ ok: true, value: wizard() });
    expect(recordOrg).toHaveBeenCalledWith(membership().id, "acme-robotics", true);
    expect(setOrg).not.toHaveBeenCalled();
    // The tenancy API's upsert: a repository comes to be known by being switched on.
    expect(setRepo).toHaveBeenCalledWith(membership().id, "acme-robotics", "helios-firmware", true);
    expect(scan).toHaveBeenCalledWith(REPO);
  });

  it("refuses a repository no GitHub source names, saying what to do first, writing nothing (#395)", async () => {
    readEnablement.mockResolvedValue(enablement(true, true));

    expect(await enableRepository("acme-robotics/nowhere")).toEqual({
      ok: false,
      reason: "No GitHub source names acme-robotics/nowhere — connect one that does first.",
    });
    expect(recordOrg).not.toHaveBeenCalled();
    expect(setRepo).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });

  it("lets the scan's own refusals through — a debounce undoes no enablement (#395)", async () => {
    readEnablement.mockResolvedValue(enablement(true, false));
    scan.mockRejectedValue(new ApiError(409, "detection_rescan_too_soon", "A scan ran 10 seconds ago."));

    expect(await enableRepository(REPO)).toEqual({ ok: true, value: wizard() });
    expect(setRepo).toHaveBeenCalledOnce();
  });

  it("carries the service's refusal of a person who may not enable", async () => {
    readEnablement.mockResolvedValue(enablement(true, false));
    setRepo.mockRejectedValue(new ApiError(403, "insufficient_role", "Only an owner or admin can change this."));

    expect(await enableRepository(REPO)).toEqual({ ok: false, reason: "Only an owner or admin can change this." });
  });
});

describe("the picker's switch (#395)", () => {
  /** A submitted switch form. */
  function form(repo: string | null, enabled: string | null): FormData {
    const data = new FormData();

    if (repo !== null) data.set("repo", repo);
    if (enabled !== null) data.set("enabled", enabled);

    return data;
  }

  it("switches a repository on — recording it when needed — and renders its wizard afresh", async () => {
    readEnablement.mockResolvedValue({ orgTotal: 0, orgs: [] });

    await expect(setRepositoryEnabled(form(REPO, "true"))).rejects.toThrow(`NEXT_REDIRECT:/get-started?repo=${encodeURIComponent(REPO)}`);
    expect(recordOrg).toHaveBeenCalledWith(membership().id, "acme-robotics", true);
    expect(setRepo).toHaveBeenCalledWith(membership().id, "acme-robotics", "helios-firmware", true);
    expect(scan).toHaveBeenCalledWith(REPO);
  });

  it("switches a repository off — its own flag only, the account untouched", async () => {
    readEnablement.mockResolvedValue(enablement(true, true));

    await expect(setRepositoryEnabled(form(REPO, "false"))).rejects.toThrow("NEXT_REDIRECT:/get-started?repo=");
    expect(setRepo).toHaveBeenCalledWith(membership().id, "acme-robotics", "helios-firmware", false);
    expect(setOrg).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });

  it("sends a malformed repository back to the wizard, and refuses a flag that is not a flag", async () => {
    await expect(setRepositoryEnabled(form("not a repo", "true"))).rejects.toThrow("NEXT_REDIRECT:/get-started");
    await expect(setRepositoryEnabled(form(REPO, "yes"))).rejects.toThrow('must be exactly "true" or "false"');
    expect(readEnablement).not.toHaveBeenCalled();
    expect(setRepo).not.toHaveBeenCalled();
  });
});

describe("the detection card's writes (#391)", () => {
  it("re-scans the validated repository and answers the progress", async () => {
    scan.mockResolvedValue({ progress: scanProgress(), joined: false });

    expect(await rescanRepository(REPO)).toEqual({ ok: true, value: { progress: scanProgress(), joined: false } });
    expect(scan).toHaveBeenCalledWith(REPO);
  });

  it("carries the debounce's refusal in the service's words", async () => {
    scan.mockRejectedValue(
      new ApiError(409, "detection_rescan_too_soon", "This repository was scanned a moment ago. Try again shortly."),
    );

    expect(await rescanRepository(REPO)).toEqual({
      ok: false,
      reason: "This repository was scanned a moment ago. Try again shortly.",
    });
  });

  it("refuses a repository that is not one, asking nothing", async () => {
    expect(await rescanRepository("../etc")).toEqual({ ok: false, reason: NOT_A_REPOSITORY });
    expect(await saveProtectedPaths("nope", ["boot/**"])).toEqual({ ok: false, reason: NOT_A_REPOSITORY });
    expect(scan).not.toHaveBeenCalled();
    expect(editProtectedPaths).not.toHaveBeenCalled();
  });

  it("saves the whole list and answers the card as stored", async () => {
    const stored = seededCard({ protectedPaths: [{ glob: "boot/**", source: "edited" }] });
    editProtectedPaths.mockResolvedValue(stored);

    expect(await saveProtectedPaths(REPO, ["boot/**"])).toEqual({ ok: true, value: stored });
    expect(editProtectedPaths).toHaveBeenCalledWith(REPO, ["boot/**"]);
  });

  it("carries the service's glob refusal and its role refusal in its words", async () => {
    editProtectedPaths.mockRejectedValueOnce(
      new ApiError(422, "detection_glob_invalid", '"/etc/**" is not a path pattern the guardrails can enforce.'),
    );
    editProtectedPaths.mockRejectedValueOnce(new ApiError(403, "forbidden", "Owners and admins only."));

    expect(await saveProtectedPaths(REPO, ["/etc/**"])).toEqual({
      ok: false,
      reason: '"/etc/**" is not a path pattern the guardrails can enforce.',
    });
    expect(await saveProtectedPaths(REPO, ["boot/**"])).toEqual({ ok: false, reason: "Owners and admins only." });
  });

  it("refuses a list that is not one before asking — a Server Action is a public endpoint", async () => {
    const tooMany = Array.from({ length: 65 }, (_, index) => `d${String(index)}/**`);

    expect(await saveProtectedPaths(REPO, tooMany)).toEqual({ ok: false, reason: WIZARD_WRITE_FAILED });
    expect(await saveProtectedPaths(REPO, [7] as unknown as string[])).toEqual({ ok: false, reason: WIZARD_WRITE_FAILED });
    expect(await saveProtectedPaths(REPO, "boot/**" as unknown as string[])).toEqual({
      ok: false,
      reason: WIZARD_WRITE_FAILED,
    });
    expect(editProtectedPaths).not.toHaveBeenCalled();
  });

  it("previews only the wizard's repository", async () => {
    const repository = (name: string) => ({
      repository: name,
      status: "listed" as const,
      reason: null,
      fileCount: 12,
      truncated: false,
      globs: [{ glob: "boot/**", matchCount: 3, samples: ["boot/a.c"] }],
    });
    pathPreview.mockResolvedValue({ repositories: [repository("acme-robotics/other"), repository("Acme-Robotics/Helios-Firmware")] });

    expect(await previewProtectedPaths(REPO, ["boot/**"])).toEqual({
      ok: true,
      repositories: [repository("Acme-Robotics/Helios-Firmware")],
    });
    expect(pathPreview).toHaveBeenCalledWith(["boot/**"]);
  });

  it("says why there is no preview, in the service's words when it refused", async () => {
    pathPreview.mockRejectedValueOnce(new ApiError(403, "forbidden", "Owners and admins only."));
    pathPreview.mockRejectedValueOnce(new ApiError(500, "internal_error", "boom"));

    expect(await previewProtectedPaths(REPO, ["boot/**"])).toEqual({ ok: false, reason: "Owners and admins only." });
    expect(await previewProtectedPaths(REPO, ["boot/**"])).toEqual({
      ok: false,
      reason: "The match preview could not be read. The patterns themselves are unaffected.",
    });
    expect(await previewProtectedPaths("nope", ["boot/**"])).toMatchObject({ ok: false });
  });
});

describe("selecting a template (#392)", () => {
  it("selects the validated repository's template and answers the selection", async () => {
    selectTemplateCall.mockResolvedValue(templateSelection());

    expect(await selectTemplate(REPO, "quick-fixes")).toEqual({ ok: true, value: templateSelection() });
    expect(selectTemplateCall).toHaveBeenCalledWith(REPO, "quick-fixes");
  });

  it("carries the lock's and the role's refusals in the service's words, with no findings", async () => {
    selectTemplateCall.mockRejectedValueOnce(
      new ApiError(409, "onboarding_template_locked", "The deep-refactor template is locked: unlock after 10 merged loops (3 of 10 merged loops so far)."),
    );
    selectTemplateCall.mockRejectedValueOnce(new ApiError(403, "forbidden", "Owners and admins only."));

    expect(await selectTemplate(REPO, "deep-refactor")).toEqual({
      ok: false,
      reason: "The deep-refactor template is locked: unlock after 10 merged loops (3 of 10 merged loops so far).",
      findings: [],
    });
    expect(await selectTemplate(REPO, "quick-fixes")).toEqual({ ok: false, reason: "Owners and admins only.", findings: [] });
  });

  it("carries the publish gate's findings when the definition was refused — nothing created", async () => {
    selectTemplateCall.mockRejectedValue(
      new ApiError(422, "onboarding_template_invalid", "The quick-fixes template could not be turned into a workflow.", {
        slug: "quick-fixes",
        version: 1,
        findings: [
          { source: "dsl", code: "unreachable_node", message: "Stage review is unreachable.", path: "/nodes/3" },
          { source: "registry", code: "alias_unknown", message: "No model alias named fast-coder." },
        ],
      }),
    );

    expect(await selectTemplate(REPO, "quick-fixes")).toEqual({
      ok: false,
      reason: "The quick-fixes template could not be turned into a workflow.",
      findings: [
        { source: "dsl", code: "unreachable_node", message: "Stage review is unreachable.", path: "/nodes/3" },
        { source: "registry", code: "alias_unknown", message: "No model alias named fast-coder.", path: null },
      ],
    });
  });

  it("reads a server failure as a plain failure, and a 422 validation as its words", async () => {
    selectTemplateCall.mockRejectedValueOnce(new ApiError(500, "internal_error", "boom"));
    selectTemplateCall.mockRejectedValueOnce(new ApiError(422, "onboarding_template_unknown", "Not offered: nope.", { offered: ["quick-fixes"] }));

    expect(await selectTemplate(REPO, "quick-fixes")).toEqual({ ok: false, reason: WIZARD_WRITE_FAILED, findings: [] });
    expect(await selectTemplate(REPO, "nope")).toEqual({ ok: false, reason: "Not offered: nope.", findings: [] });
  });

  it("refuses a repository or a template that is not one, asking nothing", async () => {
    expect(await selectTemplate("../etc", "quick-fixes")).toEqual({ ok: false, reason: NOT_A_REPOSITORY, findings: [] });
    expect(await selectTemplate(REPO, "Quick Fixes")).toEqual({ ok: false, reason: "That is not a template.", findings: [] });
    expect(await selectTemplate(REPO, "../x")).toMatchObject({ ok: false });
    expect(await selectTemplate(REPO, 7 as unknown as string)).toMatchObject({ ok: false });
    expect(selectTemplateCall).not.toHaveBeenCalled();
  });
});

