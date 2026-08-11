import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { ThemeProvider } from "@/app/theme-provider";

/**
 * Render inside a `ThemeProvider`, the way the root layout does.
 *
 * Anything containing the theme toggle (#42) needs one: `useTheme()` throws without a
 * provider, deliberately, so that a control which cannot act is a loud failure rather
 * than a silent no-op. Since the shell's header carries the toggle, every suite that
 * renders the header or the shell renders it through this.
 *
 * @param ui The element to render.
 * @returns The Testing Library render result, unchanged.
 */
export function renderThemed(ui: ReactElement) {
  return render(ui, { wrapper: ThemeProvider });
}
