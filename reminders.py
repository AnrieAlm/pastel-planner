# reminders.py - a standalone script, NOT part of the running website. GitHub Actions runs this
# file on a schedule (about every 15 minutes — see .github/workflows/reminders.yml) because
# Render's free web service cannot run background jobs on its own.
#
# Each run does three things:
#   1. Sends a push notification for any note whose "Remind me" time has arrived.
#   2. Sends a push notification for any habit that is due today and hasn't fired yet today.
#   3. Permanently deletes notes, wishes and grocery items that were soft-deleted (Undo) more than 24 hours ago.
#
# What it deliberately does NOT do yet: an automatic "aim to finish today" nudge on a note's
# finish-by date. That needs one more field on each note (to avoid repeating the nudge every
# 15 minutes) and is a small follow-up, not part of this pass.

import json
import os
from datetime import datetime, timedelta, timezone

import firebase_admin
from firebase_admin import credentials, messaging

from db import bucket_items, devices, grocery, notes
from habits_helpers import getHabitsForWeekday
from notes_helpers import getZone

# A habit is only reminded within this many minutes of its set time — long enough to survive a
# GitHub Actions run landing a few minutes late, short enough that a habit from first thing in
# the morning never pings you again at 9pm because a run was skipped earlier in the day.
HABIT_REMINDER_GRACE_MINUTES = 180

# Soft-deleted notes older than this are removed for good (Undo only needs a short window)
DELETE_AFTER_HOURS = 24


# ---------------------------------------------------------------------------
# Pure helpers (no database, no network) — the part worth testing carefully
# ---------------------------------------------------------------------------

# Is this habit due to be reminded right now? today/nowLocal are already in the PERSON's own
# timezone. `remindedToday` and `completedToday` are the habit_ids already logged for today.
def isHabitDueNow(habit, today, nowLocal, remindedToday, completedToday):
    if not habit.get("active") or not habit.get("time"):
        return False
    if habit["habit_id"] in remindedToday or habit["habit_id"] in completedToday:
        return False

    hour, minute = (int(part) for part in habit["time"].split(":"))
    scheduled = datetime.combine(today, datetime.min.time().replace(hour=hour, minute=minute))
    if nowLocal < scheduled:
        return False
    lateBy = (nowLocal - scheduled).total_seconds() / 60
    return lateBy <= HABIT_REMINDER_GRACE_MINUTES


# The words for a habit's reminder
def habitMessage(habit):
    return {"title": "Time for " + habit["name"], "body": "One tap on Habits (or the chip on Today) ticks it off.",
            "url": "/habits", "tag": "habit-" + habit["habit_id"]}


# The words for a note's reminder
def noteMessage(note):
    body = (note.get("content") or "").strip() or "Tap to see the note."
    return {"title": note["title"], "body": body[:150], "url": "/notes", "tag": "note-" + str(note["_id"])}


# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------

# Sends one data-only push to every device this person has. A "data-only" message (no separate
# "notification" field) means our own service worker decides how to show it — see the 'push'
# handler in sw.js. Returns how many devices actually received it.
def sendToUser(userId, payload):
    sent = 0
    for device in list(devices.find({"user_id": userId})):
        message = messaging.Message(
            data={"title": payload["title"], "body": payload["body"], "url": payload["url"], "tag": payload["tag"]},
            token=device["fcm_token"],
            webpush=messaging.WebpushConfig(headers={"Urgency": "normal"}),
        )
        try:
            messaging.send(message)
            sent += 1
        except messaging.UnregisteredError:
            # The browser un-installed the app, cleared its data, or the token simply expired —
            # there is nothing to retry, so stop trying to reach this one
            devices.delete_one({"_id": device["_id"]})
        except Exception as error:
            # Anything else (a network blip, a quota hiccup) is left alone to retry next run
            print(f"Could not send to one of {userId}'s devices: {error}")
    return sent


# ---------------------------------------------------------------------------
# The three jobs
# ---------------------------------------------------------------------------

def sendNoteReminders(nowUtc):
    sentCount = 0
    query = {"reminder_at": {"$lte": nowUtc}, "reminder_sent": False, "deleted_at": None, "done": False}
    for note in list(notes.find(query)):
        sendToUser(note["user_id"], noteMessage(note))
        # Marked as handled whether or not a device actually received it, so a reminder from
        # before any device was registered doesn't suddenly arrive days later, all at once
        notes.update_one({"_id": note["_id"]}, {"$set": {"reminder_sent": True}})
        sentCount += 1
    return sentCount


def sendHabitReminders(users):
    sentCount = 0
    for user in users:
        habits = [h for h in user.get("habits", []) if h.get("active")]
        if not habits:
            continue

        zone = getZone(user["timezone"])
        nowLocal = datetime.now(zone)
        today = nowLocal.date()
        todaysHabits = getHabitsForWeekday(habits, today.weekday())
        if not todaysHabits:
            continue

        log = habit_logsFindOne(user["user_id"], today.isoformat())
        remindedToday = set((log or {}).get("reminded", []))
        completedToday = set((log or {}).get("completed", []))

        for habit in todaysHabits:
            if not isHabitDueNow(habit, today, nowLocal.replace(tzinfo=None), remindedToday, completedToday):
                continue
            sendToUser(user["user_id"], habitMessage(habit))
            habit_logsMarkReminded(user["user_id"], today.isoformat(), habit["habit_id"])
            sentCount += 1
    return sentCount


# Permanently removes anything that was "deleted" (Undo-able) more than a day ago:
# notes, bucket-list wishes and grocery items all use the same deleted_at idea
def deleteOldNotes(nowUtc):
    cutoff = nowUtc - timedelta(hours=DELETE_AFTER_HOURS)
    total = 0
    for collection in (notes, bucket_items, grocery):
        total += collection.delete_many({"deleted_at": {"$ne": None, "$lte": cutoff}}).deleted_count
    return total


# Small wrappers around habit_logs so the two functions above read cleanly (and so the
# collection is only imported where it is actually used)
def habit_logsFindOne(userId, day):
    from db import habit_logs
    return habit_logs.find_one({"user_id": userId, "date": day})


def habit_logsMarkReminded(userId, day, habitId):
    from db import habit_logs
    habit_logs.update_one({"user_id": userId, "date": day}, {"$addToSet": {"reminded": habitId}}, upsert=True)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    serviceAccountJson = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not serviceAccountJson:
        raise SystemExit("FIREBASE_SERVICE_ACCOUNT is not set (add it as a GitHub Actions secret).")
    firebase_admin.initialize_app(credentials.Certificate(json.loads(serviceAccountJson)))

    from db import users as usersCollection  # imported here so this file can be unit-tested
    # without a real MongoDB connection just to read the pure functions above
    nowUtc = datetime.now(timezone.utc)

    noteCount = sendNoteReminders(nowUtc)
    habitCount = sendHabitReminders(list(usersCollection.find({})))
    deletedCount = deleteOldNotes(nowUtc)

    print(f"Sent {noteCount} note reminder(s), {habitCount} habit reminder(s). "
          f"Removed {deletedCount} old deleted item(s).")


if __name__ == "__main__":
    main()
