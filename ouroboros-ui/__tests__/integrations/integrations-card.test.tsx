import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Integrations } from "@/app/api/settings-integrations";
import type { WebhookList } from "@/app/api/settings-webhooks";
import { settingsAccess } from "@/app/settings/access";
import { ThemeProvider } from "@/app/theme-provider";

import { FARM_REASON, SLACK_REASON, V2_REASON, integrations, tile } from "../helpers/integrations";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The Integrations card, rendered (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)):
 * the seeded grid's truth states, the deep-links to the owning surfaces, and the one tile whose
 * owning surface is a sheet on this card.
 */

const sheet = vi.fn<(props: { open: boolean; initial: WebhookList | null }) => void>();

vi.mock("@/app/webhooks/webhook-sheet", () => ({
  WebhookSheet: (props: { open: boolean; onClose: () => void; initial: WebhookList | null }) => {
    sheet(props);

    return props.open ? (
      <div aria-label="Webhooks" role="dialog">
        <button onClick={props.onClose} type="button">
          Close
        </button>
      </div>
    ) : null;
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  unstable_rethrow: () => {},
}));

const { SettingsSaveProvider } = await import("@/app/settings/save-provider");
const { SettingsSeat } = await import("@/app/settings/settings-seat");
const { IntegrationsCard } = await import("@/app/integrations/integrations-card");

/** A webhook list to hand the sheet — only its identity matters here. */
const WEBHOOKS = { items: [], activeCount: 2 } as unknown as WebhookList;

/**
 * The card in its seat.
 *
 * @param options.grid The grid.
 * @param options.mayManage Whether the reader is an owner or an admin.
 * @param options.webhooks The webhook list as read.
 * @returns The element.
 */
function card({
  grid = integrations(),
  mayManage = true,
  webhooks = WEBHOOKS,
}: { grid?: Integrations; mayManage?: boolean; webhooks?: WebhookList | null } = {}) {
  return (
    <SettingsSaveProvider access={settingsAccess(mayManage ? ["owner"] : ["viewer"])}>
      <SettingsSeat section="integrations">
        <IntegrationsCard integrations={grid} mayManage={mayManage} webhooks={webhooks} />
      </SettingsSeat>
    </SettingsSaveProvider>
  );
}

/**
 * One tile, by the integration's name.
 *
 * @param name The label.
 * @returns The list item.
 */
function tileOf(name: string): HTMLElement {
  return screen.getByText(name, { selector: ".integrations__name" }).closest("li") as HTMLElement;
}

describe("the seeded grid", () => {
  it("is the Integrations section's card, counting what the service counted", () => {
    render(card({ grid: integrations({ connectedCount: 4 }) }));

    const region = screen.getByRole("region", { name: "Integrations" });
    expect(within(region).getByText("4 connected")).toBeInTheDocument();
    expect(within(region).getAllByRole("listitem")).toHaveLength(9);
  });

  it("does not count for itself", () => {
    render(card({ grid: integrations({ connectedCount: 7 }) }));

    expect(screen.getByText("7 connected")).toBeInTheDocument();
  });

  it("draws a connected tile with its context line", () => {
    render(card());

    expect(tileOf("GitHub")).toHaveClass("integrations__tile--ok");
    expect(tileOf("GitHub")).toHaveTextContent("acme-robotics · GitHub App installed");
    expect(tileOf("Webhooks")).toHaveTextContent("2 active");
  });

  it("renders Slack's honest absence — not built yet, with why, and nothing to press", () => {
    render(card());
    const slack = tileOf("Slack");

    expect(slack).toHaveClass("integrations__tile--unbuilt");
    expect(slack).toHaveTextContent("not built yet");
    expect(slack).toHaveTextContent(SLACK_REASON);
    expect(slack.querySelector("a, button")).toBeNull();
  });

  it("labels the v2 tiles v2 — not off — and gives them no control", () => {
    render(card());

    for (const name of ["MS Teams", "Datadog", "PagerDuty"]) {
      const one = tileOf(name);

      expect(one, name).toHaveClass("integrations__tile--v2");
      expect(within(one).getByText("v2")).toBeInTheDocument();
      expect(one).toHaveTextContent(V2_REASON);
      expect(one).not.toHaveTextContent(/\boff\b/);
      expect(one.querySelector("a, button"), name).toBeNull();
    }
  });

  it("says not connected for a tile the reader could connect", () => {
    render(card());

    expect(tileOf("Linear")).toHaveClass("integrations__tile--disconnected");
    expect(tileOf("Linear")).toHaveTextContent("not connected");
  });

  it("shows a connected tile that needs attention with its reason, and without the ok mark", () => {
    render(card());
    const farm = tileOf("Build farm");

    expect(farm).toHaveClass("integrations__tile--attention");
    expect(farm).not.toHaveClass("integrations__tile--ok");
    expect(farm).toHaveTextContent("3 of 4 runners online");
    expect(farm).toHaveTextContent(FARM_REASON);
  });

  it("gives the ok mark to exactly the tiles that are connected and ok", () => {
    render(card());

    const earned = [...document.querySelectorAll(".integrations__tile--ok")].map(
      (one) => one.querySelector(".integrations__name")?.textContent,
    );

    expect(earned).toEqual(["GitHub", "Jira", "Webhooks"]);
  });

  it("cannot be made to show an unearned ok mark by any availability × state the service sends", () => {
    const pairs = (
      ["connected", "disconnected", "unavailable_v2", "unavailable_unbuilt"] as const
    ).flatMap((availability) =>
      (["ok", "attention", "off"] as const).map((state) => ({ availability, state })),
    );

    for (const pair of pairs) {
      const { unmount } = render(
        card({ grid: integrations({ tiles: [tile("slack", "Slack", { ...pair, contextLine: "#loops" })] }) }),
      );

      expect(
        document.querySelector(".integrations__tile--ok") !== null,
        `${pair.availability} × ${pair.state}`,
      ).toBe(pair.availability === "connected" && pair.state === "ok");
      unmount();
    }
  });

  it("draws the same card in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<ThemeProvider>{card()}</ThemeProvider>);

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});

describe("Connect and Manage", () => {
  it("deep-link to the surface that owns the connection", () => {
    render(card());

    expect(screen.getByRole("link", { name: "Connect Linear" })).toHaveAttribute(
      "href",
      "/settings/sources",
    );
    expect(screen.getByRole("link", { name: "Manage GitHub" })).toHaveAttribute(
      "href",
      "/settings/sources",
    );
    expect(screen.getByRole("link", { name: "Manage Build farm" })).toHaveAttribute(
      "href",
      "/build-farm",
    );
  });

  it("are the card's only controls besides the webhook sheet — there is no connection form", () => {
    render(card());
    const region = screen.getByRole("region", { name: "Integrations" });

    expect(region.querySelector("form, input, select, textarea, [role=switch]")).toBeNull();
    expect(within(region).getAllByRole("button")).toHaveLength(1);
  });
});

describe("the Webhooks tile", () => {
  it("opens the management sheet with the list the page read, and closes it again", () => {
    render(card());

    expect(screen.queryByRole("dialog")).toBeNull();
    const manage = screen.getByRole("button", { name: "Manage Webhooks" });
    expect(manage).toHaveAttribute("aria-haspopup", "dialog");

    fireEvent.click(manage);

    expect(screen.getByRole("dialog", { name: "Webhooks" })).toBeInTheDocument();
    expect(sheet).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, initial: WEBHOOKS }));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers the service's own label when no endpoint exists yet", () => {
    const grid = integrations({
      tiles: [
        tile("webhooks", "Webhooks", {
          availability: "disconnected",
          state: "off",
          deepLink: { label: "Add endpoint", path: "/settings#integrations" },
        }),
      ],
    });
    render(card({ grid, webhooks: null }));

    fireEvent.click(screen.getByRole("button", { name: "Add endpoint Webhooks" }));

    expect(sheet).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, initial: null }));
  });

  it("shows a reader who may not manage its state and no control, dead or otherwise", () => {
    sheet.mockClear();
    render(card({ mayManage: false, webhooks: null }));
    const webhooks = tileOf("Webhooks");

    expect(webhooks).toHaveTextContent("2 active");
    expect(webhooks.querySelector("a, button")).toBeNull();
    expect(sheet).not.toHaveBeenCalled();
  });
});

describe("a viewer", () => {
  it("reads the whole grid, with the links that lead to surfaces they may open", () => {
    render(card({ mayManage: false, webhooks: null }));
    const region = screen.getByRole("region", { name: "Integrations" });

    expect(within(region).getAllByRole("listitem")).toHaveLength(9);
    expect(within(region).queryAllByRole("button")).toHaveLength(0);
    expect(within(region).getByRole("link", { name: "Manage GitHub" })).toBeInTheDocument();

    for (const control of region.querySelectorAll("a, button")) {
      expect(control.getAttribute("aria-disabled")).toBeNull();
    }
  });
});
