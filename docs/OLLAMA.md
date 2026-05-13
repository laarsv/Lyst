# Ollama (local AI)

Lyst can talk to a local [Ollama](https://ollama.com) server for three
features:

- **Shopping-item categorisation** — every item you add to a shopping list
  is auto-sorted into Obst & Gemüse / Milchprodukte / Tiefkühl / etc.
- **Recipe URL import** — paste a recipe URL, get a structured recipe back.
- **Recipe photo import** — snap or upload a photo of a recipe (book, card,
  screenshot), get the same structured recipe.
- **"Was kann ich kochen?"** — pick the top 3 recipes that match the
  ingredients you currently have on hand.

If no Ollama is reachable, all four features return a polite error and the
rest of the app keeps working. Ollama is **optional but recommended** —
the categorised shopping list is the killer feature for most people.

[Anthropic Claude](./CONFIGURATION.md#ai--anthropic-claude-optional) is
supported as a paid cloud alternative; the admin UI lets you switch
providers per-instance.

---

## Setup options

You can either point Lyst at an existing Ollama instance or add Ollama to
the same compose stack.

### Option A — Bring your own Ollama (recommended)

Most self-hosters already run Ollama for other tools. Just set
`OLLAMA_BASE_URL` in `.env` to wherever it lives:

```ini
# Ollama on the same host (Linux/Mac/Windows). Works thanks to the
# `extra_hosts: host.docker.internal:host-gateway` mapping in the
# bundled docker-compose.yml.
OLLAMA_BASE_URL=http://host.docker.internal:11434

# Ollama on another machine on your LAN
OLLAMA_BASE_URL=http://192.168.1.42:11434

# Ollama on a remote server (consider a VPN or HTTPS in front)
OLLAMA_BASE_URL=https://ollama.internal.example.com
```

Verify connectivity from inside the backend container:

```bash
docker compose exec backend python -c \
    "import httpx,os; r=httpx.get(os.environ['OLLAMA_BASE_URL']+'/api/tags'); print(r.json())"
```

You should see a JSON list of installed models. If you see a connection
error, Lyst can't reach Ollama — usually a firewall or wrong IP.

### Option B — Ollama as a sibling compose service

Drop this into your `docker-compose.yml` next to `backend:`:

```yaml
  ollama:
    image: ollama/ollama:latest
    restart: unless-stopped
    volumes:
      - ollama-data:/root/.ollama
    # Uncomment for NVIDIA GPU acceleration (requires nvidia-container-toolkit)
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: all
    #           capabilities: [gpu]
    # Optional: expose to the host so `ollama pull` from a CLI works
    # ports:
    #   - "127.0.0.1:11434:11434"

volumes:
  ollama-data:
```

…then point Lyst at it:

```ini
OLLAMA_BASE_URL=http://ollama:11434
```

After `docker compose up -d`, pull the models inside the new container:

```bash
docker compose exec ollama ollama pull llama3.1:8b
docker compose exec ollama ollama pull llava:7b
```

---

## Recommended models

These are the defaults in `.env.example`. Both fit on a small home server
(Mini PC / Raspberry Pi 5 with extra RAM works for text; vision wants a
GPU or ≥ 16 GB RAM).

| Variable | Default | Why this one |
|---|---|---|
| `OLLAMA_TEXT_MODEL` | `llama3.1:8b` | Good German output, ~5 GB on disk, runs on CPU at usable speed for one-word categorisation. Replace with `qwen2.5:7b` or `mistral:7b` if you prefer those — both work fine, all that matters is that they reliably return one of the 10 category labels. |
| `OLLAMA_VISION_MODEL` | `llava:7b` | Lightest vision model that handles recipe photos OK. `llama3.2-vision:11b` and `qwen2.5-vl:7b` produce noticeably better extractions if you have the RAM/VRAM. Set empty to disable photo import entirely. |

Pull whichever you pick on the Ollama host:

```bash
ollama pull llama3.1:8b
ollama pull llava:7b
```

The model name in `.env` must match `ollama list` exactly, including the
tag (`:8b`, `:7b`, etc.).

---

## `keep_alive` — why your first request used to be slow

Ollama unloads models from RAM after **5 minutes of idle by default**.
That means after lunch break, the next shopping-item categorisation pays
a 30–180 second model-reload cost — terrible UX.

Lyst sends a `keep_alive` value with every request to keep models hot.
Defaults from `.env.example`:

```ini
OLLAMA_TEXT_KEEP_ALIVE=-1   # text model stays loaded forever
OLLAMA_VISION_KEEP_ALIVE=1h # vision model unloads after 1h idle
```

Why the asymmetry: text categorisation is the hot path (every shopping
item triggers it), so paying the RAM cost permanently is the right
trade-off. Photo recipe import is rare, so we let RAM go after an hour.

The backend also fires a tiny warmup call to the text model during FastAPI
startup, so the very first user request after `docker compose up` is
already instant.

You can verify that models are actually held in memory from the admin
panel: **Admin → Einstellungen → Ollama-Status** shows `/api/ps` output —
the same data Ollama itself reports.

---

## Hardware requirements

These are rough guides — real performance depends on quantisation, CPU
generation, and disk speed for the cold load.

| Setup | Text categorisation | URL import | Photo import |
|---|---|---|---|
| Modern Mini PC, 16 GB RAM, no GPU | ✅ snappy with `llama3.1:8b` once warm | ✅ 5–15 s per recipe | ⚠️ slow (60–180 s); consider an Anthropic key |
| Same + 8 GB GPU (e.g. RTX 3060) | ✅ instant | ✅ 1–3 s | ✅ 5–15 s |
| Raspberry Pi 5 (8 GB) | ✅ usable with `llama3.1:8b` (≈ 1–3 s) | ⚠️ 30–60 s | ❌ unrealistic |
| Mac mini M2 / M-series | ✅ instant (Metal acceleration) | ✅ fast | ✅ usable |

If a model takes too long to load, consider switching the text model to a
smaller one (`qwen2.5:3b`, `phi3:mini`) — the categorisation prompt is
short enough that lighter models still produce the right labels.

---

## Troubleshooting

### "KI-Service nicht erreichbar"

Lyst can't reach the URL in `OLLAMA_BASE_URL`. Run the diagnostic httpx
one-liner from [Setup, Option A](#option-a--bring-your-own-ollama-recommended).
If that fails too, the URL or the network path is wrong, not Lyst.

### "Modell '…' ist nicht installiert"

You configured a model name that's not pulled on the Ollama host. Run
`ollama list` on the Ollama host to see what's actually there, then either
pull what you wanted or change `OLLAMA_TEXT_MODEL` / `OLLAMA_VISION_MODEL`.

### Categorisation is slow (> 5 s per item) even after warmup

The model is being unloaded between calls, probably because Ollama is
running with a different `OLLAMA_KEEP_ALIVE` env var on its side that
overrides per-request values. Check the Ollama host's environment.

The admin **Ollama-Status** page (`Admin → Einstellungen`) is the
fastest way to confirm: if the model isn't listed under "Geladen", the
text model isn't actually held in memory.

### Vision import returns garbage JSON

Some vision models (especially smaller ones) struggle with structured
output. Try a larger model (`llama3.2-vision:11b`, `qwen2.5-vl:7b`), or
fall back to URL import for that recipe. The structured JSON contract
itself is described in `backend/app/services/import_service.py`.
