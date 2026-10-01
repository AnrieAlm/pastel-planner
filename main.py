

import os
import time
from uuid import uuid4
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit

from fastapi import FastAPI, Form, Request
from pydantic import BaseModel
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from fastapi.templating import Jinja2Templates

from auth import checkRequest
from calendar_helpers import (buildGoogleCalendarLink, buildHabitIcs, buildIcs, getCalendarView,
                              habitCalendarLink, safeFileName)
from bucket_helpers import (addBucketItem, deleteBucketItem, getBucketItems, moveBucketNotesToWishList,
                            planBucketItem, restoreBucketItem, toggleBucketDone, updateBucketItem)
from db import createIndexes, devices, notes, users
from icons import ICONS, makeIcon
from grocery_helpers import (addItems, clearChecked, getGroceryItems, removeItems, restoreBatch,
                             setChecked)
from habits_helpers import (NAME_MAX, SLOT_LIMIT, cleanDays, getHabitState, getHabitsForToday,
                            getHabitsView, setHabitLog)
from routine_helpers import (addRoutine, buildBlocks, cleanDays as cleanRoutineDays, deleteRoutine,
                             findOverlaps, getDoneBlockIds, getRoutines, getTodayBlocks,
                             mergeRoutines, toggleBlockDone, updateRoutine)
from notes_helpers import (FILTERS, CONTENT_MAX, TITLE_MAX, cleanColor, cleanDate, cleanFinishBy,
                           cleanReminder, cleanText, cleanTime, getNotes, getToday, getTodayView,
                           reminderLocalValue, resolveWhen, sameInstant, toObjectId)


# Runs once when the server starts: makes sure the database indexes exist
@asynccontextmanager
async def lifespan(app):
    try:
        createIndexes()
    except Exception as error:
        # Do not crash the whole site if Atlas is slow to answer; just say so in the logs
        print("Could not create indexes yet:", error)
    try:
        # One-time tidy-up: wishes that were saved as notes move to the separate wish list
        moved = moveBucketNotesToWishList()
        if moved:
            print(f"Moved {moved} old bucket-list note(s) to the wish list.")
    except Exception as error:
        print("Could not tidy old bucket-list notes yet:", error)
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


# ---------- App install files (PWA). These are public on purpose: the browser needs them before anyone logs in.
# They are served from the site root (not /static/) so they control the whole app.

# The app's "ID card": name, colours and icons, so it can be added to the home screen
@app.get("/manifest.json")
def manifest():
    return Response(Path("manifest.json").read_text(), media_type="application/manifest+json",
                    headers={"Cache-Control": "no-cache"})


# The service worker. __VERSION__ becomes the deploy's version number, so each deploy refreshes the kept files.
@app.get("/sw.js")
def serviceWorker():
    source = Path("sw.js").read_text().replace("__VERSION__", templates.env.globals["assetVersion"])
    return Response(source, media_type="application/javascript",
                    headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})


# The "Waking things up..." page (also used when you are offline)
@app.get("/waking", response_class=HTMLResponse)
def wakingPage(request: Request):
    return templates.TemplateResponse(request, "waking.html", {})


