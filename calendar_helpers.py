import calendar
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from datetime import time as clockTime
from urllib.parse import quote, urlencode

from db import notes
from notes_helpers import cleanDate, decorate, getToday, getZone, niceTime

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
    

# ---------------------------------------------------------------------------
# Add to calendar (Stage 5): Google Calendar links and .ics files
# ---------------------------------------------------------------------------

GOOGLE_CALENDAR_URL = "https://calendar.google.com/calendar/render"
NOTE_MINUTES = 30      # a timed note becomes a 30-minute event
HABIT_MINUTES = 15     # a timed habit becomes a 15-minute event
ICAL_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]


# Works out when a note happens as a calendar event:
#   date + time -> a timed event, date only -> all day, deadline only -> all day "Due: ..."
# Returns (kind, start, end, title), or None if the note has no date at all.
def getEventWindow(note, zone):
    if note.get("date"):
        day = date.fromisoformat(note["date"])
        if note.get("time"):
            start = datetime.combine(day, clockTime.fromisoformat(note["time"]), tzinfo=zone)
            return "timed", start, start + timedelta(minutes=NOTE_MINUTES), note["title"]
        return "allday", day, day + timedelta(days=1), note["title"]
    if note.get("deadline"):
        day = date.fromisoformat(note["deadline"])
        return "allday", day, day + timedelta(days=1), "Due: " + note["title"]
    return None


# 20260930T140000 (local wall-clock time, no zone letter)
def localStamp(moment):
    return moment.strftime("%Y%m%dT%H%M%S")


# 20260930T130000Z (the same moment in UTC)
def utcStamp(moment):
    return moment.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


# The note's extra words for the calendar entry
def noteDetails(note):
    parts = [note.get("content") or ""]
    if note.get("finish_by"):
        parts.append("Aim to finish by " + note["finish_by"])
    if note.get("link"):
        parts.append(note["link"])
    return "\n".join(part for part in parts if part)


# A link that opens Google Calendar with the event filled in, ready to save
def buildGoogleCalendarLink(note, timezoneName):
    zone = getZone(timezoneName)
    params = {"action": "TEMPLATE", "details": noteDetails(note)}
    window = getEventWindow(note, zone)
    params["text"] = window[3] if window else note["title"]
    if window:
        kind, start, end, _ = window
        if kind == "timed":
            params["dates"] = localStamp(start) + "/" + localStamp(end)
            params["ctz"] = timezoneName
        else:
            params["dates"] = start.strftime("%Y%m%d") + "/" + end.strftime("%Y%m%d")
    return GOOGLE_CALENDAR_URL + "?" + urlencode(params, quote_via=quote)


# ---- .ics writing helpers ----

# Commas, semicolons, backslashes and new lines need a backslash in .ics text
def icsEscape(text):
    return (text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\n", "\\n"))


# .ics lines may not be longer than 75 bytes: longer ones continue on the next line after a space
def icsFold(line):
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return line
    pieces = []
    while len(encoded) > 75:
        cut = 75 if not pieces else 74
        while cut > 0 and (encoded[cut] & 0xC0) == 0x80:     # never cut in the middle of a character
            cut -= 1
        pieces.append(encoded[:cut].decode("utf-8"))
        encoded = encoded[cut:]
    pieces.append(encoded.decode("utf-8"))
    return "\r\n ".join(pieces)


# Wraps events into a full calendar file (lines end with CRLF, as the format requires)
def icsWrap(eventLines):
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Calyx Planner//EN", "CALSCALE:GREGORIAN",
             *eventLines, "END:VCALENDAR"]
    return "\r\n".join(icsFold(line) for line in lines) + "\r\n"


# A safe file name such as "Dentist.ics" (letters, numbers, dashes only)
def safeFileName(title, fallback="calyx"):
    cleaned = re.sub(r"[^A-Za-z0-9]+", "-", title).strip("-")[:40]
    return (cleaned or fallback) + ".ics"


