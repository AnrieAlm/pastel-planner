# routine_helpers.py - the Routine feature. A routine is a named set of time-blocks (e.g.
# "Morning weekday": 7:00 coffee, 7:10 yoga, 7:35 shower...) active on certain days.
# Several routines can be active on the same day without conflict (a morning one and an evening
# one, say) — Today simply merges every block from every routine active today into one timeline.
# The only thing worth warning about is a genuine TIME overlap between two routines' blocks on a
# shared day (see findOverlaps); even then nothing is changed automatically — the person chooses
# whether to save anyway, go back and adjust, or merge the two routines into one.
#
# { _id, user_id, name, days: [...], active, blocks: [{block_id, time, name, duration_min,
#   linked_habit_id}], created_at, deleted_at }
# routine_logs: { user_id, date, done_block_ids: [...] } - one document per person per day

import uuid
from datetime import datetime, timezone

from db import routine_logs, routines
from habits_helpers import DAY_KEYS, getHabitsForWeekday  # noqa: F401  (kept for callers that want it)
from notes_helpers import cleanText, cleanTime, niceTime, toObjectId

NAME_MAX = 60
BLOCK_NAME_MAX = 60
MAX_BLOCKS = 20
DEFAULT_DURATION_MIN = 5
DAY_LABELS = {"mon": "Mon", "tue": "Tue", "wed": "Wed", "thu": "Thu", "fri": "Fri", "sat": "Sat", "sun": "Sun"}


# "mon,wed" -> ["mon", "wed"] (kept in Monday-first order). Nothing valid means every day.
def cleanDays(value):
    chosen = [word.strip().lower() for word in (value or "").split(",")]
    days = [key for key in DAY_KEYS if key in chosen]
    return days or DAY_KEYS[:]


# Turns the editor's parallel arrays (one entry per block row) into clean, sorted block
# dictionaries. A row with no usable time or name is silently dropped — this is what lets the
# overlap check work even while a half-filled "+ Add block" row is still sitting on the page.
def buildBlocks(times, names, durations, habits, userHabitIds):
    rows = list(zip(times or [], names or [], durations or [], habits or []))
    cleaned = []
    for rawTime, rawName, rawDuration, rawHabitId in rows[:MAX_BLOCKS]:
        blockTime = cleanTime(rawTime)
        name = cleanText(rawName, BLOCK_NAME_MAX)
        if not blockTime or not name:
            continue
        try:
            duration = int(rawDuration)
            duration = max(1, min(240, duration))
        except (TypeError, ValueError):
            duration = DEFAULT_DURATION_MIN
        habitId = rawHabitId if rawHabitId in userHabitIds else None
        cleaned.append({
            "block_id": uuid.uuid4().hex[:12],
            "time": blockTime,
            "name": name,
            "duration_min": duration,
            "linked_habit_id": habitId,
        })
    cleaned.sort(key=lambda b: b["time"])
    return cleaned


# A block's (start, end) as plain minute-of-day numbers, for overlap comparison
def blockWindow(block):
    hour, minute = (int(part) for part in block["time"].split(":"))
    start = hour * 60 + minute
    return start, start + block["duration_min"]


# Does this routine's blocks genuinely overlap in TIME, on a day they would both be active, with
# any other active routine this person has? Nothing is changed here — it only reports what it
# finds, as a list with one entry per overlapping block-pair.
def findOverlaps(userId, days, blocks, excludeId=None):
    conflicts = []
    query = {"user_id": userId, "deleted_at": None, "active": True}
    if excludeId:
        query["_id"] = {"$ne": excludeId}
    for other in routines.find(query):
        sharedDays = [d for d in DAY_KEYS if d in days and d in other.get("days", [])]
        if not sharedDays:
            continue
        dayLabel = ", ".join(DAY_LABELS[d] for d in sharedDays)
        for block in blocks:
            bStart, bEnd = blockWindow(block)
            for otherBlock in other.get("blocks", []):
                oStart, oEnd = blockWindow(otherBlock)
                if bStart < oEnd and oStart < bEnd:
                    conflicts.append({
                        "routine_id": str(other["_id"]),
                        "dayLabel": dayLabel,
                        "blockName": block["name"],
                        "blockTime": niceTime(block["time"]),
                        "withRoutine": other["name"],
                        "withBlock": otherBlock["name"],
                        "withTime": niceTime(otherBlock["time"]),
                    })
    return conflicts


# Adds a new routine. With no name AND no blocks nothing is created; with blocks but no name it
# is saved as "My routine" so the person's typing is never lost.
def addRoutine(userId, name, days, blocks):
    cleanName = cleanText(name, NAME_MAX)
    if not cleanName:
        # Blocks were typed but the name was left empty: keep the blocks under a default name
        # instead of silently throwing them away. No blocks and no name: nothing to save.
        if not blocks:
            return None
        cleanName = "My routine"
    result = routines.insert_one({
        "user_id": userId, "name": cleanName, "days": days, "active": True, "blocks": blocks,
        "created_at": datetime.now(timezone.utc), "deleted_at": None,
    })
    return result.inserted_id


# Saves changes to a routine. A blank name leaves the existing name alone (same rule as notes).
def updateRoutine(userId, routineId, name, days, blocks, active):
    objectId = toObjectId(routineId)
    if objectId is None:
        return
    changes = {"days": days, "blocks": blocks, "active": active}
    cleanName = cleanText(name, NAME_MAX)
    if cleanName:
        changes["name"] = cleanName
    routines.update_one({"_id": objectId, "user_id": userId, "deleted_at": None}, {"$set": changes})


