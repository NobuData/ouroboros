"""``python -m ouroboros_simulator``: run a scenario against a running stack.

::

    uv run python -m ouroboros_simulator --list
    uv run python -m ouroboros_simulator 482-gate-return
    uv run python -m ouroboros_simulator 482-gate-return --speed 60 --json
    OURO_REST_URL=http://localhost:4000 uv run python -m ouroboros_simulator happy-path

It reads ``OURO_REST_URL`` and ``OURO_RUN_SIMULATOR_SECRET`` from the environment and the
same ``.env`` files the engine reads. Against compose it runs on the host, where REST is
published on ``localhost:4000``. The production image has neither this package nor a
command for it.

Exit codes: ``0`` when the scenario ended as scripted (``completed``, ``needs_human`` or
``aborted``), ``1`` when the driver stopped on an error, ``2`` for a usage or
configuration error.
"""

import argparse
import json
import logging
import sys
from collections.abc import Sequence

from ouroboros_simulator.runner import DEFAULT_SPEED, run_scenario
from ouroboros_simulator.scenarios import SCENARIOS
from ouroboros_simulator.session import Target
from ouroboros_simulator.settings import (
    SimulatorConfigurationError,
    load_simulator_settings,
)


def _parser() -> argparse.ArgumentParser:
    """The command line.

    Returns:
        The parser.
    """
    defaults = Target()
    parser = argparse.ArgumentParser(
        prog="python -m ouroboros_simulator",
        description="Drive a scripted, simulated run through ouroboros-rest's internal "
        "ingestion contract, acknowledging the console's controls. Development only.",
    )
    parser.add_argument("scenario", nargs="?", choices=sorted(SCENARIOS))
    parser.add_argument(
        "--list", action="store_true", help="list the scenarios and exit"
    )
    parser.add_argument(
        "--speed",
        type=float,
        default=DEFAULT_SPEED,
        help=f"time compression; 1 is realistic cadence (default {DEFAULT_SPEED:g})",
    )
    parser.add_argument("--rest-url", help="overrides OURO_REST_URL")
    parser.add_argument("--ticket-source", default=defaults.ticket_source)
    parser.add_argument("--ticket", default=defaults.ticket)
    parser.add_argument("--repository", default=defaults.repository)
    parser.add_argument("--workflow", default=defaults.workflow)
    parser.add_argument(
        "--workflow-version", type=int, default=defaults.workflow_version
    )
    parser.add_argument("--model", default=defaults.model)
    parser.add_argument("--json", action="store_true", help="print the result as JSON")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the CLI.

    Args:
        argv: The arguments, without the program name. ``sys.argv`` when omitted.

    Returns:
        The exit code.
    """
    parser = _parser()
    arguments = parser.parse_args(argv)

    if arguments.list:
        for name, scenario in SCENARIOS.items():
            print(f"{name:22} {scenario.summary}")
        return 0

    if arguments.scenario is None:
        parser.print_usage(sys.stderr)
        print("error: name a scenario, or pass --list", file=sys.stderr)
        return 2

    if arguments.speed <= 0:
        print("error: --speed must be positive", file=sys.stderr)
        return 2

    try:
        settings = load_simulator_settings()
    except SimulatorConfigurationError as error:
        print(error, file=sys.stderr)
        return 2

    if arguments.rest_url:
        settings = settings.model_copy(update={"rest_url": arguments.rest_url})

    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s %(name)s: %(message)s"
    )
    result = run_scenario(
        arguments.scenario,
        settings,
        target=Target(
            ticket_source=arguments.ticket_source,
            ticket=arguments.ticket,
            repository=arguments.repository,
            workflow=arguments.workflow,
            workflow_version=arguments.workflow_version,
            model=arguments.model,
        ),
        speed=arguments.speed,
        on_open=lambda run: print(
            f"opened simulated run {run.id} (Loop #{run.loop_seq}, #{run.issue_number})",
            file=sys.stderr,
        ),
    )

    if arguments.json:
        print(json.dumps(result.as_json(), indent=2))
    else:
        print(f"{result.scenario}: {result.outcome}")
        if result.run_id is not None:
            print(f"  run {result.run_id} · Loop #{result.loop_seq} · simulated")
        for steer in result.steers:
            print(f"  steer on {steer['stage']} attempt {steer['attempt']}")
        for ack in result.acks:
            print(f"  {ack['kind']}: {ack['detail']}")
        for index, failures in enumerate(result.guardrail_failures, start=1):
            print(f"  change-set {index}: {', '.join(failures) or 'no failures'}")
        if result.detail:
            print(f"  {result.detail}")

    return 1 if result.outcome == "failed" else 0
