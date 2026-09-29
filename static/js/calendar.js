/**
 * Calyx Planner — Calendar Page
 */
const Calendar = {
  selectedDay: null,

  init() {
    document.querySelectorAll('.calendar-day:not(:empty)').forEach(day => {
      // Keyboard-operable, same reasoning as note cards
      day.setAttribute('tabindex', '0');
      day.setAttribute('role', 'button');
      day.setAttribute('aria-pressed', 'false');

      day.addEventListener('click', () => this.selectDay(day));
      day.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.selectDay(day);
        }
      });
    });

    this.initMonthNav();
  },

  // Only one month of mock data exists (September 2026), so actually
  // changing the grid to a different month would either show nothing
  // or, worse, show September's days mislabelled as October — actively
  // wrong rather than just incomplete. Until real month data exists,
  // this gives honest, visible feedback instead of silently doing
  // nothing (a dead button) or fabricating wrong dates.
  initMonthNav() {
    const note = document.querySelector('.calendar-nav-note');
    let hideTimer = null;

    document.querySelectorAll('.calendar-nav button').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!note) return;
        note.classList.remove('hidden');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => note.classList.add('hidden'), 3000);
      });
    });
  },

  // Selecting a day updates which day is highlighted and refreshes the
  // detail panel. aria-current="date" is reserved for the real current
  // date — it's set once, statically, on .today in pages/calendar.html,
  // and this function never touches it. aria-pressed marks selection
  // instead, so today and "the day you clicked" can't collide.
  selectDay(day) {
    document.querySelectorAll('.calendar-day.selected').forEach(d => {
      d.classList.remove('selected');
      d.setAttribute('aria-pressed', 'false');
    });
    day.classList.add('selected');
    day.setAttribute('aria-pressed', 'true');
    this.selectedDay = day.textContent.trim();

    // TODO: once notes/events come from real data, look up this day's
    // events/habits here and rebuild .calendar-day-detail's contents
  }
};