from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.data.aisle_map import aisle_for
from app.models.list import CategorizationMode, List as ListModel, ListType
from app.models.list_item import ListItem
from app.models.recipe import NutritionSource, Recipe, RecipeCookLog, RecipeIngredient, RecipeStep


# ---------- Recipe CRUD ----------

async def list_recipes(
    db: AsyncSession,
    owner_id: int,
    *,
    q: str | None = None,
    tag: str | None = None,
) -> list[tuple[Recipe, int]]:
    """List the user's recipes. `tag` filters to recipes that have the
    given tag (exact, case-insensitive). The category enum was replaced
    by tags in alembic 0011 — this helper now treats the meal-type
    bucketing the same as any other tag."""
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
    if tag:
        stmt = stmt.where(Recipe.tags.any(tag))
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
        if v is not None or k in {"description", "tips", "image_url", "source_url",
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
        image_url=src.image_url,
        source_url=src.source_url,
        tags=list(src.tags),
    )
    db.add(new)
    await db.flush()
    for ing in src.ingredients:
        # Carry nutrition fields + provenance forward — the common case
        # for "Rezept duplizieren" is "alles wie das Original, ich passe
        # nur ein paar Schritte an", not "Nährwerte fang ich neu an".
        # off_product_code / usda_fdc_id stay attached so a later
        # "Werte aktualisieren" on the copy can re-pull the exact same
        # OFF or USDA food row.
        db.add(RecipeIngredient(
            recipe_id=new.id, name=ing.name, quantity=ing.quantity,
            unit=ing.unit, position=ing.position,
            calories_per_100g=ing.calories_per_100g,
            protein_per_100g=ing.protein_per_100g,
            carbs_per_100g=ing.carbs_per_100g,
            fat_per_100g=ing.fat_per_100g,
            fiber_per_100g=ing.fiber_per_100g,
            sugar_per_100g=ing.sugar_per_100g,
            salt_per_100g=ing.salt_per_100g,
            nutrition_source=ing.nutrition_source,
            off_product_code=ing.off_product_code,
            usda_fdc_id=ing.usda_fdc_id,
        ))
    for step in src.steps:
        db.add(RecipeStep(
            recipe_id=new.id, description=step.description, position=step.position,
        ))
    await db.commit()
    return await get_recipe(db, new.id, owner_id)


# ---------- Cook history (alembic 0028) ----------

async def mark_cooked(
    db: AsyncSession,
    rec: Recipe,
    *,
    notes: str | None = None,
    rating: int | None = None,
    is_favorite: bool | None = None,
) -> RecipeCookLog:
    """Append a cook-log entry and bump the denormalised caches on the
    recipe in one transaction. From the post-cook sheet, rating/favorite
    ride along so finishing a cook can rate it in the same request. The
    caller re-loads the recipe for its response — rec's column attributes
    are expired after the commit."""
    log = RecipeCookLog(recipe_id=rec.id, notes=notes)
    db.add(log)
    rec.cooked_count = (rec.cooked_count or 0) + 1
    rec.last_cooked_at = func.now()
    if rating is not None:
        rec.rating = rating
    if is_favorite is not None:
        rec.is_favorite = is_favorite
    await db.commit()
    await db.refresh(log)
    return log


async def list_cook_logs(
    db: AsyncSession, recipe_id: int, *, limit: int = 10
) -> list[RecipeCookLog]:
    result = await db.execute(
        select(RecipeCookLog)
        .where(RecipeCookLog.recipe_id == recipe_id)
        .order_by(RecipeCookLog.cooked_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


# ---------- Ingredients ----------

async def _next_pos(db: AsyncSession, model, fk_col, fk_value: int) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(model.position), -1) + 1).where(fk_col == fk_value)
    )
    return result.scalar_one()


