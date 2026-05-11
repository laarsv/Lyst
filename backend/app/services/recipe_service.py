from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.list import List as ListModel, ListType
from app.models.list_item import ListItem
from app.models.recipe import Recipe, RecipeCategory, RecipeIngredient, RecipeStep


# ---------- Recipe CRUD ----------

async def list_recipes(
    db: AsyncSession,
    owner_id: int,
    *,
    q: str | None = None,
    category: RecipeCategory | None = None,
) -> list[tuple[Recipe, int]]:
    ingredient_count = func.count(RecipeIngredient.id).label("ingredient_count")
    stmt = (
        select(Recipe, ingredient_count)
        .outerjoin(RecipeIngredient, RecipeIngredient.recipe_id == Recipe.id)
        .where(Recipe.owner_id == owner_id)
        .group_by(Recipe.id)
        .order_by(Recipe.updated_at.desc())
    )
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(func.lower(Recipe.title).like(like), Recipe.tags.any(q.lower())),
        )
    if category:
        stmt = stmt.where(Recipe.category == category)
    result = await db.execute(stmt)
    return [(r, c) for r, c in result.all()]


async def get_recipe(db: AsyncSession, recipe_id: int, owner_id: int) -> Recipe:
    result = await db.execute(
        select(Recipe)
        .options(selectinload(Recipe.ingredients), selectinload(Recipe.steps))
        .where(Recipe.id == recipe_id, Recipe.owner_id == owner_id)
    )
    rec = result.scalar_one_or_none()
    if not rec:
        raise ValueError("Recipe not found")
    return rec


async def create_recipe(
    db: AsyncSession,
    owner_id: int,
    *,
    title: str,
    ingredients: list[dict],
    steps: list[dict],
    **fields,
) -> Recipe:
    rec = Recipe(owner_id=owner_id, title=title, **fields)
    db.add(rec)
    await db.flush()
    for i, ing in enumerate(ingredients):
        db.add(RecipeIngredient(recipe_id=rec.id, position=i, **ing))
    for i, step in enumerate(steps):
        db.add(RecipeStep(recipe_id=rec.id, position=i, **step))
    await db.commit()
    return await get_recipe(db, rec.id, owner_id)


async def update_recipe(db: AsyncSession, rec: Recipe, **fields) -> Recipe:
    for k, v in fields.items():
        if v is not None or k in {"description", "image_url", "source_url",
                                  "prep_time_minutes", "cook_time_minutes"}:
            setattr(rec, k, v)
    await db.commit()
    await db.refresh(rec)
    return rec


async def delete_recipe(db: AsyncSession, rec: Recipe) -> None:
    await db.delete(rec)
    await db.commit()


async def duplicate_recipe(db: AsyncSession, src: Recipe, owner_id: int, title: str | None) -> Recipe:
    new = Recipe(
        owner_id=owner_id,
        title=title or f"{src.title} (Kopie)",
        description=src.description,
        servings=src.servings,
        prep_time_minutes=src.prep_time_minutes,
        cook_time_minutes=src.cook_time_minutes,
        category=src.category,
        image_url=src.image_url,
        source_url=src.source_url,
        tags=list(src.tags),
    )
    db.add(new)
    await db.flush()
    for ing in src.ingredients:
        db.add(RecipeIngredient(
            recipe_id=new.id, name=ing.name, quantity=ing.quantity,
            unit=ing.unit, position=ing.position,
        ))
    for step in src.steps:
        db.add(RecipeStep(
            recipe_id=new.id, description=step.description, position=step.position,
        ))
    await db.commit()
    return await get_recipe(db, new.id, owner_id)


# ---------- Ingredients ----------

async def _next_pos(db: AsyncSession, model, fk_col, fk_value: int) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(model.position), -1) + 1).where(fk_col == fk_value)
    )
    return result.scalar_one()


async def add_ingredient(
    db: AsyncSession, recipe_id: int, *, name: str, quantity: float | None, unit: str | None,
) -> RecipeIngredient:
    pos = await _next_pos(db, RecipeIngredient, RecipeIngredient.recipe_id, recipe_id)
    ing = RecipeIngredient(recipe_id=recipe_id, name=name, quantity=quantity, unit=unit, position=pos)
    db.add(ing)
    await db.commit()
    await db.refresh(ing)
    return ing


async def get_ingredient(db: AsyncSession, recipe_id: int, ing_id: int) -> RecipeIngredient | None:
    result = await db.execute(
        select(RecipeIngredient).where(
            RecipeIngredient.id == ing_id, RecipeIngredient.recipe_id == recipe_id
        )
    )
    return result.scalar_one_or_none()


