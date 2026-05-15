"""Pull the hero image out of an imported recipe source.

Per source type:
  - URL  : og:image / JSON-LD ImageObject / heuristic largest <img>.
           Image bytes fetched via httpx.
  - HTML : same logic applied to the uploaded bytes. <img src="data:…">
           is decoded inline; absolute http(s) URLs are fetched the
           same way as URL imports; cid:/relative refs are skipped
           (we don't have the email's attachment parts).
  - PDF  : pypdf's `page.images` over page 0, pick the largest.
  - Photo: the uploaded image IS the recipe image; the caller returns
           it directly without going through here.
  - Text : no image. Caller skips this module entirely.

Every entrypoint returns (bytes, mime_type) on success or None on
ANY kind of failure (download error, no candidates, unsupported
format). The import flow doesn't fail when image extraction does —
the recipe is still useful; the user can add an image manually in
the preview.

10 MB download ceiling matches the manual-upload endpoint. Pillow
validates the bytes actually decode as an image; this guards
against an og:image URL that points at a 404 HTML page or an
image/svg+xml (which pypdf wouldn't accept anyway).
"""
from __future__ import annotations

import base64
import io
import json
import logging
import re
from typing import Any
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# Same 10 MB cap the manual upload uses. Recipe hero images at sane
# CDN settings are <500 KB; the cap is for safety.
MAX_IMAGE_BYTES = 10 * 1024 * 1024

# Mime types we'll persist. SVG is excluded — Pillow can't render
# vectors and the recipe card uses background-image for the photo,
# which doesn't handle SVGs well.
_SUPPORTED_MIMES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
}

# Tracking-pixel + icon thresholds. Anything strictly smaller in
# every dimension than this is dropped — recipe heroes are routinely
# ≥400px on the long edge.
_MIN_HERO_DIM = 200


# ---------------------------------------------------------------------------
# Common helpers
# ---------------------------------------------------------------------------

def _content_type_to_mime(ct: str | None) -> str | None:
    if not ct:
        return None
    base = ct.split(";", 1)[0].strip().lower()
    if base == "image/jpg":
        base = "image/jpeg"
    return base if base in _SUPPORTED_MIMES else None


def _looks_like_image(data: bytes) -> str | None:
    """Validate via Pillow's magic-byte sniff. Returns the detected
    mime on success, None if Pillow couldn't open the bytes (HTML
    served at an og:image URL, broken file, SVG, etc)."""
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover - Pillow ships via qrcode[pil]
        return None
    try:
        with Image.open(io.BytesIO(data)) as img:
            img.verify()
            fmt = (img.format or "").lower()
    except Exception:
        return None
    return {
        "jpeg": "image/jpeg",
        "jpg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "gif": "image/gif",
    }.get(fmt)


async def _download_image(url: str) -> tuple[bytes, str] | None:
    """Fetch an http(s) URL, enforce the size cap, sniff the mime.
    Returns (bytes, mime) on success or None on any failure."""
    try:
        async with httpx.AsyncClient(
            timeout=15.0,
            follow_redirects=True,
            headers={
                # Some CDNs reject anonymous fetches; spoof a real UA.
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                "Accept": "image/*",
            },
        ) as client:
            r = await client.get(url)
            if r.status_code >= 400:
                logger.debug("Image fetch %s failed: %d", url, r.status_code)
                return None
            if len(r.content) > MAX_IMAGE_BYTES:
                logger.debug("Image fetch %s too large: %d", url, len(r.content))
                return None
            mime = _content_type_to_mime(r.headers.get("content-type"))
            # Trust the byte-sniff over the header — CDNs frequently
            # serve `Content-Type: application/octet-stream` for hot-
            # linked images.
            sniffed = _looks_like_image(r.content)
            if not sniffed:
                return None
            return r.content, sniffed or mime or "image/jpeg"
    except httpx.HTTPError as e:
        logger.debug("Image fetch %s errored: %s", url, e)
        return None


def _decode_data_uri(data_uri: str) -> tuple[bytes, str] | None:
    """`data:image/jpeg;base64,…` → (bytes, mime). Returns None on
    parse failure or oversized payload."""
    m = re.match(r"data:([^;,]+)(;base64)?,(.*)", data_uri, re.DOTALL)
    if not m:
        return None
    mime = m.group(1).strip().lower()
    if mime == "image/jpg":
        mime = "image/jpeg"
    if mime not in _SUPPORTED_MIMES:
        return None
    payload = m.group(3)
    try:
        if m.group(2):
            data = base64.b64decode(payload, validate=False)
        else:
            from urllib.parse import unquote_to_bytes
            data = unquote_to_bytes(payload)
    except Exception:
        return None
    if len(data) > MAX_IMAGE_BYTES:
        return None
    if not _looks_like_image(data):
        return None
    return data, mime


# ---------------------------------------------------------------------------
# HTML / URL extraction
# ---------------------------------------------------------------------------