async def add_ingredient(
    db: AsyncSession,
    recipe_id: int,
    *,
    name: str,
    quantity: float | None,
    unit: str | None,
    calories_per_100g: float | None = None,
    protein_per_100g: float | None = None,
    carbs_per_100g: float | None = None,
    fat_per_100g: float | None = None,
    fiber_per_100g: float | None = None,
    sugar_per_100g: float | None = None,
    salt_per_100g: float | None = None,
    nutrition_source: NutritionSource | None = None,
    off_product_code: str | None = None,
    usda_fdc_id: str | None = None,
) -> RecipeIngredient:
    pos = await _next_pos(db, RecipeIngredient, RecipeIngredient.recipe_id, recipe_id)
    ing = RecipeIngredient(
        recipe_id=recipe_id,
        name=name,
        quantity=quantity,
        unit=unit,
        position=pos,
        calories_per_100g=calories_per_100g,
        protein_per_100g=protein_per_100g,
        carbs_per_100g=carbs_per_100g,
        fat_per_100g=fat_per_100g,
        fiber_per_100g=fiber_per_100g,
        sugar_per_100g=sugar_per_100g,
        salt_per_100g=salt_per_100g,
        nutrition_source=nutrition_source,
        off_product_code=off_product_code,
        usda_fdc_id=usda_fdc_id,
    )
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
            # MANUAL so the aisle-tagged items render in sections (grouped view)
            # straight away, driven by persisted state.
            categorization_mode=CategorizationMode.MANUAL,
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
            # Aisle section, set instantly from the static map (no Ollama).
            # Leaves category_locked False so a manual re-categorise still wins.
            category=aisle_for(ing.name),
            position=pos,
            is_checked=False,
        ))
        pos += 1
        added += 1

    await db.commit()
    await db.refresh(target)
    return target, added


# =============================================================================
#  Sharing — single recipe + whole recipe book
# =============================================================================
#
# Mirrors the list-share pattern: random hex token, public read-only fetch
# bypasses ownership checks but only returns rows where share_enabled is true.

import base64
import io
import uuid

import qrcode

from app.core.config import settings
from app.models.user import User


def _qr_base64(url: str) -> str:
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


# ---------- Single recipe ----------

async def enable_recipe_share(db: AsyncSession, rec: Recipe) -> tuple[str, str, str]:
    if not rec.share_token:
        rec.share_token = uuid.uuid4().hex
    rec.share_enabled = True
    await db.commit()
    await db.refresh(rec)
    share_url = f"{settings.FRONTEND_URL}/share/recipe/{rec.share_token}"
    return rec.share_token, share_url, _qr_base64(share_url)


async def disable_recipe_share(db: AsyncSession, rec: Recipe) -> None:
    rec.share_enabled = False
    rec.share_token = None
    await db.commit()


async def get_public_recipe(db: AsyncSession, token: str) -> Recipe | None:
    result = await db.execute(
        select(Recipe)
        .options(selectinload(Recipe.ingredients), selectinload(Recipe.steps))
        .where(Recipe.share_token == token, Recipe.share_enabled.is_(True))
    )
    return result.scalar_one_or_none()


# ---------- Whole recipe book ----------

async def enable_book_share(db: AsyncSession, user: User) -> tuple[str, str, str]:
    if not user.recipe_book_share_token:
        user.recipe_book_share_token = uuid.uuid4().hex
    user.recipe_book_share_enabled = True
    await db.commit()
    await db.refresh(user)
    share_url = f"{settings.FRONTEND_URL}/share/recipe-book/{user.recipe_book_share_token}"
    return user.recipe_book_share_token, share_url, _qr_base64(share_url)


async def disable_book_share(db: AsyncSession, user: User) -> None:
    user.recipe_book_share_enabled = False
    user.recipe_book_share_token = None
    await db.commit()


async def get_public_book(db: AsyncSession, token: str) -> tuple[User, list[tuple[Recipe, int]]] | None:
    user_res = await db.execute(
        select(User).where(
            User.recipe_book_share_token == token,
            User.recipe_book_share_enabled.is_(True),
        )
    )
    user = user_res.scalar_one_or_none()
    if not user:
        return None
    ingredient_count = func.count(RecipeIngredient.id).label("ingredient_count")
    rec_res = await db.execute(
        select(Recipe, ingredient_count)
        .outerjoin(RecipeIngredient, RecipeIngredient.recipe_id == Recipe.id)
        .where(Recipe.owner_id == user.id)
        .group_by(Recipe.id)
        .order_by(Recipe.title)
    )
    return user, [(r, c) for r, c in rec_res.all()]


# =============================================================================
#  Internal sharing — alembic 0012
# =============================================================================
#
# Two layers stack on top of the public-token sharing:
#   1. Per-recipe internal share — RecipeShare row grants a Lyst user direct
#      app-level read access to one recipe.
#   2. Whole-book internal share — RecipeBookShare grants a user access to
#      every recipe of the owner. New recipes created later show up too.
#
# All recipient access is READ-ONLY — write/delete still requires owner_id
# match (existing get_recipe enforces that for mutations). Recipients use
# get_accessible_recipe / list_accessible_recipes below.

from sqlalchemy import and_ as _and
from sqlalchemy.exc import IntegrityError as _IntegrityError

from app.models.collaborator import CollaboratorPermission
from app.models.recipe import RecipeBookShare, RecipeShare


