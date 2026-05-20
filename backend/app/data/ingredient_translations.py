"""German → English translation table for USDA FoodData Central lookups.

USDA is English-only. The Nährwerte sheet's primary source group hits
USDA's Foundation + SR Legacy datasets — which are the cleanest source
of raw-ingredient nutrition we can hit without a contract — and that
requires us to ship the user's German query in English. This module
provides:

  - `INGREDIENT_TRANSLATIONS` — a curated map of the ~200 most common
    German cooking ingredients to USDA-friendly English terms. Built
    once, in code, so we don't pay an LLM round-trip on every search.
  - `translate(term)` — normalise + look up. Returns the English term,
    or the normalised German term as a fallback (USDA frequently
    matches Latin-rooted German words like "tomate" → "tomato"
    anyway, so a fallback search is cheap and sometimes hits).
  - `normalize(term)` — lowercase, strip articles, strip simple plural
    endings. Exposed separately so the cache key in the service can
    share the same canonical form.

Expanding the table is the preferred path over leaning on the optional
Ollama translation fallback (NUTRITION_TRANSLATE_FALLBACK), which adds
real latency to every miss.
"""
from __future__ import annotations

import re


# Articles we drop before lookup so "die Möhre" still matches "möhre".
_ARTICLES = {"der", "die", "das", "ein", "eine", "einer", "eines"}


# Common German plural endings we try to strip — longest first so
# "tomaten" → "tomate" (strip "n") wins over an incorrect "en"-strip
# that would yield "tomat". Applied ONLY as a second-pass fallback in
# translate() after the literal-term lookup, so canonical singulars
# in the table ("möhre", "tomate") still match without modification.
_PLURAL_TRIES: tuple[str, ...] = ("n", "en", "e", "s", "er")


