/**
 * Calyx Planner — Habits (the Habits page and the habit chips on Today)
 * The server draws the habits from MongoDB. This file sends ticks to the server,
 * updates the streak words instantly, and fills the add/edit sheet.
 */
const Habits = {
  init() {
    this.initTicks();
    this.initSheetOpeners();
    this.initSheetForm();
    this.initSuggestions();
  },

  // ---- Ticking a day (a circle on the Habits page, or a chip on Today) ----

  initTicks() {
    document.addEventListener('click', (e) => {
      const button = e.target.closest('.habit-day[data-habit-id], .habit-chip[data-habit-id]');
      if (!button || button.disabled) return;
      this.toggleTick(button);
    });
  },

  // Changes the look straight away (so it feels instant), then tells the server.
  // If the server says no, the look goes back.
  async toggleTick(button) {
    const habitId = button.dataset.habitId;
    const day = button.dataset.date;
    const willBeDone = button.getAttribute('aria-pressed') !== 'true';

    this.showTick(habitId, day, willBeDone);
    try {
      const response = await fetch('/api/habits/' + encodeURIComponent(habitId) + '/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: day, done: willBeDone })
      });
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!response.ok) throw new Error('save failed');
      const result = await response.json();
      this.showStreak(habitId, result.streakText);
    } catch (error) {
      this.showTick(habitId, day, !willBeDone);
      if (typeof Today !== 'undefined') Today.toast('Couldn\u2019t save that. Please try again.');
    }
  },

  // Updates every button for this habit and day (the Habits page circle and the Today chip)
  showTick(habitId, day, done) {
    document.querySelectorAll(`[data-habit-id="${habitId}"][data-date="${day}"]`).forEach(btn => {
      btn.classList.toggle('done', done);
      btn.setAttribute('aria-pressed', String(done));
      const label = btn.getAttribute('aria-label');
      if (label && btn.classList.contains('habit-day')) {
        btn.setAttribute('aria-label', label.replace(/, (not done|done)/, done ? ', done' : ', not done'));
      }
    });
  },

  showStreak(habitId, text) {
    document.querySelectorAll(
      `.habit-card[data-habit-id="${habitId}"] .habit-streak, .habit-chip[data-habit-id="${habitId}"] .habit-chip-streak`
    ).forEach(el => { el.textContent = text; });
  },

  // ---- The add / edit sheet ----

  // "Edit" on a filled card, or an empty slot, opens the same sheet
  initSheetOpeners() {
    document.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('[data-edit-habit]');
      const newBtn = e.target.closest('[data-new-habit]');
      if (!editBtn && !newBtn) return;
      await Modals.open('edit-habit');
      this.fillSheet(editBtn ? editBtn.dataset : null);
    });
  },

  // habit is null for a new habit
  fillSheet(habit) {
    const form = document.getElementById('habit-form');
    if (!form) return;
    const isNew = !habit;

    document.getElementById('habit-sheet-title').textContent = isNew ? 'Add a habit' : 'Edit habit';
    document.getElementById('habit-id').value = isNew ? '' : habit.habitId;
    document.getElementById('habit-name').value = isNew ? '' : habit.name;
    document.getElementById('habit-time').value = isNew ? '' : habit.time;
    document.getElementById('habit-active').checked = isNew ? true : habit.active === 'true';

    // Ideas only help when starting from nothing; Remove only makes sense for an existing habit
    document.getElementById('habit-suggestions').hidden = !isNew;
    const removeBtn = document.getElementById('habit-remove');
    removeBtn.hidden = isNew;
    if (!isNew) removeBtn.setAttribute('formaction', '/remove-habit/' + habit.habitId);

    // Day buttons: on for the habit's days (all seven for a new habit)
    const chosen = isNew ? ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] : habit.days.split(',');
    form.querySelectorAll('.day-picker button').forEach(btn => {
      const on = chosen.includes(btn.dataset.day);
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  },

  // Just before the form is sent, copy the chosen days into the hidden field
  initSheetForm() {
    document.addEventListener('submit', (e) => {
      const form = e.target.closest('#habit-form');
      if (!form) return;
      const days = [...form.querySelectorAll('.day-picker button.active')].map(btn => btn.dataset.day);
      document.getElementById('habit-days-value').value = days.join(',');
    });
  },

  // An idea chip fills in the name
  initSuggestions() {
    document.addEventListener('click', (e) => {
      const chip = e.target.closest('.habit-suggestion');
      if (!chip) return;
      const nameInput = document.getElementById('habit-name');
      nameInput.value = chip.textContent.trim();
      nameInput.focus();
    });
  }
};
