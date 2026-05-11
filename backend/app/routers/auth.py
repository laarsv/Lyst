from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.core.responses import ok
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.schemas.auth import (
    AcceptInviteRequest,
    LoginRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    TokenResponse,
)
from app.services.auth_service import (
    accept_invite,
    authenticate,
    confirm_password_reset,
    request_password_reset,
)

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "lyst_refresh"


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=settings.FRONTEND_URL.startswith("https://"),
        path="/api/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")


@router.post("/login")
@limiter.limit("10/minute")
async def login(
    request: Request,
    response: Response,
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    user = await authenticate(db, payload.email, payload.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    access = create_access_token(str(user.id), user.role.value)
    refresh = create_refresh_token(str(user.id))
    _set_refresh_cookie(response, refresh)
    return ok(
        TokenResponse(
            access_token=access,
            role=user.role.value,
            user_id=user.id,
            name=user.name,
            email=user.email,
        ).model_dump()
    )


@router.post("/refresh")
async def refresh_token(request: Request, response: Response):
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token")
    try:
        payload = decode_token(token, expected_type="refresh")
        user_id = payload["sub"]
    except (ValueError, KeyError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    # role is encoded into access tokens; for refresh we don't have it. We default to "user"
    # but the client should re-login if it needs accurate role. To avoid mismatch, decode
    # role from a quick DB lookup is preferable, but since refresh is short-circuit and
    # role is checked on every request via dependencies, it's fine to look up.
    from sqlalchemy import select

    from app.core.database import AsyncSessionLocal
    from app.models.user import User

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()
        if not user or not user.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not available")
        access = create_access_token(str(user.id), user.role.value)
    return ok({"access_token": access, "token_type": "bearer"})


@router.post("/logout")
async def logout(response: Response):
    _clear_refresh_cookie(response)
    return ok({"message": "Logged out"})


@router.post("/reset-password/request")
@limiter.limit("5/minute")
async def password_reset_req(
    request: Request,
    payload: PasswordResetRequest,
    db: AsyncSession = Depends(get_db),
):
    await request_password_reset(db, payload.email)
    return ok({"message": "If the email exists, a reset link has been sent"})


@router.post("/reset-password/confirm")
@limiter.limit("10/minute")
async def password_reset_conf(
    request: Request,
    payload: PasswordResetConfirm,
    db: AsyncSession = Depends(get_db),
):
    try:
        decoded = decode_token(payload.token, expected_type="reset")
        user_id = int(decoded["sub"])
    except (ValueError, KeyError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")
    try:
        await confirm_password_reset(db, user_id, payload.new_password)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return ok({"message": "Password updated"})


@router.post("/accept-invite")
@limiter.limit("10/minute")
async def accept_invite_route(
    request: Request,
    payload: AcceptInviteRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        decoded = decode_token(payload.token, expected_type="invite")
        email = decoded["sub"]
    except (ValueError, KeyError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired invite")
    try:
        user = await accept_invite(db, email, payload.name, payload.password)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return ok({"email": user.email, "message": "Account activated"})
