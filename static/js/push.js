// push.js - lets a browser ask for permission, register with Firebase Cloud Messaging, and hand
// that registration's token to the server so reminders.py knows where to send it.
// The actual sending happens elsewhere (see reminders.py); this file only ever REGISTERS a device.

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getMessaging, getToken, deleteToken, onMessage, isSupported }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";

// Same public config as firebase-login.js (safe to repeat here — it is not a secret)
const firebaseConfig = {
  apiKey: "AIzaSyBC6S9WAW3_cxYWjpRCuKWqJtc3_pT1MYU",
  authDomain: "pastel-planner-6a858.firebaseapp.com",
  projectId: "pastel-planner-6a858",
  storageBucket: "pastel-planner-6a858.firebasestorage.app",
  messagingSenderId: "917808144194",
  appId: "1:917808144194:web:70908a675f8b803076f2db",
};

// The VAPID key is fetched from the server (it lives in an environment variable there) rather
// than typed into this file, so it is never hard-coded into the repository.
let vapidKeyPromise = null;
function getVapidKey() {
  if (!vapidKeyPromise) {
    vapidKeyPromise = fetch('/api/config').then(r => r.json()).then(config => config.vapidKey);
  }
  return vapidKeyPromise;
}

// Remembers the token we last registered, so turning the Settings toggle off knows what to forget
const LAST_TOKEN_KEY = 'calyx-planner-push-token';

window.CalyxPush = {
  // Browsers without the Push API (older Safari, or iPhone Safari before the app is added to
  // the home screen) simply cannot do any of this
  async isSupported() {
    try {
      return 'Notification' in window && (await isSupported());
    } catch (error) {
      return false;
    }
  },

  // 'granted' | 'denied' | 'default' (never asked), or null if Notifications don't exist at all
  permission() {
    return ('Notification' in window) ? Notification.permission : null;
  },

  // Asks for permission (only if not already decided), then registers this browser for push
  // and saves the token on the server. Returns true on success.
  async enable() {
    if (!(await this.isSupported())) return false;

    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') return false;

    try {
      const registration = await navigator.serviceWorker.ready;
      const app = getApps()[0] || initializeApp(firebaseConfig);
      const messaging = getMessaging(app);
      const vapidKey = await getVapidKey();
      const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
      if (!token) return false;

      const response = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) return false;

      localStorage.setItem(LAST_TOKEN_KEY, token);
      this.initForegroundMessages(messaging);
      return true;
    } catch (error) {
      console.warn('Could not enable push notifications:', error);
      return false;
    }
  },

  // Forgets this browser's token, both with Firebase and on the server
  async disable() {
    const savedToken = localStorage.getItem(LAST_TOKEN_KEY);
    try {
      if (await this.isSupported()) {
        const app = getApps()[0] || initializeApp(firebaseConfig);
        const messaging = getMessaging(app);
        await deleteToken(messaging);
      }
    } catch (error) {
      // Not fatal — we still remove it from our own records below
    }
    if (savedToken) {
      await fetch('/api/devices', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: savedToken }),
      }).catch(() => {});
    }
    localStorage.removeItem(LAST_TOKEN_KEY);
  },

  // A push that arrives while the app is already open doesn't go through the service worker
  // (see sw.js), so it needs its own handler here to still show something
  initForegroundMessages(messaging) {
    if (this._listening) return;
    this._listening = true;
    onMessage(messaging, (payload) => {
      const text = payload.notification?.title || payload.data?.title || 'Calyx Planner';
      if (typeof Today !== 'undefined') Today.toast(text);
    });
  },
};

// If this browser already has permission from a previous visit, quietly keep the registration
// fresh (tokens can rotate) without asking again
(async () => {
  if (await window.CalyxPush.isSupported() && Notification.permission === 'granted') {
    window.CalyxPush.enable();
  }
})();