# Removing a whole routine is a deliberate, infrequent action — unlike notes/bucket items/
# groceries, there is no Undo for it, so this is a real delete rather than a soft one.
def deleteRoutine(userId, routineId):
    objectId = toObjectId(routineId)
    if objectId is None:
        return
    routines.delete_one({"_id": objectId, "user_id": userId})


# Combines two of this person's routines into one: every day either used, every block from both
# (nothing de-duplicated — a redundant block can simply be removed by hand afterwards). Keeps
# `keepId`, deletes `mergeId` outright. Returns False if either id isn't this person's.
def mergeRoutines(userId, keepId, mergeId):
    keepObjectId, mergeObjectId = toObjectId(keepId), toObjectId(mergeId)
    if keepObjectId is None or mergeObjectId is None:
        return False
    keep = routines.find_one({"_id": keepObjectId, "user_id": userId, "deleted_at": None})
    merge = routines.find_one({"_id": mergeObjectId, "user_id": userId, "deleted_at": None})
    if not keep or not merge:
        return False

    mergedDays = [d for d in DAY_KEYS if d in keep.get("days", []) or d in merge.get("days", [])]
    mergedBlocks = sorted(keep.get("blocks", []) + merge.get("blocks", []), key=lambda b: b["time"])
    routines.update_one({"_id": keepObjectId}, {"$set": {"days": mergedDays, "blocks": mergedBlocks}})
    routines.delete_one({"_id": mergeObjectId})
    return True


# "7:00am" of the first block -> "...8:25am" end of the last, or a plain block count if that
# would be misleading (e.g. a single point-in-time block with no real "span")
def formatTimeSpan(blocks):
    if not blocks:
        return "No blocks yet"
    startLabel = niceTime(blocks[0]["time"])
    if len(blocks) == 1:
        return startLabel
    _, lastEnd = blockWindow(blocks[-1])
    endLabel = niceTime(f"{lastEnd // 60 % 24:02d}:{lastEnd % 60:02d}")
    return f"{startLabel} \u2013 {endLabel}"


# Adds the display fields the templates use to each block (kept separate from the raw stored
# block so saved data never accidentally includes a derived, possibly-stale field)
def decorateBlock(block):
    return {**block, "timeLabel": niceTime(block["time"])}


# Every routine this person has, ready for the Routine page — in the order they happen through
# the day (routines with no blocks yet sit at the end), so the page reads top-to-bottom like a
# daily schedule rather than a list sorted by when each routine happened to be created.
def getRoutines(userId):
    found = list(routines.find({"user_id": userId, "deleted_at": None}))
    found.sort(key=lambda r: (r["blocks"][0]["time"] if r.get("blocks") else "99:99", r["name"]))

    view = []
    for routine in found:
        view.append({
            "id": str(routine["_id"]),
            "name": routine["name"],
            "active": routine.get("active", True),
            "days": routine.get("days", []),
            "timeSpan": formatTimeSpan(routine.get("blocks", [])),
            "blocks": [decorateBlock(b) for b in routine.get("blocks", [])],
        })
    return view


# Every block, from every active routine scheduled on `today`, merged into one sorted timeline.
# Each block keeps its own routine_id — ticking it (see toggleBlockDone) needs to know which
# routine it came from.
def getTodayBlocks(userId, today):
    activeToday = routines.find({"user_id": userId, "deleted_at": None, "active": True,
                                 "days": DAY_KEYS[today.weekday()]})
    timeline = []
    for routine in activeToday:
        for block in routine.get("blocks", []):
            timeline.append({**decorateBlock(block), "routine_id": str(routine["_id"])})
    timeline.sort(key=lambda b: b["time"])
    return timeline


# The block_ids already ticked today, as a set (so the template's `in` checks are instant)
def getDoneBlockIds(userId, dateIso):
    log = routine_logs.find_one({"user_id": userId, "date": dateIso})
    return set((log or {}).get("done_block_ids", []))


# Ticks (or un-ticks) one block — it always TOGGLES whatever today's current state is. Returns
# (True, {"done": bool, "linkedHabitId": str|None}), or (False, None) if the block doesn't exist
# or isn't this person's. This does NOT touch habit_logs itself — the caller (main.py) decides
# whether today's date qualifies for an auto-tick and calls setHabitLog on its own.
def toggleBlockDone(userId, routineId, blockId, day):
    objectId = toObjectId(routineId)
    if objectId is None:
        return False, None
    routine = routines.find_one({"_id": objectId, "user_id": userId, "deleted_at": None})
    if not routine:
        return False, None
    block = next((b for b in routine.get("blocks", []) if b["block_id"] == blockId), None)
    if not block:
        return False, None

    log = routine_logs.find_one({"user_id": userId, "date": day})
    currentlyDone = blockId in (log or {}).get("done_block_ids", [])
    newDone = not currentlyDone
    if newDone:
        routine_logs.update_one({"user_id": userId, "date": day},
                                {"$addToSet": {"done_block_ids": blockId}}, upsert=True)
    else:
        routine_logs.update_one({"user_id": userId, "date": day}, {"$pull": {"done_block_ids": blockId}})

    return True, {"done": newDone, "linkedHabitId": block.get("linked_habit_id")}


# When a habit is removed, routine blocks that were linked to it become plain blocks again
# (otherwise they would point at a habit that no longer exists).
def unlinkHabit(userId, habitId):
    for routine in routines.find({"user_id": userId, "blocks.linked_habit_id": habitId}):
        blocks = routine.get("blocks", [])
        for block in blocks:
            if block.get("linked_habit_id") == habitId:
                block["linked_habit_id"] = None
        routines.update_one({"_id": routine["_id"], "user_id": userId}, {"$set": {"blocks": blocks}})
