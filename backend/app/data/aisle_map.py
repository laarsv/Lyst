"""Static supermarket-aisle map for shopping-list sectioning.

Deliberately reuses the EXISTING SHOPPING category names (see
`category_service.CATEGORIES[ListType.SHOPPING]` and the frontend
`data/listCategories.ts` icon map) so recipe-derived items, the AI
categorizer, and manual re-categorisation all share one taxonomy and one
sectioned rendering. The merge tool / single-recipe copy fill `ListItem.category`
from this map instantly (no Ollama call); unknown ingredients fall to
"Sonstiges".

Lookup is normalisation-tolerant: it reuses `ingredient_translations.normalize`
(lowercase, strip articles + hyphen qualifier prefixes, collapse compound
hyphens) and a light German de-pluraliser, so "Die Tomaten", "Bio-Tomaten" and
"Tomate" all resolve to the same aisle. Frozen ("TK-…") and tinned
("… passiert") markers are detected on the raw name before normalisation
strips them.
"""
from __future__ import annotations

import re

from app.data.ingredient_translations import normalize

# Section names — MUST match the SHOPPING categories the rest of the app knows.
OBST_GEMUESE = "Obst & Gemüse"
MILCH = "Milchprodukte"
FLEISCH_FISCH = "Fleisch & Fisch"
TIEFKUEHL = "Tiefkühl"
BACKWAREN = "Backwaren"
TROCKEN = "Trockenwaren"
GETRAENKE = "Getränke"
SUESSES = "Süßes"
HYGIENE = "Hygiene"
SONSTIGES = "Sonstiges"

# Order = rough supermarket walk; "Sonstiges" always last. Drives section
# ordering in the merge preview and is exported for the frontend to mirror.
AISLE_ORDER = [
    OBST_GEMUESE,
    BACKWAREN,
    TROCKEN,
    MILCH,
    FLEISCH_FISCH,
    TIEFKUEHL,
    SUESSES,
    GETRAENKE,
    HYGIENE,
    SONSTIGES,
]

# Keyed by normalised, singular, lowercase core noun. De-pluralisation at
# lookup time means we mostly store the singular; a few irregular (umlaut)
# plurals are listed explicitly.
_AISLE: dict[str, str] = {}


def _add(section: str, *names: str) -> None:
    for n in names:
        _AISLE[n] = section


_add(
    OBST_GEMUESE,
    "tomate", "cherrytomate", "kirschtomate", "zwiebel", "frühlingszwiebel",
    "rote zwiebel", "schalotte", "knoblauch", "lauch", "porree", "möhre",
    "karotte", "kartoffel", "süßkartoffel", "paprika", "gurke", "salat",
    "kopfsalat", "feldsalat", "rucola", "spinat", "mangold", "brokkoli",
    "blumenkohl", "rosenkohl", "zucchini", "aubergine", "kürbis", "champignon",
    "pilz", "sellerie", "fenchel", "rettich", "radieschen", "rote bete",
    "rote beete", "rotebete", "avocado", "mais", "erbse", "bohne",
    "grüne bohne", "zuckerschote", "spargel", "kohlrabi", "weißkohl",
    "rotkohl", "wirsing", "chinakohl", "ingwer", "chili", "peperoni",
    "limette", "zitrone", "orange", "apfel", "äpfel", "birne", "banane",
    "mango", "ananas", "kiwi", "traube", "weintraube", "erdbeere",
    "himbeere", "heidelbeere", "blaubeere", "brombeere", "beere",
    "petersilie", "basilikum", "schnittlauch", "koriander", "dill",
    "rosmarin", "thymian", "oregano", "minze", "salbei", "kresse",
)

_add(
    MILCH,
    "milch", "vollmilch", "buttermilch", "hafermilch", "haferdrink", "sojamilch",
    "mandelmilch", "kokosmilch getränk", "butter", "margarine", "sahne",
    "schlagsahne", "saure sahne", "schmand", "crème fraîche", "creme fraiche",
    "frischkäse", "quark", "magerquark", "joghurt", "naturjoghurt", "skyr",
    "käse", "gouda", "emmentaler", "edamer", "parmesan", "mozzarella", "feta",
    "hüttenkäse", "mascarpone", "ricotta", "ei", "eier", "hähnchenei",
    "halloumi", "raclette", "bergkäse", "harzer", "camembert", "brie",
)

_add(
    FLEISCH_FISCH,
    "hähnchen", "hähnchenbrust", "hähnchenschenkel", "hühnchen", "huhn",
    "pute", "putenbrust", "ente", "hackfleisch", "hack", "rinderhack",
    "gemischtes hack", "rind", "rindfleisch", "steak", "gulasch", "schwein",
    "schweinefleisch", "schweinefilet", "schnitzel", "kotelett", "lamm",
    "speck", "bacon", "schinken", "kochschinken", "salami", "wurst",
    "bratwurst", "mettwurst", "chorizo", "lyoner", "leberkäse",
    "lachs", "räucherlachs", "thunfisch", "forelle", "kabeljau", "dorsch",
    "seelachs", "scholle", "hering", "makrele", "garnele", "shrimp",
    "scampi", "tintenfisch", "muschel",
)

