/**
 * Calyx Planner — Today Page
 */
const Today = {
  init() {
    const briefingBtn = document.querySelector('.btn-briefing');
    briefingBtn?.addEventListener('click', () => {
      SineadAI.playBriefing();
    });

    // Desktop floating play button — lives in index.html directly since
    // it's visible on every page, not just Today's own content, but the
    // action is identical so it's wired right here alongside it.
    document.getElementById('global-play-fab')?.addEventListener('click', () => {
      SineadAI.playBriefing();
    });

    this.initNudgeActions();
    this.initCarryOverActions();
    this.initDatePicked();
    this.initCapture();
    this.showAddedToastIfNeeded();
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

  // Day capture: type or speak, tap "Sort my day", adjust the chips, then confirm.
  // Confirming fills a small hidden form and sends it to the server, which saves a real note.
  // (Sinéad's AI guesses arrive in a later stage; the chips here are a light keyword guess.)
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

    // Voice capture isn't connected to anything real yet, but a real
    // start/stop toggle (with a visible "recording" pulse) is still a
    // more honest preview of the intended interaction than a one-shot
    // message — auto-stops after 4s either way so it can't get stuck on
    micBtn?.addEventListener('click', () => {
      const recording = micBtn.classList.toggle('recording');
      micBtn.setAttribute('aria-pressed', String(recording));
      clearTimeout(this._micTimer);

      if (!recording) {
        micStatus?.classList.add('hidden');
        return;
      }
      if (micStatus) {
        micStatus.textContent = 'Listening… (voice input isn\u2019t connected yet — this is a preview)';
        micStatus.classList.remove('hidden');
      }
      this._micTimer = setTimeout(() => {
        micBtn.classList.remove('recording');
        micBtn.setAttribute('aria-pressed', 'false');
        micStatus?.classList.add('hidden');
      }, 4000);
    });

    submitBtn.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;
      this.guessCaptureChips(text);
      suggestions?.classList.remove('hidden');
      suggestions?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
      // setAttribute, because this form has an input called "action" that hides form.action
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
