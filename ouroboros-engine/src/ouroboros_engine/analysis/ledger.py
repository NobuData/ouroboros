r"""Every analyzer version's parameters, pinned (#511).

A key is ``<analyzer id>@v<version>``; a value is the sha256 of that version's ``parameters``
in canonical JSON (:func:`ouroboros_engine.analysis.spi.parameters_fingerprint`). The registry
refuses an analyzer whose fingerprint is not the one pinned for its version, so:

* **retuning without a version bump fails** — the fingerprint no longer matches;
* **bumping the version means adding a line here** — an unpinned version is refused too;
* **an entry is never edited or removed** — a finding stored as ``change_point@v1`` must stay
  explainable by v1's parameters. Add the next version beside it.

To pin a new version, run::

    uv run python -c "from ouroboros_engine.analysis.<module> import PARAMETERS; \\
        from ouroboros_engine.analysis.spi import parameters_fingerprint; \\
        print(parameters_fingerprint(PARAMETERS))"
"""

#: ``<id>@v<version>`` → sha256 of its parameters' canonical JSON.
PARAMETER_LEDGER: dict[str, str] = {
    "change_point@v1": "9c9c9eff7f709047d76aa582dbfb5143e31485c2c324eb84263f926df8773fc4",
    # BV.3 (#512) — the pattern analyzers.
    "cache_window@v1": "7d1b22baf967b0a821720a42e17697a1e253da81e47bc4ea436acc5e0aebdc21",
    "config_usage@v1": "9f73151df0e01842f9ae4fb3ea2a02838c88378f80d9275bb199e47200ef4f4d",
    "log_signature@v1": "0d4aec89086d10e461263161b6f713552e5c02036c9f892cd75a233b9176a3d6",
    "queue_correlation@v1": "3bbb2b0b1d860ff1e457d159738be7b2c6111cbba123ce5371927bae8395f49c",
    "waiver_cite@v1": "9fb0912ccdfe6c9a66b2d57f469f539402ea91b1bbc0c13abf6c873d39239bd4",
    "workflow_outcome@v1": "c8d097d028a07943a54f2d1542c2494c43107f07ae87cab98dd0fcf0a6c22054",
}
