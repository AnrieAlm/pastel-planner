# auth.py - checks the Firebase login token and finds (or creates) the user.

import os
from datetime import datetime, timezone

import cachecontrol
import requests
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from db import users

# Google publishes public keys that prove a token is genuine. This adapter fetches them,
# and the cache keeps them for a while so we do not download them on every page load.
firebase_request_adapter = google_requests.Request(
    session=cachecontrol.CacheControl(requests.Session())
)


# Turns the ALLOWED_EMAILS setting ("a@x.com,b@y.com") into a set of lowercase emails
def getAllowedEmails():
    raw = os.environ.get("ALLOWED_EMAILS", "")
    return {email.strip().lower() for email in raw.split(",") if email.strip()}


# Checks a Firebase ID token. Returns the token's details (a dict) if it is genuine, else None.
def validateFirebaseToken(tokenValue):
    if not tokenValue:
        return None

    projectId = os.environ.get("FIREBASE_PROJECT_ID")
    if not projectId:
        print("FIREBASE_PROJECT_ID is not set, so every login is refused.")
        return None

    try:
        # audience=projectId makes sure the token was made for OUR Firebase project,
        # not for some other project that also uses Firebase
        return id_token.verify_firebase_token(
            tokenValue,
            firebase_request_adapter,
            audience=projectId,
            clock_skew_in_seconds=10,
        )
    except Exception as error:
        # Expired, forged or malformed tokens all end up here
        print("Token check failed:", error)
        return None


# Finds this person's user document, or creates it the first time they log in.
def getUser(userToken):
    userId = userToken.get("user_id") or userToken["sub"]

    # A friendly starting name: the name on the account, or the part of the email before the @
    email = userToken.get("email", "")
    startingName = userToken.get("name") or email.split("@")[0] or "friend"

    # $setOnInsert only writes these fields if the document is brand new,
    # so logging in again never overwrites the name or timezone they chose later
    update = {"$setOnInsert": {
        "user_id": userId,
        "name": startingName,
        "timezone": "Europe/Dublin",
        "created_at": datetime.now(timezone.utc),
        "habits": [],
    }}
    # The email is refreshed on every login (it is shown, read-only, on the Settings page)
    if email:
        update["$set"] = {"email": email}
    users.update_one({"user_id": userId}, update, upsert=True)
    return users.find_one({"user_id": userId}, {"_id": 0})


# Looks at the "token" cookie on a request and says who is asking.
# Returns ("ok", user), ("denied", None) or ("anon", None).
def checkRequest(request):
    userToken = validateFirebaseToken(request.cookies.get("token"))
    if userToken is None:
        return "anon", None

    # Only the emails in ALLOWED_EMAILS may use the app (the site itself is public)
    allowed = getAllowedEmails()
    email = (userToken.get("email") or "").lower()
    if not allowed:
        print("ALLOWED_EMAILS is not set, so nobody can log in yet.")
    if email not in allowed:
        return "denied", None

    return "ok", getUser(userToken)
