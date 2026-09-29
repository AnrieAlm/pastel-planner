# notes_helpers.py - reading notes from MongoDB and preparing them for the page.
# Every query here filters by user_id, so one person can never see another person's notes.

from datetime import date, datetime
from zoneinfo import ZoneInfo

from bson import ObjectId
from bson.errors import InvalidId

from db import notes

TITLE_MAX = 200
CONTENT_MAX = 2000
FILTERS = ["all", "undated", "dated", "urgent", "done"]


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
