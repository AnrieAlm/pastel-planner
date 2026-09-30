# habits_helpers.py - reading and saving habits, ticks and streaks.
# Habits live inside the user's document (max 3). Ticks live in habit_logs.
# Every query filters by user_id, so nobody can touch another person's habits.

from datetime import date, timedelta
from uuid import uuid4

from db import users, habit_logs
from notes_helpers import cleanText, cleanTime, getToday

DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MAX_HABITS = 3
NAME_MAX = 60
LOOKBACK_DAYS = 120   # how far back we look when counting a streak
SUGGESTIONS = ["Drink water", "Stretch", "Read 10 pages", "Go for a walk", "Write in a journal"]


# The person's saved habits (an empty list if they have none yet)
def getHabits(userId):
    doc = users.find_one({"user_id": userId}, {"habits": 1})
    return (doc or {}).get("habits", [])


# Keep only real weekday keys, in Monday-to-Sunday order. No days chosen means every day.
def cleanDays(values):
    chosen = [key for key in DAY_KEYS if key in set(values or [])]
    return chosen or list(DAY_KEYS)


# Is this habit planned for this date?
def isScheduled(habit, day):
    return DAY_KEYS[day.weekday()] in habit.get("days", [])


# Add a new habit or update an existing one. Returns "saved", "full" or "invalid".
def saveHabit(userId, habitId, name, days, time, active, todayIso):
    cleanName = cleanText(name, NAME_MAX)
    if not cleanName:
        return "invalid"
    fields = {
        "name": cleanName,
        "days": cleanDays(days),
        "time": cleanTime(time) if time else None,
        "active": active,
    }
    habits = getHabits(userId)
    match = next((h for h in habits if h["habit_id"] == habitId), None)
    if match:
        match.update(fields)
    elif len(habits) >= MAX_HABITS:
        return "full"
    else:
        habits.append({"habit_id": uuid4().hex[:8], "created_on": todayIso, **fields})
    users.update_one({"user_id": userId}, {"$set": {"habits": habits}})
    return "saved"


# Remove a habit from the list (old ticks stay in habit_logs, harmless)
def removeHabit(userId, habitId):
    habits = [h for h in getHabits(userId) if h["habit_id"] != habitId]
    users.update_one({"user_id": userId}, {"$set": {"habits": habits}})


# All ticks between two dates: {"2026-10-01": {habit_id, ...}, ...}
def getLogs(userId, startDay, endDay):
    found = habit_logs.find({"user_id": userId,
                             "date": {"$gte": startDay.isoformat(), "$lte": endDay.isoformat()}})
    return {log["date"]: set(log.get("completed", [])) for log in found}


# Tick or un-tick one habit on one day. Returns True (now done), False (now undone) or None (not allowed).
# Only today and the 7 days before it can be changed.
def toggleHabitLog(userId, habitId, dayIso, todayIso):
    if not any(h["habit_id"] == habitId for h in getHabits(userId)):
        return None
    try:
        day = date.fromisoformat(dayIso)
    except ValueError:
        return None
    today = date.fromisoformat(todayIso)
    if day > today or day < today - timedelta(days=7):
        return None

    where = {"user_id": userId, "date": dayIso}
    log = habit_logs.find_one(where)
    alreadyDone = bool(log) and habitId in log.get("completed", [])
    if alreadyDone:
        habit_logs.update_one(where, {"$pull": {"completed": habitId}})
    else:
        habit_logs.update_one(where, {"$addToSet": {"completed": habitId}}, upsert=True)
    return not alreadyDone


# How many scheduled days in a row this habit was done, counting back from today.
# If today is scheduled but not ticked yet, we start from yesterday so the streak isn't broken early.
def calculateStreak(habit, logs, today):
    habitId = habit["habit_id"]
    day = today
    if isScheduled(habit, today) and habitId not in logs.get(today.isoformat(), set()):
        day = today - timedelta(days=1)
    streak = 0
    for _ in range(LOOKBACK_DAYS):
        if isScheduled(habit, day):
            if habitId in logs.get(day.isoformat(), set()):
                streak += 1
            else:
                break
        day -= timedelta(days=1)
    return streak


# Did the person miss the most recent scheduled day before today? (Only counts days since the habit was created.)
def missedLastTime(habit, logs, today):
    day = today - timedelta(days=1)
    for _ in range(14):
        if day.isoformat() < habit.get("created_on", "0000-00-00"):
            return False
        if isScheduled(habit, day):
            return habit["habit_id"] not in logs.get(day.isoformat(), set())
        day -= timedelta(days=1)
    return False


# Gentle, no-guilt streak wording
def describeStreak(habit, logs, today):
    streak = calculateStreak(habit, logs, today)
    doneToday = habit["habit_id"] in logs.get(today.isoformat(), set())
    if streak == 0:
        return "A fresh start whenever you're ready"
    if doneToday and streak == 1 and missedLastTime(habit, logs, today):
        return "Picked back up today"
    if streak == 1:
        return "Off to a good start"
    return f"{streak} in a row"


# The 7-day strip: the last 7 days ending today
def buildWeekStrip(habit, logs, today):
    strip = []
    for back in range(6, -1, -1):
        day = today - timedelta(days=back)
        strip.append({
            "date": day.isoformat(),
            "label": DAY_LABELS[day.weekday()][0],
            "scheduled": isScheduled(habit, day),
            "done": habit["habit_id"] in logs.get(day.isoformat(), set()),
            "isToday": day == today,
        })
    return strip


# Adds the extra fields the page needs to one habit
def decorateHabit(habit, logs, today):
    card = dict(habit)
    card["doneToday"] = habit["habit_id"] in logs.get(today.isoformat(), set())
    card["scheduledToday"] = isScheduled(habit, today)
    card["streakText"] = describeStreak(habit, logs, today)
    card["strip"] = buildWeekStrip(habit, logs, today)
    return card


# Everything the Habits page needs
def getHabitsView(user):
    today = getToday(user["timezone"])
    logs = getLogs(user["user_id"], today - timedelta(days=LOOKBACK_DAYS), today)
    cards = [decorateHabit(h, logs, today) for h in getHabits(user["user_id"])]
    return {
        "habits": cards,
        "slotsLeft": MAX_HABITS - len(cards),
        "suggestions": SUGGESTIONS,
        "dayOptions": list(zip(DAY_KEYS, DAY_LABELS)),
        "today": today.isoformat(),
    }


# Active habits planned for today, earliest time first (for the Today page)
def getHabitsForToday(user):
    cards = getHabitsView(user)["habits"]
    todays = [c for c in cards if c["active"] and c["scheduledToday"]]
    return sorted(todays, key=lambda c: c.get("time") or "99:99")


# Dates in a range where at least one habit was ticked (for the rings on the Calendar)
def getHabitDoneDates(userId, startDay, endDay):
    logs = getLogs(userId, startDay, endDay)
    return {day for day, done in logs.items() if done}
