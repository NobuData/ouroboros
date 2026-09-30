import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuleImportPreview, RuleImportResult } from "@/app/api/knowledge-import";
import type { ImportOutcome } from "@/app/knowledge/import-actions";
import {
  APPLY_SUBMIT,
  FILE_NOT_FOUND,
  IMPORT_CANCEL,
  IMPORT_CLOSE,
  IMPORT_NO_REPOS,
  IMPORT_REPO_LABEL,
  IMPORT_STALE,
  IMPORT_TITLE,
  NONE_FOUND_TITLE,
  NOTHING_ENABLED,
  NOTHING_USABLE_TITLE,
  PREVIEW_AGAIN,
  PREVIEW_SUBMIT,
  UNCHANGED_TITLE,
  UPDATE_MARK,
  importToast,
  noneFoundNote,
  totalsLine,
} from "@/app/knowledge/import";
import type { KnowledgeToast } from "@/app/knowledge/toast";
import { IMPORT_LABEL } from "@/app/knowledge/view";

import {
  FINGERPRINT,
  SEEDED_REPO,
  importPreview,
  importResult,
  knowledgeReadings,
  noneFoundPreview,
  nothingUsablePreview,
  unchangedPreview,
} from "../helpers/knowledge";

/**
 * **Import CLAUDE.md / .cursorrules** and its sheet as they are drawn (#417): the repository step,
 * the preview with its files, counts, samples and the statement that nothing is enabled, **Apply**
 * sending the fingerprint back, the three previews that are not imports, and the toast handed up.
 *
 * The Server Actions are mocked, not the API: `import-actions.test.ts` is that module's suite and
 * `import.test.ts` proves the judgements; this proves what reaches the DOM and what leaves it.
 */

/** What the actions answer, per case. */
const previewImport = vi.fn<(body: unknown) => Promise<ImportOutcome<RuleImportPreview>>>();
const applyImport = vi.fn<(body: unknown) => Promise<ImportOutcome<RuleImportResult>>>();

/** What re-reads the page after an apply. */
const refresh = vi.fn();

/** What the screen is handed. */
const onImported = vi.fn<(toast: KnowledgeToast) => void>();

