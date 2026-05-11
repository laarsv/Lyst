"""In-memory WebSocket connection registry for real-time list collaboration.

One process, one registry — no Redis fan-out. That's intentional for the
home-server use case; if Lyst ever scales to multiple backend replicas
we'd need to swap this for a Redis pub/sub layer.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        # list_id → { websocket: client_id-or-None }
        self._conns: dict[int, dict[WebSocket, str | None]] = {}

    async def connect(self, list_id: int, websocket: WebSocket, client_id: str | None) -> None:
        await websocket.accept()
        self._conns.setdefault(list_id, {})[websocket] = client_id
        logger.debug(
            "ws connect list_id=%s client_id=%s peers=%d",
            list_id, client_id, len(self._conns[list_id]),
        )

    def disconnect(self, list_id: int, websocket: WebSocket) -> None:
        peers = self._conns.get(list_id)
        if not peers:
            return
        peers.pop(websocket, None)
        if not peers:
            self._conns.pop(list_id, None)

    async def broadcast(
        self,
        list_id: int,
        message: dict[str, Any],
        *,
        exclude_client_id: str | None = None,
    ) -> None:
        peers = self._conns.get(list_id)
        if not peers:
            return
        text = json.dumps(message, default=str)
        dead: list[WebSocket] = []
        # Snapshot first — we mutate `peers` from `disconnect()` on errors.
        for ws, cid in list(peers.items()):
            if exclude_client_id and cid == exclude_client_id:
                continue
            try:
                await ws.send_text(text)
            except Exception as e:
                logger.debug("ws send failed list_id=%s err=%s", list_id, e)
                dead.append(ws)
        for ws in dead:
            self.disconnect(list_id, ws)


manager = ConnectionManager()
