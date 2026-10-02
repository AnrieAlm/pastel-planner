/**
 * Calyx Planner — Sinéad (front-end touches)
 *
 * The real AI (sorting a brain-dump, the microphone, follow-up questions) lives in the backend's
 * ai.py and in today.js. This file holds the lighter touches:
 *
 *   - playBriefing() / stopBriefing(): the Play button. It fetches today's summary from
 *     /api/briefing (plain sentences built from your own notes, habits and routine, no AI) and reads
 *     it aloud with the browser's built-in voice, while also showing the words in a small panel.
 *     Browsers that can't speak still show the words.
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
    const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    if (!canSpeak) {
      // No voice in this browser: the words in the panel are the summary
      this._showState('idle');
      this._say('This browser can\u2019t read aloud, so here it is in words.');
      return;
    }
    this._speak(sentences, items, run);
  },

  // Reads the sentences one after another (short pieces are more reliable than one long speech)
  _speak(sentences, items, run) {
    const synth = window.speechSynthesis;
    synth.cancel();                                      // clear anything still queued
    const voice = this._pickVoice();
    this._showState('speaking');

    sentences.forEach((sentence, index) => {
      const utterance = new SpeechSynthesisUtterance(sentence);
      if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
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

  // Prefers an Irish, then British, then any English voice
  _pickVoice() {
    const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
    const starts = (prefix) => voices.find(v => v.lang && v.lang.replace('_', '-').toLowerCase().startsWith(prefix));
    return starts('en-ie') || starts('en-gb') || starts('en') || null;
  },

  // Came to the end by itself
  _finished() {
    this._run++;
    this._showState('idle');
  },

  // Stops the voice, closes the panel, and puts the buttons back to Play
  stopBriefing() {
    this._run++;
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
