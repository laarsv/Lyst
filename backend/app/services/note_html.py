"""HTML sanitisation + Markdown -> HTML conversion for the rich-text note
editor.

The frontend (TipTap) serialises notes as HTML and POSTs them straight
back. We can't trust client HTML, so every write goes through
`sanitize_note_html` which runs bleach with the allowlist below.

The allowlist matches the TipTap extensions we ship (StarterKit + Link
+ TaskList + TaskItem + Image + Table + the custom WikiLink span). The
intent is "rich text Notion would render"; everything outside that
list — `<script>`, `<iframe>`, event-handler attributes, inline styles
that could exfiltrate state — is stripped silently. Bleach normalises
the output, so a stray `<b>` will round-trip as `<b>`, but anything
attribute-shaped that we don't whitelist is dropped.

`markdown_to_html` is used by the one-shot migration script (alembic
0017 / scripts/migrate_notes_to_html.py) to convert pre-existing
Markdown content. It handles wikilinks (`[[Title]]`) and GFM task
lists explicitly — markdown-it-py doesn't ship a wikilink rule, and
the task-list plugin's output needs the same shape TipTap expects.
"""
from __future__ import annotations

import re

import bleach
from bleach.css_sanitizer import CSSSanitizer
from markdown_it import MarkdownIt
from mdit_py_plugins.tasklists import tasklists_plugin


# ---------------------------------------------------------------------------
# HTML allowlist
# ---------------------------------------------------------------------------

# Element names we accept. Anything not in here is stripped entirely
# (bleach `strip=True`). Headings, lists, basic inline marks, links,
# code, blockquote, tables, images, a generic `span` for wikilinks +
# inline marks, `<mark>` for the Highlight extension, `input` for
# task-list checkboxes.
ALLOWED_TAGS = frozenset(
    [
        "p",
        "br",
        "hr",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "strong",
        "em",
        "u",
        "s",
        "mark",  # Highlight extension
        "code",
        "pre",
        "a",
        "img",
        "ul",
        "ol",
        "li",
        "blockquote",
        "table",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "td",
        "th",
        "span",
        "div",  # TipTap occasionally emits div wrappers around tables / code blocks
        "input",  # task-list checkboxes only (gated by attribute filter below)
        "details",  # collapsible block
        "summary",  # title row of a <details>
    ]
)


def _allow_a_attrs(tag: str, name: str, value: str) -> bool:
    if name in ("href", "title"):
        # Bleach already ran its own URL protocol filter on href; we just
        # gate the attribute name itself.
        return True
    if name == "rel":
        # Permit the standard noopener combo (we'll also force it below).
        return True
    if name == "target":
        return value in ("_blank", "_self")
    if name == "data-wikilink":
        return True
    return False


def _allow_img_attrs(tag: str, name: str, value: str) -> bool:
    if name in ("src", "alt", "title"):
        return True
    if name in ("width", "height"):
        return value.isdigit()
    return False


def _allow_input_attrs(tag: str, name: str, value: str) -> bool:
    """Only checkbox inputs (for GFM task lists). All other input types
    are dropped because bleach removes attributes that fail this check
    and an `<input>` without `type` defaults to text, which we don't
    want exposed in notes."""
    if name == "type":
        return value == "checkbox"
    if name in ("checked", "disabled"):
        # Boolean attrs may arrive as "", "checked", or "true"; accept any.
        return True
    if name in ("data-checked", "data-type"):
        # TipTap's TaskItem serialises with these.
        return True
    return False


def _allow_li_attrs(tag: str, name: str, value: str) -> bool:
    # TipTap task-list items carry `data-type="taskItem"` and
    # `data-checked="true|false"`. After the alembic 0018 task layer
    # they also carry `data-task-id="<digits>"` pointing at a row in
    # the task_items table — bleach gates the id to integers so a
    # paste from outside can't forge a fake reference.
    if name in ("data-type", "data-checked"):
        return True
    if name == "data-task-id":
        return value.isdigit()
    if name == "class":
        return value in ("task-list-item", "task-list-item checked")
    return False


def _allow_ul_attrs(tag: str, name: str, value: str) -> bool:
    if name == "data-type":
        # `data-type="taskList"` on the wrapper.
        return value == "taskList"
    if name == "class":
        return value in ("contains-task-list",)
    return False


def _allow_span_attrs(tag: str, name: str, value: str) -> bool:
    # Wikilink markup (custom TipTap extension):
    #   <span data-wikilink="<title>">Title</span>
    if name == "data-wikilink":
        return True
    # User-mention markup (custom Mention extension):
    #   <span data-mention="<user-id>">@Name</span>
    # The value must be a positive integer — anything else is dropped
    # so a paste from another app can't forge fake mentions.
    if name == "data-mention":
        return value.isdigit()
    # TextStyle + Color extension serialises text colour as
    # <span style="color: …">; CSSSanitizer (configured below) gates
    # which CSS properties survive.
    if name == "style":
        return True
    return False


