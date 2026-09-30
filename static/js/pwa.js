// pwa.js - registers the service worker (see sw.js in the project root), which makes the app
// install-able and shows the "Waking things up…" page when the free server is asleep.
// It waits until the page has finished loading so it never slows the first view down.

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Service worker could not start:', error);
    });
  });
}
