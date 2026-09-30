# bucket_helpers.py - the Bucket List is a wish list. It is completely separate from notes
# (post-its): its own collection, its own page, and nothing here shows up in Today, the Calendar
# or the Notes page. Each wish is one document in bucket_items:
# { user_id, title, content, category, link, planned, done, completed_at, created_at, deleted_at }
# ("planned" is a day you would like to do it. It stays inside the bucket list.)
# Every query filters by user_id.

from datetime import date, datetime, timezone
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from db import bucket_items, notes
from notes_helpers import cleanDate, toObjectId

CATEGORIES = ["movies", "places", "things", "experiences"]
TITLE_MAX = 200
NOTE_MAX = 200


# A category must be one of the four; anything else becomes None
def cleanCategory(value):
    word = (value or "").strip().lower()
    return word if word in CATEGORIES else None


# Trims spaces and cuts text to a maximum length
def cleanText(value, maxLength):
    return (value or "").strip()[:maxLength]


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


# "14 Sep 2026"
def niceDate(day):
    return f"{day.day} {day.strftime('%b %Y')}"


# The date something was finished, in the person's own timezone
def formatDoneDate(completedAt, timezoneName):
    if not completedAt:
        return ""
    try:
        zone = ZoneInfo(timezoneName)
    except Exception:
        zone = ZoneInfo("Europe/Dublin")
    if completedAt.tzinfo is None:
        completedAt = completedAt.replace(tzinfo=timezone.utc)
    return niceDate(completedAt.astimezone(zone).date())


# The small line on a card: the day you would like to do it, else a short note, else the link's website
def describeWish(item):
    if item.get("planned"):
        return "Planned for " + niceDate(date.fromisoformat(item["planned"]))
    content = (item.get("content") or "").strip()
    if content:
        return content.splitlines()[0][:60]
    if item.get("link"):
        return linkHost(item["link"])
    return ""


# Adds a wish. Returns True if it was saved (a title is needed).
def addBucketItem(userId, title, category, link):
    cleanTitle = cleanText(title, TITLE_MAX)
    if not cleanTitle:
        return False
    bucket_items.insert_one({
        "user_id": userId,
        "title": cleanTitle,
        "content": "",
        "category": cleanCategory(category) or "things",
        "link": cleanLink(link),
        "planned": None,
        "done": False,
        "completed_at": None,
        "created_at": datetime.now(timezone.utc),
        "deleted_at": None,
    })
    return True


# Changes a wish's title, category and link
def updateBucketItem(userId, itemId, title, category, link):
    objectId = toObjectId(itemId)
    if objectId is None:
        return
    changes = {"link": cleanLink(link)}
    if cleanCategory(category):
        changes["category"] = cleanCategory(category)
    if cleanText(title, TITLE_MAX):
        changes["title"] = cleanText(title, TITLE_MAX)
    bucket_items.update_one({"_id": objectId, "user_id": userId, "deleted_at": None}, {"$set": changes})


# "Plan it": a day you would like to do it (an empty or invalid date clears it)
def planBucketItem(userId, itemId, planned):
    objectId = toObjectId(itemId)
    if objectId is None:
        return
    bucket_items.update_one({"_id": objectId, "user_id": userId, "deleted_at": None},
                            {"$set": {"planned": cleanDate(planned)}})


# Ticks a wish off (done, with the date), or puts it back on the list
def toggleBucketDone(userId, itemId):
    objectId = toObjectId(itemId)
    if objectId is None:
        return
    item = bucket_items.find_one({"_id": objectId, "user_id": userId, "deleted_at": None})
    if item:
        nowDone = not item.get("done", False)
        bucket_items.update_one({"_id": objectId, "user_id": userId},
                                {"$set": {"done": nowDone,
                                          "completed_at": datetime.now(timezone.utc) if nowDone else None}})


# Remove = set deleted_at (so Undo can bring it back). Returns True if something was removed.
def deleteBucketItem(userId, itemId):
    objectId = toObjectId(itemId)
    if objectId is None:
        return False
    result = bucket_items.update_one({"_id": objectId, "user_id": userId, "deleted_at": None},
                                     {"$set": {"deleted_at": datetime.now(timezone.utc)}})
    return result.matched_count > 0


# Undo for remove. Returns True if something came back.
def restoreBucketItem(userId, itemId):
    objectId = toObjectId(itemId)
    if objectId is None:
        return False
    result = bucket_items.update_one({"_id": objectId, "user_id": userId, "deleted_at": {"$ne": None}},
                                     {"$set": {"deleted_at": None}})
    return result.matched_count > 0


# Everything the Bucket List page needs: to-do wishes by category, plus the Done shelf
def getBucketItems(userId, timezoneName):
    found = bucket_items.find({"user_id": userId, "deleted_at": None}).sort("created_at", 1)
    sections = {name: [] for name in CATEGORIES}
    done = []
    for item in found:
        item["id"] = str(item["_id"])
        item["detail"] = describeWish(item)
        if item.get("done"):
            item["doneDate"] = formatDoneDate(item.get("completed_at"), timezoneName)
            done.append(item)
        elif item.get("category") in sections:
            sections[item["category"]].append(item)
    done.sort(key=lambda item: item.get("completed_at") or datetime.min, reverse=True)
    return {"sections": sections, "done": done}


# One-time tidy-up: before wishes had their own collection, they were notes with a "bucket" field.
# This moves any of those out of notes (keeping the same id) into bucket_items. A day they had been
# planned for is kept as "planned". Safe to run on every start: once nothing is left, it does nothing.
def moveBucketNotesToWishList():
    moved = 0
    for note in list(notes.find({"bucket": {"$in": CATEGORIES}})):
        bucket_items.replace_one({"_id": note["_id"]}, {
            "_id": note["_id"],
            "user_id": note["user_id"],
            "title": note["title"],
            "content": cleanText(note.get("content"), NOTE_MAX),
            "category": note["bucket"],
            "link": cleanLink(note.get("link")),
            "planned": note.get("date"),
            "done": bool(note.get("done")),
            "completed_at": note.get("completed_at"),
            "created_at": note.get("created_at") or datetime.now(timezone.utc),
            "deleted_at": note.get("deleted_at"),
        }, upsert=True)
        notes.delete_one({"_id": note["_id"]})
        moved += 1
    return moved
