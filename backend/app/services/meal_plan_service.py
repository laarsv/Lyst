from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.list import List as ListModel, ListType
from app.models.list_item import ListItem
from app.models.meal_plan import MealPlan, MealPlanEntry, MealType
from app.models.recipe import Recipe


def monday_of(d: date) -> date:
    """Return the Monday of the ISO week containing `d`."""
    return d - timedelta(days=d.weekday())


async def get_or_create_plan(db: AsyncSession, owner_id: int, week_start: date) -> MealPlan:
    week_start = monday_of(week_start)
    result = await db.execute(
        select(MealPlan)
        .options(
            selectinload(MealPlan.entries).selectinload(MealPlanEntry.recipe),
        )
        .where(MealPlan.owner_id == owner_id, MealPlan.week_start == week_start)
    )
    plan = result.scalar_one_or_none()
    if plan:
        return plan
    plan = MealPlan(owner_id=owner_id, week_start=week_start)
    db.add(plan)
    await db.commit()
    return await get_plan(db, plan.id, owner_id)


async def get_plan(db: AsyncSession, plan_id: int, owner_id: int) -> MealPlan:
    result = await db.execute(
        select(MealPlan)
        .options(
            selectinload(MealPlan.entries).selectinload(MealPlanEntry.recipe),
        )
        .where(MealPlan.id == plan_id, MealPlan.owner_id == owner_id)
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise ValueError("Meal plan not found")
    return plan


async def add_entry(
    db: AsyncSession,
    plan: MealPlan,
    *,
    recipe_id: int,
    day_of_week: int,
    meal_type: MealType,
    servings: int,
) -> MealPlanEntry:
    # Verify recipe belongs to the same owner — meal plans only reference
    # the user's own recipes.
    rec_result = await db.execute(
        select(Recipe).where(Recipe.id == recipe_id, Recipe.owner_id == plan.owner_id)
    )
    if not rec_result.scalar_one_or_none():
        raise ValueError("Recipe not found")
    entry = MealPlanEntry(
        meal_plan_id=plan.id,
        recipe_id=recipe_id,
        day_of_week=day_of_week,
        meal_type=meal_type,
        servings=servings,
    )
    db.add(entry)
    await db.commit()
    # Re-fetch with the recipe loaded so the response can include recipe metadata.
    result = await db.execute(
        select(MealPlanEntry)
        .options(selectinload(MealPlanEntry.recipe))
        .where(MealPlanEntry.id == entry.id)
    )
    return result.scalar_one()


async def get_entry(db: AsyncSession, plan_id: int, entry_id: int) -> MealPlanEntry | None:
    result = await db.execute(
        select(MealPlanEntry)
        .options(selectinload(MealPlanEntry.recipe))
        .where(MealPlanEntry.id == entry_id, MealPlanEntry.meal_plan_id == plan_id)
    )
    return result.scalar_one_or_none()


async def update_entry(db: AsyncSession, entry: MealPlanEntry, **fields) -> MealPlanEntry:
    for k, v in fields.items():
        if v is not None:
            setattr(entry, k, v)
    await db.commit()
    await db.refresh(entry)
    return entry


async def delete_entry(db: AsyncSession, entry: MealPlanEntry) -> None:
    await db.delete(entry)
    await db.commit()


def _scale(qty: float | None, factor: float) -> float | None:
    if qty is None:
        return None
    return round(qty * factor, 2)


async def generate_shopping_list(db: AsyncSession, plan: MealPlan) -> tuple[ListModel, int]:
    """Combine ingredients of every entry, scaled by entry.servings, and
    de-duplicate by (lowercased name, lowercased unit).

    Mixed units stay separate rows — we don't try to convert kg <-> g.
    """
    if not plan.entries:
        raise ValueError("Wochenplan ist leer — füge zuerst Rezepte hinzu")

    # name+unit → aggregated quantity (or None when at least one entry is unitless)
    aggregated: dict[tuple[str, str | None], dict] = {}

    for entry in plan.entries:
        recipe = entry.recipe
        if not recipe or not recipe.ingredients:
            continue
        factor = entry.servings / recipe.servings if recipe.servings else 1.0
        for ing in recipe.ingredients:
            key = (ing.name.strip().lower(), (ing.unit or "").strip().lower() or None)
            scaled = _scale(ing.quantity, factor)
            if key not in aggregated:
                aggregated[key] = {
                    "name": ing.name.strip(),
                    "unit": ing.unit,
                    "quantity": scaled,
                    "any_qty": scaled is not None,
                }
            else:
                slot = aggregated[key]
                if scaled is not None:
                    slot["quantity"] = (slot["quantity"] or 0) + scaled
                    slot["any_qty"] = True
                # quantity stays None if no entry contributed a numeric value

    if not aggregated:
        raise ValueError("Keine Zutaten in den verknüpften Rezepten")

    title = f"Wocheneinkauf KW {plan.week_start.isocalendar()[1]} ({plan.week_start.isoformat()})"
    target = ListModel(
        owner_id=plan.owner_id,
        title=title,
        type=ListType.SHOPPING,
        icon="🛒",
        color="#00c896",
    )
    db.add(target)
    await db.flush()

    pos = 0
    for slot in aggregated.values():
        db.add(
            ListItem(
                list_id=target.id,
                text=slot["name"],
                quantity=round(slot["quantity"], 2) if slot["any_qty"] else None,
                unit=slot["unit"],
                position=pos,
                is_checked=False,
            )
        )
        pos += 1

    await db.commit()
    await db.refresh(target)
    return target, len(aggregated)
