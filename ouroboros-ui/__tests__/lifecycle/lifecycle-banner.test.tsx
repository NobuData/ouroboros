import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceLifecycle } from "@/app/api/settings-lifecycle";
import {
  PAUSED_HEADLINE,
  PAUSED_LABEL,
  RESUME_FAILED,
  RESUME_LABEL,
  WHO_CAN_RESUME,
} from "@/app/lifecycle/banner";
import type { LifecycleOutcome } from "@/app/lifecycle/outcome";
import type { PollAnswer } from "@/app/poll";

import { authStub, signedIn } from "../helpers/account";
import { PAUSED_SENTENCE, lifecycle, pausedLifecycle, pendingDeleteLifecycle } from "../helpers/lifecycle";
import { PALETTES, maskIds, renderInPalette } from "../helpers/palettes";

/**
 * The app-wide paused banner, rendered (BS.6,
 * [#496](https://github.com/NobuData/ouroboros/issues/496)): drawn only while paused, with
 * **Resume** for a reader who may administer and a link for one who may not — and cleared by the
 * resume's own answer.
 */

const resumeWorkspace = vi.fn<() => Promise<LifecycleOutcome<WorkspaceLifecycle>>>();

vi.mock("@/app/lifecycle/lifecycle-actions", () => ({
  resumeWorkspace: () => resumeWorkspace(),
}));
vi.mock("@/app/api/auth-client", async () =>
  (await import("../helpers/account")).authClientModule(),
);

const { LifecycleBanner } = await import("@/app/lifecycle/lifecycle-banner");
const { LifecycleProvider } = await import("@/app/lifecycle/lifecycle-store");

/**
 * The banner under a provider whose poll answers one lifecycle.
 *
 * @param standing What the poll reads.
 * @returns The element, and the poll's reader.
 */
function shell(standing: WorkspaceLifecycle) {
  const read = vi.fn<() => Promise<PollAnswer<WorkspaceLifecycle>>>().mockResolvedValue({
    state: "fresh",
    payload: standing,
    etag: null,
    pollAfterSeconds: null,
  });

  return {
    read,
    ui: (
      <LifecycleProvider leave={() => {}} poll={{ read, visible: () => true }}>
        <LifecycleBanner />
      </LifecycleProvider>
    ),
  };
}

/**
 * Sign in holding a role in the acting workspace.
 *
 * @param role The role the organization plugin answers.
 */
function holding(role: string): void {
  signedIn();
  authStub.getActiveMemberRole.mockResolvedValue({ data: { role }, error: null });
}

/** Let the role read and the poll answer. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  resumeWorkspace.mockReset();
  holding("owner");
});

describe("when it is drawn", () => {
  it("draws nothing outside a provider, before the first answer, or while active", async () => {
    const bare = render(<LifecycleBanner />);
    expect(bare.container.innerHTML).toBe("");
    bare.unmount();

    const { container } = render(shell(lifecycle()).ui);
    expect(container.innerHTML).toBe("");
    await settle();
    expect(container.innerHTML).toBe("");
  });

  it("draws nothing for a workspace pending deletion — that is the recovery screen's", async () => {
    const { container } = render(shell(pendingDeleteLifecycle()).ui);
    await settle();

    expect(container.innerHTML).toBe("");
  });

  it("says the workspace is paused, in the issue's line and the service's sentence", async () => {
    render(shell(pausedLifecycle()).ui);

    const banner = await screen.findByRole("region", { name: PAUSED_LABEL });

    expect(banner).toHaveAttribute("data-lifecycle", "paused");
    expect(within(banner).getByRole("status")).toHaveTextContent(
      `⏸${PAUSED_HEADLINE}${PAUSED_SENTENCE}`,
    );
    // The glyph is decoration: the words carry the meaning.
    expect(within(banner).getByText("⏸")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("the inline resume path", () => {
  it.each([["owner"], ["admin"], ["member,admin"]])("offers Resume to %s", async (role) => {
    holding(role);
    render(shell(pausedLifecycle()).ui);
    await settle();

    expect(screen.getByRole("button", { name: RESUME_LABEL })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: WHO_CAN_RESUME })).toBeNull();
  });

  it.each([["member"], ["viewer"]])("offers %s the way to who can, and no dead button", async (role) => {
    holding(role);
    render(shell(pausedLifecycle()).ui);
    await settle();

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: WHO_CAN_RESUME })).toHaveAttribute("href", "/settings#danger");
    expect(document.querySelector("[disabled], [aria-disabled='true']")).toBeNull();
  });

  it("offers the link while the role is not yet known", async () => {
    signedIn();
    authStub.getActiveMemberRole.mockReturnValue(new Promise(() => {}));
    render(shell(pausedLifecycle()).ui);

    await screen.findByRole("region", { name: PAUSED_LABEL });

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: WHO_CAN_RESUME })).toBeInTheDocument();
  });

  it("resumes on the press and clears on the answer, without waiting for the poll", async () => {
    const { read, ui } = shell(pausedLifecycle());
    resumeWorkspace.mockResolvedValue({ ok: true, value: lifecycle() });
    render(ui);
    await settle();

    // Whatever the poll says next, the answer applied is what clears the banner.
    read.mockResolvedValue({ state: "fresh", payload: lifecycle(), etag: null, pollAfterSeconds: null });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: RESUME_LABEL }));
    });

    expect(resumeWorkspace).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region", { name: PAUSED_LABEL })).toBeNull();
  });

  it("sends one resume for a double press", async () => {
    let answer!: (outcome: LifecycleOutcome<WorkspaceLifecycle>) => void;
    resumeWorkspace.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(shell(pausedLifecycle()).ui);
    await settle();

    const button = screen.getByRole("button", { name: RESUME_LABEL });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(resumeWorkspace).toHaveBeenCalledOnce();
    await act(async () => {
      answer({ ok: true, value: lifecycle() });
    });
  });

  it("says a refusal in the banner, and stays", async () => {
    resumeWorkspace.mockResolvedValue({
      ok: false,
      reason: "Only an owner or an admin may resume.",
      code: "forbidden_role",
    });
    render(shell(pausedLifecycle()).ui);
    await settle();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: RESUME_LABEL }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Only an owner or an admin may resume.");
    expect(screen.getByRole("region", { name: PAUSED_LABEL })).toBeInTheDocument();
  });

  it("says something when the service refused without a sentence", async () => {
    resumeWorkspace.mockResolvedValue({ ok: false, reason: "", code: "unavailable" });
    render(shell(pausedLifecycle()).ui);
    await settle();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: RESUME_LABEL }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(RESUME_FAILED);
  });
});

describe("both palettes", () => {
  it("draws the same markup in both", async () => {
    const drawn: string[] = [];

    for (const palette of PALETTES) {
      const { container, unmount } = renderInPalette(palette, shell(pausedLifecycle()).ui);
      await settle();

      expect(container.querySelector(".lifecycle-banner")).not.toBeNull();
      drawn.push(maskIds(container.innerHTML));
      unmount();
    }

    expect(drawn[0]).toBe(drawn[1]);
  });
});
