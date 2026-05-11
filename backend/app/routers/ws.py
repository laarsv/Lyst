"""WebSocket endpoint for live list collaboration.

Auth model: JWT (access token) is passed as the `token` query parameter
because browser WebSocket APIs cannot set custom headers. We re-use the
existing access-token signing scheme so no new tokens / endpoints are
needed. The connection is then bound to the resolved user — same access
checks as the REST endpoints (`get_list_for_user`).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.security import decode_token
from app.services.list_service import get_list_for_user
from app.services.ws_manager import manager

router = APIRouter(tags=["ws"])
logger = logging.getLogger(__name__)


# Custom close codes (4xxx range is reserved for application use)
CODE_UNAUTHORIZED = 4401
CODE_FORBIDDEN = 4403
CODE_NOT_FOUND = 4404


@router.websocket("/ws/lists/{list_id}")
async def list_ws(
    websocket: WebSocket,
    list_id: int,
    token: str | None = Query(default=None),
    client_id: str | None = Query(default=None),
):
    # 1. Validate JWT
    if not token:
        await websocket.close(code=CODE_UNAUTHORIZED)
        return
    try:
        payload = decode_token(token, expected_type="access")
        user_id = int(payload["sub"])
    except (ValueError, KeyError, TypeError):
        await websocket.close(code=CODE_UNAUTHORIZED)
        return

    # 2. Authorize: same access check as REST. Use a fresh DB session.
    async with AsyncSessionLocal() as db:
        try:
            await get_list_for_user(db, list_id, user_id)
        except ValueError:
            await websocket.close(code=CODE_NOT_FOUND)
            return

    # 3. Register and pump. Browser clients don't send messages — we just
    #    block on receive_text() to detect disconnects, and the broadcast
    #    side does the actual work.
    await manager.connect(list_id, websocket, client_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(list_id, websocket)
