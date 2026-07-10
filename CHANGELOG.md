# Changelog

Alle nennenswerten Änderungen pro Release. Datumsangaben sind ISO 8601.

## v1.7.1 — 2026-07-10

Länger eingeloggt bleiben — rollende Sitzung.

### Highlights

- **Sliding-Session** — der Refresh-Cookie wird jetzt bei jedem erfolgreichen
  Refresh mit frischer Laufzeit neu gesetzt (`POST /auth/refresh`), statt eine
  harte Grenze ab Login zu sein. Wer regelmäßig aktiv ist, bleibt dauerhaft
  eingeloggt; erst echte Inaktivität länger als die Frist meldet ab.
- **Frist auf 30 Tage** — `REFRESH_TOKEN_EXPIRE_DAYS` von 7 → 30 (env-
  überschreibbar). Der 15-Minuten-Access-Token bleibt (kurzlebig + still
  erneuert), nur das „eingeloggt bleiben"-Fenster ist länger und rollend.

## v1.7.0 — 2026-07-05

Freitext-Tipp-Feld für Rezepte.

### Highlights

- **Tipp-Feld** — Rezepte haben jetzt ein optionales Freitext-Tippfeld (`tips`,
  additive Migration `0031`, nullable). Im Rezept-Bearbeiten-Formular als
  mehrzeiliges „Tipp (optional)"-Feld — leer lassen speichert sauber NULL.
- **Hervorgehoben auf der Detailseite** — ist ein Tipp gesetzt, erscheint am
  Ende der Rezept-Detailseite (nach Zutaten/Zubereitung) eine ruhige,
  mint-getönte Tipp-Box im Cookbook-Stil („Tipp"-Label in Playfair-Kursiv,
  Fließtext gut lesbar, Absätze bleiben erhalten). Ohne Tipp: keine Box.
- **Picnic-.eml-Import füllt den Tipp** — der „Tipp"-Block der Picnic-Mail
  wandert jetzt ins eigene Feld, statt verworfen zu werden. Der
  „Wie findest du dieses Rezept?"-Bewertungsblock (inkl. der :( / :)-Zeilen und
  aller `click.picnic.de`-Tracking-Links) wird weiterhin komplett verworfen und
  landet weder im Tipp noch in den Schritten; die Schritte enden unverändert vor
  dem Tipp. Gilt für Upload- und n8n-Importpfad gleichermaßen.
- **Bulk-JSON-Import** — `tips` wird aus dem `RecipeCreate`-JSON übernommen,
  wenn vorhanden.

## v1.6.1 — 2026-06-11

Picnic-Rezept-Mail-Import (.eml) — strukturiert, ohne KI, inklusive Bild.

### Highlights

