/**
 * Calyx Planner — Today Page
 */
const Today = {
  init() {
    this.initNudgeActions();
    this.initCarryOverActions();
    this.initDatePicked();
    this.initCapture();
    this.showAddedToastIfNeeded();
    this.initRoutineTimeline();
  },

  // Routine: moves the "Now" highlight and its countdown with the real clock, across however
  // many blocks today actually has (merged from every routine active today). Also wires each
  // block's tick button, which also ticks its linked habit (see /api/routines/.../toggle).
  initRoutineTimeline() {
    const container = document.getElementById('morning-routine');
    const blocks = [...(container?.querySelectorAll('.timeline-block[data-time]') || [])];
    if (!blocks.length) return;

    const toMinutes = (hhmm) => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    const schedule = blocks.map(el => ({
      el,
      start: toMinutes(el.dataset.time),
      originalTime: el.querySelector('.timeline-time').textContent,
    }));

    const heading = container.querySelector('h3');

    // The heading's icon and words shift with the time of day, so a dark evening doesn't
    // still say "Today's routine" under a sun. Adjust the hours here if these feel off.
    const headingFor = (hour) => {
      if (hour >= 20 || hour < 5) return '\u{1F319} Tonight\u2019s routine';
      if (hour >= 17) return '\u{1F307} This evening';
      return '\u2600\uFE0F Today\u2019s routine';
    };

    const update = () => {
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();

      if (heading) heading.textContent = headingFor(now.getHours());

      schedule.forEach((block, i) => {
        
        const next = schedule[i + 1];
        // The last block of the day has no "next" to end at, so it stays "active" for 15
        // minutes rather than having a real duration to compare against
        const end = next ? next.start : block.start + 15;
        const isActive = nowMinutes >= block.start && nowMinutes < end;
        const isDone = nowMinutes >= end;

        block.el.classList.toggle('active', isActive);
        block.el.classList.toggle('done', isDone && !isActive);

        const timeEl = block.el.querySelector('.timeline-time');
        if (isActive) {
          const minutesLeft = end - nowMinutes;
          timeEl.textContent = 'Now';
          block.el.querySelector('.timeline-countdown')?.remove();
          if (minutesLeft > 0 && i < schedule.length - 1) {
            const countdown = document.createElement('span');
            countdown.className = 'timeline-countdown';
            countdown.textContent = `· ${minutesLeft} min left`;
            block.el.querySelector('.timeline-label').after(countdown);
          }
        } else {
          timeEl.textContent = block.originalTime;
          block.el.querySelector('.timeline-countdown')?.remove();
        }
      });
    };

    update();
    // A short interval keeps the countdown feeling "live" without doing real work most ticks
    const timer = setInterval(update, 30000);
    // Phones pause timers while a tab is hidden; catch up the moment it's visible again
    document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
    window.addEventListener('pagehide', () => clearInterval(timer));

    this.initRoutineTicks(container);
  },

  // Ticking a routine block saves instantly and, if it has a linked habit, ticks that habit
  // too — its chip and streak words (elsewhere on this same page) update right along with it.
  initRoutineTicks(container) {
    container?.addEventListener('click', async (e) => {
      const button = e.target.closest('.timeline-tick');
      if (!button) return;
      const block = button.closest('.timeline-block');
      const willBeDone = button.getAttribute('aria-pressed') !== 'true';

      button.setAttribute('aria-pressed', String(willBeDone));
      block.classList.toggle('ticked', willBeDone);

      const todayIso = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the browser's own timezone
      try {
        const response = await fetch(
          `/api/routines/${encodeURIComponent(block.dataset.routineId)}/blocks/${encodeURIComponent(block.dataset.blockId)}/toggle`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
        );
        if (response.status === 401) { window.location.href = '/login'; return; }
        if (!response.ok) throw new Error('save failed');
        const result = await response.json();

        // If this block is linked to a habit, its chip (and streak words) live elsewhere on
        // Today — Habits.showTick/showStreak already know how to update any element for that
        // habit_id, so this just hands them the id and the new state rather than keeping its
        // own copy of that logic
        if (result.habitId && result.habit && typeof Habits !== 'undefined') {
          Habits.showTick(result.habitId, todayIso, result.habit.doneToday);
          Habits.showStreak(result.habitId, result.habit.streakText);
        }
      } catch (error) {
        button.setAttribute('aria-pressed', String(!willBeDone));
        block.classList.toggle('ticked', !willBeDone);
        this.toast('Couldn\u2019t save that. Please try again.');
      }
    });
  },

  // After the capture form sends, the server redirects to /?added=1. Say so once.
  showAddedToastIfNeeded() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('added')) return;
    params.delete('added');
    const query = params.toString();
    history.replaceState(null, '', window.location.pathname + (query ? '?' + query : ''));
    this.toast('Added to your day');
  },

  // Day capture: type, tap "Sort my day", check Sinéad's review card, then confirm. Nothing is
  // saved until you confirm. (The chips are the simple fallback when Sinéad can't be reached.)
  initCapture() {
    const input = document.getElementById('today-capture-input');
    const micBtn = document.getElementById('today-capture-mic');
    const micStatus = document.getElementById('today-capture-mic-status');
    const submitBtn = document.getElementById('today-capture-submit');
    const suggestions = document.getElementById('today-capture-suggestions');
    const confirmBtn = document.getElementById('today-capture-confirm');
    if (!input || !submitBtn) return;

    // Submit stays disabled until there's actually something to sort,
    // rather than being clickable and silently doing nothing on an
    // empty box
    const syncSubmitState = () => { submitBtn.disabled = !input.value.trim(); };
    input.addEventListener('input', syncSubmitState);
    syncSubmitState();

    // Let the box grow as you type (up to the max-height in the CSS), so
    // text is never cut off and there is no scrollbar for short notes
    const autoGrow = () => {
      input.style.height = 'auto';
      input.style.height = input.scrollHeight + 'px';
    };
    input.addEventListener('input', autoGrow);

    // Ctrl/Cmd+Enter submits without reaching for the mouse
    input.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        submitBtn.click();
      }
    });

    // Voice: the mic records, the server turns it into text, and the text lands in the box
    this.initMic(micBtn, micStatus, input);

    // The review card is shown (and handled) inside this slot
    const slot = document.getElementById('capture-review-slot');
    if (slot) this.initReviewCard(slot, input);

    // "Sort my day": Sinéad (the server) sorts the text into a review card. If she can't (no
    // internet, no AI key, too many tries) we quietly use the simple chips below instead, so
    // saving a note always still works.
    submitBtn.addEventListener('click', async () => {
      const text = input.value.trim();
      if (!text) return;

      suggestions?.classList.add('hidden');
      if (slot) slot.innerHTML = '';
      const label = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sorting\u2026';
      submitBtn.setAttribute('aria-busy', 'true');

      const result = slot ? await this.fetchReviewCard(text) : null;

      submitBtn.textContent = label;
      submitBtn.removeAttribute('aria-busy');
      syncSubmitState();

      if (result && result.done) {
        // Answered a follow-up with "no thanks" (or nothing new): all done, show Today
        window.location.href = '/?added=1';
        return;
      }
      const html = result && result.html;
      if (html) {
        slot.innerHTML = html;
        const card = slot.querySelector('.capture-review');
        this.syncReviewCount(card);
        card.querySelector('#capture-review-title')?.focus();
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        this.guessCaptureChips(text);
        suggestions?.classList.remove('hidden');
        suggestions?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    document.querySelectorAll('.suggestion-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const selected = chip.classList.toggle('selected');
        chip.setAttribute('aria-pressed', String(selected));
      });
    });

    confirmBtn?.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;

      const chip = (name) => document.querySelector(`.suggestion-chip[data-chip="${name}"]`);
      const urgent = chip('urgent')?.classList.contains('selected');
      const dateChip = chip('date');
      // If the date chip is switched off, the note is saved without a date
      const when = dateChip?.classList.contains('selected') ? (dateChip.dataset.when || 'today') : '';

      // A short one-liner becomes just a title; longer text keeps its full content too
      const firstLine = text.split('\n')[0].trim().slice(0, 60);
      const isShort = !text.includes('\n') && text.length <= 60;

      const form = document.getElementById('capture-form');
      if (!form) return;
      form.querySelector('[name="title"]').value = firstLine;
      form.querySelector('[name="content"]').value = isShort ? '' : text;
      form.querySelector('[name="when"]').value = when;
      form.querySelector('[name="urgent"]').value = urgent ? 'on' : '';
      confirmBtn.disabled = true;
      form.submit();
    });
  },

  // ----- Voice capture. Tap the mic, speak, tap again. The recording goes to the server (which
  // asks Groq's Whisper to write it down) and the words appear in the box for you to check.
  // The recording is never saved: it is only held in memory while it is sent.
  MIC_MAX_MS: 120000,          // recording stops by itself after 2 minutes

  initMic(micBtn, micStatus, input) {
    if (!micBtn) return;
    // Old browsers (or a page that is not https) can't record, so the mic is simply hidden
    const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    if (!canRecord) {
      micBtn.hidden = true;
      micBtn.style.display = 'none';
      return;
    }
    this._micParts = { micBtn, micStatus, input };

    micBtn.addEventListener('click', () => {
      if (this._mic && this._mic.busy) return;           // still writing the last one down
      if (this._mic) this.stopRecording();
      else this.startRecording();
    });
    // Leaving the page must switch the microphone off
    window.addEventListener('pagehide', () => this.releaseMic());
  },

  // Says something under the mic button (it fades away by itself unless we are still recording)
  micMessage(text, keep) {
    const status = this._micParts?.micStatus;
    if (!status) return;
    clearTimeout(this._micHideTimer);
    status.textContent = text;
    status.classList.remove('hidden');
    if (!keep) this._micHideTimer = setTimeout(() => status.classList.add('hidden'), 9000);
  },

  // The best recording format this browser knows (Chrome: webm, Safari/iPhone: mp4)
  pickAudioType() {
    const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
    return options.find(type => MediaRecorder.isTypeSupported(type)) || '';
  },

  async startRecording() {
    const { micBtn } = this._micParts;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      this.micMessage(error && error.name === 'NotAllowedError'
        ? 'The microphone is switched off for this site. You can allow it in your browser\u2019s site settings.'
        : 'I couldn\u2019t find a microphone. You can type instead.');
      return;
    }

    const type = this.pickAudioType();
    const recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
    const chunks = [];
    recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunks.push(e.data); });
    recorder.addEventListener('stop', () => this.finishRecording(chunks, recorder.mimeType || type));

    this._mic = {
      stream, recorder, busy: false, startedAt: Date.now(),
      timer: setTimeout(() => this.stopRecording(), this.MIC_MAX_MS)
    };
    recorder.start();
    micBtn.classList.add('recording');
    micBtn.setAttribute('aria-pressed', 'true');
    micBtn.setAttribute('aria-label', 'Stop recording');
    this.micMessage('Listening\u2026 tap the mic again when you\u2019re done.', true);
  },

  stopRecording() {
    const recorder = this._mic && this._mic.recorder;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  },

  // Switches the microphone off completely (so the browser's recording dot goes away)
  releaseMic() {
    if (!this._mic) return;
    clearTimeout(this._mic.timer);
    this._mic.stream.getTracks().forEach(track => track.stop());
    const recorder = this._mic.recorder;
    if (recorder && recorder.state !== 'inactive') {
      // Leaving the page: drop the recording instead of sending it
      this._mic.cancelled = true;
      recorder.stop();
    }
  },

  async finishRecording(chunks, mimeType) {
    const mic = this._mic;
    const { micBtn, input } = this._micParts;
    if (!mic) return;
    const seconds = (Date.now() - mic.startedAt) / 1000;
    this.releaseMic();
    micBtn.classList.remove('recording');
    micBtn.setAttribute('aria-pressed', 'false');
    micBtn.setAttribute('aria-label', 'Speak instead of typing');
    if (mic.cancelled) { this._mic = null; return; }

    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
    if (seconds < 1 || blob.size < 1500) {                // a mis-tap, nothing to send
      this._mic = null;
      this.micMessage('I didn\u2019t catch anything. Tap the mic and try again.');
      return;
    }

    mic.busy = true;
    micBtn.disabled = true;
    this.micMessage('Writing that down\u2026', true);
    try {
      const extension = ['webm', 'mp4', 'ogg', 'wav'].find(e => (mimeType || '').includes(e)) || 'webm';
      const form = new FormData();
      form.append('audio', blob, 'capture.' + extension);
      const response = await fetch('/api/capture/transcribe', { method: 'POST', body: form });

      if (response.status === 401) { window.location.href = '/login'; return; }
      if (response.status === 413) {
        this.micMessage('That was a long one. Try recording it in shorter parts.');
        return;
      }
      if (response.status === 429) {
        this.micMessage('That\u2019s a lot of voice for one hour. Typing still works.');
        return;
      }
      if (!response.ok) throw new Error('transcribe failed');

      const { text } = await response.json();
      if (!text) {
        this.micMessage('I didn\u2019t catch anything. Tap the mic and try again.');
        return;
      }
      // Add the words to the box (below anything already typed) and wake up the box's other helpers
      const existing = input.value.trim();
      input.value = existing ? existing + '\n' + text : text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      this.micMessage('Check the words, then tap Sort my day.');
    } catch (error) {
      this.micMessage('I couldn\u2019t write that down just now. You can type it instead.');
    } finally {
      this._mic = null;
      micBtn.disabled = false;
    }
  },

  // Asks the server to sort the text. Returns { html } (the review card), { done: true } (a follow-up
  // answer with nothing to add), or null when it can't (the caller then shows the simple chips).
  // A 401 sends you to the login page.
  async fetchReviewCard(text) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/api/capture/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, after: this._followupAfter || '' }),
        signal: controller.signal
      });
      if (response.status === 401) {
        window.location.href = '/login';
        return null;
      }
      if (response.status === 429) {
        this.toast('That\u2019s a lot of sorting for one hour. Here\u2019s the simple version.');
        return null;
      }
      if (!response.ok) throw new Error('parse failed');
      // A JSON answer means "nothing more to add"; otherwise it is the review card's HTML
      if ((response.headers.get('content-type') || '').includes('application/json')) {
        const data = await response.json();
        return data.done ? { done: true } : null;
      }
      return { html: await response.text() };
    } catch (error) {
      this.toast('Sinéad is resting, so here\u2019s the simple version.');
      return null;
    } finally {
      clearTimeout(timer);
    }
  },

  // Listens (once) for changes and taps anywhere inside the review card
  initReviewCard(slot) {
    slot.addEventListener('change', (e) => {
      const card = e.target.closest('.capture-review');
      if (!card) return;
      // Date, time and Urgent only make sense for notes
      if (e.target.matches('.cr-target')) {
        const row = e.target.closest('.capture-review-row');
        const noteOnly = row.querySelector('.capture-review-note-only');
        if (noteOnly) noteOnly.hidden = e.target.value !== 'note';
        const category = row.querySelector('.cr-category');
        if (category) category.hidden = e.target.value !== 'bucket';
      }
      this.syncReviewCount(card);
    });

    slot.addEventListener('click', (e) => {
      // The two buttons under a follow-up question
      if (e.target.closest('.cf-done')) {
        window.location.href = '/?added=1';
        return;
      }
      if (e.target.closest('.cf-stop')) {
        this.stopFollowups();
        return;
      }

      const card = e.target.closest('.capture-review');
      if (!card) return;
      if (e.target.closest('.cr-cancel')) {
        slot.innerHTML = '';
        this.endFollowup();
        document.getElementById('today-capture-input')?.focus();
        return;
      }
      const confirmBtn = e.target.closest('.cr-confirm');
      if (confirmBtn) this.confirmReview(card, confirmBtn);
    });
  },

  // ----- "Did you miss anything?" Your items are already saved. Sinéad asks one gentle question,
  // and your answer (typed or spoken) goes into the same box, then through the same review card.
  // It is capped at two questions, and "I'm all set" or "Don't ask me these" end it at once.
  showFollowup(followup, committed) {
    const slot = document.getElementById('capture-review-slot');
    const input = document.getElementById('today-capture-input');
    if (!slot || !input) { window.location.href = '/?added=1'; return; }

    const total = Object.values(committed || {}).reduce((sum, n) => sum + n, 0);
    const saved = total === 1 ? 'Added 1 thing to your day.' : `Added ${total} things to your day.`;

    // Built with textContent (not innerHTML) so the question text can never be treated as HTML
    const panel = document.createElement('section');
    panel.className = 'capture-followup';
    panel.setAttribute('aria-labelledby', 'capture-followup-title');

    const savedLine = document.createElement('p');
    savedLine.className = 'capture-followup-saved';
    savedLine.textContent = saved;

    const heading = document.createElement('h3');
    heading.id = 'capture-followup-title';
    heading.tabIndex = -1;
    heading.textContent = followup.question;

    const hint = document.createElement('p');
    hint.className = 'capture-review-intro';
    hint.textContent = 'Type or speak your answer in the box above, then tap Sort my day. Or skip it, no pressure.';

    const actions = document.createElement('div');
    actions.className = 'capture-review-actions';
    for (const [className, label] of [['cf-done', 'I\u2019m all set'], ['cf-stop', 'Don\u2019t ask me these']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-capture-cancel ' + className;
      button.textContent = label;
      actions.appendChild(button);
    }
    panel.append(savedLine, heading, hint, actions);

    slot.innerHTML = '';
    slot.appendChild(panel);

    // From now on the box is for the ANSWER; remember which saved draft it belongs to
    this._followupAfter = followup.after;
    if (this._originalPlaceholder === undefined) this._originalPlaceholder = input.placeholder;
    input.placeholder = 'Your answer\u2026';
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    heading.focus();
  },

  // Back to the normal capture box
  endFollowup() {
    this._followupAfter = '';
    const input = document.getElementById('today-capture-input');
    if (input && this._originalPlaceholder !== undefined) input.placeholder = this._originalPlaceholder;
  },

  // "Don't ask me these": switch the questions off for good (Settings can turn them back on)
  async stopFollowups() {
    try {
      await fetch('/api/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false })
      });
    } catch (error) {
      // Not fatal: the questions just stay on
    }
    window.location.href = '/?added=1';
  },

  // The confirm button says how many things are ticked, and is off when none are
  syncReviewCount(card) {
    const button = card?.querySelector('.cr-confirm');
    if (!button) return;
    const count = card.querySelectorAll('.cr-include:checked').length;
    button.disabled = count === 0;
    button.textContent = count === 0 ? 'Tick something to add' : `Add ${count} to my day`;
  },

  // Sends the ticked items (with any edits) to the server, which cleans them again and saves them
  async confirmReview(card, button) {
    const picks = [...card.querySelectorAll('.capture-review-item')]
      .filter(row => row.querySelector('.cr-include').checked)
      .map(row => {
        const target = row.querySelector('.cr-target').value;
        const pick = { index: Number(row.dataset.index), title: row.querySelector('.cr-title').value, target };
        if (target === 'bucket') pick.category = row.querySelector('.cr-category').value;
        if (target === 'note') {
          pick.date = row.querySelector('.cr-date').value;
          pick.time = row.querySelector('.cr-time').value;
          pick.urgent = row.querySelector('.cr-urgent').checked;
        }
        return pick;
      });
    if (!picks.length) return;

    button.disabled = true;
    button.textContent = 'Adding\u2026';
    try {
      const response = await fetch('/api/capture/confirm/' + encodeURIComponent(card.dataset.sessionId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ picks })
      });
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (response.status === 409) {                    // a double tap: it was already saved
        window.location.href = '/?added=1';
        return;
      }
      if (response.status === 404) {                    // the draft timed out (30 minutes)
        const reviewSlot = document.getElementById('capture-review-slot');
        if (reviewSlot) reviewSlot.innerHTML = '';
        this.toast('That took a little long, so nothing was added. Tap Sort my day to try again.');
        return;
      }
      if (!response.ok) throw new Error('confirm failed');
      const result = await response.json();
      if (result.followup && result.followup.question) {
        this.showFollowup(result.followup, result.committed);       // the items are saved; Sinéad asks one thing
        return;
      }
      window.location.href = '/?added=1';
    } catch (error) {
      this.syncReviewCount(card);
      this.toast('Couldn\u2019t save that. Please try again.');
    }
  },

  // Light keyword guesses to make the mock suggestions feel at least
  // somewhat responsive to what was actually typed, rather than always
  // showing the exact same three chips regardless of content.
  guessCaptureChips(text) {
    const lower = text.toLowerCase();
    const urgentChip = document.querySelector('.suggestion-chip[data-chip="urgent"]');
    const dateChip = document.querySelector('.suggestion-chip[data-chip="date"]');

    const soundsUrgent = /urgent|asap|important|deadline/.test(lower);
    urgentChip?.classList.toggle('selected', soundsUrgent);
    urgentChip?.setAttribute('aria-pressed', String(soundsUrgent));

    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const mentionedDay = days.find(d => lower.includes(d));
    if (dateChip) {
      dateChip.dataset.when = mentionedDay || 'today';
      dateChip.textContent = mentionedDay
        ? `📅 ${mentionedDay.charAt(0).toUpperCase() + mentionedDay.slice(1)}`
        : '📅 Today';
    }
  },

  // Brief bottom-of-screen confirmation, reused for anything on this
  // page that needs a "that worked" acknowledgement without a full
  // modal or a permanent banner.
  toast(message) {
    let el = document.querySelector('.today-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'today-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.remove('show');
    void el.offsetWidth; // restart the animation if a toast is already showing
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  },

  // Sinéad's proactive nudge ("Add chicken to grocery list?")
  initNudgeActions() {
    document.querySelectorAll('.nudge-actions button').forEach(btn => {
      btn.addEventListener('click', () => {
        const nudge = btn.closest('.sinead-nudge');
        // data-action is more reliable than matching button text —
        // add data-action="accept" / data-action="dismiss" in the HTML
        const action = btn.dataset.action || (btn.textContent.trim() === 'Add it' ? 'accept' : 'dismiss');

        if (action === 'accept') {
          Grocery.addItem('Chicken');
        }
        this.removeWithFade(nudge);
      });
    });
  },

  // "From yesterday": Move to today and Let it go are real forms the server handles.
  // Only "Pick a new date" needs JavaScript, to open the date sheet.
  initCarryOverActions() {
    document.querySelectorAll('[data-rollover="new-date"]').forEach(btn => {
      btn.addEventListener('click', () => {
        Modals.open('pick-date', { sourceEl: btn.closest('.carry-over-item') });
      });
    });
  },

  // Modals announces the chosen date. If it came from a "From yesterday" item, send it to the server.
  initDatePicked() {
    document.addEventListener('calyx:date-picked', (e) => {
      const { date, sourceEl } = e.detail;
      if (!sourceEl?.classList.contains('carry-over-item') || !date) return;

      const form = document.getElementById('rollover-form');
      if (!form) return;
      form.setAttribute('action', '/rollover/' + sourceEl.dataset.noteId);
      form.querySelector('[name="new_date"]').value = date;
      form.submit();
    });
  },

  // Removes an element after a brief fade, and moves focus somewhere
  // sensible so keyboard users aren't left stranded on a removed element
  removeWithFade(el) {
    if (!el) return;
    const next = el.nextElementSibling || el.previousElementSibling || el.parentElement;
    el.style.transition = 'opacity 0.2s ease';
    el.style.opacity = '0';
    setTimeout(() => {
      el.remove();
      next?.focus?.();
    }, 200);
  }
};