vi.mock("@/app/knowledge/import-actions", () => ({
  previewImport: (body: unknown) => previewImport(body),
  applyImport: (body: unknown) => applyImport(body),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { ImportSheet } = await import("@/app/knowledge/import-sheet");

/** The seed workspace the focus-repo chip keys its choice by. */
const WORKSPACE_ID = "5eed0001-0000-4000-8000-000000000001";

beforeEach(() => {
  previewImport.mockReset().mockResolvedValue({ ok: true, value: importPreview() });
  applyImport.mockReset().mockResolvedValue({ ok: true, value: importResult() });
  refresh.mockReset();
  onImported.mockReset();
});

/**
 * Render the action and open its sheet.
 *
 * @param readings What the page read. Defaults to the seed.
 */
function open(readings = knowledgeReadings()): void {
  render(<ImportSheet onImported={onImported} repos={readings.repos} workspaceId={WORKSPACE_ID} />);

  fireEvent.click(screen.getByRole("button", { name: IMPORT_LABEL }));
}

/** Open, and preview the seed repository. */
async function preview(): Promise<void> {
  open();
  fireEvent.click(screen.getByRole("button", { name: PREVIEW_SUBMIT }));

  await waitFor(() => { expect(previewImport).toHaveBeenCalledOnce(); });
  await screen.findByText(SEEDED_REPO);
}

describe("the head action", () => {
  it("is the ghost action and opens the sheet on the first enabled repository", () => {
    open();

    expect(screen.getByRole("button", { name: IMPORT_LABEL })).toHaveClass("ou-btn--ghost");
    expect(screen.getByRole("dialog")).toHaveAccessibleName(IMPORT_TITLE);
    expect(screen.getByLabelText(IMPORT_REPO_LABEL)).toHaveValue(SEEDED_REPO);
  });

  it("is inert, with the reason, when no repository is enabled", () => {
    render(<ImportSheet onImported={onImported} repos={{ ok: true, value: [] }} workspaceId={WORKSPACE_ID} />);

    const action = screen.getByRole("button", { name: IMPORT_LABEL });

    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(action).toHaveAttribute("title", IMPORT_NO_REPOS);

    fireEvent.click(action);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the preview", () => {
  it("reads the chosen repository and writes nothing", async () => {
    await preview();

    expect(previewImport).toHaveBeenCalledExactlyOnceWith({ repo: SEEDED_REPO });
    expect(applyImport).not.toHaveBeenCalled();
  });

  it("lists the four files, found or not, with what each would create", async () => {
    await preview();

    const rows = screen.getAllByRole("row").slice(1);

    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("CLAUDE.md");
    expect(rows[0]).toHaveTextContent("3 skill drafts · 9 fact candidates");
    expect(rows[1]).toHaveTextContent(FILE_NOT_FOUND);
  });

  it("states the totals, the samples of both kinds, and that nothing will be enabled", async () => {
    await preview();

    expect(screen.getByText(totalsLine(importPreview().totals))).toBeInTheDocument();
    expect(screen.getByText("kconfig")).toBeInTheDocument();
    expect(screen.getByText("Prefer `k_msgq` over `k_fifo` in ISR paths.")).toBeInTheDocument();
    expect(screen.getByText(UPDATE_MARK)).toBeInTheDocument();
    expect(screen.getByText(NOTHING_ENABLED)).toBeInTheDocument();
  });

  it("goes back to the repository step on Preview again", async () => {
    await preview();
    fireEvent.click(screen.getByRole("button", { name: PREVIEW_AGAIN }));

    expect(screen.getByLabelText(IMPORT_REPO_LABEL)).toHaveValue(SEEDED_REPO);
  });
});

describe("applying", () => {
  it("sends the preview's fingerprint back, hands up the toast, and re-reads", async () => {
    await preview();
    fireEvent.click(screen.getByRole("button", { name: APPLY_SUBMIT }));

    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });

    expect(applyImport).toHaveBeenCalledExactlyOnceWith({ repo: SEEDED_REPO, fingerprint: FINGERPRINT });
    expect(onImported).toHaveBeenCalledExactlyOnceWith(importToast(importResult()));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the sheet open on a stale preview, says to preview again, and writes nothing", async () => {
    applyImport.mockResolvedValue({
      ok: false,
      refusal: { code: "knowledge_import_preview_stale", message: "Stale.", details: {} },
    });

    await preview();
    fireEvent.click(screen.getByRole("button", { name: APPLY_SUBMIT }));

    await waitFor(() => { expect(screen.getByRole("alert")).toHaveTextContent(IMPORT_STALE); });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PREVIEW_AGAIN })).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("the previews that are not imports", () => {
  it("shows the honest empty result, with guidance, and no Apply", async () => {
    previewImport.mockResolvedValue({ ok: true, value: noneFoundPreview() });

    await preview();

    expect(screen.getByText(NONE_FOUND_TITLE)).toBeInTheDocument();
    expect(screen.getByText(noneFoundNote(SEEDED_REPO))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: APPLY_SUBMIT })).toBeNull();
    expect(screen.getByRole("button", { name: IMPORT_CLOSE })).toBeInTheDocument();
    expect(screen.queryByText(NOTHING_ENABLED)).toBeNull();
  });

  it("says an unchanged re-import is one, rather than offering an apply that creates nothing", async () => {
    previewImport.mockResolvedValue({ ok: true, value: unchangedPreview() });

    await preview();

    expect(screen.getByText(UNCHANGED_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: APPLY_SUBMIT })).toBeNull();
  });

  it("says when files were found and nothing in them reads as a skill or a rule", async () => {
    previewImport.mockResolvedValue({ ok: true, value: nothingUsablePreview() });

    await preview();

    expect(screen.getByText(NOTHING_USABLE_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: APPLY_SUBMIT })).toBeNull();
  });
});

describe("a refused preview", () => {
  it("stays on the repository step with the sentence, and the way out is still Cancel", async () => {
    previewImport.mockResolvedValue({
      ok: false,
      refusal: { code: "detection_source_missing", message: "No source.", details: {} },
    });

    open();
    fireEvent.click(screen.getByRole("button", { name: PREVIEW_SUBMIT }));

    await waitFor(() => { expect(screen.getByRole("alert")).toBeInTheDocument(); });

    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByLabelText(IMPORT_REPO_LABEL)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: IMPORT_CANCEL })).toBeInTheDocument();
  });
});