def _max_perm(
    a: CollaboratorPermission | None, b: CollaboratorPermission | None
) -> CollaboratorPermission | None:
    """Higher permission wins when a recipe is reachable via both an
    individual and a book share. EDIT > VIEW; None is "no access"."""
    if a is None:
        return b
    if b is None:
        return a
    return CollaboratorPermission.EDIT if (
        a == CollaboratorPermission.EDIT or b == CollaboratorPermission.EDIT
    ) else CollaboratorPermission.VIEW


# ---------- Recipient queries ----------

async def get_accessible_recipe(
    db: AsyncSession, recipe_id: int, user_id: int
) -> tuple[Recipe, str | None, CollaboratorPermission]:
    """Fetch a recipe the user owns OR has been shared (per-recipe or via
    a book share). Returns (recipe, share_source, permission). Owner gets
    EDIT. Recipient with both individual + book shares: higher perm wins,
    share_source = "individual" (more specific signal).  Raises ValueError
    when there's no access."""
    result = await db.execute(
        select(Recipe)
        .options(selectinload(Recipe.ingredients), selectinload(Recipe.steps))
        .where(Recipe.id == recipe_id)
    )
    rec = result.scalar_one_or_none()
    if not rec:
        raise ValueError("Recipe not found")
    if rec.owner_id == user_id:
        return rec, None, CollaboratorPermission.EDIT

    ind_perm: CollaboratorPermission | None = None
    book_perm: CollaboratorPermission | None = None

    rs = await db.execute(
        select(RecipeShare).where(
            _and(
                RecipeShare.recipe_id == recipe_id,
                RecipeShare.shared_with_user_id == user_id,
            )
        )
    )
    ind_share = rs.scalar_one_or_none()
    if ind_share:
        ind_perm = ind_share.permission

    bs = await db.execute(
        select(RecipeBookShare).where(
            _and(
                RecipeBookShare.owner_id == rec.owner_id,
                RecipeBookShare.shared_with_user_id == user_id,
            )
        )
    )
    book_share = bs.scalar_one_or_none()
    if book_share:
        book_perm = book_share.permission

    perm = _max_perm(ind_perm, book_perm)
    if perm is None:
        raise ValueError("Recipe not found")
    source = "individual" if ind_share else "book"
    return rec, source, perm


