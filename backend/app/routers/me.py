from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import desc, func, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.responses import ok
from app.core.security import hash_password, verify_password
from app.models.collaborator import ListCollaborator
from app.models.list import List as ListModel
from app.models.note import Note, NoteShare
from app.models.recipe import Recipe, RecipeBookShare, RecipeShare
from app.models.user import User
from app.schemas.share import ShareSuggestion
from app.schemas.user import UserOut, UserSelfUpdate

router = APIRouter(prefix="/me", tags=["me"])


@router.get("")
async def me(user: User = Depends(get_current_user)):
    return ok(UserOut.model_validate(user).model_dump(mode="json"))


@router.get("/share-suggestions")
async def share_suggestions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """People the current user has shared anything with before.

    Union over the four share tables we own — every row where the
    current user is the OWNER side, paired with the recipient
    user_id and the row's created_at. We pick the most recent
    created_at per recipient and return the top 10 names + emails
    so the share panels can render "Zuletzt geteilt mit" chips.

    Privacy: the result set is people the user has already shared
    with — they already know each other in Lyst. No new emails are
    revealed. Revoking a share doesn't drop a person from the list:
    that's a one-shot of a row that no longer exists, but the
    user remembers them and wants the chip as a convenience.

    Sorting: max(created_at) DESC per recipient, then by user_id
    for a stable tiebreak. Limit 10.
    """
    # Build a uniform `(recipient_id, created_at)` projection per
    # source. Joining notes/lists/recipes to look up the owner
    # locally so we don't filter on a column we can't see (the
    # share rows don't carry owner_id; the resource does).
    note_q = (
        select(NoteShare.shared_with_user_id, NoteShare.created_at)
        .join(Note, NoteShare.note_id == Note.id)
        .where(Note.owner_id == user.id)
    )
    list_q = (
        select(ListCollaborator.user_id, ListCollaborator.created_at)
        .join(ListModel, ListCollaborator.list_id == ListModel.id)
        .where(ListModel.owner_id == user.id)
    )
    recipe_q = (
        select(RecipeShare.shared_with_user_id, RecipeShare.created_at)
        .join(Recipe, RecipeShare.recipe_id == Recipe.id)
        .where(Recipe.owner_id == user.id)
    )
    book_q = (
        select(RecipeBookShare.shared_with_user_id, RecipeBookShare.created_at)
        .where(RecipeBookShare.owner_id == user.id)
    )
    # UNION ALL keeps duplicates so the MAX() aggregate per recipient
    # below picks the most recent of any kind of share.
    unioned = union_all(note_q, list_q, recipe_q, book_q).subquery()
    recipient_col = list(unioned.c)[0]
    created_col = list(unioned.c)[1]

    last_per_user = (
        select(recipient_col.label("uid"), func.max(created_col).label("last"))
        .group_by(recipient_col)
        .order_by(desc("last"))
        .limit(10)
    ).subquery()

    # Join to users for the display fields. Order again so the SQL
    # engine's GROUP BY ordering doesn't get lost across the join.
    rows = await db.execute(
        select(User.id, User.name, User.email, last_per_user.c.last)
        .join(last_per_user, User.id == last_per_user.c.uid)
        .order_by(desc(last_per_user.c.last), User.id)
    )
    out = [
        ShareSuggestion(id=uid, name=name, email=email).model_dump(mode="json")
        for uid, name, email, _last in rows.all()
        if uid != user.id  # paranoia — schemas forbid self-share but be safe
    ]
    return ok(out)


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
