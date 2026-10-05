"use client";

import { useEffect, useRef, useState } from "react";

import type { WebhookDelivery, WebhookDeliveryPage } from "@/app/api/settings-webhooks";
import { Button, type Column, Table, cx } from "@/app/ui";

import { readDeliveries, redeliverDelivery } from "./webhook-actions";
import {
  DELIVERIES_EMPTY,
  DELIVERIES_LOADING,
  DELIVERY_COLUMNS,
  DELIVERY_FILTERS,
  DELIVERY_FILTER_LABEL,
  DELIVERY_PAGE_SIZE,
  DLQ_EMPTY,
  type DeliveryFilter,
  NEWER,
  OLDER,
  REDELIVER,
  REDELIVERING,
  STATUS_WORDS,
  type WebhookWrite,
  attemptStamp,
  codeOf,
  deliveryLogTitle,
  detailOf,
  latencyOf,
  rangeLabel,
  redeliverLabel,
  redeliveredSentence,
} from "./view";

import "./webhooks.css";

/** What the log shows: which endpoint, which attempts, which page — and which read of them. */
interface LogRequest {
  readonly filter: DeliveryFilter;
  readonly offset: number;
  /** Bumped to read the same page again — after a redelivery. */
  readonly turn: number;
}

/** A read that has answered, and the request it answered. */
interface LogAnswer {
  readonly key: string;
  readonly result: WebhookWrite<WebhookDeliveryPage>;
}

/** The first page of everything. */
const FIRST: LogRequest = { filter: "all", offset: 0, turn: 0 };

/**
 * One endpoint's delivery log (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)) —
 * the evidence behind *Stream to SIEM*, and each endpoint's own log in the management sheet.
 *
 * One row per attempt, newest first: when, which event, which attempt, how it ended, the
 * receiver's code and latency, and what went wrong. **Dead-lettered** narrows it to the
 * dead-letter queue, where a row the service calls `redeliverable` carries **Redeliver**.
 *
 * ### Never cached, never cut short
 *
 * It reads when it mounts — and a sheet unmounts what it holds when it closes, so every open is
 * a new read: somebody opening it twice in an incident wants the second to include what happened
 * between. The pager says which rows of how many are shown (`1–25 of 132`), so a log longer than
 * a page is visibly longer than a page.
 *
 * @param props.endpointId The endpoint whose log this is.
 * @param props.endpointName Its name, for the table's caption.
 * @returns The log.
 */
