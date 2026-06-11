"""Recipe-import endpoints — extracted from recipes.py.

Three flavours, all mounted under /recipes for URL compatibility:

  POST /recipes/import-url     — fetch & parse a URL
  POST /recipes/import-photo   — multipart image upload
  POST /recipes/import         — unified: JSON {text} OR multipart file
                                  (image / HTML / PDF)

None of these touch an existing recipe (the parsed result is returned
to the client, which then POSTs to /recipes to create), so there's no
permission gate here — only `require_user`.
"""
import logging

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_user
from app.core.responses import ok
from app.models.user import User
from app.schemas.recipe import EmlBatchItem, EmlBatchResponse, ImportUrlRequest
from app.services.import_service import (
    RecipeImportError,
    import_recipe_from_html_bytes,
    import_recipe_from_image,
    import_recipe_from_images,
    import_recipe_from_pdf_bytes,
    import_recipe_from_text,
    import_recipe_from_url,
)
from app.services.picnic_import_service import import_one_eml

router = APIRouter(prefix="/recipes", tags=["recipes"])

logger = logging.getLogger(__name__)


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


# ---------- Import from photo via Ollama vision ----------

MAX_PHOTO_BYTES = 10 * 1024 * 1024
ALLOWED_PHOTO_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}


@router.post("/import-photo")
async def post_import_photo(
    file: UploadFile = File(...),
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    if file.content_type not in ALLOWED_PHOTO_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nur JPG, PNG und WebP werden unterstützt",
        )
    data = await file.read()
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Maximale Bildgröße: 10 MB",
        )
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Leere Datei")
    try:
        result = await import_recipe_from_image(data, db)
    except RecipeImportError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok(result.model_dump(mode="json"))


# ---------- Multi-photo import (several photos → ONE recipe) ----------

MAX_IMPORT_PHOTOS = 4


@router.post("/import-photos")
async def post_import_photos(
    files: list[UploadFile] = File(...),
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Several photos of ONE recipe → a single extracted recipe. Each photo is
    OCR'd separately and merged (see import_recipe_from_images)."""
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Keine Bilder hochgeladen")
    if len(files) > MAX_IMPORT_PHOTOS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximal {MAX_IMPORT_PHOTOS} Fotos pro Import",
        )
    images: list[bytes] = []
    for f in files:
        if f.content_type not in ALLOWED_PHOTO_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Nur JPG, PNG und WebP werden unterstützt",
            )
        data = await f.read()
        if len(data) > MAX_PHOTO_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Maximale Bildgröße: 10 MB pro Foto",
            )
        if not data:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Leere Datei")
        images.append(data)
    try:
        result = await import_recipe_from_images(images, db)
    except RecipeImportError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok(result.model_dump(mode="json"))


# ---------- Unified import (file OR free text) ----------
#
# POST /recipes/import accepts EITHER a multipart upload (image / HTML /
# PDF) OR a JSON body {"text": "..."}. Detection is by Content-Type:
# multipart/form-data → file path; application/json → text path. Each
# input is routed to the matching import_recipe_from_* helper and the
# result is the same ImportedRecipe shape as the legacy /import-url
# and /import-photo endpoints — frontend keeps one preview screen for
# all paths.
#
# /import-url and /import-photo stay as-is for backward compat.

_IMPORT_IMAGE_TYPES = ALLOWED_PHOTO_TYPES
_IMPORT_HTML_TYPES = {"text/html", "application/xhtml+xml"}
_IMPORT_PDF_TYPES = {"application/pdf"}
_IMPORT_MAX_BYTES = MAX_PHOTO_BYTES  # same 10 MB ceiling across types


