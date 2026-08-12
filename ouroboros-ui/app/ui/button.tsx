import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

import { cx } from "./class-names";

import "./ui.css";

/**
 * The mockups' `.btn` as a component: the product's one button.
 *
 * It renders a `<button>` or an `<a>`, and which it is depends on what it does rather than
 * on how it should look — a control that acts is a button, a control that navigates is a
 * link, and the treatment is the same either way. That distinction is not cosmetic: the
 * login screen's "Continue with GitHub" goes to an operation that answers `302` to
 * github.com, and a button could not follow it.
 *
 * ### A control that cannot act says why
 *
 * `reason` is how a button is switched off, and it is deliberately the *explanation* rather
 * than a boolean: the design system (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.5) asks that a
 * control which cannot act be labelled rather than dropped or left dead, so there is no way
 * to make one inert here without saying what is missing. It sets `aria-disabled` rather
 * than `disabled`, because a `disabled` button leaves the tab order and takes its own
 * explanation with it — the keyboard reader who most needs the tooltip is the one who could
 * never reach it — and it both drops `onClick` and refuses to be a submit button, so an
 * inert control can neither fire a handler nor submit the form around it, whatever the
 * caller passed.
 *
 * It is available on the button form only. An inert *link* has no honest rendering: keep
 * the `href` and it still navigates, drop it and the element leaves the tab order, taking
 * the explanation with it exactly as `disabled` would. A navigation that is not yet
 * possible is a button with a reason, or it is not on the screen.
 */

/** Which treatment a button takes. */
export type ButtonTone =
  /** The default: a raised control on a hairline. */
  | "default"
  /** The accent fill and its glow. One per view — the thing to do next. */
  | "primary"
  /** Transparent, for the action beside the primary one. */
  | "ghost"
  /** Destructive, in the error hue. */
  | "danger";

/** How large a button is. `md` is the mockups' default. */
export type ButtonSize =
  /** Dense: inside a table row, a card head, a toolbar. */
  | "sm"
  /** The default. */
  | "md"
  /** A full-height call to action, as the login screen's two are. */
  | "lg";

/** What every shape of button takes. */
interface ButtonCommon {
  /** Which treatment. Defaults to `default`. */
  readonly tone?: ButtonTone;
  /** How large. Defaults to `md`. */
  readonly size?: ButtonSize;
  /** Whether it fills the width it is given, rather than hugging its label. */
  readonly block?: boolean;
  /** The label, plus any icon element beside it. */
  readonly children?: ReactNode;
  /** Classes from the page — placement only, never colour or type. */
  readonly className?: string;
}

/** The acting form. */
export type ButtonProps = ButtonCommon &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children" | "disabled"> & {
    readonly href?: undefined;
    /**
     * Why this control cannot act yet. Its presence is what makes the button inert: it
     * becomes the tooltip, sets `aria-disabled`, and suppresses `onClick`.
     */
    readonly reason?: string;
  };

/** The navigating form. */
export type ButtonLinkProps = ButtonCommon &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children"> & {
    /** Where it goes. Its presence is what makes this an anchor. */
    readonly href: string;
    /** Not available on a link — see the note above. */
    readonly reason?: never;
  };

/** The modifier each tone adds, or nothing for the default treatment. */
const TONE_CLASS: Record<ButtonTone, string> = {
  default: "",
  primary: "ou-btn--primary",
  ghost: "ou-btn--ghost",
  danger: "ou-btn--danger",
};

/** The modifier each size adds, or nothing for the default one. */
const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "ou-btn--sm",
  md: "",
  lg: "ou-btn--lg",
};

/**
 * The button.
 *
 * @param props The treatment, the size, and either an `href` (a link) or the rest of a
 *   button's own attributes — including `reason`, which makes it inert.
 * @returns An `<a>` when `href` is present, otherwise a `<button>`.
 */
export function Button(props: ButtonProps | ButtonLinkProps) {
  // Both branches drop this primitive's own props before spreading the rest onto the
  // element, so nothing here reaches the DOM as an unknown attribute.
  if (props.href !== undefined) {
    const { tone, size, block, className, children, reason, ...rest } = props;

    // `reason` is typed `never` here and is pulled out rather than spread: an unknown
    // attribute on an `<a>` is a React warning, and an inert link has no honest rendering.
    void reason;

    return (
      <a {...rest} className={buttonClass(tone, size, block, className)}>
        {children}
      </a>
    );
  }

  const {
    tone,
    size,
    block,
    className,
    children,
    href,
    reason,
    onClick,
    type = "button",
    title,
    ...rest
  } = props;

  // Typed `undefined` on this branch — pulled out so a `<button href>` cannot be rendered
  // by a caller reaching past the types.
  void href;

  const inert = reason !== undefined;

  return (
    <button
      {...rest}
      // An inert control is never a submit button, whatever the caller asked for: the form
      // around it would still accept the press, and `aria-disabled` does not stop a
      // browser submitting.
      type={inert ? "button" : type}
      className={buttonClass(tone, size, block, className)}
      // The reason is the tooltip unless the caller wrote a more specific one.
      title={title ?? reason}
      aria-disabled={inert || undefined}
      // An inert control must not be able to act, whatever handler was passed to it.
      onClick={inert ? undefined : onClick}
    >
      {children}
    </button>
  );
}

/**
 * The class list a button wears, for either element.
 *
 * @param tone Which treatment, defaulting to `default`.
 * @param size How large, defaulting to `md`.
 * @param block Whether it fills its column.
 * @param className Whatever the page added.
 * @returns The joined class list.
 */
function buttonClass(
  tone: ButtonTone = "default",
  size: ButtonSize = "md",
  block?: boolean,
  className?: string,
): string {
  return cx(
    "ou-btn",
    TONE_CLASS[tone],
    SIZE_CLASS[size],
    block && "ou-btn--block",
    className,
  );
}
