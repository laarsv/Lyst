from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.responses import ok
from app.core.security import hash_password, verify_password
from app.models.user import User
from app.schemas.user import UserOut, UserSelfUpdate

router = APIRouter(prefix="/me", tags=["me"])


@router.get("")
async def me(user: User = Depends(get_current_user)):
    return ok(UserOut.model_validate(user).model_dump(mode="json"))


@router.patch("")
async def patch_me(
    payload: UserSelfUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.new_password:
        if not payload.current_password or not verify_password(
            payload.current_password, user.hashed_password
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is wrong"
            )
        user.hashed_password = hash_password(payload.new_password)
    if payload.name is not None:
        user.name = payload.name
    if payload.email is not None:
        user.email = payload.email.lower()
    await db.commit()
    await db.refresh(user)
    return ok(UserOut.model_validate(user).model_dump(mode="json"))
