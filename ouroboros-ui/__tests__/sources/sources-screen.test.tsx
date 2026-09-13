import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SOURCES_PATH } from "@/app/paths";
import { settingsEyebrow } from "@/app/settings/view";
import { ADD_READ_ONLY } from "@/app/sources/catalog";
import type { SourcesReadings } from "@/app/sources/data";
import {
  CATALOG_READ,
  DEGRADED_HEADLINE,
  EMPTY_MEMBER_NOTE,
  EMPTY_TITLE,
  LIST_FAILED_TITLE,
  SOURCES_FAILED_HEADLINE,
  readOnlyNote,
} from "@/app/sources/states";
import {
  ADD_SOURCE_LABEL,
  CONFIGURE_LABEL,
  CONFIGURE_READ_ONLY,
  LIST_LABEL,
  PAUSE_LABEL,
  RESUME_LABEL,
  SOURCES_TITLE,
  SYNC_LABEL,
  SYNC_READ_ONLY,
  TEST_LABEL,
  TEST_READ_ONLY,
} from "@/app/sources/view";
import { RETRY_LABEL } from "@/app/ui";

import { membership } from "../helpers/login";
import { PALETTES, maskIds, renderInBothPalettes, renderInPalette } from "../helpers/palettes";
import { failedSource, readings, seededSources } from "../helpers/sources";

const refresh = vi.fn();

vi.mock("@/app/sources/actions", () => ({
  readSourceCatalog: vi.fn(),
  addSource: vi.fn(),
  updateSourceConfig: vi.fn(),
  setSourceCredentials: vi.fn(),
  testSource: vi.fn(),
  syncSource: vi.fn(),
  readSourceStatus: vi.fn(),
  setSourceStatus: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => SOURCES_PATH,
}));

const { SourcesScreen } = await import("@/app/sources/sources-screen");

/**
 * The `/settings/sources` screen as it is drawn
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)): mockup 17's chrome, the list
 * with its kind badges and status dots, the honest reason on a failed row, the read-only
 * member, the empty workspace, the failed read — and both palettes.
 */

const WORKSPACE = membership().name;

function seeded(mayAdminister = true, over: Partial<SourcesReadings> = {}) {
  return render(
    <SourcesScreen
      mayAdminister={mayAdminister}
      readings={readings(over)}
      role={mayAdminister ? "owner" : "member"}
      workspaceName={WORKSPACE}
    />,
  );
}

function list(): HTMLElement {
  return screen.getByRole("list", { name: LIST_LABEL });
}

beforeEach(() => {
  refresh.mockReset();
});