export function DeliveryLog({
  endpointId,
  endpointName,
}: Readonly<{ endpointId: string; endpointName: string }>) {
  const [request, setRequest] = useState<LogRequest>(FIRST);
  const [answer, setAnswer] = useState<LogAnswer | null>(null);
  const [notice, setNotice] = useState<{ text: string; failed: boolean } | null>(null);
  const [redelivering, setRedelivering] = useState<string | null>(null);
  // A latch beside the state: two presses inside one frame both read the state as free.
  const sending = useRef(false);

  const key = `${endpointId}|${request.filter}|${String(request.offset)}|${String(request.turn)}`;

  useEffect(() => {
    let current = true;

    void readDeliveries(endpointId, {
      limit: DELIVERY_PAGE_SIZE,
      offset: request.offset,
      ...(request.filter === "dead_lettered" ? { status: "dead_lettered" as const } : {}),
    }).then((result) => {
      // A slower, older read must not overwrite the page the reader has since asked for.
      if (current) setAnswer({ key, result });
    });

    return () => {
      current = false;
    };
  }, [endpointId, request, key]);

  const loading = answer?.key !== key;
  const result = answer?.result ?? null;

  /**
   * Queue one dead-lettered event again, say what happened, and read the page again.
   *
   * @param delivery The dead-lettered attempt.
   */
  async function redeliver(delivery: WebhookDelivery): Promise<void> {
    if (sending.current) return;

    sending.current = true;
    setRedelivering(delivery.id);
    setNotice(null);

    try {
      const outcome = await redeliverDelivery(endpointId, delivery.id);

      setNotice(
        outcome.ok
          ? { text: redeliveredSentence(outcome.value), failed: false }
          : { text: outcome.reason, failed: true },
      );
      setRequest((now) => ({ ...now, turn: now.turn + 1 }));
    } finally {
      sending.current = false;
      setRedelivering(null);
    }
  }

  /** Built per render: the last column's button reads this render's `redelivering`. */
  const columns: readonly Column<WebhookDelivery>[] = [
    {
      key: "at",
      header: DELIVERY_COLUMNS.at,
      mono: true,
      className: "webhooks-log__when",
      cell: (delivery) => attemptStamp(delivery.attemptedAt),
    },
    { key: "event", header: DELIVERY_COLUMNS.event, mono: true, cell: (delivery) => delivery.eventType },
    {
      key: "attempt",
      header: DELIVERY_COLUMNS.attempt,
      align: "end",
      mono: true,
      cell: (delivery) => String(delivery.attempt),
    },
    {
      key: "status",
      header: DELIVERY_COLUMNS.status,
      cell: (delivery) => (
        <span
          className={cx(
            "webhooks-log__status",
            delivery.status === "succeeded" && "webhooks-log__status--ok",
            delivery.status === "failed" && "webhooks-log__status--failed",
            delivery.status === "dead_lettered" && "webhooks-log__status--dead",
          )}
        >
          {STATUS_WORDS[delivery.status]}
        </span>
      ),
    },
    {
      key: "code",
      header: DELIVERY_COLUMNS.code,
      align: "end",
      mono: true,
      cell: (delivery) => codeOf(delivery.responseCode),
    },
    {
      key: "latency",
      header: DELIVERY_COLUMNS.latency,
      align: "end",
      mono: true,
      cell: (delivery) => latencyOf(delivery.latencyMs),
    },
    {
      key: "detail",
      header: DELIVERY_COLUMNS.detail,
      className: "webhooks-log__detail",
      cell: (delivery) => detailOf(delivery),
    },
    {
      key: "action",
      header: DELIVERY_COLUMNS.action,
      cell: (delivery) =>
        delivery.redeliverable ? (
          <Button
            aria-label={redeliverLabel(delivery)}
            onClick={() => void redeliver(delivery)}
            reason={redelivering === null ? undefined : REDELIVERING}
            size="sm"
          >
            {redelivering === delivery.id ? REDELIVERING : REDELIVER}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="webhooks-log">
      <div className="webhooks-log__bar">
        <div aria-label={DELIVERY_FILTER_LABEL} className="webhooks-log__filters" role="group">
          {DELIVERY_FILTERS.map((choice) => (
            <button
              aria-pressed={request.filter === choice.id}
              className="webhooks-log__filter"
              key={choice.id}
              onClick={() => setRequest((now) => ({ filter: choice.id, offset: 0, turn: now.turn }))}
              type="button"
            >
              {choice.label}
            </button>
          ))}
        </div>

        {result?.ok === true && (
          <div className="webhooks-log__pager">
            <span className="webhooks-log__range" role="status">
              {rangeLabel(result.value.offset, result.value.items.length, result.value.total)}
            </span>
            <Button
              onClick={() =>
                setRequest((now) => ({
                  ...now,
                  offset: Math.max(0, now.offset - DELIVERY_PAGE_SIZE),
                }))
              }
              reason={result.value.offset > 0 ? undefined : "These are the newest attempts."}
              size="sm"
              tone="ghost"
            >
              {NEWER}
            </Button>
            <Button
              onClick={() =>
                setRequest((now) => ({ ...now, offset: now.offset + DELIVERY_PAGE_SIZE }))
              }
              reason={
                result.value.offset + result.value.items.length < result.value.total
                  ? undefined
                  : "These are the oldest attempts."
              }
              size="sm"
              tone="ghost"
            >
              {OLDER}
            </Button>
          </div>
        )}
      </div>

      {notice !== null && (
        <p
          className={cx("webhooks-log__notice", notice.failed && "webhooks-log__notice--failed")}
          role={notice.failed ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}

      {loading && (
        <p className="webhooks-log__state" role="status">
          {DELIVERIES_LOADING}
        </p>
      )}

      {result !== null && !result.ok && !loading && (
        <p className="webhooks-log__state" role="alert">
          {result.reason}
        </p>
      )}

      {result?.ok === true && result.value.items.length === 0 && !loading && (
        <p className="webhooks-log__state">
          {request.filter === "dead_lettered" ? DLQ_EMPTY : DELIVERIES_EMPTY}
        </p>
      )}

      {result?.ok === true && result.value.items.length > 0 && (
        <Table
          caption={deliveryLogTitle(endpointName)}
          captionHidden
          className="webhooks-log__table"
          columns={columns}
          rowKey={(delivery) => delivery.id}
          rows={result.value.items}
        />
      )}
    </div>
  );
}
