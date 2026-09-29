/**
 * Calyx Planner - Main App Bootstrap
 * The server (Jinja2) now sends the sidebar, bottom nav and page,
 * so all this file does is switch the scripts on.
 */
document.addEventListener('DOMContentLoaded', () => {
  try {
    App.init();
  } catch (err) {
    console.error('Failed to start app:', err);
  }
});

const App = {
  init() {
    EmojiIcons.apply();
    // Give every nav-icon placeholder on the page its real icon
    NavIcons.apply(document);

    Navigation.init();
    Auth.init();
    Today.init();
    Routine.init();
    Notes.init();
    Calendar.init();
    Habits.init();
    Grocery.init();
    Bucketlist.init();
    Settings.init();
    Modals.init();
    SineadAI.init();
  }
};
