import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { NOT_A_REPOSITORY, WIZARD_WRITE_FAILED } from "@/app/get-started/view";

import { membership } from "../helpers/login";
import { REPO, launchReceipt, scanProgress, seededCard, wizard } from "../helpers/onboarding";

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

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => Promise.resolve({ membership: membership() }) }));
vi.mock("@/app/api/onboarding", () => ({
  onboarding: {
    completeStep: (repo: string, step: number) => completeStep(repo, step),
    launch: (repo: string) => launch(repo),
    skip: (repo: string) => skip(repo),
    update: (repo: string, patch: unknown) => update(repo, patch),
    read: (repo: string) => read(repo),
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
vi.mock("@/app/api/orgs", () => ({ orgs: { setEnabled: (...args: unknown[]) => setOrg(...args) } }));
vi.mock("@/app/api/repos", () => ({ repos: { setEnabled: (...args: unknown[]) => setRepo(...args) } }));

const {
  continueStep,
  dismissWizard,
  enableRepository,
  launchFirstLoop,
  previewProtectedPaths,
  rescanRepository,
  saveProtectedPaths,
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
  for (const mock of [completeStep, launch, skip, update, read, readEnablement, setOrg, setRepo, scan, editProtectedPaths, pathPreview]) {
    mock.mockReset();
  }
  completeStep.mockResolvedValue(wizard());
  launch.mockResolvedValue(launchReceipt());
  skip.mockResolvedValue({ onboarding: wizard(), settingsPath: "/settings", configurationImported: false });
  update.mockResolvedValue(wizard({ surfacing: { offer: false, reason: "wizard_finished" } }));
  read.mockResolvedValue(wizard());
  setOrg.mockResolvedValue({});
  setRepo.mockResolvedValue({});
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

describe("enabling the repository (step 2)", () => {
  it("turns on the repository — and its account when that is off too — then re-reads the wizard", async () => {
    readEnablement.mockResolvedValue(enablement(false, false));

    expect(await enableRepository(REPO)).toEqual({ ok: true, value: wizard() });
    expect(setOrg).toHaveBeenCalledWith(membership().id, "acme-robotics", true);
    expect(setRepo).toHaveBeenCalledWith(membership().id, "acme-robotics", "helios-firmware", true);
  });

  it("writes only what is off", async () => {
    readEnablement.mockResolvedValue(enablement(true, false));

    await enableRepository("Acme-Robotics/Helios-Firmware");

    expect(setOrg).not.toHaveBeenCalled();
    expect(setRepo).toHaveBeenCalledOnce();
  });

  it("refuses a repository this workspace does not mirror, in the service's sentence, writing nothing", async () => {
    readEnablement.mockResolvedValue(enablement(true, true));

    expect(await enableRepository("acme-robotics/nowhere")).toEqual({
      ok: false,
      reason: "acme-robotics/nowhere is not a repository of this workspace's GitHub accounts.",
    });
    expect(setRepo).not.toHaveBeenCalled();
  });

  it("carries the service's refusal of a person who may not enable", async () => {
    readEnablement.mockResolvedValue(enablement(true, false));
    setRepo.mockRejectedValue(new ApiError(403, "insufficient_role", "Only an owner or admin can change this."));

    expect(await enableRepository(REPO)).toEqual({ ok: false, reason: "Only an owner or admin can change this." });
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

