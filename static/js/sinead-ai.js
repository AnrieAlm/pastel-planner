/**
 * Calyx Planner — Sinéad AI Assistant (stub)
 *
 * Not real AI yet. Every method here just logs to the console so the
 * rest of the app (today.js, grocery.js) has something to call while
 * the UI is being built. Real behaviour is a later build stage — the
 * project's actual AI plan is the Groq note-parse pipeline in the
 * FastAPI backend's ai.py, not this file; this stub only covers the
 * lighter, front-end-only touches (briefing playback, grocery nudges)
 * the reference template shipped with.
 *
 * Wired up right now:
 *   - init()         → called once from App.init() in app.js
 *   - playBriefing() → called from the "Play morning briefing" button
 *                      on the Today page (js/today.js)
 *   - nudge(message) → called from js/grocery.js to surface a suggestion
 *                      in the .sinead-nudge banner on Today
 *
 * (detectPatterns() was removed here — it wasn't called from anywhere
 * in the app, so it was dead code rather than a real stub. Re-add it
 * once there's an actual caller and a real habits/grocery pattern to
 * detect.)
 */
const SineadAI = {
  // Runs once on app load. Nothing to set up yet — placeholder for
  // whatever real initialisation (e.g. warming up a model call) ends
  // up being needed later.
  init() {
    console.log('Sinéad AI initialised 🧠');
  },

  // Triggered by the Today page's "Play morning briefing" button.
  // Will eventually read out (or display) a short AI-generated summary
  // of the day; for now it just confirms the click reached here.
  playBriefing() {
    console.log('Playing morning briefing…');
  },

  // Called with a short message to show in the .sinead-nudge banner.
  // Currently just a pass-through log — grocery.js already builds the
  // message text itself, so there's no real logic here yet.
  nudge(message) {
    console.log('Sinéad nudge:', message);
  }
};
