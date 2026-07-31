"""GET /dashboard — the "Heute" overview.

Single endpoint on purpose: the screen shows five unrelated blocks, and
firing five parallel requests from a phone on a flaky connection makes the
page assemble itself in visible stages. One trip, one render.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.user import User
from app.schemas.dashboard import DashboardOut
from app.services.dashboard_service import build_dashboard

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("")
async def get_dashboard(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    data = await build_dashboard(db, user.id)
    return ok(DashboardOut.model_validate(data).model_dump(mode="json"))