def _allow_mark_attrs(tag: str, name: str, value: str) -> bool:
    # Highlight extension serialises as <mark style="background-color: …">.
    if name == "style":
        return True
    return False


def _allow_text_block_attrs(tag: str, name: str, value: str) -> bool:
    """For paragraphs + headings — the TextAlign extension emits inline
    `style="text-align: …"`. The CSS allowlist below restricts which
    property values can survive."""
    if name == "style":
        return True
    if name == "class":
        return True
    return False


def _allow_table_cell_attrs(tag: str, name: str, value: str) -> bool:
    # TipTap's Table extension uses colspan/rowspan/colwidth on cells.
    if name in ("colspan", "rowspan"):
        return value.isdigit() and 1 <= int(value) <= 100
    if name == "colwidth":
        # Comma-separated list of integers — TipTap stores per-column
        # widths when the user resizes. Strict numeric check.
        return all(part.strip().isdigit() for part in value.split(",") if part.strip())
    if name in ("data-type", "data-colwidth"):
        return True
    return False


# Per-tag attribute filter. Bleach calls the filter for each (tag, name,
# value) and drops the attribute if the filter returns falsy.
ALLOWED_ATTRIBUTES = {
    "a": _allow_a_attrs,
    "img": _allow_img_attrs,
    "input": _allow_input_attrs,
    "li": _allow_li_attrs,
    "ul": _allow_ul_attrs,
    "span": _allow_span_attrs,
    "mark": _allow_mark_attrs,
    # Paragraphs and headings carry the TextAlign extension's inline
    # `style="text-align: …"`. CSSSanitizer below scrubs the value to
    # left/center/right/justify only.
    "p": _allow_text_block_attrs,
    "h1": _allow_text_block_attrs,
    "h2": _allow_text_block_attrs,
    "h3": _allow_text_block_attrs,
    "h4": _allow_text_block_attrs,
    "h5": _allow_text_block_attrs,
    "h6": _allow_text_block_attrs,
    "table": ["class"],
    "thead": ["class"],
    "tbody": ["class"],
    "tr": ["class"],
    "td": _allow_table_cell_attrs,
    "th": _allow_table_cell_attrs,
    "pre": ["class"],  # syntax-highlight class survives
    "code": ["class"],  # ditto
    "div": ["class", "data-type"],
    # <details open> serialises the toggle state; <summary> needs no
    # attributes but bleach drops the element entirely if there's no
    # whitelist entry — empty list keeps it tag-only.
    "details": ["open"],
    "summary": [],
}

# URL protocols allowed in `href` / `src`. `lyst-note` was the legacy
# wikilink scheme — we still accept it but the new wikilink markup
# doesn't use href at all, so this is purely defensive for pre-migration
# leftover anchors.
ALLOWED_PROTOCOLS = frozenset(["http", "https", "mailto", "tel", "lyst-note"])

# CSS sanitiser — narrow allowlist of inline-style properties the
# TipTap extensions we ship actually emit:
#   - TextStyle + Color  → `color`
#   - Highlight          → `background-color`
#   - TextAlign          → `text-align`
# Anything else (font, position, display, …) gets stripped before the
# `style=""` attribute lands back on the element. A paste from Word
# therefore can't sneak in 12-point Calibri or absolute positioning.
_CSS_SANITIZER = CSSSanitizer(
    allowed_css_properties=["color", "background-color", "text-align"],
)


def sanitize_note_html(html: str | None) -> str:
    """Pass user-supplied HTML through bleach with our strict allowlist.
    Returns the cleaned string, or "" for None / empty input.

    Idempotent: passing the output back through this function yields the
    same string (bleach is stable on its own output). Safe to call on
    save, on read, and during migration."""
    if not html:
        return ""
    cleaned = bleach.clean(
        html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        css_sanitizer=_CSS_SANITIZER,
        strip=True,
        strip_comments=True,
    )
    # Force rel="noopener noreferrer" on every <a target="_blank">. Bleach
    # doesn't enforce that on its own, and we don't want note content
    # opening tabs that can `window.opener` us.
    return _harden_target_blank(cleaned)


_TARGET_BLANK_RE = re.compile(
    r'(<a\b[^>]*\btarget="_blank"[^>]*)>',
    re.IGNORECASE,
)


def _harden_target_blank(html: str) -> str:
    def repl(m: re.Match[str]) -> str:
        opening = m.group(1)
        if 'rel=' in opening.lower():
            return opening + '>'
        return opening + ' rel="noopener noreferrer">'

    return _TARGET_BLANK_RE.sub(repl, html)


# ---------------------------------------------------------------------------
# Markdown -> HTML conversion (one-shot migration helper)
# ---------------------------------------------------------------------------

