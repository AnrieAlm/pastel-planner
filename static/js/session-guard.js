/**
 * Calyx Planner — Session guard
 *
 * The problem this solves: your login "ticket" (a Firebase token) only lasts one hour. If you leave
 * the app open, or your phone sleeps, the ticket in the cookie can be stale by the time you tap
 * Save. The server then says "who are you?", sends you to the login page, and whatever you typed
 * is gone.
 *
 * The fix, in one sentence: just BEFORE anything is sent to the server, ask Firebase for a fresh
 * ticket (it is instant when the old one is still good), and if that is impossible, send nothing and
 * tell the person calmly, so what they typed stays on the screen.
 *
 * It protects three things:
 *   1. Normal forms (the "Save" buttons), when they are submitted by tapping or pressing Enter.
 *   2. Forms that other scripts send with form.submit().
 *   3. fetch() calls that change something (POST and so on) to our own /api/ addresses.
 * (Opening a page or reading data is not protected here: nothing typed can be lost that way.)
 *
 * firebase-login.js (which knows how to talk to Firebase) hands its tools to this file through
 * CalyxSession.attach(). This file stays plain JavaScript, so it is easy to read and test.
 */
(function () {
  // How long to wait for Firebase to finish loading before we give up and just carry on as before
  const config = { waitMs: 3000 };

  let tools = null;                 // { getUser, setCookie }, set by attach()
  let markReady;
  const ready = new Promise((resolve) => { markReady = resolve; });
  let gaveUp = false;               // true once Firebase failed to load in time (so we never wait again)

  const nativeSubmit = HTMLFormElement.prototype.submit;
  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  // Called once by firebase-login.js when Firebase is ready
  function attach(firebaseTools) {
    tools = firebaseTools;
    markReady(firebaseTools);
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Firebase errors that mean "this person is no longer signed in" (as opposed to "no internet")
  const SIGNED_OUT_CODES = ['auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-disabled',
                            'auth/user-not-found', 'auth/requires-recent-login'];

  // Makes sure the login cookie holds a fresh token. Answers with one word:
  //   'ok'          - cookie is fresh, go ahead
  //   'signed-out'  - nobody is signed in any more
  //   'offline'     - could not reach Firebase to refresh the token
  //   'unavailable' - Firebase never loaded; carry on exactly as the app always did
  // forceRefresh = true asks Firebase for a brand-new token even if the old one looks fine.
  async function ensureFreshToken(forceRefresh) {
    if (!tools) {
      if (gaveUp) return 'unavailable';
      const found = await Promise.race([ready, wait(config.waitMs).then(() => null)]);
      if (!found) {
        gaveUp = true;
        return 'unavailable';
      }
    }

    let user;
    try {
      user = await tools.getUser();
    } catch (error) {
      return 'unavailable';
    }
    if (!user) return 'signed-out';

    try {
      // Firebase only goes to the internet if the token is close to expiring (or we force it)
      const token = await user.getIdToken(Boolean(forceRefresh));
      tools.setCookie(token);
      return 'ok';
    } catch (error) {
      return SIGNED_OUT_CODES.includes(error && error.code) ? 'signed-out' : 'offline';
    }
  }

  // ---------- The calm message on top of the page ----------

  const MESSAGES = {
    'signed-out': 'You\u2019ve been signed out, so I haven\u2019t sent that. Your words are still here. ',
    'offline': 'I can\u2019t reach the internet right now, so I haven\u2019t sent that. Your words are still here. Try again in a moment.'
  };

  function hideBanner() {
    const banner = document.getElementById('session-banner');
    if (banner) banner.remove();
  }

  function showBanner(kind) {
    let banner = document.getElementById('session-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'session-banner';
      banner.className = 'session-banner';
      banner.setAttribute('role', 'alert');
      document.body.appendChild(banner);
    }
    banner.dataset.kind = kind;
    banner.textContent = '';          // textContent/DOM calls only, so nothing here can ever be treated as HTML

    const message = document.createElement('p');
    message.textContent = MESSAGES[kind] || MESSAGES.offline;
    banner.appendChild(message);

    if (kind === 'signed-out') {
      // Opens the login page in a NEW tab, so this page (and your words) stay exactly as they are.
      // Firebase tells every open tab when you sign in, so this banner then goes away by itself.
      const link = document.createElement('a');
      link.href = '/login';
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Log in again';
      message.appendChild(link);
      message.appendChild(document.createTextNode(', then press the button once more.'));
    }

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'session-banner-close';
    ok.textContent = 'OK';
    ok.addEventListener('click', hideBanner);
    banner.appendChild(ok);
  }

  // ---------- 1 + 2: forms ----------

  function onLoginPage() {
    return !!document.getElementById('auth-container');
  }

  // Only forms that POST to our own site are guarded
  function isGuardedForm(form) {
    if (!(form instanceof HTMLFormElement) || onLoginPage()) return false;
    if ((form.getAttribute('method') || 'get').toLowerCase() !== 'post') return false;
    if (form.dataset.noSessionCheck !== undefined) return false;
    try {
      return new URL(form.action, window.location.href).origin === window.location.origin;
    } catch (error) {
      return false;
    }
  }

  // Refresh the token, then send the form for real. Nothing is sent if refreshing failed.
  async function guardedSubmit(form, submitter, cameFromSubmitEvent) {
    const state = await ensureFreshToken(false);
    if (state === 'signed-out' || state === 'offline') {
      showBanner(state);
      return;
    }
    form.dataset.calyxChecked = 'yes';           // tells the next pass "already checked, let it through"
    if (cameFromSubmitEvent && form.requestSubmit) {
      // requestSubmit remembers WHICH button was pressed (some buttons carry a value the server needs)
      form.requestSubmit(submitter || undefined);
    } else {
      nativeSubmit.call(form);
      setTimeout(() => { delete form.dataset.calyxChecked; }, 0);
    }
  }

  // Runs for every submit, after the form's own handlers (so any "is this valid?" checks go first)
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (form.dataset && form.dataset.calyxChecked === 'yes') {
      delete form.dataset.calyxChecked;          // second pass: already checked, let it go
      return;
    }
    if (event.defaultPrevented || !isGuardedForm(form)) return;
    event.preventDefault();                      // hold the form for a moment...
    guardedSubmit(form, event.submitter, true);  // ...refresh the token, then send it
  });

  // Other scripts call form.submit() directly (routine.js, today.js). That skips the submit event,
  // so we wrap it too.
  HTMLFormElement.prototype.submit = function () {
    if (this.dataset && this.dataset.calyxChecked === 'yes') {
      return nativeSubmit.call(this);
    }
    if (!isGuardedForm(this)) return nativeSubmit.call(this);
    guardedSubmit(this, null, false);
  };

  // ---------- 3: fetch() calls that change something ----------

  function isOurApi(url) {
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/');
    } catch (error) {
      return false;
    }
  }

  // What callers get when we deliberately did not send the request. It is a normal "failed" answer,
  // so every caller's existing "Couldn't save, please try again" path runs and keeps the screen as it is.
  function notSentResponse() {
    return new Response(JSON.stringify({ error: 'session' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (nativeFetch) {
    window.fetch = async function (input, init) {
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      if (method === 'GET' || method === 'HEAD' || !isOurApi(url) || onLoginPage()) {
        return nativeFetch(input, init);
      }

      const state = await ensureFreshToken(false);
      if (state === 'signed-out' || state === 'offline') {
        showBanner(state);
        return notSentResponse();
      }

      let response = await nativeFetch(input, init);
      // The server still did not accept our ticket: get a brand-new one and try ONCE more.
      // (A 401 means the server refused BEFORE doing anything, so trying again can never save twice.)
      if (response.status === 401 && state === 'ok') {
        const again = await ensureFreshToken(true);
        if (again === 'ok') return nativeFetch(input, init);
        if (again === 'signed-out' || again === 'offline') {
          showBanner(again);
          return notSentResponse();
        }
      }
      return response;
    };
  }

  window.CalyxSession = {
    attach,
    ensureFreshToken,
    config,
    // firebase-login.js calls this whenever someone is signed in (including in another tab)
    signedIn: hideBanner
  };
})();
