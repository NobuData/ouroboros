import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationRoutes } from "@/app/api/settings-integrations";
import {
  RECIPIENTS_LABEL,
  type RoutePatch,
  SAVED_ON_CANNOT_FIRE,
  TIME_INVALID,
  TIME_LABEL,
} from "@/app/integrations/routes";
import { settingsAccess } from "@/app/settings/access";
import type { SectionCommitResult } from "@/app/settings/save-model";
import { ThemeProvider } from "@/app/theme-provider";

import { notificationRoutes, route } from "../helpers/integrations";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The Notifications card, rendered (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)):
 * the mockup's four routes, the locked-row pattern, and the card driven through the real save
 * model, so an edit becomes the patches the service is sent.
 */

const save = vi.fn<(patches: readonly RoutePatch[]) => Promise<SectionCommitResult>>();
const push = vi.fn();

vi.mock("@/app/integrations/routes-actions", () => ({
  saveRoutes: (patches: readonly RoutePatch[]) => save(patches),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push }),
  unstable_rethrow: () => {},
}));

const { SettingsSaveProvider } = await import("@/app/settings/save-provider");
const { SaveButton } = await import("@/app/settings/save-controls");
const { SettingsSeat } = await import("@/app/settings/settings-seat");
const { NotificationsCard } = await import("@/app/integrations/notifications-card");

/**
 * The card in its seat under the page's save model, with a Save button.
 *
 * @param options.roles The reader's roles. Defaults to an owner.
 * @param options.routes The routes.
 * @returns The element.
 */
function card({
  roles = ["owner"],
  routes = notificationRoutes(),
}: { roles?: Parameters<typeof settingsAccess>[0]; routes?: NotificationRoutes } = {}) {
  return (
    <SettingsSaveProvider access={settingsAccess(roles)}>
      <SaveButton />
      <SettingsSeat section="notifications">
        <NotificationsCard routes={routes} />
      </SettingsSeat>
    </SettingsSaveProvider>
  );
}

/** The seat the card is mounted in. */
function seat(): HTMLElement {
  return document.getElementById("notifications") as HTMLElement;
}

/**
 * One route's row, by the start of its title.
 *
 * @param title The title's opening words.
 * @returns The list item.
 */
function row(title: string): HTMLElement {
  const what = [...seat().querySelectorAll(".org-routes__what")].find((one) =>
    one.textContent.startsWith(title),
  );

  return what?.closest("li") as HTMLElement;
}

/** Press Save, and let the write answer. */
async function pressSave(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Save changes/ }));
  });
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  save.mockReset().mockResolvedValue({ ok: true });
  push.mockReset();
});

