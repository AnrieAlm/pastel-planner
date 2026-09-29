# Calyx Planner - Stage 1: every page is served by FastAPI + Jinja2 with mock data.
# No login or database yet; those arrive in Stage 2.

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from auth import checkRequest
from db import createIndexes


# Runs once when the server starts: makes sure the database indexes exist
@asynccontextmanager
async def lifespan(app):
    try:
        createIndexes()
    except Exception as error:
        # Do not crash the whole site if Atlas is slow to answer; just say so in the logs
        print("Could not create indexes yet:", error)
    yield


# Create the web app
app = FastAPI(lifespan=lifespan)

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
def renderPage(request: Request, templateName: str, section: str, extra=None):
    context = {"section": section}
    if extra:
        context.update(extra)
    return templates.TemplateResponse(request, templateName, context)


# Small helper used at the start of every page route.
# Returns (user, None) when the person is logged in, or (None, redirect) when they are not.
def getUserOrRedirect(request: Request):
    status, user = checkRequest(request)
    if status == "ok":
        return user, None
    if status == "denied":
        return None, RedirectResponse("/login?reason=denied", status_code=302)
    return None, RedirectResponse("/login", status_code=302)


# Login page. Someone who is already logged in is sent straight to Today.
@app.get("/login", response_class=HTMLResponse)
def loginPage(request: Request):
    status, user = checkRequest(request)
    if status == "ok":
        return RedirectResponse("/", status_code=302)
    reason = "denied" if request.query_params.get("reason") == "denied" else ""
    return renderPage(request, "login.html", "login", {"reason": reason})


# Today
@app.get("/", response_class=HTMLResponse)
def todayPage(request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect
    return renderPage(request, "today.html", "today", {"user": user})


# Routine
@app.get("/routine", response_class=HTMLResponse)
def routinePage(request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect
    return renderPage(request, "routine.html", "routine", {"user": user})


# Notes
@app.get("/notes", response_class=HTMLResponse)
def notesPage(request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect
    return renderPage(request, "notes.html", "notes", {"user": user})


# Calendar
@app.get("/calendar", response_class=HTMLResponse)
def calendarPage(request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect
    return renderPage(request, "calendar.html", "calendar", {"user": user})


# Habits
@app.get("/habits", response_class=HTMLResponse)
def habitsPage(request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect
    return renderPage(request, "habits.html", "habits", {"user": user})


# Grocery list
@app.get("/grocery", response_class=HTMLResponse)
def groceryPage(request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect
    return renderPage(request, "grocery.html", "grocery", {"user": user})


# Bucket list (the URL is /bucket, the sidebar key is "bucketlist")
@app.get("/bucket", response_class=HTMLResponse)
def bucketPage(request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect
    return renderPage(request, "bucket.html", "bucketlist", {"user": user})


# Settings
@app.get("/settings", response_class=HTMLResponse)
def settingsPage(request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect
    return renderPage(request, "settings.html", "settings", {"user": user})


# JSON route used to check that login works. A JSON route answers 401 (not a redirect) when
# the token is invalid, because fetch() calls cannot follow a redirect to a login page nicely.
@app.get("/api/me")
def apiMe(request: Request):
    status, user = checkRequest(request)
    if status != "ok":
        return JSONResponse({"error": "not logged in"}, status_code=401)
    return {"user_id": user["user_id"], "name": user["name"], "timezone": user["timezone"]}


# Health check: handy for testing the server is up
@app.get("/health")
def health():
    return {"status": "ok"}