# `[[Title]]` — same regex as the old remarkWikilinks plugin used. We
# preprocess these into a placeholder that survives markdown rendering,
# then swap them back to <span data-wikilink="…">…</span> on the output.
_WIKILINK_PLACEHOLDER_PREFIX = "\x01wikilink\x01"
_WIKILINK_PLACEHOLDER_SUFFIX = "\x01endwikilink\x01"
_WIKILINK_RE = re.compile(r"\[\[([^\]\n]+)\]\]")


def _build_renderer() -> MarkdownIt:
    md = MarkdownIt("gfm-like", {"linkify": True, "html": False})
    md.use(tasklists_plugin, enabled=True)
    return md


_MD = _build_renderer()


def markdown_to_html(md_source: str) -> str:
    """Convert a single note's markdown body to TipTap-compatible HTML.

    Wikilinks: `[[Title]]` -> `<span data-wikilink="Title">Title</span>`.
    Task lists: `- [ ] thing` and `- [x] thing` are rendered by the
        tasklists plugin into `<ul class="contains-task-list"><li
        class="task-list-item"><input type="checkbox" disabled> thing
        </li></ul>`, which we adapt to TipTap's expected shape (a
        `data-type="taskList"` ul + `data-type="taskItem"
        data-checked="true|false"` li). Code blocks, tables, images
        round-trip natively through commonmark+gfm.

    The output is then passed through `sanitize_note_html` so the
    migration writes the same shape that future user saves will write.
    """
    if not md_source:
        return ""

    # Wikilinks: stash as sentinel tokens BEFORE markdown processes the
    # `[` and `]` (otherwise commonmark may try to parse them as link
    # labels and the title text gets mangled).
    def _stash(m: re.Match[str]) -> str:
        title = m.group(1).strip()
        return _WIKILINK_PLACEHOLDER_PREFIX + title + _WIKILINK_PLACEHOLDER_SUFFIX

    stashed = _WIKILINK_RE.sub(_stash, md_source)

    raw_html = _MD.render(stashed)

    # Swap placeholders back to wikilink spans.
    def _unstash(m: re.Match[str]) -> str:
        title = m.group(1)
        # HTML-escape the title in the visible text; the data-wikilink
        # attribute survives bleach unmangled.
        safe = (
            title.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
        )
        return f'<span data-wikilink="{safe}">{safe}</span>'

    raw_html = re.sub(
        re.escape(_WIKILINK_PLACEHOLDER_PREFIX)
        + r"(.+?)"
        + re.escape(_WIKILINK_PLACEHOLDER_SUFFIX),
        _unstash,
        raw_html,
        flags=re.DOTALL,
    )

    # Reshape the markdown-it tasklists output to the shape TipTap's
    # TaskList / TaskItem extensions expect:
    #   plugin: <ul><li class="task-list-item"><input ...> Item</li></ul>
    #   tiptap: <ul data-type="taskList"><li data-type="taskItem"
    #              data-checked="true|false"><p>Item</p></li></ul>
    # We use BeautifulSoup rather than regex because the plugin's exact
    # attribute ordering and quoting isn't part of its public contract.
    raw_html = _reshape_task_lists(raw_html)

    return sanitize_note_html(raw_html)


def _reshape_task_lists(html: str) -> str:
    """Walk every `<li class="task-list-item">` in the rendered HTML and
    rewrite it (plus its parent `<ul>`) into TipTap's task-list shape.

    Empty input or no task-lists: returns the input unchanged."""
    if "task-list-item" not in html:
        return html
    from bs4 import BeautifulSoup  # local import — only needed during migration

    soup = BeautifulSoup(html, "html.parser")
    for li in soup.find_all("li", class_="task-list-item"):
        checkbox = li.find("input", attrs={"type": "checkbox"})
        checked = False
        if checkbox is not None:
            # `checked` may be present as boolean attr ("" / "checked") or
            # absent entirely. BS4 returns None when missing, "" or value
            # otherwise.
            checked = checkbox.has_attr("checked")
            checkbox.decompose()
        # Mark the li for TipTap and wrap any direct text in a <p> so
        # TipTap's TaskItem renders it as the standard "item label".
        li.attrs.clear()
        li["data-type"] = "taskItem"
        li["data-checked"] = "true" if checked else "false"
        # Walk direct text children and wrap them. Anything already in a
        # block element (p, ul, ol, code, pre…) is left alone.
        new_p_contents = []
        for child in list(li.contents):
            if getattr(child, "name", None) is None:
                # NavigableString — collect into the wrapping <p>.
                text = str(child).strip("\n")
                if text:
                    new_p_contents.append(text)
                child.extract()
            elif child.name in ("strong", "em", "u", "s", "a", "code", "span", "br"):
                new_p_contents.append(child.extract())
        if new_p_contents:
            p = soup.new_tag("p")
            for piece in new_p_contents:
                p.append(piece)
            # Insert the wrapper at the start so it precedes any nested
            # block elements (sub-lists) that were left in place.
            li.insert(0, p)
        # Promote the parent <ul> to data-type="taskList" once.
        parent_ul = li.find_parent("ul")
        if parent_ul is not None and parent_ul.get("data-type") != "taskList":
            parent_ul["data-type"] = "taskList"
            # Drop any leftover class so the bleach allowlist doesn't have
            # to know about it.
            if "class" in parent_ul.attrs:
                del parent_ul.attrs["class"]
    return str(soup)


