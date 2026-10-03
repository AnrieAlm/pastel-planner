/**
 * Calyx Planner — Sinéad (front-end touches)
 *
 * The real AI (sorting a brain-dump, the microphone, follow-up questions) lives in the backend's
 * ai.py and in today.js. This file holds the lighter touches:
 *
 *   - playBriefing() / stopBriefing(): the Play button. It fetches today's summary from
 *     /api/briefing (plain sentences built from your own notes, habits and routine, no AI) and
 *     shows them in a small panel. For the voice, it first tries Sinéad's own voice (Alba, a free
 *     Piper model generated on the server at /api/briefing/audio) - the same calm voice on every
 *     device, nothing to install. If that isn't available (not deployed yet, or the request
 *     fails), it quietly falls back to the browser's own built-in voice, exactly as before.
 *     Browsers that can't do either still show the words.
 *   - nudge(message): called from grocery.js; just logs for now.
 *
 * The three Play buttons (the one on Today, the floating one on desktop, and the bottom bar's centre
 * button on phones) all do the same thing, so one click listener at the bottom handles all of them.
 */
const SineadAI = {
  _state: 'idle',            // 'idle' | 'loading' | 'speaking'
  _run: 0,                   // bumps every time we start or stop, so a late answer from an old run is ignored

  init() {
    // Leaving the page must stop the voice
    window.addEventListener('pagehide', () => this.stopBriefing());
    // Escape closes the summary panel
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('briefing-panel')) this.stopBriefing();
    });
  },

  // All the Play buttons on the page
  _buttons() {
    return document.querySelectorAll('.btn-briefing, #global-play-fab, .bottom-nav-add[data-nav-add-mode="play"]');
  },

  // Shows Play or Stop on every Play button (icon, spoken label, pressed state)
  _showState(state) {
    this._state = state;
    const playing = state !== 'idle';
    for (const button of this._buttons()) {
      const icon = NavIcons.map[playing ? 'stop' : 'play'];
      const label = playing ? 'Stop the summary' : "Play today's summary";
      button.setAttribute('aria-pressed', String(playing));
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-busy', String(state === 'loading'));
      const text = button.querySelector('.btn-briefing-label');
      if (text) {
        // The wide button on Today: swap just the icon and the words next to it
        const iconHolder = button.querySelector('svg, .nav-icon');
        if (iconHolder) iconHolder.outerHTML = icon;
        text.textContent = playing ? 'Stop' : "Play today's summary";
      } else {
        button.innerHTML = icon;
      }
    }
  },

  // The tap on any Play button: start, or stop if it is already playing
  async playBriefing() {
    if (this._state !== 'idle') {
      this.stopBriefing();
      return;
    }
    const run = ++this._run;
    this._showState('loading');

    let data;
    try {
      // Make sure the login ticket is fresh first (session-guard.js, when it is there)
      if (window.CalyxSession) await window.CalyxSession.ensureFreshToken(false);
      const response = await fetch('/api/briefing');
      if (response.status === 401) { window.location.href = '/login'; return; }
      if (!response.ok) throw new Error('briefing failed');
      data = await response.json();
    } catch (error) {
      if (run === this._run) {
        this._showState('idle');
        this._say('I couldn\u2019t put your day together just now. Please try again.');
      }
      return;
    }
    if (run !== this._run) return;                       // stopped while we were waiting

    const sentences = Array.isArray(data.sentences) ? data.sentences.filter(s => typeof s === 'string' && s) : [];
    if (!sentences.length) {
      this._showState('idle');
      return;
    }
    const items = this._openPanel(sentences);

    // Sinéad's own voice (Piper, running on the server) is tried first - the same calm voice on
    // every device, nothing to install. true means it is already playing (or the person was
    // signed out and is being sent to log in again); either way, nothing more to do here.
    const playedWithServerVoice = await this._playServerVoice(run);
    if (playedWithServerVoice) return;
    if (run !== this._run) return;                       // stopped while we were waiting

    const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    if (!canSpeak) {
      // No voice available at all: the words in the panel are the summary
      this._showState('idle');
      this._say('This browser can\u2019t read aloud, so here it is in words.');
      return;
    }
    // Browsers often load their voices a moment AFTER the page opens. If we spoke before they were
    // there, the device's own default voice would be used instead of the one we want.
    const voices = await this._loadVoices();
    if (run !== this._run) return;                       // stopped while the voices were loading
    this._speak(sentences, items, run, voices);
  },

  // Tries Sinéad's own voice: a single audio file from the server (Piper, Alba). Returns true if
  // it started playing (the browser-voice fallback below is then skipped entirely) or if the
  // person needed to be sent to log in again; false means "use the browser's own voice instead" -
  // the voice model not being deployed yet, a network problem, or a browser that refuses to play
  // it are all treated the same gentle way.
  async _playServerVoice(run) {
    let blobUrl;
    try {
      const response = await fetch('/api/briefing/audio');
      if (response.status === 401) { window.location.href = '/login'; return true; }
      if (!response.ok) return false;                     // most often 503: not available right now
      const blob = await response.blob();
      if (run !== this._run) return true;                 // stopped while we were waiting - don't start playing
      blobUrl = URL.createObjectURL(blob);
    } catch (error) {
      return false;
    }

    const audio = new Audio(blobUrl);
    let started = false;

    audio.addEventListener('ended', () => {
      URL.revokeObjectURL(blobUrl);
      if (this._audioEl === audio) this._audioEl = null;
      if (run === this._run) this._finished();
    });
    audio.addEventListener('error', () => {
      URL.revokeObjectURL(blobUrl);
      if (this._audioEl === audio) this._audioEl = null;
      // If playback had already started, stop gracefully rather than switching voices mid-sentence
      if (started && run === this._run) this._finished();
    });

    try {
      await audio.play();
    } catch (error) {
      URL.revokeObjectURL(blobUrl);
      return false;                                        // could not start at all - browser voice takes over
    }
    started = true;
    if (run !== this._run) {                               // stopped while play() itself was still resolving
      audio.pause();
      URL.revokeObjectURL(blobUrl);
      return true;
    }
    this._audioEl = audio;
    this._showState('speaking');
    return true;
  },

  // Reads the sentences one after another (short pieces are more reliable than one long speech)
  _speak(sentences, items, run, voices) {
    const synth = window.speechSynthesis;
    synth.cancel();                                      // clear anything still queued
    const voice = this.chooseVoice(voices || []);
    this._showState('speaking');

    sentences.forEach((sentence, index) => {
      const utterance = new SpeechSynthesisUtterance(sentence);
      this._applyVoice(utterance, voice);
      utterance.rate = 0.95;
      utterance.onstart = () => {
        if (run !== this._run) return;
        items.forEach((li, i) => li.classList.toggle('speaking', i === index));
      };
      utterance.onend = () => {
        if (run !== this._run) return;
        items[index]?.classList.remove('speaking');
        if (index === sentences.length - 1) this._finished();
      };
      utterance.onerror = (event) => {
        // "canceled"/"interrupted" just mean we stopped it ourselves
        if (run !== this._run || event.error === 'canceled' || event.error === 'interrupted') return;
        this._finished();
      };
      synth.speak(utterance);
    });
  },

  // ----- Choosing the voice. Voices are installed on each device (not in this app), so what is
  // available depends on your phone or computer. The order of preference is:
  //   1. the voice you picked in Settings (saved on this device), if it is still there
  //   2. Irish English, 3. British English, 4. any other English EXCEPT Indian English
  //   5. Indian English, only if nothing else exists, 6. the device's own default
  VOICE_KEY: 'calyx-summary-voice',

  // Waits (up to a second and a half) for the browser to finish loading its voices
  _loadVoices() {
    const synth = window.speechSynthesis;
    const ready = synth.getVoices ? synth.getVoices() : [];
    if (ready.length) return Promise.resolve(ready);
    return new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (synth.removeEventListener) synth.removeEventListener('voiceschanged', done);
        resolve(synth.getVoices ? synth.getVoices() : []);
      };
      const timer = setTimeout(done, 1500);
      if (synth.addEventListener) synth.addEventListener('voiceschanged', done);
    });
  },

  // "en_GB" and "en-GB" both become "en-gb"
  _lang(voice) {
    return String((voice && voice.lang) || '').replace('_', '-').toLowerCase();
  },

  getSavedVoice() {
    try { return localStorage.getItem(this.VOICE_KEY) || ''; } catch (error) { return ''; }
  },

  // An empty id means "Automatic"
  setSavedVoice(id) {
    try {
      if (id) localStorage.setItem(this.VOICE_KEY, id);
      else localStorage.removeItem(this.VOICE_KEY);
    } catch (error) {
      // Private browsing can refuse storage; the voice then just stays on Automatic
    }
  },

  // Picks the voice to use from a list of voices. ignoreSaved = true shows what "Automatic" would pick.
  chooseVoice(voices, ignoreSaved) {
    const saved = ignoreSaved ? '' : this.getSavedVoice();
    if (saved) {
      const mine = voices.find(v => v.voiceURI === saved || v.name === saved);
      if (mine) return mine;
    }
    const english = voices.filter(v => this._lang(v).startsWith('en'));
    const first = (test) => english.find(v => test(this._lang(v)));
    return first(l => l === 'en-ie') || first(l => l === 'en-gb') || first(l => l !== 'en-in')
      || first(() => true) || null;
  },

  // Gives an utterance its voice. With no voice found we still ask for Irish English by language.
  _applyVoice(utterance, voice) {
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = 'en-IE';
    }
  },

  // For the Settings picker: the English voices on this device (Irish first, Indian last), and the one
  // "Automatic" would use. Answers null if this browser can't speak at all.
  async getVoiceOptions() {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return null;
    const voices = await this._loadVoices();
    const rank = (v) => ({ 'en-ie': 0, 'en-gb': 1, 'en-in': 3 })[this._lang(v)] ?? 2;
    const english = voices.filter(v => this._lang(v).startsWith('en'))
      .sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
    return { voices: english, automatic: this.chooseVoice(voices, true) };
  },

  // The "Hear this voice" button in Settings
  async testVoice() {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;
    this.stopBriefing();
    const voices = await this._loadVoices();
    const utterance = new SpeechSynthesisUtterance('Hello, this is how I sound. Here is your day.');
    this._applyVoice(utterance, this.chooseVoice(voices));
    utterance.rate = 0.95;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  },

  // Came to the end by itself
  _finished() {
    this._run++;
    this._showState('idle');
  },

  // Stops the voice (whichever one is playing), closes the panel, and puts the buttons back to Play
  stopBriefing() {
    this._run++;
    if (this._audioEl) {
      this._audioEl.pause();
      this._audioEl = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    this._closePanel();
    this._showState('idle');
  },

  // The small panel that shows the summary as words. Built with textContent only, so nothing in your
  // notes can ever be treated as HTML. Returns the list items (one per sentence).
  _openPanel(sentences) {
    this._closePanel();
    const panel = document.createElement('section');
    panel.id = 'briefing-panel';
    panel.className = 'briefing-panel';
    panel.setAttribute('aria-labelledby', 'briefing-panel-title');

    const heading = document.createElement('h3');
    heading.id = 'briefing-panel-title';
    heading.textContent = 'Your day';

    const list = document.createElement('ul');
    list.className = 'briefing-lines';
    const items = sentences.map((sentence) => {
      const li = document.createElement('li');
      li.textContent = sentence;
      list.appendChild(li);
      return li;
    });

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'briefing-close';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.stopBriefing());

    panel.append(heading, list, close);
    document.body.appendChild(panel);
    return items;
  },

  _closePanel() {
    document.getElementById('briefing-panel')?.remove();
  },

  // A short message (uses Today's toast when it is there)
  _say(message) {
    if (typeof Today !== 'undefined' && Today.toast) Today.toast(message);
  },

  // Called with a short message to show in the .sinead-nudge banner.
  // Currently just a pass-through log — grocery.js already builds the
  // message text itself, so there's no real logic here yet.
  nudge(message) {
    console.log('Sinéad nudge:', message);
  }
};

// One listener for every Play button (they can appear on any page, and the phone's centre button is
// rebuilt by navigation.js, so listening on the document keeps working)
document.addEventListener('click', (e) => {
  if (e.target.closest('.btn-briefing, #global-play-fab, .bottom-nav-add[data-nav-add-mode="play"]')) {
    e.preventDefault();
    SineadAI.playBriefing();
  }
});
