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
| `GROQ_API_KEY` | app | Free key from console.groq.com. Without it "Sort my day" quietly falls back to a plain note |
| `GROQ_WHISPER_MODEL` | app | Optional. Speech-to-text model for the microphone, defaults to `whisper-large-v3-turbo` |
| `GROQ_MODEL` | app | Optional. Defaults to `openai/gpt-oss-120b`. Groq retires models from time to time, so change this setting (no code change) if the default stops working |

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

## Sinéad (AI) - how "Sort my day" works

You type a brain-dump on the Today page. The text is sent to Groq (a third-party AI service) from
the server, which returns a *draft* list. You review it, tick what you want, and only then is
anything saved. If the AI is unavailable the app falls back to saving your words as one plain note.
Drafts are kept for 30 minutes and then deleted automatically.

Quick check that your key and model work (run from the repo folder with `GROQ_API_KEY` set):

    python -c "import ai; print(ai.extractDayItems('dentist at 2pm tomorrow, buy milk', {'timezone': 'Europe/Dublin'}))"

### The microphone

Tap the mic on the Today page, speak, tap again. The recording is sent to Groq (Whisper) from the
server and the words appear in the box so you can fix any mistakes before tapping Sort my day.
The audio is held in memory only while it is sent: the app never saves it. The microphone needs
https (Render gives you that; `http://localhost` also works). Recordings stop by themselves after 2 minutes.

### "Did you miss anything?" follow-up

After you confirm a real brain-dump (3 or more things), Sinéad may ask one gentle question about a
part of your day you didn't mention (meals, people, work, errands, travel, rest). Your answer, typed
or spoken, goes through the same review card. She asks at most twice, never after a one-liner, and you
can switch it off with the "Follow-up questions" toggle in Settings (or "Don't ask me these").

