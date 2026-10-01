import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextManifest } from "@/app/api/context";
import type { PreviewOutcome } from "@/app/knowledge/preview-actions";
import {
  ABSENT_HEADING,
  ESTIMATOR_FACTS_ONLY,
  FACTS_HEADING,
  NO_FACTS_RESOLVED,
  NO_SKILLS_RESOLVED,
  NO_WORKFLOW,
  PREVIEW_ACTION,
  PREVIEW_CLOSE,
  PREVIEW_CONSUMER_LABEL,
  PREVIEW_LOADING,
  PREVIEW_NOTHING,
  PREVIEW_REPO_LABEL,
  PREVIEW_TITLE,
  PREVIEW_WORKFLOW_LABEL,
  REQUIRED_BADGE,
  SKILLS_HEADING,
  TRIMMED_HEADING,
  TRIM_POLICY,
  UNOVERRIDABLE_NOTE,
  WORKSPACE_WIDE,
  counting,
} from "@/app/knowledge/preview";

import { type ManifestName, SEEDED_REPO, manifest, seededFacts, seededRepos, skillsWithOverrides } from "../helpers/knowledge";
import { PALETTES, renderInPalette } from "../helpers/palettes";

/**
 * **Preview injection ▾** as it is drawn (#421): the read in the press that opens it, on the
 * ladder's scope; BF.5's fixtures (#414) listed exactly — the workflow-override case, the trim
 * case, the absent draft; every change of scope or consumer asked again, the newest answer
 * winning; and the refusal, the empty manifest and the loading line.
 */

const previewContext = vi.fn();

vi.mock("@/app/knowledge/preview-actions", () => ({
  previewContext: (consumer: string, repo: string | null, workflow: string | null) => previewContext(consumer, repo, workflow),
}));

const { ManifestPreview } = await import("@/app/knowledge/manifest-preview");

/**
 * A successful answer.
 *
 * @param name Which of assembly's fixtures.
 * @returns The outcome.
 */
function answer(name: ManifestName): PreviewOutcome {
  return { ok: true, value: manifest(name) };
}

/**
 * The action, over the registry the override fixture was assembled from.
 *
 * @param repo The repository the ladder calls current.
 * @returns The element.
 */
function action(repo: string | null = SEEDED_REPO) {
  return (
    <ManifestPreview
      facts={{ ok: true, value: seededFacts() }}
      repo={repo}
      repos={{ ok: true, value: seededRepos() }}
      skills={{ ok: true, value: skillsWithOverrides() }}
    />
  );
}

/**
 * Open the dialog and wait for its first manifest.
 *
 * @returns The dialog.
 */
async function open(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: PREVIEW_ACTION }));

  const dialog = await screen.findByRole("dialog", { name: PREVIEW_TITLE });

  await waitFor(() => {
    expect(within(dialog).queryByText(PREVIEW_LOADING)).toBeNull();
  });

  return dialog;
}

/**
 * The rows of one section, as text.
 *
 * @param dialog The dialog.
 * @param heading The section's heading, count included.
 * @returns Each row's text.
 */
function rows(dialog: HTMLElement, heading: string): string[] {
  return within(within(dialog).getByRole("region", { name: heading }))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

beforeEach(() => {
  previewContext.mockReset().mockResolvedValue(answer("seeded"));
});

describe("opening", () => {
  it("reads in the same press, for a run stage in the ladder's repository with no workflow", async () => {
    render(action());

    expect(previewContext).not.toHaveBeenCalled();

    const dialog = await open();

    expect(previewContext).toHaveBeenCalledExactlyOnceWith("run_stage", SEEDED_REPO, null);
    expect(within(dialog).getByLabelText(PREVIEW_REPO_LABEL)).toHaveValue(SEEDED_REPO);
    expect(within(dialog).getByLabelText(PREVIEW_WORKFLOW_LABEL)).toHaveDisplayValue(NO_WORKFLOW);
    expect(within(dialog).getByLabelText(PREVIEW_CONSUMER_LABEL)).toHaveValue("run_stage");
  });

  it("opens workspace-wide when the tenant chip names no repository", async () => {
    previewContext.mockResolvedValue(answer("workspaceWide"));
    render(action(null));

    const dialog = await open();

    expect(previewContext).toHaveBeenCalledExactlyOnceWith("run_stage", null, null);
    expect(within(dialog).getByLabelText(PREVIEW_REPO_LABEL)).toHaveDisplayValue(WORKSPACE_WIDE);
  });

  it("says it is assembling while the answer is on its way", () => {
    previewContext.mockReturnValue(new Promise(() => {}));
    render(action());

    fireEvent.click(screen.getByRole("button", { name: PREVIEW_ACTION }));

    expect(within(screen.getByRole("dialog")).getByText(PREVIEW_LOADING)).toHaveAttribute("role", "status");
  });

  it("closes, and reads afresh on the next opening", async () => {
    render(action());

    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: PREVIEW_CLOSE }));

    expect(screen.queryByRole("dialog")).toBeNull();

    await open();

    expect(previewContext).toHaveBeenCalledTimes(2);
  });
});

