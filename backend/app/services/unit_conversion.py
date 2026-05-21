"""Convert recipe-ingredient `(quantity, unit, name)` triples into grams.

The recipe-nutrition aggregator needs grams to scale per-100g values
into a per-ingredient contribution. Real cookbook units cover three
shapes:

  - **Mass** ("g", "kg", "mg") — direct factor.
  - **Volume** ("ml", "l", "EL", "TL", "Tasse", "Prise", …) — we
    assume water density (1 g/ml). Most cookbook ingredients given
    in spoons are flour, sugar, salt, or sauces where 1 g/ml is
    closer than skipping them entirely. Oils land ~8 % too heavy;
    we accept that as the price of having any number at all.
  - **Pieces** ("Stk", "Stück") — these need an average weight per
    *item*, which depends on what the ingredient IS. We ship a small
    curated table of the ~40 most common single-piece ingredients
    ("Ei" → 60 g, "Zwiebel" → 110 g). Misses return None so the
    aggregator excludes them from the sum AND counts them as
    missing in the coverage hint.

Unknown / unconvertible inputs return `None` rather than 0 — the
caller can distinguish "couldn't convert" from "0 g of this".

Aliases (German + English shorthand) are folded to a canonical key.
The unit string is lowercased, stripped, and dots removed; "EL" and
"el" and "EL." all map to the same row.
"""
from __future__ import annotations

import re

from app.data.ingredient_translations import normalize


# ---------------------------------------------------------------------------
# Mass — direct gram factors
# ---------------------------------------------------------------------------
_MASS_FACTORS_G: dict[str, float] = {
    "g": 1.0,
    "gr": 1.0,
    "gramm": 1.0,
    "gramme": 1.0,
    "grams": 1.0,
    "gram": 1.0,
    "kg": 1000.0,
    "kilogramm": 1000.0,
    "mg": 0.001,
}


# ---------------------------------------------------------------------------
# Volume — converted to grams via 1 ml ≈ 1 g (water density default).
# ---------------------------------------------------------------------------
#
# Standard culinary equivalents:
#   1 EL  (Esslöffel / tbsp) ≈ 15 ml
#   1 TL  (Teelöffel  / tsp) ≈ 5 ml
#   1 Tasse (cup)            ≈ 240 ml
#   1 Prise                  ≈ 0.5 g (salt/spice — by mass, not volume)
#   1 Messerspitze (Msp)     ≈ 0.5 g
#   1 Schuss                 ≈ 10 g (a generous splash)
#   1 Spritzer               ≈ 3 g  (a small splash)
_VOLUME_FACTORS_G: dict[str, float] = {
    "ml": 1.0,
    "milliliter": 1.0,
    "cl": 10.0,
    "dl": 100.0,
    "l": 1000.0,
    "liter": 1000.0,
    "litre": 1000.0,
    # Spoons & cups
    "el": 15.0,
    "esslöffel": 15.0,
    "essloeffel": 15.0,
    "el.": 15.0,
    "tbsp": 15.0,
    "tl": 5.0,
    "teelöffel": 5.0,
    "teeloeffel": 5.0,
    "tl.": 5.0,
    "tsp": 5.0,
    "tasse": 240.0,
    "tassen": 240.0,
    "cup": 240.0,
    "cups": 240.0,
    # Pinches and dashes — already in grams; treated as volume entries
    # since they don't fit the piece/mass schemes cleanly.
    "prise": 0.5,
    "prisen": 0.5,
    "msp": 0.5,
    "msp.": 0.5,
    "messerspitze": 0.5,
    "spritzer": 3.0,
    "schuss": 10.0,
}


# ---------------------------------------------------------------------------
# Piece-based ingredients — average weight per item, keyed on the
# normalised ingredient name (lowercase, articles & qualifier prefixes
# stripped by ingredient_translations.normalize).
# ---------------------------------------------------------------------------
#
# Sources: rough culinary averages (USDA size grades, German
# supermarket SKUs). Off by ±20 % per individual item is acceptable;
# we're aiming for a per-portion total in the right ballpark, not lab
# accuracy. The table is intentionally small — only ingredients people
# actually count as "Stk". Sliced/grated/chopped versions stay out.
PIECE_WEIGHTS_G: dict[str, float] = {
    # Eggs & dairy units
    "ei": 60.0,
    "eier": 60.0,

    # Alliums
    "zwiebel": 110.0,
    "rote zwiebel": 110.0,
    "schalotte": 25.0,
    "frühlingszwiebel": 25.0,
    "lauchzwiebel": 25.0,
    "knoblauchzehe": 5.0,
    "zehe": 5.0,
    "knoblauch": 50.0,            # whole bulb
    "lauch": 200.0,                # one stalk
    "porree": 200.0,

    # Nightshades & gourds
    "tomate": 120.0,
    "cherrytomate": 12.0,
    "kirschtomate": 12.0,
    "datteltomate": 15.0,
    "paprika": 150.0,
    "spitzpaprika": 80.0,
    "chili": 10.0,
    "chilischote": 10.0,
    "aubergine": 300.0,
    "zucchini": 250.0,
    "gurke": 400.0,
    "salatgurke": 400.0,
    "kürbis": 1500.0,

    # Roots & tubers
    "karotte": 70.0,
    "möhre": 70.0,
    "kartoffel": 150.0,
    "süßkartoffel": 250.0,
    "rote bete": 200.0,
    "rote beete": 200.0,
    "pastinake": 150.0,
    "ingwer": 80.0,

    # Brassicas & leaves
    "brokkoli": 500.0,
    "blumenkohl": 600.0,
    "salat": 300.0,
    "kopfsalat": 300.0,
    "spitzkohl": 800.0,
    "rotkohl": 1000.0,
    "weißkohl": 1000.0,

    # Fruits & berries
    "apfel": 180.0,
    "banane": 120.0,
    "birne": 180.0,
    "zitrone": 100.0,
    "limette": 60.0,
    "orange": 200.0,
    "clementine": 80.0,
    "mandarine": 80.0,
    "mango": 250.0,
    "kiwi": 80.0,
    "avocado": 200.0,
    "pfirsich": 150.0,
    "nektarine": 140.0,
    "pflaume": 50.0,
    "aprikose": 50.0,
    "feige": 50.0,

    # Misc
    "champignon": 15.0,
    "pilz": 15.0,
    "brötchen": 60.0,
    "toastscheibe": 30.0,
    "scheibe brot": 35.0,
    "baguette": 250.0,
}


