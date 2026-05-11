from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.recipe import RecipeCategory
from app.models.user import User
from app.schemas.recipe import (
    CopyToListRequest,
    CopyToListResponse,
    ImportUrlRequest,
    IngredientCreate,
    IngredientOut,
    IngredientUpdate,
    RecipeCreate,
    RecipeDuplicate,
    RecipeOut,
    RecipeSummary,
    RecipeUpdate,
    ReorderRequest,
    StepCreate,
    StepOut,
    StepUpdate,
)
from app.services.import_service import RecipeImportError, import_recipe_from_url
from app.services.recipe_service import (
    add_ingredient,
    add_step,
    copy_to_list,
    create_recipe,
    delete_ingredient,
    delete_recipe,
    delete_step,
    duplicate_recipe,
    get_ingredient,
    get_recipe,
    get_step,
    list_recipes,
    reorder_ingredients,
    reorder_steps,
    update_ingredient,
    update_recipe,
    update_step,
)

router = APIRouter(prefix="/recipes", tags=["recipes"])


def _summary(rec, ingredient_count: int) -> dict:
    return RecipeSummary.model_validate(rec).model_copy(
        update={"ingredient_count": ingredient_count}
    ).model_dump(mode="json")


def _full(rec) -> dict:
    return RecipeOut.model_validate(rec).model_dump(mode="json")


# ---------- Recipes ----------

@router.get("")
async def get_recipes(
    q: str | None = None,
    category: RecipeCategory | None = None,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await list_recipes(db, user.id, q=q, category=category)
    return ok([_summary(r, c) for r, c in rows])


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_recipe(
    payload: RecipeCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    data = payload.model_dump()
    ingredients = data.pop("ingredients", [])
    steps = data.pop("steps", [])
    rec = await create_recipe(db, user.id, ingredients=ingredients, steps=steps, **data)
    return ok(_full(rec))


@router.get("/{recipe_id}")
async def get_recipe_route(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return ok(_full(rec))


@router.patch("/{recipe_id}")
async def patch_recipe(
    recipe_id: int,
    payload: RecipeUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    rec = await update_recipe(db, rec, **payload.model_dump(exclude_unset=True))
    rec = await get_recipe(db, recipe_id, user.id)
    return ok(_full(rec))


@router.delete("/{recipe_id}")
async def del_recipe(
    recipe_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    await delete_recipe(db, rec)
    return ok({"message": "Deleted"})


@router.post("/{recipe_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def post_duplicate(
    recipe_id: int,
    payload: RecipeDuplicate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        src = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    new = await duplicate_recipe(db, src, user.id, payload.title)
    return ok(_full(new))


# ---------- Ingredients ----------

@router.post("/{recipe_id}/ingredients", status_code=status.HTTP_201_CREATED)
async def post_ingredient(
    recipe_id: int,
    payload: IngredientCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    ing = await add_ingredient(db, recipe_id, **payload.model_dump())
    return ok(IngredientOut.model_validate(ing).model_dump(mode="json"))


@router.patch("/{recipe_id}/ingredients/reorder")
async def patch_ingredients_reorder(
    recipe_id: int,
    payload: ReorderRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    await reorder_ingredients(db, recipe_id, [(i.id, i.position) for i in payload.items])
    return ok({"message": "Reordered"})


@router.patch("/{recipe_id}/ingredients/{ing_id}")
async def patch_ingredient(
    recipe_id: int,
    ing_id: int,
    payload: IngredientUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    ing = await get_ingredient(db, recipe_id, ing_id)
    if not ing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ingredient not found")
    ing = await update_ingredient(db, ing, **payload.model_dump(exclude_unset=True))
    return ok(IngredientOut.model_validate(ing).model_dump(mode="json"))


@router.delete("/{recipe_id}/ingredients/{ing_id}")
async def del_ingredient(
    recipe_id: int,
    ing_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    ing = await get_ingredient(db, recipe_id, ing_id)
    if not ing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ingredient not found")
    await delete_ingredient(db, ing)
    return ok({"message": "Deleted"})


# ---------- Steps ----------

@router.post("/{recipe_id}/steps", status_code=status.HTTP_201_CREATED)
async def post_step(
    recipe_id: int,
    payload: StepCreate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    step = await add_step(db, recipe_id, payload.description)
    return ok(StepOut.model_validate(step).model_dump(mode="json"))


@router.patch("/{recipe_id}/steps/reorder")
async def patch_steps_reorder(
    recipe_id: int,
    payload: ReorderRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    await reorder_steps(db, recipe_id, [(i.id, i.position) for i in payload.items])
    return ok({"message": "Reordered"})


@router.patch("/{recipe_id}/steps/{step_id}")
async def patch_step(
    recipe_id: int,
    step_id: int,
    payload: StepUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    step = await get_step(db, recipe_id, step_id)
    if not step:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Step not found")
    step = await update_step(db, step, **payload.model_dump(exclude_unset=True))
    return ok(StepOut.model_validate(step).model_dump(mode="json"))


@router.delete("/{recipe_id}/steps/{step_id}")
async def del_step(
    recipe_id: int,
    step_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    step = await get_step(db, recipe_id, step_id)
    if not step:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Step not found")
    await delete_step(db, step)
    return ok({"message": "Deleted"})


# ---------- Import from URL via Ollama ----------

@router.post("/import-url")
async def post_import_url(
    payload: ImportUrlRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await import_recipe_from_url(payload.url, db)
    except RecipeImportError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok(result.model_dump(mode="json"))


# ---------- Copy to shopping list (the killer feature) ----------

@router.post("/{recipe_id}/copy-to-list", status_code=status.HTTP_201_CREATED)
async def post_copy_to_list(
    recipe_id: int,
    payload: CopyToListRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        rec = await get_recipe(db, recipe_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    try:
        target, added = await copy_to_list(
            db,
            rec,
            user.id,
            list_id=payload.list_id,
            new_list_title=payload.new_list_title,
            servings=payload.servings,
            ingredient_ids=payload.ingredient_ids,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return ok(
        CopyToListResponse(
            list_id=target.id, list_title=target.title, items_added=added
        ).model_dump()
    )