async def update_ingredient(db: AsyncSession, ing: RecipeIngredient, **fields) -> RecipeIngredient:
    for k, v in fields.items():
        if v is not None or k in {"quantity", "unit"}:
            setattr(ing, k, v)
    await db.commit()
    await db.refresh(ing)
    return ing


async def delete_ingredient(db: AsyncSession, ing: RecipeIngredient) -> None:
    await db.delete(ing)
    await db.commit()


async def reorder_ingredients(
    db: AsyncSession, recipe_id: int, positions: list[tuple[int, int]]
) -> None:
    ids = [i for i, _ in positions]
    result = await db.execute(
        select(RecipeIngredient).where(
            RecipeIngredient.recipe_id == recipe_id, RecipeIngredient.id.in_(ids)
        )
    )
    by_id = {i.id: i for i in result.scalars().all()}
    for ing_id, pos in positions:
        if ing_id in by_id:
            by_id[ing_id].position = pos
    await db.commit()


# ---------- Steps ----------

async def add_step(db: AsyncSession, recipe_id: int, description: str) -> RecipeStep:
    pos = await _next_pos(db, RecipeStep, RecipeStep.recipe_id, recipe_id)
    step = RecipeStep(recipe_id=recipe_id, description=description, position=pos)
    db.add(step)
    await db.commit()
    await db.refresh(step)
    return step


async def get_step(db: AsyncSession, recipe_id: int, step_id: int) -> RecipeStep | None:
    result = await db.execute(
        select(RecipeStep).where(RecipeStep.id == step_id, RecipeStep.recipe_id == recipe_id)
    )
    return result.scalar_one_or_none()


async def update_step(db: AsyncSession, step: RecipeStep, **fields) -> RecipeStep:
    for k, v in fields.items():
        if v is not None:
            setattr(step, k, v)
    await db.commit()
    await db.refresh(step)
    return step


async def delete_step(db: AsyncSession, step: RecipeStep) -> None:
    await db.delete(step)
    await db.commit()


async def reorder_steps(
    db: AsyncSession, recipe_id: int, positions: list[tuple[int, int]]
) -> None:
    ids = [i for i, _ in positions]
    result = await db.execute(
        select(RecipeStep).where(RecipeStep.recipe_id == recipe_id, RecipeStep.id.in_(ids))
    )
    by_id = {i.id: i for i in result.scalars().all()}
    for step_id, pos in positions:
        if step_id in by_id:
            by_id[step_id].position = pos
    await db.commit()


# ---------- Copy to shopping list ----------

def _scale_quantity(qty: float | None, factor: float) -> float | None:
    if qty is None:
        return None
    return round(qty * factor, 2)


async def copy_to_list(
    db: AsyncSession,
    rec: Recipe,
    owner_id: int,
    *,
    list_id: int | None,
    new_list_title: str | None,
    servings: int,
    ingredient_ids: list[int] | None,
) -> tuple[ListModel, int]:
    """Scale recipe ingredients and append them to a shopping list (existing or new).
    Returns (list, items_added).
    """
    selected = [
        i for i in rec.ingredients
        if ingredient_ids is None or i.id in ingredient_ids
    ]
    if not selected:
        raise ValueError("No ingredients to copy")

    factor = servings / rec.servings if rec.servings else 1.0

    # Resolve target list
    if list_id is None:
        if not new_list_title or not new_list_title.strip():
            new_list_title = rec.title
        target = ListModel(
            owner_id=owner_id,
            title=new_list_title.strip(),
            type=ListType.SHOPPING,
            icon="🛒",
            color="#10b981",
        )
        db.add(target)
        await db.flush()
    else:
        result = await db.execute(
            select(ListModel).where(
                ListModel.id == list_id, ListModel.owner_id == owner_id
            )
        )
        target = result.scalar_one_or_none()
        if not target:
            raise ValueError("Target list not found")

    # Find next position on target list
    pos_result = await db.execute(
        select(func.coalesce(func.max(ListItem.position), -1) + 1).where(
            ListItem.list_id == target.id
        )
    )
    pos = pos_result.scalar_one()

    added = 0
    for ing in sorted(selected, key=lambda i: i.position):
        db.add(ListItem(
            list_id=target.id,
            text=ing.name,
            quantity=_scale_quantity(ing.quantity, factor),
            unit=ing.unit,
            position=pos,
            is_checked=False,
        ))
        pos += 1
        added += 1

    await db.commit()
    await db.refresh(target)
    return target, added
