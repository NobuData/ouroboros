import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { REPOSITORIES_PATH, SOURCES_PATH } from "@/app/paths";
import type { RepositoriesReadings } from "@/app/repositories/data";
import {
  EMPTY_TITLE,
  LIST_FAILED_TITLE,
  LIST_LABEL,
  NOT_SCANNED,
  NO_SOURCE,
  SWITCH_NOT_COVERED,
  SWITCH_READ_ONLY,
  TOKEN_MISSING,
  TOKEN_SET,
} from "@/app/repositories/view";

import { source } from "../helpers/sources";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => REPOSITORIES_PATH,
}));
vi.mock("@/app/repositories/actions", () => ({
  setRepositoryEnabled: () => Promise.resolve({ ok: true }),
  scanIssuesNow: () => Promise.resolve({ ok: true }),
}));
vi.mock("@/app/shell/stale-focus", () => ({ reconcileFocusRepo: () => Promise.resolve() }));

const { RepositoriesScreen } = await import("@/app/repositories/repositories-screen");

/** Settings → Repositories, drawn from its readings. */

const NOW = "2026-10-14T10:05:00.000Z";

/**
 * The readings of a workspace with one account: helios-firmware on, and the source's other
 * repositories not recorded yet.
 *
 * @param over Parts to replace.
 * @returns The readings.
 */
function readings(over: Partial<RepositoriesReadings> = {}): RepositoriesReadings {
  return {
    enablement: {
      ok: true,
      value: {
        orgTotal: 2,
        orgs: [
          {
            org: { id: "org-acme", login: "acme-robotics", enabled: true },
            repos: [{ id: "repo-fw", name: "helios-firmware", enabled: true }],
            repoTotal: 1,
          },
          {
            org: { id: "org-ken", login: "kensuenobu", enabled: true },
            repos: [{ id: "repo-dot", name: "dotfiles", enabled: false }],
            repoTotal: 1,
          },
        ],
      } as never,
    },
    sources: { ok: true, value: [source()] },
    scanning: {
      ok: true,
      value: {
        syncedAt: "2026-10-14T10:00:00.000Z",
        state: "ok",
        pause: null,
        message: null,
        retryAfterSeconds: null,
        running: false,
        repositories: [
          {
            githubRepoId: "repo-fw",
            repository: "acme-robotics/helios-firmware",
            syncedAt: "2026-10-14T10:00:00.000Z",
            cursor: null,
            state: "ok",
            pause: null,
            message: null,
          } as never,
        ],
      },
    },
    backlogToken: {
      ok: true,
      value: { configured: true, masked: "••••", createdAt: null, updatedAt: null },
    },
    now: NOW,
    ...over,
  };
}

/**
 * Draw the screen.
 *
 * @param over Readings to replace.
 * @param mayAdminister Whether the reader is an Owner or Admin.
 */
function draw(over: Partial<RepositoriesReadings> = {}, mayAdminister = true) {
  render(
    <RepositoriesScreen
      mayAdminister={mayAdminister}
      mayContribute
      readings={readings(over)}
      workspaceName="Acme Robotics"
    />,
  );
}

/**
 * One repository's row.
 *
 * @param name The repository.
 * @returns The row.
 */
function row(name: string): HTMLElement {
  const found = within(screen.getByRole("region", { name: LIST_LABEL }))
    .getByText(name)
    .closest("li");
  if (found === null) throw new Error(`no row for ${name}`);
  return found;
}

describe("RepositoriesScreen", () => {
  it("draws the Repositories tab as the current one", () => {
    draw();

    expect(screen.getByRole("link", { name: "Repositories" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("draws each repository with the source that names it and a switch in its state", () => {
    draw();

    expect(within(row("helios-firmware")).getByText("GitHub · acme-robotics")).toBeInTheDocument();
    expect(within(row("helios-firmware")).getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(within(row("helios-console")).getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("says per repository whether its issues are being read", () => {
    draw();

    expect(within(row("helios-firmware")).getByText("Issues read 5m ago")).toBeInTheDocument();
    expect(within(row("helios-console")).getByText(NOT_SCANNED)).toBeInTheDocument();
  });

  it("says when no source names a repository, and will not turn it on", () => {
    draw();

    expect(within(row("dotfiles")).getByText(NO_SOURCE)).toBeInTheDocument();
    expect(within(row("dotfiles")).getByRole("switch")).toHaveAttribute("title", SWITCH_NOT_COVERED);
  });

  it("draws every switch read-only below Owner or Admin", () => {
    draw({}, false);

    expect(within(row("helios-firmware")).getByRole("switch")).toHaveAttribute(
      "title",
      SWITCH_READ_ONLY,
    );
  });

  it("says how issues are scanned, and with which token", () => {
    draw();
    expect(screen.getByText(TOKEN_SET)).toBeInTheDocument();
    expect(
      screen.getByText("Scanning — the least recently read repository was read 5m ago."),
    ).toBeInTheDocument();
  });

  it("warns about a missing token to a reader who may not read the token itself", () => {
    draw({
      backlogToken: null,
      scanning: {
        ok: true,
        value: {
          syncedAt: null,
          state: "paused",
          pause: "not_configured",
          message: "This workspace has no GitHub token.",
          retryAfterSeconds: null,
          running: false,
          repositories: [],
        },
      },
    });

    expect(screen.getByText(TOKEN_MISSING)).toBeInTheDocument();
    expect(screen.queryByText("This workspace has no GitHub token.")).toBeNull();
  });

  it("warns when no backlog token is set", () => {
    draw({
      backlogToken: {
        ok: true,
        value: { configured: false, masked: null, createdAt: null, updatedAt: null },
      },
    });

    expect(screen.getByText(TOKEN_MISSING)).toBeInTheDocument();
  });

  it("points at Sources when there is nothing to draw", () => {
    draw({
      enablement: { ok: true, value: { orgTotal: 0, orgs: [] } as never },
      sources: { ok: true, value: [] },
    });

    expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: "Open Sources" })) {
      expect(link).toHaveAttribute("href", SOURCES_PATH);
    }
  });

  it("says why when the repositories could not be read", () => {
    draw({ enablement: { ok: false, reason: "The service is not answering." } });

    expect(screen.getByText(LIST_FAILED_TITLE)).toBeInTheDocument();
    expect(screen.getByText("The service is not answering.")).toBeInTheDocument();
  });
});
