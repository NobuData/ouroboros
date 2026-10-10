"""The investigation loop — plan, work the tools, synthesize, deliver (CM.1, #620).

``POST /v0/investigate`` (:mod:`ouroboros_engine.api.investigate`) hands a request to an
:class:`~.runner.InvestigationRunner`, which runs it through the one
:class:`~.loop.InvestigationLoop` every kind shares:

* :mod:`.contract` — the request, the depth presets, the failure taxonomy.
* :mod:`.playbooks` — the synthesis templates a kind's playbook selects.
* :mod:`.loop` — the steps, the checkpoints and the designed ends.
* :mod:`.claims` — the citation gate: an uncited candidate is an open question.
* :mod:`.model` — one model call through the invocation gateway.
* :mod:`.control` — the control plane's internal research surface.
* :mod:`.runner` — where a loop runs until the task model (#54) exists.
"""