async def list_accessible_recipes(
    db: AsyncSession,
    user_id: int,
    *,
    q: str | None = None,
    tag: str | None = None,
) -> list[tuple[Recipe, int, str | None, str | None, CollaboratorPermission]]:
    """Owned + shared recipes, with per-row share metadata.

    Returns [(recipe, ingredient_count, share_source, owner_name)] where
    share_source/owner_name are None for owned rows. De-dupes recipes that
    arrive via both individual share AND book share — individual wins.
    Sorted by updated_at desc, identical to the owner-only view."""

    # ----- Owned recipes -----
    own = await list_recipes(db, user_id, q=q, tag=tag)
    by_id: dict[
        int, tuple[Recipe, int, str | None, str | None, CollaboratorPermission]
    ] = {
        r.id: (r, c, None, None, CollaboratorPermission.EDIT) for r, c in own
    }

    # ----- Helper: query a set of recipe rows by id with ingredient_count -----
    async def _fetch(recipe_ids: list[int]) -> list[tuple[Recipe, int]]:
        if not recipe_ids:
            return []
        ingredient_count = func.count(RecipeIngredient.id).label("ingredient_count")
        stmt = (
            select(Recipe, ingredient_count)
            .outerjoin(RecipeIngredient, RecipeIngredient.recipe_id == Recipe.id)
            .where(Recipe.id.in_(recipe_ids))
            .group_by(Recipe.id)
        )
        if q:
            like = f"%{q.lower()}%"
            stmt = stmt.where(
                or_(func.lower(Recipe.title).like(like), Recipe.tags.any(q.lower())),
            )
        if tag:
            stmt = stmt.where(Recipe.tags.any(tag))
        result = await db.execute(stmt)
        return [(r, c) for r, c in result.all()]

    # ----- Recipes shared individually with user -----
    ind_rows_res = await db.execute(
        select(RecipeShare.recipe_id, RecipeShare.permission).where(
            RecipeShare.shared_with_user_id == user_id
        )
    )
    ind_perm_by_recipe: dict[int, CollaboratorPermission] = {
        rid: perm for rid, perm in ind_rows_res.all()
    }
    ind_rows = await _fetch(list(ind_perm_by_recipe.keys()))

    # Look up owner names in one shot.
    owner_ids: set[int] = set()
    for r, _ in ind_rows:
        owner_ids.add(r.owner_id)

    # ----- Recipes from books shared with user -----
    book_owners_res = await db.execute(
        select(RecipeBookShare.owner_id, RecipeBookShare.permission).where(
            RecipeBookShare.shared_with_user_id == user_id
        )
    )
    book_perm_by_owner: dict[int, CollaboratorPermission] = {
        oid: perm for oid, perm in book_owners_res.all()
    }
    book_owner_ids = list(book_perm_by_owner.keys())
    if book_owner_ids:
        ingredient_count = func.count(RecipeIngredient.id).label("ingredient_count")
        book_stmt = (
            select(Recipe, ingredient_count)
            .outerjoin(RecipeIngredient, RecipeIngredient.recipe_id == Recipe.id)
            .where(Recipe.owner_id.in_(book_owner_ids))
            .group_by(Recipe.id)
        )
        if q:
            like = f"%{q.lower()}%"
            book_stmt = book_stmt.where(
                or_(func.lower(Recipe.title).like(like), Recipe.tags.any(q.lower())),
            )
        if tag:
            book_stmt = book_stmt.where(Recipe.tags.any(tag))
        book_res = await db.execute(book_stmt)
        book_rows = [(r, c) for r, c in book_res.all()]
        for r, _ in book_rows:
            owner_ids.add(r.owner_id)
    else:
        book_rows = []

    # Resolve owner names in one query (used to display "Geteilt von …").
    name_by_id: dict[int, str] = {}
    if owner_ids:
        users_res = await db.execute(
            select(User.id, User.name).where(User.id.in_(owner_ids))
        )
        name_by_id = {uid: name for uid, name in users_res.all()}

    # Merge — own rows already in `by_id`. Individual shares take precedence
    # over book shares (more specific signal); permission combines per
    # _max_perm so a recipient with EDIT via book + VIEW via individual
    # ends up with EDIT.
    for r, c in ind_rows:
        if r.id in by_id:
            continue  # owner sees their own copy, share is redundant
        ind_perm = ind_perm_by_recipe.get(r.id)
        book_perm = book_perm_by_owner.get(r.owner_id)
        perm = _max_perm(ind_perm, book_perm) or CollaboratorPermission.VIEW
        by_id[r.id] = (
            r, c, "individual", name_by_id.get(r.owner_id), perm,
        )
    for r, c in book_rows:
        if r.id in by_id:
            continue
        perm = book_perm_by_owner.get(r.owner_id) or CollaboratorPermission.VIEW
        by_id[r.id] = (
            r, c, "book", name_by_id.get(r.owner_id), perm,
        )

    rows = list(by_id.values())
    rows.sort(key=lambda t: t[0].updated_at, reverse=True)
    return rows


# ---------- Email-based share ----------

async def _user_by_email(db: AsyncSession, email: str) -> User | None:
    """Exact, case-insensitive lookup. The whole point of this helper is to
    stay the only path that maps email→user — keep autocompletion or
    partial-match queries out of the API to avoid user enumeration."""
    res = await db.execute(
        select(User).where(func.lower(User.email) == email.strip().lower())
    )
    return res.scalar_one_or_none()


