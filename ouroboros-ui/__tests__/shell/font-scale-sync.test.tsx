import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FONT_SCALE_ATTRIBUTE,
  FONT_SCALE_STORAGE_KEY,
  setFontScale,
} from "@/app/font-scale";
import { FontScaleSync } from "@/app/shell/font-scale-sync";

import { authStub, signedIn, signedOut, stillLoading } from "../helpers/account";

/**
 * The reconciliation leg of #649: when the session arrives, the server's per-account truth
 * corrects whatever the boot script painted from this browser's mirror.
 *
 * The two mocks are the component's two edges — the session hook, stubbed the way
 * `user-menu.test.tsx` stubs it, and the Server Action, which a jsdom test cannot cross
 * for real. What is real in between is the engine: `setFontScale` genuinely stamps
 * `<html>` and writes the mirror, so the assertions read the document rather than a spy's
 * call list. The engine's module state carries across cases by design (it is a singleton
 * in the product too); each case therefore starts by applying a known step rather than
 * assuming a fresh world.
 */

vi.mock("@/app/api/auth-client", async () =>
  (await import("../helpers/account")).authClientModule(),
);

/** What `readFontScale()` answers, per case. */
const { readFontScale } = vi.hoisted(() => ({
  readFontScale: vi.fn<() => Promise<"87.5" | "100" | "112.5" | "125" | "150">>(),
}));

vi.mock("@/app/shell/preference-actions", () => ({
  readFontScale: () => readFontScale(),
  saveFontScale: vi.fn(),
}));

beforeEach(() => {
  readFontScale.mockReset();
  // A known starting step, applied through the engine itself so stamp, mirror and store
  // agree — the state a boot from this browser's mirror would have produced.
  setFontScale("100");
});

afterEach(() => {
  cleanup();
});

describe("the font-scale reconciler", () => {
  it("corrects the paint when the server disagrees with the mirror", async () => {
    // The shared-browser case: the mirror says 100 (the last person's), the account says
    // 150. Server wins, and the mirror is repaired for the next boot in the same move.
    signedIn();
    readFontScale.mockResolvedValue("150");

    render(<FontScaleSync />);

    await waitFor(() =>
      expect(document.documentElement.getAttribute(FONT_SCALE_ATTRIBUTE)).toBe("150"),
    );
    expect(window.localStorage.getItem(FONT_SCALE_STORAGE_KEY)).toBe("150");
  });

  it("changes nothing while the session is still on its way", () => {
    stillLoading();

    render(<FontScaleSync />);

    expect(readFontScale).not.toHaveBeenCalled();
  });

  it("asks nobody's preferences for nobody", () => {
    signedOut();

    render(<FontScaleSync />);

    expect(readFontScale).not.toHaveBeenCalled();
  });

  it("leaves the mirror's paint standing when the read fails", async () => {
    // The quiet posture: the reader is already looking at the mirror's paint, which was
    // right for this browser a moment ago. A failed read corrects nothing.
    signedIn();
    setFontScale("112.5");
    readFontScale.mockRejectedValue(new Error("offline"));

    render(<FontScaleSync />);

    await waitFor(() => expect(readFontScale).toHaveBeenCalled());
    expect(document.documentElement.getAttribute(FONT_SCALE_ATTRIBUTE)).toBe("112.5");
  });

  it("reconciles again for the next person, keyed on who the session names", async () => {
    // A sign-out and a different sign-in keep the shell mounted; the person is what
    // changed, so the effect keys on the user id rather than running once.
    signedIn();
    readFontScale.mockResolvedValue("125");

    const { rerender } = render(<FontScaleSync />);
    await waitFor(() =>
      expect(document.documentElement.getAttribute(FONT_SCALE_ATTRIBUTE)).toBe("125"),
    );

    readFontScale.mockResolvedValue("87.5");
    authStub.session = {
      data: {
        user: { ...authStub.session.data!.user, id: "user-somebody-else" },
        session: { activeOrganizationId: null },
      },
      isPending: false,
    };
    rerender(<FontScaleSync />);

    await waitFor(() =>
      expect(document.documentElement.getAttribute(FONT_SCALE_ATTRIBUTE)).toBe("87.5"),
    );
    expect(readFontScale).toHaveBeenCalledTimes(2);
  });
});
