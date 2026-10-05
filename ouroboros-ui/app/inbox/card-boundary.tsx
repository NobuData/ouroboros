"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

import { Card, EmptyState } from "@/app/ui";

import { CARD_FAILED_NOTE, CARD_FAILED_TITLE } from "./view";

/** What the boundary is told. */
interface InboxCardBoundaryProps {
  /** What the card is — the stand-in's accessible name, so a reader still knows which one failed. */
  readonly label: string;
  /** The card. */
  readonly children: ReactNode;
}

/** Whether the card under the boundary has thrown. */
interface InboxCardBoundaryState {
  readonly failed: boolean;
}

/**
 * One inbox card's designed error (BO.5, [#470](https://github.com/NobuData/ouroboros/issues/470)):
 * **one failing card degrades itself, not the page.**
 *
 * Insights' `CardBoundary` (BK.6, #447) is the same rule; this one is the inbox's because the two
 * pages place their cards differently — that one takes a grid span, these stack in a list and a
 * column — and because the console line names the page a developer should look at.
 *
 * A failed *read* is not this: each card already says why its read failed, in its own words.
 * What can still fail is one card's drawing of what it was sent — a shape it did not expect — and
 * without a boundary React would unmount the whole inbox for it, the queue with it. Each decision
 * card and each side card sits under its own, which stands in with a card saying it could not be
 * drawn while every other card, the head and the polls keep working.
 *
 * An error boundary is a class: React has no hook for `componentDidCatch`.
 */
export class InboxCardBoundary extends Component<InboxCardBoundaryProps, InboxCardBoundaryState> {
  /** Nothing has failed yet. */
  state: InboxCardBoundaryState = { failed: false };

  /**
   * Mark the card failed — React's render-phase hook.
   *
   * @returns The failed state.
   */
  static getDerivedStateFromError(): InboxCardBoundaryState {
    return { failed: true };
  }

  /**
   * Say what failed in the console, where a developer looks, and nowhere a reader does.
   *
   * @param error What the card threw.
   * @param info Where.
   */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Inbox card "${this.props.label}" failed to draw`, error, info.componentStack);
  }

  /**
   * The card, or its designed error.
   *
   * @returns What to draw.
   */
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <Card aria-label={this.props.label} as="section" className="inbox-fault">
        <EmptyState note={CARD_FAILED_NOTE} title={CARD_FAILED_TITLE} />
      </Card>
    );
  }
}
