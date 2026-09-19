/**
 * The four things the gateway does with a socket, as an interface — and the `ws` socket that
 * implements it.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)). The session registry and the
 * per-connection protocol are written against {@link AgentSocket} rather than against `ws`
 * directly, for one reason: their suites can then drive a socket that drops a write, closes
 * mid-frame or never opens, deterministically, without a network. The real socket is
 * {@link wsSocket}, three lines of adaptation, and `agent.gateway.integration-spec.ts` is where
 * it is exercised over a real connection.
 */

import { WebSocket } from "ws";

/** What the gateway needs of a connection to an agent. */
export interface AgentSocket {
  /** Whether a write could still reach the agent. */
  readonly isOpen: boolean;
  /**
   * Write one text frame.
   *
   * @param text - The encoded frame.
   * @returns Resolves once the frame has been handed to the transport; rejects when the socket
   *   is closing or gone — which is the signal that a frame was *not* delivered and stays owed.
   */
  send(text: string): Promise<void>;
  /**
   * Begin the closing handshake.
   *
   * @param code - The WebSocket close code: 1000 orderly, 1001 going away, 1002 protocol error,
   *   1008 policy, 1011 internal error.
   * @param reason - A few words, for the peer's log.
   */
  close(code: number, reason: string): void;
  /** Drop the connection without a handshake — for a peer that has stopped answering. */
  terminate(): void;
}

/**
 * Adapt a `ws` socket.
 *
 * @param socket - The upgraded connection.
 * @returns The socket, as the gateway uses it.
 */
export function wsSocket(socket: WebSocket): AgentSocket {
  return {
    get isOpen() {
      return socket.readyState === WebSocket.OPEN;
    },
    send(text) {
      return new Promise((resolve, reject) => {
        socket.send(text, (error) => (error ? reject(error) : resolve()));
      });
    },
    close(code, reason) {
      socket.close(code, reason);
    },
    terminate() {
      socket.terminate();
    },
  };
}