@router.post("/import")
async def post_import(
    request: Request,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Single endpoint, four flavours. The Content-Type tells us
    which path to take:
      - application/json    → {"text": "..."} free-text path
      - multipart/form-data → file field, dispatched by its own
                              Content-Type (image / HTML / PDF)
    """
    ct = (request.headers.get("content-type") or "").lower()

    # --- JSON: free-text path --------------------------------------------
    if ct.startswith("application/json"):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ungültiger JSON-Body",
            )
        text = (body or {}).get("text") if isinstance(body, dict) else None
        if not isinstance(text, str) or not text.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Kein Text eingegeben",
            )
        try:
            result = await import_recipe_from_text(text, db)
        except RecipeImportError as e:
            raise HTTPException(status_code=e.status, detail=e.message)
        return ok(result.model_dump(mode="json"))

    # --- Multipart: file path --------------------------------------------
    if not ct.startswith("multipart/form-data"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bitte JSON oder eine Datei senden",
        )
    form = await request.form()
    upload = form.get("file")
    if not isinstance(upload, UploadFile):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Datei fehlt (Feldname 'file')",
        )

    # Stream-read so a 50 MB upload doesn't get buffered before we
    # reject it on size.
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > _IMPORT_MAX_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Maximale Dateigröße: 10 MB",
            )
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Leere Datei",
        )

    file_ct = (upload.content_type or "").lower()
    # Fallback: when the client doesn't send a content-type (drag/drop
    # of a .html file in some browsers), sniff by filename extension.
    if not file_ct or file_ct == "application/octet-stream":
        name = (upload.filename or "").lower()
        if name.endswith(".pdf"):
            file_ct = "application/pdf"
        elif name.endswith((".html", ".htm")):
            file_ct = "text/html"
        elif name.endswith(".jpg") or name.endswith(".jpeg"):
            file_ct = "image/jpeg"
        elif name.endswith(".png"):
            file_ct = "image/png"
        elif name.endswith(".webp"):
            file_ct = "image/webp"

    try:
        if file_ct in _IMPORT_IMAGE_TYPES:
            result = await import_recipe_from_image(data, db)
        elif file_ct in _IMPORT_HTML_TYPES:
            result = await import_recipe_from_html_bytes(data, db)
        elif file_ct in _IMPORT_PDF_TYPES:
            result = await import_recipe_from_pdf_bytes(data, db)
        else:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Unterstützt: JPG, PNG, WebP, HTML, PDF",
            )
    except RecipeImportError as e:
        raise HTTPException(status_code=e.status, detail=e.message)
    return ok(result.model_dump(mode="json"))


# ---------- Picnic recipe .eml import (no AI, creates recipes directly) ----------

@router.post("/import-email")
async def post_import_email(
    background: BackgroundTasks,
    files: list[UploadFile] = File(...),
    force: bool = Form(False),
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload one or more Picnic recipe .eml files. Each is parsed (no Ollama),
    deduped (image hash → title), and created with source="structured_import";
    the hero image is downloaded + stored locally. Returns a per-file batch
    summary. `force` skips the duplicate check ("trotzdem importieren")."""
    results: list[EmlBatchItem] = []
    created_ids: list[int] = []
    counts = {"created": 0, "duplicate": 0, "unrecognized": 0, "error": 0}
    for f in files:
        data = await f.read()
        if not data:
            results.append(EmlBatchItem(filename=f.filename, status="error", message="Leere Datei"))
            counts["error"] += 1
            continue
        if len(data) > _IMPORT_MAX_BYTES:
            results.append(
                EmlBatchItem(filename=f.filename, status="error", message="Datei zu groß (max 10 MB)")
            )
            counts["error"] += 1
            continue
        try:
            outcome = await import_one_eml(db, owner_id=user.id, raw=data, force=force)
        except Exception:
            logger.exception("Picnic .eml import failed for %s", f.filename)
            results.append(
                EmlBatchItem(filename=f.filename, status="error", message="Import fehlgeschlagen")
            )
            counts["error"] += 1
            continue
        results.append(
            EmlBatchItem(
                filename=f.filename,
                status=outcome.status,
                recipe_id=outcome.recipe_id,
                title=outcome.title,
                message=outcome.message,
            )
        )
        counts[outcome.status] = counts.get(outcome.status, 0) + 1
        if outcome.status == "created" and outcome.recipe_id:
            created_ids.append(outcome.recipe_id)

    if created_ids:
        # Same background nutrition fill as the bulk import.
        from app.routers.recipes import _bulk_fill_nutrition

        background.add_task(_bulk_fill_nutrition, created_ids, user.id)

    return ok(
        EmlBatchResponse(
            results=results,
            imported=counts["created"],
            duplicates=counts["duplicate"],
            unrecognized=counts["unrecognized"],
            errors=counts["error"],
        ).model_dump()
    )
