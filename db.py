# db.py - the MongoDB connection, made once and shared by the whole app.
# The connection string comes from an environment variable, never from code.

import os

from pymongo import MongoClient
from pymongo.server_api import ServerApi

# Read the secret connection string (set in Render > Environment, or in .env on your laptop)
mongoUri = os.environ.get("MONGODB_URI")
if not mongoUri:
    raise RuntimeError("MONGODB_URI is not set. Add it in Render > Environment (or in your .env file).")

# Connect to Atlas. ServerApi('1') pins the API version, exactly like the class examples.
# MongoClient connects lazily, so this line does not fail if Atlas is slow to answer.
client = MongoClient(mongoUri, server_api=ServerApi("1"))

# Pick the database by name (falls back to "calyx-planner")
db = client[os.environ.get("MONGODB_DB", "calyx-planner")]

# The four collections from the data model. Every query on them must filter by user_id.
users = db["users"]
notes = db["notes"]
habit_logs = db["habit_logs"]
devices = db["devices"]


# Indexes make lookups fast and stop duplicates. Creating one that already exists does nothing.
def createIndexes():
    users.create_index("user_id", unique=True)
    notes.create_index([("user_id", 1), ("date", 1)])
    habit_logs.create_index([("user_id", 1), ("date", 1)], unique=True)
    devices.create_index("fcm_token", unique=True)