# A .ics file for one note, with a reminder. Returns None if the note has no date or deadline.
def buildIcs(note, timezoneName):
    window = getEventWindow(note, getZone(timezoneName))
    if window is None:
        return None
    kind, start, end, title = window
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    lines = ["BEGIN:VEVENT", f"UID:note-{note['_id']}@calyx-planner", f"DTSTAMP:{stamp}"]
    if kind == "timed":
        lines += [f"DTSTART:{utcStamp(start)}", f"DTEND:{utcStamp(end)}"]
        alarm = "-PT15M"            # 15 minutes before
    else:
        lines += [f"DTSTART;VALUE=DATE:{start.strftime('%Y%m%d')}", f"DTEND;VALUE=DATE:{end.strftime('%Y%m%d')}"]
        alarm = "PT9H"              # 9am on the day
    lines += [f"SUMMARY:{icsEscape(title)}"]
    details = noteDetails(note)
    if details:
        lines.append(f"DESCRIPTION:{icsEscape(details)}")
    lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{icsEscape(title)}", f"TRIGGER:{alarm}", "END:VALARM",
              "END:VEVENT"]
    return icsWrap(lines)


# ---- Habits: a repeating event ----

# "FREQ=DAILY" or "FREQ=WEEKLY;BYDAY=MO,WE" from the habit's days
def habitRule(habit):
    days = habit.get("days", [])
    if len(days) == 7 or not days:
        return "FREQ=DAILY"
    return "FREQ=WEEKLY;BYDAY=" + ",".join(ICAL_DAYS[DAY_KEYS.index(day)] for day in days)


# The first day this habit happens on or after today
def firstHabitDay(habit, today):
    for ahead in range(7):
        day = today + timedelta(days=ahead)
        if not habit.get("days") or DAY_KEYS[day.weekday()] in habit["days"]:
            return day
    return today


# A Google Calendar link for a repeating habit event
def habitCalendarLink(habit, timezoneName):
    zone = getZone(timezoneName)
    day = firstHabitDay(habit, datetime.now(zone).date())
    params = {"action": "TEMPLATE", "text": habit["name"], "recur": "RRULE:" + habitRule(habit)}
    if habit.get("time"):
        start = datetime.combine(day, clockTime.fromisoformat(habit["time"]))
        params["dates"] = localStamp(start) + "/" + localStamp(start + timedelta(minutes=HABIT_MINUTES))
        params["ctz"] = timezoneName
    else:
        params["dates"] = day.strftime("%Y%m%d") + "/" + (day + timedelta(days=1)).strftime("%Y%m%d")
    return GOOGLE_CALENDAR_URL + "?" + urlencode(params, quote_via=quote)


# A .ics file for a repeating habit. Times are "floating" (no zone) so 7:10 stays 7:10 all year,
# even when the clocks change.
def buildHabitIcs(habit, timezoneName):
    zone = getZone(timezoneName)
    day = firstHabitDay(habit, datetime.now(zone).date())
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    lines = ["BEGIN:VEVENT", f"UID:habit-{habit['habit_id']}@calyx-planner", f"DTSTAMP:{stamp}"]
    if habit.get("time"):
        start = datetime.combine(day, clockTime.fromisoformat(habit["time"]))
        lines += [f"DTSTART:{localStamp(start)}", f"DTEND:{localStamp(start + timedelta(minutes=HABIT_MINUTES))}"]
        alarm = "PT0S"              # at the start time
    else:
        lines += [f"DTSTART;VALUE=DATE:{day.strftime('%Y%m%d')}",
                  f"DTEND;VALUE=DATE:{(day + timedelta(days=1)).strftime('%Y%m%d')}"]
        alarm = "PT9H"
    lines += [f"RRULE:{habitRule(habit)}", f"SUMMARY:{icsEscape(habit['name'])}",
              "BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{icsEscape(habit['name'])}", f"TRIGGER:{alarm}",
              "END:VALARM", "END:VEVENT"]
    return icsWrap(lines)
    
