import { Button } from "@/app/ui";

/**
 * A narrow viewport's way back to a region mockup 05 hides below 1000px — the explorer or the right
 * panel (V.5, [#173](https://github.com/NobuData/ouroboros/issues/173); V.7,
 * [#175](https://github.com/NobuData/ouroboros/issues/175)).
 *
 * A WAI-ARIA disclosure button: it names the region it controls and says whether that region is shown.
 * Whether it is drawn at all is CSS's doing (the workbench's row of toggles shows only below 1000px),
 * so the markup is one in every width and both palettes.
 */

/** What the toggle takes. */
export interface CodeToggleProps {
  /** What the button says — the region it shows. */
  readonly label: string;
  /** The controlled region's element id. */
  readonly controls: string;
  /** Whether the region is shown. */
  readonly open: boolean;
  /** Show or hide it. */
  readonly onToggle: () => void;
  /** Placement classes, when a region's sheet needs a hook on its own toggle. */
  readonly className?: string;
}

/**
 * The toggle.
 *
 * @param props See {@link CodeToggleProps}.
 * @returns A small ghost button.
 */
export function CodeToggle({ label, controls, open, onToggle, className }: CodeToggleProps) {
  return (
    <Button
      aria-controls={controls}
      aria-expanded={open}
      className={className}
      onClick={onToggle}
      size="sm"
      tone="ghost"
    >
      {label}
    </Button>
  );
}
