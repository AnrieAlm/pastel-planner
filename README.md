# Calyx Planner

A calm personal planner where everything starts as a post-it note.

Built with FastAPI, Jinja2, MongoDB Atlas, Firebase Auth + Cloud Messaging, and (later) Groq.
Reminders are sent by a scheduled GitHub Action running `reminders.py`.

## Settings the app needs (environment variables)

Set these as secrets on your host (Render / Hugging Face) and, for the first three,
also as GitHub Actions secrets. **Never put them in the code.**

| Name | Used by | What it is |
|------|---------|------------|
| `MONGODB_URI` | app + reminders | Atlas connection string |
| `MONGODB_DB` | app + reminders | Database name (optional, defaults to `calyx-planner`) |
| `FIREBASE_SERVICE_ACCOUNT` | reminders (GitHub secret) | The service-account JSON, as text |
| `FIREBASE_PROJECT_ID` | app | Firebase project id (`pastel-planner-6a858`). Without it nobody can log in |
| `ALLOWED_EMAILS` | app | Comma-separated emails allowed in, e.g. `me@x.com,partner@y.com`. Without it nobody can log in |
| `VAPID_KEY` | app | Public Web Push key from Firebase > Cloud Messaging |

## Run on your laptop

    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    export MONGODB_URI="..." FIREBASE_PROJECT_ID="..." ALLOWED_EMAILS="you@example.com"
    uvicorn main:app --reload
    # open http://127.0.0.1:8000

## Reminders

`.github/workflows/reminders.yml` runs `reminders.py` about every 15 minutes. GitHub pauses
scheduled workflows on a repo with no activity for ~60 days: if reminders stop, open the
Actions tab and re-enable the workflow (or push any small commit).