- **Picnic .eml-Import** — Rezept-Mails von Picnic als `.eml` speichern und in
  Lyst hochladen (Tab „Datei"). Lyst erkennt das Picnic-Format und parst Titel,
  Portionen, Zeit, Zutaten (Mengen + Einheiten) und Schritte **direkt** (kein
  Ollama), lädt das Rezeptbild herunter und speichert es lokal (Datenhoheit —
  nicht nur Picnics Remote-URL). Tipp- und Bewertungs-Blöcke werden nicht zu
  Schritten. `source="structured_import"` → 📋-Badge; Nährwerte füllen sich im
  Hintergrund.
- **Robuste Duplikatsprüfung** — primär über den stabilen Bild-Hash aus der
  Picnic-Bild-URL (überlebt Tippfehler-Korrekturen/Umbenennungen durch Picnic),
  Fallback auf den normalisierten Titel. Re-Import → „schon vorhanden"-Dialog
  statt stillem Duplikat.
- **Mehrere .eml auf einmal** — Batch-Upload mit Zusammenfassung
  („5 importiert, 1 Duplikat, 1 nicht erkannt").
- **Format-Drift fällt laut auf** — passt eine Mail nicht zum Picnic-Format,
  kommt eine klare Meldung mit Verweis auf den Text-Tab statt eines Müll-Imports.
- **Automatisierung (n8n)** — `POST /api/recipes/import-eml` mit `X-API-Key`
  (server-to-server, kein Login); Besitzer per `LYST_PICNIC_IMPORT_OWNER_EMAIL`.
  Gleicher Parser-/Bild-/Dedup-/Nährwert-Pfad wie der Upload. Siehe
  `docs/CONFIGURATION.md`.

## v1.6.0 — 2026-06-11

Strukturierter JSON-Import ohne KI und Herkunfts-Transparenz für Rezepte.

### Highlights

- **Direktimport ohne KI** — neuer Endpoint `POST /recipes/bulk-import`
  schreibt bereits strukturierte Rezepte (z. B. ein Excel-/JSON-Export)
  direkt in die Datenbank, ohne Ollama. Body: `{ "recipes": [ … ] }` mit
  je einem `RecipeCreate` (Titel, Portionen, Zutaten mit Menge/Einheit,
  Schritte, Tags). Die ganze Liste wird vorab validiert — ist ein Eintrag
  fehlerhaft, wird der **komplette** Batch mit Nennung des Index abgelehnt,
  nichts wird halb importiert. Antwort: `{ imported, recipe_ids }`.
- **Nährwerte im Hintergrund** — nach dem Import läuft die bestehende
  Nährwert-Befüllung (USDA/OFF, ohne KI-Schätzung) als Background-Task pro
  Rezept, ohne die Antwort zu blockieren.
- **Herkunfts-Badges** — jedes Rezept zeigt jetzt eine kleine, gedämpfte
  Markierung, woher es stammt: 📋 Direktimport (ohne KI), 🔀 KI-Variante,
  🤖 KI-Import (aus URL/Datei/Text), ✏️ manuell erstellt. Die Logik liegt
  als berechnetes Feld `origin` auf `RecipeOut`/`RecipeSummary`, das Frontend
  rendert nur. Badges erscheinen auf den Übersichts-Karten und im Detail-Kopf.
- **Herkunfts-Filter** — neue Pills auf der Rezepte-Übersicht: „Nur KI" /
  „Nur Direktimport", um saubere strukturierte Rezepte von potenziell
  KI-fehlerbehafteten zu trennen.

## v1.5.1 — 2026-05-21

Folge-Release auf v1.5.0 mit zwei UX-Schritten: kompakte Nährwert-
Darstellung und Bulk-Lookup für alle Zutaten eines Rezepts auf einmal.

### Highlights

- **Nährwerte als Metadaten-Zeile, nicht mehr als Dashboard-Karte** —
  die Detail-Ansicht zeigt jetzt eine schlanke, gedämpfte Zeile direkt
  unter Portionen / Zeitangaben:
  „≈ 260 kcal · 4,3 g Eiweiß · 13 g KH · 20 g Fett   pro Portion ⌄".
  Klick auf den Chevron klappt die vollen 7 Werte + Toggle „pro Portion
  ⇄ gesamt" + Coverage-Zeile auf. Keine Riesen-Tiles mehr — gleiche
  visuelle Gewichtung wie „Vorbereitung: 15 Min".
- **Status persistiert** — `localStorage` merkt sich, ob jemand die
  Nährwerte immer aufgeklappt sehen möchte (Default: collapsed).
- **Deutsches Zahlenformat** — Komma-Dezimaltrennung, getrimmte
  trailing-Null („13", nicht „13,0"; „4,3" bleibt „4,3"). Neuer
  Helper `fmtDe()` in `lib/format`.
- **Kompakter Empty-State** — wenn keine Zutat zur Berechnung beiträgt,
  jetzt nur noch eine einzelne, freundliche Zeile mit Link auf die
  Edit-Seite, statt einer kompletten Karte.
- **Bulk-Nährwerte-Befüllung** — neuer Endpoint
  `POST /recipes/{id}/ingredients/nutrition-fill-all`. Modi:
  `fill_empty` (nur leere Felder, Default) und `refill_all` (alles neu,
  Frontend bestätigt vorher). USDA-first im Batch (gegen das großzügige
  USDA-Quota), OFF nur für Misses und nur solange das 10/min-Budget
  Slots hat — Rest wird als `deferred` zurückgemeldet, damit der User
  nach einer Minute erneut klickt. Optional `use_ai_fallback=true` für
  Ollama-Schätzung der Lücken — opt-in, nie still.
  - Antwort liefert pro Zutat `{status: filled|not_found|skipped|deferred, source}` +
    Aggregate (filled/not_found/skipped/deferred/total).
  - WebSocket-Event `recipe.updated` nach Persistierung — andere
    Geräte synchronisieren.
- **„Nährwerte für alle holen"-Button** auf der Edit-Seite über der
  Zutaten-Liste; „Alle neu abrufen" hinter einem Confirm-Dialog. Result-
  Panel zeigt „X von Y befüllt", listet Nicht-gefundene Zutaten beim
  Namen und bietet einen Klick „KI-Schätzung für die fehlenden" — die
  KI läuft nur auf den ausgewählten IDs, nicht stillschweigend.
- **Detail-Coverage-Link** „… ergänzen" startet den Bulk-Lookup jetzt
  inline statt nur zu navigieren — ein Klick, kompakter Status, fertig.
- **`BulkNutritionFill`-Komponente** in
  `components/recipes/BulkNutritionFill.tsx` — wiederverwendbar mit
  `variant="full"` (Edit-Seite) und `variant="compact"` (Detail).

### Verifizierter Sushi-Salat-Lauf (10 Zutaten)

Mit der echten Pipeline (USDA DEMO_KEY + Search-a-licious live) auf
einem repräsentativen Picnic-Sushi-Salat:

| Zutat               | Quelle | Treffer (Top 1) |
|---------------------|--------|------------------|
| Lachsfilet          | OFF    | Saumon ASC |
| Sushi-Reis          | USDA   | Rice, white, long-grain, parboiled |
| Reisessig           | —      | (nicht gefunden, AI-Opt-in möglich) |
| Gurke               | USDA   | Cucumber, peeled, raw |
| Avocado             | USDA   | Avocado / -Öl (re-rank trifft je nach DB) |
| Frühlingszwiebel    | OFF    | Frühlingszwiebel |
| Nori-Blätter        | OFF    | Nori Blätter |
| Sojasauce           | USDA   | Soy sauce made from soy (tamari) |
| Sesam               | USDA   | Seeds, sesame seeds, whole, dried |
| Wasabi              | USDA   | Wasabi |

→ **9 von 10 Zutaten automatisch befüllt** (6 × USDA, 3 × OFF, 1 nicht
gefunden). Mit einem Klick auf „KI-Schätzung für die fehlenden"
würde Reisessig per Ollama nachgereicht — sichtbar mit 🤖-Badge.

## v1.5.0 — 2026-05-21

Nährwerte erscheinen jetzt tatsächlich auf der Rezept-Detailseite. Die
Aggregation war seit v1.3 da, blieb aber leer, weil die meisten
Zutaten-Mengen nicht in Gramm angegeben sind — Stk, EL, TL, Tasse,
Prise. Neue Einheiten-Konvertierung füllt die Lücke, der Detail-View
zeigt Werte pro Portion mit Toggle auf Gesamt-Rezept.

### Highlights

- **Einheiten → Gramm-Konvertierung** (`app/services/unit_conversion`):
  - Masse: g, kg, mg, gr, gramm, gramme.
  - Volumen (Wasserdichte 1 g/ml als Default): ml, cl, dl, l, EL ≈ 15 g,
    TL ≈ 5 g, Tasse ≈ 240 g, Prise / Msp ≈ 0.5 g, Spritzer ≈ 3 g,
    Schuss ≈ 10 g.
  - Stückbasiert mit fester Gramm-Zahl pro Einheit (unabhängig von der
    Zutat): Zehe = 5 g, Scheibe = 30 g, Blatt = 1 g — damit findet
    „2 Zehen Knoblauch" nicht zwei ganze Knollen.
  - Stückbasiert über Zutat-Lookup: 1 Stk Lauch = 200 g, 1 Stk Zwiebel
    = 110 g, 1 Stk Ei = 60 g, 1 Stk Karotte/Möhre = 70 g, 1 Stk Apfel
    = 180 g, … ~50 Einträge in `PIECE_WEIGHTS_G`.
  - Unbekannte Stück-Zutaten (z. B. „1 Bund Petersilie") werden aus
    der Summe ausgeschlossen UND als „missing" für die Coverage-Zeile
    gezählt — der Nutzer sieht direkt, was noch zu pflegen ist.
- **Neue NutritionAggregate-Struktur** auf `RecipeOut`: per_serving +
  total + coverage {counted, total} + is_estimate + servings in einem
  Block. Ersetzt das alte `nutrition_per_serving`-Feld; ein Toggle
  schaltet im UI zwischen Portion und Gesamt-Rezept ohne zweiten
  Request.
- **Detail-Karte überarbeitet**:
  - Heading wechselt: „Nährwerte pro Portion" ⇄ „Nährwerte gesamtes
    Rezept". Bei AI-Anteil zeigt der Title zusätzlich „(geschätzt)".
  - Coverage-Hinweis „Basiert auf X von Y Zutaten" mit Link zum Edit,
    wenn Lücken bestehen — direkte Aktion statt nur Beschwerde.
  - Wenn null Zutaten beigetragen haben: freundlicher Hinweis statt
    Ausblenden, mit Edit-Link.
  - Refresh-Button-Tooltip nennt jetzt USDA / OFF (nicht mehr nur OFF).
- **Kochansicht**: kleine kcal-Pille im Header (≈ X kcal / Portion),
  sichtbar ab `sm`-Breakpoint.

### Verifiziertes Beispiel — Picnic „Cremige Spaghetti mit Räucherlachs"

Mengen / Einheiten:
- 200 g Räucherlachs → 200 g (direkt)
- 400 g Spaghetti → 400 g (direkt)
- 2 Stk Lauch → 400 g (Tabelle: 200 g/Stange)
- 1 EL Kräuterfrischkäse → 15 g (1 Esslöffel ≈ 15 ml × 1 g/ml)
- 1 Stk Zwiebel → 110 g (Tabelle)

→ **Coverage 5 von 5 Zutaten** umgerechnet.

Mit realistischen per-100g-Werten (Lachs 180 kcal, Spaghetti 370 kcal,
Lauch 29 kcal, Frischkäse 270 kcal, Zwiebel 40 kcal) und 4 Portionen:

- **Pro Portion** ≈ 510 kcal · 26 g Eiweiß · 84 g KH · 8 g Fett ·
  5.3 g Ballaststoffe · 2.0 g Salz
- **Gesamt** ≈ 2040 kcal · 104 g Eiweiß · 334 g KH · 31 g Fett · …

### Breaking change (intern)

- `RecipeOut.nutrition_per_serving` → `RecipeOut.nutrition` mit dem
  oben beschriebenen Aggregate-Block. Lyst ist eine self-hosted Single-
  Frontend-App, kein externer Client betroffen; Bestandsdaten bleiben
  unverändert (Berechnung läuft on-the-fly).

## v1.4.2 — 2026-05-20

OFF-Nährwertsuche auf die neue Search-a-licious-API umgezogen, Rate-Gate
auf das veröffentlichte Limit korrigiert und Compound/Brand-Suchterme
deutlich treffsicherer.

### Hintergrund

- `world.openfoodfacts.org/cgi/search.pl` ist deprecated und liefert seit
  Mai 2026 global `503` — alle OFF-Suchen brachen lautlos ab. Nachfolger
  ist Search-a-licious (`search.openfoodfacts.org`, Elasticsearch).
- OFF's veröffentlichtes Limit ist 10 Requests/Minute/IP für jede Suche.
  Unser ~1/Sekunde-Gate (60/min) hätte uns langfristig einen IP-Block
  eingehandelt.
- Compound-Begriffe wie „Express-Reis" trafen weder in USDA (kennt nur
  „rice") noch in OFF — der Bindestrich war der eigentliche Killer.

### Fixes

- **OFF → Search-a-licious** — neue Basis-URL und Query-Parameter
  (`q`, `langs=de,en`, `page_size`, `fields`, `sort_by=-popularity_key`).
  Response-Mapping angepasst: `brands` ist jetzt ein Array statt einer
  komma-separierten Zeichenkette; `nutriments.*_100g` heißen weiterhin
  identisch. Hits ohne `product_name` (kommen vor, wenn nur die
  per-Sprache-Felder gefüllt sind) werden übersprungen. User-Agent
  trägt jetzt einen Contact-Link gemäß OFF-Policy.
- **Korrekter Rate-Gate** — OFF läuft jetzt durch ein Rolling-Window
  Token-Bucket mit 10 Slots / 58 s (Sicherheitsmarge zur 60-s-Grenze).
  USDA bleibt auf 1 req/s, ihr 1000 / h passt locker.
- **USDA-first im Importer** — `search_for_each` fanst zuerst USDA für
  ALLE Zutaten parallel an (USDA-Quota deckt 15-Zutaten-Rezepte locker).
  OFF wird nur noch sequentiell für USDA-Misses angefragt und nur
  solange der 10/min-Budget noch Slots hat — passt damit auch für
  größere Batch-Importe. Übrige Misses bleiben leer, der Nutzer kann
  später via Sheet KI/manuell ergänzen.
- **Smartere Query-Normalisierung** — Brand-/Format-Präfixe (Bio-,
  TK-, Express-, Frisch-, Vollkorn-, Bio, Öko, …) werden gestrippt,
  und Compound-Wörter mit Bindestrich kollabieren auf den letzten
  (head-final) Bestandteil. So findet „Express-Reis" → „Reis" → USDA
  rice, „Bio-Hähnchenbrust" → „Hähnchenbrust" → chicken breast.
- **„Unavailable" nur noch bei echten Ausfällen** — Backend setzt das
  Flag jetzt strikt nur, wenn jede konfigurierte Quelle wirklich
  errort (HTTP/Timeout/Netz). Eine 0-Treffer-Antwort auf gesunder
  Verbindung ist KEIN „nicht erreichbar" mehr — die Sheet zeigt jetzt
  „Keine Treffer gefunden — KI-Schätzung oder manuell" statt der
  Service-Down-Meldung.

### Verifizierte Fälle

- `Avocado` → USDA-Avocado oben, OFF-„Avocados (Lidl)" darunter.
- `Express-Reis` → USDA `rice` über die Normalisierung; OFF-Treffer
  auf das Roh-Wort „Reis".
- `Bio-Hähnchenbrust` → USDA `chicken breast raw`.
- 7-Tage-Cache deckt Wiederholungs-Suchen ohne neue Netz-Calls (keine
  Logik verändert, nur die Bedeutung — bei dem 10/min Budget jetzt
  doppelt wichtig).
- 15-Zutaten-Importe halten das OFF-Budget ein: USDA bedient die
  Mehrheit, OFF wird nur für die letzten ein bis zwei Misses
  konsultiert.

## v1.4.1 — 2026-05-20

Hotfix für einen White-Screen-Crash, der direkt nach v1.4.0 auftauchte.

### Fixes

- **Nährwerte-Sheet stürzte ab (`Cannot read properties of undefined (reading 'reduce')`)** — wenn die Nährwert-Suche eine Response ohne `groups`-Array zurückgab (typischerweise ein vom Service Worker gecachter Eintrag aus v1.3 mit der alten `{results: [...]}`-Form, oder ein vereinzelter Upstream-Glitch), lief `groups.reduce(...)` ins Leere und blank-screened die ganze App. Fix in zwei Schichten:
  - Beim Empfangen der Response (`NutritionSheet`, `RecipeDetail.refreshAll`) wird die Payload defensiv normalisiert: alte `{results: [...]}`-Form wird in eine einzelne OFF-Gruppe konvertiert; fehlende `groups`/`results` werden auf `[]` gekappt.
  - Im Render-Pfad verwendet die Sheet ein `safeGroups`, das Arrays vor jedem `.reduce`/`.map` validiert — selbst wenn der State je in einen pathologischen Zustand kommt, kann er die App nicht mehr legen.
- **`refreshAll` (Werte aktualisieren)** liest jetzt ebenfalls beide Response-Shapes und beendet einzelne Zutat-Fehler still, statt durchzucrashen.
- Empty-State-Verzweigungen bestätigt:
  - OFF down (aktuell 503) + USDA-Treffer → nur „Lebensmittel" sichtbar, kein Crash.
  - Beide Quellen liefern nichts → „Nichts gefunden" + KI / Manuell.
  - `unavailable=true` → „Aktuell nicht erreichbar" + KI / Manuell.
  - Rezept ohne Nährwert-Daten → `NutritionCard` blendet sich still aus (Verhalten aus v1.3 beibehalten).

## v1.4.0 — 2026-05-20

USDA FoodData Central kommt als primäre Quelle für Rohzutaten neben
Open Food Facts dazu. Damit landet bei „Avocado" endlich die rohe
Avocado (~160 kcal/100 g) statt „Avocado-Öl-Spray" oben, und der
Rezept-Importer füllt deutlich mehr Zutaten automatisch.

### Highlights

- **USDA FoodData Central integriert** — Foundation + SR Legacy als
  zweite Nährwert-Quelle. Liefert pro Suche bis zu 5 Roh-Zutaten direkt
  aus dem USDA-Datensatz. Sodium → Salz wird mit dem Standardfaktor
  2,5 (NaCl / Na, EU 1169/2011) umgerechnet.
- **Gruppierte Ergebnisanzeige** — die Nährwerte-Sheet zeigt jetzt zwei
  Sektionen: 🥑 *Lebensmittel* (USDA, Roh-Zutaten zuerst) und 🌍
  *Markenprodukte* (OFF). Innerhalb jeder Gruppe werden kürzere /
  passendere Namen nach oben sortiert, damit „Avocado" über „100 % Pure
  Avocado Oil Spray" landet.
- **Deutsch → Englisch Übersetzungstabelle** — ~200 der häufigsten
  deutschen Kochzutaten werden statisch auf USDA-freundliche englische
  Suchbegriffe gemappt (`hähnchenbrust` → `chicken breast raw`,
  `magerquark` → `quark low fat`, `räucherlachs` → `salmon smoked`,
  …). Inklusive einfacher Plural-/Artikel-Normalisierung — „die roten
  Möhren" trifft genauso wie „Möhre".
- **AI-Recipe-Importer nutzt USDA zuerst** — pro extrahierter Zutat
  wird erst USDA befragt (via Übersetzungstabelle), dann als Fallback
  OFF. Quelle wird entsprechend gestempelt; in der Import-Vorschau
  erscheinen die neuen 🥑-Badges.
- **USDA Badge** — neue Quelle erkennt man am Blatt-Icon mit Tooltip
  „Quelle: USDA FoodData Central". OFF-Badge wechselt zu Sky-Blue, damit
  beide Quellen visuell klar trennbar sind.
- **Optionaler LLM-Übersetzungs-Fallback** — wenn die statische Tabelle
  ein Lebensmittel nicht kennt UND USDA mit dem Rohbegriff nichts
  findet, kann optional eine einmalige Ollama-Übersetzung ins Englische
  ausgeführt werden (`NUTRITION_TRANSLATE_FALLBACK=true`). Default aus,
  da die Tabelle den Großteil abdeckt — Tabelle erweitern ist der
  bevorzugte Weg.
- **OFF-Tuning** — OFF-Anfragen sortieren jetzt nach `popularity_key`,
  damit bekannte Produkte vor Nischenprodukten landen. Eigenes
  Re-Ranking innerhalb der OFF-Gruppe nach Namens-Nähe bleibt.

### Datenmodell (alembic 0021)

- `nutrition_source`-Enum bekommt den Wert `usda` (jetzt
  `usda` / `off` / `ai` / `manual`).
- Neue Spalte `usda_fdc_id` (varchar 32) auf `recipe_ingredients` —
  parallel zu `off_product_code`, hält die USDA Food-ID für spätere
  „Werte aktualisieren"-Refetches.
- Alle Spalten weiterhin nullable, Bestandsrezepte unverändert.

### Backend

- `services/nutrition_lookup_service` komplett überarbeitet:
  - `search_combined(query)` — parallel-fan-out an USDA + OFF, gruppiert
    zurück (`Lebensmittel` zuerst, `Markenprodukte` zweitens), eigene
    Rate-Gates (1 req/s pro Upstream), 7-Tage Cache am Ergebnis.
  - `search_for_each(queries)` — Batch-Helper für den Importer, USDA
    zuerst, OFF als Fallback.
  - `search_off(query)` als Backwards-Compat-Shim erhalten.
- `data/ingredient_translations` — neue, gepflegte Map deutsch→englisch
  plus `normalize()` und `translate()` Helper.
- `routers/recipes` — `GET /recipes/ingredients/nutrition-search`
  antwortet jetzt mit `{ groups: [...], unavailable }`. Leere Gruppen
  werden weggelassen, `unavailable` bleibt False solange mindestens
  eine *konfigurierte* Quelle erfolgreich war (USDA ohne Key gilt
  nicht als Ausfall).
- `services/import_service` — Auto-Prefill versucht USDA zuerst,
  setzt `nutrition_source='usda'` + `usda_fdc_id`, fällt sonst auf
  OFF zurück.
- `services/recipe_service.duplicate_recipe` + `add_ingredient` —
  übernehmen `usda_fdc_id` zusätzlich zu `off_product_code`.

### Frontend

- `NutritionSheet` zeigt die Treffer jetzt gruppiert mit Sektions-
  Headern. Beide Gruppen scrollen innerhalb des Sheets, der „KI /
  Manuell"-Footer bleibt fest.
- `NutritionBadge` kennt die neue Quelle `usda` mit Blatt-Icon und
  Emerald-Akzent; OFF wechselt zu Sky.
- `RecipeDetail` „Werte aktualisieren" zieht jetzt die erste Gruppe
  (USDA bevorzugt) und übernimmt die Quelle entsprechend.
- `RecipeEdit` führt `usda_fdc_id` durch alle Persistenz-Pfade.

### Config

- `FDC_API_KEY` — kostenloser USDA-Key,
  <https://fdc.nal.usda.gov/api-key-signup.html>. Leer = USDA-Gruppe
  wird stillschweigend übersprungen.
- `NUTRITION_TRANSLATE_FALLBACK` — optionaler LLM-Übersetzungs-Fallback.
- `NUTRITION_LOOKUP_ENABLED` bleibt der Master-Switch und gilt jetzt
  für beide Quellen.
- Volle Doku in [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md#nutrition-lookup--usda--open-food-facts-optional-recommended).

### Bekannte Lücken in der Übersetzungstabelle (zur späteren Pflege)

Die statische Tabelle deckt die häufigsten ~200 Kochzutaten ab; selten
auftauchende Zutaten landen über den Plural-/Artikel-Stripper noch oft
direkt im Englischen, sonst auf dem Rohbegriff oder im LLM-Fallback.
Beobachtet & noch nicht in der Tabelle: Quark-Varianten jenseits
„magerquark", regionale Wurstsorten („Mettwurst", „Leberwurst"),
spezielle Brotsorten („Pumpernickel", „Bauernbrot"), seltene Kräuter
(„Liebstöckel", „Bohnenkraut"), Spirituosen / Liköre, exotische
Früchte („Drachenfrucht", „Sternfrucht"). Erweiterungen gehören
in `backend/app/data/ingredient_translations.py`.

## v1.3.1 — 2026-05-20

Hotfix für eine Regression aus v1.3.0.

### Fixes

- **Zutat mit Nährwerten speichern (500-Fehler)** — beim Speichern eines bestehenden Rezepts mit gesetzter Nährwert-Quelle quittierte der Server jede PATCH-Anfrage auf `/recipes/{id}/ingredients/{ingId}` mit `500 Internal Server Error` (Postgres: `invalid input value for enum nutrition_source: "OFF"`). Ursache: SQLAlchemy's Enum-Typ persistierte den Enum-NAMEN (`OFF`) statt des -WERTS (`off`), der von Migration 0020 als Postgres-Enum-Wert angelegt wurde. Fix: `values_callable` auf der SA-Column, damit der Lowercase-Wert geschrieben wird — passt zum API-Contract end-to-end (Frontend, Pydantic-Schema und Postgres-Enum erwarten alle Lowercase). Keine Datenmigration nötig.

## v1.3.0 — 2026-05-20

Automatische Nährwert-Erfassung für Rezept-Zutaten — Open Food Facts
als Primärquelle, lokales Ollama als Fallback, manuelle Eingabe als
Letzte Instanz. Quelle pro Zutat sichtbar, Recipe-Detail rechnet
pro Portion zusammen.

### Highlights

- **Open Food Facts integriert** — beim Anlegen einer Zutat (manuell oder per AI-Import) schlägt Lyst bis zu 5 OFF-Treffer vor; ein Klick übernimmt Kalorien, Eiweiß, Kohlenhydrate, Fett, Ballaststoffe, Zucker und Salz pro 100 g.
- **AI-Recipe-Import füllt Nährwerte vor** — URL, Foto, HTML, PDF und Freitext lösen nach der Extraktion automatisch eine OFF-Abfrage pro Zutat aus. Erfolgreiche Treffer landen in der Import-Vorschau mit 🌍-Badge.
- **KI-Schätzung als Fallback** — Zutaten, die OFF nicht kennt („Tante Käthes Spezialgewürz"), bekommen über das lokale Ollama-Modell eine Schätzung der sieben Werte plus kurzem Hinweistext. Markiert mit 🤖-Badge.
- **Quelle pro Zutat sichtbar** — jede Zutat zeigt im Editor und in der Detailansicht ein kleines Icon: 🌍 Open Food Facts, 🤖 KI-Schätzung, ✏️ manuell eingetragen, kein Icon = noch keine Werte. Tooltip nennt die genaue Quelle (z. B. „Open Food Facts (Followfish)").
- **Nährwerte pro Portion auf der Rezept-Detailseite** — alle sieben Makros, sauber pro Portion umgerechnet. Wird auf Schätzungen aufgebaut, prefixiert die Zahlen mit „~"; bei Teildaten erklärt ein dezenter Hinweis „Werte basieren auf X von Y Zutaten — fehlende ergänzen?".
- **„Werte aktualisieren"-Knopf** — refresht die OFF-Daten für alle Zutaten, die noch keine eigene Quelle haben oder schon auf OFF basieren. Manuelle und KI-Schätzungen bleiben erhalten — die gehören dem Nutzer.

### Datenmodell (alembic 0020)

- Drei neue per-100g-Spalten auf `recipe_ingredients`: `fiber_per_100g`, `sugar_per_100g`, `salt_per_100g`. v1.2.0 trug nur kcal / Eiweiß / KH / Fett.
- Neues Postgres-Enum `nutrition_source` mit Werten `off` / `ai` / `manual`. Nullable — `NULL` = „noch keine Werte gepflegt", abzugrenzen von `manual` = „manuell eingetragen".
- Neue Spalte `off_product_code` (varchar 32) für den OFF-Barcode bei OFF-Treffern — ermöglicht spätere Re-Fetches über „Werte aktualisieren".
- Bestandsrezepte sind nicht betroffen — alle neuen Spalten sind nullable und ohne Default, alte Zutaten behalten ihren bisherigen Zustand.

### Backend

- `services/nutrition_lookup_service`:
  - `search_off(query)` mit 4 s Timeout, 7-Tage In-Process-Cache, ~1 req/sec Rate-Gate, dediziertem `User-Agent: Lyst/1.3` (OFF-Fair-Use-Policy), `lc=de`-Hint für deutsche Labels.
  - `search_off_for_each(queries, concurrency=3)` als Batch-Variante für den AI-Importer.
  - `estimate_with_ollama(name, hint?)` reuse-t den vorhandenen `call_text_json`-Helper, deutsche System-Prompt, gibt bei Modellfehlern eine leere Antwort + Hinweis statt 500.
- `routers/recipes`:
  - `GET /recipes/ingredients/nutrition-search?q=…` → bis zu 5 Kandidaten, `unavailable=true` bei abgeschaltetem Flag oder Netzwerk-Fehler.
  - `POST /recipes/ingredients/nutrition-estimate` → KI-Schätzung mit `note`-Feld.
- `services/import_service`:
  - Nach der LLM-Extraktion läuft `_enrich_ingredients_with_off` über alle Zutaten und füllt OFF-Treffer mit `nutrition_source="off"` + Barcode. Misses bleiben leer.
- `services/recipe_service.duplicate_recipe`:
  - Übernimmt jetzt alle sieben Nährwert-Felder + Quelle + Barcode aufs Duplikat — vorher gingen sie verloren.
- Neue Setting `NUTRITION_LOOKUP_ENABLED` (Default `true`). Bei `false` werden OFF-Aufrufe übersprungen — siehe [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md#nutrition-lookup--open-food-facts-optional-recommended).

### Frontend

- `components/recipes/NutritionSheet` — Bottom-Sheet auf Mobile, zentrierter Modal auf Desktop. Drei Views in einer Fläche: OFF-Kandidaten / KI-Schätzung / manuelle Eingabe (sieben Felder). Eigene Empty-State-Texte für „lädt", „nichts gefunden" und „OFF nicht erreichbar".
- `components/recipes/NutritionBadge` — kleines Icon plus exakter Tooltip-Text pro Quelle.
- **Rezept-Editor**: alter Inline-Aufklapp-Bereich für Nährwerte ersetzt durch einen einzelnen Apple-Button pro Zutat, der die Sheet öffnet. Quelle-Badge neben dem Namen, Menge/Einheit bleiben inline editierbar.
- **Rezept-Detail**: NutritionCard zeigt jetzt alle sieben Makros, „~"-Prefix bei Schätzungsanteil, partielle-Daten-Hinweis, Refresh-Button für „Werte aktualisieren".

### Privacy

- Open Food Facts ist ein externer Dienst — wer alle Rezeptdaten lokal halten will, setzt `NUTRITION_LOOKUP_ENABLED=false`. Die Sheet bietet dann nur KI-Schätzung + manuell.

## v1.2.1 — 2026-05-19

Patch-Release mit zwei Regressionen aus v1.2.0.

### Fixes

- **Rezept-Zutaten speichern** — 500-Fehler beim Anlegen/Bearbeiten einer Zutat mit Nährwert-Feldern (`calories_per_100g`, `protein_per_100g`, `carbs_per_100g`, `fat_per_100g`). Die Service-Funktion `add_ingredient` akzeptierte die neuen Felder nicht und scheiterte mit einem `TypeError`. Beide Felder werden jetzt sauber durchgereicht.
- **WebSocket `/ws/user` 403** — verbindete sich zuverlässig nicht mehr, der „Live"-Indikator blieb grau. Der Auth-Pfad gleicht jetzt exakt `get_current_user` (User-Lookup + `is_active`-Check) und protokolliert die jeweilige Reject-Ursache, damit ein erneutes Auftreten direkt im Log sichtbar ist.

## v1.2.0 — 2026-05-16

Größtes Update seit dem ersten Release. Schwerpunkte:

- TipTap-WYSIWYG-Editor für Notizen
- Echter Aufgaben-Layer mit globaler `/tasks`-Übersicht
- Real-time Sync zwischen Geräten via Per-User-WebSocket
- Vereinheitlichter Rezept-Import (URL / Foto / HTML / PDF / Text) inkl. Bild-Extraktion
- Mobile-First Refresh der Listen-Detailansicht

### Highlights

- **Neuer WYSIWYG-Editor für Notizen** — Slash-Commands, @-Erwähnungen für Personen und Notizen, Drag-Handles, ausklappbare Bereiche, Tabellen, Code-Blöcke mit Syntax-Highlighting, Textausrichtung, Farben und Highlights.
- **Aufgaben-Layer** — jedes Listen-Item und jede Checkbox in einer Notiz lässt sich einer Person zuweisen, mit Fälligkeit und Erinnerung. Neue Seite „Aufgaben" aggregiert alles.
- **Real-time zwischen Geräten** — Änderungen erscheinen sofort auf allen offenen Geräten der gleichen Person und auf Geräten von Personen, mit denen geteilt wurde. Kein manuelles Neuladen mehr.
- **Erweiterter Rezept-Import** — eine API für URL, Foto, HTML, PDF und freien Text. Hero-Bild aus der Quelle wird automatisch extrahiert und übernommen.
- **In-App-Benachrichtigungen** — Glocken-Icon im Header, persistent über Sessions hinweg. Trigger: Shares, Erwähnungen, Aufgaben-Zuweisungen, Erinnerungen.

### Editor

- Markdown-Editor (MDEditor) durch TipTap ersetzt. Inhalte werden als sanitisiertes HTML gespeichert (alembic 0016 `content_format`-Spalte, einmaliges Migrationsskript für Bestandsdaten).
- Slash-Commands (`/`) öffnen ein Block-Menü: Überschriften, Listen, Aufgabenliste, Zitat, Trennlinie, Code-Block, Bild, Tabelle, ausklappbarer Bereich, Notiz-Link, Erwähnung.
- @-Trigger öffnet ein Popover mit zwei Sektionen — Notizen und Personen. Notiz-Links rendern als klickbare Chips, Personen-Mentions als Chip mit Brand-Farbe.
- Aufklappbare Bereiche (Details/Summary) — funktioniert in beiden Modi (Edit + Read-only), Tastatur-Toggle via Enter im Summary.
- Drag-Handles links neben jedem Block für Block-Reordering.
- Wikilink-Chips sind jetzt überall klickbar (auch im Edit-Modus), öffnen die verlinkte Notiz im selben Tab.
- Tabellen-Editor mit Floating Menu für Zeilen/Spalten-Befehle.
- Code-Blöcke mit `lowlight` + `highlight.js` für Sprachen-Erkennung und Syntax-Highlighting (hell + dunkel).
- Word Count + Character Count in der Footer-Leiste (auf Mobile reduziert auf Wörter).
- Textausrichtung links/zentriert/rechts (für Absätze und Überschriften).
- Textfarbe + Highlight-Farbe via Picker, dezente Brand-Palette mit halbtransparenten Highlights.
- Unterstrichen, Trennlinie (HR) als regulärer Block.
- Slim-Toolbar — Inline-Marks und Alignment + Verlauf bleiben sichtbar, alle Block-Inserts wandern in das Slash-Menü (Plus-Button als Discovery-Affordance).
- Mobile Tag-Input — Enter committet den Tag (statt Fokus in den Editor-Body zu schicken), `enterKeyHint="done"` ändert die Return-Taste auf der Bildschirmtastatur.

### Aufgaben

- Listen-Items bekommen `assignee_id`, `due_at`, `reminder_at`, `reminder_sent` (alembic 0018).
- Notiz-Tasks: neue Tabelle `task_items`, jeder `<li data-type="taskItem">` im Editor mappt auf eine Zeile via `data-task-id`-Attribut.
- Per-Task-Popover für Zuweisung, Fälligkeit, Erinnerung — gleicher Mechanismus in Listen und Notizen.
- Globale Übersicht `/tasks` mit Filtern (Mine / Mir zugewiesen / Alle, Status: Offen / Heute / Diese Woche / Überfällig / Erledigt).
- Klick auf eine Task in der Übersicht öffnet die Quelle (`/lists/<id>?task=<t>` oder `/notes?focus=<n>&task=<t>`) mit Pulse-Highlight am Ziel.
- Scheduler (APScheduler) ergänzt um Reminder-Tick — feuert Mail- und In-App-Benachrichtigung an den Assignee, idempotent durch `reminder_sent`-Flag.
- Backfill-Skript `scripts/migrate_note_tasks_to_rows.py` für Bestands-Notizen, idempotent.

### Rezepte

- Vereinheitlichter Import-Endpoint `POST /recipes/import` — akzeptiert eine Datei (Foto, HTML, PDF) oder einen freien Text-Body als JSON. Content-Type entscheidet über den Pfad.
- Hero-Bild aus der Quelle automatisch extrahieren: `og:image`, Twitter-Card, JSON-LD `Recipe.image` (rekursiv durch `@graph`/`mainEntity`), heuristisches `<img>`-Fallback; PDF: erste eingebettete Page-Image; Foto-Import: das hochgeladene Bild selbst.
- Bild-Validierung via Pillow Byte-Sniff, 10 MB-Limit, 200px-Mindestkante (filtert Bewertungs-Sterne und Tracking-Pixel).
- Owner-seitiger Share-State-Chip neben dem Rezept-Titel — kombiniert „X geteilt", „Teil des geteilten Rezeptbuchs" und „Öffentlich geteilt" in einem einzigen Tooltip.
- Recipe-WebSocket-Events: jede Rezept-Mutation (PATCH, DELETE, Zutaten, Schritte, Bild) wird an alle Empfänger via Per-User-WebSocket gefannt — Detail-Seiten auf anderen Geräten refreshen automatisch.

### Listen

- Mobile-First Redesign der Detail-Seite — ruhige Reihen, ein einziges ItemSheet öffnet sich beim Tippen auf einen Eintrag und enthält alle Felder + Aufgaben-Konfiguration.
- ItemSheet auch auf Desktop als zentrierter Modal (statt Inline-Edit + Kebab pro Reihe) — eine konsistente Schreibung in beiden Welten.
- Kategorien klappen sich ein und aus, der Zustand wird per `localStorage` pro Liste gemerkt.
- Swipe-Right öffnet das ItemSheet, Swipe-Left löscht mit 5-Sekunden-Rückgängig-Toast.
- Listen-Typ-spezifische Kategorien — `SHOPPING` und `PACKING` haben jeweils eigene Sets, `CHECKLIST`/`CUSTOM` blenden den Toggle aus.
- Owner-seitiger Share-State-Chip auf Listen-Karten.

### Notizen

- TipTap-WYSIWYG-Editor (siehe „Editor"-Sektion oben).
- Notiz-Karten zeigen einen Backend-gerechneten Plain-Text-Snippet (HTML-Tags, Markdown-Reste und Whitespace gestrippt, ~120 Zeichen).
- Owner-seitiger Share-State-Chip auf Notiz-Karten, Detail-Header.
- Klickbare Wikilinks auch im Edit-Modus, über React-NodeView mit eigenem Click-Handler.
- Mobile Tag-Input akzeptiert Enter zuverlässig (siehe „Editor"-Sektion oben).
- „Neu laden?"-Banner bei kollaborativen Konflikten — wenn jemand anderes die offene Notiz speichert, blendet ein gelbes Banner einen Reload-Button ein. Mit Dirty-State-Detection: bei ungespeicherten lokalen Änderungen Bestätigungsdialog.

### Real-time & Sync

- Per-User-WebSocket `/ws/user` neben dem bestehenden Per-List `/ws/lists/{id}` — ein Connection pro Session, mit exponentiellem Backoff bei Reconnect.
- Event-Dispatcher invalidiert Overview-Keys und Detail-Keys (`list-detail:<id>`, `recipe:<id>`, `note:<id>`) per Prefix-Match.
- Detail-Seiten verwenden `useResourceQuery` — Mount-Fetch + Focus-Refetch + WS-getriebene Invalidation. Identische Semantik wie `useOverviewQuery`, getrennt nur über den Dev-Log-Prefix `[detail]`/`[overview]`.
- Service-Worker: Detail-GETs (`/api/{lists,notes,recipes}/<id>`, `/api/meal-plans`) auf NetworkFirst umgestellt — vermeidet stale Renders auf cold mount. Sammlungs-GETs bleiben auf StaleWhileRevalidate.
- Service-Worker-Cache-Purge wird nach Mutationen vor dem `axios.then` awaited — keine Race-Conditions mehr zwischen Mutation und nächstem GET.
- Per-User-Echo-Suppression über `X-Client-Id`-Header, Reconnect-Recovery via `invalidateAllOverviews`.

### Sharing

- „Zuletzt geteilt mit"-Vorschläge im Share-Panel — ein einziger Endpoint `GET /me/share-suggestions` liefert die zuletzt-gesharten Kontakte, deduplikiert und nach Rezenz sortiert.
- Owner-seitiger Share-State auf allen Resource-Typen — kombinierte Tooltips für interne Shares, Public Token und (bei Rezepten) Rezeptbuch-Coverage.
- Interne Shares mit Permission (`VIEW` / `EDIT`) — Frontend zeigt entsprechende Schreib-/Lese-Banner und blendet Aktionen aus.
- „Freigabe verlassen" für Empfänger (Notizen, Rezepte, Rezeptbücher) — Resource verschwindet aus der eigenen Ansicht, Owner kann erneut freigeben.
- Share-WS-Event `share.created` triggert sowohl einen Toast als auch eine persistente In-App-Notification beim Empfänger.

### Bugfixes

- Task-Listen-Layout im Live-Editor — Checkbox + Text wieder in einer Zeile. Ursache: TipTaps NodeView fügt `data-type="taskItem"` NICHT auf das `<li>` (nur `class="note-taskitem"`), darum musste die CSS-Regel beide Selektoren matchen + `!important` auf `display: flex` setzen.
- Notification-Panel auf Mobile clippte am linken Bildschirmrand — Mobile-Branch jetzt als Bottom Sheet (gleiche Optik wie ItemSheet).
- Cache-Invalidation auf Detail-Seiten — Listen erschienen nach Cross-Device-Edits leer bis zum Reload. NetworkFirst-SW + `useResourceQuery` schließen das Fenster.
- Mobile Tag-Input — Enter committete den Tag nicht, sondern wanderte in den Editor-Body. Fixed via `stopPropagation` + `preventDefault` + `enterKeyHint="done"`.
- Notiz-Snippets enthielten HTML-Tag-Reste. Backend rendert jetzt einen sauberen 120-Zeichen Plain-Text-Snippet.
- Code-Block im Editor zeigte keine Syntax-Hervorhebung — `CodeBlockLowlight` ersetzt den Standard.
- PACKING-Listen zeigten SHOPPING-Kategorien — getrennte Sets pro Listentyp, stale Kategorien wandern in einen „Wird kategorisiert…"-Bucket.
- Markdown-Task-Listen rutschten auf der Mobile-Vorschau aus dem Viewport — Library-CSS via präziser Selektor-Spezifität überschrieben.
- Swipe-to-Delete + Undo war fragil — pending Deletes werden beim Unmount geflusht statt verloren zu gehen.

### Infrastructure

- `bleach[css]` (zieht `tinycss2` mit) — CSS-Sanitizer für Inline-Styles aus dem TipTap-Editor.
- `markdown-it-py[linkify]` — Linkify-Erweiterung für den Markdown-Renderer im Migrations-Skript.
- `lowlight` + `highlight.js` (Frontend) für Code-Block-Syntax-Highlighting.
- `tiptap` v2.27 + alle Extension-Pakete (Link, Image, Table, TaskList, TaskItem, Placeholder, Mention, etc.) als feste Deps.
- `@floating-ui/dom` für Tabellen-Floating-Menü und Suggestion-Popovers.
- APScheduler erweitert um Task-Reminder-Tick.
- pypdf 4.x für PDF-Text + eingebettete Bilder.
- Migrationen 0015–0019:
  - 0015 — stale `PACKING` Kategorien einmalig entfernen
  - 0016 — `notes.content_format` (HTML / MARKDOWN)
  - 0017 — `note_mentions` Tabelle
  - 0018 — Tasks-Layer (Listen-Item-Spalten + `task_items` Tabelle)
  - 0019 — `notifications` Tabelle
- Einmal-Skripte (idempotent):
  - `scripts/migrate_notes_to_html.py` — konvertiert Bestand-Notizen von Markdown auf HTML
  - `scripts/migrate_note_tasks_to_rows.py` — backfillt `task_items` für TipTap-Task-Items in Bestand-Notizen

## v1.0.1 — 2026-05-14

- Hotfix: zweite `NoteCard`-Render-Stelle (Mobile-Overview) bekommt jetzt das `folder`-Prop, das in 1.0.0 required wurde.

## v1.0.0 — 2026-05-14

- Erstes öffentliches Release. Listen, Notizen (Markdown), Rezepte, Wochenplanung, Sharing, Offline-Sync-Queue, Service-Worker-Caching, KI-Assist via Ollama.
