# Lyst

Modernes Listen-Management-Tool — Einkauf, Packen, Checklisten und Notizen.
Volles Stack: FastAPI · PostgreSQL · React · Tailwind · PWA.

## Features

- Listen mit Items (Häkchen, Menge + Einheit, Drag & Drop)
- Vorlagen, Massen-Hinzufügen, Liste zurücksetzen
- Öffentlicher Read-Only-Link mit QR-Code
- Mitnutzer mit Lese-/Bearbeitungsrechten
- Erinnerungen per E-Mail (APScheduler)
- Notizen mit Markdown-Editor und Tags
- Admin-Bereich (Benutzer anlegen, einladen, deaktivieren, Passwort zurücksetzen)
- JWT-Auth (Access in Memory, Refresh als httpOnly-Cookie)
- PWA: installierbar, offline-fähig, Hintergrund-Sync für Häkchen-Toggles via IndexedDB

## Architektur

```
backend/   FastAPI + SQLAlchemy (async) + Alembic + APScheduler + Resend
frontend/  Vite + React + TS + Tailwind + Zustand + dnd-kit + vite-plugin-pwa
```

## Schnellstart (Docker)

```bash
cp .env.example .env
# In .env: SECRET_KEY setzen und ggf. RESEND_API_KEY
docker compose up --build
```

Dann öffnen:
- App: http://localhost:5173
- API: http://localhost:8000/api/health
- Admin-Login: `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` aus deiner `.env`

Die Migrationen und das Anlegen des Admin-Users laufen automatisch beim Backend-Start
(`alembic upgrade head && python -m app.seed`).

## Lokale Entwicklung

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql+asyncpg://lyst:lyst@localhost:5432/lyst
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev    # Dev-Server auf http://localhost:5173 mit /api proxy auf :8000
```

## Konfiguration

Alle Settings via Umgebungsvariablen (siehe `.env.example`).

| Variable | Zweck |
|---|---|
| `DATABASE_URL` | PostgreSQL Connection String (asyncpg) |
| `SECRET_KEY` | Signiert JWTs — **muss** in Produktion lang & zufällig sein |
| `RESEND_API_KEY` | API-Key von [resend.com](https://resend.com); leer = E-Mails nur loggen |
| `RESEND_FROM_EMAIL` | Absender, z.B. `Lyst <noreply@deine-domain.app>` |
| `FRONTEND_URL` | Wird in Mail-Links und CORS verwendet |
| `BACKEND_CORS_ORIGINS` | komma-separierte Liste erlaubter Origins |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Default 15 |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Default 7 |
| `INITIAL_ADMIN_*` | Initialer Admin (nur beim ersten Start angelegt) |

## API-Antwortformat

```json
{ "data": <result>, "error": null }
```

Fehler werden als HTTP-Statuscodes mit Pydantic-`detail` zurückgegeben; das Frontend normalisiert diese in `getApiError`.

## PWA / Offline

- Service Worker (`src/sw.ts`) cached statische Assets, Listen, Notizen und Tags
  (stale-while-revalidate).
- Häkchen-Toggles, die offline fehlschlagen, werden in IndexedDB gepuffert
  (`src/lib/offlineQueue.ts`) und beim nächsten `online`-Event automatisch synchronisiert.

## Sicherheit

- Bcrypt-Passwörter (passlib)
- JWT mit Token-Type-Validierung (`access`, `refresh`, `reset`, `invite`)
- Rate Limiting auf `/auth/*` (slowapi)
- Public Share-Endpoint nur read-only via UUID-Token
- CORS nur für konfigurierte Origins

## Lizenz

Privat.
