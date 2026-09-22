"""The simulated-run driver: scripted run lifecycles through the real ingestion contract.

AP.5 (`#307 <https://github.com/NobuData/ouroboros/issues/307>`_). The Run Console is fed
by a contract (AP.1, `#303 <https://github.com/NobuData/ouroboros/issues/303>`_) and steered
through a control queue (AP.4, `#306 <https://github.com/NobuData/ouroboros/issues/306>`_).
This package is a client of both, and it is what shows the console working end to end before
real execution exists. It is **not a mock**:

* every request is built by the production client,
  :class:`~ouroboros_engine.control_plane.client.ControlPlaneClient`, with an idempotency key,
  events are batched, and each change-set goes through AP.3's guardrail evaluation;
* the driver fetches and acknowledges the controls a person sends: pause at the next safe
  boundary, resume, abort with the branch preserved, and steer applied to the current attempt
  without pausing. A steer changes which scripted branch runs next;
* it writes nothing to a database. Every row it causes is written by ``ouroboros-rest``.

**Everything it produces is simulated** (decision **R4**). It presents
``OURO_RUN_SIMULATOR_SECRET``, so ``ouroboros-rest`` marks each run it opens, and each line
of that run's transcript and export, as simulated. The driver then checks the watermark and
stops before writing anything if the run came back unmarked.

**It is not in the production build.** This package sits beside ``ouroboros_engine`` in
``src/`` and is not one of the wheel's ``packages``, so the image (which installs the wheel
and nothing else) cannot contain it. ``tests/test_simulator_packaging.py`` builds the wheel
and checks. A synthetic run generator in production would be a way to write fiction into
somebody's audit trail.

Two ways in, both development-only:

* ``uv run python -m ouroboros_simulator 482-gate-return``: the CLI (:mod:`.cli`);
* ``POST /dev/simulations`` on a development engine (:mod:`.api`), mounted only when this
  package is installed and ``OURO_RUN_SIMULATOR_SECRET`` is set.
"""
