import { Bell } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { DASHBOARD_PATH } from "@/app/paths";

import { SearchPill } from "./search-pill";
import { SidebarToggle } from "./sidebar-toggle";
import { TenantChip } from "./tenant-chip";
import { UserMenu } from "./user-menu";

/**
 * The fixed header: brand and workspace on the left, session controls on the right.
 *
 * It carries **no navigation links** — navigation is the sidebar's job
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.1, which supersedes the top-bar nav the mockups were
 * drawn with). A Server Component: nothing in the bar itself needs the browser, and each part
 * that does is its own Client Component.
 *
 * ### The bar is a set of slots, and CP.1 is what put them all in it
 *
 * [#643](https://github.com/NobuData/ouroboros/issues/643) is the issue that owns the *shape*
 * of this row — every slot § 1.1 names, in the order it names them:
 *
 * ```
 * [◎ OUROBOROS] [acme-robotics]        [Search ⌘K] [● — loops live] [Needs you —] [🔔] [◐] [⚙] [KS ▾]
 * ```
 *
 * What fills each one is somebody else's issue, and the ones still waiting say so rather than
 * showing a number nobody computed — the design system's honesty rule (§ 3.5). The counts are
 * [#78](https://github.com/NobuData/ouroboros/issues/78); the palette behind the search pill
 * is [#79](https://github.com/NobuData/ouroboros/issues/79); switching workspace from the chip
 * is [#77](https://github.com/NobuData/ouroboros/issues/77); the settings screen is
 * [#491](https://github.com/NobuData/ouroboros/issues/491).
 *
 * Two controls left this bar with CP.3
 * ([#645](https://github.com/NobuData/ouroboros/issues/645)), exactly as the paragraph that
 * used to stand here promised: the theme toggle (#42) became the account menu's radio group
 * — a second surface over the same #17 engine, not a second engine — and the disabled
 * settings gear was absorbed by the menu's *Workspace settings* item, which already said the
 * same thing (#491). § 1.1 puts both inside the profile menu, and a control drawn twice is a
 * state that can be read twice differently.
 *
 * @returns The header row.
 */
export function ShellHeader() {
  return (
    <header className="shell-header">
      {/*
        The way into the navigation when the navigation is not on screen: below 768px the
        sidebar is an overlay drawer (CP.2, #644) and the header is the only chrome left. The
        control is drawn nowhere else, and above that width the stylesheet does not draw it at
        all. First in the row because that is where a reader reaches for it, and because it
        opens the region immediately below it.
      */}
      <SidebarToggle />

      {/*
        To the dashboard, not to `/`. § 1.1 says "links to Dashboard", and since #45 moved it
        to a segment of its own that is a different URL — `/` only redirects there, so linking
        to it would spend a round trip on every press of the brand.
      */}
      <Link className="shell-brand" href={DASHBOARD_PATH}>
        <BrandMark />
        <span className="shell-brand__wordmark">
          OURO<span className="shell-brand__wordmark-accent">BOROS</span>
        </span>
      </Link>

      <TenantChip />

      <div className="shell-header__cluster">
        <SearchPill />

        {/*
          The live-loops pill. The dot is the treatment docs/DESIGN_TOKENS.md reserves for a
          live thing, and the count is an em dash because the design system forbids inventing
          one (§ 3.5): a hard-coded "3" is a number a reader would believe.
        */}
        <span
          className="shell-pill"
          title="Live loop counts arrive with #78, once the dashboard aggregate (#70) can be asked for one."
        >
          <span className="shell-pill__dot" aria-hidden />
          <span className="shell-pill__count">—</span> loops live
        </span>

        <span
          className="shell-pill"
          title="Needs-you counts arrive with #78, once there is a count to show."
        >
          Needs you <span className="shell-pill__count">—</span>
        </span>

        {/*
          The notifications affordance § 1.1 asks for. aria-disabled rather than disabled, the
          same way the gear below is: a control removed from the tab order takes its own
          explanation with it, and the explanation is the only thing this one has to offer
          until the needs-you inbox exists to feed it.
        */}
        <button
          type="button"
          className="shell-icon-button"
          aria-disabled="true"
          aria-label="Notifications — arrive with the needs-you inbox (mockup 16)"
          title="Notifications arrive with the needs-you inbox roadmap (mockup 16)."
        >
          <Bell size={16} aria-hidden />
        </button>

        <UserMenu />
      </div>
    </header>
  );
}

/**
 * The brand mark, in the treatment its ground calls for.
 *
 * Both files are rendered and CSS shows one, mirroring the token sheet's three palette blocks
 * (light, explicit dark, dark-from-the-OS) in `shell.css`. Choosing in JavaScript instead
 * would pick after hydration — a visible swap of the logo on every load, which is the same
 * flash the theme bootstrap (#17) exists to avoid.
 *
 * The two are stacked in one grid cell and the hidden one is transparent rather than
 * `display: none`, so a theme change cross-fades the mark along with everything else it
 * changes instead of snapping it mid-fade. Stacked, neither can move the row.
 *
 * It is the **icon**, not the glyph `docs/BRAND.md` nominates for the app shell, because the
 * glyph stops reading below 96px wide and the header is 56px tall — a case that document
 * answers itself: under that width, use the icon. The pair is pixel-identical, so the swap
 * never moves the row.
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