# The app icons, drawn by icons.py
@app.get("/icons/{name}")
def appIcon(name: str):
    png = makeIcon(name) if name in ICONS else None
    if png is None:
        return PlainTextResponse("Not found", status_code=404)
    return Response(png, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


# Browsers ask for /favicon.ico on their own
@app.get("/favicon.ico")
def favicon():
    return Response(makeIcon("favicon-32.png"), media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400"})


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
    today = getToday(user["timezone"])
    routineBlocks = getTodayBlocks(user["user_id"], today)
    doneBlockIds = getDoneBlockIds(user["user_id"], today.isoformat())
    return renderPage(request, "today.html", "today",
                      {"user": user, **getTodayView(user), "habits": getHabitsForToday(user),
                       "routineBlocks": routineBlocks, "doneBlockIds": doneBlockIds})


# Routine: every routine, each editable in place (see routine.js)
@app.get("/routine", response_class=HTMLResponse)
def routinePage(request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect
    return renderPage(request, "routine.html", "routine",
                      {"user": user, "routines": getRoutines(user["user_id"]),
                       "userHabits": user.get("habits", [])})


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


# Calendar: a month grid, with the selected day's notes shown beside or below it
@app.get("/calendar", response_class=HTMLResponse)
def calendarPage(request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect
    view = getCalendarView(user, request.query_params.get("month"), request.query_params.get("day"))
    return renderPage(request, "calendar.html", "calendar", {"user": user, "cal": view})


# Habits: three slots, each with a 7-day strip and a gentle streak
@app.get("/habits", response_class=HTMLResponse)
def habitsPage(request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect
    return renderPage(request, "habits.html", "habits", {"user": user, "hv": getHabitsView(user)})


# Grocery list: this person's own shopping list
@app.get("/grocery", response_class=HTMLResponse)
def groceryPage(request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect
    return renderPage(request, "grocery.html", "grocery",
                      {"user": user, "groceryItems": getGroceryItems(user["user_id"])})


# Bucket list (the URL is /bucket): a wish list, completely separate from notes
@app.get("/bucket", response_class=HTMLResponse)
def bucketPage(request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect
    bucket = getBucketItems(user["user_id"], user["timezone"])
    return renderPage(request, "bucket.html", "bucketlist", {"user": user, "bucket": bucket})


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
            time: str = Form(""), deadline: str = Form(""), finishBy: str = Form("", alias="finish_by"),
            when: str = Form(""), remind: str = Form(""), nextUrl: str = Form("/notes", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    cleanTitle = cleanText(title, TITLE_MAX)
    if cleanTitle:
        # The capture box sends "today" or a weekday name instead of an exact date;
        # we turn it into a date using the person's own timezone
        noteDate = cleanDate(date) or resolveWhen(when, getToday(user["timezone"]))
        noteDeadline = cleanDate(deadline)
        notes.insert_one({
            "user_id": user["user_id"],
            "title": cleanTitle,
            "content": cleanText(content, CONTENT_MAX),
            "color": cleanColor(color),
            "created_at": datetime.now(timezone.utc),
            "date": noteDate,
            "time": cleanTime(time) if noteDate else None,
            "deadline": noteDeadline,
            "finish_by": cleanFinishBy(finishBy, noteDeadline),
            "urgent": urgent == "on",
            "reminder_at": cleanReminder(remind, user["timezone"]),
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
               time: str = Form(""), deadline: str = Form(""), finishBy: str = Form("", alias="finish_by"),
               remind: str = Form(""), nextUrl: str = Form("/notes", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    objectId = toObjectId(noteId)
    if objectId is not None:
        existing = notes.find_one({"_id": objectId, "user_id": user["user_id"], "deleted_at": None})
        if existing:
            noteDate = cleanDate(date)
            noteDeadline = cleanDate(deadline)
            newReminder = cleanReminder(remind, user["timezone"])
            changes = {
                "content": cleanText(content, CONTENT_MAX),
                "color": cleanColor(color),
                "urgent": urgent == "on",
                "date": noteDate,
                "time": cleanTime(time) if noteDate else None,
                "deadline": noteDeadline,
                "finish_by": cleanFinishBy(finishBy, noteDeadline),
                "reminder_at": newReminder,
            }
            # Only reset reminder_sent when the reminder time actually changed — editing
            # something else about an already-reminded note should not send it again
            if not sameInstant(newReminder, existing.get("reminder_at")):
                changes["reminder_sent"] = False
            # An empty title is ignored, so a note never ends up with no name
            cleanTitle = cleanText(title, TITLE_MAX)
            if cleanTitle:
                changes["title"] = cleanTitle
            notes.update_one({"_id": objectId, "user_id": user["user_id"], "deleted_at": None},
                             {"$set": changes})
    return RedirectResponse(safeNext(nextUrl), status_code=302)


# ---------- Bucket list (wish list). Its own collection: nothing here is a note, and nothing here
# ---------- appears in Today, the Calendar or the Notes page. Every route only touches THIS user's items.

# Add a wish (from the "Add to bucket list" sheet)
@app.post("/add-bucket")
def addBucket(request: Request, title: str = Form(""), category: str = Form(""), link: str = Form(""),
              nextUrl: str = Form("/bucket", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    addBucketItem(user["user_id"], title, category, link)
    return RedirectResponse(safeNext(nextUrl, "/bucket"), status_code=302)


# Change a wish's title, category and link
@app.post("/set-bucket/{itemId}")
def setBucket(itemId: str, request: Request, title: str = Form(""), category: str = Form(""),
              link: str = Form(""), nextUrl: str = Form("/bucket", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    updateBucketItem(user["user_id"], itemId, title, category, link)
    return RedirectResponse(safeNext(nextUrl, "/bucket"), status_code=302)


# "Plan it": a day you would like to do it (stays inside the bucket list; empty clears it)
@app.post("/plan-bucket/{itemId}")
def planBucket(itemId: str, request: Request, date: str = Form(""),
               nextUrl: str = Form("/bucket", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    planBucketItem(user["user_id"], itemId, date)
    return RedirectResponse(safeNext(nextUrl, "/bucket"), status_code=302)


# Mark a wish done (saving the date), or put it back on the list
@app.post("/toggle-bucket/{itemId}")
def toggleBucket(itemId: str, request: Request, nextUrl: str = Form("/bucket", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    toggleBucketDone(user["user_id"], itemId)
    return RedirectResponse(safeNext(nextUrl, "/bucket"), status_code=302)


# Remove a wish (it can be brought back with Undo)
@app.post("/delete-bucket/{itemId}")
def deleteBucket(itemId: str, request: Request, nextUrl: str = Form("/bucket", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    if deleteBucketItem(user["user_id"], itemId):
        # ?removed=<id> makes the page show the "Undo" message
        return RedirectResponse(withParam(safeNext(nextUrl, "/bucket"), "removed", itemId), status_code=302)
    return RedirectResponse(safeNext(nextUrl, "/bucket"), status_code=302)


# JSON route used by the bucket list's Undo button. Answers 401 if not logged in.
@app.post("/api/bucket/{itemId}/restore")
def apiBucketRestore(itemId: str, request: Request):
    status, user = checkRequest(request)
    if status != "ok":
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not restoreBucketItem(user["user_id"], itemId):
        return JSONResponse({"error": "not found"}, status_code=404)
    return {"ok": True}


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


# "From yesterday" choices: move an unfinished note to today, give it a new date, or let it go
@app.post("/rollover/{noteId}")
def rolloverNote(noteId: str, request: Request, action: str = Form(""),
                 newDate: str = Form("", alias="new_date"), nextUrl: str = Form("/", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    objectId = toObjectId(noteId)
    changes = None
    if action == "today":
        changes = {"date": getToday(user["timezone"]).isoformat(), "dismissed": False}
    elif action == "new-date" and cleanDate(newDate):
        changes = {"date": cleanDate(newDate), "dismissed": False}
    elif action == "let-go":
        # Not deleted: the note stays in Notes, it just stops appearing under "From yesterday"
        changes = {"dismissed": True}

    if objectId is not None and changes:
        notes.update_one({"_id": objectId, "user_id": user["user_id"], "deleted_at": None},
                         {"$set": changes})
    return RedirectResponse(safeNext(nextUrl, "/"), status_code=302)


# ---------- Add to calendar. Links and files are made from the SAVED note, in the person's timezone.

# Sends the .ics file for one note (it has a reminder built in)
@app.get("/notes/{noteId}/ics")
def noteIcs(noteId: str, request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    objectId = toObjectId(noteId)
    note = notes.find_one({"_id": objectId, "user_id": user["user_id"], "deleted_at": None}) if objectId else None
    content = buildIcs(note, user["timezone"]) if note else None
    if content is None:
        return PlainTextResponse("Not found", status_code=404)
    return Response(content, media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{safeFileName(note["title"], "note")}"'})


# Opens Google Calendar with this note filled in (the link is built on the server)
@app.get("/notes/{noteId}/gcal")
def noteGoogleCalendar(noteId: str, request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    objectId = toObjectId(noteId)
    note = notes.find_one({"_id": objectId, "user_id": user["user_id"], "deleted_at": None}) if objectId else None
    if not note:
        return PlainTextResponse("Not found", status_code=404)
    return RedirectResponse(buildGoogleCalendarLink(note, user["timezone"]), status_code=302)


# The habit as a repeating .ics event
@app.get("/habits/{habitId}/ics")
def habitIcs(habitId: str, request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    habit = next((h for h in user.get("habits", []) if h["habit_id"] == habitId), None)
    if not habit:
        return PlainTextResponse("Not found", status_code=404)
    return Response(buildHabitIcs(habit, user["timezone"]), media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{safeFileName(habit["name"], "habit")}"'})


# The habit as a repeating Google Calendar event
@app.get("/habits/{habitId}/gcal")
def habitGoogleCalendar(habitId: str, request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    habit = next((h for h in user.get("habits", []) if h["habit_id"] == habitId), None)
    if not habit:
        return PlainTextResponse("Not found", status_code=404)
    return RedirectResponse(habitCalendarLink(habit, user["timezone"]), status_code=302)


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


# ---------- Habits. They live inside the user document (max 3), so every change targets
# ---------- the user document of the logged-in person only.

# Add a habit (no habit_id) or change one (with habit_id)
@app.post("/save-habit")
def saveHabit(request: Request, habitId: str = Form("", alias="habit_id"), name: str = Form(""),
              time: str = Form(""), days: str = Form(""), active: str = Form(""),
              nextUrl: str = Form("/habits", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    cleanName = cleanText(name, NAME_MAX)
    if cleanName:
        fields = {"name": cleanName, "time": cleanTime(time), "days": cleanDays(days), "active": active == "on"}
        if habitId:
            users.update_one({"user_id": user["user_id"], "habits.habit_id": habitId},
                             {"$set": {"habits.$." + key: value for key, value in fields.items()}})
        else:
            # Only adds if there are fewer than 3 habits, so the 3 slots can never overflow
            users.update_one({"user_id": user["user_id"], f"habits.{SLOT_LIMIT - 1}": {"$exists": False}},
                             {"$push": {"habits": {"habit_id": uuid4().hex[:12], **fields}}})
    return RedirectResponse(safeNext(nextUrl, "/habits"), status_code=302)


# Take a habit out, which frees its slot
@app.post("/remove-habit/{habitId}")
def removeHabit(habitId: str, request: Request, nextUrl: str = Form("/habits", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    users.update_one({"user_id": user["user_id"]}, {"$pull": {"habits": {"habit_id": habitId}}})
    return RedirectResponse(safeNext(nextUrl, "/habits"), status_code=302)


# What the tick button sends: which day, and whether it is now done
class HabitLogBody(BaseModel):
    date: str = ""
    done: bool = True


# JSON route: tick or un-tick a habit on a day (today, or up to 14 days back).
# Answers 401 if not logged in, and sends back the new streak words for the page to show.
@app.post("/api/habits/{habitId}/log")
def apiHabitLog(habitId: str, body: HabitLogBody, request: Request):
    status, user = checkRequest(request)
    if status != "ok":
        return JSONResponse({"error": "not logged in"}, status_code=401)

    if habitId not in [h["habit_id"] for h in user.get("habits", [])]:
        return JSONResponse({"error": "not found"}, status_code=404)

    today = getToday(user["timezone"])
    day = cleanDate(body.date) or today.isoformat()
    if day > today.isoformat() or day < (today - timedelta(days=14)).isoformat():
        return JSONResponse({"error": "that day can't be changed"}, status_code=400)

    setHabitLog(user["user_id"], habitId, day, body.done)
    state = getHabitState(user, habitId)
    return {"ok": True, "date": day, "done": body.done, **state}


# ---------- Routines. Several can be active on the same day; Today merges all of them into
# ---------- one timeline. Ticking a block also ticks its linked habit, if it has one.

# Checks whether a routine (new or being edited) would collide in time with another active
# routine on a shared day. A JSON route so the editor can warn BEFORE saving, without losing
# whatever the person has typed so far.
class RoutineCheckBody(BaseModel):
    routine_id: str = ""
    days: list[str] = []
    times: list[str] = []
    names: list[str] = []
    durations: list[str] = []


@app.post("/api/routines/check-overlap")
def apiCheckRoutineOverlap(body: RoutineCheckBody, request: Request):
    status, user = checkRequest(request)
    if status != "ok":
        return JSONResponse({"error": "not logged in"}, status_code=401)

    userHabitIds = {h["habit_id"] for h in user.get("habits", [])}
    days = cleanRoutineDays(",".join(body.days))
    blocks = buildBlocks(body.times, body.names, body.durations, [""] * len(body.times), userHabitIds)
    excludeId = toObjectId(body.routine_id) if body.routine_id else None
    return {"conflicts": findOverlaps(user["user_id"], days, blocks, excludeId)}


# Add a routine (the editor sends its blocks as matching lists: times[], names[], durations[],
# habits[] — one entry per row, in the order they appear on the page)
@app.post("/add-routine")
def addRoutineRoute(request: Request, name: str = Form(""), days: str = Form(""),
                    times: list[str] = Form([]), names: list[str] = Form([]),
                    durations: list[str] = Form([]), habits: list[str] = Form([]),
                    nextUrl: str = Form("/routine", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    userHabitIds = {h["habit_id"] for h in user.get("habits", [])}
    blocks = buildBlocks(times, names, durations, habits, userHabitIds)
    addRoutine(user["user_id"], name, cleanRoutineDays(days), blocks)
    return RedirectResponse(safeNext(nextUrl, "/routine"), status_code=302)


# Save changes to a routine
@app.post("/update-routine/{routineId}")
def updateRoutineRoute(routineId: str, request: Request, name: str = Form(""), days: str = Form(""),
                       active: str = Form(""), times: list[str] = Form([]), names: list[str] = Form([]),
                       durations: list[str] = Form([]), habits: list[str] = Form([]),
                       nextUrl: str = Form("/routine", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    userHabitIds = {h["habit_id"] for h in user.get("habits", [])}
    blocks = buildBlocks(times, names, durations, habits, userHabitIds)
    updateRoutine(user["user_id"], routineId, name, cleanRoutineDays(days), blocks, active == "on")
    return RedirectResponse(safeNext(nextUrl, "/routine"), status_code=302)


# Delete a routine. Unlike notes/bucket items/groceries, this is NOT soft-deleted — removing a
# whole routine is a deliberate, infrequent action, so there is no Undo for it.
@app.post("/delete-routine/{routineId}")
def deleteRoutineRoute(routineId: str, request: Request, nextUrl: str = Form("/routine", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    deleteRoutine(user["user_id"], routineId)
    return RedirectResponse(safeNext(nextUrl, "/routine"), status_code=302)

# Combines two of this person's routines into one (see routine_helpers.mergeRoutines). Offered
# from the overlap warning when editing/adding a routine clashes with another active one.
@app.post("/merge-routines/{keepId}/{mergeId}")
def mergeRoutinesRoute(keepId: str, mergeId: str, request: Request,
                       nextUrl: str = Form("/routine", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    mergeRoutines(user["user_id"], keepId, mergeId)
    return RedirectResponse(safeNext(nextUrl, "/routine"), status_code=302)
# JSON: tick (or un-tick) one of today's routine blocks. If it is linked to a habit, that habit
# is ticked too, and its fresh streak words are sent back so Today can update instantly.
class RoutineBlockBody(BaseModel):
    date: str = ""


@app.post("/api/routines/{routineId}/blocks/{blockId}/toggle")
def apiToggleRoutineBlock(routineId: str, blockId: str, body: RoutineBlockBody, request: Request):
    status, user = checkRequest(request)
    if status != "ok":
        return JSONResponse({"error": "not logged in"}, status_code=401)

    today = getToday(user["timezone"])
    day = cleanDate(body.date) or today.isoformat()
    ok, info = toggleBlockDone(user["user_id"], routineId, blockId, day)
    if not ok:
        return JSONResponse({"error": "not found"}, status_code=404)

    habitState = None
    if info["linkedHabitId"] and day == today.isoformat():
        setHabitLog(user["user_id"], info["linkedHabitId"], day, info["done"])
        habitState = getHabitState(user, info["linkedHabitId"])
    return {"ok": True, "done": info["done"], "habitId": info["linkedHabitId"], "habit": habitState}


# ---------- Grocery list. Forms for adding; small JSON routes for the instant actions
# ---------- (tick, remove, clear, undo). Every one only touches THIS user's items.

# Add one or more items (from the "Add to grocery list" sheet). "milk, eggs" adds two.
@app.post("/add-grocery")
def addGrocery(request: Request, name: str = Form(""), nextUrl: str = Form("/grocery", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    addItems(user["user_id"], name)
    return RedirectResponse(safeNext(nextUrl, "/grocery"), status_code=302)


# What the JSON routes below receive
class GroceryAddBody(BaseModel):
    name: str = ""


class GroceryCheckBody(BaseModel):
    checked: bool = True


class GroceryRemoveBody(BaseModel):
    ids: list[str] = []


class GroceryRestoreBody(BaseModel):
    batch: str = ""


# JSON: add items (used by Sinéad's "Add chicken to your list?" suggestion on Today)
@app.post("/api/grocery/add")
def apiGroceryAdd(body: GroceryAddBody, request: Request):
    status, user = checkRequest(request)
    if status != "ok":
        return JSONResponse({"error": "not logged in"}, status_code=401)
    return {"ok": True, "added": addItems(user["user_id"], body.name)}


# JSON: tick or un-tick one item
@app.post("/api/grocery/{itemId}/check")
def apiGroceryCheck(itemId: str, body: GroceryCheckBody, request: Request):
    status, user = checkRequest(request)
    if status != "ok":
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not setChecked(user["user_id"], itemId, body.checked):
        return JSONResponse({"error": "not found"}, status_code=404)
    return {"ok": True, "checked": body.checked}


# JSON: remove some items (they can be brought back with Undo)
@app.post("/api/grocery/remove")
def apiGroceryRemove(body: GroceryRemoveBody, request: Request):
    status, user = checkRequest(request)
    if status != "ok":
        return JSONResponse({"error": "not logged in"}, status_code=401)
    batch, count = removeItems(user["user_id"], body.ids)
    return {"ok": True, "batch": batch, "count": count}


# JSON: remove all the ticked items ("Clear done items")
@app.post("/api/grocery/clear")
def apiGroceryClear(request: Request):
    status, user = checkRequest(request)
    if status != "ok":
        return JSONResponse({"error": "not logged in"}, status_code=401)
    batch, count = clearChecked(user["user_id"])
    return {"ok": True, "batch": batch, "count": count}


# JSON: Undo for remove / clear
@app.post("/api/grocery/restore")
def apiGroceryRestore(body: GroceryRestoreBody, request: Request):
    status, user = checkRequest(request)
    if status != "ok":
        return JSONResponse({"error": "not logged in"}, status_code=401)
    count = restoreBatch(user["user_id"], body.batch)
    if not count:
        return JSONResponse({"error": "nothing to undo"}, status_code=404)
    return {"ok": True, "count": count}


# ---------- Push notifications (Stage 8). The live app only stores WHICH devices should get a
# ---------- push; the actual sending happens in reminders.py, run on a schedule by GitHub Actions.

# Public, tiny settings the browser needs before it can register for push. The VAPID key is a
# public key (that is how Web Push works) so there is nothing sensitive in this response.
@app.get("/api/config")
def apiConfig():
    return {"vapidKey": os.environ.get("VAPID_KEY", "")}


class DeviceBody(BaseModel):
    token: str = ""


# Saves (or refreshes) this browser's push token against the logged-in person.
# The same token can only ever belong to one person at a time (see db.py's unique index),
# so signing in as someone else on the same device quietly moves the token to them.
@app.post("/api/devices")
def apiRegisterDevice(body: DeviceBody, request: Request):
    status, user = checkRequest(request)
    if status != "ok":
        return JSONResponse({"error": "not logged in"}, status_code=401)
    token = body.token.strip()
    if not token:
        return JSONResponse({"error": "no token"}, status_code=400)

    devices.update_one(
        {"fcm_token": token},
        {"$set": {"user_id": user["user_id"], "fcm_token": token, "updated_at": datetime.now(timezone.utc)},
         "$setOnInsert": {"created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"ok": True}


# Forgets this browser's token (Settings > Push notifications, switched off)
@app.delete("/api/devices")
def apiUnregisterDevice(body: DeviceBody, request: Request):
    status, user = checkRequest(request)
    if status != "ok":
        return JSONResponse({"error": "not logged in"}, status_code=401)
    devices.delete_one({"fcm_token": body.token.strip(), "user_id": user["user_id"]})
    return {"ok": True}


# Health check: handy for testing the server is up
@app.get("/health")
def health():
    return {"status": "ok"}
