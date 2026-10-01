"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button, EmptyState } from "@/app/ui";

import { NO_REASON, TRYING_AGAIN, TRY_AGAIN } from "./states";

import "./knowledge.css";

/**
 * A card whose read was refused (BG.6, [#422](https://github.com/NobuData/ouroboros/issues/422)):
 * what could not be read, the service's own reason, and **Try again**.
 *
 * Each card's read is its own `Reading` (`app/api/reading.ts`), so one failing service degrades
 * one card and never the page. This is what that card draws in place of its rows — a designed
 * error rather than a blank region (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.5) — and its one action
 * re-reads the page, which leaves the cards that could be read exactly as they are.
 *
 * @param props.title What could not be read — the card's own sentence.
 * @param props.reason Why, in the service's words.
 * @returns The state.
 */
export function KnowledgeUnread({ title, reason }: Readonly<{ title: string; reason?: string }>) {
  const router = useRouter();
  const [reading, startReading] = useTransition();

  return (
    <EmptyState note={reason ?? NO_REASON} title={title} variant="flush">
      <div className="knowledge-unread__actions">
        <Button
          onClick={() => { startReading(() => { router.refresh(); }); }}
          reason={reading ? TRYING_AGAIN : undefined}
          size="sm"
        >
          {reading ? TRYING_AGAIN : TRY_AGAIN}
        </Button>
      </div>
    </EmptyState>
  );
}
