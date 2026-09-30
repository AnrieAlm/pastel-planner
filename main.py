import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit
from uuid import uuid4

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from auth import checkRequest
from calendar_helpers import (buildGoogleCalendarLink, buildHabitIcs, buildIcs, getCalendarView,
                              habitCalendarLink, safeFileName)
from db import createIndexes, notes, users
from habits_helpers import (NAME_MAX, SLOT_LIMIT, cleanDays, getHabitState, getHabitsForToday,
                            getHabitsView, setHabitLog)
from notes_helpers import (FILTERS, CONTENT_MAX, TITLE_MAX, cleanBucket, cleanColor, cleanDate,
                           cleanFinishBy, cleanLink, cleanText, cleanTime, getBucketNotes, getNotes,
                           getToday, getTodayView, resolveWhen, toObjectId)

from grocery_helpers import (addItems, clearChecked, getGroceryItems, removeItems, restoreBatch,
                             setChecked)
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
    return renderPage(request, "today.html", "today",
                      {"user": user, **getTodayView(user), "habits": getHabitsForToday(user)})


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


# Bucket list (the URL is /bucket, the sidebar key is "bucketlist"): notes that have a bucket category
@app.get("/bucket", response_class=HTMLResponse)
def bucketPage(request: Request):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect
    bucket = getBucketNotes(user["user_id"], user["timezone"])
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

# Add a note (from the "New note" sheet, the Today capture box or the bucket list sheet)
@app.post("/add-note")
def addNote(request: Request, title: str = Form(""), content: str = Form(""),
            color: str = Form("1"), urgent: str = Form(""), date: str = Form(""),
            time: str = Form(""), deadline: str = Form(""), finishBy: str = Form("", alias="finish_by"),
            when: str = Form(""), bucket: str = Form(""), link: str = Form(""),
            nextUrl: str = Form("/notes", alias="next")):
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
            "bucket": cleanBucket(bucket),
            "link": cleanLink(link),
            "deadline": noteDeadline,
            "finish_by": cleanFinishBy(finishBy, noteDeadline),
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
               time: str = Form(""), deadline: str = Form(""), finishBy: str = Form("", alias="finish_by"),
               bucket: str = Form(""), hasBucket: str = Form("", alias="has_bucket"),
               nextUrl: str = Form("/notes", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    objectId = toObjectId(noteId)
    if objectId is not None:
        noteDate = cleanDate(date)
        noteDeadline = cleanDate(deadline)
        changes = {
            "content": cleanText(content, CONTENT_MAX),
            "color": cleanColor(color),
            "urgent": urgent == "on",
            "date": noteDate,
            "time": cleanTime(time) if noteDate else None,
            "deadline": noteDeadline,
            "finish_by": cleanFinishBy(finishBy, noteDeadline),
        }
        # The bucket choice is only changed if the sheet says it included one (has_bucket=1).
        # An empty choice then means "not on the bucket list".
        if hasBucket == "1":
            changes["bucket"] = cleanBucket(bucket)
        # An empty title is ignored, so a note never ends up with no name
        cleanTitle = cleanText(title, TITLE_MAX)
        if cleanTitle:
            changes["title"] = cleanTitle
        notes.update_one({"_id": objectId, "user_id": user["user_id"], "deleted_at": None},
                         {"$set": changes})
    return RedirectResponse(safeNext(nextUrl), status_code=302)


# Edit a bucket list item: its title, category and link (nothing else about the note changes)
@app.post("/set-bucket/{noteId}")
def setBucket(noteId: str, request: Request, title: str = Form(""), bucket: str = Form(""),
              link: str = Form(""), nextUrl: str = Form("/bucket", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    objectId = toObjectId(noteId)
    if objectId is not None:
        changes = {"link": cleanLink(link)}
        if cleanBucket(bucket):
            changes["bucket"] = cleanBucket(bucket)
        cleanTitle = cleanText(title, TITLE_MAX)
        if cleanTitle:
            changes["title"] = cleanTitle
        notes.update_one({"_id": objectId, "user_id": user["user_id"], "deleted_at": None},
                         {"$set": changes})
    return RedirectResponse(safeNext(nextUrl, "/bucket"), status_code=302)


# "Plan it": give a note a date (an empty date takes the plan away again)
@app.post("/set-date/{noteId}")
def setDate(noteId: str, request: Request, date: str = Form(""),
            nextUrl: str = Form("/bucket", alias="next")):
    user, redirect = getUserOrRedirect(request)
    if redirect:
        return redirect

    objectId = toObjectId(noteId)
    if objectId is not None:
        newDate = cleanDate(date)
        changes = {"date": newDate}
        if not newDate:
            changes["time"] = None
        notes.update_one({"_id": objectId, "user_id": user["user_id"], "deleted_at": None},
                         {"$set": changes})
    return RedirectResponse(safeNext(nextUrl, "/bucket"), status_code=302)


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
# Health check: handy for testing the server is up
@app.get("/health")
def health():
    return {"status": "ok"}