describe("assembly's fixtures, as drawn", () => {
  it("lists the seeded manifest exactly: skills in the manifest's order, facts, the estimate and the identity", async () => {
    render(action());

    const dialog = await open();

    expect(rows(dialog, counting(SKILLS_HEADING, 5))).toEqual([
      `hil-safety@v3${REQUIRED_BADGE} — ${UNOVERRIDABLE_NOTE}repo~10 tokens`,
      "repo-map@v60repo~9 tokens",
      "zephyr-conventions@v12repo~14 tokens",
      "commit-style@v2org-wide~11 tokens",
      "pr-etiquette@v4org-wide~11 tokens",
    ]);
    expect(rows(dialog, counting(FACTS_HEADING, 2))).toEqual([
      "Tests under tests/hil/ require rig reservation via rig claimrepo~16 tokens",
      "CI needs west update before first build of the dayorg-wide~13 tokens",
    ]);
    expect(dialog).toHaveTextContent("~84 tokens of the 32.0k budget");
    expect(dialog).toHaveTextContent("manifest 529a6a637e3b");
    expect(within(dialog).queryByRole("region", { name: new RegExp(TRIMMED_HEADING) })).toBeNull();
  });

  it("badges the required skill and says it cannot be overridden", async () => {
    render(action());

    const dialog = await open();
    const badges = within(dialog).getAllByTitle(UNOVERRIDABLE_NOTE);

    expect(badges).toHaveLength(1);
    expect(badges[0]?.closest("li")).toHaveTextContent("hil-safety@v3");
  });

  it("draws a fact's inline code as code", async () => {
    render(action());

    const dialog = await open();

    expect([...dialog.querySelectorAll("code")].map((code) => code.textContent)).toEqual(["tests/hil/", "rig claim", "west update"]);
  });

  it("never lists the draft, and explains its absence", async () => {
    render(action());

    const dialog = await open();
    const absent = rows(dialog, counting(ABSENT_HEADING, 4));

    expect(rows(dialog, counting(SKILLS_HEADING, 5)).join(" ")).not.toContain("power-budget-checks");
    expect(absent).toContain("power-budget-checksrepoa draft — drafts never inject");
    expect(absent).toContain("commit-style-fixworkflowscoped to the workflow standard-fix — this preview names no workflow");
  });

  it("shows the workflow-override case once the workflow is in scope", async () => {
    render(action());

    const dialog = await open();
    previewContext.mockResolvedValue(answer("workflowOverride"));
    fireEvent.change(within(dialog).getByLabelText(PREVIEW_WORKFLOW_LABEL), { target: { value: "standard-fix" } });

    await waitFor(() => {
      expect(previewContext).toHaveBeenLastCalledWith("run_stage", SEEDED_REPO, "standard-fix");
      expect(within(dialog).queryByText(PREVIEW_LOADING)).toBeNull();
    });

    expect(rows(dialog, counting(SKILLS_HEADING, 4))).toEqual([
      `hil-safety@v3${REQUIRED_BADGE} — ${UNOVERRIDABLE_NOTE}repo~10 tokens`,
      "commit-style-fix@v1workflow~13 tokens",
      "repo-map@v60repo~9 tokens",
      "zephyr-conventions@v12repo~14 tokens",
    ]);
    expect(rows(dialog, counting(ABSENT_HEADING, 5))).toEqual([
      "commit-styleorg-wideoverridden by commit-style-fix — the closest scope wins",
      "hil-safety-offworkflowoverridden by hil-safety, which is required — a required skill cannot be overridden",
      "pr-etiquetteorg-wideoverridden by pr-etiquette-off — the closest scope wins",
      "pr-etiquette-offworkflowswitched off — and as the closest skill of its name, it keeps farther ones out too",
      "power-budget-checksrepoa draft — drafts never inject",
    ]);
  });

  it("renders a trim honestly: what was dropped, from which tier, why, and the policy that chose it", async () => {
    previewContext.mockResolvedValue(answer("trimmed"));
    render(action());

    const dialog = await open();
    const trimmed = within(dialog).getByRole("region", { name: counting(TRIMMED_HEADING, 1) });

    expect(rows(dialog, counting(TRIMMED_HEADING, 1))).toEqual(["commit-style(org) — over the token budget~32.5k tokens"]);
    expect(trimmed).toHaveTextContent(TRIM_POLICY);
    expect(trimmed).toHaveClass("knowledge-preview__section--trimmed");
    expect(dialog).toHaveTextContent("1 trimmed");
    expect(rows(dialog, counting(SKILLS_HEADING, 4)).join(" ")).not.toContain("commit-style@");
  });

  it("says the estimator carries facts only", async () => {
    render(action());

    const dialog = await open();
    previewContext.mockResolvedValue(answer("estimator"));
    fireEvent.change(within(dialog).getByLabelText(PREVIEW_CONSUMER_LABEL), { target: { value: "estimator" } });

    await waitFor(() => {
      expect(within(dialog).getByText(ESTIMATOR_FACTS_ONLY)).toBeInTheDocument();
    });

    expect(previewContext).toHaveBeenLastCalledWith("estimator", SEEDED_REPO, null);
    expect(dialog).toHaveTextContent("~29 tokens of the 8.0k budget");
    expect(within(dialog).queryByRole("region", { name: new RegExp(ABSENT_HEADING) })).toBeNull();
  });

  it("says nothing would be injected for a scope with nothing resolved", async () => {
    previewContext.mockResolvedValue(answer("empty"));
    render(
      <ManifestPreview
        facts={{ ok: true, value: seededFacts([]) }}
        repo={null}
        repos={{ ok: true, value: [] }}
        skills={{ ok: true, value: { skills: [], active: 0 } }}
      />,
    );

    const dialog = await open();

    expect(within(dialog).getByText(PREVIEW_NOTHING)).toBeInTheDocument();
    expect(within(dialog).getByText(NO_SKILLS_RESOLVED)).toBeInTheDocument();
    expect(within(dialog).getByText(NO_FACTS_RESOLVED)).toBeInTheDocument();
    expect(within(dialog).queryByRole("listitem")).toBeNull();
  });
});

