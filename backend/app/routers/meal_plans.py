from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.user import User
from app.schemas.meal_plan import (
    EntryCreate,
    EntryOut,
    EntryUpdate,
    GenerateListResponse,
    MealPlanOut,
)
from app.services.meal_plan_service import (
    add_entry,
    delete_entry,
    generate_shopping_list,
    get_entry,
    get_or_create_plan,
    get_plan,
    update_entry,
)

router = APIRouter(prefix="/meal-plans", tags=["meal-plans"])


def _entry_out(entry) -> dict:
    rec = entry.recipe
    return EntryOut(
        id=entry.id,
        meal_plan_id=entry.meal_plan_id,
        recipe_id=entry.recipe_id,
        day_of_week=entry.day_of_week,
        meal_type=entry.meal_type,
        servings=entry.servings,
        recipe_title=rec.title if rec else "(gelöscht)",
        recipe_category=(rec.category.value if rec else "OTHER"),
        recipe_image_url=rec.image_url if rec else None,
        recipe_servings=rec.servings if rec else 0,
        recipe_prep_time_minutes=rec.prep_time_minutes if rec else None,
        recipe_cook_time_minutes=rec.cook_time_minutes if rec else None,
    ).model_dump(mode="json")


def _plan_out(plan) -> dict:
    return {
        "id": plan.id,
        "owner_id": plan.owner_id,
        "week_start": plan.week_start.isoformat(),
        "created_at": plan.created_at.isoformat(),
        "entries": [_entry_out(e) for e in plan.entries],
    }


@router.get("")
async def get_plan_for_week(
    week_start: date = Query(..., description="ISO date — any day in the desired week (snapped to Monday)"),
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    plan = await get_or_create_plan(db, user.id, week_start)
    return ok(_plan_out(plan))


@router.post("/{plan_id}/entries", status_code=status.HTTP_201_CREATED)
async def post_entry(
    plan_id: int,
    payload: EntryCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        plan = await get_plan(db, plan_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    try:
        entry = await add_entry(
            db,
            plan,
            recipe_id=payload.recipe_id,
            day_of_week=payload.day_of_week,
            meal_type=payload.meal_type,
            servings=payload.servings,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return ok(_entry_out(entry))


@router.patch("/{plan_id}/entries/{entry_id}")
async def patch_entry(
    plan_id: int,
    entry_id: int,
    payload: EntryUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_plan(db, plan_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    entry = await get_entry(db, plan_id, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Eintrag nicht gefunden")
    entry = await update_entry(db, entry, **payload.model_dump(exclude_unset=True))
    return ok(_entry_out(entry))


@router.delete("/{plan_id}/entries/{entry_id}")
async def del_entry(
    plan_id: int,
    entry_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_plan(db, plan_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    entry = await get_entry(db, plan_id, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Eintrag nicht gefunden")
    await delete_entry(db, entry)
    return ok({"message": "Deleted"})


@router.post("/{plan_id}/generate-shopping-list", status_code=status.HTTP_201_CREATED)
async def post_generate(
    plan_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        plan = await get_plan(db, plan_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    try:
        target, count = await generate_shopping_list(db, plan)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return ok(GenerateListResponse(list_id=target.id, list_title=target.title, items_added=count).model_dump())
