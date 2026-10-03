# tts.py - turns Sinéad's day summary into speech, using Piper: a small, free, offline voice
# model (en_GB-alba-medium) that runs inside this same container. No AI service, no API key,
# no per-request cost, and your words never leave the server.
#
# The voice model itself is downloaded once, when the Docker image is BUILT (see the Dockerfile),
# not on every request or every time the free-tier server wakes back up - so there's no download
# wait at runtime, only the much shorter SYNTHESIS wait (a second or so for a short summary),
# and that result is cached per person per day so pressing Play twice doesn't redo the work.

import io
import wave
from pathlib import Path
from threading import Lock

VOICE_NAME = "en_GB-alba-medium"
VOICE_DIR = Path(__file__).parent / "voices"

_voice = None
_voiceLock = Lock()


# Raised when the voice model can't be used for any reason (missing files, Piper itself
# failing). The route that calls synthesize() catches this and falls back to the browser's
# own voice, so a problem here never breaks the Play button - it just sounds different.
class VoiceUnavailable(Exception):
    pass


# Loads the Piper voice into memory the first time it's needed, then reuses that one copy for
# every request after. A Lock stops two requests arriving at the same moment from both loading
# it at once (wasteful, not dangerous, but there's no reason to do it twice).
def getVoice():
    global _voice
    if _voice is not None:
        return _voice
    with _voiceLock:
        if _voice is not None:          # another request may have finished loading while we waited
            return _voice
        model = VOICE_DIR / f"{VOICE_NAME}.onnx"
        config = VOICE_DIR / f"{VOICE_NAME}.onnx.json"
        if not model.exists() or not config.exists():
            return None
        from piper.voice import PiperVoice
        _voice = PiperVoice.load(model, config)
        return _voice


# Turns text into WAV audio bytes, held only in memory - nothing is written to disk.
# Raises VoiceUnavailable if the voice model is missing or Piper itself fails.
def synthesize(text):
    voice = getVoice()
    if voice is None:
        raise VoiceUnavailable("the Alba voice model is not available")
    try:
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wavFile:
            voice.synthesize_wav(text, wavFile)
        return buffer.getvalue()
    except VoiceUnavailable:
        raise
    except Exception as error:
        raise VoiceUnavailable(f"Piper failed to synthesize: {error}") from error


# A small per-day cache so the same brief isn't resynthesised every time someone presses Play.
# Keyed by (user_id, the calendar day the brief covers, in THEIR OWN timezone - see main.py).
# Lives in memory only: it is private to this one person (never written to a shared file) and
# resets whenever the server restarts, which simply means the next Play regenerates once.
_cache = {}
_cacheLock = Lock()


def getCachedAudio(userId, dayKey):
    with _cacheLock:
        entry = _cache.get(userId)
    if entry and entry[0] == dayKey:
        return entry[1]
    return None


def setCachedAudio(userId, dayKey, audioBytes):
    with _cacheLock:
        _cache[userId] = (dayKey, audioBytes)


# Account deletion should also clear anything cached here (see account_helpers.deleteAccountData)
def clearCachedAudio(userId):
    with _cacheLock:
        _cache.pop(userId, None)
