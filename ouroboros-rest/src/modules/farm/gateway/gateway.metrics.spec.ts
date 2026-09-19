import { MESSAGE_TYPES } from "../protocol/protocol";
import { GatewayMetrics } from "./gateway.metrics";

describe("the gateway's metrics", () => {
  it("starts every counter at zero, and has one for every message type in each direction", () => {
    const snapshot = new GatewayMetrics().snapshot({ attached: 0, detached: 0 }, new Date(0));

    expect(Object.keys(snapshot.received)).toEqual([...MESSAGE_TYPES]);
    expect(Object.keys(snapshot.sent)).toEqual([...MESSAGE_TYPES]);
    expect(Object.values(snapshot.received).every((n) => n === 0)).toBe(true);
    expect(snapshot.refused).toEqual({
      no_certificate: 0,
      identity: 0,
      version: 0,
      security_mode: 0,
      hello_timeout: 0,
      removed: 0,
    });
    expect(snapshot.at).toBe("1970-01-01T00:00:00.000Z");
  });

  it("counts what happened, and reads the gauges it is handed", () => {
    const metrics = new GatewayMetrics();

    metrics.connectionOpened();
    metrics.connectionOpened();
    metrics.connectionClosed();
    metrics.helloAcknowledged(false);
    metrics.helloAcknowledged(true);
    metrics.sessionReplaced();
    metrics.sessionsExpired(3);
    metrics.connectionRefused("no_certificate");
    metrics.frameReceived("heartbeat");
    metrics.frameSent("ack");
    metrics.terminalRecorded(false);
    metrics.terminalRecorded(true);
    metrics.violation();
    metrics.swept(2);
    metrics.staleClosedOne();

    const snapshot = metrics.snapshot({ attached: 1, detached: 4 });

    expect(snapshot.connections).toEqual({
      active: 1,
      opened: 2,
      closed: 1,
      acknowledged: 2,
      resumed: 1,
      replaced: 1,
    });
    expect(snapshot.sessions).toEqual({ attached: 1, detached: 4, expired: 3 });
    expect(snapshot.refused.no_certificate).toBe(1);
    expect(snapshot.received.heartbeat).toBe(1);
    expect(snapshot.sent.ack).toBe(1);
    expect(snapshot.terminal).toEqual({ recorded: 1, duplicates: 1 });
    expect(snapshot.violations).toBe(1);
    expect(snapshot.presence).toEqual({ swept_offline: 2, stale_closed: 1 });
  });

  it("never reports a negative gauge", () => {
    const metrics = new GatewayMetrics();
    metrics.connectionClosed();

    expect(metrics.snapshot({ attached: 0, detached: 0 }).connections.active).toBe(0);
  });

  it("hands out a copy — changing a snapshot changes nothing inside", () => {
    const metrics = new GatewayMetrics();
    const snapshot = metrics.snapshot({ attached: 0, detached: 0 });

    (snapshot.refused as Record<string, number>).identity = 99;

    expect(metrics.snapshot({ attached: 0, detached: 0 }).refused.identity).toBe(0);
  });

  it("is plain JSON, which is the shape AJ.4 retains", () => {
    const snapshot = new GatewayMetrics().snapshot({ attached: 0, detached: 0 });

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});
