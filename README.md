# Vibo

Music-based Mood DJ — Django backend + React frontend (Vite). Minimal prototype to upload tracks, generate mixes from a mood prompt and play in browser.

Quick start (development):

- Copy `.env.example` to `.env` and fill values (POSTGRES, REDIS optional, OPENAI_API_KEY optional).
- Start services with Docker Compose (requires Docker):

```powershell
# from repo root
docker-compose up --build
```

- Backend: http://localhost:8000
- Frontend: http://localhost:3000

Run locally with Docker Compose (recommended):

```powershell
# from repo root
copy .env.example .env
docker-compose up --build
```

If you prefer running services individually:

Backend (local, without Docker):

```powershell
cd backend
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
setx POSTGRES_HOST "localhost"
# ensure Postgres is running and env vars set, then:
python manage.py migrate
python manage.py runserver
```

Frontend (local):

```powershell
cd frontend
npm install
npm run dev
```

Key endpoints:
- `POST /api/tracks/upload/` — multipart upload (`file`, `title`)
- `GET /api/tracks/` — list tracks
- `POST /api/generate-mix/` — JSON { "prompt": "calm focus" }
- `GET /api/stats/top-tracks/` — cached top tracks

Notes:
- If `OPENAI_API_KEY` is set, the backend will attempt to call OpenAI to generate mixes; otherwise a local heuristic will run.
- Media files are stored in `media/` when running the backend container.

Next steps: finish wiring frontend UI and record demo video.