_add(
    BACKWAREN,
    "brot", "vollkornbrot", "toastbrot", "toast", "brötchen", "semmel",
    "baguette", "ciabatta", "fladenbrot", "wrap", "tortilla", "pita",
    "croissant", "brezel", "knäckebrot", "mehl", "weizenmehl", "dinkelmehl",
    "vollkornmehl", "zucker", "puderzucker", "brauner zucker", "vanillezucker",
    "backpulver", "natron", "hefe", "trockenhefe", "speisestärke",
    "stärke", "semmelbrösel", "paniermehl", "vanille", "vanilleextrakt",
    "marzipan", "kakao", "kakaopulver",
)

_add(
    TROCKEN,
    "nudel", "spaghetti", "pasta", "penne", "fusilli", "tagliatelle",
    "lasagneplatte", "lasagne", "spätzle", "reis", "basmatireis",
    "risottoreis", "couscous", "bulgur", "quinoa", "polenta", "haferflocken",
    "müsli", "cornflakes", "linse", "rote linse", "kichererbse",
    "kidneybohne", "weiße bohne", "schwarze bohne", "öl", "olivenöl",
    "sonnenblumenöl", "rapsöl", "sesamöl", "essig", "balsamico", "aceto",
    "brühe", "gemüsebrühe", "hühnerbrühe", "fond", "salz", "meersalz",
    "pfeffer", "paprikapulver", "currypulver", "curry", "kreuzkümmel",
    "kümmel", "muskat", "zimt", "chiliflocken", "gewürz", "senf",
    "ketchup", "mayonnaise", "mayo", "sojasauce", "sojasoße", "fischsauce",
    "tomatenmark", "passierte tomate", "gehackte tomate", "tomate aus der dose",
    "kokosmilch", "kokosnussmilch", "erdnussbutter", "tahini", "pesto",
    "oliven", "olive", "kapern", "trockentomate", "getrocknete tomate",
    "nuss", "walnuss", "haselnuss", "mandel", "cashew", "pinienkern",
    "sonnenblumenkern", "kürbiskern", "sesam", "rosine", "honig",
)

_add(
    TIEFKUEHL,
    "pommes", "blätterteig", "blätterteig tk", "pizza", "tk-gemüse",
    "tk-spinat", "tk-erbsen", "tk-beeren",
)

_add(
    GETRAENKE,
    "wasser", "mineralwasser", "sprudel", "saft", "orangensaft", "apfelsaft",
    "multivitaminsaft", "wein", "rotwein", "weißwein", "kochwein", "sekt",
    "prosecco", "bier", "cola", "limonade", "tee", "kaffee", "espresso",
)

_add(
    SUESSES,
    "schokolade", "zartbitterschokolade", "vollmilchschokolade",
    "schokoraspel", "schokostreusel", "nutella", "nuss-nougat-creme",
    "keks", "plätzchen", "marmelade", "konfitüre", "gelee", "gummibärchen",
    "bonbon", "chips", "cracker", "popcorn",
)

# Raw-name markers checked before normalisation strips them.
_FROZEN_RE = re.compile(r"\btk[\s-]|tiefkühl|tiefgekühlt|tiefgefroren|gefroren", re.I)
_TINNED_RE = re.compile(r"passiert|aus der dose|konserve", re.I)

# Trailing German plural endings, longest first so we don't over-strip.
_PLURAL_ENDINGS = ("nen", "en", "er", "n", "e", "s")


def _singular_variants(word: str) -> list[str]:
    out: list[str] = []
    for suf in _PLURAL_ENDINGS:
        if word.endswith(suf) and len(word) - len(suf) >= 3:
            out.append(word[: -len(suf)])
    return out


def _candidates(name: str) -> list[str]:
    """Ordered match candidates: the full normalised phrase first (so
    multi-word specifics like "passierte tomate" win over the bare noun),
    then the core (last) token, each with singular variants."""
    norm = normalize(name)
    if not norm:
        return []
    seen: set[str] = set()
    ordered: list[str] = []

    def push(c: str) -> None:
        if c and c not in seen:
            seen.add(c)
            ordered.append(c)

    push(norm)
    for v in _singular_variants(norm):
        push(v)
    tokens = norm.split(" ")
    if len(tokens) > 1:
        last = tokens[-1]
        push(last)
        for v in _singular_variants(last):
            push(v)
    return ordered


def aisle_for(name: str) -> str:
    """Best-effort supermarket aisle for an ingredient name. Always returns a
    known section; unknowns → "Sonstiges"."""
    raw = name or ""
    if _FROZEN_RE.search(raw):
        return TIEFKUEHL
    if _TINNED_RE.search(raw):
        return TROCKEN
    for c in _candidates(raw):
        hit = _AISLE.get(c)
        if hit:
            return hit
    return SONSTIGES