# ---------------------------------------------------------------------------
# Plain-text snippet generation (note-card preview)
# ---------------------------------------------------------------------------

# Tags we drop entirely along with their contents — code blocks dominate
# a note's visual when they appear in a 120-char snippet (one fence and
# the snippet is just shell commands), and <img>/<input> have no useful
# text content for a preview. The <pre> case catches code blocks plus
# any other pre-formatted block.
_SKIP_TAGS_AND_CONTENT = frozenset(["pre", "img", "input", "style", "script"])

# Block-level tags whose text content should be separated by a single
# space when concatenated, so paragraph + heading text doesn't run
# together as one word.
_BLOCK_TAGS = frozenset(
    [
        "p",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "li",
        "blockquote",
        "tr",
        "td",
        "th",
        "div",
        "summary",
        "br",
    ]
)

_SNIPPET_MAX = 120
_WHITESPACE_RE = re.compile(r"\s+")


def html_to_snippet(html: str | None, *, max_length: int = _SNIPPET_MAX) -> str:
    """Turn a TipTap-serialised HTML note body into a clean preview line.

    Rules:
      - Strip every tag, keeping only the visible text.
      - Drop the content of <pre>, <img>, <input>, <style>, <script>
        wholesale — code blocks + asset placeholders make for noisy
        previews and rarely capture the note's gist.
      - Wikilink / mention chips render their visible text (e.g.
        "Anna" / "Mein Plan"), since that IS the readable label.
      - Block elements get a single space between their text content
        so `<h1>Title</h1><p>Body</p>` becomes "Title Body" rather
        than "TitleBody".
      - Collapse all whitespace to single spaces, trim ends.
      - Truncate to `max_length` with an ellipsis when longer.

    Empty / whitespace-only input -> "" (the caller decides how to
    render the empty case). Idempotent on plain text.
    """
    if not html:
        return ""
    # Plain text shortcut — saves the bs4 parse for the legacy
    # MARKDOWN content_format rows. Markdown's syntax markers ARE
    # readable enough as preview noise, so we just collapse
    # whitespace and let the strip below remove the heading hashes.
    if "<" not in html:
        return _truncate(_collapse(_strip_markdown_markers(html)), max_length)

    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")

    # Remove skip-tag subtrees up front so the walk below doesn't
    # have to special-case them at every depth.
    for tag_name in _SKIP_TAGS_AND_CONTENT:
        for el in soup.find_all(tag_name):
            el.decompose()

    parts: list[str] = []

    def visit(node) -> None:
        # NavigableString — emit the text directly. We don't strip
        # here because intra-line whitespace (e.g. a space between
        # two inline marks) matters; the final _collapse() pass
        # normalises everything.
        if isinstance(node, str):
            parts.append(str(node))
            return
        name = getattr(node, "name", None)
        if name is None:
            return
        # Block boundary — prepend a space so adjacent blocks don't
        # smush together. The leading space is fine; _collapse()
        # eats consecutive spaces.
        is_block = name in _BLOCK_TAGS
        if is_block:
            parts.append(" ")
        for child in node.children:
            visit(child)
        if is_block:
            parts.append(" ")

    for child in soup.children:
        visit(child)

    text = _collapse("".join(parts))
    return _truncate(text, max_length)


def _collapse(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def _truncate(text: str, max_length: int) -> str:
    if len(text) <= max_length:
        return text
    # Trim back to the last word boundary so the ellipsis doesn't
    # split mid-word. Fall back to the hard cut when there's no
    # space in the leading window (very long single word).
    cut = text[: max_length - 1]
    sp = cut.rfind(" ")
    if sp > max_length // 2:
        cut = cut[:sp]
    return cut.rstrip(" ,;:.-") + "…"


# Markdown-mark strip for the legacy MARKDOWN content_format case.
# Mirrors the old `note.content.replace(/[#*_>`-]/g, '')` heuristic
# the frontend used to apply, so the preview UX is identical across
# the transition window.
_MD_MARKER_RE = re.compile(r"[#*_>`~\-]")


def _strip_markdown_markers(text: str) -> str:
    return _MD_MARKER_RE.sub("", text)
