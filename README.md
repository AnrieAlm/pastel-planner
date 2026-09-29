# Calyx Planner

A calm personal planner where everything starts as a post-it note.

Built with FastAPI, Jinja2, MongoDB Atlas, Firebase Auth and Groq. Hosted on Render.

Stage 1: all pages served by FastAPI with mock data (no login or database yet).

Run on your laptop:

    pip install -r requirements.txt
    uvicorn main:app --reload
    # open http://127.0.0.1:8000
