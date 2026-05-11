from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_admin
from app.core.responses import ok
from app.models.user import User
from app.schemas.user import (
    AdminUserOut,
    UserCreate,
    UserCreateResponse,
    UserInvite,
    UserOut,
    UserUpdate,
)
from app.services.admin_service import (
    admin_reset_password,
    create_user,
    delete_user,
    generate_temp_password,
    invite_user,
    list_users,
    update_user,
)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/users")
async def get_users(q: str | None = None, db: AsyncSession = Depends(get_db)):
    rows = await list_users(db, q)
    return ok(
        [
            AdminUserOut.model_validate(u, update={"list_count": c}).model_dump(mode="json")
            for u, c in rows
        ]
    )


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def post_user(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    temp = payload.password or generate_temp_password()
    try:
        user = await create_user(db, payload.email, payload.name, temp, payload.role)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return ok(
        UserCreateResponse(
            user=UserOut.model_validate(user), temp_password=temp
        ).model_dump(mode="json")
    )


@router.post("/users/invite", status_code=status.HTTP_201_CREATED)
async def post_invite(payload: UserInvite, db: AsyncSession = Depends(get_db)):
    try:
        user = await invite_user(db, payload.email, payload.name, payload.role)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return ok(UserOut.model_validate(user).model_dump(mode="json"))


@router.patch("/users/{user_id}")
async def patch_user(user_id: int, payload: UserUpdate, db: AsyncSession = Depends(get_db)):
    try:
        user = await update_user(
            db,
            user_id,
            name=payload.name,
            email=payload.email,
            is_active=payload.is_active,
            role=payload.role,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return ok(UserOut.model_validate(user).model_dump(mode="json"))


@router.post("/users/{user_id}/reset-password")
async def post_reset(user_id: int, db: AsyncSession = Depends(get_db)):
    try:
        await admin_reset_password(db, user_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return ok({"message": "Reset email sent"})


@router.delete("/users/{user_id}", status_code=status.HTTP_200_OK)
async def del_user(
    user_id: int,
    current: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if current.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself"
        )
    try:
        await delete_user(db, user_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return ok({"message": "User deleted"})
