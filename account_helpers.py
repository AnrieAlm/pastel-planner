# account_helpers.py - the Settings page: saving the profile, exporting everything a person has
# stored, and deleting an account's data. Every query here filters by user_id.

import json
from datetime import date, datetime
from zoneinfo import ZoneInfo

from bson import ObjectId

from db import (bucket_items, capture_sessions, devices, grocery, habit_logs, notes, routine_logs,
                routines, users)
from notes_helpers import cleanText

NAME_MAX = 60

# The timezones offered in the Settings dropdown (the person's current one is always added too)
COMMON_ZONES = [
    "Europe/Dublin", "Europe/London", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin",
    "Europe/Madrid", "Europe/Athens", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore",
    "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland", "America/New_York",
    "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto",
]


# The dropdown list: the common zones, plus the person's own if it is not among them
def getTimezoneChoices(current):
    zones = COMMON_ZONES[:]
    if current and current not in zones:
        zones.insert(0, current)
    return zones


# Keeps a timezone name only if Python knows it (so "Europe/Dublin" is fine, "nonsense" is not)
def cleanTimezone(value):
    name = (value or "").strip()
    if not name:
        return None
    try:
        ZoneInfo(name)
    except Exception:
        return None
    return name


# Saves the name and timezone. A blank name or an unknown timezone leaves the old value alone.
def updateProfile(userId, name, timezoneName):
    changes = {}
    cleanName = cleanText(name, NAME_MAX)
    if cleanName:
        changes["name"] = cleanName
    zone = cleanTimezone(timezoneName)
    if zone:
        changes["timezone"] = zone
    if changes:
        users.update_one({"user_id": userId}, {"$set": changes})


# The on/off switches on the Settings page that are saved on the person's own document.
# A missing value always means "on", so older accounts keep working without any migration.
PREFERENCES = ("followups", "voice", "habit_reminders", "deadline_alerts")


# Saves one switch. Returns False for a name that is not on the list (so a forged request
# can never write an arbitrary field onto the user document).
def setPreference(userId, name, enabled):
    if name not in PREFERENCES:
        return False
    users.update_one({"user_id": userId}, {"$set": {name: bool(enabled)}})
    return True


# "Follow-up questions" on or off (Sinéad asking "did you miss anything?" after a brain-dump)
def setFollowups(userId, enabled):
    setPreference(userId, "followups", enabled)


# MongoDB ids and dates are not plain JSON, so turn them into text first
def toPlain(value):
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    raise TypeError(f"Cannot export {type(value)}")


# Everything this person has stored, as JSON text (for "Download as JSON")
def exportAllData(userId):
    def everything(collection):
        return list(collection.find({"user_id": userId}))

    profile = users.find_one({"user_id": userId}, {"_id": 0}) or {}
    data = {
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "profile": profile,
        "notes": everything(notes),
        "bucket_items": everything(bucket_items),
        "grocery": everything(grocery),
        "habit_logs": everything(habit_logs),
        "routines": everything(routines),
        "routine_logs": everything(routine_logs),
    }
    return json.dumps(data, default=toPlain, indent=2)


# Permanently removes everything this person has stored, including the profile.
# (The Firebase login itself is deleted by the browser afterwards - see firebase-login.js.)
def deleteAccountData(userId):
    for collection in (notes, bucket_items, grocery, habit_logs, routines, routine_logs, devices,
                       capture_sessions):
        collection.delete_many({"user_id": userId})
    users.delete_one({"user_id": userId})
