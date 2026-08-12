/**
 * Joining class names, once, for every primitive in this directory.
 *
 * Each primitive composes its class list the same way — a base class, a modifier per prop
 * that has one, and whatever the caller passed in `className` — and every one of them would
 * otherwise repeat the same template-literal-and-filter dance. This is that dance, written
 * down once.
 *
 * There is no dependency behind it on purpose. `clsx` and `classnames` are three lines each
 * and this is one of them; the primitives are the module's lightweight half
 * (`#46`: "no external component framework"), and a package in `dependencies` is a package
 * in the container image.
 */

/**
 * One part of a class list: a name, or a condition that produced no name.
 *
 * `false`, `null` and `undefined` are all accepted because all three are what an inline
 * condition naturally evaluates to — `props.block && "ou-btn--block"`, an optional prop
 * left out, a lookup that missed.
 */
export type ClassName = string | false | null | undefined;

/**
 * Join class names, dropping the ones that are not there.
 *
 * @param parts The candidate class names, in the order they should appear.
 * @returns The parts that are non-empty strings, separated by single spaces — `""` when
 *   there are none, which React renders as no attribute value rather than as `undefined`.
 */
export function cx(...parts: readonly ClassName[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}
