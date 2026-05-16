# Migration

## v1.0.1 → v1.2.0

Drei Punkte, einer davon manuell.

### 1. Backup nehmen

Das Schema springt mehrere Alembic-Revisionen vorwärts (0015–0019) und
zwei Bestandsdaten-Skripte sind teil des Upgrades. Vor allem das
Markdown-→-HTML-Skript ist einseitig (Bestandsmarkdown wird überschrieben).

```bash
docker compose exec db pg_dumpall -U lyst > lyst-pre-1.2.0.dump
```

### 2. Container hochziehen

```bash
docker compose pull        # falls du die ghcr.io-Images benutzt
docker compose up -d --build
```

Beim Backend-Start läuft automatisch `alembic upgrade head` —
Migrationen 0015–0019 ziehen durch. Neue Python-Dependencies
(`bleach[css]`, `markdown-it-py[linkify]`, `lowlight`-Pakete im
Frontend, etc.) sind im Image bereits drin, kein manueller `pip
install` nötig.

### 3. Einmalige Daten-Migrationen ausführen

Zwei Skripte. Beide idempotent, beide können im Maintenance-Fenster
laufen.

**A. Markdown-Notizen auf HTML konvertieren** —
Schritt-für-Schritt in [docs/INSTALLATION.md → „One-off: notes
Markdown → HTML migration"](docs/INSTALLATION.md#one-off-notes-markdown--html-migration-v120).
Kurz:

```bash
# Optional: vorher trocken
docker compose exec backend python -m scripts.migrate_notes_to_html --dry-run --verbose --limit 5

# Echt
docker compose exec backend python -m scripts.migrate_notes_to_html
```

Bis das Skript durchgelaufen ist, werden noch nicht migrierte Notizen
read-only in einem Fallback-Viewer angezeigt — mit einer gelben
Hinweisleiste an den Operator. Bestehende Read-/Write-Funktionalität
für bereits migrierte Notizen ist davon nicht betroffen.

**B. Note-Task-Items backfillen** — siehe [docs/INSTALLATION.md →
„One-off: note tasks → task_items rows"](docs/INSTALLATION.md#one-off-note-tasks--task_items-rows-v120).
Kurz:

```bash
docker compose exec backend python -m scripts.migrate_note_tasks_to_rows
```

Das Skript ist additiv (fügt nur `task_items`-Zeilen + `data-task-id`-
Attribute hinzu, löscht nichts). Solange du das nicht laufen lässt,
werden Checkboxen in alten Notizen weiterhin gerendert — sie tauchen
nur nicht in der globalen `/tasks`-Übersicht auf und das Task-Popover
am Checkbox-Item bleibt grau.

### Neue Environment-Variablen

Keine. Alle bestehenden `.env`-Einträge bleiben gültig. (Lyst-AI-Funktionen
verwenden weiterhin `OLLAMA_BASE_URL`/`OLLAMA_MODEL`, Mail-Trigger
weiterhin `RESEND_API_KEY`/`EMAIL_FROM` — siehe
[docs/CONFIGURATION.md](docs/CONFIGURATION.md).)

### Breaking Changes

Keine. Alle bestehenden API-Endpoints bleiben kompatibel, das frontend
schaltet automatisch auf den neuen Editor um, alle Cookies + Tokens
bleiben gültig. Die einzige Veränderung im API-Verhalten ist
zusätzliches Verhalten:

- `RecipeOut` enthält jetzt ein `share_state`-Feld (vorher nicht
  vorhanden) — alte Frontend-Versionen ignorieren unbekannte Felder
  klaglos, neue Frontend-Versionen nutzen es für den Share-Chip.
- `POST /notes/{id}/share/email` und der entsprechende Rezept-
  Endpoint liefern unverändert dieselbe Response-Form; die internen
  Service-Funktionen sind jetzt 3-Tupel (kind, name, recipient_id) statt
  2-Tupel — das ist intern und betrifft keine externen Konsumenten.
- WebSocket-Channel `/ws/user` ist neu — der bestehende
  `/ws/lists/{id}` bleibt unverändert. Frontend-Clients verwenden
  beide parallel, ältere Frontends, die nur den list-channel kannten,
  funktionieren weiter (sie verlieren nur die Cross-Resource-Events).

### Rollback

Wenn nötig:

1. `docker compose down`
2. `docker compose run --rm db psql -U lyst -d lyst -f /backup/lyst-pre-1.2.0.dump`
   (oder dein bevorzugter `pg_restore`-Flow)
3. Vorheriges Image-Tag pinnen in `docker-compose.yml` (`ghcr.io/<owner>/lyst-backend:v1.0.1`)
4. `docker compose up -d`

Die `content_format`-Spalte (alembic 0016) bleibt absichtlich noch ein
weiteres Release im Schema, damit ein Rollback einzelner Notizen
möglich ist (eine Zeile auf `'MARKDOWN'` zurückflippen, Inhalt aus dem
Dump einsetzen — das Frontend zeigt sie dann wieder im Legacy-Viewer
an, andere Notizen bleiben in HTML).