describe("changing the question", () => {
  it("asks again for the whole workspace when the repository is cleared", async () => {
    render(action());

    const dialog = await open();
    previewContext.mockResolvedValue(answer("workspaceWide"));
    fireEvent.change(within(dialog).getByLabelText(PREVIEW_REPO_LABEL), { target: { value: "" } });

    await waitFor(() => {
      expect(previewContext).toHaveBeenLastCalledWith("run_stage", null, null);
      expect(rows(dialog, counting(SKILLS_HEADING, 2))).toEqual(["commit-style@v2org-wide~11 tokens", "pr-etiquette@v4org-wide~11 tokens"]);
    });
  });

  it("draws the newest question's answer, dropping a slower earlier one", async () => {
    render(action());

    const dialog = await open();

    let slow: (outcome: PreviewOutcome) => void = () => {};
    previewContext.mockReturnValueOnce(new Promise<PreviewOutcome>((resolve) => { slow = resolve; }));
    fireEvent.change(within(dialog).getByLabelText(PREVIEW_WORKFLOW_LABEL), { target: { value: "standard-fix" } });

    previewContext.mockResolvedValueOnce(answer("estimator"));
    fireEvent.change(within(dialog).getByLabelText(PREVIEW_CONSUMER_LABEL), { target: { value: "estimator" } });

    await waitFor(() => {
      expect(within(dialog).getByText(ESTIMATOR_FACTS_ONLY)).toBeInTheDocument();
    });

    // The earlier, slower answer arrives last — and is not drawn over the newer one.
    slow(answer("workflowOverride"));

    await waitFor(() => {
      expect(previewContext).toHaveBeenCalledTimes(3);
    });
    expect(within(dialog).getByText(ESTIMATOR_FACTS_ONLY)).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("commit-style-fix@v1");
  });

  it("announces what the manifest holds once it lands", async () => {
    render(action());

    const dialog = await open();

    expect(dialog.querySelector("[aria-live='polite']")).toHaveTextContent("5 skills, 2 facts, ~84 tokens of the 32.0k budget.");
  });

  it("shows a refusal as an alert, and recovers on the next choice", async () => {
    previewContext.mockResolvedValue({
      ok: false,
      refusal: { code: "context_workflow_not_found", message: "No such workflow.", details: {} },
    });
    render(action());

    const dialog = await open();

    expect(within(dialog).getByRole("alert")).toHaveTextContent("That workflow is no longer in this workspace. Choose another, or no workflow.");

    previewContext.mockResolvedValue(answer("seeded"));
    fireEvent.change(within(dialog).getByLabelText(PREVIEW_CONSUMER_LABEL), { target: { value: "playbook" } });

    await waitFor(() => {
      expect(within(dialog).queryByRole("alert")).toBeNull();
      expect(dialog).toHaveTextContent("hil-safety@v3");
    });
    expect(previewContext).toHaveBeenLastCalledWith("playbook", SEEDED_REPO, null);
  });
});

describe("both palettes", () => {
  it("draws a trimmed, overridden manifest the same in both", async () => {
    // The override fixture with the trim fixture's drop in it: every section drawn at once.
    const everything: ContextManifest = { ...manifest("workflowOverride"), trimmed: manifest("trimmed").trimmed };
    previewContext.mockResolvedValue({ ok: true, value: everything });

    // The dialog is a portal, so it is the dialog itself that is compared — and the previous
    // palette's tree is cleaned up between the two.
    const markup: string[] = [];

    for (const palette of PALETTES) {
      renderInPalette(palette, action());

      const dialog = await open();

      markup.push(dialog.outerHTML.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_/g, "id"));
      cleanup();
    }

    expect(markup[0]).toBe(markup[1]);
    expect(markup[0]).toContain("over the token budget");
  });
});