async def share_recipe_with_email(
    db: AsyncSession,
    rec: Recipe,
    owner: User,
    email: str,
    permission: CollaboratorPermission = CollaboratorPermission.VIEW,
) -> tuple[str, str | None, int | None]:
    """Returns (kind, user_name, recipient_id) where kind is "internal"
    or "external" and recipient_id is the User.id of the recipient on
    the internal path (so the caller can fan out a share.created
    user-WS event). External path returns recipient_id=None and leaves
    the caller responsible for sending the Brevo email; this just
    ensures share_token is provisioned. Re-sharing with the same
    address updates the permission rather than 409-ing."""
    target_email = email.strip().lower()
    if target_email == owner.email.lower():
        raise ValueError("self-share")

    target = await _user_by_email(db, target_email)
    if target is None:
        # No matching user — caller will email the public link. Make sure
        # one exists.
        if not rec.share_token:
            await enable_recipe_share(db, rec)
        return "external", None, None

    existing = await db.execute(
        select(RecipeShare).where(
            _and(
                RecipeShare.recipe_id == rec.id,
                RecipeShare.shared_with_user_id == target.id,
            )
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        if row.permission != permission:
            row.permission = permission
            await db.commit()
    else:
        db.add(
            RecipeShare(
                recipe_id=rec.id,
                shared_with_user_id=target.id,
                permission=permission,
            )
        )
        try:
            await db.commit()
        except _IntegrityError:
            await db.rollback()
    return "internal", target.name, target.id


async def share_book_with_email(
    db: AsyncSession,
    owner: User,
    email: str,
    permission: CollaboratorPermission = CollaboratorPermission.VIEW,
) -> tuple[str, str | None, int | None]:
    """Same 3-tuple shape as share_recipe_with_email — recipient_id
    populated on the internal path so the router can emit a
    share.created user-WS event."""
    target_email = email.strip().lower()
    if target_email == owner.email.lower():
        raise ValueError("self-share")

    target = await _user_by_email(db, target_email)
    if target is None:
        if not owner.recipe_book_share_token:
            await enable_book_share(db, owner)
        return "external", None, None

    existing = await db.execute(
        select(RecipeBookShare).where(
            _and(
                RecipeBookShare.owner_id == owner.id,
                RecipeBookShare.shared_with_user_id == target.id,
            )
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        if row.permission != permission:
            row.permission = permission
            await db.commit()
    else:
        db.add(
            RecipeBookShare(
                owner_id=owner.id,
                shared_with_user_id=target.id,
                permission=permission,
            )
        )
        try:
            await db.commit()
        except _IntegrityError:
            await db.rollback()
    return "internal", target.name, target.id


async def update_recipe_internal_share_permission(
    db: AsyncSession,
    recipe_id: int,
    user_id: int,
    permission: CollaboratorPermission,
) -> bool:
    res = await db.execute(
        select(RecipeShare).where(
            _and(
                RecipeShare.recipe_id == recipe_id,
                RecipeShare.shared_with_user_id == user_id,
            )
        )
    )
    row = res.scalar_one_or_none()
    if not row:
        return False
    row.permission = permission
    await db.commit()
    return True


async def update_book_internal_share_permission(
    db: AsyncSession,
    owner_id: int,
    user_id: int,
    permission: CollaboratorPermission,
) -> bool:
    res = await db.execute(
        select(RecipeBookShare).where(
            _and(
                RecipeBookShare.owner_id == owner_id,
                RecipeBookShare.shared_with_user_id == user_id,
            )
        )
    )
    row = res.scalar_one_or_none()
    if not row:
        return False
    row.permission = permission
    await db.commit()
    return True


async def leave_recipe_internal_share(
    db: AsyncSession, recipe_id: int, user_id: int
) -> bool:
    res = await db.execute(
        select(RecipeShare).where(
            _and(
                RecipeShare.recipe_id == recipe_id,
                RecipeShare.shared_with_user_id == user_id,
            )
        )
    )
    row = res.scalar_one_or_none()
    if not row:
        return False
    await db.delete(row)
    await db.commit()
    return True


async def leave_book_internal_share(
    db: AsyncSession, owner_id: int, user_id: int
) -> bool:
    res = await db.execute(
        select(RecipeBookShare).where(
            _and(
                RecipeBookShare.owner_id == owner_id,
                RecipeBookShare.shared_with_user_id == user_id,
            )
        )
    )
    row = res.scalar_one_or_none()
    if not row:
        return False
    await db.delete(row)
    await db.commit()
    return True


async def list_recipe_internal_shares(
    db: AsyncSession, recipe_id: int
) -> list[tuple[RecipeShare, User]]:
    res = await db.execute(
        select(RecipeShare, User)
        .join(User, RecipeShare.shared_with_user_id == User.id)
        .where(RecipeShare.recipe_id == recipe_id)
        .order_by(RecipeShare.created_at)
    )
    return [(s, u) for s, u in res.all()]


async def revoke_recipe_internal_share(
    db: AsyncSession, recipe_id: int, user_id: int
) -> None:
    res = await db.execute(
        select(RecipeShare).where(
            _and(
                RecipeShare.recipe_id == recipe_id,
                RecipeShare.shared_with_user_id == user_id,
            )
        )
    )
    row = res.scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()


async def list_book_internal_shares(
    db: AsyncSession, owner_id: int
) -> list[tuple[RecipeBookShare, User]]:
    res = await db.execute(
        select(RecipeBookShare, User)
        .join(User, RecipeBookShare.shared_with_user_id == User.id)
        .where(RecipeBookShare.owner_id == owner_id)
        .order_by(RecipeBookShare.created_at)
    )
    return [(s, u) for s, u in res.all()]


async def revoke_book_internal_share(
    db: AsyncSession, owner_id: int, user_id: int
) -> None:
    res = await db.execute(
        select(RecipeBookShare).where(
            _and(
                RecipeBookShare.owner_id == owner_id,
                RecipeBookShare.shared_with_user_id == user_id,
            )
        )
    )
    row = res.scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()