# Piece-units with a FIXED gram weight regardless of ingredient name.
# These are unambiguous: "Zehe" is always a garlic clove (~5 g), a
# "Scheibe" is roughly 30 g whether bread, cheese, or ham. Mapping
# here keeps "2 Zehen Knoblauch" from accidentally weighing two whole
# garlic bulbs.
_FIXED_PIECE_UNITS_G: dict[str, float] = {
    "zehe": 5.0,
    "zehen": 5.0,
    "scheibe": 30.0,
    "scheiben": 30.0,
    "blatt": 1.0,
    "blätter": 1.0,
    "blaetter": 1.0,
}

# Piece-units whose gram weight depends on WHICH ingredient is in
# pieces — we look the ingredient name up in PIECE_WEIGHTS_G. Misses
# return None (excluded from sum, counted as missing).
_NAME_DEPENDENT_PIECE_UNITS: frozenset[str] = frozenset({
    "stk", "stk.", "stück", "stueck", "st", "st.",
    "piece", "pieces", "pc", "pcs",
    "stange", "stangen",
    "knolle", "knollen",
    "kopf", "köpfe",
    "koepfe",
    "bund",
})


def _normalise_unit(unit: str | None) -> str:
    """Lowercase, drop trailing dot, strip whitespace. The aggregator
    accepts both 'EL' and 'el.' from cookbook text — same row."""
    if not unit:
        return ""
    u = unit.strip().lower()
    # Drop common decorations that don't change meaning
    u = re.sub(r"\s+", " ", u)
    return u


def convert_to_grams(
    quantity: float | int | None,
    unit: str | None,
    ingredient_name: str | None,
) -> float | None:
    """Best-effort conversion of `quantity × unit` for `ingredient_name`
    to grams. Returns None when the unit isn't recognised OR when a
    piece-based unit references an ingredient we don't have a weight
    for. The aggregator translates None into "skip from sum, count as
    missing for coverage".

    Examples:
      convert(200, 'g',  'Räucherlachs')     → 200
      convert(400, 'g',  'Spaghetti')         → 400
      convert(2,   'Stk', 'Lauch')             → 400 (table: 200/Stk)
      convert(1,   'EL',  'Kräuterfrischkäse')→ 15
      convert(1,   'Stk', 'Zwiebel')           → 110
      convert(1,   'Stk', 'Tante Käthes Gewürz') → None (no piece weight)
      convert(None, 'g',  'Salz')              → None
    """
    if quantity is None:
        return None
    try:
        q = float(quantity)
    except (TypeError, ValueError):
        return None
    if q < 0:
        return None

    u = _normalise_unit(unit)

    if u in _MASS_FACTORS_G:
        return q * _MASS_FACTORS_G[u]
    if u in _VOLUME_FACTORS_G:
        return q * _VOLUME_FACTORS_G[u]
    if u in _FIXED_PIECE_UNITS_G:
        return q * _FIXED_PIECE_UNITS_G[u]

    if u in _NAME_DEPENDENT_PIECE_UNITS or u == "":
        # No unit + a quantity often means "pieces" ("2 Eier" with
        # empty unit), so the piece path also runs for empty units —
        # but only when an ingredient name is given to look up.
        if not ingredient_name:
            return None
        name_norm = normalize(ingredient_name)
        if name_norm in PIECE_WEIGHTS_G:
            return q * PIECE_WEIGHTS_G[name_norm]
        # Last-token fallback for compound names ("kleine zwiebel"
        # collapses to "zwiebel" after normalise where possible).
        tokens = name_norm.split(" ")
        if len(tokens) > 1 and tokens[-1] in PIECE_WEIGHTS_G:
            return q * PIECE_WEIGHTS_G[tokens[-1]]
        return None

    # Anything else is unknown — caller treats this as a coverage miss.
    return None
