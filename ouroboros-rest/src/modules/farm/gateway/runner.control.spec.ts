import { runner } from "../farm.fixture";
import { AgentSessions } from "./agent.sessions";
import { FakeSocket } from "./gateway.fixture";
import { GatewayMetrics } from "./gateway.metrics";
import type { AgentGatewayRepository } from "./gateway.repository";
import { RunnerControl } from "./runner.control";

describe("drain and undrain", () => {
  const row = runner();
  const drain = {
    reason: "upgrade",
    deadline_ms: 900000,
    detail: "agent 0.1.0 is below the floor",
  } as const;

  let repository: jest.Mocked<Pick<AgentGatewayRepository, "setDesiredState">>;
  let sessions: AgentSessions;
  let control: RunnerControl;

  beforeEach(() => {
    repository = { setDesiredState: jest.fn() };
    sessions = new AgentSessions(() => new Date(), new GatewayMetrics());
    control = new RunnerControl(repository as unknown as AgentGatewayRepository, sessions);
  });

  /** Connect the runner to this process. */
  function connect(): FakeSocket {
    const socket = new FakeSocket();
    const { session } = sessions.open(row.organization_id, row.id, undefined);
    sessions.attach(session, socket);

    return socket;
  }

  it("writes the intent first and pushes the drain to a connected agent", async () => {
    repository.setDesiredState.mockResolvedValue({ ...row, desired_state: "draining" });
    const socket = connect();

    const result = await control.drain(row.organization_id, row.id, drain);
    await sessions.find(row.organization_id, row.id)?.flushed();

    expect(repository.setDesiredState).toHaveBeenCalledWith(
      row.organization_id,
      row.id,
      "draining",
    );
    expect(result).toMatchObject({ pushed: true, runner: { desired_state: "draining" } });
    expect(socket.last("drain").payload).toEqual(drain);
  });

  it("undrains, with the empty payload that is still an object", async () => {
    repository.setDesiredState.mockResolvedValue({ ...row, desired_state: "active" });
    const socket = connect();

    const result = await control.undrain(row.organization_id, row.id);
    await sessions.find(row.organization_id, row.id)?.flushed();

    expect(repository.setDesiredState).toHaveBeenCalledWith(row.organization_id, row.id, "active");
    expect(result?.pushed).toBe(true);
    expect(socket.last("undrain").payload).toEqual({});
  });

  it("still records the intent for a runner that is not connected here — it is told at its next beat", async () => {
    repository.setDesiredState.mockResolvedValue({ ...row, desired_state: "draining" });

    const result = await control.drain(row.organization_id, row.id, drain);

    expect(result).toMatchObject({ pushed: false });
    expect(repository.setDesiredState).toHaveBeenCalled();
  });

  it("answers undefined, and pushes nothing, for a runner the workspace does not have", async () => {
    repository.setDesiredState.mockResolvedValue(undefined);
    const socket = connect();

    expect(await control.drain(row.organization_id, row.id, drain)).toBeUndefined();
    expect(await control.undrain(row.organization_id, row.id)).toBeUndefined();
    expect(socket.sent).toHaveLength(0);
  });
});
