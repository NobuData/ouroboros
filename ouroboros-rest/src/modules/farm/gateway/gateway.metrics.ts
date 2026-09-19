/**
 * What the agent gateway counts — the connection metrics AJ.4 will retain.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)): *connection metrics captured
 * in a shape AJ.4 ([#266](https://github.com/NobuData/ouroboros/issues/266)) can later retain*.
 * That ticket is the health-history store; this is the thing it will sample. So the contract here
 * is the {@link GatewayMetricsSnapshot} shape rather than any storage: plain counters that only
 * ever go up, two gauges read at the moment of the snapshot, and a timestamp — which is what a
 * poller needs to turn a series of snapshots into rates without this process remembering
 * anything about the past.
 *
 * **Counters are per process and start at zero.** A replica that restarts reports from zero
 * again, and `started_at` is in the snapshot so a consumer can tell a reset from a quiet hour.
 * Nothing here is per runner: a per-runner series is AJ.4's to key and retain, and the gateway
 * holding one would be a memory cost that grows with the fleet.
 *
 * **Every refusal is counted by why**, because the one failure the issue calls *silent* — a proxy
 * that strips client certificates — shows up here first, as `refused.no_certificate` climbing
 * while nothing else moves. The gateway's log says it once; this says how often.
 */

import { Injectable } from "@nestjs/common";

import { MESSAGE_TYPES, type MessageType } from "../protocol/protocol";

/** Why a connection was turned away, before or after its upgrade. */
export type RefusalReason =
  /** No client certificate and no bearer secret: most often a stripping proxy. */
  | "no_certificate"
  /** A certificate or bearer secret that is not a live runner identity. */
  | "identity"
  /** A `hello` below a version floor, or in a line this gateway cannot speak. */
  | "version"
  /** A `hello` whose claimed security mode contradicts the transport. */
  | "security_mode"
  /** No `hello` within the timeout. */
  | "hello_timeout"
  /** The runner was removed between authenticating and saying hello. */
  | "removed";

/** Every counter, as AJ.4 will read it. */
export interface GatewayMetricsSnapshot {
  /** When this snapshot was taken. */
  readonly at: string;
  /** When this process's counters started. */
  readonly started_at: string;
  readonly connections: {
    /** Sockets open right now. A gauge. */
    readonly active: number;
    /** Upgrades completed since `started_at`. */
    readonly opened: number;
    /** Sockets closed since `started_at`, for any reason. */
    readonly closed: number;
    /** Hellos acknowledged. */
    readonly acknowledged: number;
    /** Of those, the ones that resumed the session they named. */
    readonly resumed: number;
    /** Sessions whose socket a newer connection from the same runner replaced. */
    readonly replaced: number;
  };
  readonly sessions: {
    /** Sessions with a socket. A gauge. */
    readonly attached: number;
    /** Sessions waiting out their resume window. A gauge. */
    readonly detached: number;
    /** Sessions that outlived their resume window unclaimed. */
    readonly expired: number;
  };
  /** Connections turned away, by why. */
  readonly refused: Readonly<Record<RefusalReason, number>>;
  /** Frames received from agents, by type. */
  readonly received: Readonly<Record<MessageType, number>>;
  /** Frames sent to agents, by type. */
  readonly sent: Readonly<Record<MessageType, number>>;
  readonly terminal: {
    /** Terminal frames recorded for the first time. */
    readonly recorded: number;
    /** Re-sends the ledger recognised and answered `duplicate: true`. */
    readonly duplicates: number;
  };
  /** Frames an agent sent that the contract refuses, and on which the session was closed. */
  readonly violations: number;
  readonly presence: {
    /** Runners the sweep flipped `offline`. */
    readonly swept_offline: number;
    /** Sockets closed because they stopped carrying heartbeats. */
    readonly stale_closed: number;
  };
}

/** A zeroed counter for every message type. */
function perType(): Record<MessageType, number> {
  return Object.fromEntries(MESSAGE_TYPES.map((type) => [type, 0])) as Record<MessageType, number>;
}

@Injectable()
export class GatewayMetrics {
  private readonly startedAt = new Date();
  private active = 0;
  private opened = 0;
  private closed = 0;
  private acknowledged = 0;
  private resumed = 0;
  private replaced = 0;
  private expired = 0;
  private readonly refused: Record<RefusalReason, number> = {
    no_certificate: 0,
    identity: 0,
    version: 0,
    security_mode: 0,
    hello_timeout: 0,
    removed: 0,
  };
  private readonly received = perType();
  private readonly sent = perType();
  private recorded = 0;
  private duplicates = 0;
  private violations = 0;
  private sweptOffline = 0;
  private staleClosed = 0;

  /** A socket was upgraded. */
  connectionOpened(): void {
    this.opened += 1;
    this.active += 1;
  }

  /** A socket closed. */
  connectionClosed(): void {
    this.closed += 1;
    this.active = Math.max(0, this.active - 1);
  }

  /**
   * A hello was acknowledged.
   *
   * @param resumed - Whether it resumed its session.
   */
  helloAcknowledged(resumed: boolean): void {
    this.acknowledged += 1;
    if (resumed) this.resumed += 1;
  }

  /** A session's socket was replaced by a newer connection from the same runner. */
  sessionReplaced(): void {
    this.replaced += 1;
  }

  /**
   * Sessions outlived their resume window.
   *
   * @param count - How many.
   */
  sessionsExpired(count: number): void {
    this.expired += count;
  }

  /**
   * A connection was turned away.
   *
   * @param reason - Why.
   */
  connectionRefused(reason: RefusalReason): void {
    this.refused[reason] += 1;
  }

  /**
   * A frame arrived and decoded.
   *
   * @param type - Its type.
   */
  frameReceived(type: MessageType): void {
    this.received[type] += 1;
  }

  /**
   * A frame was written.
   *
   * @param type - Its type.
   */
  frameSent(type: MessageType): void {
    this.sent[type] += 1;
  }

  /**
   * A terminal frame was recorded or recognised.
   *
   * @param duplicate - Whether the ledger already held it.
   */
  terminalRecorded(duplicate: boolean): void {
    if (duplicate) this.duplicates += 1;
    else this.recorded += 1;
  }

  /** An agent broke the contract and its session was closed. */
  violation(): void {
    this.violations += 1;
  }

  /**
   * The presence sweep flipped runners offline.
   *
   * @param count - How many.
   */
  swept(count: number): void {
    this.sweptOffline += count;
  }

  /** A socket that stopped carrying heartbeats was closed. */
  staleClosedOne(): void {
    this.staleClosed += 1;
  }

  /**
   * Everything, as of now.
   *
   * @param sessions - The registry's gauges, which it owns and this reads at the moment asked.
   * @param at - When. The caller's clock, so a suite can pin it.
   * @returns The snapshot — a fresh object; mutating it changes nothing here.
   */
  snapshot(
    sessions: { attached: number; detached: number },
    at: Date = new Date(),
  ): GatewayMetricsSnapshot {
    return {
      at: at.toISOString(),
      started_at: this.startedAt.toISOString(),
      connections: {
        active: this.active,
        opened: this.opened,
        closed: this.closed,
        acknowledged: this.acknowledged,
        resumed: this.resumed,
        replaced: this.replaced,
      },
      sessions: { attached: sessions.attached, detached: sessions.detached, expired: this.expired },
      refused: { ...this.refused },
      received: { ...this.received },
      sent: { ...this.sent },
      terminal: { recorded: this.recorded, duplicates: this.duplicates },
      violations: this.violations,
      presence: { swept_offline: this.sweptOffline, stale_closed: this.staleClosed },
    };
  }
}
