# reminders.py - a standalone script, NOT part of the running website. GitHub Actions runs this
# file on a schedule (about every 15 minutes — see .github/workflows/reminders.yml) because
# Render's free web service cannot run background jobs on its own.
#
# Each run does four things:
#   1. Sends a push notification for any note whose "Remind me" time has arrived.
#   2. Sends a push notification for any habit that is due today and hasn't fired yet today
#      (unless the person switched "Habit reminders" off in Settings).
#   3. On the MORNING of a note's finish-by day, and again on the morning of its deadline, sends one
#      gentle nudge (unless "Deadline alerts" is off). Two small flags on the note, finish_nudge_sent
#      and deadline_nudge_sent, stop the nudge repeating every 15 minutes.
#   4. Permanently deletes notes, wishes and grocery items that were soft-deleted (Undo) more than 24 hours ago.

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

# "The morning" for deadline nudges starts at this hour in the PERSON's own timezone. A run that
# arrives late may still send until the grace period ends, but never in the afternoon or evening.
DEADLINE_NUDGE_HOUR = 8
DEADLINE_NUDGE_GRACE_HOURS = 4


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


# Is it "the morning" for this person right now? nowLocal is already in their own timezone.
def isNudgeMorning(nowLocal):
    return DEADLINE_NUDGE_HOUR <= nowLocal.hour < DEADLINE_NUDGE_HOUR + DEADLINE_NUDGE_GRACE_HOURS


# Which morning nudge, if any, is due for this note today? todayIso is "YYYY-MM-DD" in the person's
# own timezone. Returns "finish", "deadline", or None. The finish-by nudge wins when both fall on
# the same day, so nobody gets two pings for one note.
def whichDeadlineNudge(note, todayIso):
    if note.get("done") or note.get("deleted_at"):
        return None
    if note.get("finish_by") == todayIso and not note.get("finish_nudge_sent"):
        return "finish"
    if note.get("deadline") == todayIso and not note.get("deadline_nudge_sent"):
        return "deadline"
    return None


# The words for a deadline nudge (kind is "finish" or "deadline"). Gentle, never guilt-inducing.
def deadlineMessage(note, kind):
    if kind == "finish":
        title = "Aim to finish today: " + note["title"]
        body = "A little nudge, you chose today as your finish-by day."
    else:
        title = "Due today: " + note["title"]
        body = "Today's the deadline. You've got this."
    return {"title": title, "body": body, "url": "/notes", "tag": "deadline-" + str(note["_id"])}


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


def sendHabitReminders(users, nowUtc=None):
    nowUtc = nowUtc or datetime.now(timezone.utc)
    sentCount = 0
    for user in users:
        if user.get("habit_reminders") is False:       # switched off in Settings
            continue
        habits = [h for h in user.get("habits", []) if h.get("active")]
        if not habits:
            continue

        zone = getZone(user["timezone"])
        nowLocal = nowUtc.astimezone(zone)
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


# One gentle morning nudge for notes whose finish-by day or deadline is today
def sendDeadlineNudges(users, nowUtc=None):
    nowUtc = nowUtc or datetime.now(timezone.utc)
    sentCount = 0
    for user in users:
        if user.get("deadline_alerts") is False:       # switched off in Settings
            continue
        nowLocal = nowUtc.astimezone(getZone(user["timezone"]))
        if not isNudgeMorning(nowLocal):
            continue
        todayIso = nowLocal.date().isoformat()

        query = {"user_id": user["user_id"], "deleted_at": None, "done": False, "$or": [
            {"finish_by": todayIso, "finish_nudge_sent": {"$ne": True}},
            {"deadline": todayIso, "deadline_nudge_sent": {"$ne": True}},
        ]}
        for note in list(notes.find(query)):
            kind = whichDeadlineNudge(note, todayIso)
            if kind is None:
                continue
            sendToUser(user["user_id"], deadlineMessage(note, kind))
            # Marked as handled whether or not a device received it (same idea as note reminders).
            # If finish-by and the deadline are the same day, that one ping covers both.
            flags = {"finish_nudge_sent": True} if kind == "finish" else {"deadline_nudge_sent": True}
            if kind == "finish" and note.get("deadline") == todayIso:
                flags["deadline_nudge_sent"] = True
            notes.update_one({"_id": note["_id"]}, {"$set": flags})
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

    everyone = list(usersCollection.find({}))
    noteCount = sendNoteReminders(nowUtc)
    habitCount = sendHabitReminders(everyone, nowUtc)
    deadlineCount = sendDeadlineNudges(everyone, nowUtc)
    deletedCount = deleteOldNotes(nowUtc)

    print(f"Sent {noteCount} note reminder(s), {habitCount} habit reminder(s), "
          f"{deadlineCount} deadline nudge(s). Removed {deletedCount} old deleted item(s).")


if __name__ == "__main__":
    main()
