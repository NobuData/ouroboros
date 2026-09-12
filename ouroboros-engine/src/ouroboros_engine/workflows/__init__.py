"""The workflow definition language — this service's half of "two validators, one schema".

P.2 (`#133 <https://github.com/NobuData/ouroboros/issues/133>`_). The published contract is
``schemas/workflow-dsl/v1.json``, a JSON Schema 2020-12 document with an ``$id``, committed
above both modules because neither owns it. ``ouroboros-rest`` validates against it with zod
so a save or a publish can be refused at the boundary; this package validates against it with
pydantic so R.2's ``/v0/workflows/validate`` and its dry-run simulator can answer about the
same document without asking the caller to trust that somebody else checked it.

Two validators that can disagree are worse than one, so three things hold them together and
all three are asserted in CI:

* ``schemas/workflow-dsl/fixtures/expected.json`` records one case per rule and the verdict
  both have to produce. :mod:`tests.test_workflows_parity` asserts it of this one and
  ``ouroboros-rest``'s ``dsl.parity.spec.ts`` of the other, each reading that file directly.
* :mod:`tests.test_workflows_conformance` compiles the published schema with ``jsonschema``
  and asserts it classifies every fixture the way :func:`validate_workflow_document` does.
* The modules below are written to mirror ``ouroboros-rest/src/modules/workflows/`` file for
  file — ``errors``/``dsl.errors``, ``dsl``/``dsl.schema``, ``issues``/``dsl.issues``,
  ``structure``/``dsl.structure``, ``references``/``dsl.references``, ``validate``/
  ``dsl.validator`` — so the two can be read side by side, which is the defence a test suite
  cannot provide on its own.

The one thing this package deliberately does not carry is the YAML projection. Mockup 05's
code view is rendered by the service that serves the canvas; a second renderer here would be
a second thing to keep in step for no reader.
"""