def _pick_image_candidates(
    soup: BeautifulSoup, base_url: str | None
) -> list[str]:
    """Return image URLs (or data: URIs) in priority order. Caller
    walks the list and stops at the first one that resolves to a
    usable image."""
    candidates: list[str] = []
    seen: set[str] = set()

    def add(u: str | None) -> None:
        if not u:
            return
        u = u.strip()
        if not u or u in seen:
            return
        # Skip cid: refs (email-attachment inline parts we don't have)
        # and relative/fragment-only references when no base url is set.
        if u.startswith(("cid:", "#")):
            return
        # Resolve relative URLs against the base if we have one.
        if base_url and not u.startswith(("http://", "https://", "data:")):
            try:
                u = urljoin(base_url, u)
            except Exception:
                return
        # After resolution: only http/https/data: are usable.
        if not u.startswith(("http://", "https://", "data:")):
            return
        seen.add(u)
        candidates.append(u)

    # 1. <meta property="og:image"> / twitter:image
    for prop in ("og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"):
        for tag in soup.find_all("meta", attrs={"property": prop}):
            add(tag.get("content"))
        for tag in soup.find_all("meta", attrs={"name": prop}):
            add(tag.get("content"))

    # 2. JSON-LD Recipe / Article with an "image" field. Schema.org
    #    "image" can be a string, a list of strings, or an ImageObject
    #    with `.url`. Handle all three.
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = script.string or script.text or ""
        try:
            data = json.loads(raw)
        except Exception:
            continue

        def _from_ld(node: Any) -> None:
            if isinstance(node, dict):
                img = node.get("image")
                if isinstance(img, str):
                    add(img)
                elif isinstance(img, list):
                    for entry in img:
                        if isinstance(entry, str):
                            add(entry)
                        elif isinstance(entry, dict):
                            add(entry.get("url") or entry.get("contentUrl"))
                elif isinstance(img, dict):
                    add(img.get("url") or img.get("contentUrl"))
                # Recurse into @graph / mainEntity for Schema.org pages
                # that wrap the recipe inside a Webpage / WebSite type.
                for k in ("@graph", "mainEntity"):
                    inner = node.get(k)
                    if isinstance(inner, (list, dict)):
                        _from_ld(inner)
            elif isinstance(node, list):
                for entry in node:
                    _from_ld(entry)

        _from_ld(data)

    # 3. Heuristic: every <img> in document order. We deliberately
    #    skip the strict "≥400px" filter here because real pages
    #    don't always have width/height attributes — we let the
    #    download path's byte sniff + dimension check from Pillow
    #    do the filtering instead.
    for img in soup.find_all("img"):
        src = img.get("src") or img.get("data-src") or img.get("data-original")
        if not src:
            continue
        # Strip obvious 1x1 tracking pixels declared inline.
        try:
            w = int(img.get("width") or 0)
            h = int(img.get("height") or 0)
        except ValueError:
            w = h = 0
        if (w and w < _MIN_HERO_DIM) and (h and h < _MIN_HERO_DIM):
            continue
        add(src)

    return candidates


async def _resolve_first_image(candidates: list[str]) -> tuple[bytes, str] | None:
    """Walk candidate URLs/data-URIs in priority order, return the
    first one that downloads + validates as a real image."""
    for u in candidates:
        if u.startswith("data:"):
            res = _decode_data_uri(u)
            if res:
                return res
            continue
        # Skip the obvious noise (favicons, social icons, tracker
        # pixels) before paying for the round-trip.
        lower = u.lower()
        if any(token in lower for token in (
            "favicon", "/sprite", "social-icon", "doubleclick", "pixel.gif",
            "tracker", "/analytics", "facebook.com/tr?",
        )):
            continue
        res = await _download_image(u)
        if res:
            # Sanity-check the decoded image's dimensions — drops
            # social-share icons that slip past the URL filter.
            try:
                from PIL import Image
                with Image.open(io.BytesIO(res[0])) as img:
                    w, h = img.size
                if max(w, h) < _MIN_HERO_DIM:
                    continue
            except Exception:
                # If Pillow re-open fails, _looks_like_image already
                # passed; fall through and accept.
                pass
            return res
    return None


async def extract_image_from_html(
    html: str, base_url: str | None = None
) -> tuple[bytes, str] | None:
    """og:image / JSON-LD / largest <img>. `base_url` is the page's
    URL when the HTML came from a URL fetch (so relative <img src>
    can be resolved). HTML-file uploads pass None — relative-only
    refs in a saved email aren't reachable anyway."""
    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception:
        return None
    candidates = _pick_image_candidates(soup, base_url)
    if not candidates:
        return None
    return await _resolve_first_image(candidates)


async def extract_image_from_url(url: str, html: str) -> tuple[bytes, str] | None:
    """URL-import variant — passes the page URL as the base for
    relative-link resolution."""
    return await extract_image_from_html(html, base_url=url)


# ---------------------------------------------------------------------------
# PDF extraction
# ---------------------------------------------------------------------------

def extract_image_from_pdf(pdf_bytes: bytes) -> tuple[bytes, str] | None:
    """pypdf's `page.images` over page 0. Pick the largest by area —
    recipe heroes sit at the top of typical recipe PDFs and dwarf the
    rating-stars and brand-mark vector glyphs.

    No PyMuPDF dependency: pypdf 4.x decodes embedded JPEG / PNG /
    Flate streams to bytes on its own. For PDFs whose images come
    through as something pypdf can't decode, we fall back gracefully
    to None — the recipe still imports, just without an image."""
    try:
        from pypdf import PdfReader
    except ImportError:  # pragma: no cover
        return None
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as e:
        logger.debug("PDF parse for image extraction failed: %s", e)
        return None
    if not reader.pages:
        return None
    page = reader.pages[0]
    try:
        images = list(page.images)
    except Exception as e:  # pragma: no cover
        logger.debug("PDF image list failed: %s", e)
        return None
    if not images:
        return None

    best: tuple[int, bytes, str] | None = None  # (area, bytes, mime)
    for entry in images:
        data = getattr(entry, "data", None)
        if not data:
            continue
        if len(data) > MAX_IMAGE_BYTES:
            continue
        mime = _looks_like_image(data)
        if not mime:
            continue
        try:
            from PIL import Image
            with Image.open(io.BytesIO(data)) as img:
                w, h = img.size
        except Exception:
            continue
        if max(w, h) < _MIN_HERO_DIM:
            continue
        area = w * h
        if best is None or area > best[0]:
            best = (area, data, mime)

    if best is None:
        return None
    return best[1], best[2]
