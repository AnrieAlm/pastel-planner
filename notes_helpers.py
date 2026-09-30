# notes_helpers.py - reading notes from MongoDB and preparing them for the page.
# Every query here filters by user_id, so one person can never see another person's notes.

from datetime import date, datetime, timezone
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from bson import ObjectId
from bson.errors import InvalidId

from db import notes

TITLE_MAX = 200
CONTENT_MAX = 2000
FILTERS = ["all", "undated", "dated", "urgent", "done"]
BUCKETS = ["movies", "places", "things", "experiences"]


# Turns the id from a web address into a MongoDB ObjectId (or None if it is nonsense)
def toObjectId(noteId):
    try:
        return ObjectId(noteId)
    except (InvalidId, TypeError):
        return None


# Trims spaces and cuts text to a maximum length
def cleanText(value, maxLength):
    return (value or "").strip()[:maxLength]


# Colour must be a number from 1 to 5 (the five post-it colours); anything else becomes 1
def cleanColor(value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 1
    return number if 1 <= number <= 5 else 1


# Keeps a date only if it looks like YYYY-MM-DD; otherwise None
def cleanDate(value):
    try:
        return datetime.strptime(value or "", "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        return None


# Keeps a time only if it looks like HH:MM; otherwise None
def cleanTime(value):
    try:
        return datetime.strptime(value or "", "%H:%M").strftime("%H:%M")
    except ValueError:
        return None


# "Today" for this person. The server runs in UTC, so we use the person's own timezone.
def getToday(timezoneName):
    try:
        zone = ZoneInfo(timezoneName)
    except Exception:
        zone = ZoneInfo("Europe/Dublin")
    return datetime.now(zone).date()


# "14:30" -> "2:30pm", "09:00" -> "9am"
def niceTime(timeString):
    parsed = datetime.strptime(timeString, "%H:%M")
    hour = parsed.hour % 12 or 12
    suffix = "am" if parsed.hour < 12 else "pm"
    return f"{hour}{suffix}" if parsed.minute == 0 else f"{hour}:{parsed.minute:02d}{suffix}"


# "2026-09-29" -> "Today", "Tomorrow", "Fri" (within a week) or "Sat 3 Oct"
def dayLabel(dateString, today):
    day = date.fromisoformat(dateString)
    difference = (day - today).days
    if difference == 0:
        return "Today"
    if difference == 1:
        return "Tomorrow"
    if difference == -1:
        return "Yesterday"
    if 1 < difference < 7:
        return day.strftime("%a")
    return f"{day.strftime('%a')} {day.day} {day.strftime('%b')}"


# The small line at the bottom of a post-it
def describeNote(note, today):
    if note.get("done"):
        return "Done ✓"
    if note.get("date"):
        label = dayLabel(note["date"], today)
        if note.get("time"):
            label += " · " + niceTime(note["time"])
        return label
    if note.get("deadline"):
        return "Due " + dayLabel(note["deadline"], today)
  
    return "Undated"


# Gets one person's notes for a filter chip, ready to show on the Notes page
def getNotes(userId, filterName, timezoneName):
    query = {"user_id": userId, "deleted_at": None}
    sortBy = [("done", 1), ("created_at", -1)]

    if filterName == "undated":
        query.update({"done": False, "date": None, "deadline": None})
    elif filterName == "dated":
        query.update({"done": False, "$or": [{"date": {"$ne": None}}, {"deadline": {"$ne": None}}]})
        sortBy = [("date", 1), ("time", 1), ("created_at", -1)]
    
  
    
    elif filterName == "urgent":
        query.update({"done": False, "urgent": True})
    elif filterName == "done":
        query["done"] = True
        sortBy = [("completed_at", -1)]

    today = getToday(timezoneName)
    noteList = []
    for note in notes.find(query).sort(sortBy):
        note["id"] = str(note["_id"])
        note["meta"] = describeNote(note, today)
        noteList.append(note)
    return noteList



# ---------------------------------------------------------------------------
# Today page helpers (Stage 3b)
# ---------------------------------------------------------------------------

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


# The person's own timezone object (falls back to Dublin if the name is not valid)
def getZone(timezoneName):
    try:
        return ZoneInfo(timezoneName)
    except Exception:
        return ZoneInfo("Europe/Dublin")


# The finish-by date only counts if there is a deadline and it is on or before it
def cleanFinishBy(finishBy, deadline):
    cleaned = cleanDate(finishBy)
    if cleaned and deadline and cleaned <= deadline:
        return cleaned
    return None


# Turns "today", "tomorrow" or a weekday name into a YYYY-MM-DD date (or None).
# A weekday means its next occurrence, and today if it is that day already.
def resolveWhen(when, today):
    word = (when or "").strip().lower()
    if word == "today":
        return today.isoformat()
    if word == "tomorrow":
        return date.fromordinal(today.toordinal() + 1).isoformat()
    if word in WEEKDAYS:
        daysAway = (WEEKDAYS.index(word) - today.weekday()) % 7
        return date.fromordinal(today.toordinal() + daysAway).isoformat()
    return None


# Notes with a date between two days (inclusive), earliest first
def getNotesInRange(userId, startDay, endDay, includeDone=False):
    query = {"user_id": userId, "deleted_at": None, "date": {"$gte": startDay, "$lte": endDay}}
    if not includeDone:
        query["done"] = False
    return list(notes.find(query).sort([("date", 1), ("time", 1), ("created_at", 1)]))


# Everything planned for one day. Untimed notes come after timed ones.
def getNotesForDay(userId, day):
    found = list(notes.find({"user_id": userId, "deleted_at": None, "date": day}))
    found.sort(key=lambda n: (n.get("time") is None, n.get("time") or "", n["created_at"]))
    return found


# Unfinished notes from earlier days that have not been dealt with yet ("From yesterday")
def getRolloverNotes(userId, today):
    return list(notes.find({
        "user_id": userId, "deleted_at": None, "done": False, "dismissed": False,
        "date": {"$ne": None, "$lt": today.isoformat()},
    }).sort([("date", 1), ("time", 1)]))


# Notes to show under "Urgent": marked urgent, or with a deadline in the next 7 days (or past)
def getUrgentNotes(userId, today):
    lastDay = date.fromordinal(today.toordinal() + 7).isoformat()
    found = list(notes.find({
        "user_id": userId, "deleted_at": None, "done": False,
        "$or": [{"urgent": True}, {"deadline": {"$ne": None, "$lte": lastDay}}],
    }))
    found.sort(key=lambda n: (n.get("deadline") is None, n.get("deadline") or ""))
    return found


# The next 7 days (not including today): dated notes and deadlines, in date order
def getUpcomingNotes(userId, today):
    first = date.fromordinal(today.toordinal() + 1).isoformat()
    last = date.fromordinal(today.toordinal() + 7).isoformat()
    entries = []
    for note in getNotesInRange(userId, first, last):
        entries.append((note["date"], note.get("time") or "", note["title"], False))
    for note in notes.find({"user_id": userId, "deleted_at": None, "done": False,
                            "deadline": {"$gte": first, "$lte": last}}):
        entries.append((note["deadline"], "", note["title"], True))
    entries.sort()
    return entries


# Lower-cases "Today" / "Tomorrow" / "Yesterday" so they read well mid-sentence
def inSentence(label):
    return label.lower() if label in ("Today", "Tomorrow", "Yesterday") else label


# The second line of an urgent card, e.g. "Aim to finish Wed · 2 days to deadline"
def describeUrgent(note, today):
    parts = []
    deadline = note.get("deadline")
    finishBy = note.get("finish_by")
    if finishBy and finishBy >= today.isoformat():
        parts.append("Aim to finish " + inSentence(dayLabel(finishBy, today)))
    if deadline:
        daysLeft = (date.fromisoformat(deadline) - today).days
        if daysLeft < 0:
            parts.append("was due " + inSentence(dayLabel(deadline, today)))
        elif daysLeft == 0:
            parts.append("due today")
        else:
            parts.append(f"{daysLeft} day{'s' if daysLeft != 1 else ''} to deadline")
    return " · ".join(parts)


# Adds the display fields the templates use (id, time label, the details for the edit sheet)
def decorate(note, today):
    note["id"] = str(note["_id"])
    note["meta"] = describeNote(note, today)
    note["timeLabel"] = niceTime(note["time"]) if note.get("time") else "Anytime"
    return note


# Everything the Today page needs, in one go
def getTodayView(user):
    userId = user["user_id"]
    zone = getZone(user["timezone"])
    now = datetime.now(zone)
    today = now.date()

    if now.hour < 12:
        subtitle = "a quiet morning"
    elif now.hour < 18:
        subtitle = "a gentle afternoon"
    else:
        subtitle = "a calm evening"

    urgent = []
    for note in getUrgentNotes(userId, today):
        decorate(note, today)
        note["deadlineLabel"] = ("Due " + inSentence(dayLabel(note["deadline"], today))) if note.get("deadline") else "Marked urgent"
        note["detail"] = describeUrgent(note, today)
        urgent.append(note)

    upcoming = []
    for day, time, title, isDeadline in getUpcomingNotes(userId, today):
        label = dayLabel(day, today)
        text = title + (" (deadline)" if isDeadline else (" · " + niceTime(time) if time else ""))
        upcoming.append({"label": label, "text": text})

    return {
        "todayLabel": f"{today.strftime('%A')}, {today.day} {today.strftime('%B')}",
        "subtitle": subtitle,
        "urgent": urgent,
        "rollover": [decorate(n, today) for n in getRolloverNotes(userId, today)],
        "todayNotes": [decorate(n, today) for n in getNotesForDay(userId, today.isoformat())],
        "upcoming": upcoming,
    }


# ---------------------------------------------------------------------------
# Bucket list helpers (Stage 3d)
# ---------------------------------------------------------------------------

# A bucket category must be one of the four; anything else means "not on the bucket list" (None)
def cleanBucket(value):
    word = (value or "").strip().lower()
    return word if word in BUCKETS else None


# Only normal web links are kept (http or https). Anything else, like "javascript:...", becomes None.
def cleanLink(value):
    text = (value or "").strip()
    if not text or len(text) > 500 or any(ch.isspace() for ch in text):
        return None
    parts = urlsplit(text)
    if parts.scheme in ("http", "https") and parts.netloc:
        return text
    return None


# "https://www.imdb.com/title/x" -> "imdb.com"
def linkHost(link):
    host = urlsplit(link).hostname or ""
    return host[4:] if host.startswith("www.") else host


# "5 Oct 2026"
def niceDate(day):
    return f"{day.day} {day.strftime('%b %Y')}"


# The small line on a bucket card: the planned date, else the note text, else the link's website
def describeBucket(note):
    if note.get("date"):
        return "Planned for " + niceDate(date.fromisoformat(note["date"]))
    content = (note.get("content") or "").strip()
    if content:
        return content.splitlines()[0][:60]
    if note.get("link"):
        return linkHost(note["link"])
    return ""


# The date something was finished, in the person's own timezone
def formatDoneDate(completedAt, zone):
    if not completedAt:
        return ""
    if completedAt.tzinfo is None:
        completedAt = completedAt.replace(tzinfo=timezone.utc)
    return niceDate(completedAt.astimezone(zone).date())


# Everything the Bucket List page needs: not-done items grouped by category, plus the Done shelf
def getBucketNotes(userId, timezoneName):
    zone = getZone(timezoneName)
    today = datetime.now(zone).date()
    found = notes.find({"user_id": userId, "deleted_at": None, "bucket": {"$in": BUCKETS}}).sort("created_at", 1)

    sections = {name: [] for name in BUCKETS}
    doneItems = []
    for note in found:
        decorate(note, today)
        note["detail"] = describeBucket(note)
        if note.get("done"):
            note["doneDate"] = formatDoneDate(note.get("completed_at"), zone)
            doneItems.append(note)
        else:
            sections[note["bucket"]].append(note)

    doneItems.sort(key=lambda n: n.get("completed_at") or datetime.min, reverse=True)
    return {"sections": sections, "done": doneItems}
