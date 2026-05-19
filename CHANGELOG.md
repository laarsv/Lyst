# Changelog

Alle nennenswerten Änderungen pro Release. Datumsangaben sind ISO 8601.

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