describe("the org routes", () => {
  it("draws the mockup's four rows in the service's order", () => {
    render(card());

    expect([...seat().querySelectorAll(".org-routes__what")].map((one) => one.textContent)).toEqual([
      "Needs-you decisions → Slack DM",
      "Daily digest 09:00 UTC → email",
      "Loop failures → PagerDuty",
      "Weekly insights report → email",
    ]);
    expect(row("Needs-you")).toHaveTextContent("approvals, waivers, allow-once requests");
    expect(row("Daily digest")).toHaveTextContent("merges, spend, interventions since yesterday");
  });

  it("does not promise a Slack channel for the weekly report — its target is an email list", () => {
    render(card());
    const weekly = row("Weekly insights");

    expect(weekly).toHaveTextContent("Mondays, from the Insights screen · to eng-leads@acme.dev");
    expect(weekly).not.toHaveTextContent(/#eng-leads|slack/i);
  });

  it("draws a switch for each route that can fire, in its saved position", () => {
    render(card());

    expect(screen.getByRole("switch", { name: "Daily digest → email" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Weekly insights report → email" })).toBeChecked();
    expect(within(seat()).getAllByRole("switch")).toHaveLength(2);
  });

  it("draws a custom kind by its kind and channel, with a switch", () => {
    render(
      card({ routes: notificationRoutes({ items: [route("custom:release-notes", { enabled: false })] }) }),
    );

    expect(row("custom:release-notes")).toHaveTextContent("custom:release-notes → email");
    expect(screen.getByRole("switch", { name: "custom:release-notes → email" })).not.toBeChecked();
  });

  it("draws the same card in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<ThemeProvider>{card()}</ThemeProvider>);

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});

describe("a locked row", () => {
  it("states its reason and links to the integration that would unlock it", () => {
    render(card());
    const failures = row("Loop failures");

    expect(failures).toHaveClass("org-routes__row--locked");
    expect(failures).toHaveTextContent("locked — connect PagerDuty first");
    expect(within(failures).getByRole("link", { name: "See PagerDuty in Integrations" })).toHaveAttribute(
      "href",
      "#integrations",
    );
    expect(within(row("Needs-you")).getByRole("link", { name: "See Slack in Integrations" })).toHaveAttribute(
      "href",
      "#integrations",
    );
    expect(row("Needs-you")).toHaveTextContent("locked — connect Slack first");
  });

  it("cannot be enabled: there is no switch, and no other control that would", () => {
    render(card());

    for (const title of ["Loop failures", "Needs-you"]) {
      const locked = row(title);

      expect(within(locked).queryByRole("switch"), title).toBeNull();
      expect(locked.querySelector("button, input, select, textarea"), title).toBeNull();
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("hands a plain press on its link to the router, and leaves a modified one to the browser", () => {
    render(card());
    const link = within(row("Loop failures")).getByRole("link");

    fireEvent.click(link);
    expect(push).toHaveBeenCalledExactlyOnceWith("#integrations");

    fireEvent.click(link, { metaKey: true });
    expect(push).toHaveBeenCalledOnce();
  });

  it("that is saved on says it cannot fire, and may only be switched off or back", async () => {
    const routes = notificationRoutes({
      items: [
        route("loop_failures", {
          channel: "pagerduty",
          locked: true,
          lockedReason: "connect PagerDuty first",
          delivering: false,
        }),
      ],
    });
    render(card({ routes }));
    const failures = row("Loop failures");

    expect(failures).toHaveTextContent(SAVED_ON_CANNOT_FIRE);

    const toggle = within(failures).getByRole("switch", { name: "Loop failures → PagerDuty" });
    expect(toggle).toBeChecked();

    // Off, and back to the saved position: nothing is unsaved again.
    fireEvent.click(toggle);
    expect(within(row("Loop failures")).getByRole("switch")).not.toBeChecked();
    fireEvent.click(within(row("Loop failures")).getByRole("switch"));
    expect(screen.getByRole("button", { name: /^Save changes/ })).toHaveTextContent(/^Save changes$/);

    fireEvent.click(within(row("Loop failures")).getByRole("switch"));
    await pressSave();

    expect(save).toHaveBeenCalledWith([
      { kind: "loop_failures", name: "Loop failures → PagerDuty", patch: { enabled: false } },
    ]);
  });
});

describe("saving", () => {
  it("joins the page's dirty state: a flipped switch is one unsaved change on the card", () => {
    render(card());

    fireEvent.click(screen.getByRole("switch", { name: "Daily digest → email" }));

    expect(screen.getByRole("button", { name: /^Save changes/ })).toHaveTextContent("1");
    expect(within(seat()).getByText("1 unsaved")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("sends a flipped switch as that route's patch", async () => {
    render(card());

    fireEvent.click(screen.getByRole("switch", { name: "Weekly insights report → email" }));
    await pressSave();

    expect(save).toHaveBeenCalledExactlyOnceWith([
      { kind: "weekly_insights", name: "Weekly insights report → email", patch: { enabled: false } },
    ]);
  });

  it("edits the digest's time, shows it in the title, and sends the route's whole config", async () => {
    render(card());

    fireEvent.change(screen.getByLabelText(TIME_LABEL), { target: { value: "07:30" } });
    expect(row("Daily digest")).toHaveTextContent("Daily digest 07:30 UTC → email");

    await pressSave();

    expect(save).toHaveBeenCalledWith([
      { kind: "daily_digest", name: "Daily digest → email", patch: { config: { time: "07:30" } } },
    ]);
  });

  it("says the digest's time is UTC at the editor", () => {
    render(card());

    expect(screen.getByLabelText(TIME_LABEL)).toHaveAccessibleDescription(
      expect.stringContaining("UTC"),
    );
  });

  it("edits the weekly target as an email list and sends it with the route's weekday", async () => {
    render(card());

    fireEvent.change(screen.getByLabelText(RECIPIENTS_LABEL), {
      target: { value: "a@acme.dev, b@acme.dev" },
    });
    expect(row("Weekly insights")).toHaveTextContent("to a@acme.dev, b@acme.dev");

    await pressSave();

    expect(save).toHaveBeenCalledWith([
      {
        kind: "weekly_insights",
        name: "Weekly insights report → email",
        patch: { config: { weekday: "monday", recipients: ["a@acme.dev", "b@acme.dev"] } },
      },
    ]);
  });

  it("says who receives the report when the list is emptied, and omits the key", async () => {
    render(card());
    const editor = screen.getByLabelText(RECIPIENTS_LABEL);

    expect(editor).toHaveAccessibleDescription(expect.stringContaining("owners and admins"));
    fireEvent.change(editor, { target: { value: "" } });
    expect(row("Weekly insights")).toHaveTextContent("to the workspace's owners and admins");

    await pressSave();

    expect(save).toHaveBeenCalledWith([
      {
        kind: "weekly_insights",
        name: "Weekly insights report → email",
        patch: { config: { weekday: "monday" } },
      },
    ]);
  });

  it("sends every changed route in one commit, in the card's order", async () => {
    render(card());

    fireEvent.change(screen.getByLabelText(RECIPIENTS_LABEL), { target: { value: "a@acme.dev" } });
    fireEvent.click(screen.getByRole("switch", { name: "Daily digest → email" }));
    fireEvent.change(screen.getByLabelText(TIME_LABEL), { target: { value: "06:00" } });
    expect(screen.getByRole("button", { name: /^Save changes/ })).toHaveTextContent("3");

    await pressSave();

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0].map((one) => [one.kind, one.patch])).toEqual([
      ["daily_digest", { enabled: false, config: { time: "06:00" } }],
      ["weekly_insights", { config: { weekday: "monday", recipients: ["a@acme.dev"] } }],
    ]);
  });

  it("checks an address in the browser and sends nothing", async () => {
    render(card());

    fireEvent.change(screen.getByLabelText(RECIPIENTS_LABEL), { target: { value: "#eng-leads" } });
    await pressSave();

    expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText(RECIPIENTS_LABEL)).toHaveAccessibleDescription(
      expect.stringContaining("#eng-leads is not an email address."),
    );
  });

  it("checks the time in the browser and sends nothing", async () => {
    render(card());

    fireEvent.change(screen.getByLabelText(TIME_LABEL), { target: { value: "" } });
    await pressSave();

    expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText(TIME_LABEL)).toHaveAccessibleDescription(
      expect.stringContaining(TIME_INVALID),
    );
  });

  it("keeps a refusal on the card, with the field's error on its editor", async () => {
    save.mockResolvedValue({
      ok: false,
      reason: "No notification route was saved. Daily digest → email: The config is not valid.",
      fields: { "time:daily_digest": "time must be HH:MM" },
    });
    render(card());

    fireEvent.change(screen.getByLabelText(TIME_LABEL), { target: { value: "07:30" } });
    await pressSave();

    expect(within(seat()).getByRole("note")).toHaveTextContent(
      "No notification route was saved. Daily digest → email: The config is not valid.",
    );
    expect(screen.getByLabelText(TIME_LABEL)).toHaveAccessibleDescription(
      expect.stringContaining("time must be HH:MM"),
    );
    expect(screen.getByRole("button", { name: /^Save changes/ })).toHaveTextContent("1");
  });
});

describe("a viewer", () => {
  it("reads the same rows as text — positions in words, no switch, no editor", () => {
    render(card({ roles: ["viewer"] }));

    expect(seat().querySelectorAll(".org-routes__row")).toHaveLength(4);
    expect(seat().querySelector("button, input, select, textarea, [role=switch]")).toBeNull();
    expect(row("Daily digest").querySelector(".org-routes__state")).toHaveTextContent("on");
    expect(row("Daily digest")).toHaveTextContent("Daily digest 09:00 UTC → email");
    expect(row("Weekly insights")).toHaveTextContent("to eng-leads@acme.dev");
  });

  it("reads an off route as off", () => {
    render(
      card({
        roles: ["viewer"],
        routes: notificationRoutes({ items: [route("daily_digest", { enabled: false })] }),
      }),
    );

    expect(row("Daily digest").querySelector(".org-routes__state")).toHaveTextContent("off");
  });

  it("still reads a locked row's reason and its link", () => {
    render(card({ roles: ["viewer"] }));

    expect(row("Loop failures")).toHaveTextContent("locked — connect PagerDuty first");
    expect(within(row("Loop failures")).getByRole("link")).toHaveAttribute("href", "#integrations");
  });

  it("gets no switch on a locked route that is saved on", () => {
    const routes = notificationRoutes({
      items: [route("loop_failures", { channel: "pagerduty", locked: true, lockedReason: "connect PagerDuty first" })],
    });
    render(card({ roles: ["member"], routes }));

    expect(within(seat()).queryByRole("switch")).toBeNull();
    expect(row("Loop failures")).toHaveTextContent(SAVED_ON_CANNOT_FIRE);
  });
});
