"""The scenario scripts, by name.

| Scenario | Exercises |
|---|---|
| ``happy-path`` | Queued → … → Open PR, clean guardrails, merged |
| ``482-gate-return`` | Mockup 10's story: tests fail, the gate returns, attempt 2 proceeds |
| ``guardrail-violation`` | A CI edit and a planted secret: fail verdicts with evidence |
| ``control-responsive`` | Pause mid-stage, resume, steer a branch, abort from a running state |
| ``correction-round`` | Tests fail, the loop holds, a Mark & Route correction round starts attempt 2 |
| ``failing-hil`` | Mockup 11: rig builds fail 14 then 2 of 63, a correction round, Build 3 green |
| ``protected-path-allow-once`` | A protected ``boot/**`` edit fails ``allowed_paths``; the loop holds for Allow once, resumes, merges |

Each is a plain function over :class:`~ouroboros_simulator.session.RunSession`, so a script
reads as the story it tells. Every control is honoured in all seven; ``control-responsive``
is the one built to be pressed, and ``protected-path-allow-once`` the one that waits for a
decision's ``resume``.
"""

from ouroboros_simulator.scenarios import (
    control_responsive,
    correction_round,
    failing_hil,
    gate_return,
    guardrail_violation,
    happy_path,
    protected_path_allow_once,
)
from ouroboros_simulator.scenarios.common import Outcome, Scenario

#: Every scenario, by name, in the order the table above lists them.
SCENARIOS: dict[str, Scenario] = {
    scenario.name: scenario
    for scenario in (
        happy_path.SCENARIO,
        gate_return.SCENARIO,
        guardrail_violation.SCENARIO,
        control_responsive.SCENARIO,
        correction_round.SCENARIO,
        failing_hil.SCENARIO,
        protected_path_allow_once.SCENARIO,
    )
}

__all__ = ["SCENARIOS", "Outcome", "Scenario"]
