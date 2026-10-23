"""``OURO_ENGINE_GIT_CA_FILE``: git over https verifies against a private CA (DI.6, #1321)."""

from pathlib import Path

import pytest

from ouroboros_engine.code.clones import CloneStore, RepositoryRef
from ouroboros_engine.code.git_tls import git_tls_config
from ouroboros_engine.execution.publisher import DulwichPushTransport
from ouroboros_engine.settings import Settings


def test_no_bundle_is_the_system_trust_store() -> None:
    """Unset means dulwich's default: no configuration at all."""
    assert git_tls_config(None) is None


def test_a_bundle_becomes_http_ssl_ca_info(tmp_path: Path) -> None:
    """The bundle is handed to dulwich as ``http.sslCAInfo``, the key it reads."""
    bundle = tmp_path / "ca.pem"

    config = git_tls_config(bundle)

    assert config is not None
    assert config.get((b"http",), b"sslCAInfo") == str(bundle).encode()


def test_the_clone_store_verifies_fetches_against_the_bundle(tmp_path: Path) -> None:
    """A fetch's client carries the bundle, and still refuses anything but https."""
    bundle = tmp_path / "ca.pem"
    bundle.write_text("-----BEGIN CERTIFICATE-----\n")
    store = CloneStore(tmp_path / "clones", ca_file=bundle)
    repository = RepositoryRef(
        workspace="w",
        slug="acme/greeter",
        remote="https://git.example/acme/greeter.git",
    )

    client, path = store._client(repository)

    assert client.pool_manager.connection_pool_kw["ca_certs"] == str(bundle)
    assert path == "/acme/greeter.git"


def test_the_push_transport_verifies_against_the_bundle(tmp_path: Path) -> None:
    """A push's client carries the bundle; an http remote is still refused."""
    bundle = tmp_path / "ca.pem"
    transport = DulwichPushTransport(ca_file=bundle)

    client, path = transport.connect(
        "https://git.example/acme/greeter.git", "x", "token"
    )

    assert client.pool_manager.connection_pool_kw["ca_certs"] == str(bundle)
    assert path == b"/acme/greeter.git"
    with pytest.raises(Exception, match="https://host/owner/name"):
        transport.connect("http://git.example/acme/greeter.git", "x", "token")


def test_the_bundle_is_a_path_read_at_each_connection(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The setting names a path; it need not exist yet when the engine starts."""
    monkeypatch.setenv("OURO_ENGINE_GIT_CA_FILE", str(tmp_path / "later.pem"))

    assert Settings().git_ca_file == tmp_path / "later.pem"
