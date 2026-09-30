# calendar_helpers.py - builds the month grid and the day panels for the Calendar page.
# Every query filters by user_id, so only this person's notes ever appear.

import calendar
from collections import defaultdict
from datetime import date, datetime

from db import notes
from notes_helpers import cleanDate, decorate, getToday, niceTime

# Habit days are saved as short names, Monday first (same order as Python's weekday())
DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


# Reads ?month=YYYY-MM. Anything odd falls back to the current month.
def parseMonth(value, today):
    try:
        parsed = datetime.strptime(value or "", "%Y-%m")
        if 2000 <= parsed.year <= 2100:
            return parsed.year, parsed.month
    except ValueError:
        pass
    return today.year, today.month


# Moves forward or back by whole months, e.g. (2026, 1, -1) -> (2025, 12)
def shiftMonth(year, month, step):
    index = year * 12 + (month - 1) + step
    return index // 12, index % 12 + 1


# (2026, 9) -> "2026-09"
def monthKey(year, month):
    return f"{year:04d}-{month:02d}"


# "Wednesday 24 Sept" style heading for a day
def dayHeading(day):
    return f"{day.strftime('%A')} {day.day} {day.strftime('%b')}"


# The habits from the user document that happen on this weekday
def getHabitsForWeekday(habits, weekdayIndex):
    return [h for h in habits if h.get("active") and DAY_KEYS[weekdayIndex] in h.get("days", [])]


# Everything the Calendar page needs for one month.
# monthParam is the ?month=... text, dayParam is the ?day=... text.
def getCalendarView(user, monthParam, dayParam):
    userId = user["user_id"]
    today = getToday(user["timezone"])
    year, month = parseMonth(monthParam, today)
    key = monthKey(year, month)

    # Which day is selected: the one asked for (if it is in this month), else today (if this is the
    # current month), else none
    requested = cleanDate(dayParam)
    if requested and requested[:7] == key:
        selected = requested
    elif (year, month) == (today.year, today.month):
        selected = today.isoformat()
    else:
        selected = None

    firstDay = date(year, month, 1).isoformat()
    lastDay = date(year, month, calendar.monthrange(year, month)[1]).isoformat()

    # Two queries for the whole month: notes planned on a day, and notes with a deadline on a day
    plannedByDay = defaultdict(list)
    for note in notes.find({"user_id": userId, "deleted_at": None,
                            "date": {"$gte": firstDay, "$lte": lastDay}}):
        plannedByDay[note["date"]].append(decorate(note, today))
    dueByDay = defaultdict(list)
    for note in notes.find({"user_id": userId, "deleted_at": None, "done": False,
                            "deadline": {"$gte": firstDay, "$lte": lastDay}}):
        dueByDay[note["deadline"]].append(decorate(note, today))

    habits = user.get("habits", [])
    weeks = []
    panels = {}

    # Weeks start on Monday; days outside this month become blank cells (None)
    for week in calendar.Calendar(firstweekday=0).monthdatescalendar(year, month):
        row = []
        for day in week:
            if day.month != month:
                row.append(None)
                continue

            iso = day.isoformat()
            planned = sorted(plannedByDay.get(iso, []),
                             key=lambda n: (n.get("time") is None, n.get("time") or "", n["created_at"]))
            due = dueByDay.get(iso, [])
            dayHabits = getHabitsForWeekday(habits, day.weekday())

            # A sentence for screen readers, e.g. "Friday 2 October, 2 notes, deadline"
            words = [f"{day.strftime('%A')} {day.day} {day.strftime('%B')}"]
            if planned:
                words.append(f"{len(planned)} note{'s' if len(planned) != 1 else ''}")
            if due:
                words.append("deadline")
            if dayHabits:
                words.append("habit day")

            row.append({
                "iso": iso,
                "number": day.day,
                "isToday": day == today,
                "isSelected": iso == selected,
                "hasNotes": bool(planned),
                "hasDeadline": bool(due),
                "hasHabit": bool(dayHabits),
                "label": ", ".join(words),
            })
            panels[iso] = {
                "heading": dayHeading(day),
                "notes": planned,
                "deadlines": due,
                "habits": [{"name": h["name"], "timeLabel": niceTime(h["time"]) if h.get("time") else "Habit"}
                           for h in dayHabits],
            }
        weeks.append(row)

    prevYear, prevMonth = shiftMonth(year, month, -1)
    nextYear, nextMonth = shiftMonth(year, month, 1)
    return {
        "title": f"{date(year, month, 1).strftime('%B')} {year}",
        "key": key,
        "weeks": weeks,
        "panels": panels,
        "selected": selected,
        "prevMonth": monthKey(prevYear, prevMonth),
        "nextMonth": monthKey(nextYear, nextMonth),
        "isCurrentMonth": (year, month) == (today.year, today.month),
    }
