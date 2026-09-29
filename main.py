# Calyx Planner - Stage 1: every page is served by FastAPI + Jinja2 with mock data.
# No login or database yet; those arrive in Stage 2.

import time

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# Create the web app
app = FastAPI()

# Serve everything in static/ (css, js, images, modal snippets) at /static/...
app.mount("/static", StaticFiles(directory="static"), name="static")

# Tell Jinja2 where the HTML templates live
templates = Jinja2Templates(directory="templates")

# A version number that changes every time the server restarts (every deploy).
# base.html adds it to the CSS/JS links (style.css?v=123) so phones and
# browsers always fetch the new files instead of showing an old cached copy.
templates.env.globals["assetVersion"] = str(int(time.time()))


# Small helper: render one template. "section" tells base.html which
# sidebar/bottom-nav link to highlight.
def renderPage(request: Request, templateName: str, section: str):
    return templates.TemplateResponse(
        request, templateName, {"section": section}
    )


# Login page (the mock form just sends you to Today for now)
@app.get("/login", response_class=HTMLResponse)
def loginPage(request: Request):
    return renderPage(request, "login.html", "login")


# Today
@app.get("/", response_class=HTMLResponse)
def todayPage(request: Request):
    return renderPage(request, "today.html", "today")


# Routine
@app.get("/routine", response_class=HTMLResponse)
def routinePage(request: Request):
    return renderPage(request, "routine.html", "routine")


# Notes
@app.get("/notes", response_class=HTMLResponse)
def notesPage(request: Request):
    return renderPage(request, "notes.html", "notes")


# Calendar
@app.get("/calendar", response_class=HTMLResponse)
def calendarPage(request: Request):
    return renderPage(request, "calendar.html", "calendar")


# Habits
@app.get("/habits", response_class=HTMLResponse)
def habitsPage(request: Request):
    return renderPage(request, "habits.html", "habits")


# Grocery list
@app.get("/grocery", response_class=HTMLResponse)
def groceryPage(request: Request):
    return renderPage(request, "grocery.html", "grocery")


# Bucket list (the URL is /bucket, the sidebar key is "bucketlist")
@app.get("/bucket", response_class=HTMLResponse)
def bucketPage(request: Request):
    return renderPage(request, "bucket.html", "bucketlist")


# Settings
@app.get("/settings", response_class=HTMLResponse)
def settingsPage(request: Request):
    return renderPage(request, "settings.html", "settings")


# Health check: handy for testing the server is up
@app.get("/health")
def health():
    return {"status": "ok"}
