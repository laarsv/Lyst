"""Per-user WebSocket connection registry.

Parallel to ws_manager (per-list), but keyed on user_id so any
mutation that touches a resource can fan out to every device the
relevant users have open.

Use case: cross-device cache invalidation + cross-device real-time
updates. Phone has the notes overview open; laptop creates a new
note → the new note's row appears on the phone within ~one tick.

One process, one registry — same caveat as ws_manager: a multi-
process backend would need to swap this for Redis pub/sub. For the
home-server deploy it's overkill.

Echo suppression: the broadcast helper takes `exclude_client_id`,
same shape as ws_manager. Mutations carry the originating tab's
`X-Client-Id` header through the request lifecycle; the broadcast
call passes that along so the originating tab doesn't receive its
own change (which would cause an immediate refetch loop).
"""
from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class UserConnectionManager:
    def __init__(self) -> None:
        # user_id -> { websocket: client_id-or-None }
        self._conns: dict[int, dict[WebSocket, str | None]] = {}

    async def connect(
        self, user_id: int, websocket: WebSocket, client_id: str | None
    ) -> None:
        await websocket.accept()
        self._conns.setdefault(user_id, {})[websocket] = client_id
        logger.debug(
            "user ws connect user_id=%s client_id=%s peers=%d",
            user_id,
            client_id,
            len(self._conns[user_id]),
        )

    def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        peers = self._conns.get(user_id)
        if not peers:
            return
        peers.pop(websocket, None)
        if not peers:
            self._conns.pop(user_id, None)

    async def broadcast_to_users(
        self,
        user_ids: set[int] | list[int],
        message: dict[str, Any],
        *,
        exclude_client_id: str | None = None,
    ) -> None:
        """Fan out the message to every device of every user in
        `user_ids`. Skips connections whose client_id matches the
        exclude (the device that made the change) so we don't echo a
        user's own mutation back to themselves and trigger an
        infinite refetch loop.

        We DO send to other devices of the SAME user — a phone and a
        laptop logged into the same account both want the update.
        """
        if not user_ids:
            return
        text = json.dumps(message, default=str)
        dead: list[tuple[int, WebSocket]] = []
        for uid in set(user_ids):
            peers = self._conns.get(uid)
            if not peers:
                continue
            for ws, cid in list(peers.items()):
                if exclude_client_id and cid == exclude_client_id:
                    continue
                try:
                    await ws.send_text(text)
                except Exception as e:  # pragma: no cover - network flake
                    logger.debug(
                        "user ws send failed user_id=%s err=%s", uid, e
                    )
                    dead.append((uid, ws))
        for uid, ws in dead:
            self.disconnect(uid, ws)


user_manager = UserConnectionManager()
