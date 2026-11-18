"""Connect to Postgres over IPv4.

Render's servers cannot reach Neon over IPv6 ("Network is unreachable"), but Neon's host
name now resolves to IPv6 addresses too, and the driver may pick one of those. Before each
new connection we look up the host's IPv4 address and pass it as `hostaddr`. The host name
is still sent, so TLS (SNI) and Neon's endpoint routing keep working.
"""

import socket

from sqlalchemy import Engine, event


def ipv4_of(host: str | None) -> str | None:
    if not host or host.startswith("/"):
        return None
    try:
        infos = socket.getaddrinfo(host, None, socket.AF_INET, socket.SOCK_STREAM)
    except OSError:
        return None  # let the driver resolve and report it as usual
    return infos[0][4][0] if infos else None


def prefer_ipv4(engine: Engine) -> Engine:
    @event.listens_for(engine, "do_connect")
    def _ipv4(dialect, conn_rec, cargs, cparams):  # noqa: ANN001
        if "hostaddr" not in cparams:
            ip = ipv4_of(cparams.get("host"))
            if ip:
                cparams["hostaddr"] = ip

    return engine