# The curated map. Keys are normalised — lowercase, no articles, no
# plural endings. Values are USDA-friendly English search terms.
#
# Categories (informal, just for code review):
#   Vegetables · Fruit · Meat & poultry · Fish & seafood · Dairy & eggs ·
#   Grains, bread, pasta · Legumes & nuts · Herbs & spices · Fats & oils ·
#   Sweeteners & baking · Drinks · Misc cooking staples
INGREDIENT_TRANSLATIONS: dict[str, str] = {
    # ---------- Vegetables ----------
    "avocado": "avocado",
    "aubergine": "eggplant",
    "blumenkohl": "cauliflower",
    "bohne": "beans",
    "brokkoli": "broccoli",
    "champignon": "mushrooms white",
    "chicoree": "chicory",
    "chinakohl": "chinese cabbage",
    "erbse": "peas",
    "feldsalat": "lambs lettuce",
    "fenchel": "fennel",
    "grüne bohne": "green beans",
    "grünkohl": "kale",
    "gurke": "cucumber",
    "ingwer": "ginger root",
    "karotte": "carrots",
    "kartoffel": "potato",
    "knoblauch": "garlic",
    "kohl": "cabbage",
    "kohlrabi": "kohlrabi",
    "kopfsalat": "lettuce",
    "kürbis": "pumpkin",
    "lauch": "leeks",
    "mais": "corn sweet yellow",
    "mangold": "swiss chard",
    "möhre": "carrots",
    "okra": "okra",
    "paprika": "peppers sweet red raw",
    "petersilienwurzel": "parsley root",
    "pak choi": "bok choy",
    "pastinake": "parsnips",
    "pilz": "mushrooms",
    "porree": "leeks",
    "radieschen": "radishes",
    "rettich": "radish",
    "rosenkohl": "brussels sprouts",
    "rote beete": "beets",
    "rote bete": "beets",
    "rote zwiebel": "onions red",
    "rotkohl": "red cabbage",
    "rucola": "arugula",
    "salat": "lettuce",
    "sauerkraut": "sauerkraut",
    "schalotte": "shallots",
    "sellerie": "celery",
    "spargel": "asparagus",
    "spinat": "spinach",
    "stangensellerie": "celery stalks",
    "süßkartoffel": "sweet potato",
    "tomate": "tomatoes red",
    "weißkohl": "white cabbage",
    "wirsing": "savoy cabbage",
    "zucchini": "zucchini",
    "zuckermais": "corn sweet yellow",
    "zwiebel": "onion",

    # ---------- Fruit ----------
    "ananas": "pineapple",
    "apfel": "apples raw with skin",
    "aprikose": "apricots",
    "banane": "bananas raw",
    "birne": "pears raw",
    "blaubeere": "blueberries",
    "brombeere": "blackberries",
    "clementine": "clementines",
    "datteln": "dates medjool",
    "erdbeere": "strawberries",
    "feige": "figs",
    "granatapfel": "pomegranate raw",
    "grapefruit": "grapefruit raw",
    "heidelbeere": "blueberries",
    "himbeere": "raspberries",
    "honigmelone": "honeydew melon",
    "johannisbeere": "currants",
    "kirsche": "cherries sweet raw",
    "kiwi": "kiwifruit",
    "limette": "limes raw",
    "mandarine": "tangerines",
    "mango": "mango raw",
    "melone": "melon",
    "nektarine": "nectarines",
    "orange": "orange raw",
    "papaya": "papaya",
    "pfirsich": "peaches raw",
    "pflaume": "plums raw",
    "preiselbeere": "cranberries",
    "rosine": "raisins",
    "stachelbeere": "gooseberries",
    "trauben": "grapes red or green raw",
    "wassermelone": "watermelon raw",
    "weintraube": "grapes red or green raw",
    "zitrone": "lemon raw",

    # ---------- Meat & poultry ----------
    "bacon": "bacon cooked",
    "ente": "duck meat raw",
    "filet": "beef tenderloin raw",
    "gans": "goose meat raw",
    "hackfleisch": "ground beef raw",
    "hähnchen": "chicken raw",
    "hähnchenbrust": "chicken breast raw",
    "hähnchenkeule": "chicken leg raw",
    "hähnchenschenkel": "chicken thigh raw",
    "hühnchen": "chicken raw",
    "hühnerbrust": "chicken breast raw",
    "kalbfleisch": "veal raw",
    "lammfleisch": "lamb raw",
    "leber": "beef liver raw",
    "putenbrust": "turkey breast raw",
    "puter": "turkey raw",
    "pute": "turkey raw",
    "rinderhack": "ground beef raw",
    "rinderbraten": "beef roast raw",
    "rinderfilet": "beef tenderloin raw",
    "rindfleisch": "beef raw",
    "salami": "salami",
    "schinken": "ham",
    "schweinefleisch": "pork raw",
    "schweinefilet": "pork tenderloin raw",
    "speck": "bacon raw",
    "wurst": "sausage",

    # ---------- Fish & seafood ----------
    "barsch": "perch raw",
    "dorade": "sea bream raw",
    "forelle": "trout raw",
    "garnele": "shrimp raw",
    "hering": "herring raw",
    "kabeljau": "cod raw",
    "krabbe": "crab raw",
    "lachs": "salmon atlantic raw",
    "makrele": "mackerel raw",
    "muschel": "mussels raw",
    "pulpo": "octopus raw",
    "rotbarsch": "redfish raw",
    "räucherlachs": "salmon smoked",
    "sardelle": "anchovy",
    "sardine": "sardines",
    "scampi": "shrimp raw",
    "scholle": "flounder raw",
    "seelachs": "pollock raw",
    "thunfisch": "tuna raw",
    "tintenfisch": "squid raw",
    "wolfsbarsch": "sea bass raw",
    "zander": "pike-perch raw",

    # ---------- Dairy & eggs ----------
    "butter": "butter unsalted",
    "buttermilch": "buttermilk",
    "creme fraiche": "creme fraiche",
    "ei": "eggs whole raw",
    "eier": "eggs whole raw",
    "eigelb": "egg yolk raw",
    "eiweiß": "egg white raw",
    "feta": "cheese feta",
    "frischkäse": "cream cheese",
    "gouda": "cheese gouda",
    "hüttenkäse": "cheese cottage",
    "joghurt": "yogurt plain whole milk",
    "kefir": "kefir",
    "magerquark": "quark low fat",
    "milch": "milk whole",
    "mozzarella": "cheese mozzarella whole milk",
    "parmesan": "cheese parmesan",
    "quark": "quark",
    "ricotta": "cheese ricotta whole milk",
    "sahne": "cream heavy",
    "saure sahne": "sour cream",
    "schlagsahne": "cream whipped",
    "ziegenkäse": "cheese goat",

    # ---------- Grains, bread, pasta ----------
    "baguette": "bread french",
    "brötchen": "rolls white",
    "brot": "bread whole wheat",
    "bulgur": "bulgur",
    "couscous": "couscous cooked",
    "dinkel": "spelt grain",
    "haferflocken": "oats",
    "hirse": "millet",
    "knäckebrot": "bread crispbread rye",
    "linguine": "pasta cooked",
    "mais": "corn flour whole grain",
    "mehl": "wheat flour all purpose",
    "müsli": "muesli",
    "naan": "bread naan",
    "nudeln": "pasta cooked",
    "pizzateig": "pizza dough",
    "polenta": "cornmeal",
    "quinoa": "quinoa cooked",
    "reis": "rice white long grain cooked",
    "roggenbrot": "bread rye",
    "roggenmehl": "rye flour medium",
    "spaghetti": "spaghetti cooked",
    "tortilla": "tortilla wheat flour",
    "toastbrot": "bread white",
    "vollkornbrot": "bread whole wheat",
    "vollkornmehl": "whole wheat flour",
    "vollkornnudeln": "whole wheat pasta cooked",
    "weißbrot": "bread white",
    "weizenmehl": "wheat flour all purpose",

    # ---------- Legumes & nuts ----------
    "cashewkerne": "cashews",
    "cashews": "cashews",
    "erdnuss": "peanuts",
    "haselnuss": "hazelnuts",
    "kichererbsen": "chickpeas cooked",
    "kidneybohnen": "kidney beans cooked",
    "kürbiskerne": "pumpkin seeds",
    "linsen": "lentils cooked",
    "macadamia": "macadamia nuts",
    "mandel": "almonds",
    "paranuss": "brazil nuts",
    "pinienkerne": "pine nuts",
    "pistazie": "pistachios",
    "schwarze bohne": "black beans cooked",
    "sesam": "sesame seeds",
    "sojabohne": "soybeans cooked",
    "sonnenblumenkerne": "sunflower seeds",
    "walnuss": "walnuts",
    "weiße bohne": "white beans cooked",

    # ---------- Herbs & spices ----------
    "basilikum": "basil fresh",
    "chili": "peppers hot chili red",
    "currypulver": "curry powder",
    "dill": "dill fresh",
    "estragon": "tarragon fresh",
    "kreuzkümmel": "cumin seed",
    "kümmel": "caraway seed",
    "lorbeer": "bay leaf",
    "majoran": "marjoram dried",
    "minze": "mint fresh",
    "muskat": "nutmeg ground",
    "oregano": "oregano dried",
    "paprikapulver": "paprika",
    "petersilie": "parsley fresh",
    "pfeffer": "pepper black",
    "rosmarin": "rosemary fresh",
    "safran": "saffron",
    "salbei": "sage fresh",
    "salz": "salt table",
    "schnittlauch": "chives fresh",
    "thymian": "thymes fresh",
    "vanille": "vanilla extract",
    "zimt": "cinnamon ground",

    # ---------- Fats & oils ----------
    "butterschmalz": "butter clarified",
    "kokosöl": "oil coconut",
    "leinöl": "oil flaxseed",
    "margarine": "margarine",
    "olivenöl": "oil olive",
    "rapsöl": "oil canola",
    "sesamöl": "oil sesame",
    "sonnenblumenöl": "oil sunflower",

    # ---------- Sweeteners & baking ----------
    "agavendicksaft": "agave syrup",
    "ahornsirup": "maple syrup",
    "backpulver": "baking powder",
    "hefe": "yeast",
    "honig": "honey",
    "kakao": "cocoa powder unsweetened",
    "natron": "baking soda",
    "puderzucker": "sugar powdered",
    "rohrzucker": "sugar brown",
    "schokolade": "chocolate dark",
    "zucker": "sugar white granulated",

    # ---------- Drinks ----------
    "apfelsaft": "apple juice",
    "kaffee": "coffee brewed",
    "orangensaft": "orange juice",
    "tee": "tea brewed",
    "wasser": "water",
    "wein": "wine table red",

    # ---------- Misc staples ----------
    "balsamico": "vinegar balsamic",
    "brühe": "broth chicken",
    "dijon-senf": "mustard dijon",
    "essig": "vinegar",
    "ketchup": "ketchup",
    "kokosmilch": "coconut milk canned",
    "mayonnaise": "mayonnaise",
    "olive": "olives",
    "passierte tomaten": "tomato sauce",
    "senf": "mustard prepared yellow",
    "sojasauce": "soy sauce",
    "tofu": "tofu firm",
    "tomatenmark": "tomato paste",
    "weinessig": "vinegar red wine",
}


