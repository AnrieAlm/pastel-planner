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
  },

  // Day capture — type or speak everything on your mind, Sinéad reads
  // it and suggests how to sort it. No real AI backend exists yet, so
  // this shows plausible mock suggestions (a light keyword guess, nothing
  // more) rather than an actual parse — see the project's actual AI plan
  // (Groq note-parsing) in the backend spec for what this stands in for.
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

      const urgent = document.querySelector('.suggestion-chip[data-chip="urgent"]')?.classList.contains('selected');
      const firstLine = text.split('\n')[0].slice(0, 60);
      this.addCapturedNote(firstLine, text, urgent);

      // Reset for the next capture — clears the box, disables submit
      // again, hides the suggestions, and puts the chips back to their
      // default state so a leftover "urgent" selection doesn't silently
      // carry over into whatever gets typed next
      input.value = '';
      input.style.height = 'auto';
      submitBtn.disabled = true;
      suggestions?.classList.add('hidden');
      document.querySelectorAll('.suggestion-chip').forEach(chip => {
        const isDefault = chip.dataset.chip !== 'urgent';
        chip.classList.toggle('selected', isDefault);
        chip.setAttribute('aria-pressed', String(isDefault));
      });

      this.toast(urgent ? 'Added to Notes — marked urgent' : 'Added to Notes');
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
      dateChip.textContent = mentionedDay
        ? `📅 ${mentionedDay.charAt(0).toUpperCase() + mentionedDay.slice(1)}`
        : '📅 Today';
    }
  },

  // Adds a real .postit to the Notes page's board — the Notes page
  // stays in the DOM even while hidden (see js/navigation.js), so this
  // works correctly regardless of which page is currently showing.
  // Built with textContent rather than an innerHTML template string —
  // whatever someone types into the capture box is shown as plain text,
  // never parsed as markup.
  addCapturedNote(title, content, urgent) {
    const board = document.querySelector('.postit-board');
    if (!board) return;

    const card = document.createElement('button');
    card.type = 'button';
    card.className = `postit colour-1${urgent ? ' urgent' : ''}`;
    card.setAttribute('data-modal', 'edit-note');

    const h = document.createElement('h4');
    h.textContent = (urgent ? '⚑ ' : '') + title;
    const p = document.createElement('p');
    p.textContent = content;
    const meta = document.createElement('span');
    meta.className = 'note-meta';
    meta.textContent = "From today's capture";
    card.append(h, p, meta);

    board.prepend(card);
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      Modals.open('edit-note', { sourceEl: card });
    });
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

  // "From yesterday" unfinished item — Move to today / New date / Let it go
  initCarryOverActions() {
    document.querySelectorAll('.carry-over-actions button').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.carry-over-item');
        const label = btn.textContent.trim();

        if (label === 'Move to today') {
          // TODO: once backend exists, this sets the note's date to today
          this.removeWithFade(item);
        } else if (label === 'New date') {
          Modals.open('pick-date', { sourceEl: item });
        } else if (label === 'Let it go') {
          this.removeWithFade(item);
        }
      });
    });
  },

  // Fired by Modals when "Set date" is clicked inside modal-pick-date.
  // Only acts when the modal was opened from a carry-over item (see
  // initCarryOverActions above) — picking a new date resolves that
  // item the same way "Move to today"/"Let it go" already do.
  initDatePicked() {
    document.addEventListener('calyx:date-picked', (e) => {
      const { sourceEl } = e.detail;
      if (sourceEl?.classList.contains('carry-over-item')) {
        this.removeWithFade(sourceEl);
      }
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
