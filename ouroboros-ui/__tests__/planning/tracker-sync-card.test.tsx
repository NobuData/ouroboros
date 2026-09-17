import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SOURCES_PATH } from "@/app/paths";
import { TrackerSyncCard } from "@/app/planning/tracker-sync-card";
import {
  CADENCE_NOTE,
  CONNECT_LABEL,
  NOT_CONNECTED,
  READ_DIRECTION,
  SYNC_LIST_LABEL,
  SYNC_TITLE,
  SYNC_UNREAD,
  TWO_WAY_DIRECTION,
} from "@/app/planning/sync";

import { CARD_UNREAD_NOTE } from "@/app/planning/states";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { planningReadings, writableCatalog } from "../helpers/planning";
import { catalogPayload, githubEntry, jiraSource, source, sourcePage } from "../helpers/sources";

/**
 * The Tracker Sync card as it is drawn (AM.3, #285): the mockup's three rows, the cadence tag from
 * real configuration, and **connect ↗** on the one kind nobody connected.
 *
 * The seeded Jira source is `active` here, as `R__dev_seed_sources.sql` leaves it since #275 —
 * the shared fixture still has it paused, and the row's *state* is not what this file is about.
 */

/** The readings, with the sources and catalog a case wants. */
function readings(over: Parameters<typeof planningReadings>[1] = {}) {
  return planningReadings(undefined, over);
}

/** The card's list. */
function rows(): HTMLElement[] {
  return within(screen.getByRole("list", { name: SYNC_LIST_LABEL })).getAllByRole("listitem");
}

describe("the card", () => {
  it("is a region named for the mockup's card title", () => {
    render(<TrackerSyncCard readings={readings()} />);

    expect(screen.getByRole("region", { name: SYNC_TITLE })).toBeInTheDocument();
  });

  it("tags the head with the deployment's real cadence, and says it is jittered", () => {
    render(<TrackerSyncCard readings={readings()} />);

    // The seed's 300 seconds, not the mockup's literal `every 60s`.
    expect(screen.getByText("every 5m")).toHaveAttribute("title", CADENCE_NOTE);
  });

  it("draws no cadence tag when the listing could not be read", () => {
    render(<TrackerSyncCard readings={readings({ sources: { ok: false, reason: "No." } })} />);

    expect(screen.queryByText(/^every /)).not.toBeInTheDocument();
  });

  // Since AM.5 (#287) the reason is the banner's, said once for the whole page.
  it("names what is missing and points at the banner for why", () => {
    render(
      <TrackerSyncCard readings={readings({ sources: { ok: false, reason: "Sources failed." } })} />,
    );

    expect(screen.getByText(SYNC_UNREAD)).toBeInTheDocument();
    expect(screen.getByText(CARD_UNREAD_NOTE)).toBeInTheDocument();
    expect(screen.queryByText("Sources failed.")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: SYNC_LIST_LABEL })).not.toBeInTheDocument();
  });
});

describe("the rows", () => {
  it("are the mockup's three trackers, in its order", () => {
    render(<TrackerSyncCard readings={readings()} />);

    const names = rows().map((row) => row.textContent);

    // A connected source is named what the workspace named it — config context and all.
    expect(names[0]).toContain("GitHub · acme-robotics");
    expect(names[1]).toContain("Jira · PROJ");
    expect(names[2]).toContain("Linear");
  });

  it("says `two-way sync · 42 issues` of the writable GitHub source", () => {
    render(<TrackerSyncCard readings={readings()} />);

    expect(screen.getByText(`${TWO_WAY_DIRECTION} · 42 issues`)).toBeInTheDocument();
  });

  // The ticket's acceptance criterion, at the rendered level this time.
  it("never renders `two-way sync` for a read-only source", () => {
    render(
      <TrackerSyncCard
        readings={readings({ catalog: { ok: true, value: catalogPayload([githubEntry()]) } })}
      />,
    );

    expect(screen.getByText(`${READ_DIRECTION} · 42 issues`)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(TWO_WAY_DIRECTION))).not.toBeInTheDocument();
  });

  it("renders the Linear row as `not connected` with a connect ↗ into #141's surface", () => {
    render(<TrackerSyncCard readings={readings()} />);

    const linear = rows()[2]!;

    expect(within(linear).getByText(NOT_CONNECTED)).toBeInTheDocument();
    expect(within(linear).getByRole("link", { name: CONNECT_LABEL })).toHaveAttribute(
      "href",
      SOURCES_PATH,
    );
  });

  it("offers connect ↗ exactly once — on the one kind nobody connected", () => {
    render(<TrackerSyncCard readings={readings()} />);

    expect(screen.getAllByRole("link", { name: CONNECT_LABEL })).toHaveLength(1);
  });

  it("carries a word beside every status dot, never a hue alone", () => {
    render(<TrackerSyncCard readings={readings()} />);

    for (const row of rows()) expect(row.textContent).toMatch(/ok|idle|paused|error/);
  });

  it("gives each tracker its own tinted monogram", () => {
    const { container } = render(<TrackerSyncCard readings={readings()} />);

    expect(container.querySelector(".planning-mgram--gh")).toHaveTextContent("GH");
    expect(container.querySelector(".planning-mgram--ji")).toHaveTextContent("JI");
    expect(container.querySelector(".planning-mgram--ln")).toHaveTextContent("LN");
  });

  it("reads as designed for a workspace that has connected nothing", () => {
    render(<TrackerSyncCard readings={readings({ sources: { ok: true, value: sourcePage([]) } })} />);

    expect(rows()).toHaveLength(3);
    expect(screen.getAllByText(NOT_CONNECTED)).toHaveLength(3);
    expect(screen.getAllByRole("link", { name: CONNECT_LABEL })).toHaveLength(3);
  });

  it("draws a row per source, so two GitHub accounts are two rows", () => {
    const two = sourcePage([
      source(),
      source({ id: "5eed001a-0000-4000-8000-00000000000f", displayName: "GitHub · forge-io" }),
      jiraSource(),
    ]);

    render(<TrackerSyncCard readings={readings({ sources: { ok: true, value: two } })} />);

    expect(rows()).toHaveLength(4);
    expect(screen.getByText("GitHub · forge-io")).toBeInTheDocument();
  });
});

describe("both palettes", () => {
  it("renders identically under each, so the theme is the stylesheet's alone", () => {
    const [light, dark] = renderInBothPalettes(
      <TrackerSyncCard
        readings={planningReadings(undefined, {
          sources: { ok: true, value: sourcePage([source(), jiraSource()]) },
          catalog: { ok: true, value: writableCatalog() },
        })}
      />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    // And the mockup's own three rows are in what was compared.
    expect(light).toContain(TWO_WAY_DIRECTION);
    expect(light).toContain(NOT_CONNECTED);
  });
});
