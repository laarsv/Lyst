# Lyst v1.2.0

Großes Update mit drei dicken Brocken: ein komplett neuer Editor, ein echter Aufgaben-Layer, und Live-Sync zwischen all deinen Geräten.

## Highlights

- 📝 **Neuer WYSIWYG-Editor für Notizen** — TipTap mit Slash-Commands, @-Erwähnungen für Personen und Notizen, Drag & Drop, Code-Blöcken mit Syntax-Highlighting, Tabellen, ausklappbaren Bereichen und mehr.
- ✅ **Aufgaben-Layer** — jedes Listen-Item und jede Checkbox in einer Notiz lässt sich zuweisen, mit Fälligkeit und Erinnerung. Eine neue Seite „Aufgaben" sammelt alles an einer Stelle.
- ⚡ **Live-Sync zwischen Geräten** — Änderungen erscheinen sofort auf allen anderen offenen Geräten und bei Personen, mit denen geteilt wurde. Kein manuelles Neuladen mehr.
- 🍝 **Erweiterter Rezept-Import** — URL, Foto, HTML, PDF oder freier Text. Das Hero-Bild aus der Quelle wird automatisch übernommen.
- 📱 **Mobile UX überarbeitet** — Item-Sheets statt Inline-Edit, aufklappbare Kategorien, ruhigere Listen-Ansicht.

## Alle Änderungen

### Editor

- Markdown-Editor durch TipTap ersetzt — Inhalte werden jetzt als sanitisiertes HTML gespeichert.
- Slash-Commands (`/`) für jeden Block: Überschriften, Listen, Aufgabenliste, Zitat, Trennlinie, Code-Block, Bild, Tabelle, Notiz-Link, Erwähnung, ausklappbarer Bereich.
- @-Trigger öffnet ein Popover mit Sektionen für Notizen und Personen.
- Drag-Handles zum Umsortieren von Blöcken.
- Code-Blöcke mit Sprachen-Erkennung und Syntax-Highlighting (hell + dunkel).
- Textfarbe, Hervorheben, Unterstrichen, Textausrichtung, Trennlinie, Wortzähler.
- Klickbare Wikilinks und Personen-Mentions auch im Edit-Modus.
- „Neu laden?"-Banner bei kollaborativen Konflikten — mit Confirm-Dialog bei ungespeicherten lokalen Änderungen.

### Aufgaben

- Listen-Items und Notiz-Checkboxen können einer Person zugewiesen werden, mit `due_at` und `reminder_at`.
- Neue Seite `/tasks` mit Filtern (eigene / mir zugewiesen / alle; offen / heute / diese Woche / überfällig / erledigt).
- Klick auf eine Task öffnet die Quelle mit Highlight-Pulse am Ziel-Element.
- Scheduler verschickt Reminder per E-Mail und als In-App-Benachrichtigung.

### Rezepte

- Ein einziger Import-Endpoint für URL, Foto, HTML, PDF und freien Text.
- Bild-Extraktion aus der Quelle (og:image, JSON-LD, PDF-Page-Image, hochgeladenes Foto) mit Größen-/MIME-Validierung.
- Owner-seitiger Share-State-Chip neben dem Rezept-Titel — kombiniert interne Shares, Public Token und Rezeptbuch-Coverage.
- Cross-Device-Refresh bei Rezept-Edits via WebSocket.

### Listen

- Mobile-First Redesign — eine ruhige Reihe pro Item, Tipp öffnet das ItemSheet mit allen Feldern und der Aufgaben-Konfiguration.
- ItemSheet auch auf Desktop als zentrierter Modal (statt Kebab + Inline-Edit).
- Kategorien einklappen, Zustand wird pro Liste gemerkt.
- Swipe-Right öffnet das Sheet, Swipe-Left löscht mit Rückgängig-Toast.
- Owner-seitiger Share-State-Chip auf Listen-Karten.

### Notizen

- TipTap-Editor (siehe oben).
- Karten zeigen einen sauberen Plain-Text-Snippet (keine HTML-Reste mehr).
- Owner-seitiger Share-State-Chip.
- Klickbare Wikilinks überall.
- Mobile Tag-Input — Enter committet zuverlässig.

### Real-time, Sync und Sharing

- Per-User-WebSocket `/ws/user`, eine Verbindung pro Session.
- Detail-Seiten via NetworkFirst-SW + `useResourceQuery` — keine stalen Renders mehr nach Cross-Device-Edits.
- „Zuletzt geteilt mit"-Vorschläge im Share-Panel.
- Interne Shares mit Permission (VIEW / EDIT) und „Freigabe verlassen"-Aktion für Empfänger.
- In-App-Benachrichtigungen für Shares, Mentions, Aufgaben-Zuweisungen und Reminder. Glocke im Header, Bottom-Sheet auf Mobile.

### Bugfixes

- Task-Listen-Layout im Live-Editor (Checkbox war über statt neben dem Text).
- Cache-Invalidation auf Detail-Seiten (Listen erschienen leer nach Cross-Device-Edits bis zum manuellen Reload).
- Notification-Panel-Clipping am linken Bildschirmrand auf Mobile.
- Markdown-Task-Listen auf der Mobile-Notiz-Vorschau.
- Mobile-Tag-Input verlor Fokus nach Enter.
- Swipe-to-Delete + Undo flusht jetzt beim Unmount.

## Upgrade

1. **Backup** machen — das Schema springt mehrere Alembic-Revisionen vor:
   `docker compose exec db pg_dumpall -U lyst > lyst-pre-1.2.0.dump`
2. Container hochziehen — `docker compose pull && docker compose up -d --build`
3. Zwei einmalige Daten-Skripte (idempotent) — siehe [MIGRATION.md](MIGRATION.md).

Keine neuen Environment-Variablen, keine Breaking Changes an API oder Auth.

---

Danke an alle, die Lyst die letzten Wochen mitgetestet haben 🙏

[Installation & Upgrade →](docs/INSTALLATION.md) · [Migration Notes →](MIGRATION.md) · [Full Changelog →](CHANGELOG.md)
