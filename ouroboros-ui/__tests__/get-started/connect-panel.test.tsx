import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { sourcesReadings } from "../helpers/onboarding";
import { SEEDED_GITHUB_ID, githubEntry, jiraSource, source } from "../helpers/sources";

/**
 * Step 1's embedded flow (BC.6, #395): `app/sources`' own add-source dialog and rows inside the
 * wizard's frame — no second way of connecting GitHub — with the wizard's framing around them
 * and the Settings link kept as the return path.
 */

const readSourceCatalog = vi.fn();
const addSource = vi.fn();
const setSourceStatus = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/sources/actions", () => ({
  readSourceCatalog: () => readSourceCatalog(),
  addSource: (body: unknown) => addSource(body),
  testSource: vi.fn(),
  syncSource: vi.fn(),
  readSourceStatus: vi.fn(),
  setSourceStatus: (id: string, status: string) => setSourceStatus(id, status),
  setSourceCredentials: vi.fn(),
  updateSourceConfig: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { ConnectPanel } = await import("@/app/get-started/connect-panel");

const OWNER = { contribute: true, administer: true };
const VIEWER = { contribute: false, administer: false };

/** The card. */
const panel = () => screen.getByRole("region", { name: "Connect GitHub" });

beforeEach(() => {
  for (const mock of [readSourceCatalog, addSource, setSourceStatus, refresh]) mock.mockReset();
  readSourceCatalog.mockResolvedValue({ ok: true, entries: [githubEntry()] });
});

afterEach(() => {
  cleanup();
});

describe("the framing", () => {
  it("names the step, says what the connection is and what comes next, and keeps the Settings return path", () => {
    render(<ConnectPanel abilities={OWNER} sources={{ ok: true, value: sourcesReadings() }} stepDone={false} />);

    expect(within(panel()).getByText("step 1 · you are here")).toBeInTheDocument();
    expect(panel()).toHaveTextContent("the same connection Settings → Sources manages");
    expect(panel()).toHaveTextContent("Next: switch on the repository, and detection scans it.");
    expect(within(panel()).getByRole("link", { name: "Manage in Settings → Sources ↗" })).toHaveAttribute("href", "/settings/sources");
  });

  it("wears the done pill once the rail says so", () => {
    render(<ConnectPanel abilities={OWNER} sources={{ ok: true, value: sourcesReadings() }} stepDone />);

    expect(within(panel()).getByText("✓ step 1 done")).toBeInTheDocument();
  });
});

describe("the sources module's own surfaces", () => {
  it("draws the workspace's GitHub sources as Settings → Sources' rows, Jira and the rest left out", () => {
    render(
      <ConnectPanel
        abilities={OWNER}
        sources={{ ok: true, value: sourcesReadings({ sources: { ok: true, value: [source(), jiraSource()] } }) }}
        stepDone
      />,
    );

    const list = within(panel()).getByRole("list", { name: "Connected GitHub sources" });
    const rows = within(list).getAllByRole("listitem");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveClass("sources-row");
    expect(within(rows[0]!).getByRole("heading", { name: "GitHub · acme-robotics" })).toBeInTheDocument();
    // The row's controls are the sources module's — the regression lever is Pause, the fix Resume.
    expect(within(rows[0]!).getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(within(rows[0]!).getByRole("button", { name: "Test connection" })).toBeInTheDocument();
  });

  it("pauses a source through the sources module's own action", async () => {
    setSourceStatus.mockResolvedValue({ ok: true, source: source({ status: "paused" }) });
    render(<ConnectPanel abilities={OWNER} sources={{ ok: true, value: sourcesReadings() }} stepDone />);

    fireEvent.click(within(panel()).getByRole("button", { name: "Pause" }));

    await waitFor(() => expect(setSourceStatus).toHaveBeenCalledWith(SEEDED_GITHUB_ID, "paused"));
  });

  it("opens the add-source dialog on its catalog — the same dialog, not a copy", async () => {
    render(<ConnectPanel abilities={OWNER} sources={{ ok: true, value: sourcesReadings({ sources: { ok: true, value: [] } }) }} stepDone={false} />);

    expect(panel()).toHaveTextContent("No GitHub source is connected yet.");
    fireEvent.click(within(panel()).getByRole("button", { name: "+ Add source" }));

    const dialog = await screen.findByRole("dialog", { name: "Add a ticket source" });
    expect(within(dialog).getByRole("heading", { name: "Add a ticket source" })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /^GitHub/ })).toBeInTheDocument());
    expect(readSourceCatalog).toHaveBeenCalledOnce();
  });

  it("tells a viewer why they cannot add, in the sources module's words, and shows the rows read-only", () => {
    render(<ConnectPanel abilities={VIEWER} sources={{ ok: true, value: sourcesReadings() }} stepDone />);

    const opener = within(panel()).getByRole("button", { name: "+ Add source" });
    expect(opener).toHaveAttribute("aria-disabled", "true");
    expect(opener).toHaveAttribute("title", "Adding a ticket source is for workspace owners and admins.");
    expect(within(panel()).getByRole("button", { name: "Pause" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("states", () => {
  it("says it is reading while the sources are on their way", () => {
    render(<ConnectPanel abilities={OWNER} sources={null} stepDone={false} />);

    expect(within(panel()).getByRole("status")).toHaveTextContent("Reading the ticket sources…");
  });

  it("states a failed read once, as an alert, in the service's words", () => {
    render(<ConnectPanel abilities={OWNER} sources={{ ok: false, reason: "The sources are busy." }} stepDone={false} />);

    expect(within(panel()).getByRole("alert")).toHaveTextContent("The sources are busy.");
  });

  it("states a failed listing inside an otherwise good read", () => {
    render(
      <ConnectPanel
        abilities={OWNER}
        sources={{ ok: true, value: sourcesReadings({ sources: { ok: false, reason: "The listing timed out." } }) }}
        stepDone={false}
      />,
    );

    expect(within(panel()).getByRole("alert")).toHaveTextContent("The listing timed out.");
  });

  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(
      <ConnectPanel abilities={OWNER} sources={{ ok: true, value: sourcesReadings() }} stepDone />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("wizard-connect");
  });
});
