# habits_helpers.py - habits live inside the user document (max 3), and each tick is saved
# in the habit_logs collection as { user_id, date: "YYYY-MM-DD", completed: [habit_id, ...] }.
# Every query here filters by user_id.

from datetime import date, timedelta

from db import habit_logs
from notes_helpers import cleanTime, getToday, niceTime

DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"]
SLOT_LIMIT = 3
NAME_MAX = 40
LOOKBACK_DAYS = 200
SUGGESTIONS = ["Morning yoga", "Read", "Journal", "Drink water", "Stretch", "Evening walk"]


# "mon,wed,fri" -> ["mon", "wed", "fri"] (Monday first). Nothing valid means every day.
def cleanDays(value):
    chosen = [word.strip().lower() for word in (value or "").split(",")]
    days = [key for key in DAY_KEYS if key in chosen]
    return days or DAY_KEYS[:]


# ["mon","tue",...] -> "Every day", "Weekdays" or "Mon, Wed, Fri"
def describeDays(days):
    if len(days) == 7:
        return "Every day"
    if days == DAY_KEYS[:5]:
        return "Weekdays"
    if days == DAY_KEYS[5:]:
        return "Weekends"
    return ", ".join(DAY_NAMES[DAY_KEYS.index(day)] for day in days)


# The active habits that happen on this weekday (0 = Monday)
def getHabitsForWeekday(habits, weekdayIndex):
    return [h for h in habits if h.get("active") and DAY_KEYS[weekdayIndex] in h.get("days", [])]


# All of this person's ticks since a day, as { "2026-09-29": {habit_id, ...} }
def getLogs(userId, sinceDay):
    logs = {}
    for entry in habit_logs.find({"user_id": userId, "date": {"$gte": sinceDay}}):
        logs[entry["date"]] = set(entry.get("completed", []))
    return logs


# Counts the days in a row this habit was done, walking back from today.
# - Days the habit is not scheduled are skipped (they never break a streak).
# - Today never counts against you: if it is not ticked yet, we start from yesterday.
# Returns (streak, hadEarlier, doneToday); hadEarlier means it was done before a gap.
def calculateStreak(habit, logs, today):
    habitId = habit["habit_id"]
    scheduledDays = set(habit.get("days", []))
    doneToday = habitId in logs.get(today.isoformat(), set())

    start = today if doneToday else today - timedelta(days=1)
    streak = 0
    broken = False
    hadEarlier = False
    for back in range(LOOKBACK_DAYS):
        day = start - timedelta(days=back)
        done = habitId in logs.get(day.isoformat(), set())
        scheduled = DAY_KEYS[day.weekday()] in scheduledDays
        if not broken:
            if done:
                streak += 1
            elif scheduled:
                broken = True          # a planned day was missed: the streak ends here
        elif done:
            hadEarlier = True          # ...but it had been done before the gap
            break
    return streak, hadEarlier, doneToday


# Gentle words for the streak: never "streak broken"
def streakText(streak, hadEarlier, doneToday):
    if doneToday:
        if streak >= 2:
            return f"{streak} days in a row — keep going"
        return "Picked back up today" if hadEarlier else "A fresh start today"
    if streak >= 3:
        return f"{streak} days — nice rhythm"
    if streak == 2:
        return "2 days so far"
    if streak == 1:
        return "1 day so far"
    return "A new start is one tick away" if hadEarlier else "Ready when you are"


# Everything the templates need for one habit
def buildHabitView(habit, logs, today):
    streak, hadEarlier, doneToday = calculateStreak(habit, logs, today)
    monday = today - timedelta(days=today.weekday())

    week = []
    for offset in range(7):
        day = monday + timedelta(days=offset)
        scheduled = DAY_KEYS[offset] in habit.get("days", [])
        done = habit["habit_id"] in logs.get(day.isoformat(), set())
        isFuture = day > today
        state = "done" if done else "not done"
        if not scheduled:
            state += ", not planned"
        week.append({
            "letter": DAY_LETTERS[offset],
            "iso": day.isoformat(),
            "done": done,
            "scheduled": scheduled,
            "future": isFuture,
            "isToday": day == today,
            "label": f"{day.strftime('%A')} {day.day} {day.strftime('%B')}, {state}",
        })

    return {
        "habit_id": habit["habit_id"],
        "name": habit["name"],
        "todayIso": today.isoformat(),
        "time": habit.get("time") or "",
        "timeLabel": niceTime(habit["time"]) if habit.get("time") else "",
        "days": habit.get("days", []),
        "daysValue": ",".join(habit.get("days", [])),
        "daysLabel": describeDays(habit.get("days", [])),
        "active": bool(habit.get("active")),
        "streak": streak,
        "streakText": streakText(streak, hadEarlier, doneToday),
        "doneToday": doneToday,
        "scheduledToday": DAY_KEYS[today.weekday()] in habit.get("days", []),
        "week": week,
    }


# The Habits page: three slots, filled from the user's habits (empty slots are None)
def getHabitsView(user):
    today = getToday(user["timezone"])
    logs = getLogs(user["user_id"], (today - timedelta(days=LOOKBACK_DAYS)).isoformat())
    habits = [buildHabitView(h, logs, today) for h in user.get("habits", [])[:SLOT_LIMIT]]
    return {
        "slots": habits + [None] * (SLOT_LIMIT - len(habits)),
        "filled": len(habits),
        "suggestions": SUGGESTIONS,
    }


# The habits to tick on Today: active ones that are planned for today
def getHabitsForToday(user):
    today = getToday(user["timezone"])
    habits = getHabitsForWeekday(user.get("habits", []), today.weekday())
    if not habits:
        return []
    logs = getLogs(user["user_id"], (today - timedelta(days=LOOKBACK_DAYS)).isoformat())
    return [buildHabitView(h, logs, today) for h in habits]


# Ticks (done=True) or un-ticks a habit on a day. One document per person per day.
def setHabitLog(userId, habitId, day, done):
    if done:
        habit_logs.update_one({"user_id": userId, "date": day},
                              {"$addToSet": {"completed": habitId}}, upsert=True)
    else:
        habit_logs.update_one({"user_id": userId, "date": day},
                              {"$pull": {"completed": habitId}})


# Reads what the habit's state is after a change, so the page can update instantly
def getHabitState(user, habitId):
    today = getToday(user["timezone"])
    for habit in user.get("habits", []):
        if habit["habit_id"] == habitId:
            logs = getLogs(user["user_id"], (today - timedelta(days=LOOKBACK_DAYS)).isoformat())
            view = buildHabitView(habit, logs, today)
            return {"streak": view["streak"], "streakText": view["streakText"], "doneToday": view["doneToday"]}
    return None
