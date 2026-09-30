/**
 * Calyx Planner — Calendar Page
 * The server draws the month and a panel for every day. This file makes tapping a day
 * instant (no reload) and fills in the date when you add something on a day.
 */
const Calendar = {
  init() {
    const grid = document.querySelector('.calendar-grid');
    if (!grid) return;

    this.initDaySelection(grid);
    this.initAddButtons();
    this.initSwipe(grid);
    // Arriving with ?day=... on a phone: make sure the day's list is in view
    if (new URLSearchParams(window.location.search).has('day')) {
      this.scrollPanelIntoView();
    }
  },

  // Tapping a day shows its panel. The day is a real link too, so it still works without JavaScript.
  initDaySelection(grid) {
    grid.addEventListener('click', (e) => {
      const day = e.target.closest('a.calendar-day[data-date]');
      if (!day) return;
      e.preventDefault();
      this.selectDay(day);
    });
  },

  selectDay(day) {
    const iso = day.dataset.date;

    // Move the highlight (aria-current="date" stays on today only)
    document.querySelectorAll('.calendar-day.selected').forEach(d => {
      d.classList.remove('selected');
      d.setAttribute('aria-label', d.dataset.label);
    });
    day.classList.add('selected');
    day.setAttribute('aria-label', day.dataset.label + ', selected');

    // Show only this day's panel
    document.querySelectorAll('.day-panel').forEach(panel => {
      panel.hidden = panel.dataset.panel !== iso;
    });
    document.getElementById('calendar-pick-day')?.remove();

    // "+ Add event" in the header adds on the selected day
    const headerAdd = document.getElementById('calendar-add-event');
    if (headerAdd) headerAdd.dataset.addOn = iso;

    // Keep the address in step, so a refresh (or coming back after editing a note) stays on this day
    const params = new URLSearchParams(window.location.search);
    params.set('day', iso);
    history.replaceState(null, '', window.location.pathname + '?' + params.toString());

    this.scrollPanelIntoView();
  },

  // On narrow screens the list sits below the grid, so bring it into view
  scrollPanelIntoView() {
    if (!window.matchMedia('(max-width: 999px)').matches) return;
    document.getElementById('day-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

    // Swiping left/right over the grid moves to the next/previous month, the way a phone calendar does.
  // A vertical swipe (scrolling) is left alone.
  initSwipe(grid) {
    let startX = 0;
    let startY = 0;
    let tracking = false;

    grid.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });

    grid.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;

      // Must be mostly horizontal, and past a small threshold, so an ordinary tap or a vertical
      // scroll never gets mistaken for a swipe
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.3) return;

      const month = dx < 0 ? grid.dataset.nextMonth : grid.dataset.prevMonth;
      if (month) this.navigateTo('/calendar?month=' + month);
    }, { passive: true });
  },

  // A tiny indirection around navigating, so it is easy to test in isolation
  navigateTo(url) {
    window.location.href = url;
  },
  // "+ Add event" and "+ Add on this day" open the New note sheet with the day already filled in
  initAddButtons() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-add-on]');
      if (!btn) return;
      await Modals.open('new-note');
      const date = btn.dataset.addOn;
      const dateInput = document.getElementById('new-note-date');
      if (date && dateInput) dateInput.value = date;
    });
  }
};
