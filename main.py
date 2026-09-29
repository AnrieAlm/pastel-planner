# Calyx Planner - main.py: all the routes (web addresses) of the app.
# Pages are drawn by Jinja2 templates; every route checks the login first.

import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from auth import checkRequest
from db import createIndexes, notes
from notes_helpers import (FILTERS, CONTENT_MAX, TITLE_MAX, cleanColor, cleanDate, cleanText,
                           cleanTime, getNotes, toObjectId)


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


# Only allow redirects to pages on our own site (stops "open redirect" tricks)
def safeNext(value, fallback="/notes"):
    if not value.startswith("/") or value.startswith("//") or "\\" in value:
        return fallback
    return value


# Adds ?key=value to a web address, replacing that key if it is already there
def withParam(url, key, value):
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query))
    query[key] = value
    return parts.path + "?" + urlencode(query)


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


# Notes page: shows this person's real notes, filtered by the chip they picked
@app.get("/notes", response_class=HTMLResponse)
def notesPage(request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect
    activeFilter = request.query_params.get("filter", "all")
    if activeFilter not in FILTERS:
        activeFilter = "all"
    noteList = getNotes(user["user_id"], activeFilter, user["timezone"])
    return renderPage(request, "notes.html", "notes",
                      {"user": user, "notes": noteList, "activeFilter": activeFilter})


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


# ---------- Note actions (forms). Each one checks the login first, only touches
# ---------- notes with THIS user's user_id, then redirects back with status 302.

# Add a note (from the "New note" sheet)
@app.post("/add-note")
def addNote(request: Request, title: str = Form(""), content: str = Form(""),
            color: str = Form("1"), urgent: str = Form(""), date: str = Form(""),
            time: str = Form(""), deadline: str = Form(""), nextUrl: str = Form("/notes", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    cleanTitle = cleanText(title, TITLE_MAX)
    if cleanTitle:
        noteDate = cleanDate(date)
        notes.insert_one({
            "user_id": user["user_id"],
            "title": cleanTitle,
            "content": cleanText(content, CONTENT_MAX),
            "color": cleanColor(color),
            "created_at": datetime.now(timezone.utc),
            "date": noteDate,
            "time": cleanTime(time) if noteDate else None,
            "bucket": None,
            "link": None,
            "deadline": cleanDate(deadline),
            "finish_by": None,
            "urgent": urgent == "on",
            "reminder_at": None,
            "reminder_sent": False,
            "done": False,
            "completed_at": None,
            "dismissed": False,
            "deleted_at": None,
        })
    return RedirectResponse(safeNext(nextUrl), status_code=302)


# Save changes to a note (from the "Edit note" sheet)
@app.post("/update-note/{noteId}")
def updateNote(noteId: str, request: Request, title: str = Form(""), content: str = Form(""),
               color: str = Form("1"), urgent: str = Form(""), date: str = Form(""),
               time: str = Form(""), deadline: str = Form(""), nextUrl: str = Form("/notes", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    objectId = toObjectId(noteId)
    if objectId is not None:
        noteDate = cleanDate(date)
        changes = {
            "content": cleanText(content, CONTENT_MAX),
            "color": cleanColor(color),
            "urgent": urgent == "on",
            "date": noteDate,
            "time": cleanTime(time) if noteDate else None,
            "deadline": cleanDate(deadline),
        }
        # An empty title is ignored, so a note never ends up with no name
        cleanTitle = cleanText(title, TITLE_MAX)
        if cleanTitle:
            changes["title"] = cleanTitle
        notes.update_one({"_id": objectId, "user_id": user["user_id"], "deleted_at": None},
                         {"$set": changes})
    return RedirectResponse(safeNext(nextUrl), status_code=302)


# Delete = set deleted_at (not a real delete) so Undo can bring the note back
@app.post("/delete-note/{noteId}")
def deleteNote(noteId: str, request: Request, nextUrl: str = Form("/notes", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    objectId = toObjectId(noteId)
    if objectId is None:
        return RedirectResponse(safeNext(nextUrl), status_code=302)
    result = notes.update_one({"_id": objectId, "user_id": user["user_id"], "deleted_at": None},
                              {"$set": {"deleted_at": datetime.now(timezone.utc)}})
    if result.matched_count:
        # ?deleted=<id> makes the page show the "Undo" message
        return RedirectResponse(withParam(safeNext(nextUrl), "deleted", noteId), status_code=302)
    return RedirectResponse(safeNext(nextUrl), status_code=302)


# Tick a note done, or un-tick it. completed_at is saved so we know when it was finished.
@app.post("/toggle-done/{noteId}")
def toggleDone(noteId: str, request: Request, nextUrl: str = Form("/notes", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    objectId = toObjectId(noteId)
    if objectId is not None:
        note = notes.find_one({"_id": objectId, "user_id": user["user_id"], "deleted_at": None})
        if note:
            nowDone = not note.get("done", False)
            notes.update_one({"_id": objectId, "user_id": user["user_id"]},
                             {"$set": {"done": nowDone,
                                       "completed_at": datetime.now(timezone.utc) if nowDone else None}})
    return RedirectResponse(safeNext(nextUrl), status_code=302)


# JSON route used by the Undo button (fetch). Answers 401 if not logged in.
@app.post("/api/undo-delete/{noteId}")
def apiUndoDelete(noteId: str, request: Request):
    status, user = checkRequest(request)
    if status != "ok":
        return JSONResponse({"error": "not logged in"}, status_code=401)

    objectId = toObjectId(noteId)
    if objectId is None:
        return JSONResponse({"error": "not found"}, status_code=404)
    result = notes.update_one({"_id": objectId, "user_id": user["user_id"], "deleted_at": {"$ne": None}},
                              {"$set": {"deleted_at": None}})
    if not result.matched_count:
        return JSONResponse({"error": "not found"}, status_code=404)
    return {"ok": True}


# Health check: handy for testing the server is up
@app.get("/health")
def health():
    return {"status": "ok"}
