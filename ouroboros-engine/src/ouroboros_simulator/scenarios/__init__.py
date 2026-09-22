"""The scenario scripts, by name.

| Scenario | Exercises |
|---|---|
| ``happy-path`` | Queued → … → Open PR, clean guardrails, merged |
| ``482-gate-return`` | Mockup 10's story: tests fail, the gate returns, attempt 2 proceeds |
| ``guardrail-violation`` | A CI edit and a planted secret: fail verdicts with evidence |
| ``control-responsive`` | Pause mid-stage, resume, steer a branch, abort from a running state |

Each is a plain function over :class:`~ouroboros_simulator.session.RunSession`, so a script
reads as the story it tells. Every control is honoured in all four; ``control-responsive``
is the one built to be pressed.
"""

from ouroboros_simulator.scenarios import (
    control_responsive,
    gate_return,
    guardrail_violation,
    happy_path,
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
    )
}

__all__ = ["SCENARIOS", "Outcome", "Scenario"]
