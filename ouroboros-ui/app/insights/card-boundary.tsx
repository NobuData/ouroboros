"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

import { Card, EmptyState } from "@/app/ui";

import { CARD_FAILED_NOTE, CARD_FAILED_TITLE } from "./states-view";

/** What the boundary is told. */
interface CardBoundaryProps {
  /** The grid placement the card it stands in for takes — `insights-col--8` — so nothing moves. */
  readonly className: string;
  /** What the card is — the region's accessible name while it stands in. */
  readonly label: string;
  /** The card. */
  readonly children: ReactNode;
}

/** Whether the card under the boundary has thrown. */
interface CardBoundaryState {
  readonly failed: boolean;
}

/**
 * One card's designed error (BK.6, [#447](https://github.com/NobuData/ouroboros/issues/447)):
 * **one failing card degrades itself, not the page.**
 *
 * The page is one payload, so a refused read is the page banner's to explain, once. What can
 * still fail is a single card's drawing of its part — a shape it did not expect — and without
 * this, React would unmount the whole screen for it. Each card sits under its own boundary, which
 * draws a card of the same width saying it could not be drawn, while every other card, the head
 * and the range keep working.
 *
 * An error boundary is a class: React has no hook for `componentDidCatch`.
 */
export class CardBoundary extends Component<CardBoundaryProps, CardBoundaryState> {
  /** Nothing has failed yet. */
  state: CardBoundaryState = { failed: false };

  /**
   * Mark the card failed — React's render-phase hook.
   *
   * @returns The failed state.
   */
  static getDerivedStateFromError(): CardBoundaryState {
    return { failed: true };
  }

  /**
   * Say what failed in the console, where a developer looks, and nowhere a reader does.
   *
   * @param error What the card threw.
   * @param info Where.
   */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Insights card "${this.props.label}" failed to draw`, error, info.componentStack);
  }

  /**
   * The card, or its designed error.
   *
   * @returns What to draw.
   */
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <Card aria-label={this.props.label} as="section" className={this.props.className} fill>
        <EmptyState fill note={CARD_FAILED_NOTE} title={CARD_FAILED_TITLE} />
      </Card>
    );
  }
}
