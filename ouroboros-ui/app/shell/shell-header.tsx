import { Settings } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

/**
 * The fixed header: brand on the left, session controls on the right.
 *
 * It carries **no navigation links** — navigation is the sidebar's job
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.1, which supersedes the top-bar nav the
 * mockups were drawn with). A Server Component: nothing here needs the browser except
 * the theme toggle and the account menu, each its own Client Component.
 *
 * Three slots the specification puts in this bar are deliberately absent rather than
 * mocked up, because each has an issue that will fill it with something true: the
 * tenant chip (#77), the search pill and ⌘K palette (#79), and the live-loops pill with
 * real counts (#78).
 *
 * @returns The header row.
 */
export function ShellHeader() {
  return (
    <header className="shell-header">
      <Link className="shell-brand" href="/">
        <BrandMark />
        <span className="shell-brand__wordmark">
          OURO<span className="shell-brand__wordmark-accent">BOROS</span>
        </span>
      </Link>

      <div className="shell-header__cluster">
        {/*
          The needs-you indicator, as a placeholder — this issue's scope, and #78's to
          replace with the real count once the dashboard aggregate (#70) exists. The
          count is an em dash because the design system forbids inventing one (§ 3.5):
          a hard-coded "3" is a number a reader would believe.
        */}
        <span
          className="shell-pill"
          title="Needs-you counts arrive with #78, once there is a count to show."
        >
          Needs you <span className="shell-pill__count">—</span>
        </span>

        <ThemeToggle />

        {/*
          aria-disabled, not disabled: the gear stays reachable by keyboard so its
          accessible name can say why it does nothing, and it has no handler, so it
          does nothing. #491 turns it into a link to /settings.
        */}
        <button
          type="button"
          className="shell-icon-button"
          aria-disabled="true"
          aria-label="Workspace settings — arrives with #491"
          title="Workspace settings arrive with #491."
        >
          <Settings size={16} aria-hidden />
        </button>

        <UserMenu />
      </div>
    </header>
  );
}

/**
 * The brand mark, in the treatment its ground calls for.
 *
 * Both files are rendered and CSS shows one, mirroring the token sheet's three palette
 * blocks (light, explicit dark, dark-from-the-OS) in `shell.css`. Choosing in
 * JavaScript instead would pick after hydration — a visible swap of the logo on every
 * load, which is the same flash the theme bootstrap (#17) exists to avoid.
 *
 * The two are stacked in one grid cell and the hidden one is transparent rather than
 * `display: none`, so a theme change cross-fades the mark along with everything else it
 * changes instead of snapping it mid-fade. Stacked, neither can move the row.
 *
 * It is the **icon**, not the glyph `docs/BRAND.md` nominates for the app shell,
 * because the glyph stops reading below 96px wide and the header is 56px tall — a
 * case that document answers itself: under that width, use the icon. The pair is
 * pixel-identical, so the swap never moves the row.
 *
 * @returns The two marks, one of which is visible.
 */
function BrandMark() {
  const size = 30;

  return (
    <span className="shell-brand__marks">
      <Image
        className="shell-brand__mark shell-brand__mark--light"
        src="/brand/icon-light.png"
        alt=""
        width={size}
        height={size}
        priority
      />
      <Image
        className="shell-brand__mark shell-brand__mark--dark"
        src="/brand/icon-dark.png"
        alt=""
        width={size}
        height={size}
        priority
      />
    </span>
  );
}
