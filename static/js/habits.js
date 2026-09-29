/**
 * Calyx Planner — Habits Page
 */
const Habits = {
  init() {
    this.initDayToggles();
    this.initCardClick();
    this.initModalActions();
  },

  // Each day circle should toggle that day's done state. This was
  // previously inert — no way to log a habit as done from this page
  // at all. Since .habit-card also opens the edit modal on click,
  // stopPropagation() prevents a day-circle tap from also opening it.
  initDayToggles() {
    document.querySelectorAll('.habit-day').forEach(day => {
      day.setAttribute('tabindex', '0');
      day.setAttribute('role', 'button');
      day.setAttribute('aria-pressed', day.classList.contains('done') ? 'true' : 'false');

      const toggle = (e) => {
        e.stopPropagation();
        const isDone = day.classList.toggle('done');
        day.setAttribute('aria-pressed', isDone ? 'true' : 'false');
        // TODO: once backend exists, POST /api/habits/{habit_id}/log here
      };

      day.addEventListener('click', toggle);
      day.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle(e);
        }
      });
    });
  },

  // .habit-card carries data-modal="edit-habit", which Modals.js's
  // generic delegated listener already opens — but generically, with
  // no context about *which* card. Save/Remove need to know exactly
  // that, so this adds an explicit listener that opens the same modal
  // itself, with the card attached as sourceEl, and stops the event
  // from also reaching Modals' generic handler (which would otherwise
  // immediately re-open the same modal a second time with no data).
  initCardClick() {
    document.querySelectorAll('.habit-card').forEach(card => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = card.querySelector('h3')?.textContent?.trim() || '';
        Modals.open('edit-habit', { sourceEl: card, name });
      });
    });
  },

  // Save writes the modal's Name/Reminder-time fields back onto the
  // card that was opened. Remove clears the slot back to empty rather
  // than deleting the card outright — habits are a fixed 3-slot system
  // (see project spec: "exactly 3 slots"), so a slot goes back to
  // "unfilled" instead of the layout losing a card entirely.
  initModalActions() {
    document.addEventListener('click', (e) => {
      const saveBtn = e.target.closest('#modal-content .btn-modal-primary');
      const removeBtn = e.target.closest('#modal-content .btn-modal-danger');
      if (!saveBtn && !removeBtn) return;

      const card = Modals.currentData?.sourceEl;
      if (!card || !document.getElementById('habit-name')) return; // wrong modal

      if (saveBtn) {
        const name = document.getElementById('habit-name')?.value?.trim();
        const time = document.getElementById('habit-time')?.value;
        const titleEl = card.querySelector('h3');
        if (titleEl && name) {
          // Keep whatever emoji prefix the card already had (e.g. "🧘 ")
          const emojiMatch = titleEl.textContent.match(/^\S+\s/);
          titleEl.textContent = (emojiMatch ? emojiMatch[0] : '') + name;
        }
        const reminderEl = card.querySelector('.habit-reminder');
        if (reminderEl && time) {
          const [h, m] = time.split(':');
          const hour12 = ((+h % 12) || 12);
          const ampm = +h < 12 ? 'am' : 'pm';
          reminderEl.textContent = reminderEl.textContent.replace(/Reminder [\d:apm]+/i, `Reminder ${hour12}:${m} ${ampm}`);
        }
      } else if (removeBtn) {
        const titleEl = card.querySelector('h3');
        const streakEl = card.querySelector('.habit-streak');
        const reminderEl = card.querySelector('.habit-reminder');
        const statusEl = card.querySelector('.habit-status');
        if (titleEl) titleEl.textContent = '+ Add a habit';
        if (streakEl) streakEl.textContent = 'This slot is empty';
        if (reminderEl) reminderEl.textContent = 'No reminder set';
        if (statusEl) statusEl.textContent = 'Empty';
        card.querySelectorAll('.habit-day').forEach(d => d.classList.remove('done'));
        card.classList.add('habit-card-empty');
      }

      Modals.close();
    });
  }
};
