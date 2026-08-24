/**
 * The UI component primitives ([#46](https://github.com/NobuData/ouroboros/issues/46)) —
 * the set every screen in this module is built from.
 *
 * `docs/mockups/assets/ouroboros.css` is the design system the twenty-two mockups were
 * drawn against; `app/ui/ui.css` is that sheet expressed in the #16 design tokens, and
 * these are the components over it. Nothing here fetches, routes, or decides: a primitive
 * takes what to draw and draws it, in either palette, from tokens alone.
 *
 * ```tsx
 * import { Button, Card, CardHead, Chip } from "@/app/ui";
 * ```
 *
 * Importing from this barrel is the ergonomic form; importing a module directly
 * (`@/app/ui/button`) works identically, because every module imports the stylesheet
 * itself rather than relying on this file to have done it.
 *
 * ### What belongs here
 *
 * A primitive is a shape the design system names, used by more than one screen, that
 * decides nothing about the product. What does *not* belong here is a screen's own
 * composition — the dashboard's stat tile, the login screen's workspace row — which is
 * built *from* these in the screen's own directory. The rule that keeps the line visible:
 * a primitive names no domain concept. There is no `<WorkspaceCard>` in this directory and
 * there should not be.
 *
 * The shell's chrome primitives joined this set with CP.4
 * ([#646](https://github.com/NobuData/ouroboros/issues/646)): `StickyBar` and `PageSubnav`
 * live here, the shell's own frame (ShellHeader, SidebarNav, the pane) stays in
 * `app/shell`, and the stacking contract between all of them is `app/ui/chrome.ts`. The
 * isolated playground for the set is the component workshop,
 * [#48](https://github.com/NobuData/ouroboros/issues/48) — seeded, until its tooling
 * lands, by the in-app story at `app/workshop/`.
 */

export { Badge, Tag, type BadgeTone } from "./badge";
export { Button, type ButtonLinkProps, type ButtonProps, type ButtonSize, type ButtonTone } from "./button";
export { Card, CardHead, type CardProps, type CardSize, type CardTone } from "./card";
export { Chip, EffortChip, type ChipDot, type ChipProps, type ChipTone, type Effort } from "./chip";
export {
  CHROME_BAR_PROPERTY,
  CHROME_SUBNAV_PROPERTY,
  chromeScrollContainer,
  publishChromeExtent,
} from "./chrome";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { Eyebrow, type EyebrowTone } from "./eyebrow";
export { Meter, type MeterProps, type MeterTone } from "./meter";
export {
  PageSubnav,
  SubnavSoon,
  type PageSubnavProps,
  type SubnavSoonProps,
  type SubnavTone,
} from "./page-subnav";
export {
  SelectField,
  TextField,
  Toggle,
  type SelectFieldProps,
  type TextFieldProps,
  type ToggleProps,
} from "./field";
export { StickyBar, type StickyBarProps, type StickyBarTone } from "./sticky-bar";
export { Table, type Column, type ColumnAlign, type TableProps } from "./table";
export { cx, type ClassName } from "./class-names";
export { useChromeExtent } from "./use-chrome-extent";
