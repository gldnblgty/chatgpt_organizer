# ChatGPT Conversation Organizer (Refactored)

Clean separation of concerns **+ rate limiting + Docker + tests**

## Structure
- `app/__init__.py` – app factory, CORS, **Flask-Limiter** init
- `app/routes/api.py` – `/api/*` endpoints (**with per-route limits**)
- `app/services/` – jobs, time grouping, categorizer, in-memory store
- `app/utils/keys.py` – Fernet key management
- `app/extensions.py` – shared limiter object
- `app/templates/index.html` – HTML
- `app/static/css/style.css` – CSS
- `app/static/js/app.js` – JS
- `tests/` – pytest suite

## Run locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run.py
# http://localhost:5000
```

### Environment
Create a `.env` (optional) based on `.env.example`. Relevant vars:
- `RATELIMIT_DEFAULT` (e.g., `10 per second`)
- `RATELIMIT_STORAGE_URI` (`memory://` by default)
- `CORS_ORIGINS`, `SECRET_KEY`, `HOST`, `PORT`

## Docker

```bash
# Build & run
docker compose up --build
# App on http://localhost:5000
```

Hot-reloads via bind mount (`./:/app`).

## Testing

```bash
pip install -r requirements.txt
pip install pytest
python -m pytest tests/
```

### Rate limiting
- Default: `RATELIMIT_DEFAULT` (applied globally)
- Per-route overrides in `app/routes/api.py`:
  - `/register-key` – `5 per minute`
  - `/categorize` – `2 per minute`
  - `/progress/*` + `/result/*` – `30 per minute`

