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
    // The sidebar and bottom nav come from base.html, so give them their icons
    const sidebar = document.getElementById('sidebar');
    const bottomNav = document.getElementById('bottom-nav');
    if (sidebar) NavIcons.apply(sidebar);
    if (bottomNav) NavIcons.apply(bottomNav);

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
