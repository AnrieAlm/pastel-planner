# grocery_helpers.py - the shopping list. Each item is one document in the grocery collection:
# { user_id, name, name_key, checked, created_at, checked_at, deleted_at, batch }
# Every query filters by user_id, so one person can never see another person's list.

import re
from datetime import datetime, timezone
from uuid import uuid4

from db import grocery
from notes_helpers import toObjectId

NAME_MAX = 60
ADD_LIMIT = 20      # at most this many items from one "add"


# "milk, eggs\nbread" -> ["Milk", "Eggs", "Bread"] (trimmed, capitalised, no repeats)
def splitItems(text):
    seen = set()
    names = []
    for part in re.split(r"[,\n]+", text or ""):
        name = re.sub(r"\s+", " ", part).strip()[:NAME_MAX]
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        names.append(name[0].upper() + name[1:])
    return names[:ADD_LIMIT]


# Adds items to this person's list. Returns how many are now on the "to get" part of the list.
# - already there and not ticked: left alone (no double entries)
# - already there but ticked: put back on the list
def addItems(userId, text):
    added = 0
    for name in splitItems(text):
        key = name.lower()
        existing = grocery.find_one({"user_id": userId, "name_key": key, "deleted_at": None})
        if existing is None:
            grocery.insert_one({
                "user_id": userId, "name": name, "name_key": key, "checked": False,
                "created_at": datetime.now(timezone.utc), "checked_at": None, "deleted_at": None, "batch": None,
            })
            added += 1
        elif existing["checked"]:
            grocery.update_one({"_id": existing["_id"], "user_id": userId},
                               {"$set": {"checked": False, "checked_at": None}})
            added += 1
    return added


# The list for the page: things to get first (oldest first), then the ticked ones
def getGroceryItems(userId):
    items = list(grocery.find({"user_id": userId, "deleted_at": None}).sort("created_at", 1))
    for item in items:
        item["id"] = str(item["_id"])
    items.sort(key=lambda item: item["checked"])
    return items


# Ticks or un-ticks one item. Returns True if the item was found.
def setChecked(userId, itemId, checked):
    objectId = toObjectId(itemId)
    if objectId is None:
        return False
    result = grocery.update_one(
        {"_id": objectId, "user_id": userId, "deleted_at": None},
        {"$set": {"checked": checked, "checked_at": datetime.now(timezone.utc) if checked else None}})
    return result.matched_count > 0


# "Removing" only sets deleted_at and a batch id, so Undo can bring the whole batch back.
# Returns (batch, count); count is 0 when nothing matched.
def removeItems(userId, itemIds):
    objectIds = [oid for oid in (toObjectId(i) for i in itemIds[:200]) if oid is not None]
    batch = uuid4().hex
    result = grocery.update_many({"_id": {"$in": objectIds}, "user_id": userId, "deleted_at": None},
                                 {"$set": {"deleted_at": datetime.now(timezone.utc), "batch": batch}})
    return batch, result.modified_count


# Removes every ticked item (as one batch)
def clearChecked(userId):
    batch = uuid4().hex
    result = grocery.update_many({"user_id": userId, "checked": True, "deleted_at": None},
                                 {"$set": {"deleted_at": datetime.now(timezone.utc), "batch": batch}})
    return batch, result.modified_count


# Undo: brings back a whole batch. Returns how many items came back.
def restoreBatch(userId, batch):
    if not batch:
        return 0
    result = grocery.update_many({"user_id": userId, "batch": batch, "deleted_at": {"$ne": None}},
                                 {"$set": {"deleted_at": None, "batch": None}})
    return result.modified_count