describe("the page head", () => {
  it("is mockup 17's: the workspace-named eyebrow and the Ticket sources title", () => {
    seeded();

    expect(screen.getByText(settingsEyebrow(WORKSPACE))).toHaveClass("ou-eyebrow");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(SOURCES_TITLE);
  });

  it("draws the settings tab row with Sources current and the hub's sections honestly soon", () => {
    seeded();

    const tabs = screen.getByRole("navigation", { name: "Settings" });

    expect(within(tabs).getByRole("link", { name: "Sources" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByText("Workspace", { selector: ".ou-subnav__soon" })).toHaveTextContent("soon");
  });

  it("carries the add action, live for an administrator", () => {
    seeded();

    expect(screen.getByRole("button", { name: ADD_SOURCE_LABEL })).not.toHaveAttribute("aria-disabled");
  });
});

describe("the list", () => {
  it("draws one row per source, by name, with its kind badge and its status dot", () => {
    seeded();

    const rows = within(list()).getAllByRole("listitem");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("GitHub · acme-robotics");
    expect(within(rows[0]!).getByText("GitHub")).toHaveClass("ou-tag");
    expect(within(rows[0]!).getByText("active")).toHaveClass("ou-chip--ok");
    expect(rows[0]!.querySelector(".ou-chip__dot")).not.toBeNull();
    expect(rows[1]).toHaveTextContent("Jira · PROJ");
    // Neutral is the chip's default — no tone modifier — and the ring is what says *paused*
    // in shape as well as in words.
    expect(within(rows[1]!).getByText("paused")).toHaveClass("ou-chip");
    expect(within(rows[1]!).getByText("paused")).not.toHaveClass("ou-chip--ok");
    expect(rows[1]!.querySelector(".ou-chip__dot--ring")).not.toBeNull();
  });

  it("summarises each source from the provider's own fields, and says how fresh it is", () => {
    seeded();

    const rows = within(list()).getAllByRole("listitem");

    expect(rows[0]).toHaveTextContent("acme-robotics · 4 repositories");
    expect(rows[0]).toHaveTextContent("synced 40s ago");
    expect(rows[0]).toHaveTextContent("last sync imported 2 · updated 1 · unchanged 6");
    expect(rows[1]).toHaveTextContent("paused · never synced");
  });

  it("prints the honest reason on a row the tracker refused", () => {
    seeded(true, { sources: { ok: true, value: [failedSource()] } });

    const row = within(list()).getByRole("listitem");

    expect(row).toHaveClass("sources-row--error");
    expect(within(row).getByText("error")).toHaveClass("ou-chip--err");
    expect(within(row).getByText("rate limited until 14:20 UTC")).toHaveClass("sources-row__sync--err");
    expect(within(row).getByRole("button", { name: RESUME_LABEL })).toBeInTheDocument();
  });

  it("gives every row its four controls, live for an administrator", () => {
    seeded();

    const row = within(list()).getAllByRole("listitem")[0]!;

    for (const label of [TEST_LABEL, SYNC_LABEL, PAUSE_LABEL, CONFIGURE_LABEL]) {
      expect(within(row).getByRole("button", { name: label })).toBeInTheDocument();
    }
  });
});

describe("a member", () => {
  it("sees every row and may change none of them, with the reason on each control", () => {
    seeded(false);

    expect(screen.getByRole("note")).toHaveTextContent(readOnlyNote("member").head);
    expect(screen.getByRole("button", { name: ADD_SOURCE_LABEL })).toHaveAttribute("title", ADD_READ_ONLY);

    const row = within(list()).getAllByRole("listitem")[0]!;

    expect(within(row).getByRole("button", { name: TEST_LABEL })).toHaveAttribute("title", TEST_READ_ONLY);
    expect(within(row).getByRole("button", { name: SYNC_LABEL })).toHaveAttribute("title", SYNC_READ_ONLY);
    expect(within(row).getByRole("button", { name: CONFIGURE_LABEL })).toHaveAttribute(
      "title",
      CONFIGURE_READ_ONLY,
    );
    expect(within(row).getByRole("button", { name: PAUSE_LABEL })).toHaveAttribute("aria-disabled", "true");
  });

  it("is not told about the role when they may act", () => {
    seeded(true);

    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("the empty workspace", () => {
  it("guides an administrator with the action on the card, and draws no list", () => {
    seeded(true, { sources: { ok: true, value: [] }, statuses: new Map() });

    expect(screen.getByText(EMPTY_TITLE)).toHaveClass("ou-empty__title");
    expect(screen.getAllByRole("button", { name: ADD_SOURCE_LABEL })).toHaveLength(2);
    expect(screen.queryByRole("list", { name: LIST_LABEL })).toBeNull();
  });

  it("gives a member the explanation, and no second button", () => {
    seeded(false, { sources: { ok: true, value: [] }, statuses: new Map() });

    expect(screen.getByText(EMPTY_MEMBER_NOTE)).toHaveClass("sources-guidance__note");
    expect(screen.getAllByRole("button", { name: ADD_SOURCE_LABEL })).toHaveLength(1);
  });
});

describe("a refused read", () => {
  it("says so once, in a banner with the retry, and seats the list's reason below", () => {
    seeded(true, { sources: { ok: false, reason: "Down." }, statuses: new Map() });

    expect(screen.getByText(SOURCES_FAILED_HEADLINE)).toBeInTheDocument();
    expect(screen.getByText("Down.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: RETRY_LABEL })).toBeInTheDocument();
    expect(screen.getByText(LIST_FAILED_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(DEGRADED_HEADLINE)).toBeNull();
  });

  it("degrades the summaries to the stored keys when the catalog failed, and says so once", () => {
    seeded(true, { catalog: { ok: false, reason: "no" } });

    expect(screen.getByText(DEGRADED_HEADLINE)).toBeInTheDocument();
    expect(screen.getByText(`${CATALOG_READ}: no`)).toBeInTheDocument();
    expect(within(list()).getAllByRole("listitem")[0]).toHaveTextContent("acme-robotics · 4 repos");
  });
});

describe("both palettes", () => {
  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <SourcesScreen mayAdminister readings={readings()} role="owner" workspaceName={WORKSPACE} />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });

  it.each(PALETTES)("renders every row and its controls under %s", (palette) => {
    renderInPalette(
      palette,
      <SourcesScreen mayAdminister readings={readings()} role="owner" workspaceName={WORKSPACE} />,
    );

    expect(within(list()).getAllByRole("listitem")).toHaveLength(seededSources().length);
  });
});