def normalize(term: str) -> str:
    """Lowercase, strip articles, collapse spaces — does NOT touch the
    word stem. The table is keyed in canonical German singular form
    ("möhre", "tomate"), so plural-to-singular collapsing happens
    lazily inside translate() as a fallback (longest ending first to
    avoid mangling stems).
    """
    if not term:
        return ""
    s = term.strip().lower()
    s = re.sub(r"[\.,;:!?\"']", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if not s:
        return ""
    tokens = [t for t in s.split(" ") if t and t not in _ARTICLES]
    return " ".join(tokens)


def _depluralise_candidates(token: str) -> list[str]:
    """Yield plausible singular forms of a token by trying common
    German plural-ending strips. Order: longer endings first so
    "tomaten" -> "tomate" (strip "n") wins over "tomat" (strip "en").
    The original token is always included as the first candidate so
    a literal match on a singular form ("möhre") wins immediately.
    """
    out = [token]
    if len(token) <= 3:
        return out
    seen = {token}
    for end in sorted(_PLURAL_TRIES, key=len, reverse=True):
        if token.endswith(end) and len(token) - len(end) >= 3:
            cand = token[: -len(end)]
            if cand and cand not in seen:
                seen.add(cand)
                out.append(cand)
    return out


def translate(term: str) -> tuple[str, bool]:
    """Return (english_term, mapped) for a German ingredient name.

    `mapped=True` means we hit the curated table — the English term is
    a clean USDA-friendly query. `mapped=False` means we returned the
    normalised German term as a fallback; the caller may want to also
    run an Ollama translation if NUTRITION_TRANSLATE_FALLBACK is on.

    Lookup order:
      1. Full normalised string verbatim ("rote bete", "grüne bohne").
      2. Last-token verbatim ("frische möhre" → "möhre").
      3. Full string with the last token de-pluralised
         ("rote zwiebeln" → "rote zwiebel", "tomaten" → "tomate").
      4. Last-token de-pluralised ("möhren" → "möhre").
    """
    norm = normalize(term)
    if not norm:
        return "", False
    if norm in INGREDIENT_TRANSLATIONS:
        return INGREDIENT_TRANSLATIONS[norm], True
    tokens = norm.split(" ")
    last = tokens[-1]
    if len(tokens) > 1 and last in INGREDIENT_TRANSLATIONS:
        return INGREDIENT_TRANSLATIONS[last], True
    for cand in _depluralise_candidates(last)[1:]:
        if len(tokens) > 1:
            full = " ".join(tokens[:-1] + [cand])
            if full in INGREDIENT_TRANSLATIONS:
                return INGREDIENT_TRANSLATIONS[full], True
        if cand in INGREDIENT_TRANSLATIONS:
            return INGREDIENT_TRANSLATIONS[cand], True
    return norm, False
