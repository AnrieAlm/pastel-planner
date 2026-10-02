# briefing_helpers.py - the "Play today's summary" button: turns today's planner data into a few
# short, friendly sentences. The browser reads them aloud (and shows them as words too).
#
# No AI is involved: it is built from your own notes, habits and routine, so it is instant, free,
# and can never make something up. Every query goes through the same helpers the Today page uses,
# so everything is filtered by this person's user_id.

from datetime import datetime

from habits_helpers import getHabitsForToday
from notes_helpers import getToday, getTodayView, getZone, niceTime
from routine_helpers import getTodayBlocks

SHOW_MAX = 5          # at most this many things are named in one sentence (the rest become "and 2 more")
SHORT_LIST_MAX = 3    # for the smaller sections (yesterday's items, urgent, routine)


# "A, B and C" (or "A and B", or just "A")
def joinNames(names):
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


# Names the first few items, and says how many more there were ("A, B, C and 2 more")
def listWithMore(names, limit):
    if len(names) <= limit:
        return joinNames(names)
    return joinNames(names[:limit] + [f"{len(names) - limit} more"])


# "2:30pm" reads well aloud, so the app's existing time style is reused. A missing time is just left out.
def atTime(timeString):
    return f" at {niceTime(timeString)}" if timeString else ""


# One note, as it is said: "Dentist at 2pm" or just "Call Mum"
def sayNote(note):
    return note["title"].strip() + atTime(note.get("time"))


# "Good morning" / "Good afternoon" / "Good evening" for the person's own clock
def greeting(hour):
    if hour < 12:
        return "Good morning"
    if hour < 18:
        return "Good afternoon"
    return "Good evening"


# Builds the summary. Returns {"sentences": [...], "text": "..."}: the sentences are shown (and read)
# one at a time, and "text" is the same thing joined up.
def buildBriefing(user, nowLocal=None):
    zone = getZone(user["timezone"])
    now = nowLocal or datetime.now(zone)
    today = getToday(user["timezone"])
    view = getTodayView(user)
    sentences = []

    firstName = (user.get("name") or "").strip().split(" ")[0]
    sentences.append(f"{greeting(now.hour)}, {firstName}." if firstName else f"{greeting(now.hour)}.")
    sentences.append(f"Today is {view['todayLabel']}.")

    # Today's notes: what is left, and a quiet nod to what is already done
    pending = [n for n in view["todayNotes"] if not n.get("done")]
    done = [n for n in view["todayNotes"] if n.get("done")]
    if pending:
        spoken = [sayNote(n) for n in pending]
        if len(pending) == 1:
            sentences.append(f"You have one thing today: {spoken[0]}.")
        else:
            sentences.append(f"You have {len(pending)} things today: {listWithMore(spoken, SHOW_MAX)}.")
        if done:
            sentences.append(f"And you've already finished {len(done)}. Nice.")
    elif done:
        sentences.append("Everything on today's list is already done. Nice.")
    else:
        sentences.append("Nothing is planned for today, so the day is yours.")

    # Left over from yesterday: no guilt, just an easy choice
    if view["rollover"]:
        names = [n["title"].strip() for n in view["rollover"]]
        sentences.append(f"From yesterday, still waiting: {listWithMore(names, SHORT_LIST_MAX)}. "
                         "Move them to today, pick a new day, or let them go, whichever feels right.")

    # Urgent things, with the day they are due
    if view["urgent"]:
        parts = []
        for note in view["urgent"][:SHORT_LIST_MAX]:
            label = (note.get("deadlineLabel") or "").lower()
            parts.append(note["title"].strip() + (f", {label}" if label and label != "marked urgent" else ""))
        more = len(view["urgent"]) - SHORT_LIST_MAX
        sentences.append("Urgent: " + "; ".join(parts) + (f"; and {more} more" if more > 0 else "") + ".")

    # Habits scheduled for today
    habits = [h for h in getHabitsForToday(user) if h["active"]]
    if habits:
        todo = [h for h in habits if not h["doneToday"]]
        finished = [h for h in habits if h["doneToday"]]
        if todo:
            spoken = [h["name"] + (f" at {h['timeLabel']}" if h["timeLabel"] else "") for h in todo]
            sentences.append(f"Habits for today: {joinNames(spoken)}.")
        if finished:
            sentences.append(f"You've already done {joinNames([h['name'] for h in finished])}. Well done.")

    # The routine, if there is one today: just where it starts
    blocks = getTodayBlocks(user["user_id"], today)
    if blocks:
        first = blocks[0]
        sentences.append(f"Your routine starts at {first['timeLabel']} with {first['name']}.")

    # A peek at the next few days
    if view["upcoming"]:
        peek = []
        for item in view["upcoming"][:2]:
            peek.append(f"{item['label'].lower()}, {item['text'].replace(' · ', ' at ')}")
        sentences.append("Coming up: " + "; ".join(peek) + ".")

    sentences.append("That's your day. One thing at a time.")
    return {"sentences": sentences, "text": " ".join(sentences)}
