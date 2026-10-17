import socket

import pytest


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Tests run offline: upstream services are stubbed or mocked with `responses`."""

    def refuse(*args, **kwargs):
        raise RuntimeError("Tests must not open network connections")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
